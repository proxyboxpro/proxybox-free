//! ProxyBox agent (Rust + Tokio) — drop-in replacement for `server/agent.js`.
//!
//! Same control-plane protocol over HTTP + bearer:
//!   POST /api/agent/enroll      → { token, controlUrl, proxyDefaults, ... }
//!   POST /api/agent/register    → { ok }
//!   POST /api/agent/heartbeat   → { ok }
//!   GET  /api/agent/proxies     → [ { id, type, bindIp, port, username, password, ... } ]
//!
//! Config: `/etc/proxybox-agent.json` (or env PROXYBOX_CONTROL / PROXYBOX_ENROLL / PROXYBOX_TOKEN).
//! Legacy: `/etc/proxyhub-agent.json` + PROXYHUB_* env vars still accepted for backward compat.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha224};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpSocket, TcpStream};
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_rustls::TlsAcceptor;

const AGENT_VERSION: &str = "1.9.0-rust";
// Reconcile loop is now mostly a safety net — the master long-polls
// /api/agent/proxies for up to 25s and wakes us instantly on config changes
// (rotation, expiry). The tick remains short so a missed wake-up still
// recovers fast.
const POLL_INTERVAL: Duration = Duration::from_secs(5);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(120);

// ──────────────────────────── error reporter ────────────────────────────────
// Fire-and-forget POST to the panel's /api/agent/error so deterministic
// agent-side failures (bind/listen/cert/panic) show up in the centralized
// /admin/errors view. Panel does dedup by (source='agent', code), so the
// agent doesn't need its own rate limiter — repeated identical errors just
// bump count on the panel side. Initialized once at startup; if uninit'd
// (e.g. config not loaded yet) calls silently no-op.
#[derive(Clone)]
struct Reporter { http: reqwest::Client, base: String, token: String }
static REPORTER: std::sync::OnceLock<Reporter> = std::sync::OnceLock::new();
fn report_err(level: &'static str, code: &'static str, msg: impl Into<String>, ctx: serde_json::Value, proxy_id: Option<String>) {
    if let Some(r) = REPORTER.get() {
        let (http, base, token) = (r.http.clone(), r.base.clone(), r.token.clone());
        let body = serde_json::json!({"level":level,"code":code,"message":msg.into(),"context":ctx,"proxyId":proxy_id});
        tokio::spawn(async move {
            let _ = http.post(format!("{}/api/agent/error", base))
                .bearer_auth(&token).json(&body)
                .timeout(Duration::from_secs(8))
                .send().await;
        });
    }
}

// ──────────────────────────── config & state ────────────────────────────────

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct AgentConfig {
    #[serde(rename = "controlUrl")]
    control_url: String,
    token: String,
    #[serde(rename = "enrollToken")]
    enroll_token: String,
    #[serde(rename = "mtlsUrl")]
    mtls_url: String,
    #[serde(rename = "caCert")]
    ca_cert: String,
    #[serde(rename = "clientCert")]
    client_cert: String,
    #[serde(rename = "clientKey")]
    client_key: String,
    // family the control plane assigned this node: "ipv4" | "ipv6" | "dual"
    #[serde(default = "default_family")]
    family: String,
    #[serde(rename = "proxyDefaults")]
    proxy_defaults: ProxyDefaults,
    // Unified listener — single accept port for all proxies, routes by
    // username from Proxy-Authorization. Scales to 100k+ proxies/node
    // because TCP port space (16-bit) no longer bounds proxy count. 0 =
    // disabled (legacy per-proxy listeners only).
    #[serde(rename = "unifiedPlainPort", default = "default_unified_plain")]
    unified_plain_port: u16,
    #[serde(rename = "unifiedTlsPort", default = "default_unified_tls")]
    unified_tls_port: u16,
}
fn default_unified_plain() -> u16 { 7777 }
fn default_unified_tls() -> u16 { 7778 }
fn default_family() -> String { "dual".into() }

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
struct ProxyDefaults {
    #[serde(rename = "listenHost")]
    listen_host: String,
    #[serde(rename = "allowPrivateTargets")]
    allow_private_targets: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
struct ProxyCfg {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String, // "IPv4" | "IPv6"
    rotate: bool,
    #[serde(rename = "listenHost")]
    listen_host: String,
    #[serde(rename = "bindIp")]
    bind_ip: String,
    port: u16,
    #[serde(rename = "tlsPort", default)]
    tls_port: u16,
    username: String,
    password: String,
    status: String,
    #[serde(rename = "allowPrivateTargets")]
    allow_private_targets: bool,
    #[serde(rename = "maxConnections")]
    max_connections: u64,
    #[serde(rename = "bytesPerSec")]
    bytes_per_sec: u64,
    #[serde(rename = "monthlyQuotaBytes")]
    monthly_quota_bytes: u64,
    #[serde(rename = "perSrcMax", default)]
    per_src_max: u64,
    #[serde(rename = "upstreamUrl", default)]
    upstream_url: String,
    #[serde(default)] country: String,
    #[serde(default)] asn: String,
    // If non-empty, requests from listed source IPs / CIDRs skip user/pass
    // entirely — handy for static-IP scrapers that don't pass headers.
    #[serde(rename = "allowedSrcIps", default)]
    allowed_src_ips: Vec<String>,
    // Kick counter. Master bumps when customer hits "Ngắt tất cả kết nối".
    // Agent compares to its in-memory epoch and disconnects all active sockets
    // for this proxy when master's value is higher.
    #[serde(rename = "kickEpoch", default)]
    kick_epoch: u64,
}
impl Default for ProxyCfg {
    fn default() -> Self {
        Self {
            id: String::new(), name: String::new(), kind: "IPv4".into(), rotate: false,
            listen_host: "0.0.0.0".into(), bind_ip: String::new(), port: 0, tls_port: 0,
            username: String::new(), password: String::new(), status: "active".into(),
            allow_private_targets: false,
            max_connections: 0, bytes_per_sec: 0, monthly_quota_bytes: 0,
            per_src_max: 0,
            upstream_url: String::new(), country: String::new(), asn: String::new(),
            allowed_src_ips: Vec::new(),
            kick_epoch: 0,
        }
    }
}

// 3-tier anti-abuse cap (mirror server/index.js comments).
//   A. CAP_TOTAL_PER_PROXY    — hard total per proxy across protocols + IPs
//   B. CAP_PER_SRC_IP         — within total, one IP can't hog all slots
//   C. CAP_NEW_PER_SEC_PER_IP — burst rate (catches 10k-in-1s flood)
const CAP_TOTAL_PER_PROXY: usize = 100;
const CAP_PER_SRC_IP: usize = 60;
const CAP_NEW_PER_SEC_PER_IP: u32 = 30;

struct ProxySessionState {
    handles: Vec<(Arc<Notify>, String)>, // (kick notify, src_ip)
    by_ip: HashMap<String, usize>,
    rate: HashMap<String, (u64, u32)>,   // src_ip -> (sec, count_in_sec)
    epoch: u64,
}
impl Default for ProxySessionState {
    fn default() -> Self {
        Self { handles: Vec::new(), by_ip: HashMap::new(), rate: HashMap::new(), epoch: 0 }
    }
}
type ProxyLockMap = std::sync::Mutex<HashMap<String, ProxySessionState>>;

fn try_acquire_session(sessions: &Arc<ProxyLockMap>, proxy: &ProxyCfg, src_ip: &str) -> Option<SessionGuard> {
    let mut map = match sessions.lock() { Ok(g) => g, Err(_) => return None };
    let entry = map.entry(proxy.id.clone()).or_insert_with(ProxySessionState::default);
    if entry.epoch < proxy.kick_epoch {
        for (h, _) in entry.handles.drain(..) { h.notify_waiters(); }
        entry.by_ip.clear();
        entry.rate.clear();
        entry.epoch = proxy.kick_epoch;
    }
    let ip = if src_ip.is_empty() { "unknown".to_string() } else { src_ip.to_string() };
    // C: per-IP per-sec rate limit
    let now_sec = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs()).unwrap_or(0);
    let r = entry.rate.entry(ip.clone()).or_insert((now_sec, 0));
    if r.0 != now_sec { *r = (now_sec, 0); }
    r.1 += 1;
    if r.1 > CAP_NEW_PER_SEC_PER_IP { return None; }
    // A: total per proxy
    if entry.handles.len() >= CAP_TOTAL_PER_PROXY { return None; }
    // B: per src IP within proxy
    let ip_count = *entry.by_ip.get(&ip).unwrap_or(&0);
    if ip_count >= CAP_PER_SRC_IP { return None; }
    let n = Arc::new(Notify::new());
    entry.handles.push((n.clone(), ip.clone()));
    entry.by_ip.insert(ip.clone(), ip_count + 1);
    drop(map);
    Some(SessionGuard::new(sessions.clone(), proxy.id.clone(), n))
}

fn release_session(sessions: &Arc<ProxyLockMap>, proxy_id: &str, notify: &Arc<Notify>) {
    let mut map = match sessions.lock() { Ok(g) => g, Err(_) => return };
    if let Some(entry) = map.get_mut(proxy_id) {
        if let Some(pos) = entry.handles.iter().position(|(h, _)| Arc::ptr_eq(h, notify)) {
            let (_, ip) = entry.handles.remove(pos);
            if let Some(c) = entry.by_ip.get_mut(&ip) {
                if *c <= 1 { entry.by_ip.remove(&ip); } else { *c -= 1; }
            }
        }
    }
}

// Called from reconcile() when master bumps kickEpoch — drains handles
// + fires notify_waiters to all currently-relaying tasks.
fn kick_all_sessions(sessions: &ProxyLockMap, proxy_id: &str, new_epoch: u64) -> usize {
    let mut map = match sessions.lock() { Ok(g) => g, Err(_) => return 0 };
    let entry = map.entry(proxy_id.to_string()).or_insert_with(ProxySessionState::default);
    if entry.epoch >= new_epoch { return 0; }
    let n = entry.handles.len();
    for (h, _) in entry.handles.drain(..) { h.notify_waiters(); }
    entry.by_ip.clear();
    entry.rate.clear();
    entry.epoch = new_epoch;
    n
}

// RAII guard so the session slot is released on every early-return path
// (auth fail, upstream connect fail, panic, ...).
struct SessionGuard {
    sessions: Arc<ProxyLockMap>,
    proxy_id: String,
    notify: Arc<Notify>,
    released: bool,
}
impl SessionGuard {
    fn new(sessions: Arc<ProxyLockMap>, proxy_id: String, notify: Arc<Notify>) -> Self {
        Self { sessions, proxy_id, notify, released: false }
    }
    fn notify_handle(&self) -> Arc<Notify> { self.notify.clone() }
}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        if self.released { return; }
        self.released = true;
        release_session(&self.sessions, &self.proxy_id, &self.notify);
    }
}

#[derive(Serialize, Default)]
struct NetworkReport {
    ipv4: Vec<IfaceAddr>,
    ipv6: Vec<IfaceAddr>,
    #[serde(rename = "ipv6Prefixes")]
    ipv6_prefixes: Vec<serde_json::Value>,
}
#[derive(Serialize)]
struct IfaceAddr {
    iface: String,
    address: String,
    cidr: String,
}

// Per-proxy runtime handle. `stop` is a tokio watch sender — send(true) is a
// reliable broadcast that all currently-attached AND future receivers will
// see (unlike Notify::notify_waiters which only wakes already-pending
// .notified() futures and can drop the signal between accept-loop
// iterations — that race was the source of 'stale bindIp' staleness on
// rotation: the new listener got spawned via REUSEPORT alongside the old
// one, kernel hash-balanced between them, and some traffic kept using the
// old/dead egress IP). task / tls_task are aborted as belt-and-suspenders.
struct ProxyHandle {
    #[allow(dead_code)] cfg: ProxyCfg,
    stop: tokio::sync::watch::Sender<bool>,
    task: JoinHandle<()>,
    tls_task: Option<JoinHandle<()>>,
}

// Force-aborts a Vec<AbortHandle> when dropped. Used by serve_proxy/_tls to
// guarantee inner accept-loop workers stop when the outer task is aborted —
// dropping a JoinHandle merely detaches, so without this the workers (and
// their REUSEPORT listener sockets) would keep running.
struct AbortOnDrop(Vec<tokio::task::AbortHandle>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) { for h in self.0.drain(..) { h.abort(); } }
}

#[derive(Default, Clone)]
struct TargetStat {
    count: u64,
    bytes_up: u64,
    bytes_down: u64,
    last_ts_ms: u64,
}

#[derive(Clone)]
struct ConnRecord {
    ts: u64,
    src: String,
    src_port: u16,
    host: String,
    port: u16,
    up: u64,
    down: u64,
    ms: u64,
    kind: String,
}

const TOP_TARGETS_MAX: usize = 50;
const RECENT_CONNS_MAX: usize = 50;

#[derive(Default)]
struct ProxyStats {
    upload_bytes: AtomicU64,
    download_bytes: AtomicU64,
    total_connections: AtomicU64,
    active_connections: AtomicU64,
    month_bytes: AtomicU64,
    month_key: AtomicU32, // year*100 + month
    // 5-second sampler — rolling rate gauge in bytes/sec
    bps_in: AtomicU64,
    bps_out: AtomicU64,
    sample_last_total: AtomicU64,
    sample_last_ms: AtomicU64,
    // per-source-IP active connection table (anti-abuse)
    per_src: Mutex<HashMap<IpAddr, u64>>,
    // Top destination hosts per proxy — aggregated count + bytes, capped to
    // TOP_TARGETS_MAX with coarse LRU eviction on overflow.
    top_targets: Mutex<HashMap<String, TargetStat>>,
    // Ring buffer of recent connection records (drained on each heartbeat
    // so the control plane sees fresh records — agent doesn't keep a long
    // local history, control plane does).
    recent_conns_pending: Mutex<VecDeque<ConnRecord>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn record_connection(stats: &Arc<ProxyStats>, src: IpAddr, src_port: u16, host: &str, port: u16, up: u64, down: u64, ms: u64, kind: &str) {
    let now = now_ms();
    let host = host.to_ascii_lowercase();
    if host.is_empty() { return; }
    {
        let mut m = stats.top_targets.lock().await;
        let entry = m.entry(host.clone()).or_insert_with(TargetStat::default);
        entry.count += 1;
        entry.bytes_up += up;
        entry.bytes_down += down;
        entry.last_ts_ms = now;
        if m.len() > TOP_TARGETS_MAX {
            let oldest = m.iter().min_by_key(|(_, v)| v.last_ts_ms).map(|(k, _)| k.clone());
            if let Some(k) = oldest { m.remove(&k); }
        }
    }
    {
        let mut q = stats.recent_conns_pending.lock().await;
        q.push_back(ConnRecord { ts: now, src: src.to_string(), src_port, host, port, up, down, ms, kind: kind.to_string() });
        while q.len() > RECENT_CONNS_MAX { q.pop_front(); }
    }
}

struct ActiveGuard(Arc<ProxyStats>);
impl Drop for ActiveGuard {
    fn drop(&mut self) { self.0.active_connections.fetch_sub(1, Ordering::Relaxed); }
}

// RAII for the per-src-IP counter so it always decrements on drop.
struct PerSrcGuard { stats: Arc<ProxyStats>, ip: IpAddr }
impl Drop for PerSrcGuard {
    fn drop(&mut self) {
        let s = self.stats.clone();
        let ip = self.ip;
        tokio::spawn(async move {
            let mut m = s.per_src.lock().await;
            let entry = m.entry(ip).or_insert(0);
            if *entry > 0 { *entry -= 1; }
            if *entry == 0 { m.remove(&ip); }
        });
    }
}

// Howard Hinnant's civil-from-days algorithm — UTC year+month from current UNIX time.
fn current_year_month() -> (i32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
        .as_secs() as i64;
    let mut days = secs / 86_400;
    days += 719_468;
    let era = days.div_euclid(146_097);
    let doe = (days - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32)
}

fn add_traffic(s: &Arc<ProxyStats>, up: u64, dn: u64) {
    s.upload_bytes.fetch_add(up, Ordering::Relaxed);
    s.download_bytes.fetch_add(dn, Ordering::Relaxed);
    let (y, m) = current_year_month();
    let mk = (y as u32) * 100 + m;
    let prev = s.month_key.load(Ordering::Relaxed);
    if prev != mk {
        if s.month_key.compare_exchange(prev, mk, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
            s.month_bytes.store(0, Ordering::Relaxed);
        }
    }
    s.month_bytes.fetch_add(up + dn, Ordering::Relaxed);
}

// Snapshot kept in sync with `listeners` so the unified handler can resolve
// (username → ProxyCfg + stats) in O(1) without grabbing the tokio mutex on
// the hot connection-accept path. A parallel trojan-hash index is used by
// the unified TLS port to dispatch Trojan auth (SHA224 of password) just
// as quickly.
type ProxyRef = (Arc<ProxyCfg>, Arc<ProxyStats>);
type UserIndex = std::sync::RwLock<HashMap<String, ProxyRef>>;
type TrojanIndex = std::sync::RwLock<HashMap<String, ProxyRef>>;

struct Agent {
    cfg: Mutex<AgentConfig>,
    cfg_path: PathBuf,
    http: reqwest::Client,
    mtls: Mutex<Option<reqwest::Client>>,
    listeners: Mutex<HashMap<String, ProxyHandle>>,
    stats: Mutex<HashMap<String, Arc<ProxyStats>>>,
    tls_acceptor: Mutex<Option<TlsAcceptor>>,
    user_index: Arc<UserIndex>,
    trojan_index: Arc<TrojanIndex>,
    // Last config revision seen — sent to master as ?rev=N so the master
    // long-polls if nothing changed since.
    last_rev: std::sync::atomic::AtomicU64,
    // Soft-lock state for "one PC = one login per proxy". Shared across all
    // listener tasks for a given proxy so plain + TLS variants enforce the
    // same lock atomically.
    proxy_locks: Arc<ProxyLockMap>,
    // Pending command results to push in the NEXT heartbeat. Each entry is
    // {id, action, code, output}. Drained on heartbeat send.
    pending_results: Mutex<Vec<serde_json::Value>>,
    // De-dup set: the master may send the same command id on multiple
    // heartbeats until our result reaches it. Track ids we've already run
    // this session so we don't execute twice.
    executed_command_ids: Mutex<std::collections::HashSet<String>>,
}

fn build_mtls_client(ca: &str, cert: &str, key: &str) -> Result<reqwest::Client, String> {
    let mut pem = String::with_capacity(cert.len() + key.len() + 2);
    pem.push_str(cert);
    if !cert.ends_with('\n') { pem.push('\n'); }
    pem.push_str(key);
    let identity = reqwest::Identity::from_pem(pem.as_bytes()).map_err(|e| format!("identity: {e}"))?;
    let root = reqwest::Certificate::from_pem(ca.as_bytes()).map_err(|e| format!("root cert: {e}"))?;
    reqwest::Client::builder()
        .use_rustls_tls()
        .tls_built_in_root_certs(false)
        .add_root_certificate(root)
        .identity(identity)
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|e| format!("client build: {e}"))
}

// ──────────────────────────── network detection ─────────────────────────────

fn detect_network() -> NetworkReport {
    // PROXYHUB_IPV6_PREFIX_LEN lets the operator declare a wider routed prefix
    // (typically /48 from upstream BGP) — the kernel interface only ever shows
    // the on-link mask (/64 or /128 from cloud providers). Default 64 matches
    // every mainstream VPS (Vultr/Linode/Hetzner/DO route at least /64).
    let env_prefix: u8 = std::env::var("PROXYHUB_IPV6_PREFIX_LEN")
        .ok().and_then(|s| s.parse().ok()).filter(|n: &u8| *n >= 32 && *n <= 64).unwrap_or(64);
    let has_default_v6 = has_default_ipv6_route();

    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    let mut ipv6_prefixes: Vec<serde_json::Value> = Vec::new();
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if a.is_loopback() { continue; }
            let name = a.name.clone();
            match a.ip() {
                IpAddr::V4(v4) => {
                    let cidr = format!("{}/{}", v4, prefix4(&a));
                    ipv4.push(IfaceAddr { iface: name, address: v4.to_string(), cidr });
                }
                IpAddr::V6(v6) => {
                    if is_link_local_v6(&v6) || is_ula_v6(&v6) { continue; }
                    let raw = prefix6(&a);
                    // Effective routed prefix length: clamp env value down to
                    // raw if raw is already wider (smaller number = wider).
                    // - Cloud common case: raw=/128, has v6 default → /env (64)
                    // - Some VPS: raw=/64 → keep /64 unless env declares wider
                    // - Operator declares /48 + v6 working → trust them
                    let effective = if has_default_v6 {
                        env_prefix.min(raw)
                    } else { raw };
                    let cidr = format!("{}/{}", v6, effective);
                    ipv6.push(IfaceAddr { iface: name.clone(), address: v6.to_string(), cidr: cidr.clone() });
                    if effective <= 64 {
                        let prefix_str = ipv6_prefix_of(&v6, effective);
                        let already = ipv6_prefixes.iter().any(|p| {
                            p.get("prefix").and_then(|x| x.as_str()) == Some(&prefix_str)
                                && p.get("prefixLen").and_then(|x| x.as_u64()) == Some(effective as u64)
                        });
                        if !already {
                            ipv6_prefixes.push(serde_json::json!({
                                "iface": name,
                                "address": v6.to_string(),
                                "cidr": format!("{}/{}", prefix_str, effective),
                                "prefix": prefix_str,
                                "prefixLen": effective
                            }));
                        }
                    }
                }
            }
        }
    }
    NetworkReport { ipv4, ipv6, ipv6_prefixes }
}

// Parse /proc/net/ipv6_route to verify the host has an outbound IPv6 default
// route. The file format is fixed-width hex: dest(32) dest_plen(2) src(32)
// src_plen(2) nexthop(32) metric(8) refcnt(8) use(8) flags(8) iface. A
// default route is dest_addr=all-zero + dest_plen=0 with a non-link-local
// nexthop.
fn has_default_ipv6_route() -> bool {
    let content = match std::fs::read_to_string("/proc/net/ipv6_route") { Ok(s) => s, Err(_) => return false };
    for line in content.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 { continue; }
        let dest = f[0]; let plen_hex = f[1];
        if dest == "00000000000000000000000000000000" && plen_hex == "00" {
            // flags column — skip RTF_CACHE (0x01000000) entries (cache lines)
            if let Ok(flags) = u32::from_str_radix(f[8], 16) {
                if (flags & 0x0100_0000) == 0 { return true; }
            } else { return true; }
        }
    }
    false
}

// Zero out the low (128 - prefix_len) bits of an IPv6 address — returns the
// canonical network prefix string (e.g. "2001:db8::").
fn ipv6_prefix_of(addr: &Ipv6Addr, prefix_len: u8) -> String {
    let mut segs = addr.segments();
    let full = (prefix_len / 16) as usize;
    let rem = prefix_len % 16;
    if rem != 0 && full < 8 {
        let mask: u16 = !((1u16 << (16 - rem)) - 1);
        segs[full] &= mask;
    }
    for i in (full + if rem != 0 { 1 } else { 0 })..8 {
        segs[i] = 0;
    }
    Ipv6Addr::from(segs).to_string()
}
fn prefix4(a: &if_addrs::Interface) -> u8 {
    if let if_addrs::IfAddr::V4(v) = &a.addr {
        let m = v.netmask.octets();
        ((m[0] as u32) << 24 | (m[1] as u32) << 16 | (m[2] as u32) << 8 | m[3] as u32).count_ones() as u8
    } else { 32 }
}
fn prefix6(a: &if_addrs::Interface) -> u8 {
    if let if_addrs::IfAddr::V6(v) = &a.addr {
        v.netmask.octets().iter().map(|b| b.count_ones() as u8).sum()
    } else { 128 }
}
fn is_link_local_v6(ip: &Ipv6Addr) -> bool { (ip.segments()[0] & 0xffc0) == 0xfe80 }
fn is_ula_v6(ip: &Ipv6Addr) -> bool { (ip.segments()[0] & 0xfe00) == 0xfc00 }

// Cache the egress interface name. We detect it once (first global-scope v6
// address holder) and reuse — the NIC name doesn't change across the
// agent's lifetime, and getifaddrs is expensive at high /128 counts.
static EGRESS_IFACE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn egress_iface() -> Option<String> {
    {
        let g = EGRESS_IFACE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(n) = g.as_ref() { return Some(n.clone()); }
    }
    let mut found: Option<String> = None;
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in &addrs {
            if let IpAddr::V6(x) = a.ip() {
                if !x.is_loopback() && !is_link_local_v6(&x) && !is_ula_v6(&x) { found = Some(a.name.clone()); break; }
            }
        }
    }
    if let Some(ref n) = found {
        let mut g = EGRESS_IFACE.lock().unwrap_or_else(|p| p.into_inner());
        *g = Some(n.clone());
    }
    found
}

// Attach an IPv6 address to the egress interface so we can source from it.
// Requires CAP_NET_ADMIN (systemd unit runs as root). No-op if already present.
// Uses cached iface name — no getifaddrs scan on the hot path.
fn ensure_v6_on_iface(ip: IpAddr) {
    let v6 = match ip { IpAddr::V6(x) => x, _ => return };
    let Some(name) = egress_iface() else { return };
    let target = format!("{}/128", v6);
    match std::process::Command::new("ip")
        .args(["-6", "addr", "add", &target, "dev", &name])
        .output()
    {
        Ok(o) if o.status.success() => { eprintln!("[net] added {target} on {name}"); }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            if !stderr.contains("File exists") {
                eprintln!("[net] add {target}: {}", stderr.trim());
                // File-exists is benign (already attached) — anything else means
                // the v6 won't be reachable for outbound and traffic from this
                // bindIp will silently dead-letter. Surface so admin sees.
                report_err("error", "v6:attach-fail", format!("ip addr add {target} dev {name}: {}", stderr.trim()), serde_json::json!({"target": target, "iface": name}), None);
            }
        }
        Err(e) => {
            eprintln!("[net] add {target}: spawn failed: {e}");
            report_err("error", "v6:attach-spawn", format!("spawn ip addr add: {e}"), serde_json::json!({"target": target, "iface": name}), None);
        }
    }
}

// ── v6 attach/cleanup tracking ──────────────────────────────────────────────
// Per-proxy "last attached bind IP" so we can remove the old /128 from the
// interface when master rotates the proxy to a new IP. Without this the
// interface accumulates stale /128 addresses forever — each one slows down
// `if_addrs::get_if_addrs()` (netlink dump), and at thousands of stale
// entries a single connection's bind path can take >20 s and saturate CPU
// on tokio workers in `recvmsg`.
static LAST_BIND_PER_PROXY: std::sync::Mutex<Option<HashMap<String, Ipv6Addr>>> =
    std::sync::Mutex::new(None);

// Short-TTL cache of the v6 egress pool (Vec<Ipv6Addr>). `connect_upstream`
// for rotating proxies asks for this on every connection — without the
// cache, each call does a fresh netlink getifaddrs dump (O(N) on number of
// /128 addresses on the NIC), which becomes the dominant cost at scale.
struct V6PoolCache { pool: Vec<Ipv6Addr>, expires: std::time::Instant }
static V6_POOL_CACHE: std::sync::Mutex<Option<V6PoolCache>> = std::sync::Mutex::new(None);
const V6_POOL_TTL: Duration = Duration::from_secs(5);

fn cached_v6_pool() -> Vec<Ipv6Addr> {
    {
        let g = V6_POOL_CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(c) = g.as_ref() {
            if c.expires > std::time::Instant::now() { return c.pool.clone(); }
        }
    }
    let mut pool: Vec<Ipv6Addr> = Vec::new();
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if a.is_loopback() { continue; }
            if let IpAddr::V6(v6) = a.ip() {
                if !is_link_local_v6(&v6) && !is_ula_v6(&v6) { pool.push(v6); }
            }
        }
    }
    let mut g = V6_POOL_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    *g = Some(V6PoolCache { pool: pool.clone(), expires: std::time::Instant::now() + V6_POOL_TTL });
    pool
}

fn invalidate_v6_pool_cache() {
    let mut g = V6_POOL_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    *g = None;
}

fn remember_v6_for_proxy(proxy_id: &str, new_v6: Ipv6Addr) -> Option<Ipv6Addr> {
    let mut g = LAST_BIND_PER_PROXY.lock().unwrap_or_else(|p| p.into_inner());
    if g.is_none() { *g = Some(HashMap::new()); }
    let map = g.as_mut().unwrap();
    let prev = map.insert(proxy_id.to_string(), new_v6);
    match prev {
        Some(old) if old != new_v6 => Some(old),
        _ => None,
    }
}

// Attach the new IPv6 for a given proxy. Updates the per-proxy "last bind"
// map; the old IP (if any) is cleaned up by the periodic reaper task rather
// than scheduled inline — at high proxy counts inline scheduling produces
// a thundering herd of `ip addr del` spawns that crushes the host. The
// reaper batches deletions and respects the active set, so an IP that
// rotated away but is reused by another proxy stays safe.
async fn attach_v6_for_proxy(proxy_id: &str, ip: IpAddr) {
    let v6 = match ip { IpAddr::V6(x) => x, _ => return };
    remember_v6_for_proxy(proxy_id, v6);
    tokio::task::spawn_blocking(move || { ensure_v6_on_iface(IpAddr::V6(v6)); invalidate_v6_pool_cache(); }).await.ok();
}

// Periodic reaper — every 60 s, compare the v6 addresses on the egress NIC
// against the set actually in use by live proxies (the union of
// LAST_BIND_PER_PROXY values) and delete anything else. Throttled so a
// large backlog doesn't crush the host. Skips link-local, ULA, loopback,
// and the canonical SLAAC-/cloud-provider-assigned addresses (those have
// finite preferred_lft; we only touch our "/128 forever" entries).
fn reap_stale_v6(active: std::collections::HashSet<Ipv6Addr>, max_per_cycle: usize) {
    let Ok(addrs) = if_addrs::get_if_addrs() else { return };
    let mut iface: Option<String> = None;
    let mut on_iface: Vec<Ipv6Addr> = Vec::new();
    for a in &addrs {
        if let IpAddr::V6(v6) = a.ip() {
            if v6.is_loopback() || is_link_local_v6(&v6) || is_ula_v6(&v6) { continue; }
            if iface.is_none() { iface = Some(a.name.clone()); }
            on_iface.push(v6);
        }
    }
    let Some(name) = iface else { return };
    // Keep at least one — protect against accidentally dropping the last v6.
    if on_iface.len() <= 1 { return; }
    let mut stale: Vec<Ipv6Addr> = on_iface.into_iter().filter(|v| !active.contains(v)).collect();
    if stale.is_empty() { return; }
    let total = stale.len();
    if stale.len() > max_per_cycle { stale.truncate(max_per_cycle); }
    eprintln!("[v6-reaper] reaping {}/{} stale /128 (active={})", stale.len(), total, active.len());
    for v6 in stale {
        let target = format!("{}/128", v6);
        let _ = std::process::Command::new("ip")
            .args(["-6", "addr", "del", &target, "dev", &name])
            .output();
    }
}

// ──────────────────────────── SSRF block ────────────────────────────────────

fn is_blocked_v4(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 0 || o[0] == 10 || o[0] == 127
        || (o[0] == 169 && o[1] == 254)
        || (o[0] == 172 && (o[1] & 0xf0) == 16)
        || (o[0] == 192 && o[1] == 168)
        || (o[0] == 192 && o[1] == 0)
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19 || o[1] == 51))
        || (o[0] == 203 && o[1] == 0 && o[2] == 113)
        || (o[0] == 100 && (o[1] & 0xc0) == 64)
        || o[0] >= 224
}
fn is_blocked_v6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() { return true; }
    if is_link_local_v6(ip) || is_ula_v6(ip) { return true; }
    if let Some(v4) = ip.to_ipv4_mapped() { return is_blocked_v4(&v4); }
    let s = ip.segments()[0];
    (s & 0xff00) == 0xff00 // multicast
}
fn is_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => is_blocked_v4(&v),
        IpAddr::V6(v) => is_blocked_v6(&v),
    }
}

// ──────────────────────────── DNS / target resolve ──────────────────────────

async fn resolve_target(host: &str, port: u16, family_v6: bool, allow_private: bool) -> Result<SocketAddr, String> {
    // Direct IP literal?
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !match_family(&ip, family_v6) {
            return Err(format!("target {host} is not IPv{}", if family_v6 { 6 } else { 4 }));
        }
        if !allow_private && is_blocked(ip) { return Err(format!("blocked target {host}")); }
        return Ok(SocketAddr::new(ip, port));
    }
    // DNS cache: skip OS resolver on hot targets (most scraping workloads hit a
    // handful of domains repeatedly — ~10-50 ms saved per re-lookup).
    let resolved = cached_lookup_host(host, port).await
        .map_err(|e| format!("dns lookup failed for {host}: {e}"))?;
    let mut filtered: Vec<SocketAddr> = resolved.into_iter().filter(|sa| match_family(&sa.ip(), family_v6)).collect();
    if filtered.is_empty() {
        return Err(format!("no IPv{} address for {host}", if family_v6 { 6 } else { 4 }));
    }
    if !allow_private {
        for sa in &filtered {
            if is_blocked(sa.ip()) { return Err(format!("blocked target {host} -> {}", sa.ip())); }
        }
    }
    Ok(filtered.remove(0))
}
fn match_family(ip: &IpAddr, want_v6: bool) -> bool {
    match ip { IpAddr::V4(_) => !want_v6, IpAddr::V6(_) => want_v6 }
}

async fn connect_upstream(proxy: &ProxyCfg, host: &str, port: u16, allow_private: bool) -> Result<TcpStream, String> {
    let family_v6 = proxy.kind.eq_ignore_ascii_case("IPv6");
    let target = resolve_target(host, port, family_v6, allow_private).await?;
    // Use the proxy's OWN configured bind IP. Even for rotating proxies the
    // egress IP is "owned" by that proxy — master pushes a new bindIp on
    // its rotation schedule (every `rotateEverySec`), the agent's
    // reconcile attaches it via `attach_v6_for_proxy` and restarts the
    // listener; from then on this proxy egresses through ONLY that IP
    // until the next master-driven rotation. Crucially we do NOT pick a
    // random IP from the shared pool — doing so would cause user A's
    // traffic to egress through user B's assigned IP, violating the
    // "1 proxy = 1 customer-owned IP" product contract.
    let bind_ip: Option<IpAddr> = proxy.bind_ip.parse().ok();

    let socket = if target.is_ipv4() { TcpSocket::new_v4() } else { TcpSocket::new_v6() }
        .map_err(|e| format!("socket: {e}"))?;
    // CRITICAL: socket buffer size MUST be set before connect() so the kernel
    // advertises proper TCP window scale in the SYN packet. Setting it after
    // connect leaves the connection capped at the default tiny window
    // (~85KB), which throttles single-stream throughput to ~1 Mbps over a
    // high-RTT path even though kernel autotune would otherwise grow it.
    let _ = socket.set_recv_buffer_size(4 * 1024 * 1024);
    let _ = socket.set_send_buffer_size(4 * 1024 * 1024);
    if let Some(ip) = bind_ip {
        if match_family(&ip, target.is_ipv6()) {
            // No per-connection getifaddrs scan here: the bind IP either came
            // from `cached_v6_pool` (already on the NIC) or from the proxy's
            // `cfg.bind_ip` which was attached at startup via
            // `attach_v6_for_proxy`. bind() below will surface any actual
            // routing issue.
            socket.bind(SocketAddr::new(ip, 0)).map_err(|e| format!("bind {ip}: {e}"))?;
        }
    }
    let stream = timeout(CONNECT_TIMEOUT, socket.connect(target))
        .await.map_err(|_| format!("connect timeout {host}:{port}"))?
        .map_err(|e| format!("connect {host}:{port}: {e}"))?;
    let _ = stream.set_nodelay(true);
    tune_socket(&stream); // QUICKACK + 4MB bufs + keepalive 30s — same fast path as client
    Ok(stream)
}

// ──────────────────────────── auth + helpers ────────────────────────────────

fn timing_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() { return false; }
    let mut r: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) { r |= x ^ y; }
    r == 0
}
fn proxy_authorized(p: &ProxyCfg, u: &str, pw: &str) -> bool {
    p.status != "expired" && timing_eq(&p.username, u) && timing_eq(&p.password, pw)
}

// Fast-path wrapper: cache positive auth for 60s on (proxyId, srcIP, user).
// Hot clients hit cache and skip the full timing-eq compare. ~200ns saved per
// connection — matters at >5k conn/s. Only positives cached to avoid locking
// out a user who fixes a typo.
fn proxy_authorized_fast(p: &ProxyCfg, u: &str, pw: &str, src_ip: IpAddr) -> bool {
    let key = format!("{}|{}|{}", p.id, src_ip, u);
    if let Some(true) = auth_cache_get(&key) { return true }
    let ok = proxy_authorized(p, u, pw);
    if ok { auth_cache_put(&key, true) }
    ok
}

// CIDR / exact-IP match against a single pattern.
fn cidr_match(pattern: &str, ip: IpAddr) -> bool {
    let (net, prefix) = match pattern.split_once('/') {
        Some((a, b)) => {
            let pl: u32 = match b.parse() { Ok(n) => n, _ => return false };
            (a, pl)
        }
        None => (pattern, if ip.is_ipv4() { 32 } else { 128 }),
    };
    match (net.parse::<IpAddr>(), ip) {
        (Ok(IpAddr::V4(n)), IpAddr::V4(i)) => {
            if prefix > 32 { return false }
            if prefix == 0 { return true }
            let mask: u32 = (!0u32) << (32 - prefix);
            (u32::from(n) & mask) == (u32::from(i) & mask)
        }
        (Ok(IpAddr::V6(n)), IpAddr::V6(i)) => {
            if prefix > 128 { return false }
            if prefix == 0 { return true }
            let nb = n.octets(); let ib = i.octets();
            let bytes = (prefix / 8) as usize;
            let bits = (prefix % 8) as usize;
            if nb[..bytes] != ib[..bytes] { return false }
            if bits == 0 { return true }
            let mask: u8 = 0xff << (8 - bits);
            (nb[bytes] & mask) == (ib[bytes] & mask)
        }
        _ => false,
    }
}

// Whitelist auth: if proxy.allowedSrcIps contains src_ip (or matching CIDR),
// the connection bypasses user/pass entirely.
fn src_ip_allowed_by_whitelist(p: &ProxyCfg, src_ip: IpAddr) -> bool {
    if p.allowed_src_ips.is_empty() { return false }
    p.allowed_src_ips.iter().any(|pat| cidr_match(pat, src_ip))
}

// ──────────────────────────── SOCKS5 ────────────────────────────────────────

async fn handle_socks5(proxy: &ProxyCfg, locks: &Arc<ProxyLockMap>, allow_private: bool, src_ip: IpAddr, src_port: u16, mut client: TcpStream, mut first: Vec<u8>, stats: &Arc<ProxyStats>)
    -> Result<(), String>
{
    let mut buf = [0u8; 2];
    if first.len() < 2 { client.read_exact(&mut buf[first.len()..]).await.map_err(|e| e.to_string())?;
        for (i, b) in first.iter().enumerate() { buf[i] = *b; }
        first.clear();
    } else { buf.copy_from_slice(&first[..2]); first.drain(..2); }
    if buf[0] != 0x05 { return Err("not SOCKS5".into()); }
    let nmethods = buf[1] as usize;
    let mut methods = vec![0u8; nmethods];
    if first.len() >= nmethods {
        methods.copy_from_slice(&first[..nmethods]); first.drain(..nmethods);
    } else {
        let have = first.len(); methods[..have].copy_from_slice(&first); first.clear();
        client.read_exact(&mut methods[have..]).await.map_err(|e| e.to_string())?;
    }
    if !methods.contains(&0x02) { let _ = client.write_all(&[0x05, 0xff]).await; return Err("no user/pass method".into()); }
    client.write_all(&[0x05, 0x02]).await.map_err(|e| e.to_string())?;

    let mut head = [0u8; 2]; client.read_exact(&mut head).await.map_err(|e| e.to_string())?;
    let ulen = head[1] as usize;
    let mut user = vec![0u8; ulen]; client.read_exact(&mut user).await.map_err(|e| e.to_string())?;
    let mut plen_buf = [0u8; 1]; client.read_exact(&mut plen_buf).await.map_err(|e| e.to_string())?;
    let plen = plen_buf[0] as usize;
    let mut pass = vec![0u8; plen]; client.read_exact(&mut pass).await.map_err(|e| e.to_string())?;
    let user_s = String::from_utf8_lossy(&user).to_string();
    let pass_s = String::from_utf8_lossy(&pass).to_string();
    let whitelist_ok = src_ip_allowed_by_whitelist(proxy, src_ip);
    if !whitelist_ok && !proxy_authorized_fast(proxy, &user_s, &pass_s, src_ip) {
        let _ = client.write_all(&[0x01, 0x01]).await; return Err("auth fail".into());
    }
    let _guard = if whitelist_ok { None } else {
        match try_acquire_session(locks, proxy, &src_ip.to_string()) {
            Some(g) => Some(g),
            None => {
                let _ = client.write_all(&[0x01, 0x01]).await;
                return Err("max 3 concurrent connections".into());
            }
        }
    };
    let kick = _guard.as_ref().map(|g| g.notify_handle());
    client.write_all(&[0x01, 0x00]).await.map_err(|e| e.to_string())?;

    let mut req = [0u8; 4]; client.read_exact(&mut req).await.map_err(|e| e.to_string())?;
    let cmd = req[1];
    // 0x01 = CONNECT (TCP), 0x03 = UDP ASSOCIATE. BIND (0x02) still unsupported.
    if cmd != 0x01 && cmd != 0x03 {
        let _ = client.write_all(&[0x05, 0x07, 0, 1, 0, 0, 0, 0, 0, 0]).await;
        return Err("unsupported SOCKS cmd".into());
    }
    let host = match req[3] {
        0x01 => { let mut b = [0u8; 4]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv4Addr::from(b).to_string() }
        0x03 => { let mut l = [0u8; 1]; client.read_exact(&mut l).await.map_err(|e| e.to_string())?;
                  let mut b = vec![0u8; l[0] as usize]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?;
                  String::from_utf8_lossy(&b).to_string() }
        0x04 => { let mut b = [0u8; 16]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv6Addr::from(b).to_string() }
        _ => return Err("bad atyp".into()),
    };
    let mut pb = [0u8; 2]; client.read_exact(&mut pb).await.map_err(|e| e.to_string())?;
    let port = u16::from_be_bytes(pb);

    if cmd == 0x03 {
        // UDP ASSOCIATE: guard drops on return → slot released automatically.
        return handle_socks5_udp(proxy, allow_private, client, stats).await;
    }

    let mut up = match connect_upstream(proxy, &host, port, allow_private).await {
        Ok(s) => s,
        Err(e) => {
            let code: u8 = if e.starts_with("blocked") { 0x02 } else { 0x05 };
            let _ = client.write_all(&[0x05, code, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(e);
        }
    };
    client.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await.map_err(|e| e.to_string())?;
    let start = now_ms();
    let traffic = if let Some(kick) = kick.as_ref() {
        tokio::select! {
            biased;
            _ = kick.notified() => Err(()),
            r = relay_bidi(&mut client, &mut up) => r.map_err(|_| ()),
        }
    } else { relay_bidi(&mut client, &mut up).await.map_err(|_| ()) };
    if let Ok((up_b, dn_b)) = traffic {
        add_traffic(stats, up_b, dn_b);
        record_connection(stats, src_ip, src_port, &host, port, up_b, dn_b, now_ms().saturating_sub(start), "socks5").await;
    }
    Ok(())
}

// SOCKS5 UDP ASSOCIATE relay. Keeps the control TCP connection open; when the
// client closes it, we tear down the UDP relay. Each datagram from the client
// carries `[rsv:2 frag:1 atyp:1 addr:* port:2 data:*]`; we strip that header,
// forward `data` to the target, then re-wrap replies in the same envelope.
async fn handle_socks5_udp(proxy: &ProxyCfg, allow_private: bool, mut client: TcpStream, stats: &Arc<ProxyStats>) -> Result<(), String> {
    use tokio::net::UdpSocket;
    let bind_local: SocketAddr = match proxy.listen_host.parse::<IpAddr>() {
        Ok(ip) => SocketAddr::new(ip, 0),
        _ => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
    };
    let relay = match UdpSocket::bind(bind_local).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            let _ = client.write_all(&[0x05, 0x01, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(format!("udp bind: {e}"));
        }
    };
    let local_addr = relay.local_addr().map_err(|e| e.to_string())?;
    // tell the client where to send its datagrams
    let mut reply = vec![0x05u8, 0x00, 0x00];
    match local_addr.ip() {
        IpAddr::V4(v4) => { reply.push(0x01); reply.extend_from_slice(&v4.octets()); }
        IpAddr::V6(v6) => { reply.push(0x04); reply.extend_from_slice(&v6.octets()); }
    }
    reply.extend_from_slice(&local_addr.port().to_be_bytes());
    client.write_all(&reply).await.map_err(|e| e.to_string())?;

    // upstream egress UDP socket (one per client) — bind to the same bindIp we use for TCP
    let egress_local: SocketAddr = match proxy.bind_ip.parse::<IpAddr>() {
        Ok(ip) => SocketAddr::new(ip, 0),
        _ => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
    };
    let egress = match UdpSocket::bind(egress_local).await {
        Ok(s) => Arc::new(s),
        Err(e) => return Err(format!("udp egress bind: {e}")),
    };

    // RFC 1928 §7: relay only stays alive while the TCP control connection
    // is open. We watch it; on close we exit.
    let client_addr = Arc::new(tokio::sync::Mutex::new(None::<SocketAddr>));
    let stats_clone = stats.clone();
    let relay_clone = relay.clone();
    let egress_clone = egress.clone();
    let client_addr_clone = client_addr.clone();
    let _allow_private = allow_private;

    // client → upstream
    let task_in = tokio::spawn(async move {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let (n, src) = match relay_clone.recv_from(&mut buf).await { Ok(p) => p, Err(_) => break };
            if n < 4 { continue; }
            // [rsv(2) frag(1) atyp(1) addr port data]
            let frag = buf[2];
            if frag != 0 { continue; } // fragmentation not supported
            let atyp = buf[3];
            let (target, body_off) = match atyp {
                0x01 => {
                    if n < 4 + 4 + 2 { continue; }
                    let ip = Ipv4Addr::new(buf[4], buf[5], buf[6], buf[7]);
                    let port = u16::from_be_bytes([buf[8], buf[9]]);
                    (SocketAddr::new(IpAddr::V4(ip), port), 10)
                }
                0x04 => {
                    if n < 4 + 16 + 2 { continue; }
                    let mut o = [0u8; 16]; o.copy_from_slice(&buf[4..20]);
                    let port = u16::from_be_bytes([buf[20], buf[21]]);
                    (SocketAddr::new(IpAddr::V6(Ipv6Addr::from(o)), port), 22)
                }
                0x03 => {
                    let dl = buf[4] as usize;
                    if n < 4 + 1 + dl + 2 { continue; }
                    let host = match std::str::from_utf8(&buf[5..5 + dl]) { Ok(h) => h.to_string(), Err(_) => continue };
                    let port = u16::from_be_bytes([buf[5 + dl], buf[5 + dl + 1]]);
                    // DNS resolve sync via tokio
                    let addrs = match tokio::net::lookup_host((host.as_str(), port)).await { Ok(a) => a, Err(_) => continue };
                    let mut chosen: Option<SocketAddr> = None;
                    for a in addrs { chosen = Some(a); break }
                    let target = match chosen { Some(t) => t, None => continue };
                    (target, 5 + dl + 2)
                }
                _ => continue,
            };
            // record client addr the first time, so replies route back
            { *client_addr_clone.lock().await = Some(src); }
            let body = &buf[body_off..n];
            let _ = egress_clone.send_to(body, target).await;
            stats_clone.upload_bytes.fetch_add(body.len() as u64, Ordering::Relaxed);
        }
    });

    // upstream → client (re-wraps each reply with the SOCKS5 UDP header)
    let stats_clone2 = stats.clone();
    let relay_clone2 = relay.clone();
    let egress_clone2 = egress.clone();
    let client_addr_clone2 = client_addr.clone();
    let task_out = tokio::spawn(async move {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let (n, src) = match egress_clone2.recv_from(&mut buf).await { Ok(p) => p, Err(_) => break };
            let dst = { *client_addr_clone2.lock().await };
            let Some(dst) = dst else { continue };
            let mut frame = Vec::with_capacity(n + 32);
            frame.extend_from_slice(&[0x00, 0x00, 0x00]); // rsv + frag
            match src.ip() {
                IpAddr::V4(v4) => { frame.push(0x01); frame.extend_from_slice(&v4.octets()); }
                IpAddr::V6(v6) => { frame.push(0x04); frame.extend_from_slice(&v6.octets()); }
            }
            frame.extend_from_slice(&src.port().to_be_bytes());
            frame.extend_from_slice(&buf[..n]);
            let _ = relay_clone2.send_to(&frame, dst).await;
            stats_clone2.download_bytes.fetch_add(n as u64, Ordering::Relaxed);
        }
    });

    // wait for the control TCP to close
    let mut throw = [0u8; 64];
    loop {
        match client.read(&mut throw).await {
            Ok(0) | Err(_) => break,
            Ok(_) => continue,
        }
    }
    task_in.abort(); task_out.abort();
    let _ = (egress, relay);
    Ok(())
}

// ──────────────────────────── HTTP proxy (CONNECT + plain HTTP) ─────────────

async fn read_http_headers(client: &mut TcpStream, initial: Vec<u8>) -> Result<(Vec<u8>, Vec<u8>), String> {
    let mut buf = initial;
    let needle = b"\r\n\r\n";
    let mut tmp = [0u8; 4096];
    loop {
        if let Some(i) = find_sub(&buf, needle) {
            let split = i + needle.len();
            let rest = buf.split_off(split);
            return Ok((buf, rest));
        }
        if buf.len() > 65_536 { return Err("header too large".into()); }
        let n = client.read(&mut tmp).await.map_err(|e| e.to_string())?;
        if n == 0 { return Err("client closed".into()); }
        buf.extend_from_slice(&tmp[..n]);
    }
}
fn find_sub(h: &[u8], n: &[u8]) -> Option<usize> { h.windows(n.len()).position(|w| w == n) }
fn parse_basic(value: &str) -> Option<(String, String)> {
    let v = value.trim();
    let lower = v.to_ascii_lowercase();
    if !lower.starts_with("basic ") { return None; }
    let b64 = &v[6..];
    let raw = base64_decode(b64.trim()).ok()?;
    let s = String::from_utf8(raw).ok()?;
    let (u, p) = s.split_once(':')?;
    Some((u.to_string(), p.to_string()))
}
fn base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    let alpha = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut t = [0u8; 256]; for (i, c) in alpha.iter().enumerate() { t[*c as usize] = i as u8; }
    t[b'=' as usize] = 0;
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 { return Err(()); }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let v = [t[chunk[0] as usize], t[chunk[1] as usize], t[chunk[2] as usize], t[chunk[3] as usize]];
        out.push((v[0] << 2) | (v[1] >> 4));
        if chunk[2] != b'=' { out.push((v[1] << 4) | (v[2] >> 2)); }
        if chunk[3] != b'=' { out.push((v[2] << 6) | v[3]); }
    }
    Ok(out)
}

async fn handle_http_proxy(proxy: &ProxyCfg, locks: &Arc<ProxyLockMap>, allow_private: bool, src_ip: IpAddr, src_port: u16, mut client: TcpStream, initial: Vec<u8>, stats: &Arc<ProxyStats>)
    -> Result<(), String>
{
    let (header_buf, leftover) = read_http_headers(&mut client, initial).await?;
    let header_text = String::from_utf8_lossy(&header_buf).to_string();
    let mut lines = header_text.split("\r\n");
    let req_line = lines.next().unwrap_or("");
    let mut parts = req_line.split_ascii_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let proto = parts.next().unwrap_or("HTTP/1.1");
    let mut auth: Option<(String, String)> = None;
    let mut clean_headers = Vec::new();
    for line in &mut lines {
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            if k.eq_ignore_ascii_case("proxy-authorization") { auth = parse_basic(v); }
            if !k.to_ascii_lowercase().starts_with("proxy-") { clean_headers.push(line.to_string()); }
        }
    }
    // Whitelist bypass: source IP on proxy.allowedSrcIps → no user/pass needed.
    let whitelisted = src_ip_allowed_by_whitelist(proxy, src_ip);
    if !whitelisted {
        let (u, p) = match auth { Some(x) => x, None => {
            let _ = client.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return Err("missing auth".into());
        }};
        if !proxy_authorized_fast(proxy, &u, &p, src_ip) {
            let _ = client.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return Err("auth fail".into());
        }
    }
    let _guard = if whitelisted { None } else {
        match try_acquire_session(locks, proxy, &src_ip.to_string()) {
            Some(g) => Some(g),
            None => {
                let _ = client.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nX-Proxy-Error: max 3 concurrent connections\r\n\r\n").await;
                return Err("max conns".into());
            }
        }
    };
    let kick = _guard.as_ref().map(|g| g.notify_handle());

    if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = split_host_port(target, 443);
        let mut up = match connect_upstream(proxy, &host, port, allow_private).await {
            Ok(s) => s,
            Err(e) => {
                let _ = client.write_all(format!("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: {e}\r\n\r\n").as_bytes()).await;
                return Err(e);
            }
        };
        client.write_all(b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: ProxyBox\r\n\r\n").await.map_err(|e| e.to_string())?;
        if !leftover.is_empty() { up.write_all(&leftover).await.map_err(|e| e.to_string())?; }
        let start = now_ms();
        let traffic = if let Some(kn) = kick.as_ref() {
            tokio::select! { biased; _ = kn.notified() => Err(()), r = relay_bidi(&mut client, &mut up) => r.map_err(|_| ()) }
        } else { relay_bidi(&mut client, &mut up).await.map_err(|_| ()) };
        if let Ok((up_b, dn_b)) = traffic {
            add_traffic(stats, up_b, dn_b);
            record_connection(stats, src_ip, src_port, &host, port, up_b, dn_b, now_ms().saturating_sub(start), "connect").await;
        }
        return Ok(());
    }
    // Plain HTTP proxy: target is an absolute URL
    let url = parse_url(target).ok_or_else(|| "bad url".to_string())?;
    let port = url.port.unwrap_or(if url.scheme == "https" { 443 } else { 80 });
    let mut up = match connect_upstream(proxy, &url.host, port, allow_private).await {
        Ok(s) => s,
        Err(e) => {
            let _ = client.write_all(format!("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: {e}\r\n\r\n").as_bytes()).await;
            return Err(e);
        }
    };
    let new_req = format!("{} {} {}\r\n{}\r\n\r\n", method, url.path_query, proto, clean_headers.join("\r\n"));
    up.write_all(new_req.as_bytes()).await.map_err(|e| e.to_string())?;
    if !leftover.is_empty() { up.write_all(&leftover).await.map_err(|e| e.to_string())?; }
    let start = now_ms();
    let target_host = url.host.clone();
    let traffic = if let Some(kn) = kick.as_ref() {
        tokio::select! { biased; _ = kn.notified() => Err(()), r = relay_bidi(&mut client, &mut up) => r.map_err(|_| ()) }
    } else { relay_bidi(&mut client, &mut up).await.map_err(|_| ()) };
    if let Ok((up_b, dn_b)) = traffic {
        add_traffic(stats, up_b, dn_b);
        record_connection(stats, src_ip, src_port, &target_host, port, up_b, dn_b, now_ms().saturating_sub(start), "http").await;
    }
    Ok(())
}
fn split_host_port(v: &str, default: u16) -> (String, u16) {
    if let Some(rest) = v.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host = &rest[..end];
            let after = &rest[end + 1..];
            let port = after.strip_prefix(':').and_then(|s| s.parse().ok()).unwrap_or(default);
            return (host.to_string(), port);
        }
    }
    match v.rfind(':') {
        Some(i) => (v[..i].to_string(), v[i + 1..].parse().unwrap_or(default)),
        None => (v.to_string(), default),
    }
}
struct ParsedUrl { scheme: String, host: String, port: Option<u16>, path_query: String }
fn parse_url(u: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = u.split_once("://")?;
    let (auth, path) = rest.split_once('/').map(|(a, p)| (a, format!("/{p}"))).unwrap_or((rest, "/".to_string()));
    let (host, port) = split_host_port(auth, 0);
    let port = if port == 0 { None } else { Some(port) };
    Some(ParsedUrl { scheme: scheme.to_string(), host, port, path_query: path })
}

// ──────────────────────────── listener loop ─────────────────────────────────

async fn handle_client(proxy: ProxyCfg, locks: Arc<ProxyLockMap>, allow_private: bool, mut client: TcpStream, stats: Arc<ProxyStats>) {
    // Latency optimization stack (lessons from WireGuard + Fortinet + Shadowrocket):
    //   1. TCP_NODELAY: ship small packets immediately, no Nagle batching.
    //   2. TCP_QUICKACK: ACK immediately instead of delayed-ACK piggyback — saves ~40ms per RTT for proxy-like workloads.
    //   3. SO_RCVBUF/SNDBUF: 4 MB so long-RTT high-BDP flows can ramp the cwnd.
    //   4. SO_KEEPALIVE: detect half-closed conns (NAT timeout, peer crash) in ~30 s vs default 2 h.
    let _ = client.set_nodelay(true);
    tune_socket(&client);
    // Per-proxy connection cap
    if proxy.max_connections > 0 && stats.active_connections.load(Ordering::Relaxed) >= proxy.max_connections {
        return; // silently drop — saturated proxy
    }
    // Per-source-IP cap (anti-abuse): refuse if this src has too many open conns to this proxy.
    let peer = client.peer_addr().ok();
    let src_ip: IpAddr = peer.map(|a| a.ip()).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let src_port: u16 = peer.map(|a| a.port()).unwrap_or(0);
    let _src_guard = if proxy.per_src_max > 0 {
        let mut m = stats.per_src.lock().await;
        let count = m.entry(src_ip).or_insert(0);
        if *count >= proxy.per_src_max { return; }
        *count += 1;
        Some(PerSrcGuard { stats: stats.clone(), ip: src_ip })
    } else { None };
    // Monthly quota cap
    if proxy.monthly_quota_bytes > 0 {
        let (y, m) = current_year_month();
        let mk = (y as u32) * 100 + m;
        if stats.month_key.load(Ordering::Relaxed) == mk
            && stats.month_bytes.load(Ordering::Relaxed) >= proxy.monthly_quota_bytes {
            return;
        }
    }
    stats.total_connections.fetch_add(1, Ordering::Relaxed);
    stats.active_connections.fetch_add(1, Ordering::Relaxed);
    let _guard = ActiveGuard(stats.clone());
    let mut peek = [0u8; 1];
    let n = match timeout(CLIENT_TIMEOUT, client.read(&mut peek)).await {
        Ok(Ok(n)) => n, _ => { return; }
    };
    if n == 0 { return; }
    let initial = vec![peek[0]];
    let result = if peek[0] == 0x05 {
        handle_socks5(&proxy, &locks, allow_private, src_ip, src_port, client, initial, &stats).await
    } else {
        handle_http_proxy(&proxy, &locks, allow_private, src_ip, src_port, client, initial, &stats).await
    };
    if let Err(e) = result { let _ = e; /* keep quiet — client errors are routine */ }
}

// ──────────────────────────── unified listener ──────────────────────────────
// Single accept port routing N proxies by username (parsed from
// Proxy-Authorization). The scaling primitive that lets one node host
// 100k+ proxies: no per-proxy port + listener + 8-FD set, just one
// SO_REUSEPORT worker pool sharing the entire population.
//
// Current: HTTP CONNECT / plain HTTP only. SOCKS5 + Trojan-via-unified can
// follow with the same pattern — peek protocol, do enough handshake to
// extract a username, look up cfg, splice into existing handlers.

// Read until \r\n\r\n with a hard cap so a malicious client can't keep us
// blocked. Returns the full read buffer (caller passes the whole thing to
// handle_http_proxy as `initial` — that function will split headers vs
// leftover itself).
async fn read_http_until_headers_with_initial(client: &mut TcpStream, initial: &mut Vec<u8>) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = std::mem::take(initial);
    if buf.capacity() < 1024 { buf.reserve(1024 - buf.capacity()); }
    let mut tmp = [0u8; 4096];
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if find_sub(&buf, b"\r\n\r\n").is_some() { return Ok(buf); }
        if buf.len() > 65_536 { return Err("header too large".into()); }
        let now = std::time::Instant::now();
        if now >= deadline { return Err("header read timeout".into()); }
        let rem = deadline - now;
        let n = timeout(rem, client.read(&mut tmp)).await
            .map_err(|_| "header read timeout".to_string())?
            .map_err(|e| e.to_string())?;
        if n == 0 { return Err("client closed before headers".into()); }
        buf.extend_from_slice(&tmp[..n]);
    }
}

// Extract Proxy-Authorization username/password from a buffer that ends
// with \r\n\r\n. Returns None if no Basic auth header found.
fn extract_proxy_user_pass(buf: &[u8]) -> Option<(String, String)> {
    let head = std::str::from_utf8(buf).ok()?;
    for line in head.split("\r\n") {
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("proxy-authorization") {
                return parse_basic(v);
            }
        }
    }
    None
}

async fn handle_unified_plain(
    user_index: Arc<UserIndex>,
    locks: Arc<ProxyLockMap>,
    allow_private: bool,
    mut client: TcpStream,
) {
    let _ = client.set_nodelay(true);
    tune_socket(&client);
    let peer = client.peer_addr().ok();
    let src_ip: IpAddr = peer.map(|a| a.ip()).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let src_port: u16 = peer.map(|a| a.port()).unwrap_or(0);

    // Peek the first byte to dispatch protocol. 0x05 = SOCKS5 (binary
    // greeting); anything else = HTTP CONNECT / GET / etc.
    let mut peek = [0u8; 1];
    let n = match timeout(CLIENT_TIMEOUT, client.read(&mut peek)).await {
        Ok(Ok(n)) => n, _ => return,
    };
    if n == 0 { return; }
    if peek[0] == 0x05 {
        let _ = handle_unified_socks5(user_index, locks, allow_private, client, src_ip, src_port, vec![peek[0]]).await;
        return;
    }
    // HTTP path: keep reading until we have the full request headers,
    // then parse Proxy-Authorization to identify the user.
    let mut initial = vec![peek[0]];
    let buf = match read_http_until_headers_with_initial(&mut client, &mut initial).await {
        Ok(b) => b,
        Err(_) => return,
    };
    let (user, pass) = match extract_proxy_user_pass(&buf) {
        Some(x) => x,
        None => {
            let _ = client.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return;
        }
    };
    let lookup = {
        let g = user_index.read().unwrap_or_else(|p| p.into_inner());
        g.get(&user).map(|v| (v.0.clone(), v.1.clone()))
    };
    let (cfg_arc, stats_arc) = match lookup {
        Some(v) => v,
        None => {
            let _ = client.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\nX-Proxy-Error: unknown user\r\n\r\n").await;
            return;
        }
    };
    // Per-proxy connection cap (same as per-port handle_client path)
    if cfg_arc.max_connections > 0 && stats_arc.active_connections.load(Ordering::Relaxed) >= cfg_arc.max_connections {
        return;
    }
    stats_arc.total_connections.fetch_add(1, Ordering::Relaxed);
    stats_arc.active_connections.fetch_add(1, Ordering::Relaxed);
    let _guard = ActiveGuard(stats_arc.clone());
    let _ = pass; // handle_http_proxy re-parses + verifies; pass is here only to fail fast on missing-header
    let _ = handle_http_proxy(&cfg_arc, &locks, allow_private, src_ip, src_port, client, buf, &stats_arc).await;
}

// SOCKS5 over the unified port. Same wire format as per-proxy SOCKS5, but
// the username from the user/pass sub-negotiation picks which ProxyCfg
// services the request. Mirrors handle_socks5 exactly after lookup so any
// future change there must be mirrored here.
async fn handle_unified_socks5(
    user_index: Arc<UserIndex>,
    locks: Arc<ProxyLockMap>,
    allow_private: bool,
    mut client: TcpStream,
    src_ip: IpAddr,
    src_port: u16,
    first: Vec<u8>,
) -> Result<(), String> {
    let mut buf = [0u8; 2];
    let mut first = first;
    if first.len() < 2 {
        client.read_exact(&mut buf[first.len()..]).await.map_err(|e| e.to_string())?;
        for (i, b) in first.iter().enumerate() { buf[i] = *b; }
        first.clear();
    } else { buf.copy_from_slice(&first[..2]); first.drain(..2); }
    if buf[0] != 0x05 { return Err("not SOCKS5".into()); }
    let nmethods = buf[1] as usize;
    let mut methods = vec![0u8; nmethods];
    if first.len() >= nmethods {
        methods.copy_from_slice(&first[..nmethods]); first.drain(..nmethods);
    } else {
        let have = first.len(); methods[..have].copy_from_slice(&first); first.clear();
        client.read_exact(&mut methods[have..]).await.map_err(|e| e.to_string())?;
    }
    if !methods.contains(&0x02) {
        let _ = client.write_all(&[0x05, 0xff]).await; return Err("no user/pass method".into());
    }
    client.write_all(&[0x05, 0x02]).await.map_err(|e| e.to_string())?;
    let mut head = [0u8; 2]; client.read_exact(&mut head).await.map_err(|e| e.to_string())?;
    let ulen = head[1] as usize;
    let mut user = vec![0u8; ulen]; client.read_exact(&mut user).await.map_err(|e| e.to_string())?;
    let mut plen_buf = [0u8; 1]; client.read_exact(&mut plen_buf).await.map_err(|e| e.to_string())?;
    let plen = plen_buf[0] as usize;
    let mut pass = vec![0u8; plen]; client.read_exact(&mut pass).await.map_err(|e| e.to_string())?;
    let user_s = String::from_utf8_lossy(&user).to_string();
    let pass_s = String::from_utf8_lossy(&pass).to_string();
    let lookup = {
        let g = user_index.read().unwrap_or_else(|p| p.into_inner());
        g.get(&user_s).map(|v| (v.0.clone(), v.1.clone()))
    };
    let (cfg, stats) = match lookup {
        Some(v) => v,
        None => { let _ = client.write_all(&[0x01, 0x01]).await; return Err("unknown user".into()); }
    };
    let whitelist_ok = src_ip_allowed_by_whitelist(&cfg, src_ip);
    if !whitelist_ok && !proxy_authorized_fast(&cfg, &user_s, &pass_s, src_ip) {
        let _ = client.write_all(&[0x01, 0x01]).await; return Err("auth fail".into());
    }
    if cfg.max_connections > 0 && stats.active_connections.load(Ordering::Relaxed) >= cfg.max_connections {
        let _ = client.write_all(&[0x01, 0x01]).await; return Err("max connections".into());
    }
    stats.total_connections.fetch_add(1, Ordering::Relaxed);
    stats.active_connections.fetch_add(1, Ordering::Relaxed);
    let _active = ActiveGuard(stats.clone());
    let _guard = if whitelist_ok { None } else {
        match try_acquire_session(&locks, &cfg, &src_ip.to_string()) {
            Some(g) => Some(g),
            None => { let _ = client.write_all(&[0x01, 0x01]).await; return Err("max 3 concurrent connections".into()); }
        }
    };
    let kick = _guard.as_ref().map(|g| g.notify_handle());
    client.write_all(&[0x01, 0x00]).await.map_err(|e| e.to_string())?;
    let mut req = [0u8; 4]; client.read_exact(&mut req).await.map_err(|e| e.to_string())?;
    let cmd = req[1];
    if cmd != 0x01 && cmd != 0x03 {
        let _ = client.write_all(&[0x05, 0x07, 0, 1, 0, 0, 0, 0, 0, 0]).await;
        return Err("unsupported SOCKS cmd".into());
    }
    let host = match req[3] {
        0x01 => { let mut b = [0u8; 4]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv4Addr::from(b).to_string() }
        0x03 => { let mut l = [0u8; 1]; client.read_exact(&mut l).await.map_err(|e| e.to_string())?;
                  let mut b = vec![0u8; l[0] as usize]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?;
                  String::from_utf8_lossy(&b).to_string() }
        0x04 => { let mut b = [0u8; 16]; client.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv6Addr::from(b).to_string() }
        _ => return Err("bad atyp".into()),
    };
    let mut pb = [0u8; 2]; client.read_exact(&mut pb).await.map_err(|e| e.to_string())?;
    let port = u16::from_be_bytes(pb);
    if cmd == 0x03 {
        return handle_socks5_udp(&cfg, allow_private, client, &stats).await;
    }
    let mut up = match connect_upstream(&cfg, &host, port, allow_private).await {
        Ok(s) => s,
        Err(e) => {
            let code: u8 = if e.starts_with("blocked") { 0x02 } else { 0x05 };
            let _ = client.write_all(&[0x05, code, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(e);
        }
    };
    client.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await.map_err(|e| e.to_string())?;
    let start = now_ms();
    let traffic = if let Some(kick) = kick.as_ref() {
        tokio::select! { biased; _ = kick.notified() => Err(()), r = relay_bidi(&mut client, &mut up) => r.map_err(|_| ()) }
    } else { relay_bidi(&mut client, &mut up).await.map_err(|_| ()) };
    if let Ok((up_b, dn_b)) = traffic {
        add_traffic(&stats, up_b, dn_b);
        record_connection(&stats, src_ip, src_port, &host, port, up_b, dn_b, now_ms().saturating_sub(start), "socks5").await;
    }
    Ok(())
}

async fn serve_unified_plain(
    port: u16,
    workers: usize,
    user_index: Arc<UserIndex>,
    locks: Arc<ProxyLockMap>,
    allow_private: bool,
) {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
    let mut listeners: Vec<TcpListener> = Vec::with_capacity(workers);
    for i in 0..workers {
        let sock = match TcpSocket::new_v4() {
            Ok(s) => s,
            Err(e) => { eprintln!("[unified] socket: {e}"); return; }
        };
        let _ = sock.set_reuseaddr(true);
        #[cfg(unix)] let _ = sock.set_reuseport(true);
        let _ = sock.set_recv_buffer_size(4 * 1024 * 1024);
        let _ = sock.set_send_buffer_size(4 * 1024 * 1024);
        if let Err(e) = sock.bind(addr) {
            let em = e.to_string();
            if i == 0 {
                eprintln!("[unified] bind {addr}: {em}");
                report_err("error", "unified:bind-fail", format!("unified bind {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), None);
                return;
            }
            break;
        }
        let lst = match sock.listen(4096) {
            Ok(l) => l,
            Err(e) => {
                let em = e.to_string();
                eprintln!("[unified] listen {addr}: {em}");
                report_err("error", "unified:listen-fail", format!("unified listen {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), None);
                return;
            }
        };
        listeners.push(lst);
    }
    eprintln!("[unified] {addr} ({} workers) — username routing", listeners.len());
    for lst in listeners {
        let ui = user_index.clone();
        let lk = locks.clone();
        tokio::spawn(async move {
            loop {
                let (stream, _peer) = match lst.accept().await { Ok(x) => x, Err(_) => continue };
                let ui2 = ui.clone();
                let lk2 = lk.clone();
                tokio::spawn(async move {
                    handle_unified_plain(ui2, lk2, allow_private, stream).await;
                });
            }
        });
    }
}

// TLS-wrapped unified listener — Trojan + HTTPS-proxy on one port. After
// the TLS handshake we read 56 bytes; if they match a SHA224(password) in
// the trojan_index it's a Trojan client; otherwise treat the bytes as the
// start of an HTTP request and parse Proxy-Authorization against
// user_index. Same scaling primitive as the plain unified port — N
// proxies share one TLS listener.
async fn handle_unified_tls_dispatched(
    user_index: Arc<UserIndex>,
    trojan_index: Arc<TrojanIndex>,
    locks: Arc<ProxyLockMap>,
    allow_private: bool,
    mut tls: tokio_rustls::server::TlsStream<TcpStream>,
) {
    let src_ip = tls.get_ref().0.peer_addr().map(|a| a.ip()).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let src_port = tls.get_ref().0.peer_addr().map(|a| a.port()).unwrap_or(0);
    // Read 56 bytes (matches the per-proxy TLS path).
    let mut peek = [0u8; 56];
    let mut got = 0usize;
    while got < 56 {
        let n = match timeout(CLIENT_TIMEOUT, tls.read(&mut peek[got..])).await {
            Ok(Ok(n)) if n > 0 => n, _ => return,
        };
        got += n;
    }
    let hex_candidate = std::str::from_utf8(&peek).ok().map(|s| s.to_string());
    let trojan_lookup = if let Some(ref h) = hex_candidate {
        let g = trojan_index.read().unwrap_or_else(|p| p.into_inner());
        g.get(h).cloned()
    } else { None };
    if let Some((cfg, stats)) = trojan_lookup {
        if cfg.max_connections > 0 && stats.active_connections.load(Ordering::Relaxed) >= cfg.max_connections { return; }
        stats.total_connections.fetch_add(1, Ordering::Relaxed);
        stats.active_connections.fetch_add(1, Ordering::Relaxed);
        let _g = ActiveGuard(stats.clone());
        let whitelisted = src_ip_allowed_by_whitelist(&cfg, src_ip);
        let guard = if whitelisted { None } else {
            match try_acquire_session(&locks, &cfg, &src_ip.to_string()) { Some(g) => Some(g), None => return }
        };
        let kick = guard.as_ref().map(|g| g.notify_handle());
        let _ = handle_trojan_after_auth(&cfg, allow_private, &mut tls, src_ip, src_port, kick, &stats).await;
        drop(guard);
        return;
    }
    // Not Trojan — treat the 56 bytes as the start of an HTTP request.
    // Read until headers complete, parse Proxy-Authorization, lookup.
    let mut initial = peek.to_vec();
    let buf = match read_http_until_headers_tls(&mut tls, &mut initial).await {
        Ok(b) => b,
        Err(_) => return,
    };
    let (user, _pass) = match extract_proxy_user_pass(&buf) {
        Some(x) => x,
        None => {
            let _ = tls.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return;
        }
    };
    let lookup = {
        let g = user_index.read().unwrap_or_else(|p| p.into_inner());
        g.get(&user).cloned()
    };
    let (cfg, stats) = match lookup {
        Some(v) => v,
        None => {
            let _ = tls.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\nX-Proxy-Error: unknown user\r\n\r\n").await;
            return;
        }
    };
    if cfg.max_connections > 0 && stats.active_connections.load(Ordering::Relaxed) >= cfg.max_connections { return; }
    stats.total_connections.fetch_add(1, Ordering::Relaxed);
    stats.active_connections.fetch_add(1, Ordering::Relaxed);
    let _g = ActiveGuard(stats.clone());
    let _ = handle_http_proxy_on_tls(&cfg, &locks, allow_private, &mut tls, src_ip, src_port, buf, &stats).await;
}

async fn read_http_until_headers_tls(
    tls: &mut tokio_rustls::server::TlsStream<TcpStream>,
    initial: &mut Vec<u8>,
) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = std::mem::take(initial);
    let mut tmp = [0u8; 4096];
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if find_sub(&buf, b"\r\n\r\n").is_some() { return Ok(buf); }
        if buf.len() > 65_536 { return Err("header too large".into()); }
        let now = std::time::Instant::now();
        if now >= deadline { return Err("header read timeout".into()); }
        let rem = deadline - now;
        let n = timeout(rem, tls.read(&mut tmp)).await
            .map_err(|_| "header read timeout".to_string())?
            .map_err(|e| e.to_string())?;
        if n == 0 { return Err("client closed before headers".into()); }
        buf.extend_from_slice(&tmp[..n]);
    }
}

async fn serve_unified_tls(
    port: u16,
    workers: usize,
    acceptor: TlsAcceptor,
    user_index: Arc<UserIndex>,
    trojan_index: Arc<TrojanIndex>,
    locks: Arc<ProxyLockMap>,
    allow_private: bool,
) {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
    let mut listeners: Vec<TcpListener> = Vec::with_capacity(workers);
    for i in 0..workers {
        let sock = match TcpSocket::new_v4() {
            Ok(s) => s, Err(e) => { eprintln!("[unified-tls] socket: {e}"); return; }
        };
        let _ = sock.set_reuseaddr(true);
        #[cfg(unix)] let _ = sock.set_reuseport(true);
        let _ = sock.set_recv_buffer_size(4 * 1024 * 1024);
        let _ = sock.set_send_buffer_size(4 * 1024 * 1024);
        if let Err(e) = sock.bind(addr) {
            let em = e.to_string();
            if i == 0 {
                eprintln!("[unified-tls] bind {addr}: {em}");
                report_err("error", "unified-tls:bind-fail", format!("unified-tls bind {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), None);
                return;
            }
            break;
        }
        let lst = match sock.listen(4096) {
            Ok(l) => l, Err(e) => {
                let em = e.to_string();
                eprintln!("[unified-tls] listen {addr}: {em}");
                report_err("error", "unified-tls:listen-fail", format!("unified-tls listen {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), None);
                return;
            }
        };
        listeners.push(lst);
    }
    eprintln!("[unified-tls] {addr} ({} workers) — Trojan + HTTPS-proxy", listeners.len());
    for lst in listeners {
        let ui = user_index.clone();
        let ti = trojan_index.clone();
        let lk = locks.clone();
        let acc = acceptor.clone();
        tokio::spawn(async move {
            loop {
                let (stream, _peer) = match lst.accept().await { Ok(x) => x, Err(_) => continue };
                let _ = stream.set_nodelay(true);
                tune_socket(&stream);
                let ui2 = ui.clone(); let ti2 = ti.clone(); let lk2 = lk.clone(); let acc2 = acc.clone();
                tokio::spawn(async move {
                    let tls = match acc2.accept(stream).await { Ok(t) => t, Err(_) => return };
                    handle_unified_tls_dispatched(ui2, ti2, lk2, allow_private, tls).await;
                });
            }
        });
    }
}

async fn serve_proxy(cfg: ProxyCfg, locks: Arc<ProxyLockMap>, allow_private: bool, stop: tokio::sync::watch::Receiver<bool>, stats: Arc<ProxyStats>) {
    let host: IpAddr = cfg.listen_host.parse().unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let addr = SocketAddr::new(host, cfg.port);
    // For IPv6 proxies the bindIp the master assigns is a random address from
    // our /48 prefix — only the prefix is routed to us, individual addresses
    // need an explicit `ip -6 addr add` before we can source from them. This
    // is the IPv6 rotation primitive: master picks a new address, agent
    // attaches it to the interface, customer hits the same v4 listener but
    // egress IP changes.
    if cfg.kind.eq_ignore_ascii_case("IPv6") {
        if let Ok(bind) = cfg.bind_ip.parse::<IpAddr>() {
            attach_v6_for_proxy(&cfg.id, bind).await;
        }
    }
    // SO_REUSEPORT lets the kernel load-balance accept() across N listener sockets.
    // We spawn one listener per worker (num_cpus, capped at 8) and one accept loop each.
    let workers = num_cpus_capped(8);
    let mut listeners: Vec<TcpListener> = Vec::with_capacity(workers);
    for i in 0..workers {
        let sock = match if addr.is_ipv4() { TcpSocket::new_v4() } else { TcpSocket::new_v6() } {
            Ok(s) => s,
            Err(e) => {
                let em = e.to_string();
                eprintln!("[proxy:{}] socket: {em}", cfg.id);
                report_err("error", "listener:socket", format!("socket() failed for {addr}: {em}"), serde_json::json!({"addr": addr.to_string(), "worker": i}), Some(cfg.id.clone()));
                return;
            }
        };
        let _ = sock.set_reuseaddr(true);
        // SO_REUSEPORT is Linux/BSD-only; Windows socket2 doesn't expose it.
        #[cfg(unix)] let _ = sock.set_reuseport(true);
        // Set buffer sizes BEFORE listen so accepted sockets advertise proper
        // window scale in their SYN-ACK (matches connect_upstream).
        let _ = sock.set_recv_buffer_size(4 * 1024 * 1024);
        let _ = sock.set_send_buffer_size(4 * 1024 * 1024);
        if let Err(e) = sock.bind(addr) {
            let em = e.to_string();
            if i == 0 {
                eprintln!("[proxy:{}] bind {addr}: {em}", cfg.id);
                report_err("error", "listener:bind-fail", format!("bind {addr}: {em}"), serde_json::json!({"addr": addr.to_string(), "kind": cfg.kind}), Some(cfg.id.clone()));
                return;
            }
            break;
        }
        let lst = match sock.listen(1024) {
            Ok(l) => l,
            Err(e) => {
                let em = e.to_string();
                eprintln!("[proxy:{}] listen {addr}: {em}", cfg.id);
                report_err("error", "listener:listen-fail", format!("listen {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), Some(cfg.id.clone()));
                return;
            }
        };
        listeners.push(lst);
    }
    eprintln!("[proxy:{}] {addr} -> {} ({} listener workers)", cfg.id, cfg.bind_ip, listeners.len());
    let cfg_arc = Arc::new(cfg);
    let mut handles = Vec::with_capacity(listeners.len());
    for listener in listeners {
        let mut stop = stop.clone();
        let cfg_w = cfg_arc.clone();
        let stats_w = stats.clone();
        let locks_w = locks.clone();
        handles.push(tokio::spawn(async move {
            loop {
                tokio::select! {
                    res = listener.accept() => match res {
                        Ok((stream, _)) => {
                            let p = (*cfg_w).clone();
                            tokio::spawn(handle_client(p, locks_w.clone(), allow_private, stream, stats_w.clone()));
                        }
                        Err(e) => {
                            let em = e.to_string();
                            eprintln!("[proxy:{}] accept: {em}", cfg_w.id);
                            // accept() error breaks this worker — surfacing it
                            // matters because losing all REUSEPORT workers kills
                            // the proxy silently. Dedup at panel handles spam.
                            report_err("error", "accept-fail", format!("accept on {}: {em}", cfg_w.port), serde_json::json!({"port": cfg_w.port}), Some(cfg_w.id.clone()));
                            break;
                        }
                    },
                    // watch::Receiver::changed() reliably resolves once the value
                    // moves off its last-seen mark (initial false → send(true)) —
                    // unlike Notify::notify_waiters there's no "no current waiter
                    // → signal dropped" race. Listener drops on break → socket
                    // closes → kernel removes it from the REUSEPORT group.
                    res = stop.changed() => { if res.is_err() || *stop.borrow() { break; } }
                }
            }
        }));
    }
    // AbortGuard: when the outer serve_proxy task is aborted, drop this guard
    // and force-abort every inner accept worker. Without this, an aborted
    // outer would detach the inner JoinHandles (drop = detach, not abort) and
    // the listeners would keep accepting on REUSEPORT alongside the new task.
    let abort_handles: Vec<tokio::task::AbortHandle> = handles.iter().map(|h| h.abort_handle()).collect();
    let _guard = AbortOnDrop(abort_handles);
    for h in handles { let _ = h.await; }
    eprintln!("[proxy:{}] stopped", cfg_arc.id);
}

fn num_cpus_capped(cap: usize) -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).clamp(1, cap)
}

// Linux-only socket fast-path tunings — best-effort, errors silently ignored.
// Applied to every TCP connection (both client-facing and upstream-facing).
//
//   * TCP_QUICKACK     — RFC 7413 §3.1, disable delayed-ACK for proxy hops
//   * SO_RCVBUF        — 4 MB so high-BDP flows ramp cwnd; kernel may auto-tune higher
//   * SO_SNDBUF        — same
//   * SO_KEEPALIVE     — periodic probes to detect dead peer
//   * TCP_KEEPIDLE 30  — start probing after 30 s idle (vs default 7200)
//   * TCP_KEEPINTVL 10 — 10 s between probes
//   * TCP_KEEPCNT 3    — drop after 3 failed probes
// Bidirectional copy with a large user-space buffer. tokio::io::copy_bidirectional
// uses a 2KB buffer by default — at 1 Gbps that's 60k+ syscalls/sec/direction
// which dominates the relay path and caps throughput around ~1 MB/s. With a
// 256 KB buffer the same throughput needs ~500 syscalls/sec — line rate.
// (No platform-specific code here; cross-compiles to Windows fine.)
async fn relay_bidi(a: &mut TcpStream, b: &mut TcpStream) -> std::io::Result<(u64, u64)> {
    let (mut ar, mut aw) = a.split();
    let (mut br, mut bw) = b.split();
    const BUF: usize = 256 * 1024;
    let a_to_b = async {
        let mut buf = vec![0u8; BUF];
        let mut total: u64 = 0;
        loop {
            let n = ar.read(&mut buf).await?;
            if n == 0 { break; }
            bw.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        let _ = bw.shutdown().await;
        Ok::<u64, std::io::Error>(total)
    };
    let b_to_a = async {
        let mut buf = vec![0u8; BUF];
        let mut total: u64 = 0;
        loop {
            let n = br.read(&mut buf).await?;
            if n == 0 { break; }
            aw.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        let _ = aw.shutdown().await;
        Ok::<u64, std::io::Error>(total)
    };
    let (up, down) = tokio::join!(a_to_b, b_to_a);
    Ok((up.unwrap_or(0), down.unwrap_or(0)))
}

// ──────────────────────────── TLS listener (HTTPS proxy + Trojan) ───────────
// Each proxy reserves a second port (port + 443) that serves TLS-wrapped
// traffic. After the TLS handshake we peek the first bytes to dispatch:
//   - 56 ASCII hex chars + CRLF that match SHA-224(proxy.password) → Trojan
//   - anything else → HTTPS proxy (HTTP CONNECT/GET tunnelled over TLS)
// Both paths reuse the existing connect_upstream + relay_bidi pipeline so
// stats/quota/whitelist/SSRF-block all keep working identically.

static TLS_CRYPTO_INIT: std::sync::Once = std::sync::Once::new();
fn install_tls_crypto_provider() {
    TLS_CRYPTO_INIT.call_once(|| {
        // ring is the only feature compiled in — this is just to set the default
        // global crypto provider so rustls server/client builders don't panic.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

const TLS_CERT_PATH: &str = "/etc/proxybox-agent.cert.pem";
const TLS_KEY_PATH: &str = "/etc/proxybox-agent.key.pem";
const TLS_CERT_PATH_LEGACY: &str = "/etc/proxyhub-agent.cert.pem";
const TLS_KEY_PATH_LEGACY: &str = "/etc/proxyhub-agent.key.pem";

// Generate (or load) a self-signed ed25519 cert with SAN covering every
// non-loopback IP this host owns + "localhost". Persisted to disk so the
// cert fingerprint stays stable across restarts (Trojan clients pin it).
fn load_or_make_self_signed() -> Result<(Vec<rustls::pki_types::CertificateDer<'static>>, rustls::pki_types::PrivateKeyDer<'static>), String> {
    use std::fs;
    if let (Ok(cert_pem), Ok(key_pem)) = (fs::read_to_string(TLS_CERT_PATH), fs::read_to_string(TLS_KEY_PATH)) {
        let certs = parse_certs_pem(&cert_pem).map_err(|e| format!("parse cert: {e}"))?;
        let key = parse_key_pem(&key_pem).map_err(|e| format!("parse key: {e}"))?;
        if !certs.is_empty() { return Ok((certs, key)); }
    }
    // Legacy fallback so agents installed before the proxybox rebrand keep their pinned cert.
    if let (Ok(cert_pem), Ok(key_pem)) = (fs::read_to_string(TLS_CERT_PATH_LEGACY), fs::read_to_string(TLS_KEY_PATH_LEGACY)) {
        let certs = parse_certs_pem(&cert_pem).map_err(|e| format!("parse legacy cert: {e}"))?;
        let key = parse_key_pem(&key_pem).map_err(|e| format!("parse legacy key: {e}"))?;
        if !certs.is_empty() { return Ok((certs, key)); }
    }
    // Generate new self-signed cert with all detectable public IPs.
    let mut sans: Vec<String> = vec!["localhost".to_string()];
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if a.is_loopback() { continue; }
            let ip = a.ip();
            match ip {
                IpAddr::V4(v) => { if !is_blocked_v4(&v) { sans.push(v.to_string()); } }
                IpAddr::V6(v) => { if !is_blocked_v6(&v) { sans.push(v.to_string()); } }
            }
        }
    }
    let mut params = rcgen::CertificateParams::new(sans.clone()).map_err(|e| format!("rcgen params: {e}"))?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    params.distinguished_name.push(rcgen::DnType::CommonName, "ProxyBox Agent");
    let key_pair = rcgen::KeyPair::generate().map_err(|e| format!("rcgen keypair: {e}"))?;
    let cert = params.self_signed(&key_pair).map_err(|e| format!("rcgen sign: {e}"))?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    let _ = fs::write(TLS_CERT_PATH, &cert_pem);
    let _ = fs::write(TLS_KEY_PATH, &key_pem);
    eprintln!("[tls] generated self-signed cert with SAN: {}", sans.join(","));
    let certs = parse_certs_pem(&cert_pem).map_err(|e| format!("re-parse cert: {e}"))?;
    let key = parse_key_pem(&key_pem).map_err(|e| format!("re-parse key: {e}"))?;
    Ok((certs, key))
}

fn parse_certs_pem(pem: &str) -> Result<Vec<rustls::pki_types::CertificateDer<'static>>, String> {
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    for line in pem.lines() {
        if line.starts_with("-----BEGIN CERTIFICATE-----") { current = Some(String::new()); continue; }
        if line.starts_with("-----END CERTIFICATE-----") {
            if let Some(b64) = current.take() {
                let der = base64_decode(&b64).map_err(|_| "bad b64 in cert")?;
                out.push(rustls::pki_types::CertificateDer::from(der));
            }
            continue;
        }
        if let Some(buf) = current.as_mut() { buf.push_str(line.trim()); }
    }
    Ok(out)
}
fn parse_key_pem(pem: &str) -> Result<rustls::pki_types::PrivateKeyDer<'static>, String> {
    let mut current: Option<(&'static str, String)> = None;
    for line in pem.lines() {
        if line.starts_with("-----BEGIN PRIVATE KEY-----")    { current = Some(("PKCS8", String::new())); continue; }
        if line.starts_with("-----BEGIN EC PRIVATE KEY-----") { current = Some(("SEC1", String::new()));  continue; }
        if line.starts_with("-----BEGIN RSA PRIVATE KEY-----"){ current = Some(("PKCS1", String::new())); continue; }
        if line.starts_with("-----END ") { break; }
        if let Some((_, buf)) = current.as_mut() { buf.push_str(line.trim()); }
    }
    let (kind, b64) = current.ok_or("no PRIVATE KEY block found")?;
    let der = base64_decode(&b64).map_err(|_| "bad b64 in key")?;
    Ok(match kind {
        "PKCS8" => rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(der)),
        "SEC1"  => rustls::pki_types::PrivateKeyDer::Sec1(rustls::pki_types::PrivateSec1KeyDer::from(der)),
        "PKCS1" => rustls::pki_types::PrivateKeyDer::Pkcs1(rustls::pki_types::PrivatePkcs1KeyDer::from(der)),
        _       => return Err("unknown key kind".to_string()),
    })
}

async fn make_tls_acceptor() -> Result<TlsAcceptor, String> {
    install_tls_crypto_provider();
    let (certs, key) = load_or_make_self_signed()?;
    let cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("rustls server cfg: {e}"))?;
    Ok(TlsAcceptor::from(Arc::new(cfg)))
}

// Trojan password → SHA-224 hex (56 chars). This is what the client sends as
// the first line over TLS so the server can authenticate without a separate
// handshake. Reuses the same `proxy.password` as HTTP/SOCKS5.
fn trojan_hash(password: &str) -> String {
    let digest = Sha224::digest(password.as_bytes());
    hex::encode(digest)
}

// Serve the TLS-wrap listener — same per-proxy lifecycle as serve_proxy but
// dispatches Trojan vs HTTPS-proxy after the TLS handshake.
async fn serve_proxy_tls(cfg: ProxyCfg, acceptor: TlsAcceptor, locks: Arc<ProxyLockMap>, allow_private: bool, mut stop: tokio::sync::watch::Receiver<bool>, stats: Arc<ProxyStats>) {
    if cfg.tls_port == 0 { return; }
    let host: IpAddr = cfg.listen_host.parse().unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let addr = SocketAddr::new(host, cfg.tls_port);
    // For IPv6 proxies the bindIp may need attaching first (same as plain port).
    if cfg.kind.eq_ignore_ascii_case("IPv6") {
        if let Ok(bind) = cfg.bind_ip.parse::<IpAddr>() {
            attach_v6_for_proxy(&cfg.id, bind).await;
        }
    }
    let sock = match if addr.is_ipv4() { TcpSocket::new_v4() } else { TcpSocket::new_v6() } {
        Ok(s) => s,
        Err(e) => {
            let em = e.to_string();
            eprintln!("[tls:{}] socket: {em}", cfg.id);
            report_err("error", "tls:socket", format!("tls socket() failed for {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), Some(cfg.id.clone()));
            return;
        }
    };
    let _ = sock.set_reuseaddr(true);
    // SO_REUSEPORT matches the plain-listener path. Without it, the brief
    // overlap during reconcile-driven rotation (old task aborted but its
    // listener socket not yet closed when the new task tries to bind the
    // same port) returns EADDRINUSE and the TLS endpoint for that proxy
    // goes dead until the next reconcile cycle. With REUSEPORT both old
    // and new can coexist briefly; the kernel cleans up the dying socket.
    #[cfg(unix)] let _ = sock.set_reuseport(true);
    let _ = sock.set_recv_buffer_size(4 * 1024 * 1024);
    let _ = sock.set_send_buffer_size(4 * 1024 * 1024);
    if let Err(e) = sock.bind(addr) {
        let em = e.to_string();
        eprintln!("[tls:{}] bind {addr}: {em}", cfg.id);
        report_err("error", "tls:bind-fail", format!("tls bind {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), Some(cfg.id.clone()));
        return;
    }
    let listener = match sock.listen(1024) {
        Ok(l) => l,
        Err(e) => {
            let em = e.to_string();
            eprintln!("[tls:{}] listen {addr}: {em}", cfg.id);
            report_err("error", "tls:listen-fail", format!("tls listen {addr}: {em}"), serde_json::json!({"addr": addr.to_string()}), Some(cfg.id.clone()));
            return;
        }
    };
    eprintln!("[tls:{}] {addr} -> {} (TLS-wrap: HTTPS-proxy + Trojan)", cfg.id, cfg.bind_ip);
    let cfg_arc = Arc::new(cfg);
    let trojan_hex = trojan_hash(&cfg_arc.password);
    loop {
        tokio::select! {
            res = stop.changed() => {
                if res.is_err() || *stop.borrow() {
                    eprintln!("[tls:{}] stopped", cfg_arc.id);
                    return;
                }
            }
            res = listener.accept() => {
                let (stream, _peer) = match res { Ok(x) => x, Err(_) => continue };
                let _ = stream.set_nodelay(true);
                tune_socket(&stream);
                let acc = acceptor.clone();
                let cfg2 = cfg_arc.clone();
                let stats2 = stats.clone();
                let trojan_hex2 = trojan_hex.clone();
                let locks2 = locks.clone();
                tokio::spawn(async move {
                    let tls = match acc.accept(stream).await {
                        Ok(t) => t,
                        Err(_) => return, // TLS handshake failed — client error, drop quietly
                    };
                    handle_tls_dispatched(&cfg2, &locks2, allow_private, tls, &trojan_hex2, &stats2).await;
                });
            }
        }
    }
}

async fn handle_tls_dispatched(proxy: &ProxyCfg, locks: &Arc<ProxyLockMap>, allow_private: bool, mut tls: tokio_rustls::server::TlsStream<TcpStream>, trojan_hex: &str, stats: &Arc<ProxyStats>) {
    // Get peer's true source IP (for whitelist + stats).
    let src_ip = tls.get_ref().0.peer_addr().map(|a| a.ip()).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let src_port = tls.get_ref().0.peer_addr().map(|a| a.port()).unwrap_or(0);
    // Per-proxy connection cap (mirror handle_client).
    if proxy.max_connections > 0 && stats.active_connections.load(Ordering::Relaxed) >= proxy.max_connections {
        return;
    }
    stats.total_connections.fetch_add(1, Ordering::Relaxed);
    stats.active_connections.fetch_add(1, Ordering::Relaxed);
    let _guard = ActiveGuard(stats.clone());
    // Read 56 bytes (SHA-224 hex). Trojan clients always send exactly the hash
    // up front; HTTPS-proxy mode sends an HTTP request line which is also ≥56
    // bytes ("CONNECT example.com:443 HTTP/1.1\r\n..."). If we read fewer than
    // 56 the client is misbehaving — close silently.
    let mut peek = [0u8; 56];
    let mut got = 0usize;
    while got < 56 {
        let n = match timeout(CLIENT_TIMEOUT, tls.read(&mut peek[got..])).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return,
        };
        got += n;
    }
    if &peek[..] == trojan_hex.as_bytes() {
        // Trojan auth = SHA224 match. Apply 3-conn cap here (no user/pass step).
        let whitelisted = src_ip_allowed_by_whitelist(proxy, src_ip);
        let guard = if whitelisted { None } else {
            match try_acquire_session(locks, proxy, &src_ip.to_string()) { Some(g) => Some(g), None => return }
        };
        let kick = guard.as_ref().map(|g| g.notify_handle());
        let _ = handle_trojan_after_auth(proxy, allow_private, &mut tls, src_ip, src_port, kick, stats).await;
        drop(guard);
    } else {
        let _ = handle_http_proxy_on_tls(proxy, locks, allow_private, &mut tls, src_ip, src_port, peek.to_vec(), stats).await;
    }
}

// Trojan after-auth: parse SOCKS5-like request structure + relay.
// Format: [CMD:1][ATYP:1][DST.ADDR:var][DST.PORT:2][CRLF][payload...]
async fn handle_trojan_after_auth(proxy: &ProxyCfg, allow_private: bool, tls: &mut tokio_rustls::server::TlsStream<TcpStream>, src_ip: IpAddr, src_port: u16, kick: Option<Arc<Notify>>, stats: &Arc<ProxyStats>) -> Result<(), String> {
    let mut header = [0u8; 2]; tls.read_exact(&mut header).await.map_err(|e| e.to_string())?; // CRLF after hash
    if &header != b"\r\n" { return Err("trojan: missing CRLF after hash".into()); }
    let mut req_head = [0u8; 2]; tls.read_exact(&mut req_head).await.map_err(|e| e.to_string())?;
    if req_head[0] != 0x01 { return Err(format!("trojan: unsupported cmd {}", req_head[0])); }
    let host = match req_head[1] {
        0x01 => { let mut b = [0u8; 4]; tls.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv4Addr::from(b).to_string() }
        0x03 => { let mut l = [0u8; 1]; tls.read_exact(&mut l).await.map_err(|e| e.to_string())?; let mut b = vec![0u8; l[0] as usize]; tls.read_exact(&mut b).await.map_err(|e| e.to_string())?; String::from_utf8_lossy(&b).to_string() }
        0x04 => { let mut b = [0u8; 16]; tls.read_exact(&mut b).await.map_err(|e| e.to_string())?; Ipv6Addr::from(b).to_string() }
        _ => return Err("trojan: bad atyp".into()),
    };
    let mut pb = [0u8; 2]; tls.read_exact(&mut pb).await.map_err(|e| e.to_string())?;
    let port = u16::from_be_bytes(pb);
    let mut crlf = [0u8; 2]; tls.read_exact(&mut crlf).await.map_err(|e| e.to_string())?;
    if &crlf != b"\r\n" { return Err("trojan: missing CRLF after target".into()); }
    // Egress
    let mut up = match connect_upstream(proxy, &host, port, allow_private).await {
        Ok(s) => s, Err(e) => return Err(e),
    };
    let start = now_ms();
    let (up_b, dn_b) = if let Some(kn) = kick.as_ref() {
        tokio::select! {
            biased;
            _ = kn.notified() => (0, 0),
            r = tls_relay_bidi(tls, &mut up) => r.unwrap_or((0, 0)),
        }
    } else {
        tls_relay_bidi(tls, &mut up).await.unwrap_or((0, 0))
    };
    add_traffic(stats, up_b, dn_b);
    record_connection(stats, src_ip, src_port, &host, port, up_b, dn_b, now_ms().saturating_sub(start), "trojan").await;
    Ok(())
}

// HTTPS-proxy on TLS — basic implementation: read until "\r\n\r\n" headers,
// then either CONNECT-tunnel or plain GET. Reuses connect_upstream + relay.
async fn handle_http_proxy_on_tls(proxy: &ProxyCfg, locks: &Arc<ProxyLockMap>, allow_private: bool, tls: &mut tokio_rustls::server::TlsStream<TcpStream>, src_ip: IpAddr, src_port: u16, peeked: Vec<u8>, stats: &Arc<ProxyStats>) -> Result<(), String> {
    let mut buf = peeked;
    loop {
        if buf.windows(4).any(|w| w == b"\r\n\r\n") { break; }
        if buf.len() > 16 * 1024 { return Err("https-proxy: header too large".into()); }
        let mut chunk = [0u8; 4096];
        let n = match timeout(CLIENT_TIMEOUT, tls.read(&mut chunk)).await { Ok(Ok(n)) => n, _ => return Err("read header".into()) };
        if n == 0 { return Err("eof reading header".into()); }
        buf.extend_from_slice(&chunk[..n]);
    }
    let idx = buf.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no header end")?;
    let header_text = String::from_utf8_lossy(&buf[..idx]).to_string();
    let leftover = buf[idx + 4..].to_vec();
    let mut lines = header_text.split("\r\n");
    let req_line = lines.next().unwrap_or("");
    let mut parts = req_line.split_ascii_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let proto  = parts.next().unwrap_or("HTTP/1.1");
    let mut auth: Option<(String, String)> = None;
    let mut clean_headers = Vec::new();
    for line in lines {
        if line.is_empty() { break; }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("proxy-authorization") { auth = parse_basic(v); }
            if !k.trim().to_ascii_lowercase().starts_with("proxy-") { clean_headers.push(line.to_string()); }
        }
    }
    let whitelisted = src_ip_allowed_by_whitelist(proxy, src_ip);
    if !whitelisted {
        let (u, p) = match auth { Some(x) => x, None => {
            let _ = tls.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return Err("missing auth".into());
        }};
        if !proxy_authorized_fast(proxy, &u, &p, src_ip) {
            let _ = tls.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ProxyBox\"\r\nContent-Length: 0\r\n\r\n").await;
            return Err("auth fail".into());
        }
    }
    let _guard = if whitelisted { None } else {
        match try_acquire_session(locks, proxy, &src_ip.to_string()) {
            Some(g) => Some(g),
            None => {
                let _ = tls.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nX-Proxy-Error: max 3 concurrent connections\r\n\r\n").await;
                return Err("max conns".into());
            }
        }
    };
    let kick = _guard.as_ref().map(|g| g.notify_handle());
    if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = split_host_port(target, 443);
        let mut up = match connect_upstream(proxy, &host, port, allow_private).await {
            Ok(s) => s,
            Err(e) => { let _ = tls.write_all(format!("HTTP/1.1 502 Bad Gateway\r\nX-Proxy-Error: {e}\r\n\r\n").as_bytes()).await; return Err(e); }
        };
        tls.write_all(b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: ProxyBox-TLS\r\n\r\n").await.map_err(|e| e.to_string())?;
        if !leftover.is_empty() { up.write_all(&leftover).await.map_err(|e| e.to_string())?; }
        let start = now_ms();
        let (up_b, dn_b) = if let Some(kn) = kick.as_ref() {
            tokio::select! { biased; _ = kn.notified() => (0, 0), r = tls_relay_bidi(tls, &mut up) => r.unwrap_or((0, 0)) }
        } else { tls_relay_bidi(tls, &mut up).await.unwrap_or((0, 0)) };
        add_traffic(stats, up_b, dn_b);
        record_connection(stats, src_ip, src_port, &host, port, up_b, dn_b, now_ms().saturating_sub(start), "https-proxy").await;
        return Ok(());
    }
    // Plain HTTP GET via TLS-wrap — rare, but handle it.
    let url = parse_url(target).ok_or("bad url")?;
    let port = url.port.unwrap_or(if url.scheme == "https" { 443 } else { 80 });
    let mut up = match connect_upstream(proxy, &url.host, port, allow_private).await {
        Ok(s) => s,
        Err(e) => { let _ = tls.write_all(format!("HTTP/1.1 502 Bad Gateway\r\nX-Proxy-Error: {e}\r\n\r\n").as_bytes()).await; return Err(e); }
    };
    let new_req = format!("{} {} {}\r\n{}\r\n\r\n", method, url.path_query, proto, clean_headers.join("\r\n"));
    up.write_all(new_req.as_bytes()).await.map_err(|e| e.to_string())?;
    if !leftover.is_empty() { up.write_all(&leftover).await.map_err(|e| e.to_string())?; }
    let start = now_ms();
    let (up_b, dn_b) = if let Some(kn) = kick.as_ref() {
        tokio::select! { biased; _ = kn.notified() => (0, 0), r = tls_relay_bidi(tls, &mut up) => r.unwrap_or((0, 0)) }
    } else { tls_relay_bidi(tls, &mut up).await.unwrap_or((0, 0)) };
    add_traffic(stats, up_b, dn_b);
    record_connection(stats, src_ip, src_port, &url.host, port, up_b, dn_b, now_ms().saturating_sub(start), "https-proxy").await;
    Ok(())
}

// Bidi copy between a TLS server stream and a plain TCP upstream — same
// 256KB-buffer pattern as relay_bidi but typed for the mixed pair.
async fn tls_relay_bidi(a: &mut tokio_rustls::server::TlsStream<TcpStream>, b: &mut TcpStream) -> std::io::Result<(u64, u64)> {
    let (mut ar, mut aw) = tokio::io::split(a);
    let (mut br, mut bw) = b.split();
    const BUF: usize = 256 * 1024;
    let a_to_b = async {
        let mut buf = vec![0u8; BUF]; let mut total: u64 = 0;
        loop {
            let n = ar.read(&mut buf).await?;
            if n == 0 { break; }
            bw.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        let _ = bw.shutdown().await;
        Ok::<u64, std::io::Error>(total)
    };
    let b_to_a = async {
        let mut buf = vec![0u8; BUF]; let mut total: u64 = 0;
        loop {
            let n = br.read(&mut buf).await?;
            if n == 0 { break; }
            aw.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        let _ = aw.shutdown().await;
        Ok::<u64, std::io::Error>(total)
    };
    let (up, down) = tokio::join!(a_to_b, b_to_a);
    Ok((up.unwrap_or(0), down.unwrap_or(0)))
}

// Linux-specific socket tuning (TCP_QUICKACK, larger rcv/snd buffers,
// keepalive params). Other platforms get a no-op fallback below.
#[cfg(target_os = "linux")]
fn tune_socket(stream: &TcpStream) {
    use std::os::unix::io::AsRawFd;
    let fd = stream.as_raw_fd();
    unsafe {
        let yes: libc::c_int = 1;
        let buf: libc::c_int = 4 * 1024 * 1024;
        let idle: libc::c_int = 30;
        let intvl: libc::c_int = 10;
        let cnt: libc::c_int = 3;
        let sz = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
        libc::setsockopt(fd, libc::IPPROTO_TCP, libc::TCP_QUICKACK, &yes as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVBUF, &buf as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_SNDBUF, &buf as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_KEEPALIVE, &yes as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::IPPROTO_TCP, libc::TCP_KEEPIDLE, &idle as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::IPPROTO_TCP, libc::TCP_KEEPINTVL, &intvl as *const _ as *const _, sz);
        libc::setsockopt(fd, libc::IPPROTO_TCP, libc::TCP_KEEPCNT, &cnt as *const _ as *const _, sz);
    }
}
#[cfg(not(target_os = "linux"))]
fn tune_socket(_stream: &TcpStream) {}

// ── DNS cache with TTL (lesson from Shadowrocket fake-IP / DoH cache) ────────
// Cache positive lookups for 5 minutes so repeated requests to the same target
// (e.g. scraping the same domain) avoid the ~10-50 ms resolver hop. Negative
// lookups are NOT cached so transient failures recover quickly.
struct DnsEntry { addrs: Vec<SocketAddr>, expires: std::time::Instant }
static DNS_CACHE: StdMutex<Option<HashMap<String, DnsEntry>>> = StdMutex::new(None);
const DNS_TTL: Duration = Duration::from_secs(300);
async fn cached_lookup_host(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let key = format!("{host}:{port}");
    {
        let mut g = DNS_CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if g.is_none() { *g = Some(HashMap::new()); }
        let map = g.as_mut().unwrap();
        if let Some(e) = map.get(&key) {
            if e.expires > std::time::Instant::now() { return Ok(e.addrs.clone()); }
            map.remove(&key);
        }
    }
    let v: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await
        .map_err(|e| e.to_string())?.collect();
    let mut g = DNS_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(map) = g.as_mut() {
        map.insert(key, DnsEntry { addrs: v.clone(), expires: std::time::Instant::now() + DNS_TTL });
        // GC: cap at 10k entries to bound memory
        if map.len() > 10_000 {
            let now = std::time::Instant::now();
            map.retain(|_, e| e.expires > now);
        }
    }
    Ok(v)
}

// ── Auth fast-path cache (Fortinet "session fast path" idea) ─────────────────
// Once a (srcIP, username) tuple passes auth, cache the result for 60 s. New
// connections from the same client skip the timing-eq strcmp + can also skip
// per-source-IP rate counter increment if the cache says "still valid".
// Worth ~200ns per conn × N conn/s = real saving for hot clients.
struct AuthCacheEntry { ok: bool, expires: std::time::Instant }
static AUTH_CACHE: StdMutex<Option<HashMap<String, AuthCacheEntry>>> = StdMutex::new(None);
const AUTH_TTL: Duration = Duration::from_secs(60);
fn auth_cache_get(key: &str) -> Option<bool> {
    let mut g = AUTH_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if g.is_none() { *g = Some(HashMap::new()); }
    let map = g.as_mut().unwrap();
    if let Some(e) = map.get(key) {
        if e.expires > std::time::Instant::now() { return Some(e.ok); }
        map.remove(key);
    }
    None
}
fn auth_cache_put(key: &str, ok: bool) {
    let mut g = AUTH_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(map) = g.as_mut() {
        map.insert(key.to_string(), AuthCacheEntry { ok, expires: std::time::Instant::now() + AUTH_TTL });
        if map.len() > 10_000 {
            let now = std::time::Instant::now();
            map.retain(|_, e| e.expires > now);
        }
    }
}

// ────────────────── self-metrics (CPU/RAM/load/net) from /proc ─────────────────
// Zero-dep: parse /proc/stat, /proc/meminfo, /proc/loadavg, /proc/net/dev.
// Returns a JSON object the control plane stores into node.metrics.

use std::sync::Mutex as StdMutex;
struct SelfMetricsState {
    last_cpu_total: u64,
    last_cpu_idle: u64,
    last_net_rx: u64,
    last_net_tx: u64,
    last_net_ms: u64,
}
static SELF_STATE: StdMutex<SelfMetricsState> = StdMutex::new(SelfMetricsState {
    last_cpu_total: 0, last_cpu_idle: 0, last_net_rx: 0, last_net_tx: 0, last_net_ms: 0
});

fn read_self_metrics() -> serde_json::Value {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let mut cpu_pct = 0u64;
    let mut ram_total = 0u64;
    let mut ram_used = 0u64;
    let mut ram_pct = 0u64;
    let mut load1 = 0f64;
    let mut load5 = 0f64;
    let mut net_rx_bps = 0u64;
    let mut net_tx_bps = 0u64;

    let mut st = match SELF_STATE.lock() { Ok(g) => g, Err(p) => p.into_inner() };

    if let Ok(s) = std::fs::read_to_string("/proc/stat") {
        if let Some(line) = s.lines().next() {
            let parts: Vec<u64> = line.split_whitespace().skip(1)
                .filter_map(|x| x.parse().ok()).collect();
            if parts.len() >= 4 {
                let idle = parts[3] + parts.get(4).copied().unwrap_or(0);
                let total: u64 = parts.iter().sum();
                if st.last_cpu_total != 0 && total > st.last_cpu_total {
                    let dt = total - st.last_cpu_total;
                    let di = idle - st.last_cpu_idle;
                    if dt > 0 { cpu_pct = ((dt - di) * 100) / dt; }
                }
                st.last_cpu_total = total;
                st.last_cpu_idle = idle;
            }
        }
    }

    if let Ok(s) = std::fs::read_to_string("/proc/meminfo") {
        let mut total_kb = 0u64;
        let mut avail_kb = 0u64;
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("MemTotal:") {
                total_kb = rest.split_whitespace().next().and_then(|x| x.parse().ok()).unwrap_or(0);
            } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
                avail_kb = rest.split_whitespace().next().and_then(|x| x.parse().ok()).unwrap_or(0);
            }
        }
        ram_total = total_kb * 1024;
        ram_used = total_kb.saturating_sub(avail_kb) * 1024;
        if ram_total > 0 { ram_pct = (ram_used * 100) / ram_total; }
    }

    if let Ok(s) = std::fs::read_to_string("/proc/loadavg") {
        let mut it = s.split_whitespace();
        load1 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
        load5 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    }

    if let Ok(s) = std::fs::read_to_string("/proc/net/dev") {
        let mut rx = 0u64;
        let mut tx = 0u64;
        for line in s.lines() {
            if let Some(idx) = line.find(':') {
                let iface = line[..idx].trim();
                if iface == "lo" { continue; }
                let rest: Vec<u64> = line[idx + 1..].split_whitespace()
                    .filter_map(|x| x.parse().ok()).collect();
                if rest.len() >= 9 {
                    rx += rest[0];
                    tx += rest[8];
                }
            }
        }
        if st.last_net_ms != 0 && now_ms > st.last_net_ms {
            let dt = (now_ms - st.last_net_ms) as f64 / 1000.0;
            if dt > 0.0 {
                net_rx_bps = (((rx as i64) - (st.last_net_rx as i64)).max(0) as f64 / dt) as u64;
                net_tx_bps = (((tx as i64) - (st.last_net_tx as i64)).max(0) as f64 / dt) as u64;
            }
        }
        st.last_net_rx = rx;
        st.last_net_tx = tx;
        st.last_net_ms = now_ms;
    }

    let uptime_sec = std::fs::read_to_string("/proc/uptime").ok()
        .and_then(|s| s.split('.').next().and_then(|n| n.parse::<u64>().ok())).unwrap_or(0);

    serde_json::json!({
        "cpuPct": cpu_pct,
        "ramTotal": ram_total,
        "ramUsed": ram_used,
        "ramPct": ram_pct,
        "load1": load1,
        "load5": load5,
        "netRxBps": net_rx_bps,
        "netTxBps": net_tx_bps,
        "uptimeSec": uptime_sec,
    })
}

// ──────────────────────────── control-plane client ──────────────────────────

#[derive(Deserialize)]
struct EnrollResp {
    #[serde(rename = "nodeId")] node_id: String,
    token: String,
    #[serde(rename = "controlUrl", default)] control_url: String,
    #[serde(rename = "proxyDefaults", default)] proxy_defaults: Option<ProxyDefaults>,
    #[serde(rename = "mtlsUrl", default)] mtls_url: String,
    #[serde(rename = "caCert", default)] ca_cert: String,
    #[serde(rename = "clientCert", default)] client_cert: String,
    #[serde(rename = "clientKey", default)] client_key: String,
    #[serde(default = "default_family")] family: String,
}

impl Agent {
    async fn enroll_if_needed(&self) -> Result<(), String> {
        let (have_token, have_cert, enroll_token, control_url) = {
            let c = self.cfg.lock().await;
            (c.token.clone(), !c.client_cert.is_empty(), c.enroll_token.clone(), c.control_url.clone())
        };
        if !have_token.is_empty() && have_cert { return Ok(()); }
        if enroll_token.is_empty() {
            if !have_token.is_empty() { return Ok(()); } // can't re-enroll, fall back to bearer
            return Err("no token and no enrollToken — re-run install".into());
        }
        let url = format!("{}/api/agent/enroll", control_url);
        let resp = self.http.post(&url).json(&serde_json::json!({ "enrollToken": enroll_token }))
            .send().await.map_err(|e| format!("enroll: {e}"))?;
        if !resp.status().is_success() { return Err(format!("enroll: HTTP {}", resp.status())); }
        let data: EnrollResp = resp.json().await.map_err(|e| format!("enroll body: {e}"))?;
        let node_id = data.node_id.clone();
        let mut c = self.cfg.lock().await;
        c.token = data.token;
        if c.control_url.is_empty() && !data.control_url.is_empty() { c.control_url = data.control_url; }
        if let Some(d) = data.proxy_defaults { c.proxy_defaults = d; }
        if !data.family.is_empty() { c.family = data.family.to_lowercase(); }
        let mut got_mtls = false;
        if !data.mtls_url.is_empty() && !data.ca_cert.is_empty() && !data.client_cert.is_empty() && !data.client_key.is_empty() {
            c.mtls_url = data.mtls_url.trim_end_matches('/').to_string();
            c.ca_cert = data.ca_cert; c.client_cert = data.client_cert; c.client_key = data.client_key;
            got_mtls = true;
        }
        save_config(&self.cfg_path, &*c).await;
        let cert_material = if got_mtls { Some((c.ca_cert.clone(), c.client_cert.clone(), c.client_key.clone())) } else { None };
        drop(c); // release cfg lock before touching the mtls lock (mtls is acquired before cfg elsewhere)
        if let Some((ca, cert, key)) = cert_material {
            match build_mtls_client(&ca, &cert, &key) {
                Ok(client) => { *self.mtls.lock().await = Some(client); eprintln!("[agent] mTLS client cert installed; agent channel will use mTLS"); }
                Err(e) => eprintln!("[agent] mTLS client build failed: {e}"),
            }
        }
        eprintln!("[agent] enrolled as node {}", node_id);
        Ok(())
    }

    async fn register(&self) -> Result<(), String> {
        let network = tokio::task::spawn_blocking(detect_network).await.unwrap_or_default();
        let body = serde_json::json!({ "version": AGENT_VERSION, "network": network });
        let resp = self.agent_post("register").await.json(&body).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() { return Err(format!("register: HTTP {}", resp.status())); }
        Ok(())
    }
    async fn heartbeat(&self) -> Result<(), String> {
        let stats_map: serde_json::Map<String, serde_json::Value> = {
            let map = self.stats.lock().await;
            let mut out = serde_json::Map::new();
            for (id, s) in map.iter() {
                let top_targets: serde_json::Map<String, serde_json::Value> = {
                    let m = s.top_targets.lock().await;
                    m.iter().map(|(host, v)| {
                        (host.clone(), serde_json::json!({
                            "count": v.count,
                            "bytesUp": v.bytes_up,
                            "bytesDown": v.bytes_down,
                            "lastTs": v.last_ts_ms,
                        }))
                    }).collect()
                };
                let recent_conns: Vec<serde_json::Value> = {
                    let mut q = s.recent_conns_pending.lock().await;
                    let drained: Vec<_> = q.drain(..).collect();
                    drained.into_iter().map(|c| serde_json::json!({
                        "ts": c.ts,
                        "src": c.src,
                        "srcPort": c.src_port,
                        "host": c.host,
                        "port": c.port,
                        "up": c.up,
                        "down": c.down,
                        "ms": c.ms,
                        "kind": c.kind,
                    })).collect()
                };
                out.insert(id.clone(), serde_json::json!({
                    "uploadBytes": s.upload_bytes.load(Ordering::Relaxed),
                    "downloadBytes": s.download_bytes.load(Ordering::Relaxed),
                    "monthBytes": s.month_bytes.load(Ordering::Relaxed),
                    "totalConnections": s.total_connections.load(Ordering::Relaxed),
                    "activeConnections": s.active_connections.load(Ordering::Relaxed),
                    "bpsIn": s.bps_in.load(Ordering::Relaxed),
                    "bpsOut": s.bps_out.load(Ordering::Relaxed),
                    "topTargets": top_targets,
                    "recentConns": recent_conns,
                }));
            }
            out
        };
        let metrics = read_self_metrics();
        // Drain accumulated command results — master expects each {id, action,
        // code, output} once, then forgets about that command. (Master also
        // dedups by id on its side: an HTTP retry / duplicate frame won't
        // double-record the result.)
        let command_results: Vec<serde_json::Value> = {
            let mut v = self.pending_results.lock().await;
            v.drain(..).collect()
        };
        let network = tokio::task::spawn_blocking(detect_network).await.unwrap_or_default();
        let body = serde_json::json!({
            "version": AGENT_VERSION,
            "network": network,
            "stats": stats_map,
            "metrics": metrics,
            "commandResults": command_results,
        });
        let resp = self.agent_post("heartbeat").await.json(&body).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() { return Err(format!("heartbeat: HTTP {}", resp.status())); }
        if let Ok(j) = resp.json::<serde_json::Value>().await {
            // Master tells us an upgrade is available — pull binary, atomic-rename
            // into our own exe path, exit(0) so systemd respawns into the new
            // build. No SSH required; fully self-driven once enrolled.
            if let Some(upd) = j.get("updateAvailable") {
                let latest = upd.get("latest").and_then(|v| v.as_str()).unwrap_or("");
                let bin_url = upd.get("binaryUrl").and_then(|v| v.as_str()).unwrap_or("");
                if !bin_url.is_empty() && latest != AGENT_VERSION {
                    eprintln!("[agent] master reports upgrade available: {latest} (we are {AGENT_VERSION}); self-upgrading");
                    if let Err(e) = self.self_upgrade(bin_url).await {
                        eprintln!("[agent] self-upgrade failed: {e}");
                    }
                }
            }
            // Master queued admin commands for us. Execute synchronously and
            // stash results into pending_results; they ship in the NEXT
            // heartbeat. This is the BYON path — admin without SSH access
            // still gets to reboot/diagnose/etc. by riding the agent channel.
            if let Some(cmds) = j.get("commands").and_then(|v| v.as_array()) {
                for c in cmds {
                    let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let action = c.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if id.is_empty() || action.is_empty() { continue; }
                    // Dedup — master re-sends a queued command on every
                    // heartbeat until our result reaches it; without dedup
                    // we'd execute the same command 2-3 times before the
                    // master's pending queue catches up.
                    {
                        let mut seen = self.executed_command_ids.lock().await;
                        if seen.contains(&id) { continue; }
                        seen.insert(id.clone());
                        if seen.len() > 256 {
                            let drop: Vec<_> = seen.iter().take(seen.len() - 256).cloned().collect();
                            for d in drop { seen.remove(&d); }
                        }
                    }
                    eprintln!("[agent] executing admin cmd {action} (id={id})");
                    let (code, output) = self.run_admin_command(&action).await;
                    self.pending_results.lock().await.push(serde_json::json!({
                        "id": id,
                        "action": action,
                        "code": code,
                        "output": output,
                    }));
                }
            }
        }
        Ok(())
    }

    // Native dispatch for admin-channel commands. NO shell injection surface:
    // each branch is a discrete syscall / proc-file read. Whitelist mirrors
    // server-side QUEUEABLE_ACTIONS — anything not listed becomes a no-op.
    async fn run_admin_command(&self, action: &str) -> (i32, String) {
        match action {
            "diagnose" => {
                let mut out = String::new();
                if let Ok(s) = tokio::fs::read_to_string("/proc/uptime").await {
                    out.push_str(&format!("uptime: {}", s));
                }
                if let Ok(s) = tokio::fs::read_to_string("/proc/loadavg").await {
                    out.push_str(&format!("loadavg: {}", s));
                }
                if let Ok(s) = tokio::fs::read_to_string("/proc/meminfo").await {
                    for line in s.lines().take(5) { out.push_str(&format!("{line}\n")); }
                }
                let lst = self.listeners.lock().await;
                out.push_str(&format!("listeners: {}\nversion: {}\n", lst.len(), AGENT_VERSION));
                (0, out)
            }
            "refresh-network" => {
                let net = tokio::task::spawn_blocking(detect_network).await.unwrap_or_default();
                (0, serde_json::to_string_pretty(&net).unwrap_or_default())
            }
            "drain" => {
                let mut lst = self.listeners.lock().await;
                let ids: Vec<String> = lst.keys().cloned().collect();
                for id in &ids {
                    if let Some(h) = lst.remove(id) {
                        let _ = h.stop.send(true);
                        h.task.abort();
                        if let Some(t) = h.tls_task { t.abort(); }
                    }
                }
                self.stats.lock().await.clear();
                (0, format!("drained {} listener(s)", ids.len()))
            }
            "restart-self" => {
                // Schedule exit(0) on a short delay so the heartbeat response
                // (carrying our result) finishes returning before systemd
                // respawns us.
                tokio::spawn(async {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    eprintln!("[agent] restart-self requested by master");
                    std::process::exit(0);
                });
                (0, "scheduled exit(0); systemd will respawn".to_string())
            }
            "reboot" => {
                // Best-effort: spawn `/sbin/reboot` after returning. Requires
                // CAP_SYS_BOOT (agent runs as root on most BYON setups).
                tokio::spawn(async {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    let _ = std::process::Command::new("/sbin/reboot").spawn();
                });
                (0, "reboot scheduled".to_string())
            }
            _ => (127, format!("unknown action: {action}")),
        }
    }

    // Self-upgrade: download the new binary to a sibling tmp path, chmod +x,
    // atomic rename over our own exe, then exit(0). systemd Restart=always
    // (or on-failure with RestartSec) brings the new binary back online with
    // the same config + token. The rename(2) replaces the on-disk inode; the
    // running process keeps executing the OLD memory image until we exit.
    async fn self_upgrade(&self, url: &str) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
        let dir = exe.parent().ok_or("exe has no parent dir")?.to_path_buf();
        let tmp = dir.join(format!(".proxybox-agent.new.{}", std::process::id()));
        let bytes = self.http.get(url)
            .timeout(Duration::from_secs(60))
            .send().await.map_err(|e| format!("fetch: {e}"))?
            .bytes().await.map_err(|e| format!("body: {e}"))?;
        if bytes.len() < 1024 * 100 {
            return Err(format!("suspiciously small binary ({} bytes), aborting", bytes.len()));
        }
        tokio::fs::write(&tmp, &bytes).await.map_err(|e| format!("write tmp: {e}"))?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = tokio::fs::metadata(&tmp).await.map_err(|e| format!("stat: {e}"))?.permissions();
            perm.set_mode(0o755);
            tokio::fs::set_permissions(&tmp, perm).await.map_err(|e| format!("chmod: {e}"))?;
        }
        tokio::fs::rename(&tmp, &exe).await.map_err(|e| format!("rename: {e}"))?;
        eprintln!("[agent] new binary in place at {}; exiting so systemd respawns", exe.display());
        // Give the heartbeat response a moment to fully flush, then quit.
        tokio::time::sleep(Duration::from_millis(200)).await;
        std::process::exit(0);
    }
    async fn pull_proxies(&self) -> Result<Vec<ProxyCfg>, String> {
        let rev = self.last_rev.load(std::sync::atomic::Ordering::Relaxed);
        let resp = self.agent_get("proxies").await
            .query(&[("rev", rev.to_string())])
            .send().await.map_err(|e| e.to_string())?;
        // 401/403 = control plane has disowned this agent (node deleted or
        // token revoked). Distinct from transient errors: caller MUST treat
        // this as "no proxies wanted" and tear down all listeners.
        let status = resp.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!("UNAUTHORIZED: HTTP {}", status));
        }
        if !status.is_success() { return Err(format!("pull: HTTP {}", status)); }
        if let Some(v) = resp.headers().get("x-config-rev")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
        {
            self.last_rev.store(v, std::sync::atomic::Ordering::Relaxed);
        }
        resp.json::<Vec<ProxyCfg>>().await.map_err(|e| e.to_string())
    }
    async fn agent_post(&self, name: &str) -> reqwest::RequestBuilder {
        let mtls = self.mtls.lock().await;
        let cfg = self.cfg.lock().await;
        if let Some(client) = mtls.as_ref() {
            client.post(format!("{}/api/agent/{}", cfg.mtls_url, name))
        } else {
            self.http.post(format!("{}/api/agent/{}", cfg.control_url, name)).bearer_auth(&cfg.token)
        }
    }
    async fn agent_get(&self, name: &str) -> reqwest::RequestBuilder {
        let mtls = self.mtls.lock().await;
        let cfg = self.cfg.lock().await;
        if let Some(client) = mtls.as_ref() {
            client.get(format!("{}/api/agent/{}", cfg.mtls_url, name))
        } else {
            self.http.get(format!("{}/api/agent/{}", cfg.control_url, name)).bearer_auth(&cfg.token)
        }
    }

    async fn reconcile(&self) {
        let wanted_raw = match self.pull_proxies().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[agent] pull: {e}");
                // Best-effort: if the network is OK enough to reach the panel
                // for /error but not /proxies for some reason, surface it.
                // If the panel itself is unreachable, this is a no-op.
                report_err("error", "agent:pull-fail", e.clone(), serde_json::json!({}), None);
                // Disowned by control plane → tear everything down so we
                // don't keep serving traffic for proxies the server no longer
                // tracks (deleted / expired / revoked).
                if e.starts_with("UNAUTHORIZED:") {
                    let mut lst = self.listeners.lock().await;
                    let ids: Vec<String> = lst.keys().cloned().collect();
                    for id in ids {
                        if let Some(h) = lst.remove(&id) {
                            let _ = h.stop.send(true);
                            h.task.abort();
                            if let Some(t) = h.tls_task { t.abort(); }
                            eprintln!("[agent] disowned — stopping proxy {id}");
                        }
                        self.stats.lock().await.remove(&id);
                    }
                }
                return;
            }
        };
        // Defensive: even if the control plane somehow sends a mismatched proxy, drop it.
        let family = self.cfg.lock().await.family.clone();
        let wanted: Vec<ProxyCfg> = wanted_raw.into_iter().filter(|p| {
            if family == "dual" { return true; }
            let pf = if p.kind.eq_ignore_ascii_case("IPv6") { "ipv6" } else { "ipv4" };
            family == pf
        }).collect();
        let want_ids: std::collections::HashSet<_> = wanted.iter().map(|p| p.id.clone()).collect();
        let mut lst = self.listeners.lock().await;
        // remove proxies no longer wanted (deleted or expired by control plane)
        let to_remove: Vec<String> = lst.keys().filter(|k| !want_ids.contains(*k)).cloned().collect();
        for id in to_remove {
            if let Some(h) = lst.remove(&id) {
                let _ = h.stop.send(true);
                h.task.abort();
                if let Some(t) = h.tls_task { t.abort(); }
                eprintln!("[agent] removing proxy {id}");
            }
            self.stats.lock().await.remove(&id);
        }
        // add / restart on cfg drift
        let allow_private = self.cfg.lock().await.proxy_defaults.allow_private_targets;
        // Immediate kick: if master bumped kickEpoch for any proxy, fire
        // notify_waiters on its active sockets right now (don't wait for next
        // accept).
        for p in &wanted {
            kick_all_sessions(&self.proxy_locks, &p.id, p.kick_epoch);
        }
        for p in wanted {
            // If a listener exists with the same binding/auth, leave it; live-update mutable fields only.
            if let Some(existing) = lst.get(&p.id) {
                let same_bind = existing.cfg.bind_ip == p.bind_ip
                    && existing.cfg.port == p.port
                    && existing.cfg.listen_host == p.listen_host
                    && existing.cfg.username == p.username
                    && existing.cfg.password == p.password
                    && existing.cfg.rotate == p.rotate
                    && existing.cfg.kind == p.kind
                    && existing.cfg.allowed_src_ips == p.allowed_src_ips;
                if same_bind {
                    // mutate cfg in place by replacing the handle's cfg snapshot for next-cycle comparisons
                    // (limits & status updates are observed by serve_proxy via the pulled cfg only at restart;
                    // for now we just keep the listener — admin can rotate to force a respawn).
                    continue;
                }
                // bind-affecting drift: stop and re-create.
                if let Some(h) = lst.remove(&p.id) {
                    let _ = h.stop.send(true);
                    h.task.abort();
                    if let Some(t) = h.tls_task { t.abort(); }
                    eprintln!("[agent] restarting proxy {} (bind/auth changed)", p.id);
                }
            }
            let stats_arc = {
                let mut sm = self.stats.lock().await;
                sm.entry(p.id.clone()).or_insert_with(|| Arc::new(ProxyStats::default())).clone()
            };
            // watch::channel(false) — reliable broadcast: send(true) is visible
            // to every Receiver clone, including any spawned just before the
            // send. Replaces the previous Arc<Notify> which dropped signals
            // when no .notified() future was currently being polled.
            let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
            let cfg_clone = p.clone();
            let stats_arc2 = stats_arc.clone();
            let locks_plain = self.proxy_locks.clone();
            let task = tokio::spawn(serve_proxy(cfg_clone, locks_plain, allow_private, stop_rx.clone(), stats_arc));
            let mut tls_task: Option<JoinHandle<()>> = None;
            if let Some(acc) = self.tls_acceptor.lock().await.clone() {
                if p.tls_port > 0 {
                    let cfg_tls = p.clone();
                    let locks_tls = self.proxy_locks.clone();
                    tls_task = Some(tokio::spawn(serve_proxy_tls(cfg_tls, acc, locks_tls, allow_private, stop_rx, stats_arc2)));
                }
            }
            lst.insert(p.id.clone(), ProxyHandle { cfg: p, stop: stop_tx, task, tls_task });
        }
        // Rebuild the unified-listener user index + trojan-hash index from
        // the current set of listeners + stats. Done under the tokio mutex
        // we already hold so the snapshot is consistent. The std::sync
        // RwLocks are held only for the swap.
        let mut next_user: HashMap<String, ProxyRef> = HashMap::with_capacity(lst.len());
        let mut next_trojan: HashMap<String, ProxyRef> = HashMap::with_capacity(lst.len());
        {
            let sm = self.stats.lock().await;
            for (id, h) in lst.iter() {
                let stats = match sm.get(id) { Some(s) => s.clone(), None => continue };
                let cfg_arc = Arc::new(h.cfg.clone());
                if !h.cfg.username.is_empty() {
                    next_user.insert(h.cfg.username.clone(), (cfg_arc.clone(), stats.clone()));
                }
                if !h.cfg.password.is_empty() {
                    next_trojan.insert(trojan_hash(&h.cfg.password), (cfg_arc, stats));
                }
            }
        }
        {
            let mut g = self.user_index.write().unwrap_or_else(|p| p.into_inner());
            *g = next_user;
        }
        {
            let mut g = self.trojan_index.write().unwrap_or_else(|p| p.into_inner());
            *g = next_trojan;
        }
    }
}

// ──────────────────────────── config persistence ────────────────────────────

async fn load_config(path: &PathBuf) -> AgentConfig {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    let mut cfg: AgentConfig = match tokio::fs::read_to_string(path).await {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AgentConfig::default(),
    };
    if cfg.control_url.is_empty() { cfg.control_url = env("PROXYBOX_CONTROL"); }
    if cfg.control_url.is_empty() { cfg.control_url = env("PROXYHUB_CONTROL"); } // legacy
    if cfg.token.is_empty() { cfg.token = env("PROXYBOX_TOKEN"); }
    if cfg.token.is_empty() { cfg.token = env("PROXYHUB_TOKEN"); } // legacy
    if cfg.enroll_token.is_empty() { cfg.enroll_token = env("PROXYBOX_ENROLL"); }
    if cfg.enroll_token.is_empty() { cfg.enroll_token = env("PROXYHUB_ENROLL"); } // legacy
    cfg.control_url = cfg.control_url.trim_end_matches('/').to_string();
    cfg
}
async fn save_config(path: &PathBuf, cfg: &AgentConfig) {
    let s = serde_json::to_string_pretty(cfg).unwrap_or_default();
    let _ = tokio::fs::write(path, s + "\n").await;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

// ──────────────────────────── main ──────────────────────────────────────────

fn main() {
    // musl libc gives the process main thread only ~80KB of stack — tokio + reqwest +
    // rustls overflow it instantly (silent SIGSEGV before any output). We sidestep by
    // running everything (including runtime construction) on a fresh thread with an
    // explicit 8MB stack, and give worker threads the same.
    let t = std::thread::Builder::new()
        .name("proxybox-main".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(|| {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_stack_size(8 * 1024 * 1024)
                .build()
                .expect("tokio runtime");
            rt.block_on(async_main());
        })
        .expect("spawn main worker");
    t.join().expect("main thread panicked");
}

async fn async_main() {
    // Config path: prefer new PROXYBOX_AGENT_CONFIG env var. If not set, fall back
    // to legacy PROXYHUB_AGENT_CONFIG, then to /etc/proxybox-agent.json (new default),
    // and finally /etc/proxyhub-agent.json (legacy default — keeps pre-rebrand
    // installs working without a manual migration step).
    let cfg_path: PathBuf = std::env::var("PROXYBOX_AGENT_CONFIG")
        .or_else(|_| std::env::var("PROXYHUB_AGENT_CONFIG"))
        .unwrap_or_else(|_| {
            let new_p = std::path::Path::new("/etc/proxybox-agent.json");
            let legacy = std::path::Path::new("/etc/proxyhub-agent.json");
            if new_p.exists() || !legacy.exists() {
                "/etc/proxybox-agent.json".to_string()
            } else {
                "/etc/proxyhub-agent.json".to_string()
            }
        }).into();
    let cfg = load_config(&cfg_path).await;
    if cfg.control_url.is_empty() {
        eprintln!("[agent] no controlUrl configured (PROXYBOX_CONTROL or {})", cfg_path.display());
        std::process::exit(1);
    }
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .build().expect("reqwest client");
    // If we already have an mTLS client cert from a previous enroll, build the client now.
    let mtls_initial = if !cfg.mtls_url.is_empty() && !cfg.ca_cert.is_empty() && !cfg.client_cert.is_empty() && !cfg.client_key.is_empty() {
        match build_mtls_client(&cfg.ca_cert, &cfg.client_cert, &cfg.client_key) {
            Ok(c) => { eprintln!("[agent] mTLS client loaded; agent channel will use mTLS"); Some(c) }
            Err(e) => { eprintln!("[agent] mTLS client build failed (falling back to bearer): {e}"); None }
        }
    } else { None };
    // Build TLS acceptor up front so the first proxy claim is fast.
    let tls_acceptor = match make_tls_acceptor().await {
        Ok(a) => Some(a),
        Err(e) => { eprintln!("[tls] disabled — {e}"); None }
    };
    let agent = Arc::new(Agent {
        cfg: Mutex::new(cfg),
        cfg_path,
        http,
        mtls: Mutex::new(mtls_initial),
        listeners: Mutex::new(HashMap::new()),
        stats: Mutex::new(HashMap::new()),
        tls_acceptor: Mutex::new(tls_acceptor),
        user_index: Arc::new(std::sync::RwLock::new(HashMap::new())),
        trojan_index: Arc::new(std::sync::RwLock::new(HashMap::new())),
        last_rev: std::sync::atomic::AtomicU64::new(0),
        proxy_locks: Arc::new(std::sync::Mutex::new(HashMap::new())),
        pending_results: Mutex::new(Vec::new()),
        executed_command_ids: Mutex::new(std::collections::HashSet::new()),
    });

    if let Err(e) = agent.enroll_if_needed().await { eprintln!("[agent] fatal: {e}"); std::process::exit(1); }
    if let Err(e) = agent.register().await { eprintln!("[agent] register: {e}"); }
    // Now that enrollment is complete, the cfg holds the agent token +
    // control URL — bootstrap the fire-and-forget error reporter so
    // bind/listen/cert failures land in the panel's /admin/errors view.
    {
        let c = agent.cfg.lock().await;
        if !c.token.is_empty() && !c.control_url.is_empty() {
            let _ = REPORTER.set(Reporter {
                http: agent.http.clone(),
                base: c.control_url.clone(),
                token: c.token.clone(),
            });
        }
    }
    // Panic hook: any task that panics gets logged to /admin/errors. Tokio
    // already isolates panics (one panicked task doesn't kill the runtime)
    // but the panic itself was previously only on stderr. Now it surfaces
    // in the central error log alongside everything else. We chain to the
    // default hook so stderr backtraces still print as before.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info.payload().downcast_ref::<&str>().map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<panic without message>".to_string());
        let loc = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        report_err("error", "panic", format!("panicked at {loc}: {msg}"), serde_json::json!({"location": loc}), None);
        default_hook(info);
    }));
    let url = agent.cfg.lock().await.control_url.clone();
    eprintln!("[agent] registered with {url} (v{AGENT_VERSION})");

    // Spawn heartbeat before the initial reconcile so control-plane visibility
    // is not blocked by the (potentially long) proxy startup sweep.
    let a2 = agent.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
        loop { ticker.tick().await; if let Err(e) = a2.heartbeat().await { eprintln!("[agent] heartbeat: {e}"); } }
    });

    agent.reconcile().await;

    let a1 = agent.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop { ticker.tick().await; a1.reconcile().await; }
    });

    // Unified listener — one accept port for ALL proxies, routed by username
    // from Proxy-Authorization. Lets a single node host 100k+ proxies without
    // exhausting the 16-bit TCP port space (per-proxy listeners stay up too
    // for backwards compatibility — customers keep their old URLs working).
    {
        let cfg_snap = agent.cfg.lock().await.clone();
        let allow_private = cfg_snap.proxy_defaults.allow_private_targets;
        let workers = num_cpus_capped(64);
        let port = cfg_snap.unified_plain_port;
        if port > 0 {
            let ui = agent.user_index.clone();
            let lk = agent.proxy_locks.clone();
            tokio::spawn(async move { serve_unified_plain(port, workers, ui, lk, allow_private).await; });
        }
        let tls_port = cfg_snap.unified_tls_port;
        if tls_port > 0 {
            if let Some(acc) = agent.tls_acceptor.lock().await.clone() {
                let ui = agent.user_index.clone();
                let ti = agent.trojan_index.clone();
                let lk = agent.proxy_locks.clone();
                tokio::spawn(async move { serve_unified_tls(tls_port, workers, acc, ui, ti, lk, allow_private).await; });
            }
        }
    }

    // v6 reaper — every 60 s, remove any /128 on the egress NIC that isn't
    // claimed by an active proxy's current bind IP. Caps the interface to
    // (#proxies + recently-rotated-in-grace) v6 addresses so getifaddrs
    // dumps stay cheap. Without this the rotation primitive accumulates
    // stale /128 forever and CPU/load explode on master push storms.
    let a4 = agent.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            // Active set = union of (a) live listeners' cfg.bind_ip and
            // (b) recently-tracked LAST_BIND_PER_PROXY values, so an IP
            // that is mid-grace-period stays protected.
            let mut active: std::collections::HashSet<Ipv6Addr> = std::collections::HashSet::new();
            {
                let lst = a4.listeners.lock().await;
                for h in lst.values() {
                    if h.cfg.kind.eq_ignore_ascii_case("IPv6") {
                        if let Ok(v6) = h.cfg.bind_ip.parse::<Ipv6Addr>() { active.insert(v6); }
                    }
                }
            }
            {
                let g = LAST_BIND_PER_PROXY.lock().unwrap_or_else(|p| p.into_inner());
                if let Some(m) = g.as_ref() { for v in m.values() { active.insert(*v); } }
            }
            if active.is_empty() { continue; } // never reap when we don't know what's active
            tokio::task::spawn_blocking(move || { reap_stale_v6(active, 3000); invalidate_v6_pool_cache(); }).await.ok();
        }
    });

    // Mbps sampler — every 5s, snapshot total bytes per proxy and store delta/period
    // as a rolling rate in ProxyStats so heartbeats expose live throughput.
    let a3 = agent.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            let stats_snapshot: Vec<Arc<ProxyStats>> = a3.stats.lock().await.values().cloned().collect();
            for s in stats_snapshot {
                let up = s.upload_bytes.load(Ordering::Relaxed);
                let dn = s.download_bytes.load(Ordering::Relaxed);
                let total = up + dn;
                let last_total = s.sample_last_total.load(Ordering::Relaxed);
                let last_ms = s.sample_last_ms.load(Ordering::Relaxed);
                if last_ms != 0 && now_ms > last_ms {
                    let dt_ms = now_ms - last_ms;
                    let delta = total.saturating_sub(last_total);
                    // split delta proportionally between up/down for the gauge
                    let up_last = s.bps_in.load(Ordering::Relaxed); // reused below
                    let _ = up_last;
                    let bps_total = delta.saturating_mul(1000) / dt_ms.max(1);
                    // Cheap approximation: assume roughly half/half — accurate enough for a gauge
                    s.bps_out.store(bps_total / 2, Ordering::Relaxed);
                    s.bps_in.store(bps_total / 2, Ordering::Relaxed);
                }
                s.sample_last_total.store(total, Ordering::Relaxed);
                s.sample_last_ms.store(now_ms, Ordering::Relaxed);
            }
        }
    });

    // Wait for shutdown signal
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("[agent] shutdown");
}
