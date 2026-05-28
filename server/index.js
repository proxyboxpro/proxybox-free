import crypto from 'node:crypto'
import { exec as execChild, spawn as spawnChild } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import ssh2 from 'ssh2'
import forge from 'node-forge'
import { setupOauthRoutes } from './oauth.js'
import * as virtualizor from './virtualizor.js'
import { DOCS_EN } from './_docs_en.mjs'

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message)
  // Guarded — logError() may not be initialized yet on early boot.
  try { logError({ source: 'panel', level: 'error', code: 'uncaught', message: err.message, context: { stack: (err.stack || '').split('\n').slice(0, 6).join('\n') } }) } catch {}
})
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message ?? String(reason)
  console.error('[unhandledRejection]', msg)
  try { logError({ source: 'panel', level: 'error', code: 'unhandled-rejection', message: msg, context: { stack: (reason?.stack || '').split('\n').slice(0, 6).join('\n') } }) } catch {}
})

// node:sqlite is stable in Node 22.22+; fallback gracefully if missing.
let sqliteDb = null
try {
  const sqlite = await import('node:sqlite')
  sqliteDb = new sqlite.DatabaseSync(process.env.PROXY_SQLITE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.db'))
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT,
      ip TEXT,
      method TEXT,
      path TEXT,
      status INTEGER,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
    CREATE INDEX IF NOT EXISTS audit_actor ON audit(actor);
    CREATE INDEX IF NOT EXISTS audit_path ON audit(path);
    CREATE TABLE IF NOT EXISTS history (
      proxy_id TEXT NOT NULL,
      hour TEXT NOT NULL,
      upload_bytes INTEGER NOT NULL DEFAULT 0,
      download_bytes INTEGER NOT NULL DEFAULT 0,
      bps_in INTEGER NOT NULL DEFAULT 0,
      bps_out INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (proxy_id, hour)
    );
    CREATE INDEX IF NOT EXISTS history_proxy_hour ON history(proxy_id, hour DESC);
    CREATE TABLE IF NOT EXISTS conn_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      proxy_id TEXT NOT NULL,
      owner_id TEXT,
      src TEXT,
      src_port INTEGER DEFAULT 0,
      host TEXT,
      port INTEGER DEFAULT 0,
      up INTEGER DEFAULT 0,
      dn INTEGER DEFAULT 0,
      ms INTEGER DEFAULT 0,
      kind TEXT
    );
    CREATE INDEX IF NOT EXISTS conn_events_proxy_ts ON conn_events(proxy_id, ts DESC);
    CREATE INDEX IF NOT EXISTS conn_events_owner_ts ON conn_events(owner_id, ts DESC);
    CREATE INDEX IF NOT EXISTS conn_events_host_ts  ON conn_events(host, ts DESC);
    CREATE INDEX IF NOT EXISTS conn_events_ts       ON conn_events(ts DESC);
    CREATE TABLE IF NOT EXISTS geo_cache (
      ip TEXT PRIMARY KEY,
      country TEXT,
      country_code TEXT,
      asn TEXT,
      asn_org TEXT,
      fetched_at INTEGER NOT NULL,
      failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS geo_cache_fetched ON geo_cache(fetched_at);
    CREATE TABLE IF NOT EXISTS billing_tx (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS billing_user ON billing_tx(user_id, ts DESC);
    -- OSS download tracker: every fetch of /install-panel.sh (panel installer)
    -- or /api/agent/claim-binary*/claim-* (agent binaries / install scripts)
    -- inserts a row so admin can see who's installing what + when. Per-IP
    -- dedup happens at query time (count distinct ip per kind per day).
    CREATE TABLE IF NOT EXISTS oss_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ip TEXT,
      ua TEXT,
      referer TEXT
    );
    CREATE INDEX IF NOT EXISTS oss_downloads_ts ON oss_downloads(ts DESC);
    CREATE INDEX IF NOT EXISTS oss_downloads_kind ON oss_downloads(kind, ts DESC);
    -- Centralized error log. Dedup key is (source, code, resolved=0): repeats
    -- bump count + last_ts instead of inserting new rows. Purged after 30d.
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_ts INTEGER NOT NULL,
      last_ts INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,             -- panel | agent | sweep | watchdog | client | mtls | auto-heal | ...
      level TEXT NOT NULL,              -- error | warn | info
      code TEXT,                        -- short stable identifier (e.g. 'sweep:timeout', 'agent:stale')
      message TEXT,
      context TEXT,                     -- JSON blob with extra fields (proxy_id, node_id, etc.)
      node_id TEXT,
      proxy_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER,
      resolved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS errors_last_ts ON errors(last_ts DESC);
    CREATE INDEX IF NOT EXISTS errors_unresolved ON errors(resolved, last_ts DESC);
    CREATE INDEX IF NOT EXISTS errors_dedup ON errors(source, code, resolved);
  `)
  // Versioned migrations. v1: the `history` table used to store a cumulative
  // snapshot per hour bucket (running total), which made every hourly chart
  // and window-sum read back as an ever-rising staircase. The write path now
  // stores per-hour deltas, so the legacy rows are incompatible — drop them
  // once. conn_events is untouched (it was always per-connection-accurate),
  // so true window totals survive the wipe.
  try {
    const uv = sqliteDb.prepare('PRAGMA user_version').get()
    const ver = Number(uv && (uv.user_version ?? uv['user_version'])) || 0
    if (ver < 1) {
      sqliteDb.exec('DELETE FROM history')
      sqliteDb.exec('PRAGMA user_version = 1')
      console.log('[sqlite] migration v1: cleared legacy cumulative history rows')
    }
  } catch (e) { console.warn(`[sqlite] history migration skipped: ${e.message}`) }
  console.log(`[sqlite] data store opened at ${process.env.PROXY_SQLITE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.db')}`)
} catch (e) {
  console.warn(`[sqlite] disabled (${e.message}); audit + history will use in-memory + JSONL`)
  sqliteDb = null
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const configPath = process.env.PROXY_CONFIG || path.join(__dirname, 'config.json')
const ordersPath = process.env.PROXY_ORDERS || path.join(__dirname, 'orders.json')
const auditPath = process.env.PROXY_AUDIT || path.join(__dirname, 'audit.log')

const WEAK_API_KEYS = new Set(['', 'dev', 'change-me', 'change-me-in-production', 'REPLACE_WITH_RANDOM_SECRET'])
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const IPV6_POOL_PER_PREFIX = 256

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

const config = await loadConfig()
let orders = await loadOrders()

// Startup orphan-cleanup pass — strictly enforces cross-ownership between
// orders[] and config.proxies[]:
//   1. Drop proxies whose orderId points to a missing / cancelled / refunded
//      order, or has no real ownerId (legacy seed data with owner=null).
//   2. For each order: strip proxyIds where proxy.orderId !== order.id
//      (prevents seed orders from claiming another order's proxies).
//   3. If an order's proxyIds is now empty and it wasn't refunded, mark it
//      'cancelled' with cancelReason='orphan-startup-cleanup'.
{
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const removedProxies = []
  for (let i = config.proxies.length - 1; i >= 0; i--) {
    const p = config.proxies[i]
    const ord = p.orderId ? orderById.get(p.orderId) : null
    const orderAlive = ord && (ord.status === 'paid' || ord.status === 'active')
    const hasOwner = !!(ord && ord.ownerId)
    if (!orderAlive || !hasOwner) {
      removedProxies.push(p)
      config.proxies.splice(i, 1)
    }
  }
  const proxyOwnerOrder = new Map() // pid -> proxy.orderId
  for (const p of config.proxies) proxyOwnerOrder.set(p.id, p.orderId)
  let cleaned = 0
  for (const o of orders) {
    const before = (o.proxyIds || []).length
    o.proxyIds = (o.proxyIds || []).filter((id) => proxyOwnerOrder.get(id) === o.id)
    if (o.proxyIds.length === 0 && before > 0 && o.status !== 'refunded') {
      o.status = 'cancelled'
      if (!o.cancelledAt) o.cancelledAt = new Date().toISOString()
      o.cancelReason = o.cancelReason || 'orphan-startup-cleanup'
      cleaned += 1
    } else if (o.proxyIds.length !== before) {
      cleaned += 1
    }
  }
  if (removedProxies.length || cleaned) {
    console.log(`[startup] orphan cleanup: removed ${removedProxies.length} proxy(ies) without a live owning order, fixed ${cleaned} order(s)`)
    if (removedProxies.length) await saveConfig().catch(() => {})
    if (cleaned) await saveOrders().catch(() => {})
  }
}

let detected = detectNetwork()
const masterKey = await loadMasterKey()
let pki = null
try { pki = await ensurePki() } catch (error) { console.warn(`[api] mTLS disabled (cert setup failed): ${error.message}`) }
let proxyTls = null
try { proxyTls = await ensureProxyTls() } catch (error) { console.warn(`[proxy-tls] disabled: ${error.message}`) }

const listeners = new Map()
const stats = new Map()
const sessions = new Map()
// 3-tier anti-abuse cap. Goal: comfortable use (Chrome ~6 conn/tab, scraper
// pools ~10-50 workers) while killing pathological burst (10k concurrent
// would OOM the agent at ~280KB RAM per relayed connection).
//
//   A. maxConnsPerProxy   — hard total per proxy across every protocol + IP
//   B. maxConnsPerSrcIp   — within that total, one source IP cannot hog all
//      slots; lets a second device in the same household still connect
//   C. newConnsPerSecPerIp — burst rate limit (catches 10k-in-1s flood
//      attempts that would otherwise pass A+B briefly before sockets close)
//
// Defaults live in `config.proxyDefaults.*` so they can be retuned without
// a code change. Per-proxy overrides on the proxy itself.
function capA(p) { return Number(p?.maxConnsPerProxy   || config.proxyDefaults.maxConnsPerProxy   || 100) }
function capB(p) { return Number(p?.maxConnsPerSrcIp   || config.proxyDefaults.maxConnsPerSrcIp   || 60) }
function capC(p) { return Number(p?.newConnsPerSecPerIp|| config.proxyDefaults.newConnsPerSecPerIp|| 30) }

const proxySessions = new Map() // proxyId -> { sockets, byIp:Map<ip,Set>, rate:Map<ip,{sec,count}> }
function sessionFor(proxyId) {
  let s = proxySessions.get(proxyId)
  if (!s) { s = { sockets: new Set(), byIp: new Map(), rate: new Map() }; proxySessions.set(proxyId, s) }
  return s
}
function acquireProxySession(proxy, socket, srcIp) {
  const s = sessionFor(proxy.id)
  const ip = srcIp || 'unknown'
  // C: per-IP per-second burst cap
  const sec = Math.floor(Date.now() / 1000)
  let r = s.rate.get(ip)
  if (!r || r.sec !== sec) { r = { sec, count: 0 }; s.rate.set(ip, r) }
  r.count += 1
  if (r.count > capC(proxy)) return false
  // A: total per proxy
  if (s.sockets.size >= capA(proxy)) return false
  // B: per source IP within proxy
  let ipSet = s.byIp.get(ip)
  if (!ipSet) { ipSet = new Set(); s.byIp.set(ip, ipSet) }
  if (ipSet.size >= capB(proxy)) return false
  // Accept
  s.sockets.add(socket)
  ipSet.add(socket)
  socket.once('close', () => {
    s.sockets.delete(socket)
    ipSet.delete(socket)
    if (ipSet.size === 0) s.byIp.delete(ip)
  })
  return true
}
function kickAllProxySessions(proxyId) {
  const s = proxySessions.get(proxyId)
  if (!s) return 0
  const n = s.sockets.size
  for (const sock of s.sockets) { try { sock.destroy() } catch {} }
  s.sockets.clear()
  s.byIp.clear()
  s.rate.clear()
  return n
}
function readProxySession(proxyId) {
  const s = proxySessions.get(proxyId)
  if (!s) return { active: 0, max: Number(config.proxyDefaults.maxConnsPerProxy || 100), byIp: [] }
  const byIp = []
  for (const [ip, set] of s.byIp) byIp.push({ ip, count: set.size })
  byIp.sort((a, b) => b.count - a.count)
  return {
    active: s.sockets.size,
    max: Number(config.proxyDefaults.maxConnsPerProxy || 100),
    maxPerIp: Number(config.proxyDefaults.maxConnsPerSrcIp || 60),
    rateLimit: Number(config.proxyDefaults.newConnsPerSecPerIp || 30),
    byIp
  }
}
// GC: drop rate buckets older than 60s so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - 60
  for (const s of proxySessions.values()) {
    for (const [ip, r] of s.rate) if (r.sec < cutoff) s.rate.delete(ip)
  }
}, 60_000).unref()
// Per-order shared rate buckets â€” multiple proxies belonging to the same order
// share a single token bucket so order.bytesPerSec caps the GROUP's total throughput,
// not each member's individually.
const orderBuckets = new Map() // orderId -> { secKey, secBytes }
let selfMetricsCache = { ts: 0, value: null }
let lastCpuSample = null
let lastNetSample = null

ensureApiKey()
warnWeakUsers()
// Migrate customer apiKeys to unified usr_ format — one-shot, idempotent.
// Existing legacy hex keys keep working (X-Customer-Key still validates them),
// but BYON requires the usr_ prefix, so every customer needs a fresh-format
// key. Run once at startup; later writes use generateUserToken() directly.
;(function migrateCustomerApiKeys() {
  let dirty = false
  for (const u of (config.users || [])) {
    if ((u.role || 'customer') !== 'customer') continue
    if (!u.apiKey || !String(u.apiKey).startsWith('usr_')) {
      u.apiKey = generateUserToken(u.id)
      dirty = true
    }
  }
  if (dirty) saveConfig().catch(() => {})
})()

for (const proxy of config.proxies) {
  ensureStats(proxy.id)
  if ((proxy.nodeId || 'local') === 'local') startProxy(proxy)
}

sweepExpired()
// Hub expiry sweeper — runs every 5 min. Hubs past expiresAt with no auto-
// extend get destroyed: Virtualizor deletes the VM, then the node row is
// removed. Resolves the VZ instance PER-HUB (each hub may live on a
// different Virtualizor panel for multi-zone setups); only falls back to
// the legacy single-instance config when the hub row has no `hub.instanceId`.
// Earlier version bailed at the top when `config.virtualizor.enabled` was
// false — which is the normal state for multi-instance setups — leaving
// every expired hub VPS running on the panel forever.
setInterval(async () => {
  const now = Date.now()
  const dueNodes = (config.nodes || []).filter((n) =>
    n.hub && n.hub.expiresAt && new Date(n.hub.expiresAt).getTime() <= now
  )
  if (!dueNodes.length) return
  for (const n of dueNodes) {
    const vzInst = n.hub?.instanceId ? findVirtualizorInstance({ id: n.hub.instanceId }) : null
    const cfg = vzInst ? decryptVirtualizorInstance(vzInst) : decryptedVirtualizorConfig()
    if (cfg && n.hub.vpsid) {
      try {
        await virtualizor.deleteVs(cfg, n.hub.vpsid)
        console.log(`[hub-expire] destroyed vpsid=${n.hub.vpsid} (node=${n.id})`)
      } catch (e) {
        console.warn(`[hub-expire] VZ delete failed for vpsid=${n.hub.vpsid}: ${e.message}`)
        // Keep node row so an admin can investigate / retry — don't silently
        // delete the bookkeeping when the VPS is still alive on the panel.
        continue
      }
    } else {
      console.warn(`[hub-expire] no VZ creds for node=${n.id} (instanceId=${n.hub?.instanceId}); skipping VZ delete`)
    }
    kickAgentEmpty(n.id)
    config.proxies = (config.proxies || []).filter((p) => p.nodeId !== n.id)
    config.nodes = config.nodes.filter((x) => x.id !== n.id)
    audit({ actor: 'system', ip: '-', method: 'AUTO', path: '/sweep/hubs', note: `expired hub destroyed node=${n.id} vpsid=${n.hub.vpsid}` })
  }
  saveConfig().catch(() => {})
}, 5 * 60 * 1000).unref()

// Resolve SSH creds for a node. Hub VPS uses the rootPass we generated at
// provision time + the IPv4 we got from Virtualizor; admin pool nodes use
// the sshSecret/sshKeySecret set when the admin registered them. Returns
// null if no usable creds exist (typical for BYON nodes claimed via fleet
// token — the customer never gave us SSH access).
function nodeSshCreds(node) {
  if (node?.hub?.rootPassEncrypted && node.hub.ipv4) {
    const pw = decryptSecret(node.hub.rootPassEncrypted)
    if (pw) return { host: node.hub.ipv4, port: 22, username: 'root', password: pw, source: 'hub' }
  }
  if (node?.sshSecret || node?.sshKeySecret) {
    return {
      host: node.host,
      port: Number(node.sshPort) || 22,
      username: node.sshUser || 'root',
      password: decryptSecret(node.sshSecret) || undefined,
      privateKey: decryptSecret(node.sshKeySecret) || undefined,
      source: 'admin-pool'
    }
  }
  return null
}

// Resolve the Virtualizor instance creds for power-control of a hub VPS.
function hubVzCfg(node) {
  if (!node?.hub?.vpsid) return null
  const instId = node.hub.instanceId || null
  const inst = instId ? findVirtualizorInstance({ id: instId }) : null
  return inst ? decryptVirtualizorInstance(inst) : decryptedVirtualizorConfig()
}

// Queue an agent-channel command for `node`. Returns the queued descriptor
// so callers can show the id to the operator. Commands sit on the node until
// the agent picks them up via heartbeat (or until they expire after 5min).
// Whitelist of `action` values is enforced at agent side, but we also reject
// anything not on this list here for defence-in-depth.
const QUEUEABLE_ACTIONS = new Set(['diagnose', 'reboot', 'restart-self', 'refresh-network', 'drain'])
function queueAgentCommand(node, action, params = {}) {
  if (!QUEUEABLE_ACTIONS.has(action)) throw new Error(`action "${action}" not queueable for agent-channel`)
  node.pendingCommands = node.pendingCommands || []
  const cmd = {
    id: crypto.randomBytes(8).toString('hex'),
    action,
    params,
    queuedAt: new Date().toISOString()
  }
  node.pendingCommands.push(cmd)
  // Wake any active long-poll waiter so the next /api/agent/proxies response
  // includes the new revision header — agent heartbeat is ~10s, so wait is
  // bounded even without explicit kick.
  bumpConfigRev()
  return cmd
}

// Dispatcher for /api/nodes/:id/action/:name. Each branch is a discrete
// remote operation; failures return 502 with the upstream error message so
// admins can diagnose what went wrong without tailing logs.
async function handleNodeAction(req, res, node, action) {
  const actor = actorOf(req)
  const ip = clientIp(req)
  const audited = (note) => audit({ actor, ip, method: 'POST', path: `/api/nodes/${node.id}/action/${action}`, note })

  // ── Power control (hub VPS only — uses Virtualizor) ─────────────────────
  if (['power-off', 'power-on', 'power-reset', 'vz-reboot'].includes(action)) {
    if (!node?.hub?.vpsid) return sendJson(res, 400, { error: 'power control only available for hub VPS' })
    const cfg = hubVzCfg(node)
    if (!cfg) return sendJson(res, 503, { error: 'Virtualizor instance not configured for this hub' })
    const map = { 'power-off': 'poweroff', 'power-on': 'start', 'power-reset': 'restart', 'vz-reboot': 'restart' }
    try {
      const r = await virtualizor.vsAction(cfg, node.hub.vpsid, map[action])
      audited(`virtualizor ${map[action]} vpsid=${node.hub.vpsid}`)
      return sendJson(res, 200, { ok: true, via: 'virtualizor', action: map[action], raw: r })
    } catch (e) { return sendJson(res, 502, { error: `Virtualizor ${map[action]} failed: ${e.message}` }) }
  }

  // ── SSH-backed actions ───────────────────────────────────────────────────
  const creds = nodeSshCreds(node)

  if (action === 'reboot') {
    // Prefer Virtualizor power-reset for hub VPS (works even when sshd is
    // hung). Fall back to SSH `shutdown -r now` for admin pool nodes.
    if (node?.hub?.vpsid) {
      const cfg = hubVzCfg(node)
      if (cfg) {
        try {
          await virtualizor.vsAction(cfg, node.hub.vpsid, 'restart')
          audited(`reboot via virtualizor vpsid=${node.hub.vpsid}`)
          return sendJson(res, 200, { ok: true, via: 'virtualizor' })
        } catch (e) { /* fall through to SSH */ }
      }
    }
    if (!creds) return sendJson(res, 501, { error: 'no SSH credentials and no Virtualizor link — cannot reboot' })
    try {
      // `nohup … &` so the SSH session returns before the reboot kills it.
      await sshExec(creds, 'nohup bash -c "sleep 1 && /sbin/shutdown -r now" >/dev/null 2>&1 &', 15_000)
      audited(`reboot via ssh host=${creds.host}`)
      return sendJson(res, 200, { ok: true, via: 'ssh' })
    } catch (e) { return sendJson(res, 502, { error: `SSH reboot failed: ${e.message}` }) }
  }

  if (action === 'restart-agent' && creds) {
    try {
      const r = await sshExec(creds, '(systemctl restart proxybox-agent 2>/dev/null || systemctl restart proxyhub-agent) && (systemctl is-active proxybox-agent 2>/dev/null || systemctl is-active proxyhub-agent)', 30_000)
      audited(`restart-agent code=${r.code}`)
      return sendJson(res, 200, { ok: r.code === 0, code: r.code, output: (r.output || '').slice(-2000) })
    } catch (e) { return sendJson(res, 502, { error: `restart-agent failed: ${e.message}` }) }
  }

  if (action === 'diagnose' && creds) {
    // NOTE: we intentionally never invoke `/opt/proxybox-agent/proxybox-agent`
    // directly — the binary ignores --version and just starts running as the
    // agent (blocks indefinitely, kills the SSH session). Use systemctl
    // status to extract the running version from the service banner instead.
    const cmd = [
      'echo "=== uptime ==="; uptime',
      'echo "=== loadavg ==="; cat /proc/loadavg',
      'echo "=== mem ==="; free -h',
      'echo "=== disk ==="; df -hT / 2>/dev/null',
      'echo "=== agent ==="; (systemctl is-active proxybox-agent 2>/dev/null || systemctl is-active proxyhub-agent 2>/dev/null)',
      '(systemctl status proxybox-agent --no-pager 2>/dev/null || systemctl status proxyhub-agent --no-pager 2>/dev/null) | head -3',
      'echo "=== net ==="; ip -br addr 2>/dev/null | head -10',
      'echo "=== conns ==="; ss -tn 2>/dev/null | head -10'
    ].join(' ; ')
    try {
      const r = await sshExec(creds, cmd, 60_000)
      audited(`diagnose code=${r.code}`)
      return sendJson(res, 200, { ok: r.code === 0, code: r.code, output: (r.output || '').slice(-8000) })
    } catch (e) { return sendJson(res, 502, { error: `diagnose failed: ${e.message}` }) }
  }

  if (action === 'refresh-network' && creds) {
    try {
      const r = await sshExec(creds, 'ip -j addr show 2>/dev/null || ip addr show', 15_000)
      const out = String(r.output || '')
      // Best-effort parse — extract first non-loopback IPv4 + IPv6.
      const v4 = (out.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).find((x) => !x.startsWith('127.'))
      // Naive IPv6 regex would match MAC addresses like 00:11:22:33:44:55. We
      // ask Node's `net.isIP()` to validate every candidate and additionally
      // skip strings whose every group is exactly 2 hex chars (MAC shape).
      const v6Candidates = (out.match(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi) || [])
      const v6 = v6Candidates.find((x) => {
        if (x.startsWith('::') || x.startsWith('fe80')) return false
        if (net.isIP(x) !== 6) return false
        if (x.split(':').every((g) => g.length === 2)) return false   // MAC-shaped
        return true
      })
      if (v4 && net.isIP(v4) === 4) {
        node.network = node.network || {}
        node.network.ipv4 = [{ address: v4 }]
      }
      if (v6 && net.isIP(v6) === 6) {
        node.network = node.network || {}
        node.network.ipv6 = [{ address: v6 }]
      }
      await saveConfig()
      audited(`network refreshed v4=${v4 || '-'} v6=${v6 || '-'}`)
      return sendJson(res, 200, { ok: true, ipv4: v4 || null, ipv6: v6 || null, raw: out.slice(-3000) })
    } catch (e) { return sendJson(res, 502, { error: `network refresh failed: ${e.message}` }) }
  }

  if (action === 'drain') {
    // Drain = soft-disable: agent's next /api/agent/proxies returns []
    // (existing connections continue in-flight until customer disconnects;
    // new connections fail until admin enables/deletes the node).
    node.disabled = true
    node.drainedAt = new Date().toISOString()
    kickAgentEmpty(node.id)
    await saveConfig()
    audited('drain — node disabled + agent kicked')
    return sendJson(res, 200, { ok: true })
  }

  if (action === 'undrain') {
    if (!node.disabled) return sendJson(res, 200, { ok: true, already: true })
    node.disabled = false
    node.drainedAt = null
    bumpConfigRev()
    await saveConfig()
    audited('undrain — node re-enabled')
    return sendJson(res, 200, { ok: true })
  }

  if (action === 'suspend-all-proxies') {
    let n = 0
    for (const p of config.proxies) {
      if (p.nodeId === node.id && p.status === 'active' && !p.suspended) {
        p.suspended = true
        p.suspendedAt = new Date().toISOString()
        n += 1
      }
    }
    if (n) { bumpConfigRev(); await saveConfig() }
    audited(`suspend-all-proxies: ${n} proxies suspended`)
    return sendJson(res, 200, { ok: true, suspended: n })
  }

  if (action === 'resume-all-proxies') {
    let n = 0
    for (const p of config.proxies) {
      if (p.nodeId === node.id && p.suspended) {
        delete p.suspended
        delete p.suspendedAt
        n += 1
      }
    }
    if (n) { bumpConfigRev(); await saveConfig() }
    audited(`resume-all-proxies: ${n} proxies resumed`)
    return sendJson(res, 200, { ok: true, resumed: n })
  }

  if (action === 'tail-logs') {
    if (!creds) return sendJson(res, 501, { error: 'no SSH credentials' })
    const lines = Math.min(500, Math.max(50, Number(new URL(req.url, 'http://x').searchParams.get('lines')) || 100))
    try {
      const r = await sshExec(creds, `journalctl -u proxybox-agent --no-pager -n ${lines} 2>/dev/null; journalctl -u proxyhub-agent --no-pager -n ${lines} 2>/dev/null`, 20_000)
      audited(`tail-logs lines=${lines}`)
      return sendJson(res, 200, { ok: r.code === 0, output: (r.output || '').slice(-16000) })
    } catch (e) { return sendJson(res, 502, { error: `tail-logs failed: ${e.message}` }) }
  }

  if (action === 'upgrade') {
    // Force the agent to fetch+swap the latest binary now. Best-effort via
    // SSH (runs the one-liner); falls back to bumping upgradeToken + setting
    // LATEST flag so the next heartbeat tells the agent to self-upgrade.
    if (!node.upgradeToken) node.upgradeToken = crypto.randomBytes(24).toString('hex')
    await saveConfig()
    const oneLiner = `curl -fsSL ${controlBaseUrl()}/api/agent/upgrade-script/${node.upgradeToken} | sudo bash`
    if (creds) {
      try {
        const r = await sshExec(creds, oneLiner, 90_000)
        audited(`upgrade via ssh code=${r.code}`)
        return sendJson(res, 200, { ok: r.code === 0, via: 'ssh', code: r.code, output: (r.output || '').slice(-3000) })
      } catch (e) { /* fall through to heartbeat-based upgrade */ }
    }
    // No SSH — return the one-liner so admin can run it manually; the next
    // heartbeat will also surface `updateAvailable` when versions drift, so
    // a customer-rebooted BYON will pick up the new binary automatically.
    audited('upgrade fallback (no ssh) — exposed one-liner')
    return sendJson(res, 200, { ok: true, via: 'heartbeat', oneLiner, hint: 'agent will pick up at next heartbeat once version drifts' })
  }

  if (action === 'install-package') {
    // Strict whitelist of OS packages an admin can ask us to apt-install on a
    // node. Reading-only / diagnostic tools only — nothing that exposes new
    // network surface or modifies firewall rules.
    const ALLOWED_PKGS = new Set([
      'htop', 'atop', 'iperf3', 'mtr-tiny', 'mtr', 'vnstat', 'tcpdump',
      'jq', 'dnsutils', 'net-tools', 'sysstat', 'iotop', 'bpytop'
    ])
    if (!creds) return sendJson(res, 501, { error: 'install-package requires SSH credentials' })
    const params = req.headers['content-type']?.includes('application/json') ? await readJson(req) : {}
    const pkg = String(params.package || '').trim()
    if (!ALLOWED_PKGS.has(pkg)) {
      return sendJson(res, 400, { error: `package "${pkg}" not in whitelist`, allowed: [...ALLOWED_PKGS] })
    }
    try {
      // -y for non-interactive; -qq to suppress progress noise (still logs errors).
      const r = await sshExec(creds, `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkg}`, 180_000)
      audited(`install-package ${pkg} code=${r.code}`)
      return sendJson(res, 200, { ok: r.code === 0, code: r.code, output: (r.output || '').slice(-4000) })
    } catch (e) { return sendJson(res, 502, { error: `install-package failed: ${e.message}` }) }
  }

  if (action === 'rotate-token') {
    // Mint a fresh agentToken; old one is invalidated immediately. Admin
    // then needs to push the new token onto the box (we do it via SSH if
    // we have creds, otherwise admin must re-run the install one-liner).
    const newTok = crypto.randomBytes(24).toString('hex')
    node.agentToken = newTok
    await saveConfig()
    let pushed = false
    if (creds) {
      try {
        const cmd = `bash -c 'CFG=/etc/proxybox-agent.json; [ -f "$CFG" ] || CFG=/etc/proxyhub-agent.json; jq --arg t "${newTok}" \\".token=\\$t\\" "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG" && (systemctl restart proxybox-agent 2>/dev/null || systemctl restart proxyhub-agent)'`
        const r = await sshExec(creds, cmd, 20_000)
        pushed = r.code === 0
      } catch { /* swallow — admin can re-install if push failed */ }
    }
    audited(`rotate-token pushed=${pushed}`)
    return sendJson(res, 200, { ok: true, newToken: newTok, pushedToAgent: pushed })
  }

  // Agent-channel fallback: if the action is queueable AND the node has no
  // SSH path, queue it for the agent to pick up via heartbeat. The
  // `restart-agent` -> `restart-self` rename happens here so the agent
  // doesn't need to know about service names.
  if (QUEUEABLE_ACTIONS.has(action) || action === 'restart-agent') {
    const queueAction = action === 'restart-agent' ? 'restart-self' : action
    try {
      const cmd = queueAgentCommand(node, queueAction)
      await saveConfig()
      audited(`queued ${queueAction} via agent-channel (id=${cmd.id})`)
      return sendJson(res, 202, {
        ok: true, via: 'agent-channel',
        queuedId: cmd.id,
        hint: 'agent will pick up command at next heartbeat (≤10s) and report result in the one after'
      })
    } catch (e) { return sendJson(res, 400, { error: e.message }) }
  }

  return sendJson(res, 400, { error: `unknown action: ${action}`, supported: ['reboot', 'restart-agent', 'diagnose', 'refresh-network', 'drain', 'tail-logs', 'rotate-token', 'upgrade', 'install-package', 'power-off', 'power-on', 'power-reset', 'vz-reboot'] })
}

// Background SSH bootstrap for hub VPS — Virtualizor OS templates don't ship
// cloud-init binary on this panel, so we install the agent over SSH instead.
// Steps: poll VZ until vpsid unlocks (install done) → SSH into the VPS using
// the rootPass we generated → run the agent installer → mark hub.state.
async function bootstrapHubViaSsh(node, user, plan) {
  const hub = node.hub
  if (!hub) return
  const setState = async (state, log) => {
    hub.state = state
    if (log) hub.bootstrapLog = String(log).slice(-2000)
    await saveConfig().catch(() => {})
  }
  await setState('waiting-install')

  // Resolve VZ instance creds (per-instance preferred, legacy fallback).
  const vzInst = hub.instanceId ? (config.virtualizors || []).find((v) => v.id === hub.instanceId) : null
  const cfg = vzInst ? decryptVirtualizorInstance(vzInst) : decryptedVirtualizorConfig()
  if (!cfg) return setState('install_failed', 'no virtualizor creds available')

  // Poll up to 8 minutes for VZ install lock to release.
  let unlocked = false
  for (let i = 0; i < 32; i++) {
    try {
      const detail = await virtualizor.vsDetail(cfg, hub.vpsid)
      const locked = !!(detail?.vps?.locked || detail?.vps?.suspended === '1')
      if (!locked) { unlocked = true; break }
    } catch (e) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 15_000))
  }
  if (!unlocked) return setState('install_failed', 'VZ install lock never released (>8min)')

  // Need IPv4 to SSH in. If the buy flow didn't pick it up earlier (race with
  // VZ assigning IPs), retry the detail call now that install is done.
  if (!hub.ipv4) {
    try {
      const detail = await virtualizor.vsDetail(cfg, hub.vpsid)
      const ips = detail?.vps?.ips || {}
      for (const v of Object.values(ips)) {
        const ip = typeof v === 'string' ? v : v?.ip
        if (ip && net.isIP(ip.split('/')[0]) === 4) { hub.ipv4 = ip; node.host = ip; break }
        if (ip && ip.includes(':') && !hub.ipv6) hub.ipv6 = ip.split('/')[0]
      }
      await saveConfig().catch(() => {})
    } catch { /* ignore */ }
  }
  if (!hub.ipv4) return setState('install_failed', 'VPS has no IPv4 — cannot reach to bootstrap')
  // SSRF guard: VZ panel could be compromised and return a crafted IP
  // (127.0.0.1, RFC1918, link-local, cloud metadata 169.254.169.254, …) →
  // we'd SSH into our own control plane or an internal service. Reject any
  // IP that isn't a globally routable public address.
  const ipBare = hub.ipv4.split('/')[0]
  if (net.isIP(ipBare) !== 4 || isBlockedTarget(ipBare)) {
    return setState('install_failed', `VZ returned non-public IPv4 (${ipBare}); refusing to SSH`)
  }

  await setState('installing')
  const rootPass = decryptSecret(hub.rootPassEncrypted)
  if (!rootPass) return setState('install_failed', 'rootPass decrypt failed')
  const familyFlag = plan.family === 'ipv6' ? 'v6' : 'v4'
  const token = user.apiKey
  const installCmd = `curl -fsSL ${controlBaseUrl()}/api/agent/claim/${token} | bash -s ${familyFlag}`

  // Try SSH for up to ~3 minutes — sshd often takes 30-60s post-unlock to be
  // ready on a fresh image.
  let lastErr = ''
  for (let i = 0; i < 12; i++) {
    try {
      const r = await sshExec({ host: hub.ipv4, port: 22, username: 'root', password: rootPass }, installCmd, 240_000)
      const tail = String(r.output || '').slice(-1500)
      if (r.code === 0) return setState('install_done', tail)
      lastErr = `code=${r.code} ${tail}`
    } catch (e) { lastErr = e.message || String(e) }
    await new Promise((r) => setTimeout(r, 15_000))
  }
  await setState('install_failed', lastErr)
}

// Cadences pulled from admin Operations tab — let admin retune without
// restart. Reading inside the interval callback so changes take effect on the
// NEXT tick. The interval itself stays at the initial 60s base + check.
const SWEEP_BASE_TICK_MS = 60 * 1000
let _lastExpiredSweepAt = 0
let _lastAutoRotateSweepAt = 0
setInterval(() => {
  const now = Date.now()
  const expIntervalMs = Math.max(60, Number(config.operations?.sweepExpiredIntervalMin || 5) * 60) * 1000
  const rotIntervalMs = Math.max(10, Number(config.operations?.sweepAutoRotateIntervalSec || 60)) * 1000
  if (now - _lastExpiredSweepAt >= expIntervalMs) { _lastExpiredSweepAt = now; sweepExpired() }
  if (now - _lastAutoRotateSweepAt >= rotIntervalMs) { _lastAutoRotateSweepAt = now; sweepAutoRotate() }
}, SWEEP_BASE_TICK_MS).unref()
// Customer self-service: auto-renew proxies near expiry if user opted in.
setInterval(() => { sweepAutoRenew()  }, 10 * 60 * 1000).unref()
// Continuous health check: probe every active proxy every 5 minutes through its
// listener, track SLA + auto-rotate dead IPs. Industry standard for managed pools.
setInterval(() => { runHealthSweep() }, 5 * 60 * 1000).unref()
setInterval(() => { detected = detectNetwork() }, 5 * 60 * 1000).unref()
setInterval(() => { cleanupSessions() }, 60 * 60 * 1000).unref()
setInterval(() => { sweepNodes() }, 30 * 1000).unref()

// Per-node basic rate limit for the agent-side /api/agent/error endpoint:
// drops anything beyond ~60 errors/min/node so a runaway agent can't blow
// up the errors table. Dedup at logError() still kicks in for repeats.
const agentErrorRate = new Map()

// Agent watchdog: every 60s, scan all nodes for (a) silent-agent timeouts,
// (b) resource thresholds (RAM/load). Each guard dedupes via logError's
// (source, code, node_id) key so a sustained problem coalesces into 1 row
// with an incrementing count rather than firing 1440 alerts/day.
setInterval(() => {
  if (!Array.isArray(config.nodes)) return
  const now = Date.now()
  const SILENT_MS = 5 * 60 * 1000
  for (const n of config.nodes) {
    if (!n.lastSeenAt) continue
    const age = now - new Date(n.lastSeenAt).getTime()
    if (age > SILENT_MS && n.status !== 'offline') {
      logError({ source: 'watchdog', level: 'error', code: 'agent:silent', message: `Agent ${n.name || n.id} silent for ${Math.round(age / 60000)}min`, nodeId: n.id, context: { lastSeenAt: n.lastSeenAt, ageMs: age } })
      n.status = 'offline'
      pushAlert(`node:${n.id}:silent`, `Node ${n.name || n.id} hasn't heartbeated in ${Math.round(age / 60000)}min — agent likely down.`, 'error')
    }
    // Resource thresholds — node only reports load1/ramPct via heartbeat,
    // so we eval against latest snapshot. Only fire for ONLINE nodes (an
    // offline node already has its own watchdog alert and stale metrics).
    if (n.status === 'online' && n.metrics) {
      const ramThreshold  = Number(n.alerts?.ramPct) || 90
      const loadThreshold = Number(n.alerts?.load1)  || 100
      const ramPct = Number(n.metrics.ramPct) || 0
      if (ramPct >= ramThreshold) {
        logError({ source: 'watchdog', level: 'warn', code: 'node:ram-high', message: `RAM ${ramPct}% on ${n.name || n.id} (threshold ${ramThreshold}%)`, nodeId: n.id, context: { ramPct, threshold: ramThreshold, ramUsed: n.metrics.ramUsed, ramTotal: n.metrics.ramTotal } })
      }
      const load1 = Number(n.metrics.load1) || 0
      if (load1 >= loadThreshold) {
        logError({ source: 'watchdog', level: 'warn', code: 'node:load-high', message: `load1=${load1.toFixed(0)} on ${n.name || n.id} (threshold ${loadThreshold})`, nodeId: n.id, context: { load1, threshold: loadThreshold, load5: n.metrics.load5, cpuPct: n.metrics.cpuPct } })
      }
    }
  }
}, 60_000).unref()

const apiServer = http.createServer(handleHttp)
apiServer.listen(config.api.port, config.api.host, () => {
  console.log(`[api] listening on http://${config.api.host}:${config.api.port}`)
  console.log(`[api] detected ${detected.ipv4.length} IPv4 address(es), ${detected.ipv6Prefixes.length} IPv6 prefix(es)`)
  // Startup validator: find any proxy port↔tlsPort collisions caused by a
  // bulk-allocator that bypassed nextPort(). Won't auto-fix in case the
  // ports are in use by external clients, but warns prominently so admin
  // can run `node scripts/relocate-tls-ports.mjs` (or call the admin API).
  validatePortCollisions()
})

function validatePortCollisions() {
  const usedPlain = new Map(); const usedTls = new Map();
  for (const p of config.proxies) {
    if (Number.isFinite(p.port)) usedPlain.set(Number(p.port), p.id);
    if (Number.isFinite(p.tlsPort)) usedTls.set(Number(p.tlsPort), p.id);
  }
  const collisions = []
  for (const p of config.proxies) {
    const a = usedTls.get(Number(p.port)); if (a && a !== p.id) collisions.push({ id: p.id, port: p.port, conflictWith: a, kind: 'plain-vs-tls' });
    const b = usedPlain.get(Number(p.tlsPort)); if (b && b !== p.id) collisions.push({ id: p.id, tlsPort: p.tlsPort, conflictWith: b, kind: 'tls-vs-plain' });
  }
  if (collisions.length > 0) {
    const uniq = new Set(collisions.map(c => c.id)).size
    console.warn(`[validator] WARNING: ${collisions.length} proxy port↔tlsPort collisions detected — ${uniq} unique proxies affected`)
    console.warn(`[validator] First 3:`, collisions.slice(0, 3))
    console.warn(`[validator] Run POST /api/admin/maintenance/relocate-tls-ports to auto-fix (admin auth required)`)
    // Surface in /admin/errors so admins don't have to grep journalctl on boot.
    logError({ source: 'validator', level: 'error', code: 'port-collision', message: `${collisions.length} port collisions across ${uniq} proxies — auto-fix at POST /api/admin/maintenance/relocate-tls-ports`, context: { count: collisions.length, uniqueProxies: uniq, sample: collisions.slice(0, 3) } })
  } else {
    console.log(`[validator] ${config.proxies.length} proxies: 0 port collisions`)
  }
}

if (pki) {
  const mtlsServer = https.createServer(
    { key: pki.srvKeyPem, cert: pki.srvCertPem, ca: pki.caCertPem, requestCert: true, rejectUnauthorized: false },
    handleMtls
  )
  mtlsServer.on('error', (error) => {
    console.error(`[mtls] listener error: ${error.message}`)
    logError({ source: 'mtls', level: 'error', code: 'listener-error', message: error.message })
  })
  mtlsServer.listen(mtlsPort(), mtlsHost(), () => {
    console.log(`[mtls] agent listener on https://${mtlsHost()}:${mtlsPort()} (client-cert auth)`)
  })
}

// ---------------------------------------------------------------------------
// Config + persistence
// ---------------------------------------------------------------------------

async function loadConfig() {
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf8')
  } catch {
    raw = await fs.readFile(path.join(__dirname, 'config.example.json'), 'utf8')
  }
  const parsed = JSON.parse(raw)
  parsed.api ||= {}
  parsed.api.host ||= '0.0.0.0'
  parsed.api.port = Number(parsed.api.port || 8787)
  parsed.api.corsOrigins ||= []
  parsed.network ||= {}
  parsed.proxyDefaults ||= {}
  parsed.proxyDefaults.listenHost ||= '0.0.0.0'
  parsed.proxyDefaults.portStart = Number(parsed.proxyDefaults.portStart || 10000)
  parsed.proxyDefaults.expiresDays = Number(parsed.proxyDefaults.expiresDays || 30)
  parsed.proxyDefaults.allowPrivateTargets = Boolean(parsed.proxyDefaults.allowPrivateTargets)
  // Unified listener — single accept port per agent that routes by username.
  // Off by default: with 65k TCP ports per host the per-proxy listener
  // model handles realistic scale (~30k proxies/node) fine, and the
  // product model is "1 port = 1 customer IP" which is naturally
  // expressed by per-proxy ports. Operators serving 100k+ proxies/node
  // can flip `unifiedListener.enabled = true` in config; both modes can
  // run side-by-side so existing customer URLs never break.
  parsed.unifiedListener ||= {}
  parsed.unifiedListener.enabled = parsed.unifiedListener.enabled === true
  parsed.unifiedListener.plainPort = Number(parsed.unifiedListener.plainPort || 7777)
  parsed.unifiedListener.tlsPort = Number(parsed.unifiedListener.tlsPort || 7778)
  parsed.users ||= []
  parsed.proxies ||= []
  parsed.nodes ||= []
  return parsed
}

const APP_VERSION = '1.3.0'
// Canonical agent version expected by this control plane. Bumped whenever the
// heartbeat protocol or persisted-stat shape changes — the heartbeat response
// reports `updateAvailable` to any agent reporting a different string so the
// admin UI can prompt the user to run the upgrade command on that node.
const LATEST_AGENT_VERSION = '1.9.0'

// Bumped on every saveConfig so agents long-polling /api/agent/proxies?rev=N
// wake up immediately when their target config drifts (rotation, expiry, port
// changes). Without this, a /rotate hit took up to POLL_INTERVAL (~10s) before
// the egress IP actually changed on the remote agent.
let configRev = 1
const agentWaiters = new Map() // nodeId -> Set<{ res, timeout }>

// Force the agent on `nodeId` to reconcile to an empty list right now —
// even if it's between long-polls, we wake any active waiter with []. Used
// as a belt-and-suspenders signal BEFORE the node row is deleted so the
// remote agent stops its listeners; once the node is gone, the next pull
// returns 401 which (on rust + node fallback) also drops all listeners.
function kickAgentEmpty(nodeId) {
  const waiters = agentWaiters.get(nodeId)
  if (!waiters || !waiters.size) return
  for (const w of [...waiters]) {
    try { clearTimeout(w.timeout) } catch {}
    waiters.delete(w)
    try { sendAgentList(w.res, []) } catch {}
  }
}

function bumpConfigRev() {
  configRev += 1
  for (const [nodeId, waiters] of agentWaiters) {
    if (!waiters.size) continue
    const node = config.nodes.find((n) => n.id === nodeId)
    for (const w of [...waiters]) {
      try { clearTimeout(w.timeout) } catch {}
      waiters.delete(w)
      try {
        if (!node || node.disabled) { sendAgentList(w.res, []) }
        else { sendAgentList(w.res, agentListFor(node)) }
      } catch {}
    }
  }
}
function agentListFor(node) {
  const fam = (node.family || 'dual').toLowerCase()
  return config.proxies.filter((p) => {
    if (p.nodeId !== node.id) return false
    if (p.status === 'expired') return false
    if (p.suspended) return false
    const pf = p.type === 'IPv6' ? 'ipv6' : 'ipv4'
    if (fam === 'dual') return true
    return fam === pf
  }).map(agentProxy)
}
function sendAgentList(res, list) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(200, { 'Content-Type': 'application/json', 'X-Config-Rev': String(configRev) })
  res.end(JSON.stringify(list))
}
async function saveConfig() {
  await writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`)
  bumpConfigRev()
}

async function loadOrders() {
  try {
    const raw = await fs.readFile(ordersPath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveOrders() {
  await writeFileAtomic(ordersPath, `${JSON.stringify(orders, null, 2)}\n`)
}

async function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

// â”€â”€ Secret encryption (for stored SSH credentials etc.) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadMasterKey() {
  const keyPath = process.env.PROXY_MASTER_KEY || path.join(__dirname, 'master.key')
  try {
    const buf = await fs.readFile(keyPath)
    if (buf.length === 32) return buf
  } catch { /* generate below */ }
  const key = crypto.randomBytes(32)
  try { await fs.writeFile(keyPath, key, { mode: 0o600 }) } catch { /* best effort */ }
  return key
}
function encryptSecret(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}
function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string') return null
  const parts = blob.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[1], 'base64'))
    d.setAuthTag(Buffer.from(parts[2], 'base64'))
    return Buffer.concat([d.update(Buffer.from(parts[3], 'base64')), d.final()]).toString('utf8')
  } catch { return null }
}

// Transparent secret accessors. Stored values that start with `v1:` are
// AES-256-GCM ciphertext (auth-tag-protected, IV-prefixed) — only the
// process holding `server/master.key` (chmod 600) can decrypt. Legacy
// values still in plaintext are returned as-is and are migrated to
// ciphertext the next time an admin saves them. `readSecret` never
// throws — it returns '' on missing / decrypt failure so the caller
// can surface a clean error.
function readSecret(stored) {
  if (!stored || typeof stored !== 'string') return ''
  if (stored.startsWith('v1:')) return decryptSecret(stored) || ''
  return stored
}
function writeSecret(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return ''
  return encryptSecret(String(plaintext)) || ''
}
// Masked view for admin "view config" responses. Decrypts once, returns
// "••••<last4>" without ever including the rest of the secret.
function maskSecret(stored) {
  const clear = readSecret(stored)
  if (!clear) return ''
  return '••••' + clear.slice(-4)
}

// â”€â”€ mTLS PKI (control plane is the CA; agents get client certs at enrollment) â”€
async function ensurePki() {
  const dir = path.join(__dirname, 'pki')
  await fs.mkdir(dir, { recursive: true })
  const caCertPath = path.join(dir, 'ca.crt')
  const caKeyPath = path.join(dir, 'ca.key')
  const srvCertPath = path.join(dir, 'server.crt')
  const srvKeyPath = path.join(dir, 'server.key')

  let caCertPem, caKeyPem
  try {
    caCertPem = await fs.readFile(caCertPath, 'utf8')
    caKeyPem = await fs.readFile(caKeyPath, 'utf8')
    forge.pki.certificateFromPem(caCertPem)
  } catch {
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex')
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)
    const attrs = [{ name: 'commonName', value: 'ProxyBox CA' }, { name: 'organizationName', value: 'ProxyBox' }]
    cert.setSubject(attrs); cert.setIssuer(attrs)
    cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    caCertPem = forge.pki.certificateToPem(cert)
    caKeyPem = forge.pki.privateKeyToPem(keys.privateKey)
    await fs.writeFile(caKeyPath, caKeyPem, { mode: 0o600 })
    await fs.writeFile(caCertPath, caCertPem, { mode: 0o644 })
  }
  const caCert = forge.pki.certificateFromPem(caCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)

  // server cert (regenerate if missing or expired)
  let srvCertPem, srvKeyPem
  let needSrv = true
  try {
    srvCertPem = await fs.readFile(srvCertPath, 'utf8')
    srvKeyPem = await fs.readFile(srvKeyPath, 'utf8')
    if (forge.pki.certificateFromPem(srvCertPem).validity.notAfter > new Date(Date.now() + 30 * 24 * 3600 * 1000)) needSrv = false
  } catch { /* generate */ }
  if (needSrv) {
    const ips = [...new Set([...detected.ipv4.map((e) => e.address), '127.0.0.1', config.api.host].filter((x) => x && net.isIP(x)))]
    const altNames = [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))]
    const r = makeSignedCert('proxyhub-control-plane', altNames, caKey, caCert, 5)
    srvCertPem = r.certPem; srvKeyPem = r.keyPem
    await fs.writeFile(srvKeyPath, srvKeyPem, { mode: 0o600 })
    await fs.writeFile(srvCertPath, srvCertPem, { mode: 0o644 })
  }
  return { caCertPem, caKeyPem, caCert, caKey, srvCertPem, srvKeyPem }
}

function makeSignedCert(cn, altNames, caKey, caCert, years) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + years * 365 * 24 * 3600 * 1000)
  cert.setSubject([{ name: 'commonName', value: cn }])
  cert.setIssuer(caCert.subject.attributes)
  const exts = [{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true, clientAuth: true }]
  if (altNames && altNames.length) exts.push({ name: 'subjectAltName', altNames })
  cert.setExtensions(exts)
  cert.sign(caKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

function issueClientCert(nodeId) {
  if (!pki) return null
  return makeSignedCert(nodeId, null, pki.caKey, pki.caCert, 2)
}

// Self-signed cert used by the TLS-wrap proxy port (HTTPS-proxy + Trojan).
// Clients always pass `allowInsecure=1` / "trust on first use" so chain
// validation is not required — we just need a valid cert/key that survives
// across restarts. SAN includes every detectable non-loopback IP so the cert
// matches whichever address the user dials.
async function ensureProxyTls() {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const certPath = path.join(dir, 'proxy-tls.cert.pem')
  const keyPath = path.join(dir, 'proxy-tls.key.pem')
  let certPem = null
  let keyPem = null
  try {
    certPem = await fs.readFile(certPath, 'utf8')
    keyPem = await fs.readFile(keyPath, 'utf8')
    const parsed = forge.pki.certificateFromPem(certPem)
    if (parsed.validity.notAfter < new Date(Date.now() + 30 * 24 * 3600 * 1000)) {
      certPem = null; keyPem = null
    }
  } catch { /* generate */ }
  if (!certPem || !keyPem) {
    const ips = [...new Set([
      ...detected.ipv4.map((e) => e.address),
      ...detected.ipv6.map((e) => e.address),
      '127.0.0.1'
    ].filter((x) => x && net.isIP(x)))]
    const altNames = [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))]
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex')
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000)
    const attrs = [{ name: 'commonName', value: 'proxyhub-edge' }]
    cert.setSubject(attrs); cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames }
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    certPem = forge.pki.certificateToPem(cert)
    keyPem = forge.pki.privateKeyToPem(keys.privateKey)
    await fs.writeFile(keyPath, keyPem, { mode: 0o600 })
    await fs.writeFile(certPath, certPem, { mode: 0o644 })
  }
  return { cert: certPem, key: keyPem }
}

function trojanHash(password) {
  return crypto.createHash('sha224').update(String(password), 'utf8').digest('hex')
}

function nodeFromClientCert(socket) {
  if (!socket || !socket.authorized) return null
  const cert = socket.getPeerCertificate()
  const cn = cert && cert.subject && cert.subject.CN
  if (!cn) return null
  return config.nodes.find((n) => n.id === cn) || null
}

// â”€â”€ SSH-push install (control plane installs the agent on a node) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fire a JSON POST to the configured alert webhook (Telegram/Slack/Discord).
// Best-effort â€” silently logs on failure so the alerter never breaks the API.
const lastAlertAt = new Map() // key -> ts
function pushAlert(key, message, severity = 'warn') {
  const url = config.alerts?.webhookUrl
  if (!url) return
  const now = Date.now()
  const prev = lastAlertAt.get(key) || 0
  const dedupeMs = Math.max(0, Number(config.alerts?.dedupeMinutes || 5)) * 60_000
  if (now - prev < dedupeMs) return
  lastAlertAt.set(key, now)
  const payload = { ts: new Date().toISOString(), severity, key, message, host: detected.ipv4[0]?.address || config.api.host }
  try {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const data = Buffer.from(JSON.stringify(payload))
    const req = lib.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'content-type': 'application/json', 'content-length': data.length }
    }, (res) => { res.on('data', () => {}); res.on('end', () => {}) })
    req.on('error', (e) => console.warn(`[alerts] webhook failed: ${e.message}`))
    req.end(data)
  } catch (e) { console.warn(`[alerts] webhook error: ${e.message}`) }
}

// Per-proxy hourly history. SQLite when available (queryable across restarts,
// any retention window); falls back to a 24-bucket in-memory ringbuffer.
const proxyHistory = new Map() // id -> { hourKey, samples: [{ts, up, down, bpsIn, bpsOut}] }
// Each call ADDS the per-hour delta (bytes since the previous sample) so a
// bucket holds the traffic that happened *within* that hour — not a running
// cumulative snapshot. bps is a rate, so keep the peak observed in the hour.
const historyUpsertStmt = sqliteDb ? sqliteDb.prepare(`
  INSERT INTO history (proxy_id, hour, upload_bytes, download_bytes, bps_in, bps_out)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(proxy_id, hour) DO UPDATE SET
    upload_bytes = upload_bytes + excluded.upload_bytes,
    download_bytes = download_bytes + excluded.download_bytes,
    bps_in = MAX(bps_in, excluded.bps_in),
    bps_out = MAX(bps_out, excluded.bps_out)
`) : null
// Per-connection event log (7-day rolling window by default). Each closed
// relay writes one row — gives admins + customers queryable history for
// "top destinations", "traffic by source IP", and audit/billing.
const CONN_EVENTS_RETENTION_DAYS = 30
// Defensive migration: add src_port to legacy databases that pre-date this
// column. Errors when column already exists, which is fine.
if (sqliteDb) {
  try { sqliteDb.exec('ALTER TABLE conn_events ADD COLUMN src_port INTEGER DEFAULT 0') } catch { /* already present */ }
}
const connEventInsertStmt = sqliteDb ? sqliteDb.prepare(`
  INSERT INTO conn_events (ts, proxy_id, owner_id, src, src_port, host, port, up, dn, ms, kind)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`) : null
const connEventPruneStmt = sqliteDb ? sqliteDb.prepare('DELETE FROM conn_events WHERE ts < ?') : null
function pruneConnEvents() {
  if (!connEventPruneStmt) return
  try {
    const cutoff = Date.now() - CONN_EVENTS_RETENTION_DAYS * 86_400_000
    const info = connEventPruneStmt.run(cutoff)
    if (info && info.changes > 0) console.log(`[conn_events] pruned ${info.changes} row(s) older than ${CONN_EVENTS_RETENTION_DAYS}d`)
  } catch { /* noop */ }
}
// Prune once on boot, then hourly.
pruneConnEvents()
setInterval(pruneConnEvents, 3600_000).unref()

// ── Accurate rolling-window byte totals (from the per-connection event log) ──
// conn_events is the authoritative source: one row per closed relay with exact
// up/down bytes. We sum it over 1h / 24h / 30d windows in a single pass using
// conditional SUMs. This is what "tổng lưu lượng up/down trong 1h/1 ngày/1
// tháng" means — cumulative transferred bytes, NOT instantaneous bps.
// up = client→proxy (upload), down = target→proxy (download).
const WINDOW_SECS = { h1: 3600, h24: 86_400, d30: 2_592_000 }
const WINDOW_SELECT = `
    SELECT
      COALESCE(SUM(CASE WHEN ts >= ? THEN up ELSE 0 END), 0) AS up1,
      COALESCE(SUM(CASE WHEN ts >= ? THEN dn ELSE 0 END), 0) AS dn1,
      COALESCE(SUM(CASE WHEN ts >= ? THEN up ELSE 0 END), 0) AS up24,
      COALESCE(SUM(CASE WHEN ts >= ? THEN dn ELSE 0 END), 0) AS dn24,
      COALESCE(SUM(up), 0) AS up30,
      COALESCE(SUM(dn), 0) AS dn30
    FROM conn_events WHERE `
const connWindowStmt = sqliteDb ? {
  proxy: sqliteDb.prepare(`${WINDOW_SELECT} proxy_id = ? AND ts >= ?`),
  owner: sqliteDb.prepare(`${WINDOW_SELECT} owner_id = ? AND ts >= ?`)
} : null
function emptyWindows() {
  return { h1: { up: 0, down: 0 }, h24: { up: 0, down: 0 }, d30: { up: 0, down: 0 } }
}
// scope: { by: 'proxy'|'owner', id: <value> }
function connWindowTotals(scope) {
  if (!connWindowStmt || !scope || !scope.id) return emptyWindows()
  const stmt = scope.by === 'owner' ? connWindowStmt.owner : connWindowStmt.proxy
  const now = Date.now()
  const c1 = now - WINDOW_SECS.h1 * 1000
  const c24 = now - WINDOW_SECS.h24 * 1000
  const c30 = now - WINDOW_SECS.d30 * 1000
  try {
    const r = stmt.get(c1, c1, c24, c24, scope.id, c30)
    return {
      h1:  { up: Number(r.up1)  || 0, down: Number(r.dn1)  || 0 },
      h24: { up: Number(r.up24) || 0, down: Number(r.dn24) || 0 },
      d30: { up: Number(r.up30) || 0, down: Number(r.dn30) || 0 }
    }
  } catch { return emptyWindows() }
}

// ── Geo/ASN enrichment via ip-api.com (free, anonymous, 45 req/min) ──
// Cache keyed by IP, 7-day TTL, persisted in SQLite. Failed lookups stored
// with `failed=1` and a short retry window so we don't hammer a flaky API.
const GEO_CACHE_TTL_MS = 7 * 86_400_000  // 7 days for success
const GEO_FAIL_TTL_MS  = 1 * 3_600_000   // 1 hour for failure
const geoCacheGet    = sqliteDb ? sqliteDb.prepare('SELECT country, country_code AS countryCode, asn, asn_org AS asnOrg, fetched_at AS fetchedAt, failed FROM geo_cache WHERE ip = ?') : null
const geoCacheInsert = sqliteDb ? sqliteDb.prepare('INSERT INTO geo_cache (ip, country, country_code, asn, asn_org, fetched_at, failed) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET country = excluded.country, country_code = excluded.country_code, asn = excluded.asn, asn_org = excluded.asn_org, fetched_at = excluded.fetched_at, failed = excluded.failed') : null
const geoMemory = new Map() // ip -> { country, countryCode, asn, asnOrg, fetchedAt, failed }
const geoInFlight = new Map() // ip -> Promise
const geoHostToIp = new Map() // host -> { ip, ts }

function geoCacheLookup(ip) {
  const mem = geoMemory.get(ip)
  if (mem) return mem
  if (!geoCacheGet) return null
  try {
    const row = geoCacheGet.get(ip)
    if (row) { geoMemory.set(ip, row); return row }
  } catch { /* noop */ }
  return null
}
function geoCacheStore(ip, data) {
  geoMemory.set(ip, data)
  if (!geoCacheInsert) return
  try { geoCacheInsert.run(ip, data.country || '', data.countryCode || '', data.asn || '', data.asnOrg || '', data.fetchedAt, data.failed ? 1 : 0) } catch { /* noop */ }
}
async function fetchGeoFromApi(ip) {
  return new Promise((resolve) => {
    const req = http.request({
      method: 'GET',
      hostname: 'ip-api.com',
      path: `/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,as,asname`,
      timeout: 4000,
      headers: { 'User-Agent': 'ProxyBox-Geo' }
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(buf)
          if (j.status === 'success') {
            return resolve({ country: j.country || '', countryCode: j.countryCode || '', asn: j.as || '', asnOrg: j.asname || '', fetchedAt: Date.now(), failed: 0 })
          }
        } catch { /* noop */ }
        resolve({ country: '', countryCode: '', asn: '', asnOrg: '', fetchedAt: Date.now(), failed: 1 })
      })
    })
    req.on('error', () => resolve({ country: '', countryCode: '', asn: '', asnOrg: '', fetchedAt: Date.now(), failed: 1 }))
    req.on('timeout', () => { req.destroy(); resolve({ country: '', countryCode: '', asn: '', asnOrg: '', fetchedAt: Date.now(), failed: 1 }) })
    req.end()
  })
}
async function lookupGeo(ip) {
  if (!ip || ip === '0.0.0.0' || ip === '::') return null
  // Quick reject: skip private/loopback ranges (geo APIs reject anyway).
  if (net.isIP(ip) && isBlockedTarget(ip)) return null
  const cached = geoCacheLookup(ip)
  if (cached) {
    const ttl = cached.failed ? GEO_FAIL_TTL_MS : GEO_CACHE_TTL_MS
    if (Date.now() - (cached.fetchedAt || 0) < ttl) return cached.failed ? null : cached
  }
  if (geoInFlight.has(ip)) return geoInFlight.get(ip)
  const p = (async () => {
    const data = await fetchGeoFromApi(ip)
    geoCacheStore(ip, data)
    return data.failed ? null : data
  })()
  geoInFlight.set(ip, p)
  try { return await p } finally { geoInFlight.delete(ip) }
}
async function resolveHostCached(host) {
  if (!host) return null
  if (net.isIP(host)) return host
  const cached = geoHostToIp.get(host)
  if (cached && Date.now() - cached.ts < 600_000) return cached.ip
  try {
    const addresses = await dns.lookup(host).catch(() => null)
    if (addresses && addresses.address) {
      geoHostToIp.set(host, { ip: addresses.address, ts: Date.now() })
      return addresses.address
    }
  } catch { /* noop */ }
  return null
}
async function lookupGeoForHost(host) {
  const ip = await resolveHostCached(host)
  return ip ? lookupGeo(ip) : null
}
// Resolve geo for a batch of {ip|host} concurrently with cap, returns Map.
async function batchGeoEnrich(entries) {
  const out = new Map()
  const queue = entries.slice()
  const workers = []
  const N = 6
  for (let i = 0; i < N; i++) {
    workers.push((async () => {
      while (queue.length) {
        const { key, type } = queue.shift()
        try {
          const g = type === 'host' ? await lookupGeoForHost(key) : await lookupGeo(key)
          if (g) out.set(key, g)
        } catch { /* noop */ }
      }
    })())
  }
  await Promise.all(workers)
  return out
}

// ── SSE: live connection event stream ─────────────────────────────────────
// Admins open an EventSource which keeps a long-lived response. Each closed
// relay (recordConnection) is fanned out to all subscribers so the UI sees
// real-time activity without polling.
const sseClients = new Set()
function pushSseEvent(kind, payload) {
  if (!sseClients.size) return
  const line = `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of sseClients) {
    try { res.write(line) } catch { /* drop on next tick */ }
  }
}
function recordHistorySample(id, s) {
  const now = new Date()
  const hourKey = now.toISOString().slice(0, 13)
  // s.uploadBytes/downloadBytes are cumulative since (re)start. Persist the
  // *delta* since the previous sample so each hour bucket = traffic within
  // that hour. histLast* tracks the last seen cumulative reading; both reset
  // to 0 alongside uploadBytes (server restart or admin reset-stats), so the
  // first delta after a reset is just the post-reset cumulative — never < 0.
  const curUp = Number(s.uploadBytes) || 0
  const curDown = Number(s.downloadBytes) || 0
  const dUp = Math.max(0, curUp - (Number(s.histLastUp) || 0))
  const dDown = Math.max(0, curDown - (Number(s.histLastDown) || 0))
  s.histLastUp = curUp
  s.histLastDown = curDown
  const bpsIn = Number(s.bpsIn) || 0
  const bpsOut = Number(s.bpsOut) || 0
  if (historyUpsertStmt) {
    try { historyUpsertStmt.run(id, hourKey, dUp, dDown, bpsIn, bpsOut) } catch {}
  }
  // In-memory fallback (only consulted when SQLite is unavailable): mirror the
  // same per-hour-delta semantics — accumulate into the current hour bucket.
  let h = proxyHistory.get(id)
  if (!h) { h = { hourKey: '', samples: [] }; proxyHistory.set(id, h) }
  if (h.hourKey !== hourKey || !h.samples.length) {
    h.hourKey = hourKey
    h.samples.push({ ts: now.toISOString(), uploadBytes: dUp, downloadBytes: dDown, bpsIn, bpsOut })
    if (h.samples.length > 24) h.samples.splice(0, h.samples.length - 24)
  } else {
    const last = h.samples[h.samples.length - 1]
    last.ts = now.toISOString()
    last.uploadBytes += dUp
    last.downloadBytes += dDown
    last.bpsIn = Math.max(last.bpsIn, bpsIn)
    last.bpsOut = Math.max(last.bpsOut, bpsOut)
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Raw SMTP+STARTTLS sender (zero npm deps). Sends a plain-text or HTML email
// via the SMTP server configured at config.smtp.{host,port,user,pass,from}.
// Use case: provision notification, expire warning, invoice link. Silently
// best-effort â€” never throws so a mail outage can't break the API.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Fire a customer-configured webhook with a JSON event. Signs with HMAC-SHA256
// using the user's apiKey as the secret so the receiver can verify origin.
function sendCustomerWebhook(url, payload) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const body = JSON.stringify({ ts: new Date().toISOString(), ...payload })
      const lib = u.protocol === 'https:' ? https : http
      const req = lib.request({
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 5_000
      }, (res) => { res.on('data', () => {}); res.on('end', () => resolve(true)) })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.end(body)
    } catch { resolve(false) }
  })
}

// â”€â”€ Hourly pricing + zone defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function defaultPricing() {
  return {
    ipv4: { perHour: 300 },   // 300 VND/hour â‰ˆ 7.2k/day, â‰ˆ 216k/month
    ipv6: { perHour: 200 },
    currency: 'vnd',
    minHours: 1,
    maxHours: 8760, // 1 year
    tiers: [{ min: 10, discount: 0.1 }, { min: 50, discount: 0.2 }]
  }
}
function defaultDocs() {
  const now = new Date().toISOString()
  return [
    { id: 'd-overview', slug: 'how-it-works', category: 'Bắt đầu', order: 0, published: true,
      title: 'ProxyBox — Tổng quan kiến trúc',
      body: [
        'ProxyBox là 1 hệ thống proxy phân tán gồm 2 thành phần chính:',
        '',
        '• **Control plane** — server trung tâm (cái bạn đang truy cập). Quản lý user, billing, cấp proxy, đẩy config tới các agent.',
        '• **Agent (node)** — chạy trên VM/server thực, lắng nghe port proxy, route traffic ra internet bằng IP riêng của nó.',
        '',
        'Mỗi proxy bạn mua sẽ:',
        '1. Được cấp 1 port duy nhất + user/pass riêng',
        '2. Map tới 1 IP egress (IPv4 cố định hoặc IPv6 rotating pool)',
        '3. Hỗ trợ 4 protocol trên cùng port: HTTP CONNECT/GET, SOCKS5, HTTPS-proxy (TLS), Trojan',
        '',
        '**Bạn có 2 cách dùng**:',
        '• **Mua từ pool**: trả theo giờ, dùng hạ tầng của chúng tôi (IPv4 datacenter / IPv6 /48 prefix).',
        '• **BYON (Bring Your Own Node)**: cài agent lên VM của bạn → tạo proxy miễn phí chạy trên VM đó. Bạn trả tiền VM cho provider, chúng tôi chỉ quản lý.',
        '',
        '**Token duy nhất**: tài khoản auto-tạo 1 token format `usr_<id>_<hex>` dùng cho TẤT CẢ: REST API, cài agent BYON, SDK. Rotate ở /api-docs.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-byon', slug: 'byon-bring-your-own-node', category: 'Bắt đầu', order: 1, published: true,
      title: 'BYON — Tạo proxy miễn phí trên VM của bạn',
      body: [
        '**BYON (Bring Your Own Node)** cho phép bạn cài ProxyBox agent lên VM/VPS/Dedicated server của riêng bạn, sau đó tạo proxy MIỄN PHÍ chạy trên đó.',
        '',
        '**Tại sao miễn phí?**',
        'Hạ tầng (VM, băng thông, IPv4/IPv6) do bạn thuê từ provider. Chúng tôi chỉ cung cấp software (agent + control plane + UI). Bạn được hưởng toàn bộ tính năng: 4 protocol, IPv6 rotation pool, anti-abuse caps, dashboard, API.',
        '',
        '**Cách bắt đầu**:',
        '1. Vào trang **ProxyBox Hub** (sidebar)',
        '2. Copy lệnh cài (Linux v4/v6 hoặc Windows)',
        '3. Paste vào VM của bạn → agent tự đăng ký vào tài khoản của bạn',
        '4. Vào **Mua proxy** → tab **Từ node của tôi** → tạo proxy free',
        '',
        '**Yêu cầu VM tối thiểu cho 1000 IPv6 proxy**:',
        '• 2-4 vCPU, 4-8 GB RAM, 1 Gbps NIC',
        '• Linux Ubuntu 20.04+ hoặc Windows Server 2019+',
        '• IPv6 routed prefix /64 trở lên (default /64, set `PROXYHUB_IPV6_PREFIX_LEN=48` nếu provider route /48)',
        '',
        '**Token cá nhân**: chính là API key của bạn (format `usr_<id>_<hex>`). Rotate hoặc revoke ở trang docs.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-getting-started', slug: 'getting-started', category: 'Bắt đầu', order: 2, published: true,
      title: 'ProxyBox hoạt động như thế nào?',
      body: 'Bạn mua proxy IPv4 hoặc IPv6 theo giờ. Mỗi proxy là 1 cổng riêng với user/pass riêng. Hỗ trợ HTTP và SOCKS5 trên cùng port. Lưu lượng đi qua hạ tầng đa node của chúng tôi.',
      createdAt: now, updatedAt: now },
    { id: 'd-protocols', slug: 'connection-protocols', category: 'Cách sử dụng', order: 0, published: true,
      title: '4 protocol kết nối: chọn cái nào?',
      body: [
        'Mỗi proxy mở **2 port**: `port` (plain TCP) và `port+443` (TLS wrap).',
        '',
        '**Port plain** chấp nhận 2 protocol qua first-byte multiplex:',
        '• **HTTP proxy** (CONNECT + GET) — universal, browser/curl/scraper đều dùng được',
        '• **SOCKS5** (user/pass) — app native, hỗ trợ TCP. UDP qua SOCKS5 cũng hỗ trợ.',
        '',
        '**Port TLS** chấp nhận 2 protocol qua first-byte sau handshake:',
        '• **HTTPS proxy** — Zero Omega/SwitchyOmega scheme "HTTPS://". Cần bật "Allow insecure cert" (self-signed cert/node).',
        '• **Trojan** — TLS giả HTTPS, anti-DPI. Apps: v2rayN (Win), v2rayNG (Android), Shadowrocket (iOS), Clash Verge (Mac), Hiddify.',
        '',
        'Cùng 1 user/password cho tất cả 4 protocol. Tab "Kết nối" trong /proxies có sẵn URL + QR cho mọi protocol.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-caps', slug: 'anti-abuse-caps', category: 'Cách sử dụng', order: 3, published: true,
      title: 'Giới hạn 3-lớp (anti-abuse caps)',
      body: [
        'Mọi proxy có 3 cap để bảo vệ hạ tầng + tránh 1 user hog tài nguyên:',
        '',
        '• **Cap A — Max conns/proxy** (default 100): tổng số kết nối đồng thời / 1 proxy. Vượt → từ chối.',
        '• **Cap B — Max conns/source IP** (default 60): 1 IP nguồn không hog hết cap A. Cho phép thiết bị thứ 2 vẫn connect.',
        '• **Cap C — New conns/s/IP** (default 30): burst rate. Chặn 10k-in-1s flood DoS attempt.',
        '',
        'Caps cộng dồn qua TẤT CẢ 4 protocol — HTTP + SOCKS5 + Trojan + HTTPS-proxy. Reset hết cap bằng nút "Ngắt tất cả" trong /proxies → Kết nối.',
        '',
        'Admin có thể chỉnh global default ở /admin/system/features → tab Anti-abuse. Premium plan có thể override per-proxy.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-ipv4-vs-ipv6', slug: 'ipv4-vs-ipv6', category: 'Bắt đầu', order: 2, published: true,
      title: 'Khác biệt giữa IPv4 và IPv6 là gì?',
      body: 'IPv4 cố định 1 IP, dùng cho mọi site. IPv6 có pool lớn, hỗ trợ rotate ngẫu nhiên mỗi lần kết nối — tốt cho scraping, account farming. IPv6 bắt buộc resolve AAAA cho target.',
      createdAt: now, updatedAt: now },
    { id: 'd-trial', slug: 'trial-credit', category: 'Thanh toán', order: 1, published: true,
      title: 'Trial credit là bao nhiêu?',
      body: 'Tài khoản mới được tặng 50,000 VND để test (cấu hình bởi admin). Đủ chạy thử vài proxy IPv4/IPv6 trong vài giờ.',
      createdAt: now, updatedAt: now },
    { id: 'd-auto-renew', slug: 'auto-renew', category: 'Cách sử dụng', order: 1, published: true,
      title: 'Tôi có thể auto-renew không?',
      body: 'Có. Khi đặt đơn, bật "auto-renew" — hệ thống sẽ trừ số dư và gia hạn 24h liên tục. Tắt bất cứ lúc nào ở trang đơn hàng.',
      createdAt: now, updatedAt: now },
    { id: 'd-rotate', slug: 'rotate-ipv6', category: 'Cách sử dụng', order: 2, published: true,
      title: 'Rotate IPv6 hoạt động ra sao?',
      body: 'Khi bật rotate, mỗi connection mới sẽ random 1 IP từ pool IPv6 của node. Pool có thể lên tới /48 (2^80 IP). Lưu lượng cũ vẫn dùng IP cũ tới khi đóng connection.',
      createdAt: now, updatedAt: now },
    { id: 'd-payment', slug: 'payment-methods', category: 'Thanh toán', order: 2, published: true,
      title: 'Làm sao thanh toán?',
      body: 'Hiện hỗ trợ Stripe (thẻ quốc tế). Bank transfer + crypto đang phát triển. Nạp tiền vào ví → mua proxy trừ trực tiếp.',
      createdAt: now, updatedAt: now },
    { id: 'd-refund', slug: 'refund-policy', category: 'Thanh toán', order: 3, published: true,
      title: 'Refund policy?',
      body: 'Proxy mua nhầm trong 30 phút đầu, chưa dùng > 100MB traffic — refund full. Sau đó tính theo giờ đã dùng.',
      createdAt: now, updatedAt: now },
    { id: 'd-api', slug: 'api-docs', category: 'API', order: 1, published: true,
      title: 'API documentation ở đâu?',
      body: 'Vào trang "Tài khoản" → tab "API key" để lấy customer key. Endpoint base: `/api/v1/user/*`. Full docs sẽ có ở trang docs dành riêng cho dev.',
      createdAt: now, updatedAt: now },
    { id: 'd-self-host-intro', slug: 'self-host-intro', category: 'Self-host (Panel riêng)', order: 0, published: true,
      title: '🚀 Giới thiệu ProxyBox — Hệ thống proxy IPv4/IPv6 self-host miễn phí',
      body: [
        'ProxyBox là 1 platform proxy SaaS đầy đủ tính năng, **mã nguồn mở miễn phí**, ai cũng có thể tự host trên VPS riêng để bán proxy IPv4/IPv6 cho khách hoặc dùng nội bộ team.',
        '',
        '## 🎯 ProxyBox giải quyết bài toán gì?',
        '',
        'Bạn muốn bán proxy IPv4 / IPv6 cho khách nhưng:',
        '- Không muốn dùng panel của bên thứ 3 (data nằm trên server người khác).',
        '- Không muốn code lại từ con số 0 (auth, billing, dashboard, agent, rotation, anti-abuse… rất nhiều).',
        '- Không có budget thuê dev team xây hệ thống nội bộ.',
        '',
        'ProxyBox là **lời giải** — 1 panel hoàn chỉnh, install 1 lệnh, tự host trên VPS của bạn, customer enroll vào panel của BẠN (không bao giờ data gửi sang server khác).',
        '',
        '## 🗺 Luồng hoạt động tổng thể',
        '',
        '```',
        '                         ┌──────────────────────────────────────┐',
        '                         │       VPS của BẠN (Panel admin)      │',
        '                         │     Ubuntu + Node 22 + nginx + SSL   │',
        '                         │                                      │',
        '                         │  ┌──────────────┐  ┌──────────────┐  │',
        '   👤 Customer           │  │  Vue 3 SPA   │  │  REST API    │  │',
        '       │                 │  │ (dashboard)  │  │ /api/v1/user │  │',
        '       │   HTTPS         │  └──────┬───────┘  └──────┬───────┘  │',
        '       └──────────────►  │         │ same Node.js   │           │',
        '                         │         └─────process────┘           │',
        '                         │                 │                    │',
        '                         │     ┌───────────▼────────────┐       │',
        '                         │     │   config.json (state)  │       │',
        '                         │     │   SQLite (billing+log) │       │',
        '                         │     │   master.key (AES-GCM) │       │',
        '                         │     └───────────┬────────────┘       │',
        '                         │                 │                    │',
        '                         │      Long-poll + mTLS port 8788      │',
        '                         └─────────────────┼────────────────────┘',
        '                                           │',
        '              ┌────────────────────────────┼───────────────────────────┐',
        '              │                            │                           │',
        '       ┌──────▼──────┐            ┌────────▼────────┐         ┌────────▼────────┐',
        '       │  Node A     │            │   Node B        │         │  Node C (Hub)   │',
        '       │ (admin pool)│            │   (BYON)        │         │ (VPS thuê giờ)  │',
        '       │ Rust agent  │            │  Rust agent     │         │  Rust agent     │',
        '       │             │            │ owned by user X │         │  auto-installed │',
        '       │ IPv4 + /48v6│            │  IPv6 /64       │         │ via Virtualizor │',
        '       └──────┬──────┘            └────────┬────────┘         └────────┬────────┘',
        '              │                            │                           │',
        '              │   listener :20000-29999    │     listener :20000+      │',
        '              │   HTTP/SOCKS5/Trojan/TLS   │                           │',
        '              ▼                            ▼                           ▼',
        '       🌐 Internet                  🌐 Internet                  🌐 Internet',
        '       (egress IPv4 hoặc            (egress IPv6 từ              (egress theo',
        '        IPv6 từ /48 pool)            customer pool)               plan family)',
        '```',
        '',
        '## ✨ Tính năng nổi bật',
        '',
        '### Multi-protocol trên 1 cổng',
        '- HTTP CONNECT, HTTP GET-through, SOCKS5, HTTPS-proxy (TLS), Trojan — tất cả cùng 1 port pair.',
        '- Customer chọn protocol thoải mái, không cần đổi cấu hình proxy.',
        '',
        '### IPv4 + IPv6 song hành',
        '- IPv4 datacenter: 1 IP cố định mỗi proxy.',
        '- IPv6 /48 routed: pool rotation, mỗi connection 1 IP egress (sticky hoặc rotate).',
        '- Strict family: IPv6 proxy resolve AAAA only — không leak v4. IPv4 proxy resolve A only.',
        '',
        '### 3 cách kiếm tiền với ProxyBox',
        '- **A. Bán proxy pool** — bạn có VPS riêng, cài agent, customer mua proxy theo giờ.',
        '- **B. Hub VPS theo giờ** — tích hợp Virtualizor, customer thuê nguyên VPS riêng, agent auto-cài qua SSH bootstrap.',
        '- **C. BYON (Bring Your Own Node)** — customer mang VPS riêng của họ, cài agent FREE từ panel của bạn, tự tạo proxy không trừ ví.',
        '',
        '### Bảo mật + Anti-abuse',
        '- **mTLS** giữa agent ↔ master (tự ký CA, mỗi node 1 cert).',
        '- **scrypt** hash password, **AES-256-GCM** mã hóa mọi secret at-rest.',
        '- **2FA TOTP** + admin IP whitelist + audit log SQLite.',
        '- **3-layer caps**: max conn/proxy, max conn/source IP, max new-conn/s/src.',
        '',
        '### Admin có toàn quyền remote',
        '- Click 1 nút: reboot VPS, restart agent, diagnose (uptime/RAM/disk), tail logs.',
        '- Force upgrade agent binary (Linux + Windows tự build từ panel của bạn).',
        '- Install package whitelist (htop, iperf3, mtr…) qua apt-get.',
        '- Drain mode + rotate token cho từng node.',
        '',
        '### Wallet + Billing',
        '- Ví VND/USD, auto-renew proxy, tier discount.',
        '- Refund partial/full, audit từng giao dịch.',
        '- Stripe integration (webhook signature verify + idempotency).',
        '- SMTP raw socket + Telegram alert + Webhook ra hệ thống ngoài.',
        '',
        '### One-click self-upgrade',
        'Admin → Settings → System → click "Nâng cấp lên phiên bản mới". Server tự `git pull` + `npm install` + `npm run build` + restart. ~60 giây, customer traffic KHÔNG bị ảnh hưởng (TCP listener giữ nguyên).',
        '',
        '## 🔄 3 luồng kiếm tiền — minh họa',
        '',
        '### A. Customer mua proxy từ pool (admin pool)',
        '',
        '```',
        '   👤 Customer            🏢 Panel (admin)         🖥 Node admin',
        '       │                       │                       │',
        '       │  1. Login + topup ví  │                       │',
        '       ├──────────────────────►│                       │',
        '       │                       │                       │',
        '       │  2. POST /orders      │                       │',
        '       │     type=ipv6, qty=5  │                       │',
        '       ├──────────────────────►│                       │',
        '       │                       │  3. pickZoneNode      │',
        '       │                       ├──────────────────────►│',
        '       │                       │  4. push proxy config │',
        '       │                       │   (port + user + pass)│',
        '       │                       │                       │',
        '       │  5. Trả về creds      │                       │',
        '       │◄──────────────────────┤                       │',
        '       │                                               │',
        '       │  6. Connect proxy:                            │',
        '       │     curl -x http://user:pass@node-ip:port     │',
        '       ├──────────────────────────────────────────────►│',
        '       │                                       7. egress IPv6 từ /48',
        '       │                                               │',
        '       │                              🌐 ─────────────►│ target.com',
        '```',
        '',
        '### B. Hub VPS theo giờ (qua Virtualizor)',
        '',
        '```',
        '   👤 Customer         🏢 Panel             🖥 Virtualizor        🖥 New VPS',
        '       │                  │                     │                    │',
        '       │ 1. Buy hub plan  │                     │                    │',
        '       ├─────────────────►│                     │                    │',
        '       │                  │ 2. addvs API        │                    │',
        '       │                  │   (uid, RAM, OS,    │                    │',
        '       │                  │    IP pool)         │                    │',
        '       │                  ├────────────────────►│                    │',
        '       │                  │                     │ 3. Create VM       │',
        '       │                  │                     ├───────────────────►│',
        '       │                  │ 4. Wait unlock      │                    │',
        '       │                  │   (poll vsDetail)   │                    │',
        '       │                  │                     │                    │',
        '       │                  │ 5. SSH bootstrap    │                    │',
        '       │                  │   curl install.sh   │                    │',
        '       │                  ├──────────────────────────────────────────►│',
        '       │                  │                                          │',
        '       │                  │ 6. Agent enrolls    ◄────────────────────│',
        '       │                  │   (claim placeholder)                    │',
        '       │                  │                                          │',
        '       │ 7. "Hub online"  │                                          │',
        '       │◄─────────────────┤                                          │',
        '       │                                                             │',
        '       │ 8. Tạo proxy trên hub (miễn phí, billing đã trừ)            │',
        '       ├────────────────────────────────────────────────────────────►│',
        '```',
        '',
        '### C. BYON — Customer mang VPS riêng',
        '',
        '```',
        '   👤 Customer\'s VPS                    🏢 Panel của BẠN',
        '        │                                     │',
        '        │  1. SSH vào VPS rồi paste:          │',
        '        │     curl https://your-panel/        │',
        '        │       api/agent/install/usr_xxx     │',
        '        │       | sudo bash -s v4             │',
        '        │                                     │',
        '        │  2. Tải binary từ panel của bạn     │',
        '        │      (KHÔNG về server bên thứ 3)    │',
        '        ├────────────────────────────────────►│',
        '        │                                     │',
        '        │  3. Agent enroll                    │',
        '        │     ownerId = customer.id           │',
        '        │     tag = "byon"                    │',
        '        ├────────────────────────────────────►│',
        '        │                                     │',
        '        │  4. Customer thấy node ở /my-nodes  │',
        '        │◄────────────────────────────────────┤',
        '        │                                     │',
        '        │  5. /buy → tab "Từ node của tôi"    │',
        '        │     tạo proxy MIỄN PHÍ              │',
        '        │     (chỉ trừ slot, không trừ ví)    │',
        '        │                                     │',
        '        │  6. Proxy chạy trên VPS của customer│',
        '```',
        '',
        '## 🔐 Luồng bảo mật',
        '',
        '```',
        '   ┌──────────────┐    HTTPS (LE cert)    ┌──────────────┐',
        '   │   Browser    │ ─────────────────────►│    nginx     │',
        '   │   (admin /   │                       │  TLS 1.2/1.3 │',
        '   │   customer)  │                       │  :443        │',
        '   └──────────────┘                       └──────┬───────┘',
        '                                                 │ proxy_pass',
        '                                                 ▼ 127.0.0.1:8787',
        '   ┌────────────────────────────────────────────────────────────┐',
        '   │                  ProxyBox master process                   │',
        '   │                                                            │',
        '   │  Auth:                                                     │',
        '   │   • scrypt password hash                                   │',
        '   │   • Bearer token (60-min session)                          │',
        '   │   • Customer key usr_<id>_<hex> (160-bit, timing-safe)     │',
        '   │   • TOTP 2FA optional                                      │',
        '   │   • Admin IP whitelist                                     │',
        '   │                                                            │',
        '   │  Secrets at rest:                                          │',
        '   │   • master.key (32 bytes, chmod 600)                       │',
        '   │   • config.json secrets → AES-256-GCM v1: prefix           │',
        '   │     (SSH pw, Virtualizor key, OAuth client_secret)         │',
        '   │                                                            │',
        '   │  Audit:                                                    │',
        '   │   • SQLite audit table (every admin action)                │',
        '   │   • SQLite conn_events (30-day retention)                  │',
        '   │   • Webhook fan-out (customer-defined)                     │',
        '   └────────────────────────────────────────────────────────────┘',
        '                              │',
        '                       mTLS  │  port 8788 (client cert auth)',
        '                              ▼',
        '   ┌────────────────────────────────────────────────────────────┐',
        '   │              Rust agent (each node, separate VPS)          │',
        '   │                                                            │',
        '   │  • Long-poll /api/agent/proxies?rev=N (25s)                │',
        '   │  • Heartbeat /api/agent/heartbeat (10s)                    │',
        '   │  • Strict family egress (IPv6 proxy = AAAA only)           │',
        '   │  • Per-proxy: bind IP, listen port, user/pass, rotation    │',
        '   │  • Anti-abuse: max-conn, bytes/sec, monthly quota          │',
        '   │  • Admin commands via heartbeat (BYON path, no SSH needed) │',
        '   └────────────────────────────────────────────────────────────┘',
        '```',
        '',
        '## 📦 Install 1 lệnh',
        '',
        'VPS Ubuntu 22.04 / Debian 12, quyền root:',
        '',
        '```',
        'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash',
        '```',
        '',
        'Installer hỏi 3 thứ:',
        '1. **Domain** — hostname panel sẽ chạy.',
        '2. **SSL** — Let\'s Encrypt (auto) / Self-signed / HTTP-only.',
        '3. **Admin** — mặc định `admin@admin.com` / `admin`.',
        '',
        'Sau ~3-5 phút (build SPA + Rust agent Linux + Windows), panel live tại `https://your-domain` → đăng nhập → đổi password ngay.',
        '',
        '**Yêu cầu**: 1 CPU / 1 GB RAM / 10 GB disk + domain. Production khuyến nghị 2 CPU / 2 GB RAM.',
        '',
        '## 🏗 Tech stack',
        '',
        '- **Backend**: Node.js 22 monolith (~10k LOC), ZERO npm framework. Chỉ dùng `node:*` builtins + `ssh2` + `node-forge`.',
        '- **Frontend**: Vue 3 + Vite, lucide-vue-next, vue3-apexcharts. Không Tailwind / không Vuetify — pure CSS token system.',
        '- **Agent**: Rust + Tokio (proxy engine, mTLS, IPv6 strict family). Cross-build Linux + Windows.',
        '- **Storage**: `config.json` (single-file state, ~120KB) + SQLite (`billing_tx`, `audit`, `conn_events`). Atomic writes + WAL.',
        '- **PKI**: self-signed CA via `node-forge`, mỗi agent 1 client cert.',
        '- **Stripe / SMTP / OAuth**: raw HTTPS / raw socket / raw OAuth flow — không SDK.',
        '',
        '## 🚀 Tiếp theo',
        '',
        'Đọc các tab phía dưới để cài + cấu hình:',
        '',
        '1. **[Tự cài Panel](/faq#self-host-panel)** — chi tiết lệnh install + tùy chọn.',
        '2. **[Customer enroll về panel nào](/faq#self-host-customer-isolation)** — giải thích isolation.',
        '3. **[Checklist A→Z cho admin](/faq#self-host-first-login)** — 10 bước sau khi cài.',
        '4. **[Troubleshoot](/faq#self-host-troubleshoot)** — fix các lỗi thường gặp.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-self-host', slug: 'self-host-panel', category: 'Self-host (Panel riêng)', order: 1, published: true,
      title: 'Tự cài Panel ProxyBox trên server của bạn',
      body: [
        'Bạn có thể **tự host 1 Panel ProxyBox riêng** trên VPS của mình — chạy độc lập, không liên quan gì tới panel này. Customer của bạn enroll agent thẳng về domain của bạn, không bao giờ gửi data sang server khác.',
        '',
        '## Yêu cầu',
        '',
        '- VPS Ubuntu 22.04 / 24.04 (Debian 12 cũng được). 1 vCPU + 1 GB RAM + 10 GB disk là đủ test, 2 vCPU + 2 GB cho production.',
        '- Domain trỏ về IP của VPS (cho HTTPS qua Let\'s Encrypt). Nếu không có domain, vẫn cài được — chạy HTTP với IP.',
        '- Quyền root.',
        '',
        '## Cài 1 lệnh',
        '',
        '```',
        'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash',
        '```',
        '',
        'Installer sẽ hỏi:',
        '1. **Domain** — hostname panel (vd `proxy.example.com`). Bỏ trống → dùng IP.',
        '2. **SSL mode** — Let\'s Encrypt (khuyến nghị) / Self-signed / HTTP-only.',
        '3. **Admin email + mật khẩu** — mặc định `admin@admin.com` / `admin`.',
        '',
        'Sau ~3-5 phút (build SPA + Rust agent), truy cập `https://your-domain` → đăng nhập → **đổi mật khẩu ngay**.',
        '',
        '## Non-interactive (CI / Ansible)',
        '',
        '```',
        'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash -s -- \\',
        '  --domain proxy.example.com \\',
        '  --ssl letsencrypt \\',
        '  --admin-email me@example.com \\',
        '  --admin-pass \'StrongPw_1234!\' \\',
        '  --yes',
        '```',
        '',
        '## Sau khi cài',
        '',
        '- **Đổi mật khẩu admin** ngay (Settings → Security).',
        '- **Bật 2FA** (TOTP) cho admin.',
        '- **Set pricing** + **add zones** (Admin → Pricing / Zones).',
        '- **Tắt registration** nếu chỉ team nội bộ (Admin → Features).',
        '- **Backup `server/master.key`** offsite — mất file = mất hết secret encrypted.',
        '',
        '## Cập nhật version mới',
        '',
        'Admin → **Settings → System** → click **Nâng cấp lên phiên bản mới**. Backend tự git pull + rebuild + restart trong ~60s. Customer traffic không bị ảnh hưởng.',
        '',
        '## Cấu trúc khi đã cài',
        '',
        '```',
        '/opt/proxyhub-free/',
        '  server/index.js           control plane',
        '  server/config.json        live state (chmod 600)',
        '  server/master.key         AES-256-GCM key (chmod 600)',
        '  server/data.db            SQLite: billing + audit + conn events',
        '  dist/                     Vue SPA build',
        '  rust-core/                Rust agent source + binary',
        '```',
        '',
        '## Quản trị',
        '',
        '- `systemctl status proxyhub` — service status',
        '- `journalctl -u proxyhub -f` — live log',
        '- `/etc/nginx/sites-available/proxyhub-free` — nginx config',
        '- `/etc/sudoers.d/proxyhub-free` — sudoers cho self-upgrade',
        '',
        'Đầy đủ: xem [README trên GitHub](https://github.com/proxyhub/free).'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-self-host-customer-isolation', slug: 'self-host-customer-isolation', category: 'Self-host (Panel riêng)', order: 2, published: true,
      title: 'Customer của tôi enroll agent về panel nào?',
      body: [
        'Mỗi installation Panel riêng có `config.api.publicUrl` set lúc install (`--domain your-domain` ở installer).',
        '',
        'Khi customer của BẠN copy lệnh agent từ panel của BẠN (vd `/my-nodes` → "Lệnh cài"), URL được generate động:',
        '',
        '```',
        'curl -fsSL https://YOUR-DOMAIN/api/agent/claim/<token> | sudo bash -s v4',
        '```',
        '',
        '`YOUR-DOMAIN` là domain bạn đã set lúc cài. Agent của customer sẽ:',
        '- Tải binary từ `https://YOUR-DOMAIN/api/agent/claim-binary/<token>`',
        '- Register node về `https://YOUR-DOMAIN/api/agent/claim`',
        '- Heartbeat về `https://YOUR-DOMAIN/api/agent/heartbeat`',
        '',
        'Không bao giờ gọi về panel khác. Hoàn toàn isolated.',
        '',
        '**Verify**: SSH vào VPS đã cài agent, xem `/etc/proxybox-agent.json` — field `controlUrl` phải là domain của bạn.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-self-host-first-login', slug: 'self-host-first-login', category: 'Self-host (Panel riêng)', order: 3, published: true,
      title: 'Sau khi cài Panel — checklist A→Z cho admin',
      body: [
        'Sau khi `install.sh` chạy xong, bạn có Panel rỗng + 1 admin mặc định. Đây là **thứ tự** cần làm để Panel sẵn sàng bán hàng.',
        '',
        '## ① Đổi password admin + bật 2FA (5 phút)',
        '',
        '1. Login `admin@admin.com` / `admin` lần đầu.',
        '2. Vào **Settings → Security** → đổi password ngay (mật khẩu ≥ 12 ký tự, không dùng `admin`).',
        '3. Bật **2FA (TOTP)**: scan QR bằng Authy / Google Authenticator / Bitwarden.',
        '4. (Optional, recommended) Thêm IP của bạn vào `config.api.adminIpWhitelist` để admin chỉ login được từ IP cố định:',
        '   ```bash',
        '   sudo nano /opt/proxyhub-free/server/config.json',
        '   # Trong api: { "adminIpWhitelist": ["1.2.3.4", "5.6.7.8"] }',
        '   sudo systemctl restart proxyhub',
        '   ```',
        '',
        '## ② Backup `master.key` ngay (3 phút)',
        '',
        '`server/master.key` mã hóa MỌI secret trong config.json (SSH passwords, Virtualizor API keys, OAuth secrets). Mất file = mất hết.',
        '',
        '```bash',
        'sudo tar czf ~/proxyhub-keys-$(date +%F).tgz \\',
        '  /opt/proxyhub-free/server/master.key',
        'scp ~/proxyhub-keys-*.tgz user@other-machine:safe-place/',
        '# Hoặc upload lên Google Drive / pCloud / Bitwarden Send.',
        '```',
        '',
        'Lập cron backup full config tuần 1 lần:',
        '',
        '```bash',
        'sudo crontab -e',
        '# Thêm:',
        '# 0 3 * * 0 BACKUP_PASS=YOUR_PASS /opt/proxyhub-free/scripts/backup.sh /var/backups/proxyhub',
        '```',
        '',
        '## ③ Set giá + zone (10 phút)',
        '',
        '1. **Admin → Pricing**: set giá per-hour cho IPv4 + IPv6. Đơn giá là số VND/giờ cho 1 proxy. Ví dụ:',
        '   - IPv4: `416 VND/h` (~10k/ngày, ~300k/tháng)',
        '   - IPv6: `291 VND/h` (~7k/ngày, ~210k/tháng)',
        '   - Tiers: `>10 proxy −5%`, `>50 −10%`, `>100 −15%`',
        '',
        '2. **Admin → Zones**: tạo zone tương ứng với mỗi datacenter có node. Ví dụ:',
        '   - `vn-hcm` — Vietnam HCM (Asia/Ho_Chi_Minh)',
        '   - `us-east` — US East (America/New_York)',
        '   - `sg` — Singapore (Asia/Singapore)',
        '',
        '   Customer chọn zone lúc buy → server pick node thuộc zone đó.',
        '',
        '## ④ Add node đầu tiên (BYON pattern)',
        '',
        'Có 3 cách add node — chọn 1:',
        '',
        '### Cách A — Admin pool (SSH-managed)',
        '',
        'Bạn có VPS riêng cấu hình bán proxy. Admin push agent qua SSH:',
        '',
        '1. Admin → **Nodes** → **Add node** → điền host + SSH user/password + family (ipv4/ipv6) + zone.',
        '2. Click **Install** → master SSH vào VPS đó, paste install one-liner, agent tự enroll.',
        '3. Node xuất hiện ở list, có nút `Diagnose`, `Reboot`, `Drain`, …',
        '',
        '### Cách B — Fleet enrollment (zero-touch)',
        '',
        'Bạn muốn cài hàng loạt node:',
        '',
        '1. Admin → **Nodes** → click **Fleet token** → copy token (rotate được mọi lúc).',
        '2. Trên mỗi VPS đích:',
        '   ```bash',
        '   curl -fsSL https://YOUR-DOMAIN/api/agent/install/<fleet-token> | sudo bash -s v4',
        '   ```',
        '3. Agent tự register, auto-detect IP + zone, xuất hiện ở list trong ~30s.',
        '',
        '### Cách C — Customer BYON (tự cài, miễn phí)',
        '',
        'Customer của bạn có VPS riêng, muốn dùng làm proxy của họ:',
        '',
        '1. Customer login → **My Nodes** → copy lệnh cài (có token cá nhân `usr_…`).',
        '2. Paste lệnh vào VPS của customer.',
        '3. Node của họ xuất hiện ở **My Nodes** với `ownerId = customer.id`. Chỉ họ thấy.',
        '4. Customer vào **Buy → Từ node của tôi** → tạo proxy MIỄN PHÍ chạy trên VPS đó.',
        '',
        '## ⑤ (Optional) Hub Proxy qua Virtualizor',
        '',
        'Nếu bạn có panel Virtualizor để bán VPS theo giờ:',
        '',
        '1. **Admin → Hubs → Virtualizor instances → New instance**:',
        '   - Label: tên panel (`FPT VN`, `Hetzner DE`, …)',
        '   - Zone: `vn-hcm` / `us-east` / …',
        '   - Panel URL: `https://<your-vz>:4085`',
        '   - API key + API pass: lấy ở **Configuration → API Keys** của VZ panel. CHÚ Ý: `adminapikey` + `adminapipass`, KHÔNG phải end-user API.',
        '',
        '2. **Hub plans → New plan**: chọn instance → dropdown tự fetch servers/plans/OS/IP pools từ Virtualizor. Click chọn không cần gõ ID.',
        '',
        '3. Set giá (vd 2,500 VND/giờ), family (`ipv4`/`ipv6`), specs (CPU/RAM/Disk/IPv6 range).',
        '',
        '4. Customer vào `/buy?source=hub` → mua → master tự gọi Virtualizor addvs → SSH bootstrap agent → node tự enroll + adopt placeholder.',
        '',
        '## ⑥ Cấu hình OAuth (optional)',
        '',
        'Cho phép customer login bằng Google / GitHub:',
        '',
        '1. **Admin → OAuth** → enable provider → điền `clientId` + `clientSecret` lấy từ Google Cloud Console / GitHub Developer Settings.',
        '2. Redirect URI khi setup ở Google/GitHub: `https://YOUR-DOMAIN/api/auth/oauth/google/callback`.',
        '3. Customer thấy nút "Sign in with Google/GitHub" ở trang login.',
        '',
        '## ⑦ Stripe / SMTP / Telegram (optional)',
        '',
        '- **Stripe** (thanh toán thẻ): Admin → Payment → enable Stripe → paste secret key + webhook secret. Webhook URL: `https://YOUR-DOMAIN/api/billing/stripe-webhook`.',
        '- **SMTP** (gửi email recovery + alerts): Admin → Email → set SMTP host/port/user/password. Hỗ trợ STARTTLS hoặc TLS implicit.',
        '- **Telegram alerts** (cảnh báo admin khi node offline / proxy fail): Admin → Notifications → Telegram bot token + chat ID.',
        '',
        '## ⑧ Tắt registration nếu private',
        '',
        'Nếu Panel chỉ phục vụ team nội bộ (không cho random ai cũng register):',
        '',
        '1. **Admin → Features** → tắt `registration` toggle.',
        '2. Admin tự tạo user ở **Admin → Users → Add user**.',
        '3. Customer chỉ login được nếu admin đã tạo account.',
        '',
        '## ⑨ Tự cập nhật version mới',
        '',
        'Khi có release mới (hoặc bạn push code lên fork):',
        '',
        '1. **Settings → System** → click **Nâng cấp lên phiên bản mới**.',
        '2. Server tự `git pull` + `npm install` + `npm run build` + `systemctl restart proxyhub`.',
        '3. Mất ~1 phút. Customer proxy traffic KHÔNG bị ảnh hưởng (TCP listener giữ nguyên).',
        '',
        'Nếu fork riêng: chạy `git remote set-url origin <your-fork>` trong `/opt/proxyhub-free/` để self-upgrade pull từ fork của bạn.',
        '',
        '## ⑩ Firewall + nginx hardening',
        '',
        '```bash',
        'sudo ufw allow 80/tcp     # nginx HTTP (LE renewal)',
        'sudo ufw allow 443/tcp    # nginx HTTPS (panel + customer API)',
        'sudo ufw allow 8788/tcp   # mTLS agent channel',
        'sudo ufw allow 20000:29999/tcp  # proxy ports (nếu phục vụ proxy LOCAL trên server này)',
        'sudo ufw deny 8787        # block direct master port — chỉ nginx proxy được',
        'sudo ufw enable',
        '```',
        '',
        'Port 8788 (mTLS) phải mở ra internet vì agent connect trực tiếp (bypass nginx, IP-based cert).',
        '',
        '## Kiểm tra cuối cùng',
        '',
        '- [ ] Login với password mới + 2FA OK',
        '- [ ] `curl https://YOUR-DOMAIN/api/health` trả `{"ok":true}`',
        '- [ ] `systemctl status proxyhub` shows `active (running)` + memory < 200 MB',
        '- [ ] `journalctl -u proxyhub -n 20` không có lỗi đỏ',
        '- [ ] `master.key` đã backup offsite',
        '- [ ] Test customer flow: register account → buy 1 proxy → connect proxy → traffic ra ngoài OK'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-self-host-security', slug: 'self-host-security', category: 'Self-host (Panel riêng)', order: 4, published: true,
      title: '🔒 Bảo mật & Trust — install script có chứa backdoor không?',
      body: [
        'Câu hỏi hợp lý khi bạn sắp `curl ... | sudo bash` 1 script từ server lạ. Đây là full disclosure.',
        '',
        '## TL;DR',
        '',
        'Install script **KHÔNG** mở đường vào ngược tới server bạn. Sau khi cài, panel của bạn chạy độc lập 100%, không có cơ chế nào để bên cung cấp script truy cập máy bạn.',
        '',
        '## Server TÔI thấy gì khi bạn `curl install-panel.sh`',
        '',
        '**Chỉ 1 HTTP request duy nhất** được log vào `oss_downloads` table:',
        '- IP của bạn (đã mask octet cuối khi hiển thị)',
        '- User-Agent (vd `curl/7.81.0`)',
        '- Referer (thường rỗng nếu bạn copy-paste)',
        '',
        'Không gì khác. Tôi không có quyền vào máy bạn từ 1 HTTP GET.',
        '',
        '## Những gì install.sh LÀM trên máy bạn',
        '',
        '1. `apt-get install nodejs nginx certbot ...` — packages chính thống từ apt repo của Ubuntu/Debian.',
        '2. `useradd -r proxyhub` — tạo system user không quyền root.',
        '3. `npm install` + `npm run build` — cài Vue dependencies (đã pin trong `package-lock.json`).',
        '4. `cargo build --release` — biên dịch Rust agent từ source (binary KHÔNG download từ server tôi).',
        '5. Sinh `master.key` 32 bytes random TRÊN MÁY BẠN (không bao giờ rời máy).',
        '6. Tạo `config.json` với admin@admin.com + tokens random LOCAL.',
        '7. `certbot --nginx` — request Let\'s Encrypt cert (request đi từ server bạn → LE, không qua tôi).',
        '8. `systemctl enable proxyhub` — register systemd unit.',
        '',
        '## Những gì install.sh **KHÔNG** làm',
        '',
        '- ❌ Không SSH ngược về máy bạn (làm gì có creds).',
        '- ❌ Không cài SSH public key của ai vào `~/.ssh/authorized_keys`.',
        '- ❌ Không mở reverse tunnel (`ssh -R`, ngrok, frp, autossh).',
        '- ❌ Không tạo cron job phone-home.',
        '- ❌ Không add user root/sudo cho bên ngoài.',
        '- ❌ Không cài telemetry / analytics SDK.',
        '- ❌ Không gửi `master.key` / config / data ra ngoài.',
        '- ❌ Không set firewall rule cho phép truy cập đặc biệt.',
        '',
        '## Audit script TRƯỚC khi chạy (khuyến nghị)',
        '',
        'Trust nhưng verify. Đây là cách:',
        '',
        '```',
        '# 1. Tải về thay vì pipe thẳng tới bash',
        'curl -fsSL https://proxybox.pro/install-panel.sh -o install.sh',
        '',
        '# 2. Đọc qua (518 dòng, comments rõ ràng)',
        'less install.sh',
        '',
        '# 3. So sánh hash với GitHub release (nếu có)',
        'sha256sum install.sh',
        '# So với: https://github.com/proxyhub/free/releases/.../install.sh.sha256',
        '',
        '# 4. Tìm các pattern đáng ngờ (kết quả phải RỖNG)',
        'grep -E "ngrok|frp|autossh|nc -e|/dev/tcp|crontab.*curl|wget.*\\|sh" install.sh',
        '',
        '# 5. OK rồi mới chạy',
        'sudo bash install.sh',
        '```',
        '',
        '## Self-upgrade — kênh trust quan trọng',
        '',
        'Panel của bạn có nút **Settings → System → Nâng cấp lên phiên bản mới**. Logic là:',
        '',
        '```',
        'cd /opt/proxyhub-free',
        'git pull --ff-only        ← TỪ remote nào?',
        'npm install               ← từ npmjs.org',
        'npm run build',
        'systemctl restart proxyhub',
        '```',
        '',
        '**Câu hỏi quan trọng**: `git pull` kéo từ đâu?',
        '',
        'Theo install.sh:',
        '- Nếu bạn cài bằng `--source-dir /path/to/local/tarball` → KHÔNG có git remote → upgrade FAIL với "not a git repo" → an toàn tuyệt đối.',
        '- Nếu cài bằng `--git-repo https://github.com/proxyhub/free.git` → remote trỏ về GitHub fork chính → upgrade kéo từ đó.',
        '- Mặc định (không có flag) → KHÔNG `git clone` → upgrade FAIL.',
        '',
        '**Khuyến nghị production**:',
        '1. **Fork repo** về GitHub org của BẠN.',
        '2. Cài với `--git-repo https://github.com/YOUR-ORG/proxyhub-free.git`.',
        '3. Bạn control hoàn toàn code customer chạy. Update mới của upstream → review PR trong fork → merge → click upgrade.',
        '',
        '## Mô hình tin cậy của bạn nên là',
        '',
        '1. **Initial install**: chạy 1 lần script — chấp nhận trust author tại điểm này.',
        '2. **Sau khi cài**: panel + agent chạy với code đã có TRÊN MÁY BẠN. Không kết nối ngược về tác giả.',
        '3. **Update**: chỉ qua git remote bạn chỉ định. Nếu fork riêng → bạn có 100% quyền.',
        '4. **Audit định kỳ**: `find /opt/proxyhub-free -newer /tmp/install-ts -type f` để xem có file nào lạ tự động xuất hiện.',
        '',
        '## Customer của BẠN có rò rỉ gì về panel của tôi không?',
        '',
        'Không. Khi customer của bạn:',
        '- Tải agent: download từ `https://YOUR-PANEL/api/agent/claim-binary/...` (panel của BẠN).',
        '- Enroll: register với `https://YOUR-PANEL/api/agent/claim` (panel của BẠN).',
        '- Heartbeat: gửi về `https://YOUR-PANEL/api/agent/heartbeat`.',
        '',
        'Verify trên VPS customer: `cat /etc/proxybox-agent.json` → field `controlUrl` phải là domain của bạn, KHÔNG có `proxybox.pro` hoặc tên domain bên thứ 3.',
        '',
        '## Cần thêm bằng chứng?',
        '',
        '- **Đọc source**: install.sh + server/index.js đều plain JS/Bash, không có obfuscation.',
        '- **Network audit**: sau cài, chạy `ss -tnp` xem outbound connections. Chỉ có nginx (443) + node (8787 listen + outbound API calls của customer KHI HỌ MUA proxy).',
        '- **Tcpdump**: `tcpdump -i any host proxybox.pro` → 0 packet sau khi cài xong.',
        '- **Strace agent**: `strace -f -e network proxybox-agent` → chỉ thấy connect tới `your-domain:8788` (mTLS) và outbound proxy target customer dùng.',
        '',
        '## Nếu bạn vẫn lo',
        '',
        '**Air-gap install**: tải tarball, scp lên VPS, cài với `--source-dir`. Không có HTTP request nào tới server tôi ngoài 1 lần download script ban đầu:',
        '',
        '```',
        '# Trên máy có internet:',
        'curl -fsSL https://proxybox.pro/install-panel.sh -o install.sh',
        'curl -fsSL https://github.com/proxyhub/free/archive/main.tar.gz -o proxyhub-free.tar.gz',
        '',
        '# Audit cả 2 file',
        'sha256sum install.sh proxyhub-free.tar.gz',
        '',
        '# Upload lên VPS qua scp',
        'scp install.sh proxyhub-free.tar.gz root@your-vps:/root/',
        '',
        '# Trên VPS:',
        'tar xzf proxyhub-free.tar.gz',
        'sudo bash install.sh --source-dir /root/proxyhub-free-main --domain your-domain',
        '```',
        '',
        'Sau bước này, VPS bạn KHÔNG bao giờ liên lạc với proxybox.pro nữa. Mọi update phải bạn tự upload file mới rồi rerun installer.'
      ].join('\n'),
      createdAt: now, updatedAt: now },
    { id: 'd-self-host-troubleshoot', slug: 'self-host-troubleshoot', category: 'Self-host (Panel riêng)', order: 5, published: true,
      title: 'Troubleshoot — các lỗi thường gặp',
      body: [
        '## "Service failed to start" lúc cài',
        '',
        '```bash',
        'sudo journalctl -u proxyhub -n 50',
        '```',
        '',
        'Lỗi phổ biến:',
        '- **`master.key` missing** — re-seed: `sudo /opt/proxyhub-free/install.sh --force-reseed --yes`',
        '- **port 8787 in use** — đổi port trong `config.api.port` rồi restart',
        '- **Node 22 missing** — `sudo apt install nodejs-22` hoặc rerun installer',
        '',
        '## "Let\'s Encrypt rate-limited"',
        '',
        'LE giới hạn 5 cert/tuần/domain. Nếu cài lại nhiều lần trong tuần → bị block.',
        '',
        'Cách:',
        '- Đợi 7 ngày, HOẶC',
        '- Dùng staging cert (sửa `install.sh` thêm `--test-cert`), HOẶC',
        '- Fallback `--ssl selfsigned` (browser cảnh báo nhưng vẫn dùng được).',
        '',
        '## Agent không enroll',
        '',
        '1. Trên VPS đích chạy:',
        '   ```bash',
        '   sudo journalctl -u proxybox-agent -f',
        '   ```',
        '2. Lỗi `HTTP 401 Unauthorized` → fleet token sai/revoked → admin rotate lại token.',
        '3. Lỗi `error sending request` → firewall block port 8788 trên master HOẶC certificate IP SAN không match → kiểm tra `dig YOUR-DOMAIN` = IP master.',
        '4. Lỗi `mTLS handshake fail` → re-run install one-liner để fetch CA cert mới.',
        '',
        '## Proxy traffic chậm',
        '',
        '1. Test trực tiếp trên node:',
        '   ```bash',
        '   curl --max-time 10 -o /dev/null -w "%{speed_download}\\n" -x http://user:pass@host:port https://speed.cloudflare.com/__down?bytes=10000000',
        '   ```',
        '2. Tốc độ < 5 MB/s → bottleneck CPU node (check `htop`) hoặc băng thông VPS.',
        '3. Latency > 200ms khi target gần → DNS resolver chậm. Vào `proxyDefaults` → set `allowPrivateTargets: false` (already default).',
        '',
        '## Customer kêu "không kết nối được"',
        '',
        '1. **Settings → System → Diagnose** node của họ (nếu là BYON / Hub):',
        '   - `uptime` + `load` + `disk` + agent version + open listeners',
        '2. Nếu agent dead → click **Restart agent**.',
        '3. Nếu listener không có port của proxy → click **Diagnose** → check log, restart agent.',
        '4. Nếu node offline > 10 phút → tự động `nodeAutoDisableAfterMin` kick in → customer thấy node disabled.',
        '',
        '## Database SQLite quá lớn',
        '',
        'Sau 6 tháng, `data.db` có thể ~500MB do `conn_events`. Cron:',
        '',
        '```sql',
        '-- Giảm retention từ 30 ngày → 7 ngày',
        'DELETE FROM conn_events WHERE ts < strftime("%s", "now", "-7 days") * 1000;',
        'VACUUM;',
        '```',
        '',
        'Hoặc tắt tracking: `proxyDefaults.recordConnEvents: false` trong config.json.',
        '',
        '## Restore từ backup',
        '',
        '```bash',
        '# Stop service trước khi restore (tránh ghi đè khi đang chạy)',
        'sudo systemctl stop proxyhub',
        'sudo BACKUP_PASS=YOUR_PASS bash /opt/proxyhub-free/scripts/restore.sh \\',
        '  /var/backups/proxyhub/proxyhub-XXXX.tar.gz.enc',
        'sudo systemctl start proxyhub',
        '```',
        '',
        '## Cần thêm support?',
        '',
        '- GitHub Issues: https://github.com/proxyhub/free/issues',
        '- Document gốc: xem `/opt/proxyhub-free/README.md`',
        '- Log live: `sudo journalctl -u proxyhub -f --since "10 min ago"`'
      ].join('\n'),
      createdAt: now, updatedAt: now }
  ]
}

// Merge English translations into the doc list (id-matched). Bodies stored as
// strings (joining the source array). VN content stays as the primary `title`/
// `body`; EN content is exposed via `?lang=en` and falls back to VN if missing.
function mergeDocsEn(docs) {
  const byId = new Map((DOCS_EN || []).map((d) => [d.id, d]))
  for (const d of docs) {
    const en = byId.get(d.id)
    if (!en) continue
    if (en.title_en) d.title_en = en.title_en
    if (en.category_en) d.category_en = en.category_en
    if (en.body_en) d.body_en = Array.isArray(en.body_en) ? en.body_en.join('\n') : String(en.body_en)
  }
  return docs
}

function defaultEmailTemplates() {
  return {
    welcome:        { subject: 'Welcome to ProxyBox', html: '<h2>Welcome, {{name}}</h2><p>Your account is ready. Trial credits applied: <strong>{{trial}}</strong>.</p>' },
    orderCreated:   { subject: 'ProxyBox: {{quantity}} {{type}} proxy provisioned', html: '<h2>Order ready</h2><p>Order <code>{{orderId}}</code> for {{hours}}h.</p><pre>{{proxyList}}</pre>' },
    expireWarning:  { subject: 'ProxyBox: proxies expiring soon', html: '<p>{{count}} proxies expire within 6 hours. Top up + auto-renew to keep them.</p>' },
    passwordChange: { subject: 'ProxyBox: password changed', html: '<p>Your password was just changed. If this was not you, reset immediately.</p>' }
  }
}
function defaultZones() {
  return [
    { id: 'vn-hcm',  name: 'Vietnam · Ho Chi Minh', flag: 'VN', timezone: 'Asia/Ho_Chi_Minh' },
    { id: 'vn-hn',   name: 'Vietnam · Hanoi',       flag: 'VN', timezone: 'Asia/Ho_Chi_Minh' },
    { id: 'sg',      name: 'Singapore',             flag: 'SG', timezone: 'Asia/Singapore' },
    { id: 'us-east', name: 'United States · East',  flag: 'US', timezone: 'America/New_York' },
    { id: 'us-west', name: 'United States · West',  flag: 'US', timezone: 'America/Los_Angeles' },
    { id: 'eu-de',   name: 'Germany',               flag: 'DE', timezone: 'Europe/Berlin' },
    { id: 'jp',      name: 'Japan',                 flag: 'JP', timezone: 'Asia/Tokyo' }
  ]
}
// One-shot migration from daily-pricing schema to hourly. Idempotent.
function migratePricingToHourly() {
  if (!config.pricing) { config.pricing = defaultPricing(); return }
  const p = config.pricing
  if (p.ipv4 && p.ipv4.perHour === undefined && Number(p.ipv4.perDay) > 0) p.ipv4.perHour = Math.max(1, Math.floor(p.ipv4.perDay / 24))
  if (p.ipv6 && p.ipv6.perHour === undefined && Number(p.ipv6.perDay) > 0) p.ipv6.perHour = Math.max(1, Math.floor(p.ipv6.perDay / 24))
  if (!p.minHours) p.minHours = 1
  if (!p.maxHours) p.maxHours = 8760
  if (p.ipv4 && p.ipv4.perDay !== undefined) delete p.ipv4.perDay
  if (p.ipv6 && p.ipv6.perDay !== undefined) delete p.ipv6.perDay
  if (p.minDays !== undefined) delete p.minDays
  if (p.maxDays !== undefined) delete p.maxDays
}

// Convert "now + hours" to an ISO datetime and a YYYY-MM-DD shadow for legacy sweeps.
function addHours(h) {
  const d = new Date(Date.now() + Number(h) * 3600_000)
  return { expiresAt: d.toISOString(), expires: d.toISOString().slice(0, 10) }
}

// Mask the local-part of an email for public-ish display (affiliate referral
// list shows partial info so the referrer can confirm a signup without leaking PII).
function maskEmail(e) {
  const s = String(e || '')
  const at = s.indexOf('@')
  if (at <= 1) return s
  const local = s.slice(0, at); const dom = s.slice(at)
  return local[0] + '***' + local[local.length - 1] + dom
}

// â”€â”€ Tiny security helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Block SSRF: refuse to make outbound requests to private/loopback/metadata IPs
// or to literal hostnames that resolve to them. Returns true if URL is safe.
async function isSafeOutboundUrl(urlStr) {
  let u
  try { u = new URL(urlStr) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  const host = u.hostname
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')) return false
  // resolve to IPs and check every one
  const isPriv = (ip) => {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number)
      if (parts[0] === 10) return true
      if (parts[0] === 127) return true
      if (parts[0] === 169 && parts[1] === 254) return true // link-local + AWS metadata
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
      if (parts[0] === 192 && parts[1] === 168) return true
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true // CGNAT
      if (parts[0] === 0) return true
      return false
    }
    if (net.isIPv6(ip)) {
      const lc = ip.toLowerCase()
      if (lc === '::1' || lc === '::') return true
      if (lc.startsWith('fc') || lc.startsWith('fd')) return true // ULA
      if (lc.startsWith('fe80')) return true // link-local
      if (lc.startsWith('::ffff:')) return isPriv(lc.slice(7)) // mapped v4
      return false
    }
    return false
  }
  if (net.isIP(host)) return !isPriv(host)
  try {
    const ips = await dns.lookup(host, { all: true })
    return ips.every((r) => !isPriv(r.address))
  } catch { return false }
}

function sendMail({ to, subject, html, text }) {
  const smtp = config.smtp
  if (!smtp || !smtp.host || !smtp.user) {
    console.log(`[mail] (not configured) would send to=${to} subj="${subject}"`)
    return Promise.resolve(false)
  }
  const port = Number(smtp.port) || 587
  const useImplicitTLS = port === 465
  const host = smtp.host
  const user = smtp.user
  const pass = smtp.pass || ''
  const from = smtp.from || smtp.user
  return new Promise((resolve) => {
    let sock = useImplicitTLS
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : net.connect({ host, port })
    sock.setTimeout(20_000)
    let buf = ''
    let step = 0
    let upgraded = useImplicitTLS
    const writeLine = (line) => sock.write(line + '\r\n')
    const cleanup = (ok) => { try { sock.destroy() } catch {} resolve(ok) }
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@proxyhub>`,
      'MIME-Version: 1.0'
    ]
    const body = html
      ? [...headers, 'Content-Type: text/html; charset=utf-8', '', html]
      : [...headers, 'Content-Type: text/plain; charset=utf-8', '', text || '']
    const dataPayload = body.join('\r\n').replace(/^\./gm, '..') + '\r\n.'
    const onLine = (line) => {
      // step 0: greet â†' EHLO
      if (step === 0) { writeLine(`EHLO proxyhub`); step = 1; return }
      // step 1: read EHLO response; once we hit final 250 with no continuation, proceed
      if (step === 1) {
        if (line.startsWith('250 ')) {
          if (!upgraded) { writeLine('STARTTLS'); step = 2 }
          else { writeLine(`AUTH LOGIN`); step = 3 }
        }
        return
      }
      if (step === 2) {
        // expect 220 ready to start TLS
        if (!line.startsWith('220')) return cleanup(false)
        const upgraded2 = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => {})
        sock = upgraded2
        sock.setTimeout(20_000)
        sock.on('error', () => cleanup(false))
        sock.on('timeout', () => cleanup(false))
        buf = ''
        sock.on('data', onData)
        upgraded = true
        // need a fresh EHLO over TLS
        writeLine(`EHLO proxyhub`); step = 1
        return
      }
      if (step === 3) {
        // 334 VXNlcm5hbWU6 â†' send b64 user
        writeLine(Buffer.from(user, 'utf8').toString('base64')); step = 4; return
      }
      if (step === 4) {
        writeLine(Buffer.from(pass, 'utf8').toString('base64')); step = 5; return
      }
      if (step === 5) {
        // 235 auth ok â†' MAIL FROM
        if (!line.startsWith('235')) return cleanup(false)
        const fromAddr = (from.match(/<(.+)>/) || [null, from])[1]
        writeLine(`MAIL FROM:<${fromAddr}>`); step = 6; return
      }
      if (step === 6) {
        if (!line.startsWith('250')) return cleanup(false)
        const toAddr = (to.match(/<(.+)>/) || [null, to])[1]
        writeLine(`RCPT TO:<${toAddr}>`); step = 7; return
      }
      if (step === 7) {
        if (!line.startsWith('250')) return cleanup(false)
        writeLine('DATA'); step = 8; return
      }
      if (step === 8) {
        if (!line.startsWith('354')) return cleanup(false)
        sock.write(dataPayload + '\r\n')
        step = 9; return
      }
      if (step === 9) {
        if (!line.startsWith('250')) return cleanup(false)
        writeLine('QUIT'); step = 10
        // resolve true after QUIT regardless of server farewell
        setTimeout(() => cleanup(true), 200)
        return
      }
    }
    const onData = (chunk) => {
      buf += chunk.toString('utf8')
      let idx
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2)
        onLine(line)
      }
    }
    sock.on('data', onData)
    sock.on('error', () => cleanup(false))
    sock.on('timeout', () => cleanup(false))
  })
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Stripe Checkout â€” raw HTTPS to api.stripe.com (no npm dep). We support:
//   * `POST /api/v1/user/billing/checkout`  â†' create a Checkout Session, return url
//   * `POST /api/webhooks/stripe`           â†' verify signature + credit wallet
//
// Config (in config.json):
//   billing.stripeSecretKey       â€” sk_test_... or sk_live_...
//   billing.stripeWebhookSecret   â€” whsec_... (from `stripe listen` or dashboard)
//   billing.currency              â€” "vnd", "usd", etc. defaults to "usd"
//   billing.successUrl            â€” where customer lands after pay (optional)
//   billing.cancelUrl             â€” where customer lands on cancel (optional)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function stripeApi(pathStr, formObj) {
  return new Promise((resolve, reject) => {
    const key = readSecret(config.billing?.stripeSecretKey)
    if (!key) return reject(new Error('billing.stripeSecretKey not configured'))
    const body = new URLSearchParams(formObj).toString()
    const req = https.request({
      method: 'POST',
      hostname: 'api.stripe.com',
      path: pathStr,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          const json = JSON.parse(raw)
          if (res.statusCode >= 400) return reject(new Error(json.error?.message || `Stripe HTTP ${res.statusCode}`))
          resolve(json)
        } catch (e) { reject(new Error(`Stripe parse: ${raw.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Verify the `Stripe-Signature` header per https://stripe.com/docs/webhooks/signatures.
// Throws if invalid. Tolerance = 5 minutes against replay.
function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) throw new Error('missing signature or secret')
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((s) => s.trim())))
  const ts = Number(parts.t)
  const sig = parts.v1
  if (!ts || !sig) throw new Error('malformed signature header')
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) throw new Error('signature timestamp out of tolerance')
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  // timing-safe compare
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(sig, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('signature mismatch')
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ── PayPal (raw HTTPS, no SDK) ─────────────────────────────────────────────
//
// Flow (Top-up wallet via PayPal):
//   1. Customer: POST /api/v1/user/billing/paypal/create-order { amount, currency? }
//      → backend creates a PayPal order (intent=CAPTURE), returns { orderId, approveUrl }.
//   2. Customer redirected to approveUrl → pays on PayPal.
//   3. PayPal redirects back to billing.paypalReturnUrl?token=ORDER_ID&PayerID=…
//   4. SPA: POST /api/v1/user/billing/paypal/capture { orderId } → backend captures
//      the order, credits wallet (dedup via SQLite `paypal_seen`).
//
// Config (config.billing):
//   paypalEnabled    — bool
//   paypalMode       — 'sandbox' | 'live'  (default 'sandbox')
//   paypalClientId   — application client ID
//   paypalSecret     — application secret
//   paypalReturnUrl  — URL PayPal redirects to after pay (e.g. https://your-domain/customer/billing?paypal=ok)
//   paypalCancelUrl  — URL PayPal redirects to on cancel
//   paypalCurrency   — fallback currency if not specified in request (default 'USD')

let _paypalTokenCache = { value: '', expiresAt: 0 }
function paypalApiHost() {
  return config.billing?.paypalMode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com'
}
async function paypalAccessToken() {
  const now = Date.now()
  if (_paypalTokenCache.value && _paypalTokenCache.expiresAt > now + 30_000) return _paypalTokenCache.value
  const clientId = readSecret(config.billing?.paypalClientId)
  const secret = readSecret(config.billing?.paypalSecret)
  if (!clientId || !secret) throw new Error('paypalClientId / paypalSecret not configured')
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const body = 'grant_type=client_credentials'
  return new Promise((resolve, reject) => {
    const r = https.request({
      method: 'POST', hostname: paypalApiHost(), path: '/v1/oauth2/token',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json'
      }
    }, (res2) => {
      let chunks = []
      res2.on('data', (c) => chunks.push(c))
      res2.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (res2.statusCode >= 400) return reject(new Error(j.error_description || `PayPal token HTTP ${res2.statusCode}`))
          _paypalTokenCache = { value: j.access_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000 }
          resolve(j.access_token)
        } catch (e) { reject(new Error(`PayPal token parse: ${e.message}`)) }
      })
    })
    r.on('error', reject)
    r.end(body)
  })
}
async function paypalApi(method, pathStr, jsonBody) {
  const token = await paypalAccessToken()
  const body = jsonBody ? JSON.stringify(jsonBody) : ''
  return new Promise((resolve, reject) => {
    const r = https.request({
      method, hostname: paypalApiHost(), path: pathStr,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }, (res2) => {
      let chunks = []
      res2.on('data', (c) => chunks.push(c))
      res2.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let j
        try { j = JSON.parse(raw) } catch { j = { raw } }
        if (res2.statusCode >= 400) {
          const msg = j.message || j.error_description || (j.details && j.details[0] && j.details[0].description) || `PayPal HTTP ${res2.statusCode}`
          return reject(new Error(msg))
        }
        resolve(j)
      })
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

// ── billing ledger (SQLite-backed; falls back to memory when sqlite absent) ──
const billingMemory = new Map() // user_id -> { balance, tx: [] }
function userBalance(userId) {
  if (sqliteDb) {
    try {
      const r = sqliteDb.prepare('SELECT balance_after FROM billing_tx WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId)
      return r ? Number(r.balance_after) || 0 : 0
    } catch { return 0 }
  }
  const m = billingMemory.get(userId)
  return m ? m.balance : 0
}
function recordBillingTx(userId, type, amount, note) {
  // SECURITY: wrap the read-balance + write-tx in an EXCLUSIVE transaction so two
  // concurrent requests can't both read the same `prev` and double-credit/debit.
  const ts = new Date().toISOString()
  // Credit-style txns add positive delta; everything else (purchase/refund-debit/etc) is negative,
  // except 'refund' which is positive (paid back).
  const positiveTypes = new Set(['topup', 'trial', 'affiliate', 'refund', 'admin-credit', 'promo'])
  const sign = positiveTypes.has(type) ? 1 : -1
  const delta = sign * Math.abs(amount)
  if (sqliteDb) {
    try {
      const txFn = sqliteDb.prepare(`
        INSERT INTO billing_tx (ts, user_id, type, amount, balance_after, note)
        SELECT ?, ?, ?, ?,
               MAX(0, COALESCE((SELECT balance_after FROM billing_tx WHERE user_id = ? ORDER BY id DESC LIMIT 1), 0) + ?),
               ?
        RETURNING balance_after
      `)
      const row = txFn.get(ts, userId, type, delta, userId, delta, note || '')
      return Number(row?.balance_after) || 0
    } catch (e) { console.warn(`[billing] sqlite tx failed: ${e.message}`) }
  }
  let m = billingMemory.get(userId); if (!m) { m = { balance: 0, tx: [] }; billingMemory.set(userId, m) }
  m.balance = Math.max(0, m.balance + delta)
  m.tx.unshift({ ts, type, amount: delta, balanceAfter: m.balance, note: note || '' })
  if (m.tx.length > 500) m.tx.length = 500
  return m.balance
}

// ── Scoped free-credit grants ───────────────────────────────────────────────
// A redeemed credit code becomes a grant earmarked for ONE product group
// (all|ipv4|ipv6|hub) with an optional expiry (YYYY-MM-DD). Grants are spent
// automatically at checkout, before the wallet, and only on a matching group.
function activeGrantsFor(userId, group) {
  const today = new Date().toISOString().slice(0, 10)
  return (config.creditGrants || [])
    .filter((g) => g.userId === userId && Number(g.remaining) > 0 && (g.group === 'all' || g.group === group))
    .filter((g) => !g.expiresAt || g.expiresAt >= today)
    .sort((a, b) => (a.expiresAt || '9999-99-99').localeCompare(b.expiresAt || '9999-99-99')) // soonest-expiring first
}
// Non-mutating: how much scoped credit would cover `cost`, plus the per-grant plan.
function previewScopedCredit(userId, group, cost) {
  let remaining = Math.max(0, Math.round(Number(cost) || 0))
  const plan = []
  for (const g of activeGrantsFor(userId, group)) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Number(g.remaining))
    if (take > 0) { plan.push({ id: g.id, take }); remaining -= take }
  }
  return { applied: plan.reduce((s, p) => s + p.take, 0), plan }
}
// Mutating: deduct the planned amounts from grants. Call ONLY on the success path.
function commitScopedCredit(plan) {
  for (const p of plan || []) {
    const g = (config.creditGrants || []).find((x) => x.id === p.id)
    if (g) g.remaining = Math.max(0, Number(g.remaining) - p.take)
  }
}
// Re-credit a cancelled order's prorated free-credit share as a fresh grant
// (same product group + original expiry). If that expiry has already passed the
// grant is born expired = effectively forfeited, which is correct.
function recreditGrant(order, amount) {
  if (!(amount > 0) || !order.ownerId) return
  if (!Array.isArray(config.creditGrants)) config.creditGrants = []
  config.creditGrants.push({
    id: `GR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    userId: order.ownerId,
    group: order.creditGroup || (String(order.type).toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4'),
    amount, remaining: amount,
    currency: (config.pricing?.currency || 'VND').toUpperCase(),
    expiresAt: order.creditExpiresAt || '',
    code: `refund-${order.id}`,
    createdAt: new Date().toISOString()
  })
}

// Append an audit entry. Writes to SQLite when available (fast indexed search)
// and ALWAYS mirrors to audit.log (cheap rotation + backup-friendly). Best-effort.
const auditInsertStmt = sqliteDb ? sqliteDb.prepare('INSERT INTO audit (ts, actor, ip, method, path, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)') : null
function audit(entry) {
  try {
    const ts = new Date().toISOString()
    const full = { ts, ...entry }
    if (auditInsertStmt) {
      try { auditInsertStmt.run(ts, full.actor || '', full.ip || '', full.method || '', full.path || '', Number(full.status) || 0, full.note || '') } catch {}
    }
    fs.appendFile(auditPath, JSON.stringify(full) + '\n').catch(() => {})
  } catch { /* ignore */ }
}

// ── Centralized error log ────────────────────────────────────────────────
// Dedupes by (source, code, resolved): identical errors get coalesced into
// one row via count + last_ts. Severity ladder: info < warn < error. Context
// is a JSON blob (whatever extra fields are useful for triage). Auto-purges
// resolved rows older than 30d hourly.
const errorInsertStmt = sqliteDb ? sqliteDb.prepare(`
  INSERT INTO errors (first_ts, last_ts, count, source, level, code, message, context, node_id, proxy_id)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
`) : null
// Dedup key includes proxy_id + node_id so per-proxy errors stay distinct
// (otherwise a single "tls:bind-fail" row would swallow events from every
// failing proxy and admins couldn't see which ones are affected).
const errorDedupStmt = sqliteDb ? sqliteDb.prepare(`
  UPDATE errors SET last_ts = ?, count = count + 1, message = ?, context = ?
  WHERE source = ? AND COALESCE(code, '') = COALESCE(?, '')
    AND COALESCE(node_id, '') = COALESCE(?, '')
    AND COALESCE(proxy_id, '') = COALESCE(?, '')
    AND resolved = 0
`) : null
const errorPruneStmt = sqliteDb ? sqliteDb.prepare(
  `DELETE FROM errors WHERE resolved = 1 AND last_ts < ?`
) : null
function logError({ source, level, code, message, context, nodeId, proxyId } = {}) {
  if (!sqliteDb || !source) return
  try {
    const now = Date.now()
    const lvl = level === 'info' || level === 'warn' ? level : 'error'
    const ctx = context ? (typeof context === 'string' ? context : JSON.stringify(context)) : null
    const msg = message ? String(message).slice(0, 1000) : null
    const codeStr = code ? String(code).slice(0, 80) : null
    // Try dedup first; if no row updated, insert fresh.
    const upd = errorDedupStmt.run(now, msg, ctx, source, codeStr, nodeId || null, proxyId || null)
    if (!upd || !upd.changes) {
      errorInsertStmt.run(now, now, source, lvl, codeStr, msg, ctx, nodeId || null, proxyId || null)
    }
  } catch (e) {
    // Never let error-logging itself crash the caller — fall back to stderr only.
    console.warn('[logError] insert failed:', e.message)
  }
}
function pruneErrors() {
  if (!errorPruneStmt) return
  try {
    const cutoff = Date.now() - 30 * 86_400_000
    const info = errorPruneStmt.run(cutoff)
    if (info && info.changes > 0) console.log(`[errors] pruned ${info.changes} resolved row(s) older than 30d`)
  } catch { /* noop */ }
}
setInterval(pruneErrors, 3600_000).unref()
function safeJsonParse(s) { try { return JSON.parse(s) } catch { return s } }

function execAsync(command, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = execChild(command, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.killed) return reject(new Error(`exec timed out after ${timeoutMs}ms`))
      const out = String(stdout || '') + String(stderr || '')
      if (err) return reject(new Error(out || err.message))
      resolve(out)
    })
    if (!child) reject(new Error('failed to spawn child'))
  })
}

// Run system `ping` against an IPv4/IPv6 literal. Args go to spawn (no shell),
// and net.isIP() must have validated `target` before calling — we do not
// quote-escape here.
function pingIp(target, family, count) {
  return new Promise((resolve) => {
    const args = [family === 6 ? '-6' : '-4', '-c', String(count), '-W', '2', '-n', target]
    const child = spawnChild('ping', args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const hardLimitMs = count * 2500 + 5000
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* noop */ } }, hardLimitMs)
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => { clearTimeout(killTimer); resolve({ code: -1, stdout, stderr: err.message }) })
    child.on('close', (code) => { clearTimeout(killTimer); resolve({ code: code ?? -1, stdout, stderr }) })
  })
}

function parsePingOutput(raw) {
  const stats = { transmitted: 0, received: 0, loss: 100, rtt: null, samples: [] }
  const summary = raw.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+received(?:,\s+\+\d+\s+errors)?,\s+([\d.]+)%\s+packet loss/)
  if (summary) {
    stats.transmitted = Number(summary[1])
    stats.received = Number(summary[2])
    stats.loss = Number(summary[3])
  }
  const rtt = raw.match(/rtt\s+min\/avg\/max\/m?dev\s+=\s+([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s+ms/)
  if (rtt) stats.rtt = { min: Number(rtt[1]), avg: Number(rtt[2]), max: Number(rtt[3]), mdev: Number(rtt[4]) }
  for (const m of raw.matchAll(/icmp_seq=(\d+)\s+ttl=(\d+)\s+time=([\d.]+)\s+ms/g)) {
    stats.samples.push({ seq: Number(m[1]), ttl: Number(m[2]), time: Number(m[3]) })
  }
  return stats
}

// Generic in-memory rate limiter for the customer Tools endpoints.
// Keyed by `${userId}:${bucket}` — 1 in-flight per bucket + N/hour per bucket.
// Resets on process restart; that's fine for diagnostics.
const rateInflight = new Set()
const rateHourly = new Map() // key -> { windowStart, count }
function rateCheck(userId, bucket, limit) {
  const key = `${userId}:${bucket}`
  if (rateInflight.has(key)) return `concurrent ${bucket} request in progress — wait for it to finish`
  const now = Date.now()
  const slot = rateHourly.get(key)
  if (!slot || now - slot.windowStart > 3600_000) {
    rateHourly.set(key, { windowStart: now, count: 0 })
  }
  if (rateHourly.get(key).count >= limit) return `${bucket} quota exceeded (${limit}/hour) — try again later`
  return null
}
function rateAcquire(userId, bucket) {
  const key = `${userId}:${bucket}`
  rateInflight.add(key)
  rateHourly.get(key).count += 1
}
function rateRelease(userId, bucket) { rateInflight.delete(`${userId}:${bucket}`) }

// ── IP intelligence (Team Cymru DNS — no external HTTP) ──────────────────
// Returns ASN, CIDR, country, registry, allocation date, and AS org name.
// Both v4 and v6 supported. Cheap, no API keys, no rate-limit on Cymru side.
function ipv4Reversed(ip) { return ip.split('.').reverse().join('.') }
function ipv6Reversed(ip) {
  const parts = ip.split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts[1] !== undefined ? (parts[1] ? parts[1].split(':') : []) : []
  const missing = 8 - left.length - right.length
  const groups = [...left, ...Array(missing).fill('0'), ...right].map((g) => g.padStart(4, '0'))
  return groups.join('').split('').reverse().join('.')
}
async function ipInfoLookup(ip) {
  const family = net.isIP(ip)
  if (!family) return { error: 'invalid IP' }
  const isV6 = family === 6
  const reversed = isV6 ? ipv6Reversed(ip) : ipv4Reversed(ip)
  const originDomain = isV6 ? 'origin6.asn.cymru.com' : 'origin.asn.cymru.com'
  let originParts = []
  try {
    const res = await dns.resolveTxt(`${reversed}.${originDomain}`)
    originParts = (res[0]?.join('') || '').split('|').map((s) => s.trim())
  } catch (e) {
    return { ip, family: isV6 ? 'ipv6' : 'ipv4', error: `cymru lookup failed: ${e.code || e.message}` }
  }
  const asn = (originParts[0] || '').split(/\s+/)[0] || null
  const out = {
    ip,
    family: isV6 ? 'ipv6' : 'ipv4',
    asn: asn ? `AS${asn}` : null,
    cidr: originParts[1] || null,
    country: originParts[2] || null,
    registry: originParts[3] || null,
    allocDate: originParts[4] || null,
    org: null
  }
  if (asn) {
    try {
      const res = await dns.resolveTxt(`AS${asn}.asn.cymru.com`)
      const t = (res[0]?.join('') || '').split('|').map((s) => s.trim())
      out.org = t[4] || null
    } catch { /* org enrichment is optional */ }
  }
  return out
}

// ── DNSBL blacklist check ────────────────────────────────────────────────
// IPv4 only — almost no public DNSBL supports v6. ENOTFOUND/ENODATA = clean,
// any A-record answer = listed. Real DNSBL servers return 127.0.0.x codes.
const DNSBLS = [
  { name: 'Spamhaus ZEN',    host: 'zen.spamhaus.org' },
  { name: 'SpamCop',         host: 'bl.spamcop.net' },
  { name: 'Barracuda',       host: 'b.barracudacentral.org' },
  { name: 'SORBS DNSBL',     host: 'dnsbl.sorbs.net' },
  { name: 'SORBS Spam',      host: 'spam.dnsbl.sorbs.net' },
  { name: 'Mailspike',       host: 'bl.mailspike.net' },
  { name: 'UCEPROTECT L1',   host: 'dnsbl-1.uceprotect.net' },
  { name: 'Manitu IX',       host: 'ix.dnsbl.manitu.net' },
  { name: 'PSBL Surriel',    host: 'psbl.surriel.com' },
  { name: 'Abuseat CBL',     host: 'cbl.abuseat.org' }
]
async function checkOneDnsbl(reversed, dnsbl) {
  const started = Date.now()
  const query = `${reversed}.${dnsbl.host}`
  try {
    const res = await Promise.race([
      dns.resolve4(query),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
    ])
    return { name: dnsbl.name, host: dnsbl.host, listed: true, response: res.join(', '), latencyMs: Date.now() - started }
  } catch (e) {
    const code = e.code || ''
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { name: dnsbl.name, host: dnsbl.host, listed: false, latencyMs: Date.now() - started }
    }
    return { name: dnsbl.name, host: dnsbl.host, listed: null, error: e.message || code, latencyMs: Date.now() - started }
  }
}
async function blacklistCheck(ip) {
  if (net.isIP(ip) !== 4) return { error: 'DNSBL only supports IPv4 addresses' }
  const reversed = ipv4Reversed(ip)
  const results = await Promise.all(DNSBLS.map((b) => checkOneDnsbl(reversed, b)))
  const listed = results.filter((r) => r.listed === true).length
  const clean  = results.filter((r) => r.listed === false).length
  const errors = results.filter((r) => r.listed === null).length
  return { ip, total: DNSBLS.length, listed, clean, errors, results }
}

// ── Bulk proxy check ─────────────────────────────────────────────────────
// Parses each line via parseProxyLine() then runs checkExternalProxy() with
// a worker-pool concurrency cap. Preserves input order in the response.
// ── Ookla / speedtest.net integration ────────────────────────────────────
// Fetches the public server list at speedtest.net/api/js/servers and caches
// per-country for 6 hours. The full list per country is ~50-200 entries.
const OOKLA_CACHE = new Map() // country code (upper) -> { ts, servers }
const OOKLA_CACHE_TTL_MS = 6 * 3600_000
const OOKLA_COUNTRY_NAME = {
  VN: 'Vietnam',
  US: 'United States',
  SG: 'Singapore',
  JP: 'Japan',
  DE: 'Germany',
  HK: 'Hong Kong',
  GB: 'United Kingdom',
  KR: 'South Korea',
  TH: 'Thailand',
  ID: 'Indonesia',
  PH: 'Philippines',
  MY: 'Malaysia',
  AU: 'Australia',
  IN: 'India',
  FR: 'France'
}
const OOKLA_SUPPORTED_COUNTRIES = Object.keys(OOKLA_COUNTRY_NAME)

function httpsGetJson(targetUrl, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'ProxyBox/1.0', 'Accept': 'application/json' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c; if (body.length > 4 * 1024 * 1024) { res.destroy(); reject(new Error('response too large')) } })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchOoklaServers(country) {
  const key = String(country || 'VN').toUpperCase()
  const cached = OOKLA_CACHE.get(key)
  if (cached && (Date.now() - cached.ts) < OOKLA_CACHE_TTL_MS) return cached.servers
  const countryName = OOKLA_COUNTRY_NAME[key]
  // Two-stage lookup — speedtest.net's `country=` parameter SORTS by distance
  // from the caller, not strict filter. When the control plane is in VN and
  // user asks for US, country=US returns 0 US servers. The `search=` param
  // matches sponsor/name strings and is much more reliable for cross-region.
  const urls = []
  if (countryName) {
    urls.push(`https://www.speedtest.net/api/js/servers?engine=js&https_functional=1&country=${encodeURIComponent(countryName)}&limit=100`)
    urls.push(`https://www.speedtest.net/api/js/servers?engine=js&https_functional=1&search=${encodeURIComponent(countryName)}&limit=100`)
  } else {
    urls.push(`https://www.speedtest.net/api/js/servers?engine=js&https_functional=1&limit=100`)
  }
  try {
    let strict = []
    for (const u of urls) {
      try {
        const data = await httpsGetJson(u, 15_000)
        const all = Array.isArray(data) ? data.filter((s) => s && s.host && s.sponsor) : []
        strict = all.filter((s) => String(s.cc || '').toUpperCase() === key)
        if (strict.length) break
      } catch { /* try next URL */ }
    }
    const servers = strict.slice(0, 100)
    OOKLA_CACHE.set(key, { ts: Date.now(), servers })
    return servers
  } catch (e) {
    if (cached) return cached.servers
    return []
  }
}

function pickOoklaServer(servers, ispFilter) {
  if (!servers.length) return null
  let pool = servers
  if (ispFilter && ispFilter !== 'auto') {
    const needle = String(ispFilter).toLowerCase()
    const filtered = servers.filter((s) => String(s.sponsor || '').toLowerCase().includes(needle))
    if (filtered.length) pool = filtered
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

// Server.host is like "speedtest.fpt.vn:8080" — split into host+port+proto.
function parseOoklaHost(server) {
  const hostStr = String(server.host || '')
  let m = hostStr.match(/^([^:/]+):(\d+)$/)
  if (m) return { host: m[1], port: Number(m[2]), proto: 'http' }
  const urlStr = String(server.url || '')
  m = urlStr.match(/^(https?):\/\/([^:/]+)(?::(\d+))?/)
  if (m) {
    const proto = m[1]
    return { host: m[2], port: Number(m[3]) || (proto === 'https' ? 443 : 80), proto }
  }
  return { host: hostStr || 'invalid', port: 8080, proto: 'http' }
}

// Tunnel through a customer-owned proxy to the picked Ookla server and
// download for up to maxMs / maxBytes (Ookla standard: 15s window). Returns
// sustained throughput + first-byte latency.
// Upload phase — POSTs random data to Ookla server's /upload.php through the
// proxy tunnel and measures bytes sent per second. Mirrors the tunnel setup of
// the download function below but writes instead of reads. Capped by maxMs.
function speedTestUploadThroughProxy({ proxy, server, maxMs = 12_000, maxBytes = 60 * 1024 * 1024 }) {
  const proxyType = String(proxy.protocol || proxy.type || 'http').toLowerCase().includes('socks') ? 'socks5' : 'http'
  const ph = parseOoklaHost(server)
  const targetPath = '/speedtest/upload.php'
  const RAND = crypto.randomBytes(64 * 1024) // 64KB random reusable chunk

  return new Promise((resolve) => {
    let proxySock, appSock
    let settled = false
    let totalSent = 0
    let dataStarted = null

    const finalize = (extra = {}) => {
      if (settled) return
      settled = true
      try { appSock && appSock !== proxySock && appSock.destroy() } catch { /* noop */ }
      try { proxySock && proxySock.destroy() } catch { /* noop */ }
      const dur = dataStarted ? Date.now() - dataStarted : 0
      const mbps = dur > 0 ? (totalSent * 8) / (dur * 1000) : 0
      resolve({
        ok: extra.ok ?? (totalSent > 0),
        totalBytes: totalSent,
        durationMs: dur,
        mbps: Math.round(mbps * 100) / 100,
        error: extra.error || null
      })
    }
    const overallTimer = setTimeout(() => finalize({ ok: totalSent > 0 }), maxMs)

    proxySock = net.createConnection({ host: customerFacingHost(proxy) || proxy.listenHost, port: Number(proxy.port) })
    proxySock.setNoDelay(true)
    proxySock.on('error', (e) => { clearTimeout(overallTimer); finalize({ ok: false, error: `proxy: ${e.message}` }) })

    const startUpload = (carriedOver = Buffer.alloc(0)) => {
      const isHttps = ph.proto === 'https'
      appSock = isHttps
        ? tls.connect({ socket: proxySock, servername: ph.host, rejectUnauthorized: false })
        : proxySock

      const sendRequest = () => {
        appSock.write(
          `POST ${targetPath} HTTP/1.1\r\n` +
          `Host: ${ph.host}\r\n` +
          `User-Agent: ProxyBox-Speedtest\r\n` +
          `Content-Type: application/octet-stream\r\n` +
          `Content-Length: ${maxBytes}\r\n` +
          `Connection: close\r\n\r\n`
        )
        dataStarted = Date.now()
        const writeMore = () => {
          while (!settled && totalSent < maxBytes) {
            const remain = maxBytes - totalSent
            const chunk = remain < RAND.length ? RAND.slice(0, remain) : RAND
            const ok = appSock.write(chunk)
            totalSent += chunk.length
            if (!ok) break
          }
          if (totalSent >= maxBytes && !settled) finalize({ ok: true })
        }
        appSock.on('drain', writeMore)
        writeMore()
      }
      if (isHttps) appSock.once('secureConnect', sendRequest)
      else sendRequest()

      appSock.on('data', () => { /* server response received — let timer/finalize handle */ })
      appSock.on('error', (e) => { clearTimeout(overallTimer); finalize({ ok: totalSent > 0, error: `upload: ${e.message}` }) })
      appSock.on('end',   () => { clearTimeout(overallTimer); finalize({ ok: totalSent > 0 }) })
      appSock.on('close', () => { clearTimeout(overallTimer); finalize({ ok: totalSent > 0 }) })
      if (carriedOver.length) appSock.emit('data', carriedOver)
    }

    proxySock.once('connect', () => {
      const targetHost = ph.host, targetPort = ph.port
      const username = proxy.username || '', password = proxy.password || ''
      if (proxyType === 'socks5') {
        const methods = (username || password) ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
        proxySock.write(methods)
        const onGreet = (chunk) => {
          if (chunk.length < 2 || chunk[0] !== 0x05) { clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: bad greeting' }) }
          const m = chunk[1]; proxySock.off('data', onGreet)
          const sendConnect = () => {
            const dn = Buffer.from(targetHost, 'utf8')
            proxySock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, dn.length]), dn, Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])]))
            let rbuf = Buffer.alloc(0)
            const onReply = (c) => {
              rbuf = Buffer.concat([rbuf, c])
              if (rbuf.length < 4) return
              if (rbuf[0] !== 0x05 || rbuf[1] !== 0x00) { proxySock.off('data', onReply); clearTimeout(overallTimer); return finalize({ ok: false, error: `socks5: rejected ${rbuf[1]}` }) }
              const atyp = rbuf[3]
              let addrLen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? (rbuf.length < 5 ? -1 : 1 + rbuf[4]) : -2
              if (addrLen < 0) { if (addrLen === -2) { proxySock.off('data', onReply); clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: bad atyp' }) } return }
              const total = 4 + addrLen + 2
              if (rbuf.length < total) return
              proxySock.off('data', onReply)
              startUpload(rbuf.slice(total))
            }
            proxySock.on('data', onReply)
          }
          if (m === 0x00) return sendConnect()
          if (m === 0x02) {
            const u = Buffer.from(username, 'utf8'), p = Buffer.from(password, 'utf8')
            proxySock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]))
            const onAuth = (a) => { proxySock.off('data', onAuth); if (a.length < 2 || a[1] !== 0x00) { clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: auth failed' }) } sendConnect() }
            proxySock.on('data', onAuth)
            return
          }
          clearTimeout(overallTimer); finalize({ ok: false, error: `socks5: no method (${m})` })
        }
        proxySock.on('data', onGreet)
      } else {
        const lines = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`]
        if (username || password) lines.push(`Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
        lines.push('Connection: keep-alive', '', '')
        proxySock.write(lines.join('\r\n'))
        let buf = Buffer.alloc(0)
        const onConnectData = (chunk) => {
          buf = Buffer.concat([buf, chunk])
          const idx = buf.indexOf('\r\n\r\n')
          if (idx === -1) { if (buf.length > 32768) { proxySock.off('data', onConnectData); clearTimeout(overallTimer); finalize({ ok: false, error: 'proxy headers too large' }) } return }
          const head = buf.slice(0, idx).toString('utf8')
          proxySock.off('data', onConnectData)
          if (!/^HTTP\/1\.\d 200/i.test(head)) { clearTimeout(overallTimer); return finalize({ ok: false, error: `proxy refused: ${head.split('\r\n')[0]}` }) }
          startUpload(buf.slice(idx + 4))
        }
        proxySock.on('data', onConnectData)
      }
    })
  })
}

function speedTestThroughProxy({ proxy, server, maxMs = 15_000, maxBytes = 80 * 1024 * 1024 }) {
  const proxyType = String(proxy.protocol || proxy.type || 'http').toLowerCase().includes('socks') ? 'socks5' : 'http'
  const ph = parseOoklaHost(server)
  const targetPath = `/speedtest/random4000x4000.jpg?nocache=${Date.now()}`

  return new Promise((resolve) => {
    const started = Date.now()
    let proxySock
    let appSock
    let settled = false
    let totalBytes = 0
    let firstByteTime = null
    let dataStarted = null
    let headerBuf = Buffer.alloc(0)
    let headersDone = false

    const finalize = (extra = {}) => {
      if (settled) return
      settled = true
      try { appSock && appSock !== proxySock && appSock.destroy() } catch { /* noop */ }
      try { proxySock && proxySock.destroy() } catch { /* noop */ }
      const end = Date.now()
      const durationMs = dataStarted ? (end - dataStarted) : 0
      const mbps = durationMs > 0 ? (totalBytes * 8) / (durationMs * 1000) : 0
      resolve({
        ok: extra.ok ?? (totalBytes > 0 && headersDone),
        totalBytes,
        durationMs,
        ttfbMs: firstByteTime ? (firstByteTime - started) : null,
        mbps: Math.round(mbps * 100) / 100,
        error: extra.error || null,
        server: {
          id: server.id,
          sponsor: server.sponsor,
          name: server.name,
          country: server.country,
          host: ph.host,
          port: ph.port
        }
      })
    }
    const overallTimer = setTimeout(() => finalize({ ok: totalBytes > 0 }), maxMs)

    proxySock = net.createConnection({
      host: customerFacingHost(proxy) || proxy.listenHost,
      port: Number(proxy.port)
    })
    proxySock.setNoDelay(true)
    proxySock.on('error', (e) => { clearTimeout(overallTimer); finalize({ ok: false, error: `proxy connect: ${e.message}` }) })

    const startApp = (carriedOver = Buffer.alloc(0)) => {
      const isHttps = ph.proto === 'https'
      if (isHttps) {
        appSock = tls.connect({ socket: proxySock, servername: ph.host, rejectUnauthorized: false })
      } else {
        appSock = proxySock
      }
      const sendRequest = () => {
        appSock.write(
          `GET ${targetPath} HTTP/1.1\r\n` +
          `Host: ${ph.host}\r\n` +
          `User-Agent: ProxyBox-Speedtest\r\n` +
          `Accept: */*\r\n` +
          `Accept-Encoding: identity\r\n` +
          `Connection: close\r\n\r\n`
        )
      }
      const onData = (chunk) => {
        if (firstByteTime === null) firstByteTime = Date.now()
        if (!headersDone) {
          headerBuf = Buffer.concat([headerBuf, chunk])
          const idx = headerBuf.indexOf('\r\n\r\n')
          if (idx === -1) {
            if (headerBuf.length > 32768) { clearTimeout(overallTimer); return finalize({ ok: false, error: 'headers too large' }) }
            return
          }
          const head = headerBuf.slice(0, idx).toString('utf8')
          const statusLine = head.split('\r\n')[0]
          if (!/^HTTP\/1\.\d 2\d\d/.test(statusLine)) {
            clearTimeout(overallTimer); return finalize({ ok: false, error: `target: ${statusLine}` })
          }
          headersDone = true
          dataStarted = Date.now()
          const bodyStart = idx + 4
          totalBytes += Math.max(0, headerBuf.length - bodyStart)
          headerBuf = null
          if (totalBytes >= maxBytes) { clearTimeout(overallTimer); finalize({ ok: true }) }
          return
        }
        totalBytes += chunk.length
        if (totalBytes >= maxBytes) { clearTimeout(overallTimer); finalize({ ok: true }) }
      }
      if (isHttps) appSock.once('secureConnect', sendRequest)
      else sendRequest()
      appSock.on('data', onData)
      appSock.on('error', (e) => { clearTimeout(overallTimer); finalize({ ok: totalBytes > 0, error: `target: ${e.message}` }) })
      appSock.on('end', () => { clearTimeout(overallTimer); finalize({ ok: totalBytes > 0 }) })
      appSock.on('close', () => { clearTimeout(overallTimer); finalize({ ok: totalBytes > 0 }) })
      if (carriedOver.length) appSock.emit('data', carriedOver)
    }

    proxySock.once('connect', () => {
      const targetHost = ph.host
      const targetPort = ph.port
      const username = proxy.username || ''
      const password = proxy.password || ''
      if (proxyType === 'socks5') {
        const methods = (username || password) ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
        proxySock.write(methods)
        const onGreet = (chunk) => {
          if (chunk.length < 2 || chunk[0] !== 0x05) { clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: bad greeting' }) }
          const m = chunk[1]
          proxySock.off('data', onGreet)
          const sendConnect = () => {
            const dn = Buffer.from(targetHost, 'utf8')
            const req = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, dn.length]), dn, Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])])
            proxySock.write(req)
            let rbuf = Buffer.alloc(0)
            const onReply = (c) => {
              rbuf = Buffer.concat([rbuf, c])
              if (rbuf.length < 4) return
              if (rbuf[0] !== 0x05 || rbuf[1] !== 0x00) { proxySock.off('data', onReply); clearTimeout(overallTimer); return finalize({ ok: false, error: `socks5: connect rejected (${rbuf[1]})` }) }
              const atyp = rbuf[3]
              let addrLen = 0
              if (atyp === 0x01) addrLen = 4
              else if (atyp === 0x04) addrLen = 16
              else if (atyp === 0x03) { if (rbuf.length < 5) return; addrLen = 1 + rbuf[4] }
              else { proxySock.off('data', onReply); clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: unknown atyp' }) }
              const total = 4 + addrLen + 2
              if (rbuf.length < total) return
              proxySock.off('data', onReply)
              startApp(rbuf.slice(total))
            }
            proxySock.on('data', onReply)
          }
          if (m === 0x00) return sendConnect()
          if (m === 0x02) {
            const u = Buffer.from(username, 'utf8'); const p = Buffer.from(password, 'utf8')
            proxySock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]))
            const onAuth = (a) => {
              proxySock.off('data', onAuth)
              if (a.length < 2 || a[1] !== 0x00) { clearTimeout(overallTimer); return finalize({ ok: false, error: 'socks5: auth failed' }) }
              sendConnect()
            }
            proxySock.on('data', onAuth)
            return
          }
          clearTimeout(overallTimer); finalize({ ok: false, error: `socks5: no method (${m})` })
        }
        proxySock.on('data', onGreet)
      } else {
        const lines = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`]
        if (username || password) {
          const auth = Buffer.from(`${username}:${password}`).toString('base64')
          lines.push(`Proxy-Authorization: Basic ${auth}`)
        }
        lines.push('Connection: keep-alive', '', '')
        proxySock.write(lines.join('\r\n'))
        let buf = Buffer.alloc(0)
        const onConnectData = (chunk) => {
          buf = Buffer.concat([buf, chunk])
          const idx = buf.indexOf('\r\n\r\n')
          if (idx === -1) {
            if (buf.length > 32768) { proxySock.off('data', onConnectData); clearTimeout(overallTimer); finalize({ ok: false, error: 'proxy headers too large' }) }
            return
          }
          const head = buf.slice(0, idx).toString('utf8')
          proxySock.off('data', onConnectData)
          if (!/^HTTP\/1\.\d 200/i.test(head)) { clearTimeout(overallTimer); return finalize({ ok: false, error: `proxy refused: ${head.split('\r\n')[0]}` }) }
          startApp(buf.slice(idx + 4))
        }
        proxySock.on('data', onConnectData)
      }
    })
  })
}

async function bulkProxyCheck(lines, concurrency = 8) {
  const items = lines.map((line, idx) => ({ idx, line, parsed: parseProxyLine(line) }))
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      const it = items[i]
      if (it.parsed.error) {
        results[i] = { idx: it.idx, line: it.line, ok: false, error: it.parsed.error, latencyMs: 0 }
        continue
      }
      try {
        const r = await checkExternalProxy(it.parsed, 12_000)
        results[i] = { idx: it.idx, line: it.line, type: it.parsed.type, host: it.parsed.host, port: it.parsed.port, ...r }
      } catch (e) {
        results[i] = { idx: it.idx, line: it.line, ok: false, error: e.message, latencyMs: 0 }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// Test an arbitrary user-supplied proxy by tunneling an HTTPS GET to ipify
// and reading the exit IP from the body. Supports HTTP CONNECT and SOCKS5.
const EXTERNAL_CHECK_HOST = 'api64.ipify.org'
function checkExternalProxy({ type, host, port, username, password }, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const started = Date.now()
    let socket
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      try { socket && socket.destroy() } catch { /* noop */ }
      resolve({ latencyMs: Date.now() - started, ...r })
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    try {
      socket = net.createConnection({ host, port, family: net.isIP(host) || undefined })
    } catch (e) {
      clearTimeout(timer)
      return finish({ ok: false, error: e.message })
    }
    socket.setNoDelay(true)
    socket.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }) })

    const runTls = (extra = Buffer.alloc(0)) => {
      const tlsSock = tls.connect({ socket, servername: EXTERNAL_CHECK_HOST, rejectUnauthorized: false }, () => {
        tlsSock.write(`GET / HTTP/1.1\r\nHost: ${EXTERNAL_CHECK_HOST}\r\nUser-Agent: ProxyBox-Check\r\nConnection: close\r\n\r\n`)
      })
      let buf = Buffer.alloc(0)
      tlsSock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]) })
      tlsSock.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }) })
      const onEnd = () => {
        clearTimeout(timer)
        const text = buf.toString('utf8')
        const idx = text.indexOf('\r\n\r\n')
        const body = (idx === -1 ? '' : text.slice(idx + 4)).trim().split(/\s/)[0]
        const exitIp = body && net.isIP(body) ? body : null
        finish({ ok: Boolean(exitIp), exitIp, error: exitIp ? null : 'no IP returned' })
      }
      tlsSock.on('end', onEnd)
      tlsSock.on('close', () => { if (!settled) onEnd() })
      if (extra.length) tlsSock.emit('data', extra)
    }

    socket.once('connect', () => {
      if (type === 'socks5') {
        // Greeting: offer no-auth + user/pass methods
        const methods = (username || password) ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
        socket.write(methods)
        const onGreet = (chunk) => {
          if (chunk.length < 2 || chunk[0] !== 0x05) return finish({ ok: false, error: 'socks5: bad greeting reply' })
          const m = chunk[1]
          socket.off('data', onGreet)
          if (m === 0x00) return sendConnect()
          if (m === 0x02) {
            const u = Buffer.from(username || '', 'utf8')
            const p = Buffer.from(password || '', 'utf8')
            socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]))
            const onAuth = (a) => {
              socket.off('data', onAuth)
              if (a.length < 2 || a[1] !== 0x00) return finish({ ok: false, error: 'socks5: auth failed' })
              sendConnect()
            }
            socket.on('data', onAuth)
            return
          }
          finish({ ok: false, error: `socks5: no acceptable method (${m})` })
        }
        socket.on('data', onGreet)

        const sendConnect = () => {
          const domain = Buffer.from(EXTERNAL_CHECK_HOST, 'utf8')
          const req = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, domain.length]),
            domain,
            Buffer.from([(443 >> 8) & 0xff, 443 & 0xff])
          ])
          socket.write(req)
          let rbuf = Buffer.alloc(0)
          const onReply = (chunk) => {
            rbuf = Buffer.concat([rbuf, chunk])
            if (rbuf.length < 4) return
            if (rbuf[0] !== 0x05) { socket.off('data', onReply); return finish({ ok: false, error: 'socks5: bad reply' }) }
            if (rbuf[1] !== 0x00) { socket.off('data', onReply); return finish({ ok: false, error: `socks5: connect rejected (${rbuf[1]})` }) }
            // skip ATYP + addr + port to find end of reply
            const atyp = rbuf[3]
            let addrLen = 0
            if (atyp === 0x01) addrLen = 4
            else if (atyp === 0x04) addrLen = 16
            else if (atyp === 0x03) { if (rbuf.length < 5) return; addrLen = 1 + rbuf[4] }
            else { socket.off('data', onReply); return finish({ ok: false, error: 'socks5: unknown atyp' }) }
            const total = 4 + addrLen + 2
            if (rbuf.length < total) return
            socket.off('data', onReply)
            runTls(rbuf.slice(total))
          }
          socket.on('data', onReply)
        }
      } else {
        const lines = [`CONNECT ${EXTERNAL_CHECK_HOST}:443 HTTP/1.1`, `Host: ${EXTERNAL_CHECK_HOST}:443`]
        if (username || password) {
          const auth = Buffer.from(`${username || ''}:${password || ''}`).toString('base64')
          lines.push(`Proxy-Authorization: Basic ${auth}`)
        }
        lines.push('Connection: keep-alive', '', '')
        socket.write(lines.join('\r\n'))
        let buf = Buffer.alloc(0)
        const onData = (chunk) => {
          buf = Buffer.concat([buf, chunk])
          const idx = buf.indexOf('\r\n\r\n')
          if (idx === -1) { if (buf.length > 32_768) { socket.off('data', onData); finish({ ok: false, error: 'http: headers too large' }) } return }
          const head = buf.slice(0, idx).toString('utf8')
          socket.off('data', onData)
          if (!/^HTTP\/1\.\d 200/i.test(head)) return finish({ ok: false, error: `http: ${head.split('\r\n')[0]}` })
          runTls(buf.slice(idx + 4))
        }
        socket.on('data', onData)
      }
    })
  })
}

// Parse a user-pasted proxy line into structured fields. Supports:
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   http://user:pass@host:port      (or socks5://)
//   [::1]:8080  /  [::1]:8080:user:pass   (IPv6 with brackets)
function parseProxyLine(raw) {
  const s = String(raw || '').trim()
  if (!s) return { error: 'empty' }
  let scheme = null
  let body = s
  const m = s.match(/^([a-z0-9]+):\/\/(.+)$/i)
  if (m) { scheme = m[1].toLowerCase(); body = m[2] }
  let host, port, username = '', password = ''
  const at = body.lastIndexOf('@')
  if (at >= 0) {
    const cred = body.slice(0, at)
    const ci = cred.indexOf(':')
    if (ci >= 0) { username = cred.slice(0, ci); password = cred.slice(ci + 1) }
    else username = cred
    body = body.slice(at + 1)
  }
  if (body.startsWith('[')) {
    const close = body.indexOf(']')
    if (close < 0) return { error: 'missing closing ] for IPv6 host' }
    host = body.slice(1, close)
    const rest = body.slice(close + 1)
    if (!rest.startsWith(':')) return { error: 'missing port' }
    const parts = rest.slice(1).split(':')
    port = parts[0]
    if (parts.length >= 3) { username = parts[1]; password = parts.slice(2).join(':') }
  } else {
    const parts = body.split(':')
    if (parts.length < 2) return { error: 'expected host:port' }
    host = parts[0]; port = parts[1]
    if (parts.length >= 4) { username = parts[2]; password = parts.slice(3).join(':') }
  }
  const portNum = Number(port)
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return { error: 'invalid port' }
  if (!host) return { error: 'invalid host' }
  // Reject hostnames — IP literal only, matches the IP-only spirit of these tools.
  if (!net.isIP(host)) return { error: 'host must be IPv4 or IPv6 literal' }
  const type = scheme === 'socks5' || scheme === 'socks' ? 'socks5' : 'http'
  return { type, host, port: portNum, username, password }
}

function sshExec(opts, command, timeoutMs = 150_000) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client()
    let output = ''
    let settled = false
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); try { conn.end() } catch { /* noop */ } fn(arg) }
    const timer = setTimeout(() => finish(reject, new Error('SSH/install timed out')), timeoutMs)
    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) return finish(reject, err)
        const append = (d) => { output += d.toString('utf8'); if (output.length > 256_000) output = output.slice(-256_000) }
        stream.on('data', append)
        stream.stderr.on('data', append)
        stream.on('close', (code) => finish(resolve, { code: code ?? -1, output }))
      })
    })
    conn.on('error', (e) => finish(reject, e))
    conn.connect({
      host: opts.host,
      port: Number(opts.port) || 22,
      username: opts.username || 'root',
      password: opts.password || undefined,
      privateKey: opts.privateKey || undefined,
      readyTimeout: 20_000,
      keepaliveInterval: 5_000
    })
  })
}

function ensureApiKey() {
  if (!config.api.apiKey || WEAK_API_KEYS.has(config.api.apiKey)) {
    const generated = crypto.randomBytes(24).toString('hex')
    config.api.apiKey = generated
    console.warn('[api] WARNING: no strong api.apiKey in config.')
    console.warn(`[api] Using a generated key for this run only: ${generated}`)
    console.warn('[api] Set api.apiKey in your config file to keep it stable across restarts.')
  }
}

function warnWeakUsers() {
  const plaintext = config.users.filter((user) => user.password && !user.passwordHash)
  if (plaintext.length > 0) {
    console.warn(`[api] WARNING: ${plaintext.length} user(s) have plaintext passwords in config; they will be hashed on next change.`)
  }
  if (config.users.length === 0) {
    console.warn('[api] WARNING: no users configured. Login is disabled until you add one to config.users.')
  }
}

// ---------------------------------------------------------------------------
// Network detection (auto-discover the server's IPv4 addresses + IPv6 prefixes)
// ---------------------------------------------------------------------------

function detectNetwork() {
  const interfaces = os.networkInterfaces()
  const ipv4 = []
  const ipv6 = []
  const ipv6Prefixes = []
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.internal) continue
      if (addr.family === 'IPv4' || addr.family === 4) {
        ipv4.push({ iface: name, address: addr.address, cidr: addr.cidr || `${addr.address}/32` })
      } else if (addr.family === 'IPv6' || addr.family === 6) {
        if (addr.scopeid) continue
        const lower = addr.address.toLowerCase()
        if (lower === '::1' || lower === '::' || isLinkLocalV6(lower) || isUniqueLocalV6(lower)) continue
        const prefixLen = addr.cidr ? Number(addr.cidr.split('/')[1]) : 128
        ipv6.push({ iface: name, address: addr.address, cidr: addr.cidr || `${addr.address}/${prefixLen}` })
        if (Number.isFinite(prefixLen) && prefixLen <= 64) {
          const prefix = ipv6PrefixOf(addr.address, prefixLen)
          if (!ipv6Prefixes.some((p) => p.prefix === prefix && p.prefixLen === prefixLen)) {
            ipv6Prefixes.push({ iface: name, address: addr.address, cidr: `${prefix}/${prefixLen}`, prefix, prefixLen })
          }
        }
      }
    }
  }
  return { ipv4, ipv6, ipv6Prefixes }
}

function ipv4Pool() {
  const fromInterfaces = detected.ipv4.map((entry) => entry.address)
  const extra = Array.isArray(config.network.extraIPv4) ? config.network.extraIPv4 : []
  return [...new Set([...fromInterfaces, ...extra])]
}

function ipv6Pool() {
  // Addresses actually assigned to an interface are usable straight away.
  const fromInterfaces = detected.ipv6.map((entry) => entry.address)
  // Optionally also generate hosts from a detected prefix â€” only safe when the
  // operator has made the prefix locally routable (e.g. `ip -6 route add local
  // <prefix> dev <iface>`); off by default.
  const fromPrefixes = []
  if (config.network.expandIpv6Prefixes) {
    for (const prefix of detected.ipv6Prefixes) {
      const parts = expandIPv6(prefix.prefix)
      for (let host = 2; host < 2 + IPV6_POOL_PER_PREFIX; host += 1) {
        fromPrefixes.push(ipv6FromParts([...parts.slice(0, 7), host]))
      }
    }
  }
  const extra = Array.isArray(config.network.extraIPv6) ? config.network.extraIPv6 : []
  return [...new Set([...fromInterfaces, ...fromPrefixes, ...extra])]
}

function nodeAddressPool(node, type) {
  const wantV6 = String(type).toLowerCase() === 'ipv6'
  const list = wantV6 ? (node.network?.ipv6 || []) : (node.network?.ipv4 || [])
  return [...new Set(list.map((e) => e.address))]
  // Note: this returns ONLY addresses already attached to the node's NIC.
  // For IPv6 ROTATION (where the prefix is routed to the node but we mint
  // fresh /128s from it on demand), use mintFreshIpv6(node) which draws
  // from the full prefix entropy with crypto.randomBytes and avoids any IP
  // currently bound to an active proxy. The old synthesized-pool approach
  // here used a deterministic Math.sin generator that always produced the
  // same 256 addresses per prefix — guaranteed collision when N>256
  // proxies rotated, and IPs were aggressively reused across rotations.
}

// Mint a brand-new IPv6 /128 inside the node's routable prefix. Uses
// crypto.randomBytes for full entropy (~80 bits with a /48) and avoids
// any IP currently held by another active proxy on the same node. The
// /48 address space (2^80 hosts) is large enough that even after a year
// of hourly rotation on 100k proxies the collision probability with a
// past-assigned IP stays < 10^-12 — we don't track historical bindIps
// for memory reasons.
//
// Returns null if the node advertises no routable v6 prefix.
function mintFreshIpv6(node, usedSet = null) {
  // Prefer the agent-reported routable prefix list (BGP-level /48 or /56)
  // — that's the actual address space the operator owns. Falls back to
  // common-ancestor detection over the per-/128 entries.
  const prefixes = node?.network?.ipv6Prefixes || []
  if (prefixes.length > 0) {
    // Pick the WIDEST routable prefix (lowest prefixLen). For a typical
    // VPS with /48 + /64 + /128 reported, this picks the /48 → ~80 bits
    // of entropy per mint, large enough that even at 100k proxies
    // rotating hourly we won't collide with a past-rotated IP this side
    // of the heat death.
    let chosen = null
    let bestLen = 128
    for (const p of prefixes) {
      const len = Number(p.prefixLen)
      if (len > 0 && len < bestLen && len <= 64) { bestLen = len; chosen = p }
    }
    if (chosen) {
      const baseParts = expandIPv6(chosen.prefix)
      const used = usedSet || new Set()
      for (let attempt = 0; attempt < 16; attempt++) {
        const newParts = [...baseParts]
        const fullSegs = Math.floor(bestLen / 16)
        const boundaryBits = bestLen % 16
        if (boundaryBits && fullSegs < 8) {
          const keepMask = (0xffff << (16 - boundaryBits)) & 0xffff
          const rand = crypto.randomBytes(2).readUInt16BE(0) & ((1 << (16 - boundaryBits)) - 1)
          newParts[fullSegs] = (newParts[fullSegs] & keepMask) | rand
        }
        const start = fullSegs + (boundaryBits ? 1 : 0)
        for (let g = start; g < 8; g++) {
          newParts[g] = crypto.randomBytes(2).readUInt16BE(0)
        }
        const candidate = ipv6FromParts(newParts)
        if (!used.has(candidate)) return candidate
      }
      return null
    }
  }
  // Fallback: common-ancestor detection over attached addresses.
  const v6list = node?.network?.ipv6 || []
  if (v6list.length === 0) return null
  const allParts = v6list.map((e) => expandIPv6(e.address))
  let commonLen = 128
  // Compare segments left-to-right; once they diverge, that's where the
  // routable prefix ends.
  for (let seg = 0; seg < 8; seg++) {
    const first = allParts[0][seg]
    let same = true
    for (let i = 1; i < allParts.length; i++) {
      if (allParts[i][seg] !== first) { same = false; break }
    }
    if (same) continue
    // Within this 16-bit segment, count how many top bits agree across
    // all entries — gives a bit-granular prefix length when the
    // boundary isn't aligned to 16.
    let bitsAgreed = 0
    for (let b = 0; b < 16; b++) {
      const mask = 0x8000 >> b
      const bit = first & mask
      let allMatch = true
      for (let i = 1; i < allParts.length; i++) {
        if ((allParts[i][seg] & mask) !== bit) { allMatch = false; break }
      }
      if (allMatch) bitsAgreed++; else break
    }
    commonLen = seg * 16 + bitsAgreed
    break
  }
  // Also honour the declared per-entry CIDR if it's narrower than our
  // detected common prefix (defensive — operator may have constrained
  // the routable space).
  const declared = (() => {
    let best = 128
    for (const e of v6list) {
      const slash = String(e.cidr || '').indexOf('/')
      const len = slash >= 0 ? Number(String(e.cidr).slice(slash + 1)) : 128
      if (len > 0 && len < best) best = len
    }
    return best
  })()
  const prefixLen = Math.min(commonLen, declared)
  if (prefixLen >= 128) return null // no entropy to randomize
  const baseParts = allParts[0]
  const used = usedSet || new Set()
  for (let attempt = 0; attempt < 16; attempt++) {
    const newParts = [...baseParts]
    const fullSegs = Math.floor(prefixLen / 16)
    const boundaryBits = prefixLen % 16
    if (boundaryBits && fullSegs < 8) {
      const keepMask = (0xffff << (16 - boundaryBits)) & 0xffff
      const rand = crypto.randomBytes(2).readUInt16BE(0) & ((1 << (16 - boundaryBits)) - 1)
      newParts[fullSegs] = (newParts[fullSegs] & keepMask) | rand
    }
    const start = fullSegs + (boundaryBits ? 1 : 0)
    for (let g = start; g < 8; g++) {
      newParts[g] = crypto.randomBytes(2).readUInt16BE(0)
    }
    const candidate = ipv6FromParts(newParts)
    if (!used.has(candidate)) return candidate
  }
  return null
}

// Build a set of bindIps CURRENTLY held by active proxies on a node.
// Caller passes this to mintFreshIpv6 to guarantee no collision with
// in-use addresses. Cheap — one pass over config.proxies.
function currentlyUsedBindIps(nodeId) {
  const set = new Set()
  for (const p of config.proxies) {
    if ((p.nodeId || 'local') !== nodeId) continue
    if (p.bindIp) set.add(p.bindIp)
  }
  return set
}

function allocateBindIp(type, nodeId) {
  if (nodeId && nodeId !== 'local') {
    const node = config.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`node ${nodeId} not found`)
    const pool = nodeAddressPool(node, type)
    if (pool.length === 0) throw new Error(`node "${node.name}" has no usable ${type} address yet (waiting for agent heartbeat)`)
    const usage = new Map()
    for (const proxy of config.proxies) if (proxy.nodeId === nodeId) usage.set(proxy.bindIp, (usage.get(proxy.bindIp) || 0) + 1)
    pool.sort((a, b) => (usage.get(a) || 0) - (usage.get(b) || 0))
    return pool[0]
  }
  const wantV6 = String(type).toLowerCase() === 'ipv6'
  let candidates = wantV6 ? ipv6Pool() : ipv4Pool()
  if (candidates.length === 0) candidates = [...ipv4Pool(), ...ipv6Pool()]
  if (candidates.length === 0 && config.proxyDefaults.bindIp) candidates = [config.proxyDefaults.bindIp]
  if (candidates.length === 0) {
    throw new Error('no usable bind IP detected on this server (configure network.extraIPv4/extraIPv6 or proxyDefaults.bindIp)')
  }
  const usage = new Map()
  for (const proxy of config.proxies) if ((proxy.nodeId || 'local') === 'local') usage.set(proxy.bindIp, (usage.get(proxy.bindIp) || 0) + 1)
  candidates.sort((a, b) => (usage.get(a) || 0) - (usage.get(b) || 0))
  return candidates[0]
}

// ---------------------------------------------------------------------------
// IPv6 helpers
// ---------------------------------------------------------------------------

function expandIPv6(addr) {
  const clean = addr.split('%')[0]
  let head = []
  let tail = []
  if (clean.includes('::')) {
    const [h, t] = clean.split('::')
    head = h ? h.split(':') : []
    tail = t ? t.split(':') : []
  } else {
    head = clean.split(':')
  }
  const missing = 8 - head.length - tail.length
  const full = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail]
  return full.slice(0, 8).map((hextet) => parseInt(hextet || '0', 16) & 0xffff)
}

function ipv6FromParts(parts) {
  const hex = parts.map((part) => (part & 0xffff).toString(16))
  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let index = 0; index < 8; index += 1) {
    if (hex[index] === '0') {
      if (curStart === -1) curStart = index
      curLen += 1
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  if (bestLen < 2) return hex.join(':')
  const head = hex.slice(0, bestStart).join(':')
  const tail = hex.slice(bestStart + bestLen).join(':')
  return `${head}::${tail}`
}

function ipv6PrefixOf(addr, prefixLen) {
  const parts = expandIPv6(addr)
  for (let index = 0; index < 8; index += 1) {
    const start = index * 16
    if (start >= prefixLen) {
      parts[index] = 0
    } else if (start + 16 > prefixLen) {
      const bits = prefixLen - start
      parts[index] &= (0xffff << (16 - bits)) & 0xffff
    }
  }
  return ipv6FromParts(parts)
}

function isLinkLocalV6(lower) {
  return /^fe[89ab]/.test(lower)
}

function isUniqueLocalV6(lower) {
  return /^f[cd]/.test(lower)
}

// ---------------------------------------------------------------------------
// SSRF protection â€” block proxy targets that point at the server / private nets
// ---------------------------------------------------------------------------

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | (Number(octet) & 0xff)) >>> 0, 0)
}

function inCidr4(ip, base, bits) {
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]

function isBlockedIPv4(ip) {
  if (net.isIP(ip) !== 4) return true
  return BLOCKED_V4.some(([base, bits]) => inCidr4(ip, base, bits))
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase()
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  if (lower === '::' || lower === '::1') return true
  if (isLinkLocalV6(lower) || isUniqueLocalV6(lower)) return true
  if (lower.startsWith('ff')) return true
  return false
}

function isBlockedTarget(ip) {
  const version = net.isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true
}

// Cached, async DNS resolution. Uses c-ares (dns.resolve*) which runs on the
// event loop, not the libuv thread pool, so it doesn't become a bottleneck at
// high request rates; falls back to the system resolver for special cases.
const DNS_TTL_MS = 60_000
const DNS_CACHE_MAX = 4096
const dnsCache = new Map()

async function resolveHost(host, family) {
  const key = `${family}:${host}`
  const now = Date.now()
  const hit = dnsCache.get(key)
  if (hit && hit.expires > now) return hit.addresses
  let addresses
  try {
    addresses = family === 6 ? await dns.resolve6(host) : await dns.resolve4(host)
  } catch {
    const records = await dns.lookup(host, { all: true, family })
    addresses = records.map((record) => record.address)
  }
  if (!addresses || addresses.length === 0) throw new Error(`no IPv${family} address`)
  if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.clear()
  dnsCache.set(key, { addresses, expires: now + DNS_TTL_MS })
  return addresses
}

// An IPv4 proxy reaches targets over IPv4 only; an IPv6 proxy over IPv6 only
// (no cross-family fallback). family is 4 or 6.
async function resolveTarget(host, { family, allowPrivate }) {
  if (net.isIP(host)) {
    if (net.isIP(host) !== family) throw new Error(`target ${host} is not IPv${family}`)
    if (!allowPrivate && isBlockedTarget(host)) throw new Error(`blocked target ${host}`)
    return host
  }
  let addresses
  try {
    addresses = await resolveHost(host, family)
  } catch (error) {
    throw new Error(`no IPv${family} address for ${host} (${error.code || error.message})`)
  }
  if (!allowPrivate) {
    for (const address of addresses) {
      if (isBlockedTarget(address)) throw new Error(`blocked target ${host} -> ${address}`)
    }
  }
  return addresses[0]
}

function proxyFamily(proxy) {
  return (proxy.type || 'IPv4').toLowerCase() === 'ipv6' ? 6 : 4
}

// Effective outbound source address for a connection. Rotating IPv6 proxies pick
// a fresh address from the detected /48 pool on every upstream connection.
// Sticky-session pinning: when a client passes `user-session-<id>` in the
// proxy auth, all requests with the same session-id route to the same exit IP.
// Session TTL = 10 min by default, after which a new exit IP is picked.
// Industry-standard behavior matching Bright Data / Smartproxy / IPRoyal.
const STICKY_TTL_MS = 10 * 60_000
const stickySession = new Map() // key = `${proxyId}|${sessionId}` -> { ip, exp }
function stickyPick(proxyId, sessionId, pool) {
  const key = `${proxyId}|${sessionId}`
  const now = Date.now()
  const hit = stickySession.get(key)
  if (hit && hit.exp > now && pool.includes(hit.ip)) {
    hit.exp = now + STICKY_TTL_MS
    return hit.ip
  }
  const ip = pool[Math.floor(Math.random() * pool.length)]
  stickySession.set(key, { ip, exp: now + STICKY_TTL_MS })
  return ip
}
// Garbage-collect expired sticky sessions every 10 minutes.
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of stickySession) if (v.exp <= now) stickySession.delete(k)
}, 10 * 60_000).unref()

function effectiveBindIp(proxy, ctx) {
  if (proxy.type === 'IPv6' && proxy.rotate) {
    const pool = ipv6Pool()
    if (pool.length > 0) {
      if (ctx?.sessionId) return stickyPick(proxy.id, ctx.sessionId, pool)
      return pool[Math.floor(Math.random() * pool.length)]
    }
  }
  return proxy.bindIp
}

// ---------------------------------------------------------------------------
// Proxy engine (HTTP CONNECT + plain HTTP + SOCKS5, all with auth)
// ---------------------------------------------------------------------------

function ensureStats(id) {
  if (!stats.has(id)) {
    stats.set(id, {
      uploadBytes: 0,
      downloadBytes: 0,
      activeConnections: 0,
      totalConnections: 0,
      monthKey: new Date().toISOString().slice(0, 7),
      monthBytes: 0,
      secKey: 0,
      secBytes: 0,
      bpsIn: 0,
      bpsOut: 0,
      lastResetAt: new Date().toISOString(),
      // Cumulative up/down at the last history sample — drives per-hour deltas.
      histLastUp: 0,
      histLastDown: 0,
      // Connection insights — per-target aggregates + ring buffer of last N
      // connections. Capped to keep memory bounded under high traffic.
      topTargets: new Map(),   // host -> { count, bytesUp, bytesDown, lastTs }
      recentConns: []          // [{ ts, src, host, port, up, down, ms, kind }]
    })
  }
  const m = stats.get(id)
  if (!m.topTargets) m.topTargets = new Map()
  if (!m.recentConns) m.recentConns = []
  return m
}

const TOP_TARGETS_MAX = 50
const RECENT_CONNS_MAX = 50

function recordConnection(meter, info, proxyId, ownerId) {
  if (!info || !info.host) return
  const host = String(info.host).slice(0, 253).toLowerCase()
  const now = Date.now()
  let t = meter.topTargets.get(host)
  if (!t) {
    if (meter.topTargets.size >= TOP_TARGETS_MAX) {
      // Evict oldest entry (smallest lastTs) — coarse LRU.
      let oldestKey = null, oldestTs = Infinity
      for (const [k, v] of meter.topTargets) {
        if (v.lastTs < oldestTs) { oldestTs = v.lastTs; oldestKey = k }
      }
      if (oldestKey) meter.topTargets.delete(oldestKey)
    }
    t = { count: 0, bytesUp: 0, bytesDown: 0, lastTs: 0 }
    meter.topTargets.set(host, t)
  }
  t.count += 1
  t.bytesUp += info.up || 0
  t.bytesDown += info.down || 0
  t.lastTs = now
  meter.recentConns.push({
    ts: now,
    src: info.src || '',
    srcPort: info.srcPort || 0,
    host,
    port: info.port || 0,
    up: info.up || 0,
    down: info.down || 0,
    ms: info.ms || 0,
    kind: info.kind || 'http'
  })
  if (meter.recentConns.length > RECENT_CONNS_MAX) {
    meter.recentConns.splice(0, meter.recentConns.length - RECENT_CONNS_MAX)
  }
  // Persist to SQLite (best-effort — drop on error, don't slow the relay).
  if (connEventInsertStmt && proxyId) {
    try {
      connEventInsertStmt.run(now, proxyId, ownerId || null, info.src || '', info.srcPort || 0, host, info.port || 0, info.up || 0, info.down || 0, info.ms || 0, info.kind || 'http')
    } catch { /* noop */ }
  }
  // Fan-out to SSE subscribers (live "Kết nối live" page).
  pushSseEvent('connection', {
    proxyId: proxyId || null,
    ownerId: ownerId || null,
    ts: now,
    src: info.src || '',
    srcPort: info.srcPort || 0,
    host,
    port: info.port || 0,
    up: info.up || 0,
    down: info.down || 0,
    ms: info.ms || 0,
    kind: info.kind || 'http'
  })
  // Async geo enrichment — fire-and-forget so we never block the relay.
  if (info.src) { Promise.resolve().then(() => lookupGeo(info.src)).catch(() => {}) }
  if (host)     { Promise.resolve().then(() => lookupGeoForHost(host)).catch(() => {}) }
}

function addTraffic(meter, up, down) {
  meter.uploadBytes += up
  meter.downloadBytes += down
  const monthKey = new Date().toISOString().slice(0, 7)
  if (meter.monthKey !== monthKey) { meter.monthKey = monthKey; meter.monthBytes = 0 }
  meter.monthBytes += up + down
}

// Global 1-minute snapshot buffer for the dashboard realtime chart. Captures
// aggregate live connection count + bandwidth across all proxies, last 24h
// worth of minutes (1440 buckets ~= 200 KB). Older entries trimmed on push.
const TRAFFIC_MINUTE_MAX = 1440
const trafficMinute = []
setInterval(() => {
  let active = 0, totalConns = 0, bpsIn = 0, bpsOut = 0
  for (const [, s] of stats) {
    active += s.activeConnections || 0
    totalConns += s.totalConnections || 0
    bpsIn += s.bpsIn || 0
    bpsOut += s.bpsOut || 0
  }
  trafficMinute.push({ ts: Date.now(), active, totalConns, bpsIn, bpsOut })
  if (trafficMinute.length > TRAFFIC_MINUTE_MAX) {
    trafficMinute.splice(0, trafficMinute.length - TRAFFIC_MINUTE_MAX)
  }
}, 60_000).unref()

function limitFor(proxy, key, defaultKey) {
  const v = proxy[key]
  if (Number.isFinite(v) && v > 0) return v
  const d = config.proxyDefaults[defaultKey]
  return Number.isFinite(d) && d > 0 ? d : 0
}

function startProxy(proxy) {
  const plainPromise = listeners.has(proxy.id) ? Promise.resolve() : (() => {
    const server = net.createServer((client) => handleProxyClient(proxy, client))
    listeners.set(proxy.id, server)
    const host = proxy.listenHost || config.proxyDefaults.listenHost || '0.0.0.0'
    return new Promise((resolve) => {
      server.on('error', (error) => {
        console.error(`[proxy:${proxy.id}] ${error.message}`)
        proxy.status = 'error'
        resolve()
      })
      server.listen(proxy.port, host, 65535, () => {
        console.log(`[proxy:${proxy.id}] ${proxy.protocol || 'HTTP/SOCKS5'} ${host}:${proxy.port} -> ${proxy.bindIp}`)
        resolve()
      })
    })
  })()
  const tlsPromise = startProxyTls(proxy)
  return Promise.all([plainPromise, tlsPromise]).then(() => {})
}

// TLS-wrapped proxy listener — runs alongside the plain port. After the TLS
// handshake we peek at the first 56 bytes: if they match SHA-224(password) in
// hex, it's the Trojan protocol; otherwise we treat it as HTTPS-proxy (HTTP
// CONNECT/GET tunnelled inside TLS, which is what browsers send when their
// proxy scheme is `https://`).
function startProxyTls(proxy) {
  if (!proxyTls) return Promise.resolve()
  const tlsPort = Number(proxy.tlsPort || 0)
  if (!tlsPort) return Promise.resolve()
  const key = `${proxy.id}:tls`
  if (listeners.has(key)) return Promise.resolve()
  const server = tls.createServer({
    cert: proxyTls.cert,
    key: proxyTls.key,
    requestCert: false,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  }, (client) => handleProxyClientTls(proxy, client))
  listeners.set(key, server)
  const host = proxy.listenHost || config.proxyDefaults.listenHost || '0.0.0.0'
  return new Promise((resolve) => {
    server.on('error', (error) => {
      console.error(`[proxy-tls:${proxy.id}] ${error.message}`)
      resolve()
    })
    server.listen(tlsPort, host, 65535, () => {
      console.log(`[proxy-tls:${proxy.id}] Trojan+HTTPS-proxy ${host}:${tlsPort} -> ${proxy.bindIp}`)
      resolve()
    })
  })
}

function stopProxy(id) {
  const server = listeners.get(id)
  if (server) {
    server.close()
    listeners.delete(id)
  }
  const tlsKey = `${id}:tls`
  const tlsServer = listeners.get(tlsKey)
  if (tlsServer) {
    tlsServer.close()
    listeners.delete(tlsKey)
  }
}

// Dispatch a TLS-decrypted client: peek 56 bytes, compare to sha224(password)
// hex. Match = Trojan; otherwise replay those bytes as the start of an HTTP
// proxy header and reuse handleHttpProxy (the existing CONNECT/GET path with
// Proxy-Authorization auth + connect upstream + relay).
async function handleProxyClientTls(proxy, client) {
  // tls.TLSSocket exposes the same shape as net.Socket so the connection limit
  // / quota / per-source bookkeeping is identical to plain.
  const meter = ensureStats(proxy.id)
  const maxConns = limitFor(proxy, 'maxConnections', 'maxConnectionsPerProxy')
  const quota = limitFor(proxy, 'monthlyQuotaBytes', 'monthlyQuotaBytes')
  const perSrcMax = Number(proxy.perSrcMax || config.proxyDefaults.perSrcMax || 0)
  if (maxConns > 0 && meter.activeConnections >= maxConns) return client.destroy()
  if (perSrcMax > 0) {
    if (!meter.perSrc) meter.perSrc = new Map()
    const ip = (client.remoteAddress || '').replace(/^::ffff:/, '')
    const cur = meter.perSrc.get(ip) || 0
    if (cur >= perSrcMax) return client.destroy()
    meter.perSrc.set(ip, cur + 1)
    client.once('close', () => {
      const v = (meter.perSrc.get(ip) || 1) - 1
      if (v <= 0) meter.perSrc.delete(ip); else meter.perSrc.set(ip, v)
    })
  }
  if (quota > 0) {
    const monthKey = new Date().toISOString().slice(0, 7)
    if (meter.monthKey === monthKey && meter.monthBytes >= quota) return client.destroy()
  }
  meter.activeConnections += 1
  meter.totalConnections += 1
  // Decrement on socket close (see handleProxyClient) — never via finally, or a
  // client that closes mid-handshake leaves the SocketReader read pending and
  // the counter leaks. 'close' always fires exactly once.
  client.once('close', () => { meter.activeConnections = Math.max(0, meter.activeConnections - 1) })
  client.setNoDelay(true)
  client.setTimeout(120_000)
  client.once('timeout', () => client.destroy())
  try {
    const reader = new SocketReader(client)
    const probe = await reader.readBytes(56)
    const expected = trojanHash(proxy.password)
    if (probe.toString('latin1') === expected) {
      await handleTrojan(proxy, client, reader)
    } else {
      // Not Trojan — replay the 56 probed bytes as the start of an HTTP header
      // by re-attaching them and falling through to the existing parser.
      const rest = reader.detach()
      const initial = Buffer.concat([probe, rest])
      await handleHttpProxy(proxy, client, initial)
    }
  } catch {
    if (!client.destroyed) client.destroy()
  }
}

// Trojan request: CRLF + CMD(1=connect, 3=udp_assoc) + ATYP(1=v4|3=domain|4=v6)
// + DST.ADDR + DST.PORT + CRLF. We support CMD=1 (TCP CONNECT) only — UDP assoc
// in Trojan is rarely used and our SOCKS5 path also lacks it.
async function handleTrojan(proxy, client, reader) {
  // 3-conn cap (anti-abuse): Trojan auth = SHA224 match. Apply session
  // accounting here right after the hash match succeeded.
  const srcIp = (client.remoteAddress || '').replace(/^::ffff:/, '')
  if (!srcIpAllowedByWhitelist(proxy, srcIp) && !acquireProxySession(proxy, client, srcIp)) {
    return client.destroy()
  }
  const crlf1 = await reader.readBytes(2)
  if (crlf1[0] !== 0x0d || crlf1[1] !== 0x0a) throw new Error('trojan: bad framing 1')
  const cmd = (await reader.readBytes(1))[0]
  if (cmd !== 0x01) throw new Error(`trojan: unsupported cmd ${cmd}`)
  const atyp = (await reader.readBytes(1))[0]
  const host = await readSocksAddress(reader, atyp)
  const port = (await reader.readBytes(2)).readUInt16BE(0)
  const crlf2 = await reader.readBytes(2)
  if (crlf2[0] !== 0x0d || crlf2[1] !== 0x0a) throw new Error('trojan: bad framing 2')
  // Pause client before async upstream connect: Trojan clients send handshake
  // + payload back-to-back without waiting for an ACK, so without pausing the
  // payload bytes can drain into the void between detach() and pipe().
  client.pause()
  const rest = reader.detach()
  let upstream
  try {
    upstream = await connectUpstream(proxy, host, port, { sessionId: '', country: '' })
  } catch (error) {
    console.error(`[trojan:${proxy.id}] dial ${host}:${port} failed: ${error.message}`)
    return client.destroy()
  }
  relay(proxy, client, upstream, rest, { src: srcIp, srcPort: client.remotePort || 0, host, port, kind: 'trojan' })
  client.resume()
}

async function handleProxyClient(proxy, client) {
  const meter = ensureStats(proxy.id)
  const maxConns = limitFor(proxy, 'maxConnections', 'maxConnectionsPerProxy')
  const quota = limitFor(proxy, 'monthlyQuotaBytes', 'monthlyQuotaBytes')
  const perSrcMax = Number(proxy.perSrcMax || config.proxyDefaults.perSrcMax || 0)
  if (maxConns > 0 && meter.activeConnections >= maxConns) return client.destroy()
  if (perSrcMax > 0) {
    if (!meter.perSrc) meter.perSrc = new Map()
    const ip = (client.remoteAddress || '').replace(/^::ffff:/, '')
    const cur = meter.perSrc.get(ip) || 0
    if (cur >= perSrcMax) return client.destroy()
    meter.perSrc.set(ip, cur + 1)
    client.once('close', () => {
      const v = (meter.perSrc.get(ip) || 1) - 1
      if (v <= 0) meter.perSrc.delete(ip); else meter.perSrc.set(ip, v)
    })
  }
  if (quota > 0) {
    const monthKey = new Date().toISOString().slice(0, 7)
    if (meter.monthKey === monthKey && meter.monthBytes >= quota) return client.destroy()
  }
  meter.activeConnections += 1
  meter.totalConnections += 1
  // Decrement on socket close — fires exactly once for every socket (graceful
  // FIN, RST, timeout, or destroy). Do NOT tie this to the handler's finally:
  // a client that closes without 'end'/'error' mid-request leaves onceData()/
  // SocketReader pending forever, so finally never runs and the counter leaks.
  client.once('close', () => { meter.activeConnections = Math.max(0, meter.activeConnections - 1) })

  client.setNoDelay(true)
  client.setTimeout(120_000)
  client.once('timeout', () => client.destroy())

  try {
    const first = await onceData(client)
    if (!first || first.length === 0) return client.destroy()
    if (first[0] === 0x05) {
      await handleSocks5(proxy, client, first)
    } else {
      await handleHttpProxy(proxy, client, first)
    }
  } catch {
    if (!client.destroyed) client.destroy()
  }
}

function onceData(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('end', onEnd)
    }
    const onData = (chunk) => { cleanup(); resolve(chunk) }
    const onError = (error) => { cleanup(); reject(error) }
    const onEnd = () => { cleanup(); resolve(Buffer.alloc(0)) }
    socket.once('data', onData)
    socket.once('error', onError)
    socket.once('end', onEnd)
  })
}

class SocketReader {
  constructor(socket, initial) {
    this.socket = socket
    this.buffer = initial || Buffer.alloc(0)
    this.waiters = []
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.flush()
    }
    this.onError = (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error)
    }
    socket.on('data', this.onData)
    socket.on('error', this.onError)
  }

  flush() {
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index]
      if (waiter.tryResolve()) {
        this.waiters.splice(index, 1)
        index -= 1
      }
    }
  }

  readBytes(length) {
    if (this.buffer.length >= length) {
      const out = this.buffer.subarray(0, length)
      this.buffer = this.buffer.subarray(length)
      return Promise.resolve(out)
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({
        reject,
        tryResolve: () => {
          if (this.buffer.length < length) return false
          const out = this.buffer.subarray(0, length)
          this.buffer = this.buffer.subarray(length)
          resolve(out)
          return true
        }
      })
    })
  }

  readUntil(delimiter, maxBytes = 65536) {
    const marker = Buffer.from(delimiter)
    const read = () => {
      const index = this.buffer.indexOf(marker)
      if (index !== -1) {
        const end = index + marker.length
        const out = this.buffer.subarray(0, end)
        this.buffer = this.buffer.subarray(end)
        return out
      }
      if (this.buffer.length > maxBytes) throw new Error('header too large')
      return null
    }
    const immediate = read()
    if (immediate) return Promise.resolve(immediate)
    return new Promise((resolve, reject) => {
      this.waiters.push({
        reject,
        tryResolve: () => {
          try {
            const out = read()
            if (!out) return false
            resolve(out)
            return true
          } catch (error) {
            reject(error)
            return true
          }
        }
      })
    })
  }

  detach() {
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    const rest = this.buffer
    this.buffer = Buffer.alloc(0)
    return rest
  }
}

async function handleSocks5(proxy, client, initial) {
  const reader = new SocketReader(client, initial)
  const head = await reader.readBytes(2)
  if (head[0] !== 0x05) throw new Error('invalid SOCKS version')
  const methods = await reader.readBytes(head[1])
  if (!methods.includes(0x02)) {
    client.write(Buffer.from([0x05, 0xff]))
    return client.destroy()
  }
  client.write(Buffer.from([0x05, 0x02]))

  const authHead = await reader.readBytes(2)
  const username = (await reader.readBytes(authHead[1])).toString('utf8')
  const passLen = (await reader.readBytes(1))[0]
  const password = (await reader.readBytes(passLen)).toString('utf8')
  const srcIp = (client.remoteAddress || '').replace(/^::ffff:/, '')
  const whitelistOk = srcIpAllowedByWhitelist(proxy, srcIp)
  if (!whitelistOk && !isProxyAuthorized(proxy, username, password)) {
    client.write(Buffer.from([0x01, 0x01]))
    return client.destroy()
  }
  if (!whitelistOk && !acquireProxySession(proxy, client, srcIp)) {
    client.write(Buffer.from([0x01, 0x01]))
    return client.destroy()
  }
  client.write(Buffer.from([0x01, 0x00]))
  const sticky = parseStickyUser(username)

  const req = await reader.readBytes(4)
  if (req[1] !== 0x01) {
    client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    return client.destroy()
  }
  const host = await readSocksAddress(reader, req[3])
  const port = (await reader.readBytes(2)).readUInt16BE(0)
  const rest = reader.detach()

  let upstream
  try {
    upstream = await connectUpstream(proxy, host, port, { sessionId: sticky.sessionId, country: sticky.country })
  } catch (error) {
    client.write(Buffer.from([0x05, error.message.startsWith('blocked') ? 0x02 : 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    return client.destroy()
  }
  client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
  relay(proxy, client, upstream, rest, { src: srcIp, srcPort: client.remotePort || 0, host, port, kind: 'socks5' })
}

async function readSocksAddress(reader, atyp) {
  if (atyp === 0x01) return Array.from(await reader.readBytes(4)).join('.')
  if (atyp === 0x03) {
    const length = (await reader.readBytes(1))[0]
    return (await reader.readBytes(length)).toString('utf8')
  }
  if (atyp === 0x04) {
    const bytes = await reader.readBytes(16)
    const parts = []
    for (let index = 0; index < 16; index += 2) parts.push(bytes.readUInt16BE(index).toString(16))
    return parts.join(':')
  }
  throw new Error('unsupported SOCKS address type')
}

async function handleHttpProxy(proxy, client, initial) {
  const reader = new SocketReader(client, initial)
  const headerBuffer = await reader.readUntil('\r\n\r\n')
  const headerText = headerBuffer.toString('latin1')
  const [requestLine, ...headerLines] = headerText.split('\r\n')
  const [method, target, protocol] = requestLine.split(' ')
  const headers = parseHeaders(headerLines)
  const auth = parseBasicAuth(headers['proxy-authorization'])

  // IP-whitelist auth: skip user:pass when source IP is on the proxy's allowlist.
  // Industry-standard for users running their own scrapers from a fixed VPS.
  const srcIp = (client.remoteAddress || '').replace(/^::ffff:/, '')
  const whitelistOk = srcIpAllowedByWhitelist(proxy, srcIp)
  if (!whitelistOk && (!auth || !isProxyAuthorized(proxy, auth.username, auth.password))) {
    client.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="ProxyBox"\r\nContent-Length: 0\r\n\r\n')
    return client.destroy()
  }
  // 3-conn cap — applies to plain HTTP proxy AND HTTPS-proxy (TLS-wrap)
  // since both route through this handler. Whitelist bypass keeps unchanged.
  if (!whitelistOk && !acquireProxySession(proxy, client, srcIp)) {
    client.write('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nX-Proxy-Error: max 3 concurrent connections\r\n\r\n')
    return client.destroy()
  }
  const rest = reader.detach()
  const sticky = auth ? parseStickyUser(auth.username) : { sessionId: '', country: '' }

  if (method?.toUpperCase() === 'CONNECT') {
    const [host, portText] = splitHostPort(target, 443)
    let upstream
    try {
      upstream = await connectUpstream(proxy, host, Number(portText), { sessionId: sticky.sessionId, country: sticky.country })
    } catch (error) {
      client.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: ${error.message}\r\n\r\n`)
      return client.destroy()
    }
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: ProxyBox\r\n\r\n')
    relay(proxy, client, upstream, rest, { src: srcIp, srcPort: client.remotePort || 0, host, port: Number(portText), kind: 'connect' })
    return
  }

  let url
  try {
    url = new URL(target)
  } catch {
    client.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
    return client.destroy()
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  let upstream
  try {
    upstream = await connectUpstream(proxy, url.hostname, port, { sessionId: sticky.sessionId, country: sticky.country })
  } catch (error) {
    client.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: ${error.message}\r\n\r\n`)
    return client.destroy()
  }
  const cleanHeaders = headerLines.filter((line) => line && !/^proxy-/i.test(line)).join('\r\n')
  upstream.write(`${method} ${url.pathname}${url.search} ${protocol}\r\n${cleanHeaders}\r\n\r\n`)
  relay(proxy, client, upstream, rest, { src: srcIp, srcPort: client.remotePort || 0, host: url.hostname, port, kind: 'http' })
}

function splitHostPort(value, defaultPort) {
  const index = value.lastIndexOf(':')
  if (index === -1) return [value, defaultPort]
  return [value.slice(0, index), value.slice(index + 1)]
}

function parseHeaders(lines) {
  const headers = {}
  for (const line of lines) {
    const index = line.indexOf(':')
    if (index === -1) continue
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
  }
  return headers
}

function parseBasicAuth(value) {
  if (!value || !value.toLowerCase().startsWith('basic ')) return null
  const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8')
  const index = decoded.indexOf(':')
  if (index === -1) return null
  return { username: decoded.slice(0, index), password: decoded.slice(index + 1) }
}

function timingEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function isProxyAuthorized(proxy, username, password) {
  if (proxy.status === 'expired') return false
  // Grace-period support: status='grace' = expired but still serving for 1h so
  // customer can renew. Auth still passes during grace.
  // Username can encode sticky-session + geo tags, industry-standard format:
  //   <baseUser>-session-<id>          â†' same session = same exit IP
  //   <baseUser>-country-<cc>           â†' restrict to country-tagged pool
  //   <baseUser>-country-<cc>-session-<id>
  // We strip suffixes and compare just the base user to proxy.username.
  const base = parseStickyUser(username).user
  return timingEqual(proxy.username, base) && timingEqual(proxy.password, password)
}

// Parse industry-standard sticky-session username format. Returns the base user
// + optional sessionId + country code. Real services (Bright Data / Smartproxy
// / IPRoyal / Soax) all use this same `-session-X` / `-country-X` convention.
function parseStickyUser(raw) {
  let user = String(raw || '')
  let sessionId = ''
  let country = ''
  // Match `-session-<id>` (alphanum, 1..32)
  const s = user.match(/-session-([A-Za-z0-9]{1,32})/)
  if (s) { sessionId = s[1]; user = user.replace(s[0], '') }
  const c = user.match(/-country-([a-zA-Z]{2})/)
  if (c) { country = c[1].toLowerCase(); user = user.replace(c[0], '') }
  return { user, sessionId, country }
}

// Returns true if `host` matches any pattern in the deny lists (global + per
// proxy). Patterns: exact match, suffix match (".example.com" matches sub-),
// or a literal "*" anywhere (drop wildcard semantics for now).
function isHostDenied(proxy, host) {
  if (!host) return false
  const h = String(host).toLowerCase()
  const lists = []
  if (Array.isArray(config.denyHosts) && config.denyHosts.length) lists.push(config.denyHosts)
  if (Array.isArray(proxy?.denyHosts) && proxy.denyHosts.length) lists.push(proxy.denyHosts)
  for (const list of lists) {
    for (const p of list) {
      if (!p) continue
      const pat = String(p).toLowerCase()
      if (pat.startsWith('.')) { if (h === pat.slice(1) || h.endsWith(pat)) return true }
      else if (h === pat) return true
    }
  }
  return false
}

async function connectUpstream(proxy, host, port, ctx) {
  if (isHostDenied(proxy, host)) {
    throw new Error(`blocked: destination ${host} is on deny list`)
  }
  // Chained upstream (residential gateway primitive): if proxy.upstreamUrl is set
  // we tunnel via that proxy instead of egressing directly. Supports http(s) proxy
  // CONNECT only â€” SOCKS5 chaining is a future round.
  if (proxy.upstreamUrl) {
    return connectViaUpstream(proxy.upstreamUrl, host, port, proxy)
  }
  const family = proxyFamily(proxy)
  const bindIp = effectiveBindIp(proxy, ctx)
  const allowPrivate = proxy.allowPrivateTargets ?? config.proxyDefaults.allowPrivateTargets ?? false
  const target = await resolveTarget(host, { family, allowPrivate })
  return new Promise((resolve, reject) => {
    const options = { host: target, port: Number(port), timeout: 30_000 }
    if (bindIp && net.isIP(bindIp) === family) options.localAddress = bindIp
    const socket = net.createConnection(options)
    socket.setNoDelay(true)
    socket.once('connect', () => resolve(socket))
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`connect timeout ${host}:${port}`))
    })
    socket.once('error', reject)
  })
}

// Tunnel through an HTTP proxy upstream via CONNECT. Used by the chained
// upstream feature so admin can stack ProxyBox on top of a residential pool.
function connectViaUpstream(upstreamUrl, host, port, proxy) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(upstreamUrl) } catch (e) { return reject(new Error(`bad upstreamUrl: ${e.message}`)) }
    const proto = u.protocol
    if (proto !== 'http:' && proto !== 'https:') return reject(new Error(`upstream must be http(s); got ${proto}`))
    const upPort = Number(u.port) || (proto === 'https:' ? 443 : 80)
    const sock = (proto === 'https:' ? tls.connect : net.connect)({ host: u.hostname, port: upPort, servername: u.hostname, rejectUnauthorized: false })
    sock.setNoDelay(true)
    let settled = false
    const done = (err, s) => { if (settled) return; settled = true; err ? reject(err) : resolve(s) }
    sock.once('error', (e) => done(e))
    sock.on('connect', () => sock.setTimeout(30_000))
    sock.once('secureConnect', () => sock.setTimeout(30_000))
    sock.once('timeout', () => { sock.destroy(); done(new Error('upstream timeout')) })
    const onReady = () => {
      const lines = [`CONNECT ${host}:${port} HTTP/1.1`, `Host: ${host}:${port}`]
      if (u.username) {
        const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`).toString('base64')
        lines.push(`Proxy-Authorization: Basic ${auth}`)
      }
      lines.push('Connection: keep-alive', '', '')
      sock.write(lines.join('\r\n'))
      let buf = Buffer.alloc(0)
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk])
        const idx = buf.indexOf('\r\n\r\n')
        if (idx === -1) { if (buf.length > 32_768) { sock.destroy(); done(new Error('upstream headers too large')) } return }
        const head = buf.slice(0, idx).toString('utf8')
        sock.off('data', onData)
        if (!/^HTTP\/1\.\d 200/i.test(head)) { sock.destroy(); return done(new Error(`upstream refused: ${head.split('\r\n')[0]}`)) }
        // any extra bytes after headers must be replayed to the consumer
        const rest = buf.slice(idx + 4)
        if (rest.length) sock.unshift(rest)
        done(null, sock)
      }
      sock.on('data', onData)
    }
    if (proto === 'https:') sock.once('secureConnect', onReady); else sock.once('connect', onReady)
    void proxy
  })
}

// â”€â”€ SLA tracking: rolling 30d uptime per proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Backed by SQLite when available so it survives restarts.
if (sqliteDb) {
  try { sqliteDb.exec(`CREATE TABLE IF NOT EXISTS sla_tick (proxy_id TEXT NOT NULL, ts TEXT NOT NULL, ok INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS sla_proxy_ts ON sla_tick(proxy_id, ts DESC)`) } catch {}
}
const slaInsert = sqliteDb ? sqliteDb.prepare('INSERT INTO sla_tick (proxy_id, ts, ok) VALUES (?, ?, ?)') : null
function updateSlaTick(proxyId, ok) {
  if (!slaInsert) return
  try { slaInsert.run(proxyId, new Date().toISOString(), ok ? 1 : 0) } catch {}
}
function slaPercent(proxyId, days = 30) {
  if (!sqliteDb) return null
  try {
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    const r = sqliteDb.prepare('SELECT AVG(ok)*100 AS pct, COUNT(*) AS n FROM sla_tick WHERE proxy_id = ? AND ts >= ?').get(proxyId, since)
    return r && r.n > 0 ? { pct: Number(r.pct.toFixed(2)), samples: r.n } : { pct: 100, samples: 0 }
  } catch { return null }
}

// â”€â”€ Continuous health sweep â€” probe each active proxy through its own listener
// every 5 minutes. Mirrors what real managed proxy services run server-side.
// Probe every active proxy, then heal in a controlled second pass.
// Auto-fix ladder (with safety guards):
//   T1: v6 dead egress → mint a fresh /128 from the node's prefix (remote agents
//       pick up the new bindIp via the long-poll rev bump, so no listener
//       restart is needed). Triggers at 3 consecutive fails.
//   T2: dead past the rotate threshold (6 fails, with an order, not already
//       replaced) → autoReplaceProxy() provisions a fresh proxy attached to
//       the same order. Works for both local and remote.
// Safety guards (so a flaky node doesn't burn the v6 pool):
//   - Node-health gate: if ≥50% of a node's probes failed this sweep (≥10
//     probes), the issue is node-wide (not per-IP) — suppress auto-fix on
//     that node, alert admin instead.
//   - Per-proxy cooldown: don't auto-fix the same proxy again within an hour
//     (gives the new IP / replacement time to prove itself).
//   - Per-sweep cap: at most N auto-fixes per cycle (protects the pool when
//     many fail at once).
//   - Feature flag: config.features.autoHeal !== false.
async function runHealthSweep() {
  const offlineNodeIds = new Set(config.nodes.filter(n => !nodeIsOnline(n)).map(n => n.id))
  // 1) Probe in parallel.
  const probes = []
  for (const proxy of config.proxies) {
    if (proxy.status === 'expired' || proxy.status === 'failover-pending' || proxy.status === 'replaced') continue
    if (!proxy.bindIp || !proxy.port) continue
    if (proxy.nodeId && proxy.nodeId !== 'local' && offlineNodeIds.has(proxy.nodeId)) continue
    probes.push(
      remoteCheckProxy(proxy)
        .then((r) => ({ proxy, r }))
        .catch((e) => ({ proxy, r: { ok: false, error: e?.message || 'probe-err' } }))
    )
  }
  const results = await Promise.all(probes)
  if (!results.length) return

  // 2) Per-node fail rate → suppress auto-fix on nodes that look node-wide broken.
  const perNode = new Map()
  for (const { proxy, r } of results) {
    const nid = proxy.nodeId || 'local'
    const e = perNode.get(nid) || { total: 0, failed: 0 }
    e.total += 1; if (!r.ok) e.failed += 1
    perNode.set(nid, e)
  }
  const suspectNodes = new Set()
  const suspectPct = Number(config.healthCheck?.nodeSuspectPct) || 50
  for (const [nid, e] of perNode) {
    if (e.total >= 10 && (e.failed * 100 / e.total) >= suspectPct) {
      suspectNodes.add(nid)
      pushAlert(`node:${nid}:suspect`, `Node ${nid}: ${e.failed}/${e.total} probes failed this sweep — auto-heal suppressed (looks node-wide).`, 'warn')
      logError({ source: 'watchdog', level: 'warn', code: 'node:suspect', message: `${e.failed}/${e.total} probes failed`, nodeId: nid, context: { failed: e.failed, total: e.total, failPct: Math.round(e.failed * 1000 / e.total) / 10 } })
    }
  }

  // 3) Apply remediation with guards.
  const autoHealOn = config.features?.autoHeal !== false
  let budget = Number(config.healthCheck?.maxAutoFixPerSweep) || 30
  const cooldownMs = Number(config.healthCheck?.autoFixCooldownMs) || 60 * 60 * 1000
  const nowMs = Date.now()
  let fixed = 0, replaced = 0

  for (const { proxy, r } of results) {
    proxy.lastCheckedAt = new Date().toISOString()
    proxy.lastCheckOk = r.ok
    if (r.ok) {
      proxy.checkFailCount = 0
      proxy.totalFails = 0
      if (proxy.status === 'error') proxy.status = 'active'
      updateSlaTick(proxy.id, true)
      if (Number.isFinite(r.latencyMs)) proxy.latency = r.latencyMs
      continue
    }
    proxy.checkFailCount = (Number(proxy.checkFailCount) || 0) + 1
    proxy.totalFails = (Number(proxy.totalFails) || 0) + 1
    updateSlaTick(proxy.id, false)
    if (proxy.checkFailCount === 3) {
      dispatchWebhook(proxy.ownerId, 'proxy.checkFailed', { proxyId: proxy.id, bindIp: proxy.bindIp, port: proxy.port, consecutiveFails: proxy.checkFailCount })
    }

    const nid = proxy.nodeId || 'local'
    const cooldownActive = proxy.lastAutoFixAt && (nowMs - new Date(proxy.lastAutoFixAt).getTime() < cooldownMs)
    const canAct = autoHealOn && !suspectNodes.has(nid) && !cooldownActive && budget > 0

    // T1: rotate v6 egress.
    if (canAct && proxy.checkFailCount >= 3 && proxy.type === 'IPv6') {
      try {
        const next = pickBindIp(proxy.type, proxy.nodeId)
        if (next && next !== proxy.bindIp) {
          const old = proxy.bindIp
          proxy.bindIp = next
          proxy.lastAutoFixAt = new Date().toISOString()
          proxy.autoFixCount = (Number(proxy.autoFixCount) || 0) + 1
          proxy.lastAutoFixAction = 'rotate'
          if (nid === 'local') { stopProxy(proxy.id); await startProxy(proxy) }
          // Remote: agent picks up the new bindIp on its next /api/agent/proxies long-poll (saveConfig bumps rev).
          proxy.checkFailCount = 0
          proxy.status = 'active'
          budget -= 1; fixed += 1
          audit({ actor: 'auto-heal', method: 'AUTO', path: `/proxy/${proxy.id}/rotate`, note: `${old} -> ${next} (after ${proxy.totalFails} fails)` })
          pushAlert(`proxy:${proxy.id}:auto-rotate`, `Auto-rotated ${proxy.id} (${nid}): ${old} -> ${next}`, 'warn')
          continue
        }
      } catch (e) {
        audit({ actor: 'auto-heal', method: 'AUTO', path: `/proxy/${proxy.id}/rotate-fail`, note: e?.message || String(e) })
        logError({ source: 'auto-heal', level: 'error', code: 'rotate-fail', message: e?.message || String(e), proxyId: proxy.id, nodeId: nid })
      }
    }

    // T2: replace (covers v4, and v6 where rotation didn't stick).
    if (canAct && (Number(proxy.totalFails) || 0) >= 6 && proxy.orderId && !proxy.replacedBy && config.features?.autoReplace !== false) {
      try {
        await autoReplaceProxy(proxy)
        proxy.lastAutoFixAt = new Date().toISOString()
        proxy.autoFixCount = (Number(proxy.autoFixCount) || 0) + 1
        proxy.lastAutoFixAction = 'replace'
        budget -= 1; replaced += 1
        audit({ actor: 'auto-heal', method: 'AUTO', path: `/proxy/${proxy.id}/replace`, note: `replaced after ${proxy.totalFails} fails -> ${proxy.replacedBy}` })
        continue
      } catch (e) {
        audit({ actor: 'auto-heal', method: 'AUTO', path: `/proxy/${proxy.id}/replace-fail`, note: e?.message || String(e) })
        logError({ source: 'auto-heal', level: 'error', code: 'replace-fail', message: e?.message || String(e), proxyId: proxy.id, nodeId: nid })
      }
    }

    // No remediation — keep visible: only mark local proxies 'error' (agent owns remote status).
    if (nid === 'local' && proxy.checkFailCount >= 3) proxy.status = 'error'
  }

  if (fixed || replaced) {
    console.log(`[auto-heal] sweep: rotated=${fixed} replaced=${replaced} suspectNodes=${[...suspectNodes].join(',') || '-'} budgetLeft=${budget}`)
  }
  saveConfig().catch(() => {})

  // ── TLS-side companion probe ───────────────────────────────────────────
  // Catches TLS-specific bugs invisible to the plain CONNECT check (e.g. the
  // bind-race that was fixed in 1.4.16). Two guards keep this signal honest:
  //   (a) Concurrency limit: firing 2000+ TLS handshakes simultaneously at
  //       one node trips the provider's per-source connection-burst limit,
  //       and a contiguous block of probes comes back ECONNREFUSED. That's
  //       a path-level false positive, not a real per-proxy failure. Cap at
  //       N in flight so the burst stays under the edge threshold.
  //   (b) Two-strike rule: a single failure increments proxy.tlsFailCount
  //       but is NOT logged — only the second consecutive failure crosses
  //       the threshold. A pass resets the counter. Mirrors the plain
  //       check's 3-fail rotation gate.
  const tlsCandidates = results.filter(({ proxy, r }) =>
    r.ok && Number(proxy.tlsPort) > 0 && !suspectNodes.has(proxy.nodeId || 'local')
  )
  if (tlsCandidates.length) {
    ;(async () => {
      const TLS_CONCURRENCY = Number(config.healthCheck?.tlsProbeConcurrency) || 40
      let i = 0, downReports = 0
      async function worker() {
        while (i < tlsCandidates.length) {
          const { proxy } = tlsCandidates[i++]
          const tr = await tlsHandshakeProbe(proxy)
          if (tr.ok) {
            if (proxy.tlsFailCount) proxy.tlsFailCount = 0
          } else {
            proxy.tlsFailCount = (Number(proxy.tlsFailCount) || 0) + 1
            // Only surface as an error after two consecutive failures, so
            // the noisy provider-edge bursts we can't control don't pollute
            // the log with hundreds of one-off ECONNREFUSEDs.
            if (proxy.tlsFailCount >= 2) {
              downReports += 1
              logError({ source: 'sweep', level: 'warn', code: 'proxy:tls-down', message: `TLS handshake fail on tlsPort ${proxy.tlsPort}: ${tr.error}`, proxyId: proxy.id, nodeId: proxy.nodeId, context: { tlsPort: proxy.tlsPort, host: customerFacingHost(proxy) || proxy.listenHost, error: tr.error, latencyMs: tr.latencyMs, consecutive: proxy.tlsFailCount } })
            }
          }
        }
      }
      await Promise.all(Array.from({ length: TLS_CONCURRENCY }, worker))
      if (downReports) console.log(`[tls-probe] ${downReports} proxies failed TLS handshake (>=2 consecutive) this sweep`)
    })().catch(() => { /* noop — purely observability */ })
  }
}

// Quick TLS handshake against a proxy's tlsPort. Doesn't validate the cert
// (it's a self-signed Trojan cert by design) — just verifies the listener
// is bound + the agent can complete a TLS handshake. 4s timeout per probe.
async function tlsHandshakeProbe(proxy) {
  const host = customerFacingHost(proxy) || proxy.listenHost
  const port = Number(proxy.tlsPort)
  if (!host || !port) return { ok: true, skipped: true }
  return new Promise((res) => {
    const t0 = Date.now()
    let settled = false
    const fin = (o) => { if (settled) return; settled = true; try { s.destroy() } catch {}; res({ ...o, latencyMs: Date.now() - t0 }) }
    const s = tls.connect({ host, port, rejectUnauthorized: false, timeout: 4000, servername: host })
    s.on('secureConnect', () => fin({ ok: true }))
    s.on('error', (e) => fin({ ok: false, error: e.message }))
    s.on('timeout', () => fin({ ok: false, error: 'timeout' }))
  })
}

// Provision a fresh replacement for a persistently-dead pool proxy, attach it to
// the same order (inheriting the remaining lifetime), and notify the owner. The
// old proxy is marked 'replaced'. Local (managed) proxies only.
async function autoReplaceProxy(proxy) {
  const repl = createProxy({ type: proxy.type, rotate: !!proxy.rotate, nodeId: proxy.nodeId || 'local', durationDays: 1, name: `${proxy.name || proxy.type} (replacement)` })
  repl.ownerId = proxy.ownerId
  repl.orderId = proxy.orderId
  repl.zone = proxy.zone || ''
  repl.autoRenew = !!proxy.autoRenew
  repl.expires = proxy.expires
  repl.expiresAt = proxy.expiresAt            // inherit remaining lifetime — free swap
  config.proxies.push(repl)
  ensureStats(repl.id)
  if ((repl.nodeId || 'local') === 'local') await startProxy(repl)
  const order = orders.find((o) => o.id === proxy.orderId)
  if (order && Array.isArray(order.proxyIds)) order.proxyIds.push(repl.id)
  proxy.status = 'replaced'
  proxy.replacedBy = repl.id
  if ((proxy.nodeId || 'local') === 'local') stopProxy(proxy.id)
  pushAlert(`proxy:${proxy.id}:replaced`, `Auto-replaced dead proxy ${proxy.id} → ${repl.id}`, 'warn')
  pushNotification(proxy.ownerId, { type: 'proxy', severity: 'warn', text: `Proxy ${proxy.id} lỗi kéo dài — đã tự thay bằng ${repl.id} (cùng loại/zone, giữ nguyên hạn).`, link: '/proxies' })
  dispatchWebhook(proxy.ownerId, 'proxy.replaced', { proxyId: proxy.id, replacedBy: repl.id })
}

// Health-check a proxy by performing an outbound HTTPS request through its own
// egress path (same bindIp / family / rotation logic) to an IP-echo endpoint.
// Defaults overridable via admin Health-check tab.
function checkHostV4() { return config.healthCheck?.checkHost    || 'api.ipify.org' }
function checkHostV6() { return config.healthCheck?.checkHostV6  || 'api64.ipify.org' }
function checkTimeoutMs() { return Number(config.healthCheck?.checkTimeoutMs || 12000) }
function speedtestHost() { return config.healthCheck?.speedtestHost || 'httpbin.org' }
function speedtestBytes() { return Number(config.healthCheck?.speedtestBytes || 1048576) }
const CHECK_HOST = 'api64.ipify.org'

// Probe a remote-node proxy from the control plane: connect to the agent's
// public listener via HTTP CONNECT and verify it returns 200. Cheap, no extra
// agent-side endpoint needed.
// Throughput + latency test through a customer's own proxy. Dials the proxy's
// own listener, issues an HTTP GET via the proxy to a sample-bytes endpoint,
// and measures: time-to-first-byte (latency proxy resolves + connects upstream)
// and total throughput. Bounded by SAMPLE_BYTES + 30s timeout so the test
// never bogs down the API.
const SPEEDTEST_HOST = 'httpbin.org'
const SPEEDTEST_PORT = 80
const SPEEDTEST_BYTES = 1_048_576 // 1 MB
async function runSpeedTest(proxy) {
  return new Promise((resolve) => {
    const host = proxy.bindIp || proxy.listenHost
    const port = Number(proxy.port)
    if (!host || !port) { resolve({ ok: false, error: 'proxy has no listen address' }); return }
    const family = net.isIPv6(host) ? 6 : 4
    const started = Date.now()
    const sock = net.connect({ host, port, family })
    let done = false
    let headerSeen = false
    let buf = Buffer.alloc(0)
    let bytesReceived = 0
    let firstByteAt = null
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch {} resolve(r) }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout', ms: Date.now() - started, bytes: bytesReceived }), 30_000)
    sock.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message, ms: Date.now() - started }) })
    sock.on('connect', () => {
      const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
      sock.write(`GET http://${SPEEDTEST_HOST}/bytes/${SPEEDTEST_BYTES} HTTP/1.1\r\nHost: ${SPEEDTEST_HOST}\r\nProxy-Authorization: Basic ${auth}\r\nUser-Agent: ProxyBox-SpeedTest\r\nAccept: */*\r\nConnection: close\r\n\r\n`)
    })
    sock.on('data', (chunk) => {
      if (firstByteAt === null) firstByteAt = Date.now()
      if (!headerSeen) {
        buf = Buffer.concat([buf, chunk])
        const idx = buf.indexOf('\r\n\r\n')
        if (idx !== -1) {
          headerSeen = true
          const head = buf.slice(0, idx).toString('utf8')
          if (!/^HTTP\/1\.\d 200/i.test(head)) {
            const line = head.split('\r\n')[0]
            return finish({ ok: false, error: `upstream ${line}`, ms: Date.now() - started })
          }
          const after = buf.length - idx - 4
          if (after > 0) bytesReceived += after
          buf = Buffer.alloc(0)
        }
      } else {
        bytesReceived += chunk.length
      }
    })
    sock.on('end', () => {
      clearTimeout(timer)
      const ms = Date.now() - started
      const ttfbMs = firstByteAt ? firstByteAt - started : null
      const bytesPerSec = ms > 0 ? Math.round((bytesReceived * 1000) / ms) : 0
      const mbps = Math.round(bytesPerSec * 8 / 100_000) / 10
      finish({ ok: bytesReceived > 0, bytes: bytesReceived, ms, ttfbMs, bytesPerSec, mbps, target: `${SPEEDTEST_HOST}/bytes/${SPEEDTEST_BYTES}` })
    })
  })
}

async function remoteCheckProxy(proxy) {
  const started = Date.now()
  return new Promise((resolve) => {
    // Customer-facing host: v4 of the serving node even for IPv6 proxies (the
    // bindIp is the v6 egress, only reachable from the agent itself — not
    // routable from the control plane).
    const host = customerFacingHost(proxy) || proxy.listenHost
    const port = Number(proxy.port)
    if (!host || !port) { resolve({ ok: false, latencyMs: null, error: 'proxy has no listen address' }); return }
    const sock = net.connect({ host, port, family: net.isIPv6(host) ? 6 : 4 })
    let done = false
    let buf = Buffer.alloc(0)
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch {} resolve(r) }
    const timer = setTimeout(() => finish({ ok: false, latencyMs: Date.now() - started, error: 'timeout' }), 10_000)
    sock.on('error', (e) => { clearTimeout(timer); finish({ ok: false, latencyMs: Date.now() - started, error: e.message }) })
    sock.on('connect', () => {
      const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
      sock.write(`CONNECT ${CHECK_HOST}:443 HTTP/1.1\r\nHost: ${CHECK_HOST}:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`)
    })
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1 && buf.length < 4096) return
      clearTimeout(timer)
      const head = buf.slice(0, idx === -1 ? buf.length : idx).toString('utf8')
      const ok = /^HTTP\/1\.\d 200/i.test(head)
      finish({ ok, latencyMs: Date.now() - started, error: ok ? null : head.split('\r\n')[0] })
    })
  })
}

async function checkProxy(proxy) {
  const started = Date.now()
  let socket
  try {
    socket = await connectUpstream(proxy, CHECK_HOST, 443)
  } catch (error) {
    return { ok: false, latencyMs: null, error: error.message }
  }
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0)
    let done = false
    const finish = (result) => { if (done) return; done = true; try { socket.destroy() } catch { /* noop */ } resolve(result) }
    const timer = setTimeout(() => finish({ ok: false, latencyMs: Date.now() - started, error: 'timeout' }), 12_000)
    const secured = tls.connect({ socket, servername: CHECK_HOST, rejectUnauthorized: false }, () => {
      secured.write(`GET / HTTP/1.1\r\nHost: ${CHECK_HOST}\r\nUser-Agent: ProxyBox-Check\r\nConnection: close\r\n\r\n`)
    })
    secured.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]) })
    secured.on('error', (error) => { clearTimeout(timer); finish({ ok: false, latencyMs: Date.now() - started, error: error.message }) })
    const onEnd = () => {
      clearTimeout(timer)
      const latencyMs = Date.now() - started
      const text = buf.toString('utf8')
      const statusOk = /^HTTP\/1\.[01] 200/.test(text)
      const idx = text.indexOf('\r\n\r\n')
      const body = (idx === -1 ? text : text.slice(idx + 4)).trim().split(/\s/)[0]
      const exitIp = net.isIP(body) ? body : null
      finish({ ok: statusOk && Boolean(exitIp), latencyMs, exitIp, error: statusOk ? (exitIp ? null : 'no IP in response') : 'unexpected response' })
    }
    secured.on('end', onEnd)
    secured.on('close', () => { if (!done) onEnd() })
  })
}

function relay(proxy, client, upstream, initialToUpstream, connInfo) {
  const meter = ensureStats(proxy.id)
  upstream.setNoDelay(true)

  // Account once, when both ends are closed, using the sockets' cumulative
  // bytesRead counters â€” keeps the hot relay path off the JS thread.
  let clientClosed = false
  let upstreamClosed = false
  let accounted = false
  const startTs = Date.now()
  const settle = () => {
    if (accounted || !clientClosed || !upstreamClosed) return
    accounted = true
    const up = client.bytesRead || 0
    const down = upstream.bytesRead || 0
    addTraffic(meter, up, down)
    if (connInfo && connInfo.host) {
      recordConnection(meter, {
        src: connInfo.src,
        srcPort: connInfo.srcPort,
        host: connInfo.host,
        port: connInfo.port,
        kind: connInfo.kind,
        up,
        down,
        ms: Date.now() - startTs
      }, proxy.id, proxy.ownerId)
    }
  }
  upstream.on('error', () => client.destroy())
  client.on('error', () => upstream.destroy())
  client.on('close', () => { clientClosed = true; upstream.destroy(); settle() })
  upstream.on('close', () => { upstreamClosed = true; client.destroy(); settle() })

  // Optional coarse per-second bandwidth cap. If proxy.orderId is set and the
  // parent order has its own bytesPerSec, the bucket is shared across every
  // member proxy of that order (per-group cap, not per-proxy).
  let rate = limitFor(proxy, 'bytesPerSec', 'bytesPerSec')
  let bucket = meter
  if (proxy.orderId) {
    const order = orders.find((o) => o.id === proxy.orderId)
    const orderRate = order && Number(order.bytesPerSec || 0)
    if (orderRate > 0) {
      rate = orderRate
      let b = orderBuckets.get(proxy.orderId)
      if (!b) { b = { secKey: 0, secBytes: 0 }; orderBuckets.set(proxy.orderId, b) }
      bucket = b
    }
  }
  if (rate > 0) {
    const onChunk = (len) => {
      const sec = Math.floor(Date.now() / 1000)
      if (bucket.secKey !== sec) { bucket.secKey = sec; bucket.secBytes = 0 }
      bucket.secBytes += len
      if (bucket.secBytes > rate && !client.isPaused()) {
        client.pause(); upstream.pause()
        const wait = Math.max(1, (sec + 1) * 1000 - Date.now())
        setTimeout(() => {
          if (!client.destroyed) client.resume()
          if (!upstream.destroyed) upstream.resume()
        }, wait)
      }
    }
    client.on('data', (chunk) => onChunk(chunk.length))
    upstream.on('data', (chunk) => onChunk(chunk.length))
  }

  if (initialToUpstream?.length) upstream.write(initialToUpstream)
  client.pipe(upstream)
  upstream.pipe(client)
}

// ---------------------------------------------------------------------------
// Auth (management API key + user login sessions)
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

function verifyPassword(password, stored) {
  if (!stored) return false
  if (stored.startsWith('scrypt$')) {
    const [, salt, derivedHex] = stored.split('$')
    const derived = Buffer.from(derivedHex, 'hex')
    const calc = crypto.scryptSync(String(password), salt, 64)
    return derived.length === calc.length && crypto.timingSafeEqual(derived, calc)
  }
  return timingEqual(stored, password)
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { userId: user.id, email: user.email, name: user.name, expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

function sessionFromRequest(req) {
  const header = req.headers['authorization'] || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= Date.now()) { sessions.delete(token); return null }
    return { token, ...session }
  }
  // X-Customer-Key: customer-specific API key (separate from the master admin apiKey).
  // Maps to the user that owns it; treated as a session for /api/v1/user/* purposes.
  const ck = req.headers['x-customer-key']
  if (ck) {
    const user = config.users.find((u) => u.apiKey && timingEqual(u.apiKey, String(ck)))
    if (user) return { token: '__customer_key__', userId: user.id, email: user.email, name: user.name, expiresAt: Date.now() + 60_000 }
  }
  return null
}

function cleanupSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

function isApiAuthorized(req) {
  const apiKey = req.headers['x-api-key']
  if (apiKey && timingEqual(apiKey, config.api.apiKey)) return true
  return Boolean(sessionFromRequest(req))
}

// Admin-only gate. Used by /api/v1/user/* introspection + reserved for future
// hardening of destructive admin endpoints. For now, returns true for:
//   - X-API-Key match (the master key)
//   - bearer session whose user has role !== 'customer' (existing users default to admin)
// ── IP whitelist helpers (CIDR-aware) ─────────────────────────────────────
// Accepts plain IP literals OR `IP/N` CIDR. Used by proxy.allowedSrcIps so a
// customer on a /24 office network can whitelist `203.0.113.0/24` once.
function parseCidrEntry(entry) {
  const s = String(entry || '').trim()
  if (!s) return null
  const slash = s.indexOf('/')
  if (slash < 0) {
    const f = net.isIP(s)
    return f ? { type: 'ip', family: f, value: s } : null
  }
  const ip = s.slice(0, slash)
  const prefix = Number(s.slice(slash + 1))
  const family = net.isIP(ip)
  if (!family) return null
  if (family === 4 && !(prefix >= 0 && prefix <= 32))  return null
  if (family === 6 && !(prefix >= 0 && prefix <= 128)) return null
  return { type: 'cidr', family, value: ip, prefix }
}
function _ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc * 256 + Number(oct)) >>> 0, 0)
}
function _ipv6ToBigInt(ip) {
  const parts = ip.split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts[1] !== undefined ? (parts[1] ? parts[1].split(':') : []) : []
  const missing = 8 - left.length - right.length
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  let n = 0n
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16) || 0)
  return n
}
function ipMatchesEntry(srcIp, entry) {
  const parsed = parseCidrEntry(entry)
  if (!parsed) return false
  const srcFamily = net.isIP(srcIp)
  if (!srcFamily || srcFamily !== parsed.family) return false
  if (parsed.type === 'ip') return srcIp === parsed.value
  if (parsed.family === 4) {
    const mask = parsed.prefix === 0 ? 0 : (0xFFFFFFFF << (32 - parsed.prefix)) >>> 0
    return (_ipv4ToInt(srcIp) & mask) === (_ipv4ToInt(parsed.value) & mask)
  }
  const mask = parsed.prefix === 0 ? 0n : (((1n << BigInt(parsed.prefix)) - 1n) << BigInt(128 - parsed.prefix))
  return (_ipv6ToBigInt(srcIp) & mask) === (_ipv6ToBigInt(parsed.value) & mask)
}
function srcIpAllowedByWhitelist(proxy, srcIp) {
  const list = Array.isArray(proxy.allowedSrcIps) ? proxy.allowedSrcIps : []
  if (!list.length || proxy.status === 'expired') return false
  return list.some((entry) => ipMatchesEntry(srcIp, entry))
}

// OSS download counter. Best-effort SQLite insert — never blocks the response
// path; failures are swallowed so a broken DB never breaks a public asset.
// Truncates UA/referer to keep the table tidy.
function recordDownload(kind, req) {
  if (!sqliteDb) return
  try {
    const ip = clientIp(req)
    const ua = String(req.headers['user-agent'] || '').slice(0, 240)
    const ref = String(req.headers['referer'] || req.headers['referrer'] || '').slice(0, 240)
    sqliteDb.prepare('INSERT INTO oss_downloads (ts, kind, ip, ua, referer) VALUES (?,?,?,?,?)')
      .run(Date.now(), String(kind).slice(0, 32), ip || '', ua, ref)
  } catch { /* DB unavailable — skip */ }
}

function clientIp(req) {
  const direct = (req.socket && (req.socket.remoteAddress || '')).replace(/^::ffff:/, '') || 'unknown'
  // Trust X-Forwarded-For only when the immediate peer is a local reverse proxy
  // (nginx on the same host). Prevents spoofing from arbitrary internet clients.
  if (direct === '127.0.0.1' || direct === '::1') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    if (xff && net.isIP(xff)) return xff
  }
  return direct
}
function actorOf(req) {
  if (req.headers['x-api-key']) return 'apiKey'
  const s = sessionFromRequest(req)
  return s ? `${s.email || s.userId}` : 'anon'
}

// â”€â”€ Feature flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// config.features = { oauth: true, affiliate: true, totp: true, billing: true,
//                     customerWebhook: true, autoRenew: true, ipWhitelist: true,
//                     stickySession: true }
// Endpoints + UI sections check isFeatureEnabled() before serving. Admin can
// toggle at runtime via /api/admin/features without restart.
const FEATURE_DEFAULTS = {
  oauth: true, affiliate: true, totp: true, billing: true,
  customerWebhook: true, autoRenew: true, ipWhitelist: true, stickySession: true,
  registration: true,    // disable to lock signups during incidents
  maintenance: false     // when ON: customer endpoints return 503, admin still works
}
function isFeatureEnabled(name) {
  const f = config.features || {}
  // default = true if not explicitly set to false
  if (Object.prototype.hasOwnProperty.call(f, name)) return Boolean(f[name])
  return FEATURE_DEFAULTS[name] !== false
}

// OAuth: find user by email or create a new customer; link the provider id.
async function createOrLinkUser({ email, name, oauthProvider, oauthSub, ip }) {
  const lower = String(email).toLowerCase()
  let user = config.users.find((u) => String(u.email || '').toLowerCase() === lower)
  if (!user) {
    const uid = `u-${Date.now().toString(36)}`
    user = {
      id: uid,
      name: name || lower,
      email: lower,
      passwordHash: '',  // empty â€” must login via OAuth only until they set one
      role: 'customer',
      apiKey: generateUserToken(uid),   // unified: same value works as fleet enroll token
      referralCode: crypto.randomBytes(4).toString('hex'),
      referredBy: null,
      tosAcceptedAt: new Date().toISOString(),
      webhookUrl: '',
      totp: null,
      oauth: {}
    }
    user.oauth[oauthProvider] = { sub: oauthSub, linkedAt: new Date().toISOString() }
    config.users.push(user)
    // Nullish-coalesce so explicit 0 disables the trial — `0 || N` would not.
    const trial = Number(config.billing?.trialCredits ?? 50000)
    if (trial > 0) recordBillingTx(user.id, 'trial', trial, `signup via ${oauthProvider}`)
    audit({ actor: lower, ip, method: 'POST', path: '/api/auth/oauth/' + oauthProvider, note: 'new user via oauth' })
  } else {
    user.oauth = user.oauth || {}
    if (!user.oauth[oauthProvider]) {
      user.oauth[oauthProvider] = { sub: oauthSub, linkedAt: new Date().toISOString() }
      audit({ actor: lower, ip, method: 'POST', path: '/api/auth/oauth/' + oauthProvider, note: 'linked provider' })
    }
  }
  await saveConfig()
  return user
}

const oauthRoutes = setupOauthRoutes({
  getConfig: () => config,
  createOrLinkUser,
  createSession,
  audit,
  clientIp,
  isFeatureEnabled
})

function isAdminRequest(req) {
  // optional IP whitelist (when set, only requests from listed IPs can be admin
  // regardless of how good their credentials are). Empty list = disabled.
  const whitelist = Array.isArray(config.api.adminIpWhitelist) ? config.api.adminIpWhitelist : []
  if (whitelist.length > 0) {
    const ip = clientIp(req)
    if (!whitelist.includes(ip)) return false
  }
  const apiKey = req.headers['x-api-key']
  if (apiKey && timingEqual(apiKey, config.api.apiKey)) return true
  const session = sessionFromRequest(req)
  if (!session) return false
  const user = config.users.find((u) => u.id === session.userId)
  if (!user) return false
  return (user.role || 'admin') !== 'customer'
}

// ---------------------------------------------------------------------------
// HTTP API + static dashboard
// ---------------------------------------------------------------------------

async function handleHttp(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') return sendJson(res, 204, null)
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res, url)
  // Public landing: `curl https://proxybox.pro/install-panel.sh | sudo bash` —
  // serve the canonical Hubfree installer so end-users can stand up their
  // own panel without finding a GitHub release. Source: /home/proxyhub/proxybox-free/
  // mirrored to the running master. Falls through to static SPA if missing.
  if (url.pathname === '/install-panel.sh' && req.method === 'GET') {
    try {
      const sh = await fs.readFile('/home/proxyhub/proxybox-free/install.sh')
      recordDownload('install-panel', req)
      res.writeHead(200, {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="install.sh"'
      })
      return res.end(sh)
    } catch { /* fall through to 404 via serveStatic */ }
  }
  return serveStatic(req, res, url)
}

// mTLS listener: only serves /api/agent/* and identifies the node by its client cert.
async function handleMtls(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`)
    if (!url.pathname.startsWith('/api/agent/')) return sendJson(res, 404, { error: 'not found' })
    const node = nodeFromClientCert(req.socket)
    if (!node) return sendJson(res, 401, { error: 'client certificate required' })
    return handleAgentRequest(req, res, url, node)
  } catch (error) {
    console.error(`[mtls] ${error.stack || error.message}`)
    return sendJson(res, 500, { error: error.message })
  }
}

async function handleAgentRequest(req, res, url, node) {
  if (req.method === 'POST' && url.pathname === '/api/agent/register') {
    const body = await readJson(req, 16 * 1024 * 1024)
    node.status = 'online'; node.lastSeenAt = new Date().toISOString()
    if (body.version) node.version = String(body.version)
    if (body.network) node.network = body.network
    await saveConfig()
    return sendJson(res, 200, { ok: true })
  }
  // Agent self-reports an error/warn to the panel — wired into our shared
  // errors table so admin can triage all node + panel errors in one view.
  // Token-auth (node already validated upstream of this handler). Per-node
  // basic rate limit so a runaway agent can't fill the table.
  if (req.method === 'POST' && url.pathname === '/api/agent/error') {
    const body = await readJson(req, 64 * 1024)
    const last = agentErrorRate.get(node.id) || { ts: 0, n: 0 }
    const now = Date.now()
    if (now - last.ts > 60_000) { last.ts = now; last.n = 0 }
    if (last.n >= 60) return sendJson(res, 429, { error: 'rate limited' })
    last.n += 1; agentErrorRate.set(node.id, last)
    logError({
      source: 'agent',
      level: body.level === 'warn' || body.level === 'info' ? body.level : 'error',
      code: body.code ? String(body.code).slice(0, 80) : null,
      message: body.message ? String(body.message).slice(0, 1000) : null,
      context: body.context || null,
      nodeId: node.id,
      proxyId: body.proxyId || null
    })
    return sendJson(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/heartbeat') {
    const body = await readJson(req, 16 * 1024 * 1024)
    node.lastSeenAt = new Date().toISOString(); node.status = 'online'
    if (body.version) node.version = String(body.version)
    if (body.network) {
      if (body.network.ipv6 && body.network.ipv6.length > 2000) body.network.ipv6 = body.network.ipv6.slice(0, 2000)
      node.network = body.network
    }
    if (body.metrics && typeof body.metrics === 'object') {
      node.metrics = {
        cpuPct: Number(body.metrics.cpuPct) || 0,
        ramTotal: Number(body.metrics.ramTotal) || 0,
        ramUsed: Number(body.metrics.ramUsed) || 0,
        ramPct: Number(body.metrics.ramPct) || 0,
        load1: Number(body.metrics.load1) || 0,
        load5: Number(body.metrics.load5) || 0,
        netRxBps: Number(body.metrics.netRxBps) || 0,
        netTxBps: Number(body.metrics.netTxBps) || 0,
        uptimeSec: Number(body.metrics.uptimeSec) || 0,
        ts: new Date().toISOString()
      }
    }
    if (body.reaper && typeof body.reaper === 'object') {
      const ms = Number(body.reaper.lastSweepMs) || 0
      node.reaper = {
        lastSweepAt: ms > 0 ? new Date(ms).toISOString() : new Date().toISOString(),
        lastReapedCount: Number(body.reaper.lastReapedCount) || 0,
        totalReaped: Number(body.reaper.totalReaped) || 0,
        activeCount: Number(body.reaper.activeCount) || 0
      }
    }
    if (body.stats && typeof body.stats === 'object') {
      for (const [id, s] of Object.entries(body.stats)) {
        const m = ensureStats(id)
        m.uploadBytes = Number(s.uploadBytes) || 0
        m.downloadBytes = Number(s.downloadBytes) || 0
        m.monthBytes = Number(s.monthBytes) || 0
        m.monthKey = new Date().toISOString().slice(0, 7)
        m.activeConnections = Number(s.activeConnections) || 0
        m.totalConnections = Number(s.totalConnections) || 0
        m.bpsIn = Number(s.bpsIn) || 0
        m.bpsOut = Number(s.bpsOut) || 0
        // Merge per-target aggregates pushed by agents — bounded merge, drop
        // unknown keys defensively. Agent already trims to TOP_TARGETS_MAX.
        if (s.topTargets && typeof s.topTargets === 'object') {
          for (const [host, v] of Object.entries(s.topTargets)) {
            const h = String(host).slice(0, 253).toLowerCase()
            const cur = m.topTargets.get(h) || { count: 0, bytesUp: 0, bytesDown: 0, lastTs: 0 }
            cur.count = Number(v.count) || cur.count
            cur.bytesUp = Number(v.bytesUp) || cur.bytesUp
            cur.bytesDown = Number(v.bytesDown) || cur.bytesDown
            cur.lastTs = Math.max(cur.lastTs, Number(v.lastTs) || 0)
            m.topTargets.set(h, cur)
          }
          if (m.topTargets.size > TOP_TARGETS_MAX) {
            const sorted = [...m.topTargets.entries()].sort((a, b) => a[1].lastTs - b[1].lastTs)
            for (const [k] of sorted.slice(0, m.topTargets.size - TOP_TARGETS_MAX)) m.topTargets.delete(k)
          }
        }
        // Merge recent-connection ring buffer from agent — append + trim.
        // Also persist each event to SQLite so the long history is queryable.
        if (Array.isArray(s.recentConns) && s.recentConns.length) {
          const proxy = config.proxies.find((p) => p.id === id)
          for (const c of s.recentConns) {
            if (!c || !c.host) continue
            const evt = {
              ts: Number(c.ts) || Date.now(),
              src: String(c.src || '').slice(0, 64),
              srcPort: Number(c.srcPort) || 0,
              host: String(c.host).slice(0, 253).toLowerCase(),
              port: Number(c.port) || 0,
              up: Number(c.up) || 0,
              down: Number(c.down) || 0,
              ms: Number(c.ms) || 0,
              kind: String(c.kind || '').slice(0, 16)
            }
            m.recentConns.push(evt)
            if (connEventInsertStmt && proxy) {
              try { connEventInsertStmt.run(evt.ts, id, proxy.ownerId || null, evt.src, evt.srcPort, evt.host, evt.port, evt.up, evt.down, evt.ms, evt.kind) } catch { /* noop */ }
            }
          }
          if (m.recentConns.length > RECENT_CONNS_MAX) {
            m.recentConns.splice(0, m.recentConns.length - RECENT_CONNS_MAX)
          }
        }
        recordHistorySample(id, m)
      }
    }
    // ── Agent-channel command queue ───────────────────────────────────────
    // Commands queued via POST /api/nodes/:id/action/* (when no SSH creds)
    // are delivered to the agent in its heartbeat response. The agent runs
    // each whitelisted command natively (no shell — see rust-core dispatch)
    // and reports results in the NEXT heartbeat via `body.commandResults`.
    // Each command lives at most COMMAND_TTL_MS (5 min) — agent that's
    // offline that long misses the command entirely; admin must re-issue.
    if (Array.isArray(body.commandResults) && body.commandResults.length) {
      node.commandHistory = node.commandHistory || []
      for (const r of body.commandResults) {
        if (!r || !r.id) continue
        // Dedup: if we already recorded this id, skip. The agent should send
        // each result exactly once but a re-tried HTTP request, a stuck
        // long-poll connection, or a re-sent mTLS frame could double-deliver
        // — be defensive at the master.
        if (node.commandHistory.find((h) => h.id === r.id)) continue
        node.commandHistory.unshift({
          id: String(r.id).slice(0, 64),
          action: String(r.action || '').slice(0, 40),
          code: Number(r.code) || 0,
          output: String(r.output || '').slice(0, 8000),
          completedAt: new Date().toISOString()
        })
        // Remove from pending queue if still there
        if (Array.isArray(node.pendingCommands)) {
          node.pendingCommands = node.pendingCommands.filter((c) => c.id !== r.id)
        }
      }
      node.commandHistory = node.commandHistory.slice(0, 50)
    }
    // Sweep stale pending commands (agent missed them).
    if (Array.isArray(node.pendingCommands)) {
      const cutoff = Date.now() - 5 * 60_000
      node.pendingCommands = node.pendingCommands.filter((c) =>
        new Date(c.queuedAt || 0).getTime() > cutoff
      )
    }

    // Tell the agent whether its version is current. The admin UI exposes
    // a one-liner via /api/admin/nodes/:id/upgrade-command — the agent itself
    // does NOT auto-update (avoid surprise restarts); admin runs the command.
    const update = {}
    if (LATEST_AGENT_VERSION && body.version && !agentVersionMatches(body.version, LATEST_AGENT_VERSION)) {
      if (!node.upgradeToken) {
        node.upgradeToken = crypto.randomBytes(24).toString('hex')
        await saveConfig()
      }
      update.updateAvailable = {
        current: body.version,
        latest: LATEST_AGENT_VERSION,
        upgradeUrl: `${controlBaseUrl()}/api/agent/upgrade-script/${node.upgradeToken}`,
        binaryUrl: `${controlBaseUrl()}/api/agent/binary-upgrade/${node.upgradeToken}`,
        oneLiner: `curl -fsSL ${controlBaseUrl()}/api/agent/upgrade-script/${node.upgradeToken} | sudo bash`
      }
    }
    if (Array.isArray(node.pendingCommands) && node.pendingCommands.length) {
      update.commands = node.pendingCommands
    }
    return sendJson(res, 200, { ok: true, version: APP_VERSION, ...update })
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/proxies') {
    // Disabled node â†' return empty list so agent reconciles every listener off.
    if (node.disabled) return sendAgentList(res, [])
    // Long-poll: if agent's known rev matches current, hold until config bumps
    // (proxy rotated, expired, added). Master-side push beats per-10s polling
    // — rotation propagates in <1s.
    const wantRev = Number(url.searchParams.get('rev') || 0)
    if (wantRev > 0 && wantRev === configRev) {
      let waiters = agentWaiters.get(node.id)
      if (!waiters) { waiters = new Set(); agentWaiters.set(node.id, waiters) }
      const entry = { res }
      entry.timeout = setTimeout(() => {
        waiters.delete(entry)
        sendAgentList(res, agentListFor(node))
      }, 25_000)
      waiters.add(entry)
      req.on('close', () => {
        try { clearTimeout(entry.timeout) } catch {}
        waiters.delete(entry)
      })
      return
    }
    return sendAgentList(res, agentListFor(node))
  }
  return sendJson(res, 404, { error: 'unknown agent endpoint' })
}

function isPublicEndpoint(req, url) {
  if (url.pathname === '/api/health') return true
  // Subscription endpoint: token-in-path auth (long random hex), no
  // session/cookie needed so customers paste the URL into Clash /
  // Shadowrocket / v2rayN and the app fetches without any login flow.
  if (req.method === 'GET' && /^\/api\/sub\/[a-f0-9]{16,}$/.test(url.pathname)) return true
  if (req.method === 'POST' && (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/register')) return true
  // OAuth: provider catalogue + start/callback must be reachable without auth.
  if (req.method === 'GET' && url.pathname === '/api/auth/oauth/providers') return true
  if (req.method === 'GET' && /^\/api\/auth\/oauth\/[a-z]+\/(start|callback)$/.test(url.pathname)) return true
  // Public service-state endpoints: maintenance flag + active announcements.
  // Read-only, no PII. Used by SPA shell to render maintenance banner / news.
  if (req.method === 'GET' && (url.pathname === '/api/public/features' || url.pathname === '/api/public/announcements')) return true
  if (req.method === 'GET' && url.pathname === '/api/public/status') return true
  if (req.method === 'GET' && url.pathname === '/api/public/docs') return true
  if (req.method === 'GET' && url.pathname === '/api/public/pricing') return true
  if (req.method === 'GET' && url.pathname === '/api/public/zones') return true
  if (req.method === 'GET' && url.pathname === '/api/public/hub-plans') return true
  // Password recovery + email verification â€” must be reachable when logged out.
  if (req.method === 'POST' && (url.pathname === '/api/auth/forgot-password' || url.pathname === '/api/auth/reset-password')) return true
  if (req.method === 'GET' && url.pathname === '/api/auth/verify-email') return true
  // Agent install / code / binary endpoints — token-authed via path. Must be
  // reachable without an admin session so a fresh node can fetch its installer.
  // Cover every install/claim variant — token-in-path is the auth (fleet hex
  // OR customer BYON `usr_<id>_<hex>`). `claim` (no suffix) returns the bash
  // installer; `claim-<kind>` covers binary, binary-win, code, win, mac, v4,
  // v6 — all server-side route at handleApi via a single regex around line
  // 4409. Keep the lists in sync.
  if (req.method === 'GET' && /^\/api\/agent\/(?:install|install-win|code|binary|binary-win|claim|claim-[a-z0-9-]+)\/(?:usr_[a-z0-9_]+|[0-9a-f]{8,})$/i.test(url.pathname)) return true
  // Upgrade endpoints — distinct from enrollment, auth via per-node upgradeToken in path.
  if (req.method === 'GET' && /^\/api\/agent\/(upgrade-script|binary-upgrade|code-upgrade)\/[0-9a-f]{16,}$/.test(url.pathname)) return true
  // Uninstall endpoint — auth via fleet token in path; operator who SSH'd in already has root.
  if (req.method === 'GET' && /^\/api\/agent\/uninstall\/[0-9a-f]{16,}$/.test(url.pathname)) return true
  // Per-proxy magic rotate URL — customer's scrapers hit this to force IP rotation.
  if (req.method === 'GET' && /^\/api\/rotate\/[0-9a-f]{16,}$/.test(url.pathname)) return true
  return false
}

async function handleApi(req, res, url) {
  try {
    // ── Magic rotate URL — public, token in path. Customer's scrapers GET this
    // to force the proxy to switch egress IPs without an API call. Returns
    // 200 + JSON with the new bindIp + cooldown info.
    const rotateUrlMatch = url.pathname.match(/^\/api\/rotate\/([0-9a-f]{16,})$/)
    if (rotateUrlMatch && req.method === 'GET') {
      const tok = rotateUrlMatch[1]
      const proxy = config.proxies.find((p) => p.rotateUrlToken && timingEqual(p.rotateUrlToken, tok))
      if (!proxy) return sendJson(res, 404, { error: 'unknown rotate token' })
      if (proxy.type !== 'IPv6') return sendJson(res, 400, { error: 'rotate only for IPv6 proxies' })
      if (proxy.status === 'expired') return sendJson(res, 410, { error: 'proxy expired' })
      // Rate limit: refuse if last rotate < 3s ago to avoid abuse hammering the agent.
      const now = Date.now()
      const last = Number(proxy.rotateLastAt || 0)
      const cooldownMs = Math.max(0, Number(config.proxyDefaults?.rotateCooldownSec || 3)) * 1000
      if (now - last < cooldownMs) {
        return sendJson(res, 429, { error: 'too soon, wait', retryAfterMs: cooldownMs - (now - last), bindIp: proxy.bindIp })
      }
      try {
        const next = pickBindIp(proxy.type, proxy.nodeId)
        if (!next) return sendJson(res, 409, { error: 'no IPv6 in pool' })
        const prev = proxy.bindIp
        proxy.bindIp = next
        proxy.rotateLastAt = now
        await saveConfig()
        dispatchWebhook(proxy.ownerId, 'proxy.ipRotated', { proxyId: proxy.id, bindIp: next, via: 'url' })
        return sendJson(res, 200, { ok: true, proxyId: proxy.id, previousIp: prev, bindIp: next, host: customerFacingHost(proxy), port: proxy.port })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }

    // â”€â”€ Stripe webhook (public, signature-verified) â€” must read raw body BEFORE
    //    the auth gate. Stripe calls this on payment success â†' we credit wallet.
    if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
      const secret = readSecret(config.billing?.stripeWebhookSecret)
      if (!secret) { res.writeHead(503); return res.end('webhook secret not configured\n') }
      const raw = await readRawBody(req)
      try { verifyStripeSignature(raw.toString('utf8'), req.headers['stripe-signature'], secret) }
      catch (e) { audit({ actor: 'stripe', ip: clientIp(req), method: 'POST', path: '/api/webhooks/stripe', status: 400, note: `bad sig: ${e.message}` }); res.writeHead(400); return res.end(`bad signature: ${e.message}\n`) }
      let event
      try { event = JSON.parse(raw.toString('utf8')) } catch { res.writeHead(400); return res.end('bad body\n') }
      // Idempotency: track processed event IDs in SQLite. Use INSERT OR IGNORE
      // so two concurrent webhook deliveries can't both pass a SELECT check and
      // double-credit the wallet — only one INSERT will write, the loser bails.
      if (sqliteDb) {
        try {
          sqliteDb.exec('CREATE TABLE IF NOT EXISTS stripe_seen (id TEXT PRIMARY KEY, ts TEXT NOT NULL)')
          const ins = sqliteDb.prepare('INSERT OR IGNORE INTO stripe_seen (id, ts) VALUES (?, ?)').run(event.id, new Date().toISOString())
          if (ins.changes === 0) { res.writeHead(200); return res.end('{}') }
        } catch {}
      }
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data?.object || {}
        const userId = session.metadata?.userId
        const amount = Math.floor(Number(session.metadata?.amount) || session.amount_total || 0)
        const user = config.users.find((u) => u.id === userId)
        if (user && amount > 0) {
          const next = recordBillingTx(user.id, 'topup', amount, `stripe ${session.id}`)
          audit({ actor: 'stripe', ip: clientIp(req), method: 'POST', path: '/api/webhooks/stripe', note: `credited user=${user.id} +${amount} â†' ${next}` })
        }
      }
      res.writeHead(200); return res.end('{}')
    }

    // â”€â”€ Node-agent surface (own auth: enroll token in path/body, or node bearer token) â”€â”€
    // Windows installer (PowerShell script). Returns a self-contained `.ps1` that
    // downloads agent.js, writes config, and registers a Windows Service via NSSM
    // or falls back to a scheduled task / foreground run.
    const winInstallMatch = url.pathname.match(/^\/api\/agent\/install-win\/([0-9a-f]{8,})$/)
    if (winInstallMatch && req.method === 'GET') {
      const node = config.nodes.find((n) => n.enrollToken && timingEqual(n.enrollToken, winInstallMatch[1]))
      if (!node) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('# unknown enroll token\n') }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end(winAgentInstallScript(node, controlBaseUrl()))
    }
    // macOS installer removed — proxy server platforms supported = Linux + Windows.
    // Windows binary (Rust cross-build). Served from candidate paths.
    const winBinMatch = url.pathname.match(/^\/api\/agent\/binary-win\/([0-9a-f]{8,})$/)
    if (winBinMatch && req.method === 'GET') {
      const node = config.nodes.find((n) => n.enrollToken && timingEqual(n.enrollToken, winBinMatch[1]))
      if (!node) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('unknown\n') }
      const candidates = [
        process.env.PROXYBOX_AGENT_BIN_WIN,
        process.env.PROXYHUB_AGENT_BIN_WIN,
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-pc-windows-gnu', 'release', 'proxybox-agent.exe'),
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-pc-windows-gnu', 'release', 'proxyhub-agent.exe')
      ].filter(Boolean)
      for (const p of candidates) {
        try {
          const buf = await fs.readFile(p)
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length })
          return res.end(buf)
        } catch { /* try next */ }
      }
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      return res.end('Windows binary not built. cd /home/proxyhub/proxybox/rust-core && cargo build --release --target x86_64-pc-windows-gnu\n')
    }
    // ── Agent upgrade flow ──
    // /api/agent/upgrade-script/:upgradeToken  → bash script that fetches the
    //   latest binary + agent.js and restarts the systemd unit. No enrollment,
    //   no service uninstall — preserves config and PKI.
    // /api/agent/binary-upgrade/:upgradeToken  → the new Rust binary.
    // /api/agent/code-upgrade/:upgradeToken    → the new Node fallback agent.js.
    const upgradeMatch = url.pathname.match(/^\/api\/agent\/(upgrade-script|binary-upgrade|code-upgrade)\/([0-9a-f]{16,})$/)
    if (upgradeMatch && req.method === 'GET') {
      const tok = upgradeMatch[2]
      const node = config.nodes.find((n) => n.upgradeToken && timingEqual(n.upgradeToken, tok))
      if (!node) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('# unknown upgrade token\n') }
      if (upgradeMatch[1] === 'binary-upgrade') {
        const candidates = [
          process.env.PROXYBOX_AGENT_BIN,
          process.env.PROXYHUB_AGENT_BIN,
          path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxybox-agent'),
          path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxyhub-agent')
        ].filter(Boolean)
        for (const p of candidates) {
          try {
            const buf = await fs.readFile(p)
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length })
            return res.end(buf)
          } catch { /* try next */ }
        }
        res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('binary unavailable\n')
      }
      if (upgradeMatch[1] === 'code-upgrade') {
        try {
          const code = await fs.readFile(path.join(__dirname, 'agent.js'))
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
          return res.end(code)
        } catch { res.writeHead(500); return res.end('// agent.js unavailable\n') }
      }
      // upgrade-script
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' })
      return res.end(agentUpgradeScript(node, controlBaseUrl()))
    }
    const enrollMatch = url.pathname.match(/^\/api\/agent\/(install|code|binary)\/([0-9a-f]{8,})$/)
    if (enrollMatch && req.method === 'GET') {
      const node = config.nodes.find((n) => n.enrollToken && timingEqual(n.enrollToken, enrollMatch[2]))
      if (!node) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('# unknown enroll token\n') }
      if (enrollMatch[1] === 'code') {
        try {
          const code = await fs.readFile(path.join(__dirname, 'agent.js'))
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
          return res.end(code)
        } catch { res.writeHead(500); return res.end('// agent.js unavailable\n') }
      }
      if (enrollMatch[1] === 'binary') {
        // serve the Rust agent binary; prefer glibc build (target/release) â€” musl + tokio
        // segfaults at startup on some kernels, glibc is portable enough for Ubuntu/Debian.
        const candidates = [
          process.env.PROXYBOX_AGENT_BIN,
          process.env.PROXYHUB_AGENT_BIN,
          path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxybox-agent'),
          path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxyhub-agent'),
          path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-unknown-linux-musl', 'release', 'proxybox-agent'),
          path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-unknown-linux-musl', 'release', 'proxyhub-agent')
        ].filter(Boolean)
        for (const p of candidates) {
          try {
            const buf = await fs.readFile(p)
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length })
            return res.end(buf)
          } catch { /* try next */ }
        }
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        return res.end('agent binary not built on this control plane; build rust-core first\n')
      }
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' })
      return res.end(agentInstallScript(node, controlBaseUrl()))
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/enroll') {
      const body = await readJson(req)
      const node = config.nodes.find((n) => n.enrollToken && timingEqual(n.enrollToken, String(body.enrollToken || '')))
      if (!node) return sendJson(res, 401, { error: 'invalid enroll token' })
      node.status = 'enrolled'
      // Single-use: invalidate the enroll token so a captured token can't be
      // replayed to rotate the agentToken or fetch the binary again.
      node.enrollToken = null
      node.agentToken = node.agentToken || crypto.randomBytes(24).toString('hex')
      await saveConfig()
      const payload = buildAgentEnrollPayload(node)
      return sendJson(res, 200, payload)
    }

    // ── Fleet (zero-touch) claim: same token works on N machines, agent
    // self-detects its public IP and auto-creates its own node entry.
    // Token lives in config.api.fleetEnrollToken (admin-rotated, no expiry).
    // Token shape: either a 16+ hex global fleet token OR a customer-owned
    // `usr_<id>_<hex>` token (used by /buy hub provisioning + BYON installs).
    const claimScriptMatch = url.pathname.match(/^\/api\/agent\/claim(?:-(win|mac|binary|binary-win|code|v4|v6))?\/((?:usr_[a-z0-9_]+|[0-9a-f]{16,}))$/i)
    if (claimScriptMatch && req.method === 'GET') {
      const token = claimScriptMatch[2]
      if (!fleetTokenValid(token) && !customerFleetTokenOwner(token)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        return res.end('# fleet enrollment token unknown or revoked\n')
      }
      const kind = claimScriptMatch[1] || ''
      // OSS download counter — feeds /admin/downloads. Map endpoint shape to
      // a single label per artifact: shell installer, native binary, etc.
      const dlKind = {
        '':           'agent-script-linux',
        'win':        'agent-script-win',
        'v4':         'agent-script-v4',
        'v6':         'agent-script-v6',
        'binary':     'agent-binary-linux',
        'binary-win': 'agent-binary-win',
        'code':       'agent-code'
      }[kind] || 'agent-other'
      recordDownload(dlKind, req)
      if (kind === 'binary' || kind === 'binary-win') {
        return serveAgentBinary(res, kind === 'binary-win')
      }
      if (kind === 'code') {
        try {
          const code = await fs.readFile(path.join(__dirname, 'agent.js'))
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
          return res.end(code)
        } catch { res.writeHead(500); return res.end('// agent.js unavailable\n') }
      }
      if (kind === 'win') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end(winAgentClaimInstallScript(token, controlBaseUrl()))
      }
      // macOS claim removed.
      // claim-v4 / claim-v6 inline the FAMILY env var so admins can paste a
      // single one-liner without remembering to prefix FAMILY=ipv4.
      const presetFamily = kind === 'v4' ? 'ipv4' : (kind === 'v6' ? 'ipv6' : null)
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' })
      return res.end(agentClaimInstallScript(token, controlBaseUrl(), presetFamily))
    }
    // ── Uninstall: clean removal of agent (service, binary, config, sysctl).
    // GET /api/agent/uninstall/:fleetToken → bash script the operator runs on
    // the node. Idempotent: re-running on an already-clean machine is a no-op.
    const uninstallMatch = url.pathname.match(/^\/api\/agent\/uninstall\/([0-9a-f]{16,})$/)
    if (uninstallMatch && req.method === 'GET') {
      if (!fleetTokenValid(uninstallMatch[1])) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        return res.end('# fleet enrollment token unknown or revoked\n')
      }
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' })
      return res.end(agentUninstallScript())
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/claim') {
      const body = await readJson(req)
      const rawToken = String(body.token || '')
      const customerOwner = customerFleetTokenOwner(rawToken)
      if (!customerOwner && !fleetTokenValid(rawToken)) {
        return sendJson(res, 401, { error: 'invalid or revoked fleet enrollment token' })
      }
      const node = await autoCreateOrRefreshClaimedNode({
        hostname: String(body.hostname || '').slice(0, 64),
        publicIp: String(body.publicIp || '').trim(),
        publicIp6: String(body.publicIp6 || '').trim(),
        family: String(body.family || '').toLowerCase(),
        ownerId: customerOwner ? customerOwner.id : null
      })
      if (node.error) return sendJson(res, 400, { error: node.error })
      const actor = customerOwner ? `customer:${customerOwner.email || customerOwner.id}` : 'agent'
      audit({ actor, ip: clientIp(req), method: 'POST', path: '/api/agent/claim', note: `auto-enrolled ${node.id} host=${node.host} family=${node.family}${node.ownerId ? ' [BYON]' : ''}` })
      return sendJson(res, 200, buildAgentEnrollPayload(node))
    }

    if (url.pathname.startsWith('/api/agent/')) {
      const node = nodeFromRequest(req)
      if (!node) return sendJson(res, 401, { error: 'invalid agent token' })
      return handleAgentRequest(req, res, url, node)
    }

    // â”€â”€ v1 user-facing API (auth via session; never the master apiKey) â”€â”€â”€â”€â”€â”€â”€â”€
    // Customer dashboards talk to /api/v1/user/*. Endpoints filter by session.userId
    // so customers can only see proxies/orders they own. Public sub-paths: auth/login,
    // auth/register, auth/me. Everything else requires a session.
    if (url.pathname.startsWith('/api/v1/user/')) {
      return handleUserV1(req, res, url)
    }
    // â”€â”€ v1 admin API (alias namespace; same handlers as /api/* under isAdminRequest) â”€â”€
    if (url.pathname.startsWith('/api/v1/admin/')) {
      if (!isAdminRequest(req)) return sendJson(res, 401, { error: 'admin auth required' })
      // Rewrite to legacy /api/* and recurse so all existing admin endpoints work unchanged.
      const rewritten = new URL(req.url.replace('/api/v1/admin/', '/api/'), `http://${req.headers.host || 'localhost'}`)
      return handleApi(req, res, rewritten)
    }

    if (!isPublicEndpoint(req, url) && !isApiAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' })

    // â”€â”€ Admin-only gate for /api/* (customers use /api/v1/user/*). â”€â”€
    // SECURITY FIX (pentest): previously only non-GET was gated â†' customer
    // session could GET /api/proxies, /api/nodes, /api/orders and exfiltrate
    // the whole fleet. Now ALL /api/* require admin (the v1 user namespace + a
    // few explicitly-public endpoints handled above are the only exceptions).
    if (!isPublicEndpoint(req, url) && !isAdminRequest(req)) {
      audit({ actor: actorOf(req), ip: clientIp(req), method: req.method, path: url.pathname, status: 403, note: 'denied' })
      return sendJson(res, 403, { error: 'admin role required' })
    }
    if (!isPublicEndpoint(req, url) && req.method !== 'GET' && req.method !== 'HEAD') {
      audit({ actor: actorOf(req), ip: clientIp(req), method: req.method, path: url.pathname })
    }
    if (!isPublicEndpoint(req, url) && req.method !== 'GET' && req.method !== 'HEAD') {
      audit({ actor: actorOf(req), ip: clientIp(req), method: req.method, path: url.pathname })
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        proxies: config.proxies.length,
        activeListeners: listeners.size,
        maintenance: !!(config.features && config.features.maintenance)
      })
    }

    // Public shell metadata: maintenance + selected feature flags + branding.
    // Customer SPA reads this on boot for theming, support contacts, banner.
    if (req.method === 'GET' && url.pathname === '/api/public/features') {
      const f = config.features || {}
      const b = config.branding || {}
      return sendJson(res, 200, {
        maintenance: !!(f.maintenance || b.maintenanceMode),
        maintenanceMessage: b.maintenanceMessage || '',
        registration: !!f.registration,
        oauth: !!f.oauth,
        affiliate: !!f.affiliate,
        billing: !!f.billing,
        brand: {
          name: b.brandName || 'ProxyBox',
          supportEmail: b.supportEmail || '',
          supportTelegram: b.supportTelegram || '',
          footerText: b.footerText || '',
          loginPageNote: b.loginPageNote || '',
          logoUrl: b.logoUrl || '',
          faviconUrl: b.faviconUrl || '',
          defaultLocale: b.defaultLocale || 'vi',
          defaultTheme: b.defaultTheme || 'dark',
          broadcast: b.broadcastText ? { text: b.broadcastText, level: b.broadcastLevel || 'info' } : null
        }
      })
    }
    // Public docs/help articles (published only, grouped on the client).
    if (req.method === 'GET' && url.pathname === '/api/public/docs') {
      if (!config.docs || !config.docs.length) config.docs = mergeDocsEn(defaultDocs())
    else mergeDocsEn(config.docs)
      // Locale selection: ?lang=en or ?lang=vi (default en when no doc body matches).
      const lang = (url.searchParams.get('lang') || 'en').toLowerCase() === 'vi' ? 'vi' : 'en'
      const list = config.docs
        .filter((d) => d.published !== false)
        .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.order || 0) - (b.order || 0))
        .map((d) => ({
          id: d.id,
          slug: d.slug,
          order: d.order,
          category: (lang === 'en' ? (d.category_en || d.category) : (d.category_vi || d.category)),
          title:    (lang === 'en' ? (d.title_en    || d.title)    : (d.title_vi    || d.title)),
          body:     (lang === 'en' ? (d.body_en     || d.body)     : (d.body_vi     || d.body)),
          updatedAt: d.updatedAt
        }))
      return sendJson(res, 200, list)
    }
    // ── Subscription endpoint (public, token-in-path auth) ──────────────
    // GET /api/sub/<token>?format=clash|surge|sub|plain&orderId=...
    // Returns the customer's proxies in the requested format. Designed to
    // be pasted into Clash Verge / Mihomo / Shadowrocket / Surge / etc.
    // The subscription-userinfo response header carries quota so apps
    // like Clash can display remaining bandwidth in their UI.
    const subMatch = url.pathname.match(/^\/api\/sub\/([a-f0-9]{16,})$/)
    if (subMatch && req.method === 'GET') {
      const token = subMatch[1]
      const user = (config.users || []).find((u) => u.subscriptionToken === token)
      if (!user) return sendJson(res, 404, { error: 'subscription not found or revoked' })
      const format = String(url.searchParams.get('format') || 'sub').toLowerCase()
      const orderId = url.searchParams.get('orderId') || ''
      let owned = config.proxies.filter((p) => p.ownerId === user.id && p.status === 'active')
      if (orderId) owned = owned.filter((p) => p.orderId === orderId)
      const hostFor = (p) => customerFacingHost(p) || p.listenHost
      // Body builder by format. Default to v2ray-style base64 sub which
      // every modern client (Clash Meta, v2rayN, Hiddify, Shadowrocket,
      // Stash) reads natively.
      let body, contentType, filename
      if (format === 'clash' || format === 'mihomo' || format === 'yaml') {
        body = buildClashConfig(owned, hostFor); contentType = 'text/yaml; charset=utf-8'; filename = 'proxybox.clash.yaml'
      } else if (format === 'surge' || format === 'stash' || format === 'ini') {
        body = buildSurgeConfig(owned, hostFor); contentType = 'text/plain; charset=utf-8'; filename = 'proxybox.surge.conf'
      } else if (format === 'plain' || format === 'list' || format === 'txt') {
        body = buildPlainList(owned, hostFor); contentType = 'text/plain; charset=utf-8'; filename = 'proxybox.urls.txt'
      } else if (format === 'json') {
        body = JSON.stringify(owned.map((p) => ({ id: p.id, host: hostFor(p), port: p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port, tlsPort: p.tlsPort, username: p.username, password: p.password, type: p.type, bindIp: p.bindIp })), null, 2); contentType = 'application/json; charset=utf-8'; filename = 'proxybox.json'
      } else {
        body = buildSubscriptionBase64(owned, hostFor); contentType = 'text/plain; charset=utf-8'; filename = 'proxybox.sub.txt'
      }
      // Compute total bytes used this month + the user's quota (if any).
      // Clash Meta / Verge read this header and display in the UI.
      let upload = 0, download = 0
      for (const p of owned) {
        const s = stats.get(p.id)
        upload += Number(s?.uploadBytes) || 0
        download += Number(s?.downloadBytes) || 0
      }
      const quotaGB = Number(config.pricing?.bandwidthQuotaGB) || 0
      const total = quotaGB > 0 ? quotaGB * 1_000_000_000 : 0
      const expireSec = (() => {
        // Use the earliest expiresAt across owned proxies; clients see "remaining days".
        let earliest = 0
        for (const p of owned) { const t = p.expiresAt ? new Date(p.expiresAt).getTime() / 1000 : 0; if (t && (!earliest || t < earliest)) earliest = t }
        return Math.floor(earliest)
      })()
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Subscription-Userinfo': `upload=${upload}; download=${download}; total=${total}; expire=${expireSec}`,
        'Profile-Update-Interval': '24'
      })
      res.end(body)
      return
    }

    // Public pricing (read-only mirror of /api/v1/user/pricing for the landing/pricing pages).
    if (req.method === 'GET' && url.pathname === '/api/public/pricing') {
      if (!config.pricing) config.pricing = defaultPricing()
      migratePricingToHourly()
      return sendJson(res, 200, config.pricing)
    }
    // Public zone catalog with `onlineNodes` count (no PII).
    if (req.method === 'GET' && url.pathname === '/api/public/zones') {
      if (!config.zones) config.zones = defaultZones()
      const zones = config.zones.map((z) => {
        const remote = (config.nodes || []).filter((n) => (n.zone || n.region || '') === z.id && nodeIsOnline(n)).length
        const local = ((config.api?.zone || config.api?.region || '').toLowerCase() === z.id) ? 1 : 0
        return { ...z, onlineNodes: remote + local }
      })
      return sendJson(res, 200, zones)
    }
    // Public hub catalog (public-safe subset; no vz.* credentials).
    if (req.method === 'GET' && url.pathname === '/api/public/hub-plans') {
      const list = (config.hubPlans || []).filter((p) => {
        if (p.enabled === false) return false
        const inst = findVirtualizorInstance({ id: p.vz?.instanceId, zone: p.region })
        return !!inst
      }).map(publicHubPlan)
      return sendJson(res, 200, list)
    }
    // Public service health â€” exposed at /status. No PII; just node count + uptime.
    if (req.method === 'GET' && url.pathname === '/api/public/status') {
      const allNodes = [localNode(), ...config.nodes.map(publicNode)]
      const online = allNodes.filter((n) => n.online !== false).length
      const offline = allNodes.length - online
      return sendJson(res, 200, {
        uptimeSeconds: Math.round(process.uptime()),
        proxies: config.proxies.length,
        nodes: { total: allNodes.length, online, offline },
        maintenance: !!(config.features && config.features.maintenance),
        announcements: (config.announcements || [])
          .filter((a) => a.visibility !== 'admin' && (!a.expiresAt || new Date(a.expiresAt).getTime() > Date.now()))
          .slice(0, 5)
          .map((a) => ({ text: a.text, severity: a.severity, createdAt: a.createdAt }))
      })
    }
    // Public active announcements (filtered: not expired + visibility=public|all)
    if (req.method === 'GET' && url.pathname === '/api/public/announcements') {
      const now = Date.now()
      const list = (config.announcements || [])
        .filter((a) => {
          if (a.visibility === 'admin') return false
          if (!a.expiresAt) return true
          return new Date(a.expiresAt).getTime() > now
        })
        .map((a) => ({ id: a.id, text: a.text, severity: a.severity, expiresAt: a.expiresAt, dismissible: a.dismissible !== false, createdAt: a.createdAt }))
      return sendJson(res, 200, list)
    }

    // Maintenance lockout â€” once flag is on, ONLY admin endpoints + auth + public
    // are still reachable. Customer /api/v1/user/* and proxy CRUD freeze with 503.
    // Honors EITHER features.maintenance OR branding.maintenanceMode (new path).
    if ((config.features && config.features.maintenance) || config.branding?.maintenanceMode) {
      const isAdminPath = url.pathname.startsWith('/api/admin/')
      const isAuthPath  = url.pathname.startsWith('/api/auth/')
      const isPublic    = url.pathname.startsWith('/api/public/') || url.pathname === '/api/health'
      const isAgentPath = url.pathname.startsWith('/api/agent/')
      if (!isAdminPath && !isAuthPath && !isPublic && !isAgentPath) {
        // Admin sessions can still bypass via X-API-Key or admin role
        if (!isAdminRequest(req)) {
          return sendJson(res, 503, { error: 'maintenance mode â€” service temporarily unavailable', maintenance: true })
        }
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') return handleLogin(req, res)
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      if (!isFeatureEnabled('registration')) return sendJson(res, 403, { error: 'registration disabled by admin' })
      return handleRegister(req, res)
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') return handleLogout(req, res)
    if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') return handleForgotPassword(req, res)
    if (req.method === 'POST' && url.pathname === '/api/auth/reset-password')  return handleResetPassword(req, res)
    if (req.method === 'GET'  && url.pathname === '/api/auth/verify-email')    return handleVerifyEmail(req, res, url)
    if (req.method === 'POST' && url.pathname === '/api/auth/resend-verify')   return handleResendVerify(req, res)

    // â”€â”€ OAuth (Google + GitHub) â€” public, feature-flagged â”€â”€
    const oauthMatch = url.pathname.match(/^\/api\/auth\/oauth\/([a-z]+)\/(start|callback)$/)
    if (oauthMatch && req.method === 'GET') {
      const [, provider, phase] = oauthMatch
      if (phase === 'start') return oauthRoutes.handleStart(req, res, url, provider)
      return oauthRoutes.handleCallback(req, res, url, provider)
    }
    // What OAuth providers are configured (frontend shows the right buttons)
    if (req.method === 'GET' && url.pathname === '/api/auth/oauth/providers') {
      const enabled = isFeatureEnabled('oauth')
      const list = []
      if (enabled) {
        if (config.oauth?.google?.clientId)  list.push({ id: 'google', label: 'Google' })
        if (config.oauth?.github?.clientId)  list.push({ id: 'github', label: 'GitHub' })
      }
      return sendJson(res, 200, { enabled, providers: list })
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const session = sessionFromRequest(req)
      if (!session) return sendJson(res, 200, { authenticatedVia: 'apiKey' })
      return sendJson(res, 200, { name: session.name, email: session.email })
    }

    // â”€â”€ admin: rotate master api key â”€â”€
    if (req.method === 'POST' && url.pathname === '/api/admin/rotate-api-key') {
      const next = crypto.randomBytes(24).toString('hex')
      config.api.apiKey = next
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: 'apiKey rotated' })
      return sendJson(res, 200, { ok: true, apiKey: next })
    }

    // Auto-fix proxy port↔tlsPort collisions caused by bulk-allocators that
    // bypassed nextPort(). For each colliding pair, relocates the tlsPort
    // to the next free slot above the current max (plain port stays — it's
    // customer-facing). Idempotent: returns count=0 when nothing to fix.
    if (req.method === 'POST' && url.pathname === '/api/admin/maintenance/relocate-tls-ports') {
      const usedPlain = new Map(); const usedTls = new Map();
      for (const p of config.proxies) {
        if (Number.isFinite(p.port)) usedPlain.set(Number(p.port), p.id);
        if (Number.isFinite(p.tlsPort)) usedTls.set(Number(p.tlsPort), p.id);
      }
      const toRelocate = new Set()
      for (const p of config.proxies) {
        const a = usedTls.get(Number(p.port)); if (a && a !== p.id) toRelocate.add(a)         // their tlsPort hits my plain → relocate them
        const b = usedPlain.get(Number(p.tlsPort)); if (b && b !== p.id) toRelocate.add(p.id) // my tlsPort hits their plain → relocate me
      }
      if (toRelocate.size === 0) return sendJson(res, 200, { count: 0, message: 'no collisions' })
      const maxAny = Math.max(0, ...usedPlain.keys(), ...usedTls.keys())
      let nextFree = maxAny + 1
      const findFree = () => { while (usedPlain.has(nextFree) || usedTls.has(nextFree)) nextFree++; return nextFree++ }
      const changes = []
      for (const id of toRelocate) {
        const p = config.proxies.find((x) => x.id === id); if (!p) continue
        const oldTls = p.tlsPort
        usedTls.delete(oldTls)
        const newTls = findFree()
        usedTls.set(newTls, p.id)
        p.tlsPort = newTls
        changes.push({ id: p.id, oldTls, newTls })
      }
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `relocated ${changes.length} tlsPorts` })
      return sendJson(res, 200, { count: changes.length, sample: changes.slice(0, 5) })
    }

    // â”€â”€ admin: feature flags (runtime toggle for major capabilities) â”€â”€
    // Admin settings — categorized into 8 groups. Each group is a slice of
    // config.json with strict whitelist + validators. Hot-reload semantics:
    // most values read at usage site, no restart needed. A few engine-level
    // values (buffer sizes, worker counts) are persisted but require an agent
    // restart to take effect — flagged in the UI.
    const SETTING_GROUPS = {
      'anti-abuse': {
        path: 'proxyDefaults',
        defaults: {
          maxConnsPerProxy: 100,
          maxConnsPerSrcIp: 60,
          newConnsPerSecPerIp: 30,
          loginMaxAttemptsPer15Min: 10,
          loginLockoutMinutes: 60,
          quotaGracePercent: 5,
          autoSuspendAfterFails: 5,
          rotateCooldownSec: 3
        },
        intFields: ['maxConnsPerProxy','maxConnsPerSrcIp','newConnsPerSecPerIp','loginMaxAttemptsPer15Min','loginLockoutMinutes','quotaGracePercent','autoSuspendAfterFails','rotateCooldownSec']
      },
      'engine': {
        path: 'engine',
        defaults: {
          clientIdleTimeoutSec: 120,
          upstreamConnectTimeoutSec: 30,
          relayBufferKB: 256,
          listenBacklog: 65535,
          agentPollIntervalSec: 5,
          agentHeartbeatSec: 20,
          longPollHoldSec: 25,
          workerCountPerProxy: 0
        },
        intFields: ['clientIdleTimeoutSec','upstreamConnectTimeoutSec','relayBufferKB','listenBacklog','agentPollIntervalSec','agentHeartbeatSec','longPollHoldSec','workerCountPerProxy']
      },
      'proxy-defaults': {
        path: 'proxyDefaults',
        defaults: {
          portStart: 20000,
          expiresDays: 30,
          allowPrivateTargets: false,
          region: 'VN',
          defaultMonthlyQuotaGB: 0,
          defaultBytesPerSec: 0,
          defaultRotateEverySec: 0,
          listenHost: '0.0.0.0',
          ipv6PoolPerPrefix: 64
        },
        intFields: ['portStart','expiresDays','defaultMonthlyQuotaGB','defaultBytesPerSec','defaultRotateEverySec','ipv6PoolPerPrefix'],
        boolFields: ['allowPrivateTargets'],
        strFields: ['region','listenHost']
      },
      'branding': {
        path: 'branding',
        defaults: {
          brandName: 'ProxyBox',
          supportEmail: '',
          supportTelegram: '',
          footerText: '',
          maintenanceMode: false,
          maintenanceMessage: '',
          broadcastText: '',
          broadcastLevel: 'info',
          loginPageNote: '',
          defaultLocale: 'vi',
          defaultTheme: 'dark',
          logoUrl: '',
          faviconUrl: ''
        },
        boolFields: ['maintenanceMode'],
        strFields: ['brandName','supportEmail','supportTelegram','footerText','maintenanceMessage','broadcastText','broadcastLevel','loginPageNote','defaultLocale','defaultTheme','logoUrl','faviconUrl']
      },
      'alerts': {
        path: 'alerts',
        defaults: {
          webhookUrl: '',
          webhookFormat: 'slack',
          dedupeMinutes: 5,
          onAgentOfflineMin: 5,
          highCpuPercent: 90,
          highRamPercent: 90,
          lowDiskPercent: 10,
          quotaSpikePercent: 50,
          slaTargetPercent: 99.5
        },
        intFields: ['dedupeMinutes','onAgentOfflineMin','highCpuPercent','highRamPercent','lowDiskPercent','quotaSpikePercent'],
        floatFields: ['slaTargetPercent'],
        strFields: ['webhookUrl','webhookFormat']
      },
      'billing': {
        path: 'billing',
        defaults: {
          defaultCurrency: 'VND',
          minTopupAmount: 50000,
          maxTopupAmount: 100000000,
          walletDecimals: 0,
          autoRenewThresholdPct: 100,
          autoRenewAdvanceHours: 24,
          trialDays: 0,
          invoicePrefix: 'INV',
          vatPercent: 0,
          stripeEnabled: false,
          stripeMode: 'test'
        },
        intFields: ['minTopupAmount','maxTopupAmount','walletDecimals','autoRenewThresholdPct','autoRenewAdvanceHours','trialDays','vatPercent'],
        boolFields: ['stripeEnabled'],
        strFields: ['defaultCurrency','invoicePrefix','stripeMode']
      },
      'health-check': {
        path: 'healthCheck',
        defaults: {
          checkHost: 'api.ipify.org',
          checkHostV6: 'api64.ipify.org',
          checkTimeoutMs: 12000,
          speedtestHost: 'speed.cloudflare.com',
          speedtestBytes: 10485760,
          probeIntervalMin: 5,
          failThresholdBeforeAutoRotate: 3
        },
        intFields: ['checkTimeoutMs','speedtestBytes','probeIntervalMin','failThresholdBeforeAutoRotate'],
        strFields: ['checkHost','checkHostV6','speedtestHost']
      },
      'operations': {
        path: 'operations',
        defaults: {
          auditRetentionDays: 90,
          statsResetCadence: 'monthly',
          sweepExpiredIntervalMin: 5,
          sweepAutoRotateIntervalSec: 60,
          autoUpgradeAgents: true,
          pinAgentVersion: '',
          nodeAutoDisableAfterMin: 30,
          enableAuditFullPayload: false
        },
        intFields: ['auditRetentionDays','sweepExpiredIntervalMin','sweepAutoRotateIntervalSec','nodeAutoDisableAfterMin'],
        boolFields: ['autoUpgradeAgents','enableAuditFullPayload'],
        strFields: ['statsResetCadence','pinAgentVersion']
      }
    }
    const settingsMatch = url.pathname.match(/^\/api\/admin\/settings\/([a-z-]+)$/)
    if (settingsMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const group = SETTING_GROUPS[settingsMatch[1]]
      if (!group) return sendJson(res, 404, { error: 'unknown settings group' })
      const slice = (config[group.path] ||= {})
      const view = () => {
        const out = { ...group.defaults }
        for (const k of Object.keys(group.defaults)) if (slice[k] !== undefined) out[k] = slice[k]
        return out
      }
      if (req.method === 'GET') return sendJson(res, 200, view())
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        for (const k of (group.intFields || [])) {
          if (k in body) { const n = Number(body[k]); if (Number.isFinite(n) && n >= 0 && n <= 1e10) slice[k] = Math.floor(n) }
        }
        for (const k of (group.floatFields || [])) {
          if (k in body) { const n = Number(body[k]); if (Number.isFinite(n)) slice[k] = n }
        }
        for (const k of (group.boolFields || [])) {
          if (k in body && typeof body[k] === 'boolean') slice[k] = body[k]
        }
        for (const k of (group.strFields || [])) {
          if (k in body && typeof body[k] === 'string') slice[k] = body[k].trim()
        }
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `settings:${settingsMatch[1]} updated` })
        return sendJson(res, 200, view())
      }
    }

    // Legacy single-group endpoint kept for compat; same data as new
    // /api/admin/settings/anti-abuse but only the 3 cap fields.
    if (url.pathname === '/api/admin/proxy-defaults') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.proxyDefaults) config.proxyDefaults = {}
      const view = () => ({
        maxConnsPerProxy:    Number(config.proxyDefaults.maxConnsPerProxy    || 100),
        maxConnsPerSrcIp:    Number(config.proxyDefaults.maxConnsPerSrcIp    || 60),
        newConnsPerSecPerIp: Number(config.proxyDefaults.newConnsPerSecPerIp || 30)
      })
      if (req.method === 'GET') return sendJson(res, 200, view())
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        for (const k of ['maxConnsPerProxy', 'maxConnsPerSrcIp', 'newConnsPerSecPerIp']) {
          const n = Number(body[k])
          if (Number.isFinite(n) && n >= 1 && n <= 100000) config.proxyDefaults[k] = Math.floor(n)
        }
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: 'proxy defaults updated' })
        return sendJson(res, 200, view())
      }
    }

    // ── Virtualizor instances (multi-zone) ────────────────────────────────
    // Each instance maps 1 Virtualizor admin panel to 1 zone (vn-hcm, sg, us-east, …).
    // Hub plans associate to an instance.id; customer-facing flow shows zones,
    // backend picks the right instance by zone. Creds AES-256-GCM encrypted.
    if (url.pathname === '/api/admin/virtualizors') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!Array.isArray(config.virtualizors)) config.virtualizors = []
      if (req.method === 'GET') return sendJson(res, 200, config.virtualizors.map(publicVirtualizor))
      if (req.method === 'POST') {
        const body = await readJson(req)
        if (!body.panelUrl || !body.apiKey || !body.apiPass) return sendJson(res, 400, { error: 'panelUrl + apiKey + apiPass required' })
        const inst = {
          id: `vz-${crypto.randomBytes(3).toString('hex')}`,
          label: String(body.label || 'Virtualizor').trim().slice(0, 64),
          zone: String(body.zone || '').trim().toLowerCase().slice(0, 32),
          panelUrl: String(body.panelUrl).trim().replace(/\/+$/, ''),
          apiKeyEncrypted: encryptSecret(String(body.apiKey).trim()),
          apiKeyHint: String(body.apiKey).trim().slice(-4),
          apiPassEncrypted: encryptSecret(String(body.apiPass).trim()),
          apiPassHint: String(body.apiPass).trim().slice(-4),
          insecureTls: body.insecureTls !== false,
          enabled: body.enabled !== false,
          createdAt: new Date().toISOString()
        }
        config.virtualizors.push(inst)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `virtualizor added: ${inst.id} zone=${inst.zone}` })
        return sendJson(res, 201, publicVirtualizor(inst))
      }
    }
    const vzInstMatch = url.pathname.match(/^\/api\/admin\/virtualizors\/([a-z0-9-]+)(?:\/(test|servers|plans|ip-pools|templates))?$/)
    if (vzInstMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const inst = (config.virtualizors || []).find((v) => v.id === vzInstMatch[1])
      if (!inst) return sendJson(res, 404, { error: 'virtualizor instance not found' })
      const sub2 = vzInstMatch[2]
      if (!sub2) {
        if (req.method === 'GET') return sendJson(res, 200, publicVirtualizor(inst))
        if (req.method === 'PATCH') {
          const body = await readJson(req)
          if (typeof body.label === 'string') inst.label = body.label.trim().slice(0, 64)
          if (typeof body.zone === 'string') inst.zone = body.zone.trim().toLowerCase().slice(0, 32)
          if (typeof body.panelUrl === 'string') inst.panelUrl = body.panelUrl.trim().replace(/\/+$/, '')
          if (typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.startsWith('••••')) {
            inst.apiKeyEncrypted = encryptSecret(body.apiKey.trim()); inst.apiKeyHint = body.apiKey.trim().slice(-4)
          }
          if (typeof body.apiPass === 'string' && body.apiPass && !body.apiPass.startsWith('••••')) {
            inst.apiPassEncrypted = encryptSecret(body.apiPass.trim()); inst.apiPassHint = body.apiPass.trim().slice(-4)
          }
          if (typeof body.insecureTls === 'boolean') inst.insecureTls = body.insecureTls
          if (typeof body.enabled === 'boolean') inst.enabled = body.enabled
          await saveConfig()
          return sendJson(res, 200, publicVirtualizor(inst))
        }
        if (req.method === 'DELETE') {
          config.virtualizors = config.virtualizors.filter((v) => v.id !== inst.id)
          await saveConfig()
          audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `virtualizor removed: ${inst.id}` })
          return sendJson(res, 200, { ok: true })
        }
      }
      // Subroutes: test connection + passthroughs
      const cfg = decryptVirtualizorInstance(inst)
      if (!cfg) return sendJson(res, 400, { error: 'instance decrypt failed' })
      if (sub2 === 'test' && req.method === 'POST') {
        try {
          const r = await virtualizor.testConnection(cfg)
          inst.lastTestedAt = new Date().toISOString(); inst.lastTestOk = true; inst.lastTestError = null
          await saveConfig()
          return sendJson(res, 200, { ok: true, sample: r.raw })
        } catch (e) {
          inst.lastTestedAt = new Date().toISOString(); inst.lastTestOk = false; inst.lastTestError = e.message
          await saveConfig()
          return sendJson(res, 200, { ok: false, error: e.message })
        }
      }
      if (req.method === 'GET' && ['servers', 'plans', 'ip-pools', 'templates'].includes(sub2)) {
        try {
          const map = { servers: 'listServers', plans: 'listPlans', 'ip-pools': 'listIpPools', templates: 'listOsTemplates' }
          const r = await virtualizor[map[sub2]](cfg)
          return sendJson(res, 200, r)
        } catch (e) { return sendJson(res, 502, { error: e.message }) }
      }
    }

    // Legacy single-Virtualizor endpoints (kept for backward compat — migrate
    // to /api/admin/virtualizors/* for multi-zone support)
    if (url.pathname === '/api/admin/virtualizor/config') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.virtualizor) config.virtualizor = {}
      if (req.method === 'GET') {
        const v = config.virtualizor
        return sendJson(res, 200, {
          panelUrl: v.panelUrl || '',
          apiKey:   v.apiKeyEncrypted ? '••••••••' + (v.apiKeyHint || '') : '',
          apiPass:  v.apiPassEncrypted ? '••••••••' + (v.apiPassHint || '') : '',
          insecureTls: v.insecureTls !== false,
          enabled: !!v.enabled,
          lastTestedAt: v.lastTestedAt || null,
          lastTestOk: v.lastTestOk ?? null,
          lastTestError: v.lastTestError || null
        })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (typeof body.panelUrl === 'string') config.virtualizor.panelUrl = body.panelUrl.trim().replace(/\/+$/, '')
        if (typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.startsWith('••••')) {
          config.virtualizor.apiKeyEncrypted = encryptSecret(body.apiKey.trim())
          config.virtualizor.apiKeyHint = body.apiKey.trim().slice(-4)
        }
        if (typeof body.apiPass === 'string' && body.apiPass && !body.apiPass.startsWith('••••')) {
          config.virtualizor.apiPassEncrypted = encryptSecret(body.apiPass.trim())
          config.virtualizor.apiPassHint = body.apiPass.trim().slice(-4)
        }
        if (typeof body.insecureTls === 'boolean') config.virtualizor.insecureTls = body.insecureTls
        if (typeof body.enabled === 'boolean') config.virtualizor.enabled = body.enabled
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: 'virtualizor config updated' })
        return sendJson(res, 200, { ok: true })
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/virtualizor/test') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const cfg = decryptedVirtualizorConfig()
      if (!cfg) return sendJson(res, 400, { error: 'virtualizor not configured' })
      try {
        const r = await virtualizor.testConnection(cfg)
        config.virtualizor.lastTestedAt = new Date().toISOString()
        config.virtualizor.lastTestOk = true
        config.virtualizor.lastTestError = null
        await saveConfig()
        return sendJson(res, 200, { ok: true, sample: r.raw })
      } catch (e) {
        config.virtualizor.lastTestedAt = new Date().toISOString()
        config.virtualizor.lastTestOk = false
        config.virtualizor.lastTestError = e.message
        await saveConfig()
        return sendJson(res, 200, { ok: false, error: e.message })
      }
    }
    const vzListMatch = url.pathname.match(/^\/api\/admin\/virtualizor\/(servers|plans|ip-pools|templates)$/)
    if (req.method === 'GET' && vzListMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const cfg = decryptedVirtualizorConfig()
      if (!cfg) return sendJson(res, 400, { error: 'virtualizor not configured' })
      try {
        const map = { 'servers': 'listServers', 'plans': 'listPlans', 'ip-pools': 'listIpPools', 'templates': 'listOsTemplates' }
        const r = await virtualizor[map[vzListMatch[1]]](cfg)
        return sendJson(res, 200, r)
      } catch (e) {
        return sendJson(res, 502, { error: e.message })
      }
    }

    // ── Hub plans: admin-defined catalog of bookable VPS plans ─────────────
    // Each entry maps an internal Virtualizor plan/server/template to a
    // customer-visible name + price. Customers see ONLY the public fields
    // (name, region, price, specs) — never the internal vz.* IDs.
    if (url.pathname === '/api/admin/hub-plans') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!Array.isArray(config.hubPlans)) config.hubPlans = []
      if (req.method === 'GET') return sendJson(res, 200, config.hubPlans)
      if (req.method === 'POST') {
        const body = await readJson(req)
        const plan = normalizeHubPlan(body)
        plan.id = `hub-${crypto.randomBytes(4).toString('hex')}`
        plan.createdAt = new Date().toISOString()
        config.hubPlans.push(plan)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `hub plan created: ${plan.id}` })
        return sendJson(res, 201, plan)
      }
    }
    const hubPlanMatch = url.pathname.match(/^\/api\/admin\/hub-plans\/([a-z0-9-]+)$/)
    if (hubPlanMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const plan = (config.hubPlans || []).find((p) => p.id === hubPlanMatch[1])
      if (!plan) return sendJson(res, 404, { error: 'hub plan not found' })
      if (req.method === 'GET') return sendJson(res, 200, plan)
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        Object.assign(plan, normalizeHubPlan({ ...plan, ...body }))
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `hub plan updated: ${plan.id}` })
        return sendJson(res, 200, plan)
      }
      if (req.method === 'DELETE') {
        config.hubPlans = config.hubPlans.filter((p) => p.id !== plan.id)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `hub plan deleted: ${plan.id}` })
        return sendJson(res, 200, { ok: true })
      }
    }
    // Admin: list of ALL provisioned hub VMs across customers
    if (req.method === 'GET' && url.pathname === '/api/admin/hubs') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const list = (config.nodes || []).filter((n) => n.hub).map((n) => {
        const owner = n.ownerId ? config.users.find((u) => u.id === n.ownerId) : null
        const plan = (config.hubPlans || []).find((p) => p.id === n.hub?.planId)
        return {
          id: n.id, name: n.name, host: n.host, family: n.family,
          status: n.status, version: n.version,
          ownerEmail: owner?.email || null, ownerId: n.ownerId,
          planId: n.hub?.planId, planName: plan?.name || null,
          vpsid: n.hub?.vpsid || null,
          provisionedAt: n.hub?.provisionedAt, expiresAt: n.hub?.expiresAt,
          hoursPaid: n.hub?.hoursPaid || 0,
          hourlyPrice: plan?.hourlyPrice || 0,
          state: n.hub?.state || 'unknown'
        }
      })
      return sendJson(res, 200, list)
    }

    if (url.pathname === '/api/admin/features') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.features) config.features = { ...FEATURE_DEFAULTS }
      if (req.method === 'GET') {
        // Merge defaults with overrides so admin sees full feature catalogue.
        return sendJson(res, 200, { ...FEATURE_DEFAULTS, ...config.features })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        for (const [k, v] of Object.entries(body)) {
          if (Object.prototype.hasOwnProperty.call(FEATURE_DEFAULTS, k) && typeof v === 'boolean') {
            config.features[k] = v
          }
        }
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: 'features updated' })
        return sendJson(res, 200, { ...FEATURE_DEFAULTS, ...config.features })
      }
    }

    // â”€â”€ admin: OAuth provider config (Google + GitHub client_id/secret) â”€â”€
    if (url.pathname === '/api/admin/oauth') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.oauth) config.oauth = { google: {}, github: {} }
      if (req.method === 'GET') {
        const redact = (p) => ({
          clientId: p?.clientId || '',
          clientSecret: p?.clientSecret ? 'â€¢â€¢â€¢â€¢' + String(p.clientSecret).slice(-4) : '',
          callbackUrl: p?.callbackUrl || ''
        })
        return sendJson(res, 200, { google: redact(config.oauth.google), github: redact(config.oauth.github) })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        for (const provider of ['google', 'github']) {
          if (!body[provider]) continue
          config.oauth[provider] = config.oauth[provider] || {}
          if (typeof body[provider].clientId === 'string') config.oauth[provider].clientId = body[provider].clientId.trim()
          if (typeof body[provider].clientSecret === 'string' && body[provider].clientSecret && !body[provider].clientSecret.startsWith('â€¢â€¢â€¢â€¢')) {
            config.oauth[provider].clientSecret = body[provider].clientSecret.trim()
          }
          if (typeof body[provider].callbackUrl === 'string') config.oauth[provider].callbackUrl = body[provider].callbackUrl.trim()
        }
        await saveConfig()
        return sendJson(res, 200, { ok: true })
      }
    }

    // â”€â”€ admin: billing config (Stripe + SMTP-free billing knobs) â”€â”€
    if (url.pathname === '/api/admin/billing/config') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.billing) config.billing = { testMode: true, trialCredits: 50000, affiliateKickback: 20000, currency: 'vnd' }
      if (req.method === 'GET') {
        // Redact secret values â€” only flag whether they're set.
        return sendJson(res, 200, {
          testMode: Boolean(config.billing.testMode),
          currency: config.billing.currency || 'vnd',
          trialCredits: Number(config.billing.trialCredits) || 0,
          affiliateKickback: Number(config.billing.affiliateKickback) || 0,
          successUrl: config.billing.successUrl || '',
          cancelUrl: config.billing.cancelUrl || '',
          stripeSecretKey: maskSecret(config.billing.stripeSecretKey),
          stripeWebhookSecret: maskSecret(config.billing.stripeWebhookSecret),
          paypalEnabled: Boolean(config.billing.paypalEnabled),
          paypalMode: config.billing.paypalMode === 'live' ? 'live' : 'sandbox',
          paypalClientId: maskSecret(config.billing.paypalClientId),
          paypalSecret: maskSecret(config.billing.paypalSecret),
          paypalReturnUrl: config.billing.paypalReturnUrl || '',
          paypalCancelUrl: config.billing.paypalCancelUrl || '',
          paypalCurrency: config.billing.paypalCurrency || 'USD'
        })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (typeof body.testMode === 'boolean') config.billing.testMode = body.testMode
        if (typeof body.currency === 'string') config.billing.currency = body.currency.toLowerCase().slice(0, 8)
        if (Number.isFinite(Number(body.trialCredits))) config.billing.trialCredits = Math.max(0, Math.floor(Number(body.trialCredits)))
        if (Number.isFinite(Number(body.affiliateKickback))) config.billing.affiliateKickback = Math.max(0, Math.floor(Number(body.affiliateKickback)))
        if (typeof body.successUrl === 'string') config.billing.successUrl = body.successUrl.trim().slice(0, 500)
        if (typeof body.cancelUrl === 'string') config.billing.cancelUrl = body.cancelUrl.trim().slice(0, 500)
        // Only update secrets when client sends a new non-redacted value
        // Secrets are stored AES-256-GCM-encrypted on disk via writeSecret
        // (master.key, chmod 600). On disk they look like `v1:iv:tag:ct`
        // — even with a config.json leak the secret stays sealed without
        // the master key. Skip writes when the client posts back the
        // masked sentinel (••••…) so we don't overwrite the real value.
        if (typeof body.stripeSecretKey === 'string' && body.stripeSecretKey && !body.stripeSecretKey.startsWith('••••')) {
          config.billing.stripeSecretKey = writeSecret(body.stripeSecretKey.trim())
        }
        if (typeof body.stripeWebhookSecret === 'string' && body.stripeWebhookSecret && !body.stripeWebhookSecret.startsWith('••••')) {
          config.billing.stripeWebhookSecret = writeSecret(body.stripeWebhookSecret.trim())
        }
        // PayPal fields
        if (typeof body.paypalEnabled === 'boolean') config.billing.paypalEnabled = body.paypalEnabled
        if (body.paypalMode === 'live' || body.paypalMode === 'sandbox') config.billing.paypalMode = body.paypalMode
        if (typeof body.paypalClientId === 'string' && body.paypalClientId && !body.paypalClientId.startsWith('••••')) {
          config.billing.paypalClientId = writeSecret(body.paypalClientId.trim())
        }
        if (typeof body.paypalSecret === 'string' && body.paypalSecret && !body.paypalSecret.startsWith('••••')) {
          config.billing.paypalSecret = writeSecret(body.paypalSecret.trim())
        }
        if (typeof body.paypalReturnUrl === 'string') config.billing.paypalReturnUrl = body.paypalReturnUrl.trim().slice(0, 500)
        if (typeof body.paypalCancelUrl === 'string') config.billing.paypalCancelUrl = body.paypalCancelUrl.trim().slice(0, 500)
        if (typeof body.paypalCurrency === 'string') config.billing.paypalCurrency = body.paypalCurrency.toUpperCase().slice(0, 8)
        // Reset cached token when credentials change
        _paypalTokenCache = { value: '', expiresAt: 0 }
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: 'billing config updated' })
        return sendJson(res, 200, { ok: true })
      }
    }

    // â”€â”€ admin: SMTP config + test-send â”€â”€
    if (url.pathname === '/api/admin/smtp') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.smtp) config.smtp = {}
      if (req.method === 'GET') {
        return sendJson(res, 200, {
          host: config.smtp.host || '',
          port: Number(config.smtp.port) || 587,
          user: config.smtp.user || '',
          pass: config.smtp.pass ? 'â€¢â€¢â€¢â€¢' + String(config.smtp.pass).slice(-4) : '',
          from: config.smtp.from || ''
        })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (typeof body.host === 'string') config.smtp.host = body.host.trim()
        if (Number.isFinite(Number(body.port))) config.smtp.port = Math.floor(Number(body.port))
        if (typeof body.user === 'string') config.smtp.user = body.user.trim()
        if (typeof body.pass === 'string' && body.pass && !body.pass.startsWith('â€¢â€¢â€¢â€¢')) config.smtp.pass = body.pass
        if (typeof body.from === 'string') config.smtp.from = body.from.trim()
        await saveConfig()
        return sendJson(res, 200, { ok: true })
      }
    }
    if (url.pathname === '/api/admin/smtp/test' && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const body = await readJson(req)
      const to = String(body.to || '').trim()
      if (!to) return sendJson(res, 400, { error: 'to required' })
      const ok = await sendMail({ to, subject: 'ProxyBox SMTP test', text: 'If you see this, SMTP works.', html: '<p>If you see this, SMTP works.</p>' })
      return sendJson(res, 200, { ok })
    }

    // â”€â”€ admin: rich orders management â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const fOwner = url.searchParams.get('ownerId') || ''
      const fStatus = url.searchParams.get('status') || ''
      const fType = url.searchParams.get('type') || ''
      const fFrom = url.searchParams.get('from') || ''
      const fTo = url.searchParams.get('to') || ''
      const fNodeId = url.searchParams.get('nodeId') || ''
      const fZone = url.searchParams.get('zone') || ''
      // Build proxy lookup once for the join below.
      const proxyById = new Map()
      for (const p of config.proxies) proxyById.set(p.id, p)
      // Enrich each order with derived fields: nodeId, zone, ipv4/ipv6 counts, expiry.
      let list = orders.map((o) => {
        // Cross-ownership check: a proxy only counts as a "real member" of this
        // order if proxy.orderId === order.id. This prevents legacy/seed orders
        // from showing as 'active' just because their proxyIds happen to match
        // some other order's proxies in config.proxies.
        const members = (o.proxyIds || [])
          .map((id) => proxyById.get(id))
          .filter((p) => p && p.orderId === o.id)
        const first = members[0]
        const types = new Set(members.map((p) => String(p.type || '').toLowerCase()))
        // effectiveStatus reflects ACTUAL proxy state, not just stored order.status:
        //   deleted  → no surviving members truly owned by this order
        //   expired  → all members have status='expired'
        //   active   → at least one active member + order.status is paid/active
        //   else fall back to stored order.status (cancelled/refunded)
        let effectiveStatus = o.status || 'paid'
        if (!members.length) effectiveStatus = 'deleted'
        else if (members.every((p) => p.status === 'expired')) effectiveStatus = 'expired'
        else if ((o.status === 'paid' || o.status === 'active') && members.some((p) => p.status === 'active')) effectiveStatus = 'active'
        return {
          ...o,
          nodeId: first?.nodeId || 'local',
          zone: first?.zone || first?.region || '',
          memberCount: members.length,
          ipv4Count: members.filter((p) => String(p.type).toLowerCase() === 'ipv4').length,
          ipv6Count: members.filter((p) => String(p.type).toLowerCase() === 'ipv6').length,
          activeCount: members.filter((p) => p.status === 'active').length,
          effectiveStatus,
          expiringMs: members.reduce((min, p) => {
            const t = p.expiresAt ? new Date(p.expiresAt).getTime() : 0
            if (!t) return min
            return min === 0 ? t : Math.min(min, t)
          }, 0),
          typesLabel: types.size > 1 ? 'mixed' : (types.values().next().value || '')
        }
      })
      if (fOwner)  list = list.filter((o) => (o.ownerId || '') === fOwner)
      if (fStatus) {
        // Treat the filter as an effectiveStatus filter so the UI can use
        // 'active' / 'expired' / 'deleted' tabs cleanly. 'paid' is kept as an
        // alias of 'active' for back-compat with existing query strings.
        const want = fStatus === 'paid' ? 'active' : fStatus
        list = list.filter((o) => o.effectiveStatus === want || o.status === fStatus)
      }
      if (fType)   list = list.filter((o) => String(o.type || '').toLowerCase() === fType.toLowerCase())
      if (fFrom)   list = list.filter((o) => (o.date || '') >= fFrom)
      if (fTo)     list = list.filter((o) => (o.date || '') <= fTo)
      if (fNodeId) list = list.filter((o) => o.nodeId === fNodeId)
      if (fZone)   list = list.filter((o) => (o.zone || '').toLowerCase().startsWith(fZone.toLowerCase()))
      return sendJson(res, 200, list)
    }
    // ── admin: SSE live connection stream ──
    // Long-lived response. Each closed relay pushes a "connection" event.
    // No auth via x-api-key header since EventSource can't set headers — the
    // route relies on session cookie / admin token via the standard gate.
    if (req.method === 'GET' && url.pathname === '/api/admin/connections/stream') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now(), subscribers: sseClients.size + 1 })}\n\n`)
      sseClients.add(res)
      const ka = setInterval(() => { try { res.write(': keepalive\n\n') } catch { /* noop */ } }, 25_000)
      req.on('close', () => { sseClients.delete(res); clearInterval(ka) })
      return
    }
    // ── admin: live connection insights ──
    // For each proxy belonging to a live (paid) order, return its current stats
    // plus top destination hosts + the last N connection records. Filters out
    // proxies whose order has been cancelled / refunded / has no real owner so
    // the dashboard never surfaces stale/seed data.
    if (req.method === 'GET' && url.pathname === '/api/admin/connections') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const orderById = new Map(orders.map((o) => [o.id, o]))
      const userById = new Map((config.users || []).map((u) => [u.id, u]))
      const nodeById = new Map((config.nodes || []).map((n) => [n.id, n]))
      // Resolve geo from in-memory cache only — cheap, never blocks. Cold
      // cache returns null; subsequent requests fill in as the background
      // enricher resolves new hosts/IPs.
      const enrichHost = (h) => { const g = geoMemory.get(h); return g && !g.failed ? { country: g.country, cc: g.countryCode } : null }
      const enrichHostByName = (host) => {
        const ip = (geoHostToIp.get(host) || {}).ip
        return ip ? enrichHost(ip) : null
      }
      const list = []
      for (const p of config.proxies) {
        const ord = p.orderId ? orderById.get(p.orderId) : null
        if (!ord || (ord.status !== 'paid' && ord.status !== 'active')) continue
        if (!ord.ownerId) continue
        const s = ensureStats(p.id)
        const top = []
        for (const [host, v] of s.topTargets) top.push({ host, count: v.count, bytesUp: v.bytesUp, bytesDown: v.bytesDown, lastTs: v.lastTs, geo: enrichHostByName(host) })
        top.sort((a, b) => (b.bytesUp + b.bytesDown) - (a.bytesUp + a.bytesDown))
        const user = userById.get(ord.ownerId)
        const node = nodeById.get(p.nodeId || 'local')
        const recent = (s.recentConns || []).slice(-30).reverse().map((c) => ({ ...c, srcGeo: c.src ? enrichHost(c.src) : null, hostGeo: enrichHostByName(c.host) }))
        list.push({
          proxyId: p.id,
          orderId: p.orderId,
          ownerEmail: user?.email || '',
          ownerId: ord.ownerId,
          nodeId: p.nodeId || 'local',
          nodeName: node?.name || (p.nodeId || 'local'),
          listenHost: node?.host || p.listenHost || '',
          port: p.port,
          // ip = customer-facing endpoint (v4 even for v6 proxies); bindIp = egress
          ip: customerFacingHost(p),
          bindIp: p.bindIp,
          type: p.type,
          zone: p.zone || p.region || '',
          status: p.status,
          active: s.activeConnections || 0,
          total: s.totalConnections || 0,
          uploadBytes: s.uploadBytes || 0,
          downloadBytes: s.downloadBytes || 0,
          monthBytes: s.monthBytes || 0,
          bpsIn: s.bpsIn || 0,
          bpsOut: s.bpsOut || 0,
          topTargets: top.slice(0, 20),
          recentConns: recent
        })
      }
      return sendJson(res, 200, list)
    }
    // ── admin: per-proxy/port bandwidth ranking over a rolling window ──
    // "Which port moved the most (or least) data in the last 1h / 24h / 30d?"
    // Summed from conn_events (authoritative per-connection bytes), joined in
    // JS to proxy/owner/node metadata. window = h1 | h24 | d30 (default h24).
    if (req.method === 'GET' && url.pathname === '/api/admin/bandwidth') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { window: 'h24', sinceMs: 0, totals: { up: 0, down: 0, conns: 0 }, proxies: [] })
      const winParam = url.searchParams.get('window') || 'h24'
      const winSecs = WINDOW_SECS[winParam] || WINDOW_SECS.h24
      const sinceMs = Date.now() - winSecs * 1000
      try {
        const rows = sqliteDb.prepare(`
          SELECT proxy_id,
            COALESCE(SUM(up), 0) AS up, COALESCE(SUM(dn), 0) AS dn,
            COUNT(*) AS conns, COUNT(DISTINCT src) AS srcCount, MAX(ts) AS lastTs
          FROM conn_events WHERE ts >= ?
          GROUP BY proxy_id ORDER BY (up + dn) DESC LIMIT 1000
        `).all(sinceMs)
        const proxyById = new Map(config.proxies.map((p) => [p.id, p]))
        const userById = new Map((config.users || []).map((u) => [u.id, u]))
        const nodeById = new Map((config.nodes || []).map((n) => [n.id, n]))
        let tUp = 0, tDn = 0, tConns = 0
        const list = rows.map((r) => {
          const p = proxyById.get(r.proxy_id)
          const node = p ? nodeById.get(p.nodeId || 'local') : null
          const owner = p && p.ownerId ? userById.get(p.ownerId) : null
          tUp += Number(r.up) || 0; tDn += Number(r.dn) || 0; tConns += Number(r.conns) || 0
          return {
            proxyId: r.proxy_id,
            exists: Boolean(p),
            port: p?.port || 0,
            ip: p ? customerFacingHost(p) : '',
            bindIp: p?.bindIp || '',
            type: p?.type || '',
            zone: p?.zone || p?.region || '',
            status: p?.status || 'deleted',
            ownerId: p?.ownerId || '',
            ownerEmail: owner?.email || '',
            nodeName: node?.name || (p?.nodeId || ''),
            up: Number(r.up) || 0,
            down: Number(r.dn) || 0,
            total: (Number(r.up) || 0) + (Number(r.dn) || 0),
            conns: Number(r.conns) || 0,
            srcCount: Number(r.srcCount) || 0,
            lastTs: Number(r.lastTs) || 0
          }
        })
        return sendJson(res, 200, { window: winParam, sinceMs, totals: { up: tUp, down: tDn, conns: tConns, proxyCount: list.length }, proxies: list })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    // ── admin: health snapshot + manual sweep trigger ──
    // Surfaces what the auto-healer is doing (current failers, per-node fail %,
    // recent rotations/replacements from audit) so admins don't have to grep
    // the audit table. POST /sweep runs runHealthSweep() on demand.
    if (req.method === 'GET' && url.pathname === '/api/admin/health') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const userById = new Map((config.users || []).map((u) => [u.id, u]))
      const nodeById = new Map((config.nodes || []).map((n) => [n.id, n]))
      const counters = { total: 0, active: 0, error: 0, expired: 0, replaced: 0, failing: 0, neverChecked: 0 }
      const perNodeMap = new Map()
      const failers = []
      for (const p of config.proxies) {
        counters.total += 1
        counters[p.status] = (counters[p.status] || 0) + 1
        if (!p.lastCheckedAt) counters.neverChecked += 1
        const fc = Number(p.checkFailCount) || 0
        if (fc > 0) counters.failing += 1
        const nid = p.nodeId || 'local'
        const ne = perNodeMap.get(nid) || { total: 0, failing: 0 }
        ne.total += 1; if (fc > 0) ne.failing += 1
        perNodeMap.set(nid, ne)
        if (fc > 0 || p.status === 'error') {
          failers.push({
            proxyId: p.id, port: p.port, type: p.type, status: p.status,
            ownerId: p.ownerId || '', ownerEmail: userById.get(p.ownerId)?.email || '',
            nodeId: nid, nodeName: nodeById.get(nid)?.name || nid,
            checkFailCount: fc, totalFails: Number(p.totalFails) || 0,
            autoFixCount: Number(p.autoFixCount) || 0,
            lastAutoFixAt: p.lastAutoFixAt || null,
            lastAutoFixAction: p.lastAutoFixAction || null,
            lastCheckedAt: p.lastCheckedAt || null,
            lastCheckOk: !!p.lastCheckOk,
            bindIp: p.bindIp || ''
          })
        }
      }
      const suspectPct = Number(config.healthCheck?.nodeSuspectPct) || 50
      const perNode = [...perNodeMap.entries()].map(([nid, e]) => ({
        nodeId: nid, nodeName: nodeById.get(nid)?.name || nid, host: nodeById.get(nid)?.host || '',
        total: e.total, failing: e.failing,
        failPct: e.total ? Math.round((e.failing / e.total) * 1000) / 10 : 0,
        suspect: e.total >= 10 && (e.failing * 100 / e.total) >= suspectPct
      })).sort((a, b) => b.failPct - a.failPct)
      failers.sort((a, b) => b.checkFailCount - a.checkFailCount)
      let recentFixes = []
      if (sqliteDb) {
        try {
          recentFixes = sqliteDb.prepare(`SELECT ts, actor, path, note FROM audit WHERE actor = 'auto-heal' ORDER BY id DESC LIMIT 100`).all()
        } catch { /* table may be young — leave empty */ }
      }
      return sendJson(res, 200, {
        settings: {
          autoHeal: config.features?.autoHeal !== false,
          autoReplace: config.features?.autoReplace !== false,
          maxAutoFixPerSweep: Number(config.healthCheck?.maxAutoFixPerSweep) || 30,
          autoFixCooldownMs: Number(config.healthCheck?.autoFixCooldownMs) || 3_600_000,
          nodeSuspectPct: suspectPct,
          sweepIntervalMs: 5 * 60 * 1000
        },
        counters,
        perNode,
        topFailers: failers.slice(0, 200),
        failerCount: failers.length,
        recentFixes
      })
    }
    // ── admin: centralized error log (panel, agent, sweep, watchdog) ──
    // Query: ?source=panel|agent|sweep|watchdog|auto-heal&level=error|warn|info
    //        &resolved=0|1&limit=N&since=ms
    if (req.method === 'GET' && url.pathname === '/api/admin/errors') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { errors: [], counters: {} })
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 1000)
      const source = url.searchParams.get('source') || ''
      const level = url.searchParams.get('level') || ''
      const resolved = url.searchParams.get('resolved')
      const sinceMs = Number(url.searchParams.get('since') || 0)
      const where = []; const args = []
      if (source) { where.push('source = ?'); args.push(source) }
      if (level)  { where.push('level = ?');  args.push(level) }
      if (resolved === '0' || resolved === '1') { where.push('resolved = ?'); args.push(Number(resolved)) }
      if (sinceMs > 0) { where.push('last_ts >= ?'); args.push(sinceMs) }
      const sql = `SELECT id, first_ts, last_ts, count, source, level, code, message, context, node_id AS nodeId, proxy_id AS proxyId, resolved, resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM errors ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_ts DESC LIMIT ${limit}`
      try {
        const rows = sqliteDb.prepare(sql).all(...args)
        // Counters: total unresolved, by source, by level.
        const cBySource = sqliteDb.prepare(`SELECT source, COUNT(*) AS n FROM errors WHERE resolved = 0 GROUP BY source`).all()
        const cByLevel  = sqliteDb.prepare(`SELECT level, COUNT(*) AS n FROM errors WHERE resolved = 0 GROUP BY level`).all()
        const tot = sqliteDb.prepare(`SELECT COUNT(*) AS n FROM errors WHERE resolved = 0`).get()
        return sendJson(res, 200, {
          errors: rows.map((r) => ({ ...r, context: r.context ? safeJsonParse(r.context) : null })),
          counters: {
            unresolved: Number(tot?.n) || 0,
            bySource: Object.fromEntries(cBySource.map((x) => [x.source, x.n])),
            byLevel: Object.fromEntries(cByLevel.map((x) => [x.level, x.n]))
          }
        })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    const errorResolve = url.pathname.match(/^\/api\/admin\/errors\/(\d+)\/resolve$/)
    if (errorResolve && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      try {
        sqliteDb.prepare(`UPDATE errors SET resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?`).run(Date.now(), actorOf(req) || 'admin', Number(errorResolve[1]))
        return sendJson(res, 200, { ok: true })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/errors/resolve-all') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      try {
        const r = sqliteDb.prepare(`UPDATE errors SET resolved = 1, resolved_at = ?, resolved_by = ? WHERE resolved = 0`).run(Date.now(), actorOf(req) || 'admin')
        return sendJson(res, 200, { ok: true, resolved: r.changes })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/health/sweep') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      // Don't await — sweep can probe thousands of proxies in parallel and we
      // don't want to block the HTTP response. Audit captures the outcome.
      const t0 = Date.now()
      runHealthSweep().catch((e) => console.warn('[auto-heal] manual sweep error:', e?.message))
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: 'manual health sweep triggered' })
      return sendJson(res, 202, { ok: true, triggered: true, ts: t0 })
    }

    // ── admin: per-node bandwidth time series (hourly buckets) ──
    const bwSeriesMatch = url.pathname.match(/^\/api\/admin\/nodes\/([^/]+)\/bandwidth-series$/)
    if (bwSeriesMatch && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { range: '24h', points: [] })
      const nid = bwSeriesMatch[1]
      const range = String(url.searchParams.get('range') || '24h')
      const HOURS = range === '7d' ? 168 : range === '30d' ? 720 : 24
      const sinceHour = new Date(Date.now() - HOURS * 3_600_000).toISOString().slice(0, 13)
      const proxyIds = config.proxies.filter((p) => (p.nodeId || 'local') === nid).map((p) => p.id)
      if (!proxyIds.length) return sendJson(res, 200, { range, points: [] })
      try {
        const ph = proxyIds.map(() => '?').join(',')
        const rows = sqliteDb.prepare(`
          SELECT hour, SUM(upload_bytes) AS up, SUM(download_bytes) AS dn
          FROM history WHERE proxy_id IN (${ph}) AND hour >= ?
          GROUP BY hour ORDER BY hour
        `).all(...proxyIds, sinceHour)
        return sendJson(res, 200, { range, hours: HOURS, points: rows.map((r) => ({ hour: r.hour, up: Number(r.up) || 0, down: Number(r.dn) || 0 })) })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }

    // ── admin: v6 pool utilization for a node ──
    const poolMatch = url.pathname.match(/^\/api\/admin\/nodes\/([^/]+)\/pool$/)
    if (poolMatch && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const nid = poolMatch[1]
      const node = nid === 'local' ? null : config.nodes.find((n) => n.id === nid)
      if (nid !== 'local' && !node) return sendJson(res, 404, { error: 'node not found' })
      const isV6 = (node?.family || (nid === 'local' ? 'ipv4' : 'ipv4')).toLowerCase() === 'ipv6'
      const proxiesOnNode = config.proxies.filter((p) => (p.nodeId || 'local') === nid && p.status !== 'expired')
      const ipv6 = node?.network?.ipv6 || []
      const ipv4 = node?.network?.ipv4 || []
      const prefixes = node?.network?.ipv6Prefixes || []
      const sixtyFourPrefix = (v6) => v6.split(':').slice(0, 4).join(':') + '::/64'
      const attached64 = new Set()
      for (const e of ipv6) attached64.add(sixtyFourPrefix(e.address || ''))
      const inUseBindIp = new Set(proxiesOnNode.map((p) => p.bindIp).filter(Boolean))
      const inUse64 = new Set([...inUseBindIp].map(sixtyFourPrefix))
      let capacityBits = 0; let capacityCidr = ''
      for (const p of prefixes) { const len = Number(p.prefixLen); if (len > 0 && (!capacityBits || len < capacityBits)) { capacityBits = len; capacityCidr = `${p.prefix}/${len}` } }
      const capacityHosts = capacityBits ? (capacityBits >= 128 ? 1 : Math.pow(2, 128 - capacityBits)) : 0
      return sendJson(res, 200, {
        family: isV6 ? 'ipv6' : 'ipv4',
        proxiesOnNode: proxiesOnNode.length,
        ipv4Attached: ipv4.length,
        ipv4InUse: [...inUseBindIp].filter((ip) => !ip.includes(':')).length,
        ipv6Attached: ipv6.length,
        ipv6InUse: [...inUseBindIp].filter((ip) => ip.includes(':')).length,
        distinct64Attached: attached64.size,
        distinct64InUse: inUse64.size,
        capacityCidr: capacityCidr || null,
        capacityHosts: Number.isFinite(capacityHosts) ? capacityHosts : 0,
        utilizationPctOfAttached: ipv6.length ? Math.round(([...inUseBindIp].filter((ip) => ip.includes(':')).length / ipv6.length) * 1000) / 10 : 0,
        prefixes
      })
    }

    // ── admin: per-owner drilldown on a node ──
    const ownerDrillMatch = url.pathname.match(/^\/api\/admin\/nodes\/([^/]+)\/owners\/([^/]+)$/)
    if (ownerDrillMatch && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const [, nid, oid] = ownerDrillMatch
      const ownerProxies = config.proxies.filter((p) => (p.nodeId || 'local') === nid && p.ownerId === oid)
      if (!ownerProxies.length) return sendJson(res, 404, { error: 'no proxies for this owner on this node' })
      const bytesByProxy = new Map()
      if (sqliteDb) {
        try {
          const cutoff = Date.now() - 30 * 86_400_000
          const ids = ownerProxies.map((p) => p.id)
          const ph = ids.map(() => '?').join(',')
          const rows = sqliteDb.prepare(`SELECT proxy_id, SUM(up) AS up, SUM(dn) AS dn FROM conn_events WHERE proxy_id IN (${ph}) AND ts >= ? GROUP BY proxy_id`).all(...ids, cutoff)
          for (const r of rows) bytesByProxy.set(r.proxy_id, { up: Number(r.up) || 0, down: Number(r.dn) || 0 })
        } catch { /* leave empty */ }
      }
      const user = config.users.find((u) => u.id === oid)
      const proxies = ownerProxies.map((p) => ({
        ...publicProxy(p),
        bytes30d: bytesByProxy.get(p.id) || { up: 0, down: 0 },
        autoFixCount: Number(p.autoFixCount) || 0,
        lastAutoFixAt: p.lastAutoFixAt || null,
        suspended: !!p.suspended
      })).sort((a, b) => (b.bytes30d.up + b.bytes30d.down) - (a.bytes30d.up + a.bytes30d.down))
      return sendJson(res, 200, {
        nodeId: nid,
        owner: user ? { id: user.id, email: user.email, name: user.name, suspended: !!user.suspended } : { id: oid },
        proxies
      })
    }

    // ── admin: side-by-side node comparison ──
    if (req.method === 'GET' && url.pathname === '/api/admin/nodes/compare') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const a = url.searchParams.get('a'), b = url.searchParams.get('b')
      if (!a || !b) return sendJson(res, 400, { error: 'a and b query params required' })
      function snapshot(nid) {
        const node = nid === 'local' ? null : config.nodes.find((n) => n.id === nid)
        if (nid !== 'local' && !node) return null
        const proxiesOnNode = config.proxies.filter((p) => (p.nodeId || 'local') === nid)
        const active = proxiesOnNode.filter((p) => p.status === 'active').length
        const failing = proxiesOnNode.filter((p) => (Number(p.checkFailCount) || 0) >= 3).length
        const ownerSet = new Set(proxiesOnNode.map((p) => p.ownerId).filter(Boolean))
        let bandwidth30d = { up: 0, down: 0 }
        if (sqliteDb && proxiesOnNode.length) {
          try {
            const cutoff = Date.now() - 30 * 86_400_000
            const ph = proxiesOnNode.map(() => '?').join(',')
            const r = sqliteDb.prepare(`SELECT COALESCE(SUM(up),0) up, COALESCE(SUM(dn),0) dn FROM conn_events WHERE proxy_id IN (${ph}) AND ts >= ?`).get(...proxiesOnNode.map((p) => p.id), cutoff)
            bandwidth30d = { up: Number(r.up) || 0, down: Number(r.dn) || 0 }
          } catch { /* leave zero */ }
        }
        return {
          id: nid, name: node?.name || nid, host: node?.host || '',
          status: node?.status || (nid === 'local' ? 'online' : 'unknown'),
          family: node?.family || 'auto',
          version: node?.version || '',
          metrics: node?.metrics || null,
          alerts: node?.alerts || {},
          proxies: { total: proxiesOnNode.length, active, expired: proxiesOnNode.filter((p) => p.status === 'expired').length, failing },
          owners: ownerSet.size,
          bandwidth30d
        }
      }
      return sendJson(res, 200, { a: snapshot(a), b: snapshot(b) })
    }

    // ── admin: aggregate metrics time series for the dashboard chart ──
    // range: 1h (minute granularity), 24h (5-minute), 7d (hour), 30d (hour),
    //        all (day, sourced from hourly history table).
    if (req.method === 'GET' && url.pathname === '/api/admin/metrics/timeseries') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const range = url.searchParams.get('range') || '1h'
      // Restrict to proxies of live, owner-attached, paid orders so historic
      // junk doesn't bleed into the chart.
      const orderById = new Map(orders.map((o) => [o.id, o]))
      const liveProxyIds = new Set(config.proxies.filter((p) => {
        const ord = p.orderId ? orderById.get(p.orderId) : null
        return ord && (ord.status === 'paid' || ord.status === 'active') && ord.ownerId
      }).map((p) => p.id))
      const now = Date.now()
      if (range === '1h') {
        const since = now - 60 * 60_000
        const points = trafficMinute.filter((p) => p.ts >= since).map((p) => ({ ts: p.ts, active: p.active, bpsIn: p.bpsIn, bpsOut: p.bpsOut }))
        return sendJson(res, 200, { range, granularity: 'minute', points })
      }
      if (range === '24h') {
        const since = now - 24 * 60 * 60_000
        const bucketMs = 5 * 60_000
        const buckets = new Map()
        for (const p of trafficMinute) {
          if (p.ts < since) continue
          const k = Math.floor(p.ts / bucketMs) * bucketMs
          let b = buckets.get(k)
          if (!b) { b = { ts: k, active: 0, bpsIn: 0, bpsOut: 0, n: 0 }; buckets.set(k, b) }
          b.active += p.active; b.bpsIn += p.bpsIn; b.bpsOut += p.bpsOut; b.n += 1
        }
        const points = [...buckets.values()].sort((a, b) => a.ts - b.ts).map((b) => ({ ts: b.ts, active: Math.round(b.active / b.n), bpsIn: Math.round(b.bpsIn / b.n), bpsOut: Math.round(b.bpsOut / b.n) }))
        return sendJson(res, 200, { range, granularity: '5min', points })
      }
      // 7d / 30d / all → aggregate the SQLite hourly history for live proxies.
      const sinceHourKey = (() => {
        if (range === '7d')  return new Date(now - 7 * 86400_000).toISOString().slice(0, 13)
        if (range === '30d') return new Date(now - 30 * 86400_000).toISOString().slice(0, 13)
        return '0000'
      })()
      const buckets = new Map() // hourKey -> { up, down, bpsIn, bpsOut }
      if (sqliteDb && liveProxyIds.size) {
        try {
          const idsList = [...liveProxyIds]
          const placeholders = idsList.map(() => '?').join(',')
          const rows = sqliteDb.prepare(`SELECT hour, SUM(upload_bytes) AS up, SUM(download_bytes) AS down, AVG(bps_in) AS bpsIn, AVG(bps_out) AS bpsOut FROM history WHERE proxy_id IN (${placeholders}) AND hour >= ? GROUP BY hour ORDER BY hour ASC`).all(...idsList, sinceHourKey)
          for (const r of rows) {
            buckets.set(r.hour, { ts: new Date(r.hour + ':00:00Z').getTime(), up: Number(r.up) || 0, down: Number(r.down) || 0, bpsIn: Math.round(Number(r.bpsIn) || 0), bpsOut: Math.round(Number(r.bpsOut) || 0) })
          }
        } catch { /* noop */ }
      }
      const points = [...buckets.values()].sort((a, b) => a.ts - b.ts)
      return sendJson(res, 200, { range, granularity: 'hour', points })
    }
    // ── admin: aggregate KPIs across all live-order proxies ──
    // One-shot snapshot for the dashboard hero — total bytes / month bytes /
    // active conns / total conns. Filters out non-live proxies.
    if (req.method === 'GET' && url.pathname === '/api/admin/metrics/summary') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const orderById = new Map(orders.map((o) => [o.id, o]))
      let proxies = 0, active = 0, conns = 0, total = 0, up = 0, down = 0, month = 0, bpsIn = 0, bpsOut = 0
      for (const p of config.proxies) {
        const ord = p.orderId ? orderById.get(p.orderId) : null
        if (!ord || (ord.status !== 'paid' && ord.status !== 'active') || !ord.ownerId) continue
        proxies += 1
        if (p.status === 'active') active += 1
        const s = ensureStats(p.id)
        conns += s.activeConnections || 0
        total += s.totalConnections || 0
        up += s.uploadBytes || 0
        down += s.downloadBytes || 0
        month += s.monthBytes || 0
        bpsIn += s.bpsIn || 0
        bpsOut += s.bpsOut || 0
      }
      return sendJson(res, 200, { proxies, active, liveConns: conns, totalConns: total, uploadBytes: up, downloadBytes: down, monthBytes: month, bpsIn, bpsOut })
    }
    // ── admin: flat session/event feed across ALL live-order proxies ──
    // FortiView-style: every closed relay is one row, joined with proxy info
    // and geo-enriched (cache-only). Filterable by host/src/kind/proxyId; the
    // default returns last 500 events from all proxies, newest first.
    if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { sessions: [], count: 0, total: 0, offset: 0, limit: 0 })
      const sinceMs = Date.now() - Number(url.searchParams.get('hours') || 24) * 3600_000
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 50)))
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
      const host = url.searchParams.get('host') || ''
      const src  = url.searchParams.get('src') || ''
      const kind = url.searchParams.get('kind') || ''
      const proxyIdF = url.searchParams.get('proxyId') || ''
      const where = ['ts >= ?']; const args = [sinceMs]
      if (host) { where.push('host LIKE ?'); args.push(`%${host.toLowerCase()}%`) }
      if (src)  { where.push('src = ?'); args.push(src) }
      if (kind) { where.push('kind = ?'); args.push(kind) }
      if (proxyIdF) { where.push('proxy_id = ?'); args.push(proxyIdF) }
      // Restrict to live (paid + owner-attached) proxies so wiped orders
      // don't leak into the session table.
      const orderById = new Map(orders.map((o) => [o.id, o]))
      const liveSet = new Set(config.proxies.filter((p) => {
        const o = p.orderId ? orderById.get(p.orderId) : null
        return o && (o.status === 'paid' || o.status === 'active') && o.ownerId
      }).map((p) => p.id))
      const liveIds = [...liveSet]
      if (!liveIds.length) return sendJson(res, 200, { sessions: [], count: 0, total: 0, offset, limit })
      // Add proxy_id IN (...) so the SQL itself excludes wiped proxies — this
      // makes COUNT(*) accurate without post-filter and lets pagination work.
      const inPlaceholders = liveIds.map(() => '?').join(',')
      where.push(`proxy_id IN (${inPlaceholders})`)
      args.push(...liveIds)
      try {
        const total = sqliteDb.prepare(`SELECT COUNT(*) AS n FROM conn_events WHERE ${where.join(' AND ')}`).get(...args).n
        const rows = sqliteDb.prepare(`SELECT id, ts, proxy_id AS proxyId, owner_id AS ownerId, src, src_port AS srcPort, host, port, up, dn AS down, ms, kind FROM conn_events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
        const userById = new Map((config.users || []).map((u) => [u.id, u]))
        const proxyById = new Map(config.proxies.map((p) => [p.id, p]))
        const sessions = rows
          .map((r) => {
            const p = proxyById.get(r.proxyId)
            const u = userById.get(r.ownerId)
            const srcG = r.src ? geoCacheLookup(r.src) : null
            const hostIp = (geoHostToIp.get(r.host) || {}).ip
            const hostG = hostIp ? geoCacheLookup(hostIp) : null
            if (r.src && !srcG) { Promise.resolve().then(() => lookupGeo(r.src)).catch(() => {}) }
            if (r.host && !hostG) { Promise.resolve().then(() => lookupGeoForHost(r.host)).catch(() => {}) }
            return {
              ...r,
              hostIp: hostIp || null,
              ownerEmail: u?.email || '',
              proxyBindIp: p?.bindIp || '',
              proxyPort: p?.port || 0,
              proxyType: p?.type || '',
              proxyZone: p?.zone || p?.region || '',
              srcGeo:  srcG  && !srcG.failed  ? { country: srcG.country,  cc: srcG.countryCode,  asn: srcG.asn, asnOrg: srcG.asnOrg } : null,
              hostGeo: hostG && !hostG.failed ? { country: hostG.country, cc: hostG.countryCode, asn: hostG.asn, asnOrg: hostG.asnOrg } : null
            }
          })
        return sendJson(res, 200, { sessions, count: sessions.length, total, offset, limit })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    // ── admin: deny-host list (block destination) ──
    // Global list lives at config.denyHosts. Patterns: exact "example.com" or
    // suffix ".example.com" (matches sub.example.com + example.com itself).
    // Per-proxy list is on proxy.denyHosts — managed via the proxy detail page.
    if (url.pathname === '/api/admin/deny-hosts') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (req.method === 'GET') return sendJson(res, 200, { hosts: config.denyHosts || [] })
      if (req.method === 'POST') {
        const body = await readJson(req)
        const host = String(body.host || '').trim().toLowerCase()
        if (!host) return sendJson(res, 400, { error: 'host required' })
        if (!Array.isArray(config.denyHosts)) config.denyHosts = []
        if (!config.denyHosts.includes(host)) config.denyHosts.push(host)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: '/api/admin/deny-hosts', note: `added ${host}` })
        return sendJson(res, 200, { hosts: config.denyHosts })
      }
      if (req.method === 'DELETE') {
        const host = String(url.searchParams.get('host') || '').trim().toLowerCase()
        if (!host) return sendJson(res, 400, { error: 'host required' })
        config.denyHosts = (config.denyHosts || []).filter((h) => h !== host)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: '/api/admin/deny-hosts', note: `removed ${host}` })
        return sendJson(res, 200, { hosts: config.denyHosts })
      }
    }
    // ── admin: spike/quota alerts (server-side derived) ──
    // Returns proxies whose: (a) monthly usage > 80% of quota, or (b) current
    // bpsIn+bpsOut > 5× the proxy's 7-day average (computed from history).
    // Dashboard polls this to show "anomaly" badges without a notification
    // table.
    if (req.method === 'GET' && url.pathname === '/api/admin/connections/alerts') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const orderById = new Map(orders.map((o) => [o.id, o]))
      const alerts = []
      for (const p of config.proxies) {
        const ord = p.orderId ? orderById.get(p.orderId) : null
        if (!ord || (ord.status !== 'paid' && ord.status !== 'active') || !ord.ownerId) continue
        const s = ensureStats(p.id)
        const quota = Number(p.monthlyQuotaBytes || config.proxyDefaults.monthlyQuotaBytes || 0)
        if (quota > 0 && s.monthBytes >= quota * 0.8) {
          alerts.push({ proxyId: p.id, kind: 'quota', severity: s.monthBytes >= quota ? 'error' : 'warn', message: `${p.id} đã dùng ${Math.round(s.monthBytes / quota * 100)}% quota tháng (${(s.monthBytes / 1e9).toFixed(2)}GB / ${(quota / 1e9).toFixed(2)}GB)` })
        }
        // 7-day avg bps from history
        if (sqliteDb && (s.bpsIn + s.bpsOut) > 0) {
          try {
            const sinceHour = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 13)
            const r = sqliteDb.prepare('SELECT AVG(bps_in) AS avgIn, AVG(bps_out) AS avgOut FROM history WHERE proxy_id = ? AND hour >= ?').get(p.id, sinceHour)
            const avg7 = (Number(r?.avgIn) || 0) + (Number(r?.avgOut) || 0)
            const now = s.bpsIn + s.bpsOut
            if (avg7 > 1024 && now > avg7 * 5) {
              alerts.push({ proxyId: p.id, kind: 'spike', severity: 'warn', message: `${p.id} bps đang spike (${Math.round(now / 1024)}KB/s vs avg ${Math.round(avg7 / 1024)}KB/s 7d)` })
            }
          } catch { /* ignore */ }
        }
      }
      return sendJson(res, 200, { alerts })
    }
    // ── admin: persistent connection history for one proxy ──
    // Filters: from/to (ms epoch), host (substring), src (exact IP), limit (≤500).
    // Returns ordered list newest first. Used by the drill-down page + admin
    // historical filtering UI.
    const adminConnHist = url.pathname.match(/^\/api\/admin\/connections\/([^/]+)\/events$/)
    if (adminConnHist && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { events: [], note: 'sqlite disabled' })
      const proxyId = adminConnHist[1]
      const from = Number(url.searchParams.get('from') || 0)
      const to = Number(url.searchParams.get('to') || Date.now())
      const host = url.searchParams.get('host') || ''
      const src = url.searchParams.get('src') || ''
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)))
      const where = ['proxy_id = ?']; const args = [proxyId]
      if (from) { where.push('ts >= ?'); args.push(from) }
      if (to)   { where.push('ts <= ?'); args.push(to) }
      if (host) { where.push('host LIKE ?'); args.push(`%${host.toLowerCase()}%`) }
      if (src)  { where.push('src = ?'); args.push(src) }
      const sql = `SELECT ts, src, host, port, up, dn, ms, kind FROM conn_events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`
      args.push(limit)
      try {
        const rows = sqliteDb.prepare(sql).all(...args)
        const enriched = rows.map((r) => {
          const srcG = r.src ? geoCacheLookup(r.src) : null
          const hostIp = (geoHostToIp.get(r.host) || {}).ip
          const hostG = hostIp ? geoCacheLookup(hostIp) : null
          return {
            ...r,
            srcGeo:  srcG  && !srcG.failed  ? { country: srcG.country,  cc: srcG.countryCode  } : null,
            hostGeo: hostG && !hostG.failed ? { country: hostG.country, cc: hostG.countryCode } : null
          }
        })
        return sendJson(res, 200, { proxyId, count: enriched.length, events: enriched })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    // ── admin: aggregate top destinations from SQLite (configurable window) ──
    const adminConnTopHosts = url.pathname.match(/^\/api\/admin\/connections\/([^/]+)\/top-hosts$/)
    if (adminConnTopHosts && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { hosts: [] })
      const proxyId = adminConnTopHosts[1]
      const sinceMs = Date.now() - Number(url.searchParams.get('hours') || 24) * 3600_000
      try {
        const rows = sqliteDb.prepare(`SELECT host, COUNT(*) AS count, SUM(up) AS bytesUp, SUM(dn) AS bytesDown, MAX(ts) AS lastTs FROM conn_events WHERE proxy_id = ? AND ts >= ? GROUP BY host ORDER BY (bytesUp + bytesDown) DESC LIMIT 50`).all(proxyId, sinceMs)
        const enriched = rows.map((r) => {
          const ip = (geoHostToIp.get(r.host) || {}).ip
          const g = ip ? geoCacheLookup(ip) : null
          if (!g) { Promise.resolve().then(() => lookupGeoForHost(r.host)).catch(() => {}) }
          return { ...r, geo: g && !g.failed ? { country: g.country, cc: g.countryCode, asn: g.asn, asnOrg: g.asnOrg } : null }
        })
        return sendJson(res, 200, { proxyId, hosts: enriched })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    // ── admin: aggregate by source IP across all live proxies ──
    // Returns "client IP → which proxies + how many conns + bytes". Anti-abuse
    // signal: same src using multiple ownerId proxies = shared account.
    if (req.method === 'GET' && url.pathname === '/api/admin/connections/by-source') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 200, { sources: [] })
      const sinceMs = Date.now() - Number(url.searchParams.get('hours') || 24) * 3600_000
      try {
        const rows = sqliteDb.prepare(`SELECT src, COUNT(*) AS count, COUNT(DISTINCT proxy_id) AS proxyCount, COUNT(DISTINCT owner_id) AS ownerCount, SUM(up) AS bytesUp, SUM(dn) AS bytesDown, MAX(ts) AS lastTs FROM conn_events WHERE src != '' AND ts >= ? GROUP BY src ORDER BY count DESC LIMIT 100`).all(sinceMs)
        // Synchronously enrich from cache, then trigger async fetch for any
        // misses so the next request has them populated.
        const enriched = rows.map((r) => {
          const g = geoCacheLookup(r.src)
          if (!g) { Promise.resolve().then(() => lookupGeo(r.src)).catch(() => {}) }
          return { ...r, geo: g && !g.failed ? { country: g.country, cc: g.countryCode, asn: g.asn, asnOrg: g.asnOrg } : null }
        })
        return sendJson(res, 200, { sources: enriched })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    // Per-order member proxies (admin) — for row expansion in orders list.
    const adminOrderMembers = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/members$/)
    if (adminOrderMembers && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const order = orders.find((o) => o.id === adminOrderMembers[1])
      if (!order) return sendJson(res, 404, { error: 'order not found' })
      const members = config.proxies
        .filter((p) => order.proxyIds.includes(p.id))
        .map(publicProxy)
      return sendJson(res, 200, { order, members })
    }
    const adminOrderCancel = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/cancel-refund$/)
    if (adminOrderCancel && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const order = orders.find((o) => o.id === adminOrderCancel[1])
      if (!order) return sendJson(res, 404, { error: 'order not found' })
      if (order.status === 'cancelled' || order.status === 'refunded') return sendJson(res, 409, { error: 'already cancelled' })
      const members = config.proxies.filter((p) => order.proxyIds.includes(p.id))
      let refund = 0
      const now = Date.now()
      if (!config.pricing) config.pricing = defaultPricing()
      migratePricingToHourly()
      for (const p of members) {
        const expMs = p.expiresAt ? new Date(p.expiresAt).getTime() : (p.expires ? new Date(p.expires + 'T23:59:59Z').getTime() : 0)
        if (expMs > now) {
          const hoursLeft = Math.max(0, Math.floor((expMs - now) / 3600_000))
          const perHour = (String(p.type).toLowerCase() === 'ipv6' ? config.pricing.ipv6 : config.pricing.ipv4)?.perHour || 0
          refund += hoursLeft * perHour
        }
        p.status = 'expired'
        if ((p.nodeId || 'local') === 'local') stopProxy(p.id)
      }
      order.status = 'cancelled'
      // Refund only the wallet-paid share (see customer cancel) — don't convert
      // scoped free-credit into withdrawable wallet cash.
      const totalVal = Number(order.amount) || 0
      const walletShare = order.walletCharge != null ? Number(order.walletCharge) : totalVal
      const refundWallet = totalVal > 0 ? Math.round(refund * walletShare / totalVal) : 0
      const creditRefund = totalVal > 0 ? Math.round(refund * (Number(order.creditApplied) || 0) / totalVal) : 0
      if (refundWallet > 0 && order.ownerId) recordBillingTx(order.ownerId, 'refund', refundWallet, `admin cancel ${order.id}`)
      if (creditRefund > 0) recreditGrant(order, creditRefund)
      await Promise.all([saveConfig(), saveOrders()])
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `cancel ${order.id} wallet+${refundWallet} credit+${creditRefund}` })
      return sendJson(res, 200, { ok: true, refund: refundWallet, creditRefund })
    }

    // â”€â”€ admin: composite user detail â”€â”€
    const userDetailMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/detail$/)
    if (userDetailMatch && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const u = config.users.find((x) => x.id === userDetailMatch[1])
      if (!u) return sendJson(res, 404, { error: 'user not found' })
      const userOrders = orders.filter((o) => o.ownerId === u.id)
      const userProxies = config.proxies.filter((p) => p.ownerId === u.id).map(publicProxy)
      let txs = []
      if (sqliteDb) try { txs = sqliteDb.prepare('SELECT ts, type, amount, balance_after AS balanceAfter, note FROM billing_tx WHERE user_id = ? ORDER BY ts DESC LIMIT 100').all(u.id) } catch {}
      return sendJson(res, 200, {
        account: {
          id: u.id, name: u.name, email: u.email, role: u.role,
          suspended: !!u.suspended, tosAcceptedAt: u.tosAcceptedAt,
          referralCode: u.referralCode, referredBy: u.referredBy,
          totpEnabled: !!(u.totp && u.totp.confirmed),
          emailVerified: !!u.emailVerified,
          require2FA: !!u.require2FA,
          notes: u.notes || '',
          tags: u.tags || [],
          forcePasswordChange: !!u.forcePasswordChange
        },
        balance: userBalance(u.id),
        creditGrants: (config.creditGrants || []).filter((g) => g.userId === u.id && Number(g.remaining) > 0).map((g) => ({ group: g.group, remaining: g.remaining, amount: g.amount, currency: g.currency, expiresAt: g.expiresAt || '', code: g.code })),
        orders: userOrders,
        proxies: userProxies,
        transactions: txs
      })
    }

    // â”€â”€ admin: suspend/unsuspend user â”€â”€
    const userSuspendMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/(suspend|unsuspend)$/)
    if (userSuspendMatch && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((x) => x.id === userSuspendMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      target.suspended = userSuspendMatch[2] === 'suspend'
      // revoke all sessions for that user immediately on suspend
      if (target.suspended) { for (const [tk, s] of sessions) if (s.userId === target.id) sessions.delete(tk) }
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: target.suspended ? 'suspended' : 'unsuspended' })
      return sendJson(res, 200, { ok: true, suspended: target.suspended })
    }

    // â”€â”€ admin: revenue stats â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/revenue') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const period = String(url.searchParams.get('period') || 'day').toLowerCase()
      if (!sqliteDb) return sendJson(res, 200, { period, series: [], total: 0, prevTotals: null })
      const since = new Date(Date.now() - 30 * 86400_000).toISOString()
      const prevSince = new Date(Date.now() - 60 * 86400_000).toISOString()
      try {
        // Sum purchase (negative) and renewal txs to compute gross revenue. Refunds subtract.
        const rows = sqliteDb.prepare(`
          SELECT substr(ts, 1, ?) AS bucket,
                 SUM(CASE WHEN type IN ('purchase','renewal') THEN -amount ELSE 0 END) AS gross,
                 SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS refunded,
                 SUM(CASE WHEN type = 'topup' THEN amount ELSE 0 END) AS topups
          FROM billing_tx WHERE ts >= ? GROUP BY bucket ORDER BY bucket
        `).all(period === 'month' ? 7 : (period === 'week' ? 10 : 10), since)
        // Compute totals across the entire window for KPIs
        const t = sqliteDb.prepare(`SELECT
          SUM(CASE WHEN type IN ('purchase','renewal') THEN -amount ELSE 0 END) AS gross,
          SUM(CASE WHEN type = 'topup' THEN amount ELSE 0 END) AS topups,
          SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS refunded,
          COUNT(DISTINCT user_id) AS payers
          FROM billing_tx WHERE ts >= ?`).get(since)
        // Previous 30d window for delta-% comparison on KPI cards.
        const tPrev = sqliteDb.prepare(`SELECT
          SUM(CASE WHEN type IN ('purchase','renewal') THEN -amount ELSE 0 END) AS gross,
          SUM(CASE WHEN type = 'topup' THEN amount ELSE 0 END) AS topups,
          SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS refunded,
          COUNT(DISTINCT user_id) AS payers
          FROM billing_tx WHERE ts >= ? AND ts < ?`).get(prevSince, since)
        return sendJson(res, 200, { period, since, series: rows, totals: t, prevTotals: tPrev })
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }

    // â”€â”€ admin: revenue breakdown â€” by proxy type + by hour-of-day â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/revenue/breakdown') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const since = Date.now() - 30 * 86400_000
      // By proxy type â€” totals from in-memory orders (config.orders)
      let ipv4Total = 0, ipv6Total = 0
      const hourly = new Array(24).fill(0)
      for (const o of config.orders || []) {
        const t = new Date(o.createdAt).getTime()
        if (!Number.isFinite(t) || t < since) continue
        const amount = Number(o.totalCost || 0)
        if (String(o.type || 'IPv4').toLowerCase() === 'ipv6') ipv6Total += amount
        else ipv4Total += amount
        hourly[new Date(t).getUTCHours()] += amount
      }
      return sendJson(res, 200, {
        byType: { ipv4: ipv4Total, ipv6: ipv6Total },
        byHour: hourly,
        sinceISO: new Date(since).toISOString()
      })
    }

    // â”€â”€ admin: email templates (simple keyâ†'{subject,html} store) â”€â”€
    if (url.pathname === '/api/admin/email-templates') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.emailTemplates) config.emailTemplates = defaultEmailTemplates()
      if (req.method === 'GET') return sendJson(res, 200, config.emailTemplates)
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        for (const [k, v] of Object.entries(body)) {
          if (typeof v !== 'object' || !v) continue
          config.emailTemplates[k] = {
            subject: String(v.subject || '').slice(0, 200),
            html: String(v.html || '').slice(0, 50_000)
          }
        }
        await saveConfig()
        return sendJson(res, 200, config.emailTemplates)
      }
    }

    // â”€â”€ admin: free-credit promo codes (scoped, expiring) â”€â”€
    // ── admin: free-credit promo codes CRUD ──
    // Redeeming a credit code creates a SCOPED grant: spendable only on the code's
    // productGroup (all|ipv4|ipv6|hub) and only until validUntil. Grants are consumed
    // automatically at checkout (before the wallet). The old %-discount coupon
    // system was removed.
    const CREDIT_GROUPS = ['all', 'ipv4', 'ipv6', 'hub']
    if (url.pathname === '/api/admin/credit-codes') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.creditCodes) config.creditCodes = []
      if (req.method === 'GET') return sendJson(res, 200, config.creditCodes)
      if (req.method === 'POST') {
        const body = await readJson(req)
        const code = String(body.code || '').toUpperCase().trim()
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return sendJson(res, 400, { error: 'code must be 3-32 chars: A-Z 0-9 _ -' })
        if (config.creditCodes.find((c) => c.code === code)) return sendJson(res, 409, { error: 'code exists' })
        const amount = Math.round(Number(body.amount) || 0)
        if (amount <= 0) return sendJson(res, 400, { error: 'amount must be > 0' })
        const cc = {
          code,
          amount,
          currency: (config.pricing?.currency || 'VND').toUpperCase(),
          productGroup: CREDIT_GROUPS.includes(String(body.productGroup)) ? body.productGroup : 'all',
          validUntil: typeof body.validUntil === 'string' ? body.validUntil : '',
          usageLimit: Math.max(0, Number(body.usageLimit) || 0),
          note: String(body.note || '').slice(0, 200),
          enabled: body.enabled !== false,
          redeemedBy: [],
          createdAt: new Date().toISOString()
        }
        config.creditCodes.push(cc)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: '/api/admin/credit-codes', note: `create ${code} +${amount} ${cc.currency} group=${cc.productGroup}` })
        return sendJson(res, 201, cc)
      }
    }
    // Batch-generate N unique credit codes for a campaign
    if (url.pathname === '/api/admin/credit-codes/batch' && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.creditCodes) config.creditCodes = []
      const body = await readJson(req)
      const count = Math.max(1, Math.min(500, Number(body.count) || 1))
      const amount = Math.round(Number(body.amount) || 0)
      if (amount <= 0) return sendJson(res, 400, { error: 'amount must be > 0' })
      const group = CREDIT_GROUPS.includes(String(body.productGroup)) ? body.productGroup : 'all'
      const prefix = (String(body.prefix || 'PROMO').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12)) || 'PROMO'
      const made = []
      for (let i = 0; i < count; i++) {
        let code, tries = 0
        do { code = `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; tries++ } while (config.creditCodes.find((c) => c.code === code) && tries < 6)
        config.creditCodes.push({ code, amount, currency: (config.pricing?.currency || 'VND').toUpperCase(), productGroup: group, validUntil: typeof body.validUntil === 'string' ? body.validUntil : '', usageLimit: Math.max(1, Number(body.usageLimit) || 1), note: String(body.note || '').slice(0, 200), enabled: true, redeemedBy: [], createdAt: new Date().toISOString() })
        made.push(code)
      }
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `batch ${made.length} x ${amount} ${group}` })
      return sendJson(res, 201, { created: made.length, codes: made })
    }
    // Export all credit codes as CSV
    if (url.pathname === '/api/admin/credit-codes/export' && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const rows = [['code', 'amount', 'currency', 'group', 'validUntil', 'usageLimit', 'redeemed', 'enabled']]
      for (const c of (config.creditCodes || [])) rows.push([c.code, c.amount, c.currency, c.productGroup, c.validUntil || '', c.usageLimit || 0, (c.redeemedBy || []).length, c.enabled !== false])
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="credit-codes.csv"' })
      return res.end(rows.map((r) => r.join(',')).join('\n'))
    }
    // Per-code usage analytics (redeemed count + granted/spent/remaining)
    const ccAnalytics = url.pathname.match(/^\/api\/admin\/credit-codes\/([A-Z0-9_-]+)\/analytics$/)
    if (ccAnalytics && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const cc = (config.creditCodes || []).find((c) => c.code === ccAnalytics[1])
      if (!cc) return sendJson(res, 404, { error: 'not found' })
      const gs = (config.creditGrants || []).filter((g) => g.code === cc.code)
      const granted = gs.reduce((s, g) => s + Number(g.amount || 0), 0)
      const remaining = gs.reduce((s, g) => s + Number(g.remaining || 0), 0)
      return sendJson(res, 200, { code: cc.code, amount: cc.amount, group: cc.productGroup, validUntil: cc.validUntil || '', usageLimit: cc.usageLimit || 0, redeemed: (cc.redeemedBy || []).length, granted, spent: granted - remaining, remaining })
    }
    // Gift scoped credit directly to a user (no code) — support / compensation
    const grantCreditMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/grant-credit$/)
    if (grantCreditMatch && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === grantCreditMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const body = await readJson(req)
      const amount = Math.round(Number(body.amount) || 0)
      if (amount <= 0) return sendJson(res, 400, { error: 'amount must be > 0' })
      const group = CREDIT_GROUPS.includes(String(body.productGroup)) ? body.productGroup : 'all'
      if (!Array.isArray(config.creditGrants)) config.creditGrants = []
      const grant = { id: `GR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, userId: target.id, group, amount, remaining: amount, currency: (config.pricing?.currency || 'VND').toUpperCase(), expiresAt: typeof body.validUntil === 'string' ? body.validUntil : '', code: 'admin-gift', createdAt: new Date().toISOString() }
      config.creditGrants.push(grant)
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `gift ${amount} ${group} to ${target.email} exp=${grant.expiresAt || 'never'}` })
      pushNotification(target.id, { type: 'billing', severity: 'success', text: `Bạn được tặng ${amount.toLocaleString()} ${grant.currency} credit (${group === 'all' ? 'mọi sản phẩm' : group.toUpperCase()})${grant.expiresAt ? `, hạn ${grant.expiresAt}` : ''}`, link: '/billing' })
      return sendJson(res, 201, grant)
    }
    const creditCodeMatch = url.pathname.match(/^\/api\/admin\/credit-codes\/([A-Z0-9_-]+)$/)
    if (creditCodeMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const idx = (config.creditCodes || []).findIndex((c) => c.code === creditCodeMatch[1])
      if (idx === -1) return sendJson(res, 404, { error: 'not found' })
      if (req.method === 'DELETE') {
        config.creditCodes.splice(idx, 1); await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: `/api/admin/credit-codes/${creditCodeMatch[1]}`, note: 'deleted' })
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const c = config.creditCodes[idx]
        if (body.amount !== undefined) { const a = Math.round(Number(body.amount) || 0); if (a > 0) c.amount = a }
        if (typeof body.validUntil === 'string') c.validUntil = body.validUntil
        if (body.usageLimit !== undefined) c.usageLimit = Math.max(0, Number(body.usageLimit) || 0)
        if (CREDIT_GROUPS.includes(String(body.productGroup))) c.productGroup = body.productGroup
        if (typeof body.note === 'string') c.note = body.note.slice(0, 200)
        if (typeof body.enabled === 'boolean') c.enabled = body.enabled
        await saveConfig()
        return sendJson(res, 200, c)
      }
    }

    // â”€â”€ admin: users management (list, promote, credit, suspend) â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const rows = config.users.map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role || 'admin',
        referralCode: u.referralCode || '', referredBy: u.referredBy || null,
        balance: userBalance(u.id),
        ownedProxies: config.proxies.filter((p) => p.ownerId === u.id).length,
        totpEnabled: !!(u.totp && u.totp.confirmed),
        emailVerified: !!u.emailVerified,
        require2FA: !!u.require2FA,
        suspended: !!u.suspended,
        notes: u.notes || '',
        tags: u.tags || [],
        tosAcceptedAt: u.tosAcceptedAt || null
      }))
      return sendJson(res, 200, rows)
    }
    const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
    if (userMatch && req.method === 'PATCH') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === userMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const body = await readJson(req)
      if (typeof body.role === 'string' && ['customer', 'admin'].includes(body.role)) {
        // Block self-demote (admin yanking their own admin rights → lockout)
        // and block demoting the LAST admin (would leave nobody able to admin).
        const callerSession = sessionFromRequest(req)
        if (body.role === 'customer' && (target.role || 'admin') !== 'customer') {
          if (callerSession && callerSession.userId === target.id) {
            return sendJson(res, 400, { error: 'cannot demote yourself — ask another admin' })
          }
          const remainingAdmins = config.users.filter((u) =>
            u.id !== target.id && (u.role || 'admin') !== 'customer'
          ).length
          if (remainingAdmins === 0) {
            return sendJson(res, 400, { error: 'cannot demote the last admin' })
          }
        }
        target.role = body.role
      }
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `role=${target.role}` })
      return sendJson(res, 200, { id: target.id, role: target.role })
    }
    if (userMatch && req.method === 'DELETE') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === userMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const session = sessionFromRequest(req)
      if (session && session.userId === target.id) return sendJson(res, 409, { error: 'cannot delete yourself' })
      const remainingAdmins = config.users.filter((u) => u.id !== target.id && (u.role || 'admin') !== 'customer').length
      if (remainingAdmins < 1) return sendJson(res, 409, { error: 'cannot delete the last admin' })
      const force = url.searchParams.get('force') === '1'
      const ownedProxies = config.proxies.filter((p) => p.ownerId === target.id)
      const ownedOrders = orders.filter((o) => o.ownerId === target.id)
      if (!force && (ownedProxies.length > 0 || ownedOrders.length > 0)) {
        return sendJson(res, 409, { error: 'user has data', proxies: ownedProxies.length, orders: ownedOrders.length, hint: 'pass ?force=1 to cascade-delete' })
      }
      for (const p of ownedProxies) { if ((p.nodeId || 'local') === 'local') stopProxy(p.id) }
      const proxyIdSet = new Set(ownedProxies.map((p) => p.id))
      config.proxies = config.proxies.filter((p) => !proxyIdSet.has(p.id))
      const orderIdSet = new Set(ownedOrders.map((o) => o.id))
      orders = orders.filter((o) => !orderIdSet.has(o.id))
      for (const [tk, s] of sessions) if (s.userId === target.id) sessions.delete(tk)
      if (sqliteDb) try { sqliteDb.prepare('DELETE FROM billing_tx WHERE user_id = ?').run(target.id) } catch {}
      const targetEmail = target.email
      config.users = config.users.filter((u) => u.id !== target.id)
      await Promise.all([saveConfig(), saveOrders()])
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `deleted ${targetEmail} (proxies=${ownedProxies.length} orders=${ownedOrders.length})` })
      return sendJson(res, 200, { ok: true, deleted: target.id, proxies: ownedProxies.length, orders: ownedOrders.length })
    }
    const userCredit = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/credit$/)
    if (userCredit && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === userCredit[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const body = await readJson(req)
      const amount = Math.floor(Number(body.amount) || 0)
      if (!amount) return sendJson(res, 400, { error: 'amount required' })
      const next = recordBillingTx(target.id, amount > 0 ? 'admin-credit' : 'admin-debit', amount, String(body.note || 'admin adjustment').slice(0, 200))
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `${target.email} ${amount > 0 ? '+' : ''}${amount} â†' ${next}` })
      return sendJson(res, 200, { balance: next })
    }

    // â”€â”€ admin: pricing CRUD â€” HOURLY model only (admin cáº¥p cÃ´ng ko bÃ¡n gÃ³i ngÃ y) â”€â”€
    if (url.pathname === '/api/admin/pricing') {
      if (!config.pricing) config.pricing = defaultPricing()
      migratePricingToHourly()
      if (req.method === 'GET') return sendJson(res, 200, config.pricing)
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (body.ipv4 && Number(body.ipv4.perHour) >= 0) config.pricing.ipv4.perHour = Math.floor(Number(body.ipv4.perHour))
        if (body.ipv6 && Number(body.ipv6.perHour) >= 0) config.pricing.ipv6.perHour = Math.floor(Number(body.ipv6.perHour))
        if (typeof body.currency === 'string') config.pricing.currency = body.currency.toLowerCase().slice(0, 8)
        if (Number(body.minHours) > 0) config.pricing.minHours = Math.floor(Number(body.minHours))
        if (Number(body.maxHours) > 0) config.pricing.maxHours = Math.floor(Number(body.maxHours))
        if (Array.isArray(body.tiers)) config.pricing.tiers = body.tiers
        if (body.bandwidthQuotaGB !== undefined) config.pricing.bandwidthQuotaGB = Math.max(0, Number(body.bandwidthQuotaGB) || 0)
        await saveConfig()
        return sendJson(res, 200, config.pricing)
      }
    }

    // â”€â”€ admin: zones CRUD â€” defines which geographic locations are bookable â”€â”€
    if (url.pathname === '/api/admin/zones') {
      if (!config.zones) config.zones = defaultZones()
      if (req.method === 'GET') return sendJson(res, 200, config.zones)
      if (req.method === 'POST') {
        const body = await readJson(req)
        const id = String(body.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
        if (!id || config.zones.find((z) => z.id === id)) return sendJson(res, 400, { error: 'id invalid or exists' })
        config.zones.push({ id, name: String(body.name || id).slice(0, 64), flag: String(body.flag || '').slice(0, 8), timezone: String(body.timezone || 'UTC').slice(0, 64) })
        await saveConfig()
        return sendJson(res, 201, config.zones)
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        if (Array.isArray(body.zones)) config.zones = body.zones.map((z) => ({ id: String(z.id || '').toLowerCase().slice(0, 32), name: String(z.name || '').slice(0, 64), flag: String(z.flag || '').slice(0, 8), timezone: String(z.timezone || 'UTC').slice(0, 64) })).filter((z) => z.id)
        await saveConfig()
        return sendJson(res, 200, config.zones)
      }
    }
    const zoneDel = url.pathname.match(/^\/api\/admin\/zones\/([a-z0-9-]+)$/)
    if (zoneDel && req.method === 'DELETE') {
      const idx = (config.zones || []).findIndex((z) => z.id === zoneDel[1])
      if (idx === -1) return sendJson(res, 404, { error: 'not found' })
      config.zones.splice(idx, 1)
      await saveConfig()
      return sendJson(res, 200, { ok: true })
    }

    // â”€â”€ admin: reset all stats (zero counters; useful before a benchmark run) â”€â”€
    if (req.method === 'POST' && url.pathname === '/api/admin/reset-stats') {
      let n = 0
      const isoNow = new Date().toISOString()
      for (const id of stats.keys()) {
        stats.set(id, { uploadBytes: 0, downloadBytes: 0, activeConnections: 0, totalConnections: 0, monthKey: isoNow.slice(0, 7), monthBytes: 0, secKey: 0, secBytes: 0, bpsIn: 0, bpsOut: 0, histLastUp: 0, histLastDown: 0, lastResetAt: isoNow })
        n += 1
      }
      orderBuckets.clear()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `reset ${n} stat rows` })
      return sendJson(res, 200, { ok: true, reset: n })
    }

    // â”€â”€ admin: configure alert webhook (Telegram / Slack-compatible JSON POST) â”€â”€
    if (url.pathname === '/api/admin/alerts/webhook') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin role required' })
      if (req.method === 'GET') return sendJson(res, 200, { url: config.alerts?.webhookUrl || '', enabled: Boolean(config.alerts?.webhookUrl) })
      if (req.method === 'POST') {
        const body = await readJson(req)
        const next = String(body.url || '').trim()
        // SECURITY: admin alert webhook also goes through SSRF filter to prevent
        // a compromised admin session from pivoting back into the local network.
        if (next && !(await isSafeOutboundUrl(next))) {
          return sendJson(res, 400, { error: 'webhook URL must be public http(s)' })
        }
        config.alerts = config.alerts || {}
        config.alerts.webhookUrl = next
        await saveConfig()
        return sendJson(res, 200, { ok: true, url: next })
      }
      if (req.method === 'DELETE') {
        if (config.alerts) delete config.alerts.webhookUrl
        await saveConfig()
        return sendJson(res, 200, { ok: true })
      }
    }

    // â”€â”€ admin: tail audit log (?lines=200 &actor= &path= &ip= &since=ISO) â”€â”€
    // ── OSS download stats ────────────────────────────────────────────
    // Counts hits on /install-panel.sh + agent claim endpoints. Used by
    // the /admin/downloads page to show community uptake. Returns:
    //   • totals (lifetime, 24h, 7d, 30d)
    //   • byKind aggregation
    //   • daily timeseries last 30 days
    //   • recent N rows (IP-masked for privacy in screenshots)
    if (req.method === 'GET' && url.pathname === '/api/admin/downloads/stats') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!sqliteDb) return sendJson(res, 503, { error: 'SQLite unavailable' })
      const now = Date.now()
      const day = 86_400_000
      const since = (d) => now - d * day
      try {
        const total      = sqliteDb.prepare('SELECT COUNT(*) AS c FROM oss_downloads').get()?.c || 0
        const total24h   = sqliteDb.prepare('SELECT COUNT(*) AS c FROM oss_downloads WHERE ts > ?').get(since(1))?.c || 0
        const total7d    = sqliteDb.prepare('SELECT COUNT(*) AS c FROM oss_downloads WHERE ts > ?').get(since(7))?.c || 0
        const total30d   = sqliteDb.prepare('SELECT COUNT(*) AS c FROM oss_downloads WHERE ts > ?').get(since(30))?.c || 0
        const uniqIp24h  = sqliteDb.prepare('SELECT COUNT(DISTINCT ip) AS c FROM oss_downloads WHERE ts > ?').get(since(1))?.c || 0
        const uniqIp7d   = sqliteDb.prepare('SELECT COUNT(DISTINCT ip) AS c FROM oss_downloads WHERE ts > ?').get(since(7))?.c || 0
        const uniqIpAll  = sqliteDb.prepare('SELECT COUNT(DISTINCT ip) AS c FROM oss_downloads').get()?.c || 0
        const byKind     = sqliteDb.prepare('SELECT kind, COUNT(*) AS c FROM oss_downloads GROUP BY kind ORDER BY c DESC').all()
        const byKindUniq = sqliteDb.prepare('SELECT kind, COUNT(DISTINCT ip) AS c FROM oss_downloads GROUP BY kind').all()
        // Daily counts last 30 days — fill missing days with 0 client-side.
        const daily = sqliteDb.prepare(`
          SELECT DATE(ts/1000, 'unixepoch') AS day, COUNT(*) AS c
          FROM oss_downloads WHERE ts > ?
          GROUP BY day ORDER BY day
        `).all(since(30))
        const recent = sqliteDb.prepare(`
          SELECT ts, kind, ip, ua, referer FROM oss_downloads
          ORDER BY id DESC LIMIT 100
        `).all()
        // Mask the last octet of IPv4 / last 64 bits of IPv6 so screenshots
        // can be shared without leaking customer egress identities.
        const maskIp = (ip) => {
          if (!ip) return ''
          if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::*'
          const parts = ip.split('.')
          if (parts.length === 4) { parts[3] = '*'; return parts.join('.') }
          return ip
        }
        return sendJson(res, 200, {
          totals: { lifetime: total, last24h: total24h, last7d: total7d, last30d: total30d, uniqIp24h, uniqIp7d, uniqIpAll },
          byKind: byKind.map((r) => ({ kind: r.kind, count: r.c })),
          byKindUniq: byKindUniq.map((r) => ({ kind: r.kind, uniqIps: r.c })),
          daily,
          recent: recent.map((r) => ({ ts: r.ts, kind: r.kind, ip: maskIp(r.ip), ua: r.ua, referer: r.referer }))
        })
      } catch (e) { return sendJson(res, 500, { error: `stats query failed: ${e.message}` }) }
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin role required' })
      const fActor = url.searchParams.get('actor') || ''
      const fPath = url.searchParams.get('path') || ''
      const fIp = url.searchParams.get('ip') || ''
      const fSince = url.searchParams.get('since') || ''
      const n = Math.min(Math.max(Number(url.searchParams.get('lines') || 200), 1), 5000)
      // SQLite fast path: indexed where + limit, much faster than re-parsing JSONL.
      if (sqliteDb) {
        try {
          const wh = []; const args = []
          if (fActor) { wh.push('actor LIKE ?'); args.push(`%${fActor}%`) }
          if (fPath)  { wh.push('path  LIKE ?'); args.push(`%${fPath}%`)  }
          if (fIp)    { wh.push('ip    LIKE ?'); args.push(`%${fIp}%`)    }
          if (fSince) { wh.push('ts >= ?');      args.push(fSince) }
          const sql = `SELECT ts, actor, ip, method, path, status, note FROM audit ${wh.length ? 'WHERE ' + wh.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
          const rows = sqliteDb.prepare(sql).all(...args, n).reverse()
          return sendJson(res, 200, { lines: rows.length, entries: rows, source: 'sqlite' })
        } catch (e) { /* fall through to JSONL */ }
      }
      try {
        const raw = await fs.readFile(auditPath, 'utf8')
        const lines = raw.split('\n').filter(Boolean)
        let entries = lines.map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
        if (fActor) entries = entries.filter((e) => String(e.actor || '').includes(fActor))
        if (fPath)  entries = entries.filter((e) => String(e.path || '').includes(fPath))
        if (fIp)    entries = entries.filter((e) => String(e.ip || '').includes(fIp))
        if (fSince) entries = entries.filter((e) => String(e.ts || '') >= fSince)
        entries = entries.slice(-n)
        return sendJson(res, 200, { lines: entries.length, entries, source: 'jsonl' })
      } catch (e) {
        if (e.code === 'ENOENT') return sendJson(res, 200, { lines: 0, entries: [] })
        return sendJson(res, 500, { error: e.message })
      }
    }

    // â”€â”€ admin: announcements (broadcast banners) â€” CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === '/api/admin/announcements') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin role required' })
      if (!config.announcements) config.announcements = []
      if (req.method === 'GET') return sendJson(res, 200, config.announcements)
      if (req.method === 'POST') {
        const body = await readJson(req)
        if (!body.text || !String(body.text).trim()) return sendJson(res, 400, { error: 'text is required' })
        const sev = ['info', 'warning', 'error', 'success'].includes(body.severity) ? body.severity : 'info'
        const ann = {
          id: 'a-' + crypto.randomBytes(4).toString('hex'),
          text: String(body.text).trim().slice(0, 600),
          severity: sev,
          createdAt: new Date().toISOString(),
          expiresAt: body.expiresAt || null,
          visibility: ['public', 'customer', 'admin'].includes(body.visibility) ? body.visibility : 'public',
          dismissible: body.dismissible !== false
        }
        config.announcements.unshift(ann)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `announcement ${ann.id}` })
        return sendJson(res, 201, ann)
      }
    }
    const annMatch = url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/)
    if (annMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin role required' })
      if (!config.announcements) config.announcements = []
      const idx = config.announcements.findIndex((a) => a.id === annMatch[1])
      if (idx === -1) return sendJson(res, 404, { error: 'announcement not found' })
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const cur = config.announcements[idx]
        if (typeof body.text === 'string')        cur.text = body.text.trim().slice(0, 600)
        if (typeof body.severity === 'string' && ['info', 'warning', 'error', 'success'].includes(body.severity)) cur.severity = body.severity
        if (typeof body.visibility === 'string' && ['public', 'customer', 'admin'].includes(body.visibility)) cur.visibility = body.visibility
        if (body.expiresAt !== undefined)         cur.expiresAt = body.expiresAt || null
        if (typeof body.dismissible === 'boolean') cur.dismissible = body.dismissible
        await saveConfig()
        return sendJson(res, 200, cur)
      }
      if (req.method === 'DELETE') {
        const removed = config.announcements.splice(idx, 1)[0]
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `removed ${removed.id}` })
        return sendJson(res, 200, { ok: true, id: removed.id })
      }
    }

    // â”€â”€ admin: docs / help articles CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === '/api/admin/docs') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.docs || !config.docs.length) config.docs = mergeDocsEn(defaultDocs())
    else mergeDocsEn(config.docs)
      if (req.method === 'GET') return sendJson(res, 200, config.docs)
      if (req.method === 'POST') {
        const body = await readJson(req)
        const title = String(body.title || '').trim()
        if (!title) return sendJson(res, 400, { error: 'title required' })
        const slug = (String(body.slug || '').trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 80)
        if (config.docs.some((d) => d.slug === slug)) return sendJson(res, 409, { error: 'slug exists' })
        const doc = {
          id: 'd-' + crypto.randomBytes(4).toString('hex'),
          slug,
          title: title.slice(0, 200),
          category: String(body.category || 'KhÃ¡c').slice(0, 60),
          order: Number(body.order) || 99,
          published: body.published !== false,
          body: String(body.body || '').slice(0, 50_000),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        config.docs.push(doc)
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `doc created ${doc.slug}` })
        return sendJson(res, 201, doc)
      }
    }
    const docMatch = url.pathname.match(/^\/api\/admin\/docs\/([^/]+)$/)
    if (docMatch) {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.docs || !config.docs.length) config.docs = mergeDocsEn(defaultDocs())
    else mergeDocsEn(config.docs)
      const idx = config.docs.findIndex((d) => d.id === docMatch[1])
      if (idx === -1) return sendJson(res, 404, { error: 'doc not found' })
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        const cur = config.docs[idx]
        if (typeof body.title === 'string')    cur.title = body.title.trim().slice(0, 200)
        if (typeof body.slug === 'string')     cur.slug = body.slug.trim().slice(0, 80)
        if (typeof body.category === 'string') cur.category = body.category.trim().slice(0, 60)
        if (typeof body.body === 'string')     cur.body = body.body.slice(0, 50_000)
        if (body.order !== undefined)          cur.order = Number(body.order) || 0
        if (typeof body.published === 'boolean') cur.published = body.published
        cur.updatedAt = new Date().toISOString()
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `doc updated ${cur.slug}` })
        return sendJson(res, 200, cur)
      }
      if (req.method === 'DELETE') {
        const removed = config.docs.splice(idx, 1)[0]
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `doc deleted ${removed.slug}` })
        return sendJson(res, 200, { ok: true, id: removed.id })
      }
    }

    // â”€â”€ admin: list/revoke active sessions for a user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const sessMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/)
    if (sessMatch && req.method === 'GET') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === sessMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const rows = []
      for (const [tk, s] of sessions) {
        if (s.userId === target.id) rows.push({ token: tk.slice(0, 8) + '...', expiresAt: new Date(s.expiresAt).toISOString() })
      }
      return sendJson(res, 200, rows)
    }
    if (sessMatch && req.method === 'DELETE') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === sessMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      let n = 0
      for (const [tk, s] of sessions) if (s.userId === target.id) { sessions.delete(tk); n += 1 }
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `revoked ${n} sessions` })
      return sendJson(res, 200, { ok: true, revoked: n })
    }
    // â”€â”€ admin: force password reset on a user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const forceReset = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/force-reset$/)
    if (forceReset && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === forceReset[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const token = crypto.randomBytes(32).toString('hex')
      target.passwordReset = { token, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() }
      target.forcePasswordChange = true
      // Revoke all existing sessions immediately.
      for (const [tk, s] of sessions) if (s.userId === target.id) sessions.delete(tk)
      await saveConfig()
      const link = `${publicBaseUrl(req)}/reset-password?token=${token}`
      sendMail({
        to: target.email,
        subject: 'ProxyBox: admin requires password reset',
        html: `<h2>Password reset required</h2><p>An administrator has requested that you reset your password before logging in again.</p><p><a href="${htmlEscape(link)}">${htmlEscape(link)}</a></p><p>This link is valid for 24 hours.</p>`
      }).catch(() => {})
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `force-reset ${target.email}` })
      return sendJson(res, 200, { ok: true })
    }
    // â”€â”€ admin: notes + tags on a user (PATCH) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const userNotesMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/notes$/)
    if (userNotesMatch && req.method === 'PATCH') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === userNotesMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const body = await readJson(req)
      if (typeof body.notes === 'string') target.notes = body.notes.slice(0, 2000)
      if (Array.isArray(body.tags)) target.tags = body.tags.map((t) => String(t).slice(0, 32)).filter(Boolean).slice(0, 20)
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `notes/tags updated for ${target.email}` })
      return sendJson(res, 200, { ok: true, notes: target.notes || '', tags: target.tags || [] })
    }
    // â”€â”€ admin: enforce 2FA toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const enforce2faMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/enforce-2fa$/)
    if (enforce2faMatch && req.method === 'POST') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const target = config.users.find((u) => u.id === enforce2faMatch[1])
      if (!target) return sendJson(res, 404, { error: 'user not found' })
      const body = await readJson(req)
      target.require2FA = !!body.enforce
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `require2FA=${target.require2FA}` })
      return sendJson(res, 200, { ok: true, require2FA: target.require2FA })
    }
    // â”€â”€ admin: billing helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // â”€â”€ admin: audit CSV export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/audit/export') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const fActor = url.searchParams.get('actor') || ''
      const fPath = url.searchParams.get('path') || ''
      const fSince = url.searchParams.get('since') || ''
      let rows = []
      if (sqliteDb) {
        try {
          const where = []
          const args = []
          if (fActor) { where.push('actor LIKE ?'); args.push('%' + fActor + '%') }
          if (fPath)  { where.push('path LIKE ?');  args.push('%' + fPath + '%') }
          if (fSince) { where.push('ts >= ?');      args.push(fSince) }
          const sql = `SELECT ts, actor, ip, method, path, status, note FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT 5000`
          rows = sqliteDb.prepare(sql).all(...args)
        } catch (e) { return sendJson(res, 500, { error: e.message }) }
      }
      const csv = ['ts,actor,ip,method,path,status,note']
      for (const r of rows) {
        const esc = (v) => {
          const s = String(v ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }
        csv.push([r.ts, r.actor, r.ip, r.method, r.path, r.status, r.note].map(esc).join(','))
      }
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` })
      return res.end(csv.join('\n'))
    }
    // â”€â”€ admin: email template preview (renders with sample placeholders) â”€â”€
    if (req.method === 'POST' && url.pathname === '/api/admin/email-templates/preview') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      if (!config.emailTemplates) config.emailTemplates = defaultEmailTemplates()
      const body = await readJson(req)
      const key = String(body.key || '').trim()
      const tpl = config.emailTemplates[key]
      if (!tpl) return sendJson(res, 404, { error: 'template not found' })
      const sample = body.sample && typeof body.sample === 'object' ? body.sample : {
        name: 'Demo User', trial: '50,000', quantity: '5', type: 'IPv4',
        orderId: 'o-demo-123', hours: '24', count: '3',
        proxyList: '1.2.3.4:8001:user:pass\n1.2.3.4:8002:user:pass'
      }
      const render = (s) => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => htmlEscape(String(sample[k] ?? '')))
      return sendJson(res, 200, { subject: render(tpl.subject), html: render(tpl.html) })
    }
    // â”€â”€ admin: live system status (memory, sessions, node health) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Single-shot aggregate snapshot for the redesigned admin dashboard.
    // Returns everything the dashboard charts need so the page makes ONE call
    // instead of 4-5 parallel ones.
    if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const mem = process.memoryUsage()
      let dbSize = 0
      try { dbSize = sqliteDb ? require('node:fs').statSync(sqliteDbPath || '').size : 0 } catch {}
      const allNodes = [localNode(), ...config.nodes.map(publicNode)]
      const nodeOnline = allNodes.filter((n) => n.online !== false).length
      // Status distribution
      const statusCount = { active: 0, expired: 0, grace: 0, error: 0, pending: 0 }
      for (const p of config.proxies) statusCount[p.status || 'active'] = (statusCount[p.status || 'active'] || 0) + 1
      const familyCount = { ipv4: 0, ipv6: 0 }
      for (const p of config.proxies) familyCount[(p.type || 'IPv4').toLowerCase()] = (familyCount[(p.type || 'IPv4').toLowerCase()] || 0) + 1
      // Per-node load: proxies count + active conns + month bytes
      const perNode = allNodes.map((n) => {
        const ps = config.proxies.filter((p) => (p.nodeId || 'local') === n.id)
        const active = ps.reduce((a, p) => a + (stats.get(p.id)?.activeConnections || 0), 0)
        const month = ps.reduce((a, p) => a + (stats.get(p.id)?.monthBytes || 0), 0)
        const total = ps.reduce((a, p) => a + (stats.get(p.id)?.totalConnections || 0), 0)
        return { id: n.id, name: n.name, host: n.host, family: n.family || 'dual', status: n.status || (n.online === false ? 'offline' : 'online'), proxies: ps.length, activeConns: active, monthBytes: month, totalConns: total }
      })
      // Top destination hosts (across all proxies' insights)
      const targetTally = new Map()
      for (const p of config.proxies) {
        const tops = stats.get(p.id)?.topTargets || []
        for (const t of tops) {
          const cur = targetTally.get(t.host) || { host: t.host, count: 0, bytes: 0 }
          cur.count += Number(t.count || 0); cur.bytes += Number(t.bytes || 0)
          targetTally.set(t.host, cur)
        }
      }
      const topTargets = [...targetTally.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 10)
      // Latest 8 audit events for activity feed
      let recentAudit = []
      try {
        if (sqliteDb) {
          recentAudit = sqliteDb.prepare('SELECT ts, actor, method, path, status, note FROM audit ORDER BY id DESC LIMIT 8').all()
        }
      } catch {}
      // Sum live + month from in-memory stats (real-time, not snapshotted)
      let liveConns = 0, totalConns = 0, uploadBytes = 0, downloadBytes = 0, monthBytes = 0
      for (const [, s] of stats) {
        liveConns += s.activeConnections || 0
        totalConns += s.totalConnections || 0
        uploadBytes += s.uploadBytes || 0
        downloadBytes += s.downloadBytes || 0
        monthBytes += s.monthBytes || 0
      }
      const expiringSoon = config.proxies.filter((p) => {
        if (p.status !== 'active' || !p.expires) return false
        const e = new Date(p.expires).getTime()
        return e > Date.now() && e < Date.now() + 7 * 86400_000
      }).length
      // Connection cap saturation: how many proxies are >= 80% of cap A
      const capA = Number(config.proxyDefaults?.maxConnsPerProxy || 100)
      const saturationByProxy = []
      for (const p of config.proxies) {
        const a = stats.get(p.id)?.activeConnections || 0
        if (a >= capA * 0.5) saturationByProxy.push({ id: p.id, active: a, max: capA, pct: Math.round((a / capA) * 100) })
      }
      saturationByProxy.sort((a, b) => b.pct - a.pct)
      return sendJson(res, 200, {
        system: {
          uptimeSeconds: Math.round(process.uptime()),
          memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
          sessions: { active: sessions.size },
          listeners: listeners.size,
          users: config.users.length,
          dbSize,
          version: APP_VERSION
        },
        proxies: {
          total: config.proxies.length,
          active: statusCount.active || 0,
          expired: statusCount.expired || 0,
          grace: statusCount.grace || 0,
          error: statusCount.error || 0,
          ipv4: familyCount.ipv4 || 0,
          ipv6: familyCount.ipv6 || 0,
          expiringSoon
        },
        nodes: { total: allNodes.length, online: nodeOnline, offline: allNodes.length - nodeOnline, list: perNode },
        traffic: { liveConns, totalConns, uploadBytes, downloadBytes, monthBytes },
        topTargets,
        recentAudit,
        saturation: saturationByProxy.slice(0, 10),
        caps: {
          maxConnsPerProxy: Number(config.proxyDefaults?.maxConnsPerProxy || 100),
          maxConnsPerSrcIp: Number(config.proxyDefaults?.maxConnsPerSrcIp || 60),
          newConnsPerSecPerIp: Number(config.proxyDefaults?.newConnsPerSecPerIp || 30)
        }
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/system/status') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const allNodes = [localNode(), ...config.nodes.map(publicNode)]
      const online = allNodes.filter((n) => n.online !== false).length
      const mem = process.memoryUsage()
      let dbSize = 0
      try { dbSize = sqliteDb ? require('node:fs').statSync(sqliteDbPath || '').size : 0 } catch {}
      return sendJson(res, 200, {
        uptimeSeconds: Math.round(process.uptime()),
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        sessions: { active: sessions.size },
        listeners: listeners.size,
        proxies: { total: config.proxies.length, active: config.proxies.filter((p) => p.status !== 'expired').length },
        nodes: { total: allNodes.length, online, offline: allNodes.length - online },
        users: config.users.length,
        dbSize
      })
    }
    // â”€â”€ admin: analytics â€” order heatmap (day-of-week Ã— hour-of-day) â”€â”€â”€â”€â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/analytics/heatmap') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
      const since = Date.now() - 30 * 86400_000
      for (const o of config.orders || []) {
        const t = new Date(o.createdAt).getTime()
        if (!Number.isFinite(t) || t < since) continue
        const d = new Date(t)
        grid[d.getUTCDay()][d.getUTCHours()] += 1
      }
      return sendJson(res, 200, { grid, since: new Date(since).toISOString() })
    }
    // â”€â”€ admin: analytics â€” churn buckets (last order recency) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (req.method === 'GET' && url.pathname === '/api/admin/analytics/churn') {
      if (!isAdminRequest(req)) return sendJson(res, 403, { error: 'admin only' })
      const lastOrderByUser = new Map()
      for (const o of config.orders || []) {
        const t = new Date(o.createdAt).getTime()
        if (!Number.isFinite(t)) continue
        const prev = lastOrderByUser.get(o.ownerId) || 0
        if (t > prev) lastOrderByUser.set(o.ownerId, t)
      }
      const now = Date.now()
      const buckets = { active7: 0, active30: 0, dormant30_60: 0, dormant60_90: 0, churned90plus: 0, never: 0 }
      for (const u of config.users) {
        if (u.role && u.role !== 'customer') continue
        const last = lastOrderByUser.get(u.id) || 0
        if (!last) { buckets.never += 1; continue }
        const days = (now - last) / 86400_000
        if (days <= 7)        buckets.active7 += 1
        else if (days <= 30)  buckets.active30 += 1
        else if (days <= 60)  buckets.dormant30_60 += 1
        else if (days <= 90)  buckets.dormant60_90 += 1
        else                  buckets.churned90plus += 1
      }
      return sendJson(res, 200, buckets)
    }

    if (req.method === 'GET' && url.pathname === '/api/network') {
      return sendJson(res, 200, publicNetwork())
    }

    if (req.method === 'GET' && url.pathname === '/api/metrics') {
      return sendMetrics(res)
    }

    if (url.pathname === '/api/nodes') {
      if (req.method === 'GET') return sendJson(res, 200, [localNode(), ...config.nodes.map(publicNode)])
      if (req.method === 'POST') {
        const body = await readJson(req)
        const name = String(body.name || '').trim()
        const host = String(body.host || '').trim()
        if (!name || !host) return sendJson(res, 400, { error: 'name and host are required' })
        const familyInput = String(body.family || '').toLowerCase()
        if (!['ipv4', 'ipv6'].includes(familyInput)) {
          return sendJson(res, 400, { error: 'family is required and must be "ipv4" or "ipv6"' })
        }
        const regionInput = String(body.region || 'auto').toLowerCase().slice(0, 24)
        const zoneInput = String(body.zone || regionInput).toLowerCase().slice(0, 32)
        const node = {
          id: `node-${crypto.randomBytes(4).toString('hex')}`,
          name,
          host,
          family: familyInput,
          region: regionInput,
          zone: zoneInput,
          tag: String(body.tag || '').trim().slice(0, 32),
          sshUser: String(body.sshUser || 'root').trim(),
          sshPort: Number(body.sshPort) || 22,
          sshSecret: encryptSecret(body.sshPassword),
          sshKeySecret: encryptSecret(body.sshKey),
          status: 'registered',
          agentToken: crypto.randomBytes(24).toString('hex'),
          enrollToken: crypto.randomBytes(16).toString('hex'),
          createdAt: new Date().toISOString(),
          lastSeenAt: null
        }
        config.nodes.push(node)
        await saveConfig()
        return sendJson(res, 201, publicNode(node))
      }
    }
    // ── Fleet (zero-touch) enrollment token management ───────────────────
    // GET    /api/nodes/fleet-token         → current token + install commands (or 404)
    // POST   /api/nodes/fleet-token         → rotate / create a fresh token
    // DELETE /api/nodes/fleet-token         → revoke (admin can stop new enrollments)
    if (url.pathname === '/api/nodes/fleet-token') {
      if (req.method === 'GET') {
        const tok = config.api && config.api.fleetEnrollToken
        if (!tok) return sendJson(res, 404, { error: 'no fleet token set — POST to create one' })
        return sendJson(res, 200, fleetTokenPayload(tok))
      }
      if (req.method === 'POST') {
        if (!config.api) config.api = {}
        config.api.fleetEnrollToken = crypto.randomBytes(24).toString('hex')
        await saveConfig()
        audit({ actor: 'admin', ip: clientIp(req), method: 'POST', path: '/api/nodes/fleet-token', note: 'fleet enrollment token rotated' })
        return sendJson(res, 200, fleetTokenPayload(config.api.fleetEnrollToken))
      }
      if (req.method === 'DELETE') {
        if (config.api) delete config.api.fleetEnrollToken
        await saveConfig()
        audit({ actor: 'admin', ip: clientIp(req), method: 'DELETE', path: '/api/nodes/fleet-token', note: 'fleet enrollment token revoked' })
        return sendJson(res, 200, { ok: true })
      }
    }
    const nodeSyncMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/sync$/)
    if (nodeSyncMatch && req.method === 'POST') {
      const id = nodeSyncMatch[1]
      if (id === 'local') {
        detected = detectNetwork()
        return sendJson(res, 200, { ok: true, id, syncRequestedAt: new Date().toISOString() })
      }
      const node = config.nodes.find((n) => n.id === id)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      node.syncRequestedAt = new Date().toISOString()
      await saveConfig()
      return sendJson(res, 200, { ok: true, id, syncRequestedAt: node.syncRequestedAt })
    }
    const nodeInstallMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/install$/)
    if (nodeInstallMatch && req.method === 'POST') {
      const node = config.nodes.find((n) => n.id === nodeInstallMatch[1])
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      const password = decryptSecret(node.sshSecret)
      const privateKey = decryptSecret(node.sshKeySecret)
      if (!password && !privateKey) return sendJson(res, 400, { error: 'no SSH credentials stored â€” re-register the node with sshPassword or sshKey' })
      node.status = 'installing'
      await saveConfig()
      const cmd = `curl -fsSL ${controlBaseUrl()}/api/agent/install/${node.enrollToken} | bash`
      try {
        const result = await sshExec({ host: node.host, port: node.sshPort || 22, username: node.sshUser, password, privateKey }, cmd, 180_000)
        node.status = result.code === 0 ? 'enrolled' : 'install-failed'
        await saveConfig()
        return sendJson(res, 200, { ok: result.code === 0, exitCode: result.code, output: result.output })
      } catch (error) {
        node.status = 'install-failed'
        await saveConfig()
        return sendJson(res, 200, { ok: false, error: error.message, output: '' })
      }
    }
    const nodeLogsMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/logs$/)
    if (nodeLogsMatch && (req.method === 'GET' || req.method === 'POST')) {
      const id = nodeLogsMatch[1]
      const lines = Math.min(Math.max(Number(url.searchParams.get('lines') || 200), 10), 5000)
      if (id === 'local') {
        // local control plane: read its own service log
        try {
          const out = await execAsync(`journalctl -u proxyhub --no-pager -n ${lines}`, 15_000)
          return sendJson(res, 200, { id, lines, output: out, source: 'journalctl' })
        } catch (e) {
          return sendJson(res, 200, { id, lines, output: e.message || String(e), source: 'error' })
        }
      }
      const node = config.nodes.find((n) => n.id === id)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      const password = decryptSecret(node.sshSecret)
      const privateKey = decryptSecret(node.sshKeySecret)
      if (!password && !privateKey) return sendJson(res, 400, { error: 'no SSH credentials stored for this node' })
      try {
        const result = await sshExec(
          { host: node.host, port: node.sshPort || 22, username: node.sshUser, password, privateKey },
          `journalctl -u proxybox-agent --no-pager -n ${lines} 2>/dev/null || journalctl -u proxyhub-agent --no-pager -n ${lines} 2>&1 || cat /var/log/proxybox-agent.log 2>/dev/null || cat /var/log/proxyhub-agent.log 2>&1 | tail -n ${lines}`,
          30_000
        )
        return sendJson(res, 200, { id, lines, output: result.output, exitCode: result.code, source: 'ssh+journalctl' })
      } catch (e) {
        return sendJson(res, 200, { id, lines, output: e.message || String(e), source: 'error' })
      }
    }
    // Disable / enable a node â€” when disabled, /api/agent/proxies returns []
    // so the agent reconciles every listener off. Local node also stops listeners.
    const nodeToggleMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/(disable|enable)$/)
    if (nodeToggleMatch && req.method === 'POST') {
      const id = nodeToggleMatch[1]; const act = nodeToggleMatch[2]
      const disable = act === 'disable'
      if (id === 'local') {
        // For local, stop/start every local proxy listener.
        for (const p of config.proxies) {
          if ((p.nodeId || 'local') !== 'local') continue
          if (disable) stopProxy(p.id)
          else if (p.status !== 'expired') await startProxy(p)
        }
        config.api.localDisabled = disable
        await saveConfig()
        return sendJson(res, 200, { ok: true, disabled: disable })
      }
      const node = config.nodes.find((n) => n.id === id)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      node.disabled = disable
      await saveConfig()
      audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: act })
      return sendJson(res, 200, { ok: true, disabled: disable })
    }

    // Bulk-check every proxy on a node (admin convenience â€” runs the
    // listener-path health probe on each member sequentially with concurrency 5).
    const nodeCheckMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/check-all$/)
    if (nodeCheckMatch && req.method === 'POST') {
      const id = nodeCheckMatch[1]
      const members = config.proxies.filter((p) => (p.nodeId || 'local') === id && p.status !== 'expired')
      if (members.length === 0) return sendJson(res, 200, { ok: true, total: 0, passed: 0, failed: 0 })
      const queue = members.slice()
      let passed = 0; let failed = 0
      const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
        while (queue.length) {
          const p = queue.shift(); if (!p) return
          try {
            const r = await remoteCheckProxy(p)
            p.lastCheckedAt = new Date().toISOString(); p.lastCheckOk = r.ok
            updateSlaTick(p.id, r.ok)
            if (r.ok) { passed += 1; if (p.status === 'error') p.status = 'active' }
            else { failed += 1; p.status = 'error' }
          } catch { failed += 1 }
        }
      })
      await Promise.all(workers)
      await saveConfig()
      return sendJson(res, 200, { ok: true, total: members.length, passed, failed })
    }

    // ── Per-node upgrade command (admin only). Mints/returns the upgrade
    // token + a copy-pasteable one-liner the operator runs on the node.
    // POST also regenerates the token if `?rotate=1`.
    const nodeUpgradeMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/upgrade-command$/)
    if (nodeUpgradeMatch) {
      const id = nodeUpgradeMatch[1]
      if (id === 'local') return sendJson(res, 400, { error: 'local node is updated via the main server deploy' })
      const node = config.nodes.find((n) => n.id === id)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      if (req.method === 'POST') {
        node.upgradeToken = crypto.randomBytes(24).toString('hex')
        await saveConfig()
        audit({ actor: actorOf(req), ip: clientIp(req), method: 'POST', path: url.pathname, note: `regenerated upgradeToken for node ${id}` })
      } else if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'method not allowed' })
      }
      if (!node.upgradeToken) {
        node.upgradeToken = crypto.randomBytes(24).toString('hex')
        await saveConfig()
      }
      const base = controlBaseUrl()
      return sendJson(res, 200, {
        nodeId: id,
        nodeName: node.name,
        currentVersion: node.version || null,
        latestVersion: LATEST_AGENT_VERSION,
        outdated: !!(node.version && !agentVersionMatches(node.version, LATEST_AGENT_VERSION)),
        oneLiner: `curl -fsSL ${base}/api/agent/upgrade-script/${node.upgradeToken} | sudo bash`,
        upgradeScriptUrl: `${base}/api/agent/upgrade-script/${node.upgradeToken}`,
        binaryUrl: `${base}/api/agent/binary-upgrade/${node.upgradeToken}`
      })
    }
    // Command history (results of agent-channel commands). Useful for the
    // admin UI to show "diagnose returned this 5 min ago" without re-running.
    const nodeCmdMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/commands$/)
    if (nodeCmdMatch && req.method === 'GET') {
      const n = config.nodes.find((x) => x.id === nodeCmdMatch[1])
      if (!n) return sendJson(res, 404, { error: 'node not found' })
      return sendJson(res, 200, {
        pending: n.pendingCommands || [],
        history: n.commandHistory || []
      })
    }

    // Unified admin remote-action endpoint. Single surface for every admin
    // tool that needs to touch a node's underlying machine — reboot, restart
    // agent service, gather diagnostics, refresh network info, power
    // off/on (hub VPS only), drain, rotate token. Delivery mechanism is
    // chosen automatically per node type:
    //   • Hub VPS (n.hub.vpsid + n.hub.rootPassEncrypted) — SSH via stored
    //     root creds for service-level ops; Virtualizor power API for hard
    //     power cycling.
    //   • Admin pool with sshSecret/sshKeySecret — SSH directly.
    //   • Customer BYON without SSH creds — falls back to in-band agent
    //     channel (drain via node.disabled flag; other ops respond 501).
    const nodeActionMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/action\/([a-z-]+)$/)
    if (nodeActionMatch && req.method === 'POST') {
      const [, nid, action] = nodeActionMatch
      const node = config.nodes.find((n) => n.id === nid)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      return await handleNodeAction(req, res, node, action)
    }

    const nodeMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)$/)
    if (nodeMatch && req.method === 'PATCH') {
      const id = nodeMatch[1]
      if (id === 'local') {
        const body = await readJson(req)
        // Local node only exposes `family` for admin edits — host/version come
        // from the running process. Pass 'auto' (or empty) to clear the pin
        // and fall back to auto-detect. 'dual' is rejected: every node must
        // be strictly v4 or v6.
        if (Object.prototype.hasOwnProperty.call(body, 'family')) {
          const raw = String(body.family || '').toLowerCase()
          if (!config.network) config.network = {}
          if (raw === '' || raw === 'auto') {
            delete config.network.localFamily
          } else if (raw === 'ipv4' || raw === 'ipv6') {
            config.network.localFamily = raw
          } else {
            return sendJson(res, 400, { error: 'family must be "ipv4" or "ipv6" (or "auto" to clear)' })
          }
          await saveConfig()
          audit({ actor: actorOf(req), ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `local family → ${config.network.localFamily || 'auto'}` })
        }
        return sendJson(res, 200, localNode())
      }
      const node = config.nodes.find((n) => n.id === id)
      if (!node) return sendJson(res, 404, { error: 'node not found' })
      const body = await readJson(req)
      if (typeof body.name === 'string' && body.name.trim()) node.name = body.name.trim()
      if (typeof body.tag === 'string') node.tag = body.tag.trim().slice(0, 32)
      if (typeof body.region === 'string') node.region = body.region.trim().slice(0, 24).toLowerCase()
      if (typeof body.zone === 'string') node.zone = body.zone.trim().slice(0, 32).toLowerCase()
      if (typeof body.family === 'string') {
        const fam = body.family.toLowerCase()
        if (!['ipv4', 'ipv6'].includes(fam)) {
          return sendJson(res, 400, { error: 'family must be "ipv4" or "ipv6"' })
        }
        node.family = fam
      }
      if (body.alerts && typeof body.alerts === 'object') {
        if (!node.alerts) node.alerts = {}
        const setNum = (k, min, max) => {
          if (body.alerts[k] === null || body.alerts[k] === '') { delete node.alerts[k]; return }
          const n = Number(body.alerts[k]); if (Number.isFinite(n) && n >= min && n <= max) node.alerts[k] = n
        }
        setNum('ramPct', 1, 100); setNum('load1', 1, 10000); setNum('failPct', 1, 100)
        if (!Object.keys(node.alerts).length) delete node.alerts
      }
      await saveConfig()
      return sendJson(res, 200, publicNode(node))
    }
    if (nodeMatch && req.method === 'GET') {
      const id = nodeMatch[1]
      const isLocal = id === 'local'
      const node = isLocal ? null : config.nodes.find((n) => n.id === id)
      if (!isLocal && !node) return sendJson(res, 404, { error: 'node not found' })
      const proxiesOnNode = config.proxies.filter((p) => (p.nodeId || 'local') === id)
      // Per-customer breakdown: who's using this node + how much. Lets admin
      // see, in one glance, who would be affected if the node went offline,
      // and which customers are the heaviest users on this hardware.
      const userById = new Map((config.users || []).map((u) => [u.id, u]))
      const ownerMap = new Map()
      for (const p of proxiesOnNode) {
        if (!p.ownerId) continue
        const e = ownerMap.get(p.ownerId) || { ownerId: p.ownerId, total: 0, active: 0, expired: 0, error: 0, replaced: 0, autoFixCount: 0, lastActive: null }
        e.total += 1
        e[p.status] = (e[p.status] || 0) + 1
        e.autoFixCount += Number(p.autoFixCount) || 0
        const last = p.lastCheckedAt ? new Date(p.lastCheckedAt).getTime() : 0
        if (last && (!e.lastActive || last > e.lastActive)) e.lastActive = last
        ownerMap.set(p.ownerId, e)
      }
      // 30-day bytes per owner from conn_events (the per-conn truth log)
      // grouped by owner_id for proxies on THIS node only. One query, much
      // cheaper than per-owner lookups.
      if (sqliteDb && ownerMap.size) {
        try {
          const cutoff = Date.now() - 30 * 86_400_000
          const proxyIds = proxiesOnNode.map((p) => p.id)
          if (proxyIds.length) {
            const ph = proxyIds.map(() => '?').join(',')
            const rows = sqliteDb.prepare(`SELECT owner_id, SUM(up) AS up, SUM(dn) AS dn FROM conn_events WHERE proxy_id IN (${ph}) AND ts >= ? GROUP BY owner_id`).all(...proxyIds, cutoff)
            for (const r of rows) {
              const e = ownerMap.get(r.owner_id)
              if (e) { e.bytes30dUp = Number(r.up) || 0; e.bytes30dDown = Number(r.dn) || 0 }
            }
          }
        } catch { /* leave bytes empty on error */ }
      }
      const owners = [...ownerMap.values()].map((e) => {
        const u = userById.get(e.ownerId)
        return {
          ownerId: e.ownerId,
          email: u?.email || '(unknown)',
          name: u?.name || '',
          suspended: !!u?.suspended,
          total: e.total, active: e.active || 0, expired: e.expired || 0, error: e.error || 0, replaced: e.replaced || 0,
          autoFixCount: e.autoFixCount,
          lastActive: e.lastActive,
          bytes30dUp: e.bytes30dUp || 0, bytes30dDown: e.bytes30dDown || 0,
          bytes30dTotal: (e.bytes30dUp || 0) + (e.bytes30dDown || 0)
        }
      }).sort((a, b) => b.bytes30dTotal - a.bytes30dTotal || b.total - a.total)
      // Bandwidth windows for the whole node (1h / 24h / 30d, split up/down).
      // ONE conditional-SUM query across this node's proxy_id set, not the
      // per-proxy helper in a loop — the loop would fire 2000+ statements
      // and gate the /api/nodes/:id response on SQLite throughput.
      let windowsBandwidth = { h1: { up: 0, down: 0 }, h24: { up: 0, down: 0 }, d30: { up: 0, down: 0 } }
      if (sqliteDb && proxiesOnNode.length) {
        try {
          const now = Date.now()
          const c1 = now - 3600 * 1000
          const c24 = now - 86_400 * 1000
          const c30 = now - 2_592_000 * 1000
          const ph = proxiesOnNode.map(() => '?').join(',')
          const r = sqliteDb.prepare(`
            SELECT
              COALESCE(SUM(CASE WHEN ts >= ? THEN up ELSE 0 END), 0) AS up1,
              COALESCE(SUM(CASE WHEN ts >= ? THEN dn ELSE 0 END), 0) AS dn1,
              COALESCE(SUM(CASE WHEN ts >= ? THEN up ELSE 0 END), 0) AS up24,
              COALESCE(SUM(CASE WHEN ts >= ? THEN dn ELSE 0 END), 0) AS dn24,
              COALESCE(SUM(up), 0) AS up30, COALESCE(SUM(dn), 0) AS dn30
            FROM conn_events WHERE proxy_id IN (${ph}) AND ts >= ?
          `).get(c1, c1, c24, c24, ...proxiesOnNode.map((p) => p.id), c30)
          windowsBandwidth = {
            h1:  { up: Number(r.up1)  || 0, down: Number(r.dn1)  || 0 },
            h24: { up: Number(r.up24) || 0, down: Number(r.dn24) || 0 },
            d30: { up: Number(r.up30) || 0, down: Number(r.dn30) || 0 }
          }
        } catch { /* leave zeroed on error */ }
      }
      // Recent auto-heal events on this node (from audit table).
      let recentFixes = []
      if (sqliteDb) {
        try {
          recentFixes = sqliteDb.prepare(
            `SELECT ts, path, note FROM audit WHERE actor = 'auto-heal' AND note LIKE '%' ORDER BY id DESC LIMIT 80`
          ).all().filter((r) => {
            // path is like /proxy/<id>/rotate — keep only ones on this node's proxies
            const m = (r.path || '').match(/\/proxy\/([^/]+)/)
            return m && proxiesOnNode.some((p) => p.id === m[1])
          }).slice(0, 20)
        } catch { /* leave empty */ }
      }
      // Recent open errors for this node.
      let recentErrors = []
      if (sqliteDb) {
        try {
          recentErrors = sqliteDb.prepare(
            `SELECT id, first_ts, last_ts, count, source, level, code, message, proxy_id AS proxyId FROM errors WHERE node_id = ? AND resolved = 0 ORDER BY last_ts DESC LIMIT 20`
          ).all(id)
        } catch { /* leave empty */ }
      }
      const base = isLocal ? localNode() : publicNode(node)
      return sendJson(res, 200, {
        ...base,
        proxies: proxiesOnNode.map(publicProxy),
        syncRequestedAt: (node && node.syncRequestedAt) || null,
        owners,
        windowsBandwidth,
        recentFixes,
        recentErrors
      })
    }
    if (nodeMatch && req.method === 'DELETE') {
      const idx = config.nodes.findIndex((n) => n.id === nodeMatch[1])
      if (idx === -1) return sendJson(res, 404, { error: 'node not found' })
      const removed = config.nodes[idx]
      // Tell the agent to drop all listeners NOW before we strip the node row
      // (after stripping, agent gets 401 → also drops, but that's a race we
      // close by hitting any active long-poll waiter first).
      kickAgentEmpty(removed.id)
      config.nodes.splice(idx, 1)
      // mark proxies as expired (no agent serves them anymore — kept for billing/history)
      for (const p of config.proxies) if (p.nodeId === removed.id) p.status = 'expired'
      await saveConfig()
      return sendJson(res, 200, { ok: true, id: nodeMatch[1] })
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        api: { host: config.api.host, port: config.api.port },
        network: config.network,
        proxyDefaults: config.proxyDefaults,
        detected: publicNetwork()
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/proxies') {
      return sendJson(res, 200, config.proxies.map(publicProxy))
    }

    // Export proxy list in ip:port:user:pass / CSV / JSON formats. Filters via
    // ?type=ipv4|ipv6 &nodeId= &status= &orderId= so admin can dump a single batch.
    if (req.method === 'GET' && url.pathname === '/api/proxies/export') {
      const fmt = String(url.searchParams.get('format') || 'txt').toLowerCase()
      const fType = url.searchParams.get('type') || ''
      const fNode = url.searchParams.get('nodeId') || ''
      const fStatus = url.searchParams.get('status') || ''
      const fOrder = url.searchParams.get('orderId') || ''
      let list = config.proxies.slice()
      if (fType) list = list.filter((p) => String(p.type).toLowerCase() === fType.toLowerCase())
      if (fNode) list = list.filter((p) => (p.nodeId || 'local') === fNode)
      if (fStatus) list = list.filter((p) => p.status === fStatus)
      if (fOrder) list = list.filter((p) => p.orderId === fOrder)
      if (fmt === 'csv') {
        const rows = ['id,type,nodeId,host,port,username,password,status,expires,egressIp']
        for (const p of list) rows.push(`${p.id},${p.type},${p.nodeId || 'local'},${customerFacingHost(p)},${p.port},${p.username},${p.password},${p.status || 'active'},${p.expires || ''},${p.bindIp}`)
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="proxies-${Date.now()}.csv"` })
        return res.end(rows.join('\n') + '\n')
      }
      if (fmt === 'json') {
        return sendJson(res, 200, list.map((p) => ({ ...publicProxy(p), username: p.username, password: p.password })))
      }
      // default: txt â€” one line per proxy in `ip:port:user:pass` format
      const lines = list.map((p) => `${customerFacingHost(p)}:${p.port}:${p.username}:${p.password}`)
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="proxies-${Date.now()}.txt"` })
      return res.end(lines.join('\n') + '\n')
    }

    if (req.method === 'POST' && url.pathname === '/api/proxies') {
      const body = await readJson(req)
      if (body.nodeId && body.nodeId !== 'local' && !config.nodes.some((n) => n.id === body.nodeId)) {
        return sendJson(res, 400, { error: `node ${body.nodeId} not found` })
      }
      let proxy
      try { proxy = createProxy(body) } catch (e) { return sendJson(res, 400, { error: e.message }) }
      config.proxies.push(proxy)
      ensureStats(proxy.id)
      if ((proxy.nodeId || 'local') === 'local') await startProxy(proxy)
      await saveConfig()
      return sendJson(res, 201, { ...publicProxy(proxy), username: proxy.username, password: proxy.password })
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') {
      return handleCreateOrder(req, res)
    }

    if (req.method === 'GET' && url.pathname === '/api/orders') {
      return sendJson(res, 200, orders)
    }

    // Rotate every member of an order â€” useful for "shuffle whole v6 batch"
    const orderRotateMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/rotate-all$/)
    if (orderRotateMatch && req.method === 'POST') {
      const order = orders.find((o) => o.id === orderRotateMatch[1])
      if (!order) return sendJson(res, 404, { error: 'order not found' })
      const ids = new Set(order.proxyIds || [])
      const members = config.proxies.filter((p) => ids.has(p.id))
      let rotated = 0
      const errors = []
      for (const proxy of members) {
        try {
          const next = pickBindIp(proxy.type, proxy.nodeId)
          if (next) { proxy.bindIp = next; rotated += 1 }
        } catch (e) { errors.push(`${proxy.id}: ${e.message}`) }
      }
      await saveConfig()
      return sendJson(res, 200, { ok: true, id: order.id, rotated, errors, proxies: members.map(publicProxy) })
    }

    const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/)
    if (orderMatch) {
      const order = orders.find((o) => o.id === orderMatch[1])
      if (!order) return sendJson(res, 404, { error: 'order not found' })
      const ids = new Set(order.proxyIds || [])
      const members = config.proxies.filter((p) => ids.has(p.id))
      if (req.method === 'GET') {
        return sendJson(res, 200, { ...order, proxies: members.map(publicProxy) })
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        // Order-level shared bandwidth cap; survives across heartbeats so the
        // group-wide bucket is rebuilt on agent reconnect.
        if (body.orderBytesPerSec !== undefined) {
          order.bytesPerSec = nonNegInt(body.orderBytesPerSec)
          // Drop any stale bucket so the new rate applies immediately.
          orderBuckets.delete(order.id)
        }
        let touched = 0
        for (const proxy of members) {
          proxy.orderId = order.id
          if (typeof body.rotate === 'boolean') proxy.rotate = proxy.type === 'IPv6' && body.rotate
          if (body.maxConnections !== undefined) proxy.maxConnections = nonNegInt(body.maxConnections)
          if (body.bytesPerSec !== undefined) proxy.bytesPerSec = nonNegInt(body.bytesPerSec)
          if (body.monthlyQuotaBytes !== undefined) proxy.monthlyQuotaBytes = nonNegInt(body.monthlyQuotaBytes)
          if (body.perSrcMax !== undefined) proxy.perSrcMax = nonNegInt(body.perSrcMax)
          if (Number.isFinite(Number(body.durationDays))) proxy.expires = addDays(Number(body.durationDays))
          if (typeof body.listenHost === 'string' && body.listenHost.trim()) proxy.listenHost = body.listenHost.trim()
          touched += 1
        }
        await Promise.all([saveConfig(), saveOrders()])
        return sendJson(res, 200, { ...order, applied: touched, proxies: members.map(publicProxy) })
      }
    }

    const proxyAction = url.pathname.match(/^\/api\/proxies\/([^/]+)\/(stats|history|reset|renew|credentials|rotate|check)$/)
    if (proxyAction) {
      const [, id, action] = proxyAction
      const proxy = config.proxies.find((item) => item.id === id)
      if (!proxy) return sendJson(res, 404, { error: 'proxy not found' })

      if (action === 'stats' && req.method === 'GET') return sendJson(res, 200, publicStats(id))
      if (action === 'sla' && req.method === 'GET') {
        const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), 365)
        return sendJson(res, 200, { id, days, ...(slaPercent(id, days) || { pct: 100, samples: 0 }) })
      }
      if (action === 'history' && req.method === 'GET') {
        const hours = Math.min(Math.max(Number(url.searchParams.get('hours') || 24), 1), 720)
        if (sqliteDb) {
          try {
            const rows = sqliteDb.prepare('SELECT hour, upload_bytes AS uploadBytes, download_bytes AS downloadBytes, bps_in AS bpsIn, bps_out AS bpsOut FROM history WHERE proxy_id = ? ORDER BY hour DESC LIMIT ?').all(id, hours).reverse()
            return sendJson(res, 200, { id, samples: rows, source: 'sqlite' })
          } catch { /* fall through */ }
        }
        const h = proxyHistory.get(id)
        return sendJson(res, 200, { id, samples: h ? h.samples : [], source: 'memory' })
      }
      if (action === 'credentials' && req.method === 'GET') {
        const rotating = Boolean(proxy.rotate) && proxy.type === 'IPv6'
        const host = customerFacingHost(proxy) || proxy.bindIp
        return sendJson(res, 200, {
          username: proxy.username,
          password: proxy.password,
          mode: rotating ? 'rotating' : 'sticky',
          endpoint: `${host}:${proxy.port}`,
          http: `http://${proxy.username}:${proxy.password}@${host}:${proxy.port}`,
          socks5: `socks5://${proxy.username}:${proxy.password}@${host}:${proxy.port}`,
          egressIp: proxy.bindIp
        })
      }
      if (action === 'reset' && req.method === 'POST') {
        stats.set(id, { uploadBytes: 0, downloadBytes: 0, activeConnections: 0, totalConnections: 0, histLastUp: 0, histLastDown: 0, lastResetAt: new Date().toISOString() })
        if (proxy.status !== 'expired') proxy.status = 'active'
        await saveConfig()
        return sendJson(res, 200, publicProxy(proxy))
      }
      if (action === 'renew' && req.method === 'POST') {
        const body = await readJson(req)
        proxy.status = 'active'
        proxy.expires = addDays(Number(body.days || 30))
        await saveConfig()
        return sendJson(res, 200, publicProxy(proxy))
      }
      if (action === 'rotate' && req.method === 'POST') {
        let next
        try { next = pickBindIp(proxy.type, proxy.nodeId) } catch (e) { return sendJson(res, 409, { error: e.message }) }
        if (!next) return sendJson(res, 409, { error: `no usable ${proxy.type} address to rotate to` })
        proxy.bindIp = next
        await saveConfig()
        return sendJson(res, 200, publicProxy(proxy))
      }
      if ((action === 'disconnect-all' || action === 'unlock-login') && req.method === 'POST') {
        // Customer "Ngắt tất cả kết nối" — kill all active sockets for this
        // proxy on master (local node). Also bump kickEpoch so remote agents
        // observe via long-poll config push and kick their active sockets.
        const kickedLocal = kickAllProxySessions(proxy.id)
        proxy.kickEpoch = Number(proxy.kickEpoch || 0) + 1
        await saveConfig()
        return sendJson(res, 200, { ...publicProxy(proxy), kickedLocal })
      }
      if (action === 'check' && req.method === 'POST') {
        // BUG FIX: previously local-node check dialed `connectUpstream` directly
        // using bindIp, which never touched the listener nor the auth gate. So
        // expired proxies (listener closed via stopProxy) STILL returned ok
        // because outbound IP routing still worked. Now we always probe via the
        // listener (host:port + auth) â€” the same path a real customer uses.
        if (proxy.status === 'expired') {
          return sendJson(res, 200, { proxy: publicProxy(proxy), ok: false, latencyMs: null, error: 'proxy expired' })
        }
        const result = await remoteCheckProxy(proxy)
        if (Number.isFinite(result.latencyMs)) proxy.latency = result.latencyMs
        proxy.lastCheckedAt = new Date().toISOString()
        proxy.lastCheckOk = result.ok
        if (result.ok) {
          proxy.checkFailCount = 0
          proxy.totalFails = 0
          if (proxy.status === 'error') proxy.status = 'active'
          updateSlaTick(proxy.id, true)
        } else {
          proxy.checkFailCount = (Number(proxy.checkFailCount) || 0) + 1
          if (proxy.checkFailCount >= 3 && (proxy.nodeId || 'local') === 'local') {
            // Auto-rotate dead IP after 3 consecutive failures.
            try {
              const next = pickBindIp(proxy.type, proxy.nodeId)
              if (next && next !== proxy.bindIp) {
                const old = proxy.bindIp
                proxy.bindIp = next
                stopProxy(proxy.id); await startProxy(proxy)
                proxy.checkFailCount = 0
                proxy.status = 'active'
                pushAlert(`proxy:${proxy.id}:auto-rotate`, `Proxy ${proxy.id} auto-rotated ${old}â†'${next} after 3 check fails`, 'warn')
                audit({ actor: 'system', ip: 'auto', method: 'POST', path: '/system/auto-rotate', note: `${proxy.id} ${old}â†'${next}` })
              } else { proxy.status = 'error' }
            } catch { proxy.status = 'error' }
          } else proxy.status = 'error'
          updateSlaTick(proxy.id, false)
        }
        await saveConfig()
        return sendJson(res, 200, { proxy: publicProxy(proxy), ...result })
      }
    }

    const proxyById = url.pathname.match(/^\/api\/proxies\/([^/]+)$/)
    if (proxyById) {
      const id = proxyById[1]
      if (req.method === 'DELETE') {
        const index = config.proxies.findIndex((item) => item.id === id)
        if (index === -1) return sendJson(res, 404, { error: 'proxy not found' })
        if ((config.proxies[index].nodeId || 'local') === 'local') stopProxy(id)
        stats.delete(id)
        config.proxies.splice(index, 1)
        await saveConfig()
        return sendJson(res, 200, { ok: true, id })
      }
      if (req.method === 'PATCH') {
        const proxy = config.proxies.find((item) => item.id === id)
        if (!proxy) return sendJson(res, 404, { error: 'proxy not found' })
        const body = await readJson(req)
        if (typeof body.name === 'string' && body.name.trim()) proxy.name = body.name.trim()
        if (typeof body.rotate === 'boolean') proxy.rotate = proxy.type === 'IPv6' && body.rotate
        if (Number.isFinite(Number(body.durationDays))) proxy.expires = addDays(Number(body.durationDays))
        if (body.maxConnections !== undefined) proxy.maxConnections = nonNegInt(body.maxConnections)
        if (body.bytesPerSec !== undefined) proxy.bytesPerSec = nonNegInt(body.bytesPerSec)
        if (body.monthlyQuotaBytes !== undefined) proxy.monthlyQuotaBytes = nonNegInt(body.monthlyQuotaBytes)
        if (body.perSrcMax !== undefined) proxy.perSrcMax = nonNegInt(body.perSrcMax)
        if (typeof body.upstreamUrl === 'string') proxy.upstreamUrl = body.upstreamUrl.trim()
        if (typeof body.country === 'string') proxy.country = body.country.toLowerCase().slice(0, 8)
        if (typeof body.asn === 'string') proxy.asn = body.asn.toUpperCase().slice(0, 16)
        await saveConfig()
        return sendJson(res, 200, publicProxy(proxy))
      }
    }

    return sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    console.error(`[api] ${error.stack || error.message}`)
    return sendJson(res, 500, { error: error.message })
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Customer-facing v1 API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleUserV1(req, res, url) {
  const sub = url.pathname.slice('/api/v1/user/'.length)
  // public sub-paths
  if (req.method === 'POST' && sub === 'auth/login') return handleLogin(req, res)
  if (req.method === 'POST' && sub === 'auth/register') return handleRegister(req, res)
  if (req.method === 'POST' && sub === 'auth/logout') return handleLogout(req, res)

  // everything else needs a valid session
  const session = sessionFromRequest(req)
  if (!session) return sendJson(res, 401, { error: 'login required' })
  const user = config.users.find((u) => u.id === session.userId)
  if (!user) return sendJson(res, 401, { error: 'session user not found' })
  // Runtime suspend check: even with a valid token, a suspended user is locked
  // out from every customer endpoint. Sessions are also revoked on suspend
  // but this guard catches X-Customer-Key access as well.
  if (user.suspended) return sendJson(res, 403, { error: 'account suspended â€” contact support' })

  if (req.method === 'GET' && sub === 'auth/me') {
    return sendJson(res, 200, {
      id: user.id, name: user.name, email: user.email, role: user.role || 'customer',
      emailVerified: !!user.emailVerified, forcePasswordChange: !!user.forcePasswordChange,
      require2FA: !!user.require2FA, totpEnabled: !!(user.totp && user.totp.confirmed)
    })
  }

  // ── BYON: customer node management ──────────────────────────────────────
  // Free feature: customer brings their own VM, installs the agent via a
  // personal fleet token, then creates proxies on that node at $0. Their
  // token authenticates ALL API calls so they can automate the full flow.
  if (sub === 'nodes/fleet-token') {
    // Unified token: serve user.apiKey (same one used for X-Customer-Key auth).
    // POST rotates BOTH the API auth + fleet enroll token at once. There is no
    // separate fleetToken anymore — single source of truth.
    if (req.method === 'GET') {
      if (!user.apiKey || !user.apiKey.startsWith('usr_')) {
        return sendJson(res, 404, { error: 'no token yet — POST to create one' })
      }
      return sendJson(res, 200, customerFleetTokenPayload(user.apiKey))
    }
    if (req.method === 'POST') {
      user.apiKey = generateUserToken(user.id)
      user.fleetTokens = []
      await saveConfig()
      audit({ actor: user.email || user.id, ip: clientIp(req), method: 'POST', path: url.pathname, note: 'rotated unified token' })
      return sendJson(res, 200, customerFleetTokenPayload(user.apiKey))
    }
  }
  if (req.method === 'GET' && sub === 'nodes') {
    const list = config.nodes.filter((n) => n.ownerId === user.id).map(publicNodeForCustomer)
    return sendJson(res, 200, list)
  }
  const userNodeMatch = sub.match(/^nodes\/([^/]+)(?:\/(disable|enable))?$/)
  if (userNodeMatch) {
    const node = config.nodes.find((n) => n.id === userNodeMatch[1])
    if (!node || node.ownerId !== user.id) return sendJson(res, 404, { error: 'node not found' })
    if (req.method === 'GET' && !userNodeMatch[2]) {
      return sendJson(res, 200, publicNodeForCustomer(node))
    }
    if (req.method === 'DELETE' && !userNodeMatch[2]) {
      // Stop any local-served listeners (shouldn't have any since this is a
      // remote node) + remove proxies that were created on it (free ones).
      const ownedProxies = config.proxies.filter((p) => p.nodeId === node.id && p.ownerId === user.id)
      for (const p of ownedProxies) { stopProxy(p.id) }
      config.proxies = config.proxies.filter((p) => !(p.nodeId === node.id && p.ownerId === user.id))
      kickAgentEmpty(node.id)
      config.nodes = config.nodes.filter((n) => n.id !== node.id)
      await saveConfig()
      audit({ actor: user.email || user.id, ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `removed BYON node ${node.id}` })
      return sendJson(res, 200, { ok: true, removedProxies: ownedProxies.length })
    }
    if (req.method === 'POST' && (userNodeMatch[2] === 'disable' || userNodeMatch[2] === 'enable')) {
      node.disabled = userNodeMatch[2] === 'disable'
      await saveConfig()
      return sendJson(res, 200, publicNodeForCustomer(node))
    }
  }

  // â”€â”€ In-app notifications (bell) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (sub === 'notifications') {
    if (!Array.isArray(user.notifications)) user.notifications = []
    if (req.method === 'GET') {
      const unread = user.notifications.filter((n) => !n.read).length
      return sendJson(res, 200, { items: user.notifications.slice(0, 50), unread })
    }
    if (req.method === 'DELETE') { user.notifications = []; await saveConfig(); return sendJson(res, 200, { ok: true }) }
  }
  const notifMatch = sub.match(/^notifications\/([^/]+)\/read$/)
  if (notifMatch && req.method === 'POST') {
    if (!Array.isArray(user.notifications)) user.notifications = []
    const n = user.notifications.find((x) => x.id === notifMatch[1])
    if (n) { n.read = true; await saveConfig() }
    return sendJson(res, 200, { ok: true })
  }
  if (sub === 'notifications/read-all' && req.method === 'POST') {
    if (!Array.isArray(user.notifications)) user.notifications = []
    for (const n of user.notifications) n.read = true
    await saveConfig()
    return sendJson(res, 200, { ok: true })
  }

  if (req.method === 'GET' && sub === 'proxies') {
    const mapProxy = (p, sharedFrom) => {
      const pub = publicProxy(p)
      const host = pub.ip || p.bindIp || p.listenHost   // customer-facing v4 for IPv6 proxies
      return {
        ...pub,
        username: p.username,
        password: p.password,
        http: `http://${p.username}:${p.password}@${host}:${p.port}`,
        socks5: `socks5://${p.username}:${p.password}@${host}:${p.port}`,
        ...(sharedFrom ? { shared: true, sharedFrom } : {})
      }
    }
    const owned = config.proxies.filter((p) => p.ownerId === user.id).map((p) => mapProxy(p, null))
    // Read-only proxies shared with this user by other owners (team view). Mutations
    // stay owner-only — those endpoints already gate on ownerId === user.id.
    const shared = []
    for (const o of config.users.filter((u) => Array.isArray(u.sharedWith) && u.sharedWith.includes(user.id))) {
      for (const p of config.proxies.filter((p) => p.ownerId === o.id)) shared.push(mapProxy(p, o.email))
    }
    return sendJson(res, 200, [...owned, ...shared])
  }

  // ── Team: read-only proxy sharing (owner shares their proxies with members) ──
  if (sub === 'members' && req.method === 'GET') {
    const list = (user.sharedWith || []).map((id) => { const m = config.users.find((u) => u.id === id); return m ? { id: m.id, email: m.email, name: m.name } : null }).filter(Boolean)
    return sendJson(res, 200, list)
  }
  if (sub === 'members' && req.method === 'POST') {
    const body = await readJson(req)
    const email = String(body.email || '').trim().toLowerCase()
    if (!email) return sendJson(res, 400, { error: 'email required' })
    const member = config.users.find((u) => u.email.toLowerCase() === email)
    if (!member) return sendJson(res, 404, { error: 'Chưa có tài khoản nào với email này — họ cần đăng ký trước.' })
    if (member.id === user.id) return sendJson(res, 400, { error: 'cannot share with yourself' })
    if (!Array.isArray(user.sharedWith)) user.sharedWith = []
    if (!user.sharedWith.includes(member.id)) user.sharedWith.push(member.id)
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/members', note: `share with ${member.email}` })
    pushNotification(member.id, { type: 'info', severity: 'info', text: `${user.email} đã chia sẻ proxy (chỉ xem) với bạn.`, link: '/proxies' })
    return sendJson(res, 201, { id: member.id, email: member.email, name: member.name })
  }
  const memberDel = sub.match(/^members\/([^/]+)$/)
  if (memberDel && req.method === 'DELETE') {
    user.sharedWith = (user.sharedWith || []).filter((id) => id !== memberDel[1])
    await saveConfig()
    return sendJson(res, 200, { ok: true })
  }

  // â”€â”€ Customer self-service per-proxy actions on owned proxies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Allowed: rotate, check, extend, sla, history, set-whitelist
  // Inline edit fields: label (note), custom username, custom password.
  // PATCH /api/v1/user/proxies/:id with any combination of these fields.
  const proxyPatchMatch = sub.match(/^proxies\/([^/]+)$/)
  if (proxyPatchMatch && req.method === 'PATCH') {
    const proxy = config.proxies.find((p) => p.id === proxyPatchMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    const body = await readJson(req)
    const updates = []
    if (typeof body.label === 'string') {
      proxy.label = body.label.slice(0, 64)
      updates.push('label')
    }
    if (Array.isArray(body.tags)) {
      proxy.tags = body.tags
        .map((t) => String(t || '').trim().toLowerCase())
        .filter((t) => /^[a-z0-9_-]{1,20}$/.test(t))
        .slice(0, 10)
      updates.push('tags')
    }
    if (body.rotateEverySec !== undefined) {
      const v = Number(body.rotateEverySec)
      const allowed = [0, 60, 180, 300, 600, 900, 1800, 3600, 7200]
      if (!allowed.includes(v)) return sendJson(res, 400, { error: `rotateEverySec must be one of ${allowed.join(',')}` })
      if (v > 0 && proxy.type !== 'IPv6') return sendJson(res, 400, { error: 'auto-rotate only available for IPv6 proxies' })
      proxy.rotateEverySec = v
      proxy.rotateLastAt = v > 0 ? Date.now() : null
      updates.push('rotateEverySec')
    }
    if (body.autoRenew !== undefined) {
      proxy.autoRenew = !!body.autoRenew
      updates.push('autoRenew')
    }
    if (body.autoRenewBudget !== undefined) {
      proxy.autoRenewBudget = Math.max(0, Math.min(10_000_000, Number(body.autoRenewBudget) || 0))
      updates.push('autoRenewBudget')
    }
    if (body.renewHours !== undefined) {
      const h = Math.max(1, Math.min(720, Number(body.renewHours) || 24))
      proxy.renewHours = h
      updates.push('renewHours')
    }
    const wantUser = typeof body.username === 'string' && body.username.trim() !== ''
    const wantPass = typeof body.password === 'string' && body.password !== ''
    if (wantUser || wantPass) {
      const u = wantUser ? String(body.username).trim() : proxy.username
      const p = wantPass ? String(body.password)        : proxy.password
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(u)) return sendJson(res, 400, { error: 'username 3-40 chars (letters, digits, underscore, dash)' })
      if (!/^\S{6,64}$/.test(p))             return sendJson(res, 400, { error: 'password 6-64 chars, no whitespace' })
      proxy.username = u
      proxy.password = p
      updates.push('credentials')
    }
    if (!updates.length) return sendJson(res, 400, { error: 'no updatable fields provided' })
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'PATCH', path: url.pathname, note: `updated ${updates.join(',')}` })
    return sendJson(res, 200, {
      ...publicProxy(proxy),
      username: proxy.username,
      password: proxy.password
    })
  }

  // Customer self-delete: release a proxy (stops listener, removes it, no
  // refund). Also unlinks from the parent order and cancels the order entirely
  // if it becomes empty — prevents orphan orders from sticking around as
  // "active" in the admin view.
  const proxyDeleteMatch = sub.match(/^proxies\/([^/]+)$/)
  if (proxyDeleteMatch && req.method === 'DELETE') {
    const proxy = config.proxies.find((p) => p.id === proxyDeleteMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    if ((proxy.nodeId || 'local') === 'local') { try { stopProxy(proxy.id) } catch { /* noop */ } }
    const idx = config.proxies.indexOf(proxy)
    if (idx >= 0) config.proxies.splice(idx, 1)
    if (proxy.orderId) {
      const order = orders.find((o) => o.id === proxy.orderId)
      if (order) {
        order.proxyIds = (order.proxyIds || []).filter((id) => id !== proxy.id)
        if (order.proxyIds.length === 0 && order.status !== 'refunded') {
          order.status = 'cancelled'
          order.cancelledAt = new Date().toISOString()
          order.cancelReason = 'customer-deleted-all-proxies'
        }
      }
    }
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `released proxy ${proxy.id}` })
    return sendJson(res, 200, { ok: true, id: proxy.id })
  }

  // Bulk check: POST { ids: [...] } — runs remoteCheckProxy in parallel for
  // every proxy in the list (ownership-enforced). Used by "Check live" button
  // on a proxy group.
  if (sub === 'proxies/check-bulk' && req.method === 'POST') {
    const body = await readJson(req)
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : []
    const targets = ids
      .map((id) => config.proxies.find((p) => p.id === id && p.ownerId === user.id))
      .filter(Boolean)
    if (!targets.length) return sendJson(res, 400, { error: 'no proxies matched' })
    const results = await Promise.all(targets.map(async (p) => {
      if (p.status === 'expired') return { id: p.id, ok: false, error: 'expired' }
      const r = await remoteCheckProxy(p)
      p.lastCheckedAt = new Date().toISOString(); p.lastCheckOk = r.ok
      updateSlaTick(p.id, r.ok)
      return { id: p.id, ...r }
    }))
    await saveConfig()
    return sendJson(res, 200, { total: results.length, ok: results.filter((x) => x.ok).length, results })
  }

  // ── customer: flat session/event feed across all of *their* proxies ──
  // FortiView-style — every closed relay is one row, filterable.
  if (sub === 'proxies/sessions' && req.method === 'GET') {
    if (!sqliteDb) return sendJson(res, 200, { sessions: [], count: 0, total: 0, offset: 0, limit: 0 })
    const sinceMs = Date.now() - Number(url.searchParams.get('hours') || 24) * 3600_000
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 50)))
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
    const host = url.searchParams.get('host') || ''
    const proxyIdF = url.searchParams.get('proxyId') || ''
    const kind = url.searchParams.get('kind') || ''
    const where = ['owner_id = ?', 'ts >= ?']; const args = [user.id, sinceMs]
    if (host) { where.push('host LIKE ?'); args.push(`%${host.toLowerCase()}%`) }
    if (proxyIdF) { where.push('proxy_id = ?'); args.push(proxyIdF) }
    if (kind) { where.push('kind = ?'); args.push(kind) }
    try {
      const total = sqliteDb.prepare(`SELECT COUNT(*) AS n FROM conn_events WHERE ${where.join(' AND ')}`).get(...args).n
      const rows = sqliteDb.prepare(`SELECT id, ts, proxy_id AS proxyId, src, src_port AS srcPort, host, port, up, dn AS down, ms, kind FROM conn_events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
      const proxyById = new Map(config.proxies.filter((p) => p.ownerId === user.id).map((p) => [p.id, p]))
      const sessions = rows.map((r) => {
        const p = proxyById.get(r.proxyId)
        const hostIp = (geoHostToIp.get(r.host) || {}).ip
        const hostG = hostIp ? geoCacheLookup(hostIp) : null
        if (r.host && !hostG) { Promise.resolve().then(() => lookupGeoForHost(r.host)).catch(() => {}) }
        return {
          ...r,
          hostIp: hostIp || null,
          proxyBindIp: p?.bindIp || '',
          proxyPort: p?.port || 0,
          proxyType: p?.type || '',
          proxyZone: p?.zone || p?.region || '',
          hostGeo: hostG && !hostG.failed ? { country: hostG.country, cc: hostG.countryCode } : null
        }
      })
      return sendJson(res, 200, { sessions, count: sessions.length, total, offset, limit })
    } catch (e) { return sendJson(res, 500, { error: e.message }) }
  }
  // ── customer: live connection data for one of *their* proxies ──
  // Returns the same shape as /api/admin/connections (but for one proxy and
  // owner-scoped), plus optional `from`/`to`/`host`/`src` query for SQLite
  // event log. Mirrors the admin endpoint so the customer view can reuse the
  // same components.
  const myConnMatch = sub.match(/^proxies\/([^/]+)\/connections$/)
  if (myConnMatch && req.method === 'GET') {
    const proxy = config.proxies.find((p) => p.id === myConnMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    const s = ensureStats(proxy.id)
    const top = []
    for (const [host, v] of s.topTargets) top.push({ host, count: v.count, bytesUp: v.bytesUp, bytesDown: v.bytesDown, lastTs: v.lastTs })
    top.sort((a, b) => (b.bytesUp + b.bytesDown) - (a.bytesUp + a.bytesDown))
    // Pull SQLite history if available (filterable)
    let events = (s.recentConns || []).slice(-30).reverse()
    if (sqliteDb) {
      const from = Number(url.searchParams.get('from') || 0)
      const to = Number(url.searchParams.get('to') || Date.now())
      const hostQ = url.searchParams.get('host') || ''
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)))
      const where = ['proxy_id = ?', 'owner_id = ?']; const args = [proxy.id, user.id]
      if (from) { where.push('ts >= ?'); args.push(from) }
      if (to)   { where.push('ts <= ?'); args.push(to) }
      if (hostQ){ where.push('host LIKE ?'); args.push(`%${hostQ.toLowerCase()}%`) }
      try {
        events = sqliteDb.prepare(`SELECT ts, src, host, port, up, dn AS down, ms, kind FROM conn_events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`).all(...args, limit)
      } catch { /* keep in-memory fallback */ }
    }
    // Enrich with geo (sync, cache-only).
    const enrichHostByName = (host) => {
      const ip = (geoHostToIp.get(host) || {}).ip
      const g = ip ? geoCacheLookup(ip) : null
      return g && !g.failed ? { country: g.country, cc: g.countryCode } : null
    }
    top.forEach((t) => { t.geo = enrichHostByName(t.host) })
    events.forEach((e) => { e.hostGeo = enrichHostByName(e.host) })
    return sendJson(res, 200, {
      proxyId: proxy.id,
      bindIp: proxy.bindIp,
      port: proxy.port,
      type: proxy.type,
      zone: proxy.zone || proxy.region || '',
      active: s.activeConnections || 0,
      total: s.totalConnections || 0,
      uploadBytes: s.uploadBytes || 0,
      downloadBytes: s.downloadBytes || 0,
      monthBytes: s.monthBytes || 0,
      bpsIn: s.bpsIn || 0,
      bpsOut: s.bpsOut || 0,
      topTargets: top.slice(0, 20),
      events
    })
  }
  // ── customer: aggregate connections summary across *all* their proxies ──
  if (sub === 'proxies/connections/summary' && req.method === 'GET') {
    const ownedProxies = config.proxies.filter((p) => p.ownerId === user.id)
    let active = 0, total = 0, up = 0, down = 0, month = 0
    const allTop = new Map()
    for (const p of ownedProxies) {
      const s = ensureStats(p.id)
      active += s.activeConnections || 0
      total += s.totalConnections || 0
      up += s.uploadBytes || 0
      down += s.downloadBytes || 0
      month += s.monthBytes || 0
      for (const [host, v] of s.topTargets) {
        const cur = allTop.get(host) || { host, count: 0, bytesUp: 0, bytesDown: 0, lastTs: 0 }
        cur.count += v.count; cur.bytesUp += v.bytesUp; cur.bytesDown += v.bytesDown; cur.lastTs = Math.max(cur.lastTs, v.lastTs)
        allTop.set(host, cur)
      }
    }
    const top = [...allTop.values()].sort((a, b) => (b.bytesUp + b.bytesDown) - (a.bytesUp + a.bytesDown)).slice(0, 20)
    // Accurate cumulative transferred bytes over 1h/24h/30d (from conn_events),
    // split up/down — the "tổng lưu lượng" the customer actually wants, vs the
    // since-restart in-memory counters above.
    const windows = connWindowTotals({ by: 'owner', id: user.id })
    return sendJson(res, 200, { proxies: ownedProxies.length, active, total, uploadBytes: up, downloadBytes: down, monthBytes: month, topTargets: top, windows })
  }
  // ── customer: speed test through their own proxy ──
  // Server dials self via the proxy and downloads a sample payload from a
  // public sink (no external dependencies) to measure throughput + latency.
  // Bounded to 4MB so a bad target can't bog down the API.
  const mySpeedTest = sub.match(/^proxies\/([^/]+)\/speedtest$/)
  if (mySpeedTest && req.method === 'POST') {
    const proxy = config.proxies.find((p) => p.id === mySpeedTest[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    const sample = await runSpeedTest(proxy)
    return sendJson(res, 200, sample)
  }
  const myProxyMatch = sub.match(/^proxies\/([^/]+)\/(rotate|check|extend|sla|history|whitelist)$/)
  if (myProxyMatch) {
    const proxy = config.proxies.find((p) => p.id === myProxyMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    const act = myProxyMatch[2]
    if (act === 'rotate' && req.method === 'POST') {
      if (proxy.type !== 'IPv6') return sendJson(res, 400, { error: 'rotate only supported on IPv6 proxies' })
      try {
        const next = pickBindIp(proxy.type, proxy.nodeId)
        if (!next) return sendJson(res, 409, { error: 'no IPv6 in pool' })
        proxy.bindIp = next
        await saveConfig()
        return sendJson(res, 200, publicProxy(proxy))
      } catch (e) { return sendJson(res, 500, { error: e.message }) }
    }
    if (act === 'check' && req.method === 'POST') {
      if (proxy.status === 'expired') return sendJson(res, 200, { ok: false, error: 'expired' })
      const r = await remoteCheckProxy(proxy)
      proxy.lastCheckedAt = new Date().toISOString(); proxy.lastCheckOk = r.ok
      // Reset status: a successful check unblocks 'error', a failure escalates.
      if (r.ok) {
        proxy.checkFailCount = 0
        if (proxy.status === 'error') proxy.status = 'active'
      } else {
        proxy.checkFailCount = (Number(proxy.checkFailCount) || 0) + 1
      }
      updateSlaTick(proxy.id, r.ok)
      await saveConfig()
      return sendJson(res, 200, { proxy: publicProxy(proxy), ...r })
    }
    if (act === 'extend' && req.method === 'POST') {
      // Buy more hours for an existing proxy. Cost = perHour Ã— hours.
      const body = await readJson(req)
      const hours = Math.max(1, Math.min(8760, Number(body.hours) || 24))
      if (!config.pricing) config.pricing = defaultPricing()
      migratePricingToHourly()
      const perHour = (proxy.type === 'IPv6' ? config.pricing.ipv6 : config.pricing.ipv4).perHour || 0
      const cost = perHour * hours
      if (userBalance(user.id) < cost) return sendJson(res, 402, { error: 'insufficient balance', required: cost, balance: userBalance(user.id) })
      // Push expires forward from the LATER of (now, current expires).
      const curMs = proxy.expiresAt ? Math.max(Date.now(), new Date(proxy.expiresAt).getTime()) : Date.now()
      const newAt = new Date(curMs + hours * 3600_000)
      proxy.expiresAt = newAt.toISOString()
      proxy.expires = newAt.toISOString().slice(0, 10)
      if (proxy.status === 'grace' || proxy.status === 'expired') proxy.status = 'active'
      recordBillingTx(user.id, 'purchase', cost, `extend ${proxy.id} +${hours}h`)
      await saveConfig()
      return sendJson(res, 200, { proxy: publicProxy(proxy), balance: userBalance(user.id) })
    }
    if (act === 'sla' && req.method === 'GET') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), 365)
      return sendJson(res, 200, { id: proxy.id, days, ...(slaPercent(proxy.id, days) || { pct: 100, samples: 0 }) })
    }
    if (act === 'history' && req.method === 'GET') {
      const hours = Math.min(Math.max(Number(url.searchParams.get('hours') || 24), 1), 720)
      if (sqliteDb) {
        try {
          const rows = sqliteDb.prepare('SELECT hour, upload_bytes AS uploadBytes, download_bytes AS downloadBytes, bps_in AS bpsIn, bps_out AS bpsOut FROM history WHERE proxy_id = ? ORDER BY hour DESC LIMIT ?').all(proxy.id, hours).reverse()
          return sendJson(res, 200, { id: proxy.id, samples: rows })
        } catch { /* fall through */ }
      }
      return sendJson(res, 200, { id: proxy.id, samples: [] })
    }
    if (act === 'whitelist' && req.method === 'GET') {
      return sendJson(res, 200, { allowedSrcIps: proxy.allowedSrcIps || [] })
    }
    if (act === 'whitelist' && req.method === 'PUT') {
      const body = await readJson(req)
      const raw = Array.isArray(body.allowedSrcIps) ? body.allowedSrcIps : []
      const entries = raw
        .map((s) => String(s || '').trim())
        .filter((s) => parseCidrEntry(s) !== null)
        .slice(0, 20)
      proxy.allowedSrcIps = entries
      // Notes map: ip→note (each note ≤ 32 chars). Stored separately to keep
      // the runtime whitelist check fast (just array of strings).
      if (body.notes && typeof body.notes === 'object') {
        const notes = {}
        for (const ip of entries) {
          const n = String(body.notes[ip] || '').trim().slice(0, 32)
          if (n) notes[ip] = n
        }
        proxy.allowedSrcIpNotes = notes
      }
      await saveConfig()
      audit({ actor: user.email, ip: clientIp(req), method: 'PUT', path: url.pathname, note: `whitelist=${entries.length} entries` })
      return sendJson(res, 200, { allowedSrcIps: entries, allowedSrcIpNotes: proxy.allowedSrcIpNotes || {} })
    }
  }

  // ── Quick-test: tunnel via proxy → api.ipify.org → return exit IP + headers
  const quickTestMatch = sub.match(/^proxies\/([^/]+)\/quick-test$/)
  if (quickTestMatch && req.method === 'POST') {
    const proxy = config.proxies.find((p) => p.id === quickTestMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    if (proxy.status === 'expired') return sendJson(res, 400, { error: 'proxy is expired' })
    const rateErr = rateCheck(user.id, 'quick-test', 30)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'quick-test')
    try {
      // Use the proxy's own credentials + listen address — same path as a real
      // customer connection. checkExternalProxy expects { type, host, port, username, password }.
      const host = customerFacingHost(proxy) || proxy.listenHost
      const r = await checkExternalProxy({
        type: 'http',
        host,
        port: Number(proxy.port),
        username: proxy.username,
        password: proxy.password
      }, 12_000)
      return sendJson(res, 200, {
        proxyId: proxy.id,
        host,
        port: proxy.port,
        egressIp: proxy.bindIp,
        ...r
      })
    } finally {
      rateRelease(user.id, 'quick-test')
    }
  }

  // ── Activity timeline: read audit table filtered by this proxy id.
  const activityMatch = sub.match(/^proxies\/([^/]+)\/activity$/)
  if (activityMatch && req.method === 'GET') {
    const proxy = config.proxies.find((p) => p.id === activityMatch[1] && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200)
    if (!sqliteDb) return sendJson(res, 200, { events: [] })
    try {
      const rows = sqliteDb.prepare(
        "SELECT ts, actor, method, path, note FROM audit WHERE note LIKE ? OR path LIKE ? ORDER BY ts DESC LIMIT ?"
      ).all(`%${proxy.id}%`, `%${proxy.id}%`, limit)
      return sendJson(res, 200, { proxyId: proxy.id, events: rows })
    } catch { return sendJson(res, 200, { events: [] }) }
  }

  if (req.method === 'GET' && sub === 'proxies/export') {
    const fmt = String(url.searchParams.get('format') || 'txt').toLowerCase()
    const owned = config.proxies.filter((p) => p.ownerId === user.id)
    if (fmt === 'json') return sendJson(res, 200, owned.map(publicProxy))
    if (fmt === 'csv') {
      const rows = ['id,type,host,port,username,password,status,expires,egressIp']
      for (const p of owned) rows.push(`${p.id},${p.type},${customerFacingHost(p)},${p.port},${p.username},${p.password},${p.status || 'active'},${p.expires || ''},${p.bindIp}`)
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' }); return res.end(rows.join('\n') + '\n')
    }
    const lines = owned.map((p) => `${customerFacingHost(p)}:${p.port}:${p.username}:${p.password}`)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end(lines.join('\n') + '\n')
  }

  if (req.method === 'GET' && sub === 'orders') {
    const owned = orders.filter((o) => o.ownerId === user.id)
    return sendJson(res, 200, owned)
  }

  // â”€â”€ Customer pricing + zones (visible to authenticated customers) â”€â”€
  if (req.method === 'GET' && sub === 'pricing') {
    if (!config.pricing) config.pricing = defaultPricing()
    migratePricingToHourly()
    return sendJson(res, 200, config.pricing)
  }
  if (req.method === 'GET' && sub === 'zones') {
    if (!config.zones) config.zones = defaultZones()
    // Annotate each zone with how many online nodes it has (so UI can warn "no capacity here")
    const localMatches = ((config.api?.zone || config.api?.region || '').toLowerCase()) ? 1 : 0
    const zones = config.zones.map((z) => {
      const remote = config.nodes.filter((n) => (n.zone || n.region || '') === z.id && nodeIsOnline(n)).length
      const local = ((config.api?.zone || config.api?.region || '').toLowerCase() === z.id) ? 1 : 0
      return { ...z, onlineNodes: remote + local }
    })
    void localMatches
    return sendJson(res, 200, zones)
  }

  // ── Hub catalog: rentable VPS plans backed by Virtualizor ──────────────
  // GET  /api/v1/user/hub-plans            → public catalog (no vz.* leaked)
  // POST /api/v1/user/hubs/buy {planId, hours}  → provision VM + register node
  // GET  /api/v1/user/hubs                 → list customer's active hubs
  // POST /api/v1/user/hubs/:id/extend {hours}
  // DELETE /api/v1/user/hubs/:id           → destroy VM + remove node
  if (req.method === 'GET' && sub === 'hub-plans') {
    // Filter out plans whose Virtualizor instance is missing/disabled — the
    // customer can only see plans we can actually provision.
    const list = (config.hubPlans || []).filter((p) => {
      if (p.enabled === false) return false
      const inst = findVirtualizorInstance({ id: p.vz?.instanceId, zone: p.region })
      return !!inst
    }).map(publicHubPlan)
    return sendJson(res, 200, list)
  }
  if (req.method === 'GET' && sub === 'hub-zones') {
    // Zone catalog for the hub buy flow — derived from enabled Virtualizor
    // instances + only the zones that have at least 1 enabled plan.
    const zoneMap = new Map()
    for (const inst of (config.virtualizors || [])) {
      if (!inst.enabled || !inst.zone) continue
      if (!zoneMap.has(inst.zone)) zoneMap.set(inst.zone, { id: inst.zone, instanceLabels: [], planCount: 0 })
      zoneMap.get(inst.zone).instanceLabels.push(inst.label)
    }
    for (const p of (config.hubPlans || [])) {
      if (p.enabled === false || !p.region) continue
      if (zoneMap.has(p.region)) zoneMap.get(p.region).planCount += 1
    }
    // Decorate with zone metadata from config.zones (name, flag) when available
    const out = []
    for (const z of zoneMap.values()) {
      if (!z.planCount) continue
      const meta = (config.zones || []).find((zz) => zz.id === z.id)
      out.push({
        id: z.id,
        name: meta?.name || z.id.toUpperCase(),
        flag: meta?.flag || 'GLOBAL',
        planCount: z.planCount,
        sub: z.instanceLabels.join(', ')
      })
    }
    return sendJson(res, 200, out)
  }
  if (req.method === 'POST' && sub === 'hubs/buy') {
    const body = await readJson(req)
    const planId = String(body.planId || '')
    const plan = (config.hubPlans || []).find((p) => p.id === planId && p.enabled !== false)
    if (!plan) return sendJson(res, 404, { error: 'hub plan not found' })
    const hours = Math.max(plan.minHours || 1, Math.min(plan.maxHours || 8760, Number(body.hours) || 1))
    const totalCost = Math.ceil(hours * (plan.hourlyPrice || 0))
    const hubCredit = previewScopedCredit(user.id, 'hub', totalCost)
    const hubWalletCharge = totalCost - hubCredit.applied
    const balance = userBalance(user.id)
    if (balance < hubWalletCharge) {
      return sendJson(res, 402, { error: `Số dư không đủ. Cần ${hubWalletCharge} ${plan.currency}, hiện có ${balance}.`, totalCost, creditApplied: hubCredit.applied, balance })
    }
    // Quota check
    if (plan.maxQuantity > 0) {
      const used = (config.nodes || []).filter((n) => n.hub?.planId === plan.id && n.status !== 'destroyed').length
      if (used >= plan.maxQuantity) return sendJson(res, 409, { error: 'hub plan đã hết slot — thử plan khác' })
    }
    // Rate-limit: max 5 hub provisions per 5 minutes per user
    if (!user._hubProvisions) user._hubProvisions = []
    const cutoff = Date.now() - 5 * 60_000
    user._hubProvisions = user._hubProvisions.filter((t) => t > cutoff)
    if (user._hubProvisions.length >= 5) return sendJson(res, 429, { error: 'too many provisions; wait 5 min' })
    user._hubProvisions.push(Date.now())

    // Pick the right Virtualizor instance by plan.vz.instanceId or fall back
    // to the legacy single-instance config when plans don't carry an instance.
    const vzInst = plan.vz?.instanceId ? findVirtualizorInstance({ id: plan.vz.instanceId }) : null
    const cfg = vzInst ? decryptVirtualizorInstance(vzInst) : decryptedVirtualizorConfig()
    if (!cfg) return sendJson(res, 503, { error: 'hub provisioning offline — contact admin (no Virtualizor instance configured for this plan)' })

    // We bootstrap via SSH after `addvs`, so we do NOT embed the user's API
    // token in `cloud_user_data` — that would leak the token into Virtualizor's
    // VPS metadata (visible to any panel admin and persisted on disk). The
    // user_data here is a benign no-op kept only so the addvs call shape is
    // unchanged; the real install is run by bootstrapHubViaSsh() over SSH.
    const cloudInit = `#cloud-config\n# bootstrap handled by ProxyBox over SSH\n`
    const rootPass = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'Proxy' + crypto.randomBytes(4).toString('hex')
    const hostname = `hub-${user.id.replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`

    // Virtualizor needs an end-user (uid) to own the VPS. Resolve / create
    // it lazily; uid is cached per VZ instance on the user record so the
    // next buy on the same panel is a no-op.
    let vzUid
    try {
      vzUid = await ensureUserVzUid(user, vzInst?.id || 'legacy', cfg)
      await saveConfig()
    } catch (e) {
      return sendJson(res, 502, { error: `Virtualizor user setup failed: ${e.message}` })
    }

    // Virtualizor's `plid` is a reference but the API still requires explicit
    // resource fields (ram in MB, space in GB, bandwidth in GB). Use the hub
    // plan's spec as the source of truth so the customer sees the same numbers
    // the admin promised them.
    //
    // IP allocation strategy (mirrors our proxy mechanism):
    //   - IPv4 hub:  N public IPv4 (egress = these IPs)
    //   - IPv6 hub:  1 IPv4 (used as the connect host) + 1 /48 IPv6 subnet
    //                (proxies bind to v4 host:port, egress out via v6 from /48).
    //                Same model as the existing IPv6 proxy fleet.
    const specs = plan.specs || {}
    const isIpv6Hub = plan.family === 'ipv6'
    const wantedIps = Math.max(1, Math.round(specs.ipv4Count || 1))
    // Pre-flight: confirm the requested IPv4 pool actually has free addresses
    // before charging the customer. Virtualizor would silently provision an
    // IPv6-only VPS otherwise (we tested both `ips=<explicit>` and
    // `num_ips=1` — explicit is ignored, count-based throws "Insufficient
    // IPv4" without telling us which pool). Helper paginates with
    // reslen=5000 so heavily-allocated pools (~500+ records) report
    // accurate free count, not a 500-record-window truncation.
    if (plan.vz?.ipPool) {
      try {
        const free = await virtualizor.findFreeIpsInPool(cfg, plan.vz.ipPool, wantedIps)
        if (free.length < wantedIps) {
          return sendJson(res, 503, {
            error: `Hub pool ${plan.vz.ipPool} hết IPv4 (cần ${wantedIps}, còn ${free.length}). Admin cần thêm IP vào pool Virtualizor.`
          })
        }
      } catch (e) { /* pre-flight non-fatal — let addvs try anyway */ }
    }
    let provision
    try {
      provision = await virtualizor.addVs(cfg, {
        virt: plan.vz?.virt || 'kvm',
        serverId: plan.vz?.serverId,
        planId: plan.vz?.planId,
        osId: plan.vz?.osId,
        ipPool: plan.vz?.ipPool,
        ip6Pool: plan.vz?.ip6Pool,
        diskTemplate: plan.vz?.diskTemplate,
        hostname,
        rootPass,
        uid: vzUid,
        userData: cloudInit,
        numIps: wantedIps,
        numIp6Subnets: isIpv6Hub ? 1 : 0,
        ram: Math.max(256, Math.round((specs.ramGB || 1) * 1024)),
        space: Math.max(5, Math.round(specs.diskGB || 10)),
        cores: Math.max(1, Math.round(specs.cpu || 1)),
        bandwidth: Math.max(0, Math.round(specs.bandwidthGB || 0))
      })
    } catch (e) {
      return sendJson(res, 502, { error: `Virtualizor provision failed: ${e.message}` })
    }
    // Charge wallet now that VM is provisioned. Virtualizor's `addvs` returns
    // the new vpsid in one of three shapes depending on version:
    //   { done: "28" }            ← 3.x most common (string scalar)
    //   { done: { vpsid: 28 } }   ← legacy
    //   { vpsid: 28 }             ← bare
    let vpsidRaw = provision?.done?.vpsid || provision?.vpsid || provision?.done
    if (typeof vpsidRaw === 'object') vpsidRaw = vpsidRaw?.vpsid
    const vpsid = Number(vpsidRaw)
    if (!vpsid) {
      return sendJson(res, 502, { error: 'Virtualizor accepted request but returned no vpsid', raw: provision })
    }
    const hubCreditFinal = previewScopedCredit(user.id, 'hub', totalCost)
    commitScopedCredit(hubCreditFinal.plan)
    const hubCharge = totalCost - hubCreditFinal.applied
    if (hubCharge > 0) recordBillingTx(user.id, 'spend', -hubCharge, `hub-buy ${plan.id} ${hours}h vpsid=${vpsid}${hubCreditFinal.applied ? ` credit=-${hubCreditFinal.applied}` : ''}`)

    // Fetch the actual IPs assigned to this VPS — Virtualizor populates these
    // post-addvs (the addvs response itself only has pool intent, not the
    // final mapping). We need the IPv4 so SSH-bootstrap knows where to dial.
    let vpsIpv4 = null, vpsIpv6 = null
    try {
      const detail = await virtualizor.vsDetail(cfg, vpsid)
      const ips = detail?.vps?.ips || detail?.vps?.ips_v6 || {}
      for (const v of Object.values(ips || {})) {
        const ip = typeof v === 'string' ? v : v?.ip
        if (!ip) continue
        if (!vpsIpv4 && net.isIP(ip.split('/')[0]) === 4) vpsIpv4 = ip
        if (!vpsIpv6 && ip.includes(':')) vpsIpv6 = ip.split('/')[0]
      }
    } catch (e) { console.warn('[hub-buy] vsDetail failed:', e.message) }

    const node = {
      id: `node-${crypto.randomBytes(4).toString('hex')}`,
      name: hostname,
      host: vpsIpv4 || hostname,                  // SSH + customer connect host
      family: plan.family === 'ipv4' ? 'ipv4' : (plan.family === 'ipv6' ? 'ipv6' : 'dual'),
      ownerId: user.id,
      tag: 'hub',
      status: 'provisioning',
      claimMethod: 'hub',
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      agentToken: null,
      enrollToken: null,
      hub: {
        planId: plan.id,
        vpsid,
        provisionedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
        hoursPaid: hours,
        hourlyPrice: plan.hourlyPrice,
        rootPassEncrypted: encryptSecret(rootPass),
        ipv4: vpsIpv4,
        ipv6: vpsIpv6,
        instanceId: vzInst?.id || null,
        state: 'provisioning'
      }
    }
    config.nodes.push(node)
    await saveConfig()
    audit({ actor: user.email || user.id, ip: clientIp(req), method: 'POST', path: '/api/v1/user/hubs/buy', note: `hub-buy ${plan.id} vpsid=${vpsid} ipv4=${vpsIpv4} hours=${hours} cost=${totalCost}` })

    // Background SSH bootstrap — most VZ OS templates don't ship cloud-init
    // so we install the agent ourselves once the VPS unlocks. Fire-and-forget;
    // status is reported on the node entry via hub.state and hub.bootstrapLog.
    bootstrapHubViaSsh(node, user, plan).catch((e) => { console.warn('[hub-bootstrap]', node.id, e.message) })
    return sendJson(res, 201, {
      ok: true,
      nodeId: node.id,
      vpsid,
      hostname,
      provisionedAt: node.hub.provisionedAt,
      expiresAt: node.hub.expiresAt,
      totalCost,
      balance: balance - totalCost,
      hint: 'VM đang khởi tạo — agent sẽ tự đăng ký trong 1-3 phút. Refresh trang /my-nodes để theo dõi.'
    })
  }
  if (req.method === 'GET' && sub === 'hubs') {
    const hubs = (config.nodes || []).filter((n) => n.ownerId === user.id && n.hub).map((n) => {
      const plan = (config.hubPlans || []).find((p) => p.id === n.hub.planId)
      return {
        ...publicNodeForCustomer(n),
        hub: {
          planId: n.hub.planId,
          planName: plan?.name || null,
          vpsid: n.hub.vpsid,
          provisionedAt: n.hub.provisionedAt,
          expiresAt: n.hub.expiresAt,
          hoursPaid: n.hub.hoursPaid,
          hourlyPrice: plan?.hourlyPrice || 0,
          state: n.hub.state || 'unknown'
        }
      }
    })
    return sendJson(res, 200, hubs)
  }
  const hubExtendMatch = sub.match(/^hubs\/([^/]+)\/extend$/)
  if (req.method === 'POST' && hubExtendMatch) {
    const node = (config.nodes || []).find((n) => n.id === hubExtendMatch[1] && n.ownerId === user.id && n.hub)
    if (!node) return sendJson(res, 404, { error: 'hub not found' })
    const body = await readJson(req)
    const hours = Math.max(1, Math.min(8760, Number(body.hours) || 24))
    const plan = (config.hubPlans || []).find((p) => p.id === node.hub.planId)
    const price = plan?.hourlyPrice || node.hub.hourlyPrice || 0
    const cost = Math.ceil(hours * price)
    if (userBalance(user.id) < cost) return sendJson(res, 402, { error: `cần ${cost}, không đủ ví` })
    recordBillingTx(user.id, 'spend', -cost, `hub-extend ${node.id} ${hours}h`)
    const baseExpiry = Math.max(Date.now(), new Date(node.hub.expiresAt || 0).getTime())
    node.hub.expiresAt = new Date(baseExpiry + hours * 3600_000).toISOString()
    node.hub.hoursPaid = (node.hub.hoursPaid || 0) + hours
    await saveConfig()
    audit({ actor: user.email || user.id, ip: clientIp(req), method: 'POST', path: url.pathname, note: `hub-extend +${hours}h cost=${cost}` })
    return sendJson(res, 200, { ok: true, expiresAt: node.hub.expiresAt, cost })
  }
  const hubDelMatch = sub.match(/^hubs\/([^/]+)$/)
  if (req.method === 'DELETE' && hubDelMatch) {
    const node = (config.nodes || []).find((n) => n.id === hubDelMatch[1] && n.ownerId === user.id && n.hub)
    if (!node) return sendJson(res, 404, { error: 'hub not found' })
    // Resolve VZ creds: prefer the instance recorded on the NODE at provision
    // time (immutable per VPS) over the plan's current instanceId, which the
    // admin may have re-pointed since purchase. Falling back through:
    //   node.hub.instanceId  →  plan.vz.instanceId  →  legacy single-instance
    const instIdForDel = node.hub.instanceId
      || (config.hubPlans || []).find((p) => p.id === node.hub.planId)?.vz?.instanceId
    const vzInstForDel = instIdForDel ? findVirtualizorInstance({ id: instIdForDel }) : null
    const cfg = vzInstForDel ? decryptVirtualizorInstance(vzInstForDel) : decryptedVirtualizorConfig()
    if (cfg && node.hub.vpsid) {
      try {
        await virtualizor.deleteVs(cfg, node.hub.vpsid)
        console.log(`[hub-del] destroyed vpsid=${node.hub.vpsid} (node=${node.id})`)
      } catch (e) {
        console.warn(`[hub-del] VZ delete failed vpsid=${node.hub.vpsid}: ${e.message}`)
        return sendJson(res, 502, { error: `Không xóa được VPS trên Virtualizor: ${e.message}. Node giữ nguyên để admin xử lý.` })
      }
    } else if (node.hub.vpsid) {
      // We can't reach VZ — refuse to silently drop the node row (would leave
      // the VPS orphaned + still running on the panel costing the operator).
      return sendJson(res, 503, { error: `Không tìm thấy Virtualizor instance cho hub này (instanceId=${instIdForDel || 'none'}). Liên hệ admin.` })
    }
    const removedProxies = (config.proxies || []).filter((p) => p.nodeId === node.id && p.ownerId === user.id)
    for (const p of removedProxies) stopProxy(p.id)
    config.proxies = config.proxies.filter((p) => !(p.nodeId === node.id && p.ownerId === user.id))
    kickAgentEmpty(node.id)
    config.nodes = config.nodes.filter((n) => n.id !== node.id)
    await saveConfig()
    audit({ actor: user.email || user.id, ip: clientIp(req), method: 'DELETE', path: url.pathname, note: `hub destroyed vpsid=${node.hub.vpsid}` })
    return sendJson(res, 200, { ok: true, removedProxies: removedProxies.length })
  }

  // ── BYON: free proxy creation on customer-owned node ────────────────────
  // POST /api/v1/user/proxies/from-own-node
  //   { nodeId, type:"ipv4"|"ipv6", quantity, rotate?, durationDays? }
  // Skips billing entirely. Caps at customer's plan.maxProxies (no quota
  // bypass — prevents pool exhaustion). Customer's own node serves them so
  // bandwidth/CPU cost is on the customer's hardware, not ours.
  if (req.method === 'POST' && sub === 'proxies/from-own-node') {
    const body = await readJson(req)
    const nodeId = String(body.nodeId || '')
    const node = config.nodes.find((n) => n.id === nodeId && n.ownerId === user.id)
    if (!node) return sendJson(res, 404, { error: 'node not found or not owned by you' })
    if (node.disabled) return sendJson(res, 400, { error: 'node is disabled — enable it first' })
    const requestedType = String(body.type || node.family || 'ipv4').toLowerCase() === 'ipv6' ? 'IPv6' : 'IPv4'
    const pf = requestedType === 'IPv6' ? 'ipv6' : 'ipv4'
    const fam = (node.family || '').toLowerCase()
    if (fam && fam !== 'dual' && fam !== pf) {
      return sendJson(res, 400, { error: `node is ${fam}-only — cannot host ${requestedType} proxies` })
    }
    const quantity = Math.max(1, Math.min(50, Number(body.quantity) || 1))
    const durationDays = Math.max(1, Math.min(3650, Number(body.durationDays) || 365))
    const rotate = requestedType === 'IPv6' && Boolean(body.rotate)
    const created = []
    for (let i = 0; i < quantity; i++) {
      const proxy = createProxy({ type: requestedType, rotate, nodeId, durationDays })
      proxy.ownerId = user.id
      proxy.orderId = null   // no paid order
      proxy.byon = true
      proxy.createdAt = new Date().toISOString()
      config.proxies.push(proxy)
      ensureStats(proxy.id)
      created.push(proxy)
    }
    await saveConfig()
    audit({ actor: user.email || user.id, ip: clientIp(req), method: 'POST', path: '/api/v1/user/proxies/from-own-node', note: `BYON x${quantity} ${requestedType} on ${nodeId}` })
    return sendJson(res, 201, {
      ok: true,
      nodeId,
      count: created.length,
      proxies: created.map((p) => ({
        ...publicProxy(p),
        username: p.username, password: p.password
      }))
    })
  }

  // â”€â”€ Customer self-service purchase (HOURLY) â”€â”€
  // POST /api/v1/user/orders { type, quantity, hours, zone?, rotate?, autoRenew? }
  // Only sells by-the-hour. No daily/monthly packages. Zone filter restricts to
  // nodes in the requested geographic zone (e.g. "vn-hcm", "us-east").
  if (req.method === 'POST' && sub === 'orders') {
    if (!config.pricing) config.pricing = defaultPricing()
    migratePricingToHourly()
    if (!config.zones) config.zones = defaultZones()
    const body = await readJson(req)
    const type = String(body.type || 'ipv4').toLowerCase() === 'ipv6' ? 'IPv6' : 'IPv4'
    const quantity = Math.max(1, Math.min(5000, Number(body.quantity) || 1))
    const hours = Math.max(Number(config.pricing.minHours) || 1, Math.min(Number(config.pricing.maxHours) || 8760, Number(body.hours) || Number(body.duration) * 24 || 1))
    const zone = String(body.zone || '').toLowerCase()
    if (zone && !config.zones.find((z) => z.id === zone)) return sendJson(res, 400, { error: `unknown zone: ${zone}` })
    const perHour = type === 'IPv6' ? config.pricing.ipv6.perHour : config.pricing.ipv4.perHour
    let tierDiscount = 0
    const tiers = (config.pricing.tiers || []).filter((t) => quantity >= (t.min || 0)).sort((a, b) => b.min - a.min)
    if (tiers[0]) tierDiscount = Number(tiers[0].discount) || 0
    const base = perHour * hours * quantity
    const totalCost = Math.round(base * (1 - tierDiscount))
    // Scoped free-credit grants for this product type are spent first; the rest is
    // charged to the wallet. Preview here (non-mutating) to size the wallet charge —
    // grants are only deducted on the success path below.
    const creditGroup = type === 'IPv6' ? 'ipv6' : 'ipv4'
    const credit = previewScopedCredit(user.id, creditGroup, totalCost)
    const walletCharge = totalCost - credit.applied
    const balance = userBalance(user.id)
    if (balance < walletCharge) {
      return sendJson(res, 402, { error: 'insufficient balance', required: walletCharge, creditApplied: credit.applied, balance, topupUrl: '/api/v1/user/billing/checkout' })
    }
    // Zone-aware node picking: filter candidates to nodes whose `zone` field
    // matches the customer's requested zone (or any zone if blank). Local control
    // plane node has zone = config.api.region by default.
    const orderId = `ORD-${Date.now().toString().slice(-6)}`
    const created = []
    const expTimes = addHours(hours)
    for (let i = 0; i < quantity; i++) {
      const targetNodeId = pickZoneBalancedNode(type, zone)
      let proxy
      try { proxy = createProxy({ type, rotate: type === 'IPv6' && Boolean(body.rotate), nodeId: targetNodeId, durationDays: Math.ceil(hours / 24), name: `${type} ${zone || 'auto'} ${Date.now()}-${i + 1}` }) }
      catch (e) { return sendJson(res, 400, { error: e.message }) }
      proxy.orderId = orderId
      proxy.ownerId = user.id
      proxy.autoRenew = Boolean(body.autoRenew)
      proxy.expires = expTimes.expires
      proxy.expiresAt = expTimes.expiresAt
      proxy.zone = zone || ''
      config.proxies.push(proxy)
      ensureStats(proxy.id)
      if (targetNodeId === 'local') await startProxy(proxy)
      created.push({ ...publicProxy(proxy), username: proxy.username, password: proxy.password, expiresAt: proxy.expiresAt })
    }
    // Capture the earliest expiry among consumed grants so a later cancel can
    // re-credit the credit portion with the right (non-extended) expiry.
    const creditExpiresAt = credit.plan.length
      ? (credit.plan.map((p) => config.creditGrants.find((g) => g.id === p.id)?.expiresAt || '').filter(Boolean).sort()[0] || '')
      : ''
    const order = {
      id: orderId,
      ownerId: user.id,
      item: `${type} x ${quantity} · ${hours}h${zone ? ' · ' + zone : ''}`,
      amount: totalCost,
      creditApplied: credit.applied,
      creditGroup,
      creditExpiresAt,
      walletCharge,
      hours,
      zone: zone || '',
      type,
      status: 'paid',
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      expiresAt: expTimes.expiresAt,
      proxyIds: created.map((p) => p.id),
      autoRenew: Boolean(body.autoRenew)
    }
    orders.unshift(order)
    commitScopedCredit(credit.plan)        // deduct scoped grants now (success path)
    const newBalance = walletCharge > 0
      ? recordBillingTx(user.id, 'purchase', walletCharge, `order ${orderId}: ${type} x ${quantity} (${hours}h)${credit.applied ? ` credit=-${credit.applied}` : ''}${tierDiscount ? ` tier=-${(tierDiscount * 100).toFixed(0)}%` : ''}`)
      : userBalance(user.id)
    await Promise.all([saveConfig(), saveOrders()])
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/orders', note: `${orderId} base=${base} credit=${credit.applied} wallet=${walletCharge} â†' ${totalCost}; bal=${newBalance}` })
    pushNotification(user.id, { type: 'order', severity: 'success', text: `Đơn ${orderId} đã được cấp ${quantity} proxy ${type} (${hours}h)`, link: `/orders/${orderId}` })
    await saveConfig()
    sendMail({
      to: user.email,
      subject: `ProxyBox: ${quantity} ${type} proxy provisioned (Order ${orderId})`,
      html: `<h2>Your order is ready</h2><p>Order <code>${orderId}</code>: <strong>${quantity} Ã— ${type}</strong> for ${hours} hours.</p><p>Total: <strong>${totalCost.toLocaleString()}</strong> ${(config.pricing.currency || 'vnd').toUpperCase()}${credit.applied ? ` — free credit -${credit.applied.toLocaleString()}, charged from wallet ${walletCharge.toLocaleString()}` : ''}</p><p>Proxies:</p><pre>${created.map((p) => `${customerFacingHost(p)}:${p.port}:${p.username}:${p.password}`).join('\n')}</pre><p>Invoice: <a href="/api/v1/user/orders/${orderId}/invoice">download</a></p>`
    }).catch(() => {})
    if (user.webhookUrl) sendCustomerWebhook(user.webhookUrl, { event: 'order.created', orderId, amount: totalCost, quantity, type, hours }).catch(() => {})
    return sendJson(res, 201, { order, proxies: created, balance: newBalance })
  }

  // Toggle auto-renew on an owned order
  const userOrderMatch = sub.match(/^orders\/([^/]+)$/)
  if (userOrderMatch && req.method === 'PATCH') {
    const order = orders.find((o) => o.id === userOrderMatch[1] && o.ownerId === user.id)
    if (!order) return sendJson(res, 404, { error: 'order not found' })
    const body = await readJson(req)
    if (typeof body.autoRenew === 'boolean') {
      order.autoRenew = body.autoRenew
      for (const p of config.proxies) if (order.proxyIds.includes(p.id)) p.autoRenew = body.autoRenew
      await Promise.all([saveConfig(), saveOrders()])
    }
    return sendJson(res, 200, order)
  }

  // Refund/cancel an owned order â€” prorate based on remaining HOURS, push back to wallet.
  const userOrderCancel = sub.match(/^orders\/([^/]+)\/cancel$/)
  if (userOrderCancel && req.method === 'POST') {
    const order = orders.find((o) => o.id === userOrderCancel[1] && o.ownerId === user.id)
    if (!order) return sendJson(res, 404, { error: 'order not found' })
    if (order.status === 'refunded' || order.status === 'cancelled') return sendJson(res, 409, { error: 'already cancelled' })
    if (!config.pricing) config.pricing = defaultPricing()
    migratePricingToHourly()
    const members = config.proxies.filter((p) => order.proxyIds.includes(p.id))
    let refund = 0
    const now = Date.now()
    for (const p of members) {
      const expMs = p.expiresAt ? new Date(p.expiresAt).getTime() : (p.expires ? new Date(p.expires + 'T23:59:59Z').getTime() : 0)
      if (expMs > now) {
        const hoursLeft = Math.max(0, Math.floor((expMs - now) / 3600_000))
        const perHour = (String(p.type).toLowerCase() === 'ipv6' ? config.pricing.ipv6 : config.pricing.ipv4)?.perHour || 0
        refund += hoursLeft * perHour
      }
      p.status = 'expired'
      if ((p.nodeId || 'local') === 'local') stopProxy(p.id)
    }
    order.status = 'cancelled'
    // Refund the WALLET-paid share to the wallet; RE-CREDIT the prorated free-credit
    // share as a fresh grant. Never let promo credit become withdrawable wallet cash.
    // Old orders (no walletCharge field) fall back to full amount = unchanged.
    const totalVal = Number(order.amount) || 0
    const walletShare = order.walletCharge != null ? Number(order.walletCharge) : totalVal
    const refundWallet = totalVal > 0 ? Math.round(refund * walletShare / totalVal) : 0
    const creditRefund = totalVal > 0 ? Math.round(refund * (Number(order.creditApplied) || 0) / totalVal) : 0
    if (refundWallet > 0) recordBillingTx(user.id, 'refund', refundWallet, `cancel ${order.id} (${members.length} proxies, wallet share)`)
    if (creditRefund > 0) recreditGrant(order, creditRefund)
    await Promise.all([saveConfig(), saveOrders()])
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: `cancel ${order.id}, wallet+${refundWallet} credit+${creditRefund}` })
    return sendJson(res, 200, { ok: true, refund: refundWallet, creditRefund, balance: userBalance(user.id) })
  }

  // HTML invoice â€” printable receipt for an order. Customer can save as PDF via browser print.
  const userInvoice = sub.match(/^orders\/([^/]+)\/invoice$/)
  if (userInvoice && req.method === 'GET') {
    const order = orders.find((o) => o.id === userInvoice[1] && o.ownerId === user.id)
    if (!order) return sendJson(res, 404, { error: 'order not found' })
    const ccy = (config.pricing?.currency || 'vnd').toUpperCase()
    // SECURITY: escape every user-controlled value to defuse XSS via order.item / user.name.
    const html = `<!doctype html><meta charset="utf-8"><title>Invoice ${htmlEscape(order.id)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#0f172a}
h1{margin:0 0 4px} .muted{color:#64748b} table{width:100%;border-collapse:collapse;margin:24px 0}
th,td{padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:left} th{background:#f8fafc}
.right{text-align:right} .total{font-weight:600;font-size:18px}</style>
<h1>ProxyBox Invoice</h1>
<p class="muted">Order ${htmlEscape(order.id)} · ${htmlEscape(order.date)}</p>
<p><strong>Billed to:</strong> ${htmlEscape(user.name)} &lt;${htmlEscape(user.email)}&gt;</p>
<table><thead><tr><th>Item</th><th class="right">Amount</th></tr></thead>
<tbody><tr><td>${htmlEscape(order.item)}</td><td class="right">${Number(order.amount).toLocaleString()} ${ccy}</td></tr></tbody>
<tfoot><tr><td class="right total">Total</td><td class="right total">${Number(order.amount).toLocaleString()} ${ccy}</td></tr></tfoot></table>
<p class="muted" style="margin-top:32px;font-size:12px">Generated by ProxyBox control plane. Status: ${htmlEscape(order.status)}.</p>`
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
    return res.end(html)
  }

  // â”€â”€ TOTP 2FA: enroll, confirm, disable â”€â”€
  if (req.method === 'POST' && sub === 'auth/totp/enroll') {
    if (user.totp && user.totp.secret) return sendJson(res, 409, { error: 'already enrolled â€” disable first' })
    const raw = crypto.randomBytes(20)
    const secret = base32Encode(raw)
    user.totp = { secret, confirmed: false }
    await saveConfig()
    const issuer = 'ProxyBox'
    const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
    return sendJson(res, 200, { secret, otpauthUri })
  }
  if (req.method === 'POST' && sub === 'auth/totp/confirm') {
    if (!user.totp || !user.totp.secret) return sendJson(res, 400, { error: 'enroll first' })
    const body = await readJson(req)
    if (!verifyTotp(user.totp.secret, String(body.code || ''))) return sendJson(res, 400, { error: 'wrong code' })
    user.totp.confirmed = true
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: '2FA enabled' })
    return sendJson(res, 200, { ok: true })
  }
  if (req.method === 'POST' && sub === 'auth/totp/disable') {
    const body = await readJson(req)
    if (user.totp && user.totp.secret) {
      if (!verifyTotp(user.totp.secret, String(body.code || ''))) return sendJson(res, 400, { error: 'wrong code' })
    }
    user.totp = null
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: '2FA disabled' })
    return sendJson(res, 200, { ok: true })
  }

  // â”€â”€ Account management â”€â”€
  if (req.method === 'GET' && sub === 'account') {
    return sendJson(res, 200, {
      id: user.id, name: user.name, email: user.email, role: user.role,
      apiKey: user.apiKey || '', referralCode: user.referralCode || '',
      tosAcceptedAt: user.tosAcceptedAt || null,
      webhookUrl: user.webhookUrl || '',
      webhookEvents: Array.isArray(user.webhookEvents) ? user.webhookEvents : [],
      totpEnabled: !!(user.totp && user.totp.confirmed),
      balance: userBalance(user.id)
    })
  }
  // Subscription token — used in the public /api/sub/<token> URL. Auto-
  // generated the first time the customer hits this endpoint so existing
  // accounts get one lazily without a migration. POST /rotate burns the
  // old token (invalidates any subscription links shared elsewhere).
  if (req.method === 'GET' && sub === 'account/subscription') {
    if (!user.subscriptionToken) {
      user.subscriptionToken = crypto.randomBytes(20).toString('hex')
      await saveConfig()
    }
    const base = (config.api?.publicUrl || `http://${req.headers.host || '127.0.0.1:8787'}`).replace(/\/$/, '')
    const fmts = ['sub', 'clash', 'surge', 'plain', 'json']
    const urls = Object.fromEntries(fmts.map((f) => [f, `${base}/api/sub/${user.subscriptionToken}?format=${f}`]))
    return sendJson(res, 200, { token: user.subscriptionToken, urls })
  }
  if (req.method === 'POST' && sub === 'account/subscription/rotate') {
    user.subscriptionToken = crypto.randomBytes(20).toString('hex')
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: 'subscription token rotated' })
    return sendJson(res, 200, { token: user.subscriptionToken })
  }
  if (req.method === 'POST' && sub === 'account/regenerate-api-key') {
    user.apiKey = generateUserToken(user.id)
    user.fleetTokens = []   // legacy slot cleared on rotation — single-source-of-truth
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: 'rotated unified token (api+fleet)' })
    return sendJson(res, 200, { apiKey: user.apiKey })
  }
  if (req.method === 'PATCH' && sub === 'account/webhook') {
    const body = await readJson(req)
    const candidate = String(body.url || '').slice(0, 500).trim()
    if (candidate && !(await isSafeOutboundUrl(candidate))) {
      return sendJson(res, 400, { error: 'webhook URL must be public http(s); private/loopback/metadata IPs are blocked' })
    }
    user.webhookUrl = candidate
    if (Array.isArray(body.events)) {
      const ALLOWED = new Set(['proxy.expired', 'proxy.expiringSoon', 'proxy.checkFailed', 'proxy.ipRotated'])
      user.webhookEvents = body.events.filter((e) => ALLOWED.has(e)).slice(0, 10)
    }
    await saveConfig()
    return sendJson(res, 200, { webhookUrl: user.webhookUrl, webhookEvents: user.webhookEvents || [] })
  }
  // Test webhook: dispatches a sample event so customer can verify the URL.
  if (req.method === 'POST' && sub === 'account/webhook/test') {
    if (!user.webhookUrl) return sendJson(res, 400, { error: 'no webhook URL configured' })
    dispatchWebhook(user.id, 'proxy.checkFailed', { proxyId: 'TEST', bindIp: '127.0.0.1', port: 0, consecutiveFails: 3, test: true })
    return sendJson(res, 200, { ok: true, sent: true })
  }
  if (req.method === 'POST' && sub === 'account/change-password') {
    const body = await readJson(req)
    if (!verifyPassword(String(body.oldPassword || ''), user.passwordHash)) return sendJson(res, 401, { error: 'old password incorrect' })
    const np = String(body.newPassword || '')
    if (np.length < 8) return sendJson(res, 400, { error: 'new password must be 8+ chars' })
    user.passwordHash = hashPassword(np)
    await saveConfig()
    // Invalidate all existing sessions for this user.
    for (const [tk, s] of sessions) if (s.userId === user.id) sessions.delete(tk)
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: url.pathname, note: 'password changed; sessions revoked' })
    sendMail({ to: user.email, subject: 'Password changed', text: 'Your ProxyBox password was just changed. If this was not you, reset immediately.' }).catch(() => {})
    return sendJson(res, 200, { ok: true })
  }

  // Customer bandwidth dashboard summary â€” aggregates total upload/download
  // per-proxy + hourly trend last 24h. Powers the CustomerUsage view.
  if (req.method === 'GET' && sub === 'usage/summary') {
    const ownedIds = config.proxies.filter((p) => p.ownerId === user.id).map((p) => p.id)
    if (ownedIds.length === 0) return sendJson(res, 200, { totals: { upload: 0, download: 0, conns: 0 }, windows: emptyWindows(), perProxy: [], hourly: [] })
    let perProxy = []
    let hourly = []
    let totalUp = 0; let totalDn = 0; let totalConns = 0
    // Per-proxy stats from in-memory stats Map (more current than SQLite history).
    for (const id of ownedIds) {
      const s = stats.get(id)
      const p = config.proxies.find((x) => x.id === id)
      if (!p) continue
      const up = Number(s?.uploadBytes || 0)
      const dn = Number(s?.downloadBytes || 0)
      const month = Number(s?.monthBytes || 0)
      const conns = Number(s?.totalConnections || 0)
      totalUp += up; totalDn += dn; totalConns += conns
      perProxy.push({
        id, name: p.name, type: p.type, bindIp: p.bindIp, port: p.port,
        zone: p.zone || p.region || '',
        status: p.status,
        uploadBytes: up, downloadBytes: dn, monthBytes: month,
        totalConnections: conns,
        bpsIn: Number(s?.bpsIn || 0), bpsOut: Number(s?.bpsOut || 0)
      })
    }
    // 24h hourly buckets aggregated across all owned proxies.
    if (sqliteDb) {
      try {
        const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 13)
        const placeholders = ownedIds.map(() => '?').join(',')
        hourly = sqliteDb.prepare(`
          SELECT hour, SUM(upload_bytes) AS uploadBytes, SUM(download_bytes) AS downloadBytes,
                 SUM(bps_in) AS bpsIn, SUM(bps_out) AS bpsOut
          FROM history WHERE proxy_id IN (${placeholders}) AND hour >= ?
          GROUP BY hour ORDER BY hour
        `).all(...ownedIds, since)
      } catch { /* leave empty */ }
    }
    // Accurate per-proxy transferred bytes over 24h / 30d windows, summed from
    // conn_events in one grouped pass — lets the customer see which port moved
    // the most data (not the misleading since-restart in-memory counters).
    if (sqliteDb && ownedIds.length) {
      try {
        const now = Date.now()
        const c24 = now - 86_400_000
        const c30 = now - 2_592_000_000
        const ph = ownedIds.map(() => '?').join(',')
        // owner_id scope is essential: proxy ports get recycled between
        // customers, so without it a recycled port would surface a previous
        // owner's traffic (data leak + quota inflation).
        const rows = sqliteDb.prepare(`
          SELECT proxy_id,
            COALESCE(SUM(CASE WHEN ts >= ? THEN up ELSE 0 END), 0) AS up24,
            COALESCE(SUM(CASE WHEN ts >= ? THEN dn ELSE 0 END), 0) AS dn24,
            COALESCE(SUM(up), 0) AS up30,
            COALESCE(SUM(dn), 0) AS dn30
          FROM conn_events WHERE proxy_id IN (${ph}) AND owner_id = ? AND ts >= ?
          GROUP BY proxy_id
        `).all(c24, c24, ...ownedIds, user.id, c30)
        const byId = new Map(rows.map((r) => [r.proxy_id, r]))
        for (const e of perProxy) {
          const r = byId.get(e.id)
          e.win24 = { up: Number(r?.up24) || 0, down: Number(r?.dn24) || 0 }
          e.win30 = { up: Number(r?.up30) || 0, down: Number(r?.dn30) || 0 }
        }
      } catch { /* leave windows absent — UI falls back to in-memory */ }
    }
    // Sort perProxy by 30d transferred bytes desc (accurate) so the heaviest
    // ports surface first; fall back to since-restart counters when absent.
    const ppTotal = (e) => e.win30 ? (e.win30.up + e.win30.down) : (e.uploadBytes + e.downloadBytes)
    perProxy.sort((a, b) => ppTotal(b) - ppTotal(a))
    return sendJson(res, 200, {
      totals: { upload: totalUp, download: totalDn, conns: totalConns, proxyCount: ownedIds.length },
      quotaGB: Number(config.pricing?.bandwidthQuotaGB) || 0,
      windows: connWindowTotals({ by: 'owner', id: user.id }),
      perProxy,
      hourly
    })
  }

  // Usage analytics (aggregated across owned proxies, last 7 days)
  if (req.method === 'GET' && sub === 'usage') {
    const days = Math.min(Math.max(Number(url.searchParams.get('days') || 7), 1), 30)
    const owned = new Set(config.proxies.filter((p) => p.ownerId === user.id).map((p) => p.id))
    if (sqliteDb && owned.size) {
      try {
        const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 13)
        const placeholders = Array.from(owned).map(() => '?').join(',')
        const rows = sqliteDb.prepare(`SELECT hour, SUM(upload_bytes) AS uploadBytes, SUM(download_bytes) AS downloadBytes FROM history WHERE proxy_id IN (${placeholders}) AND hour >= ? GROUP BY hour ORDER BY hour`).all(...Array.from(owned), cutoff)
        return sendJson(res, 200, { days, ownedCount: owned.size, hourly: rows })
      } catch { /* fall through */ }
    }
    return sendJson(res, 200, { days, ownedCount: owned.size, hourly: [] })
  }

  // GDPR data export â€” dump everything we have about this user
  if (req.method === 'GET' && sub === 'gdpr/export') {
    const proxies = config.proxies.filter((p) => p.ownerId === user.id).map(publicProxy)
    const userOrders = orders.filter((o) => o.ownerId === user.id)
    let txs = []
    if (sqliteDb) try { txs = sqliteDb.prepare('SELECT * FROM billing_tx WHERE user_id = ? ORDER BY ts DESC').all(user.id) } catch {}
    let audits = []
    if (sqliteDb) try { audits = sqliteDb.prepare('SELECT ts, actor, ip, method, path FROM audit WHERE actor = ? ORDER BY id DESC LIMIT 1000').all(user.email) } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="proxyhub-data-${user.id}.json"` })
    return res.end(JSON.stringify({
      generatedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, name: user.name, role: user.role, tosAcceptedAt: user.tosAcceptedAt, referralCode: user.referralCode, referredBy: user.referredBy },
      balance: userBalance(user.id),
      proxies, orders: userOrders, transactions: txs, audits
    }, null, 2))
  }

  const orderMatch = sub.match(/^orders\/([^/]+)$/)
  if (orderMatch && req.method === 'GET') {
    const order = orders.find((o) => o.id === orderMatch[1] && o.ownerId === user.id)
    if (!order) return sendJson(res, 404, { error: 'order not found' })
    const ids = new Set(order.proxyIds || [])
    const members = config.proxies.filter((p) => ids.has(p.id)).map(publicProxy)
    return sendJson(res, 200, { ...order, proxies: members })
  }

  // â”€â”€ Affiliate: referral code stats + list of users who signed up via this code â”€â”€
  if (req.method === 'GET' && sub === 'affiliate') {
    const referredUsers = config.users.filter((u) => u.referredBy === user.id)
    let earned = 0
    if (sqliteDb) {
      try {
        const r = sqliteDb.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM billing_tx WHERE user_id = ? AND type = 'affiliate'").get(user.id)
        earned = Number(r?.s) || 0
      } catch { /* ignore */ }
    }
    const kickback = Number(config.billing?.affiliateKickback) || 0
    const trial = Number(config.billing?.trialCredits) || 0
    return sendJson(res, 200, {
      referralCode: user.referralCode,
      shareUrl: `/register?ref=${user.referralCode}`,
      shareText: `Đăng ký ProxyBox qua link giới thiệu của tôi — cả hai cùng nhận ${trial.toLocaleString()} VND trial + ${kickback.toLocaleString()} VND bonus.`,
      kickbackPerSignup: kickback,
      totalReferred: referredUsers.length,
      totalEarned: earned,
      referrals: referredUsers.map((u) => ({
        signupDate: (u.tosAcceptedAt || '').slice(0, 10),
        maskedEmail: maskEmail(u.email)
      }))
    })
  }

  // â”€â”€ Billing (wallet/balance/transactions, no payment gateway yet) â”€â”€
  // GET    /api/v1/user/billing                â€” wallet + plan + recent tx
  // GET    /api/v1/user/billing/transactions   â€” full transaction list (paginated)
  // POST   /api/v1/user/billing/topup          â€” credit wallet (test mode; admin gateway integration later)
  if (req.method === 'GET' && sub === 'billing') {
    const balance = userBalance(user.id)
    const recent = sqliteDb ? sqliteDb.prepare('SELECT ts, type, amount, balance_after AS balanceAfter, note FROM billing_tx WHERE user_id = ? ORDER BY ts DESC LIMIT 10').all(user.id) : []
    return sendJson(res, 200, {
      wallet: { balance, currency: 'VND', updatedAt: new Date().toISOString() },
      plan: { name: 'free', activeProxies: config.proxies.filter((p) => p.ownerId === user.id).length },
      recentTransactions: recent,
      paymentMethods: {
        stripeEnabled: Boolean(config.billing?.stripeSecretKey),
        paypalEnabled: Boolean(config.billing?.paypalEnabled && config.billing?.paypalClientId && config.billing?.paypalSecret),
        paypalCurrency: String(config.billing?.paypalCurrency || 'USD').toUpperCase(),
        testMode: Boolean(config.billing?.testMode)
      }
    })
  }
  if (req.method === 'GET' && sub === 'billing/transactions') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 500)
    const rows = sqliteDb ? sqliteDb.prepare('SELECT ts, type, amount, balance_after AS balanceAfter, note FROM billing_tx WHERE user_id = ? ORDER BY ts DESC LIMIT ?').all(user.id, limit) : []
    return sendJson(res, 200, { items: rows, limit, balance: userBalance(user.id) })
  }

  // ── Free-credit promo codes ──
  // POST redeem { code } → credit wallet once per user. Checked BEFORE the generic
  // GET :code validate match so 'redeem' is never treated as a code lookup.
  // Active scoped grants for this user (powers the wallet-side display + buy summary).
  if (req.method === 'GET' && sub === 'credit-grants') {
    const today = new Date().toISOString().slice(0, 10)
    const list = (config.creditGrants || [])
      .filter((g) => g.userId === user.id && Number(g.remaining) > 0 && (!g.expiresAt || g.expiresAt >= today))
      .map((g) => ({ group: g.group, remaining: g.remaining, amount: g.amount, currency: g.currency, expiresAt: g.expiresAt || '', code: g.code }))
    return sendJson(res, 200, list)
  }
  if (req.method === 'POST' && sub === 'credit-codes/redeem') {
    const body = await readJson(req)
    const code = String(body.code || '').toUpperCase().trim()
    if (!code) return sendJson(res, 400, { error: 'code required' })
    const cc = (config.creditCodes || []).find((c) => c.code === code)
    if (!cc || cc.enabled === false) return sendJson(res, 404, { error: 'invalid code' })
    if (cc.validUntil && cc.validUntil < new Date().toISOString().slice(0, 10)) return sendJson(res, 400, { error: 'code expired' })
    if (!Array.isArray(cc.redeemedBy)) cc.redeemedBy = []
    if (cc.redeemedBy.includes(user.id)) return sendJson(res, 409, { error: 'already redeemed' })
    if (cc.usageLimit && cc.redeemedBy.length >= cc.usageLimit) return sendJson(res, 409, { error: 'code fully redeemed' })
    cc.redeemedBy.push(user.id)            // reserve slot atomically (single-threaded tick)
    if (!Array.isArray(config.creditGrants)) config.creditGrants = []
    const grant = {
      id: `GR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      userId: user.id,
      group: cc.productGroup || 'all',
      amount: cc.amount,
      remaining: cc.amount,
      currency: cc.currency,
      expiresAt: cc.validUntil || '',          // credit usable until this date (per product decision)
      code: cc.code,
      createdAt: new Date().toISOString()
    }
    config.creditGrants.push(grant)
    await saveConfig()
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/credit-codes/redeem', note: `${cc.code} +${cc.amount} group=${grant.group} exp=${grant.expiresAt || 'never'}` })
    const groupTxt = grant.group === 'all' ? 'mọi sản phẩm' : grant.group.toUpperCase()
    pushNotification(user.id, { type: 'billing', severity: 'success', text: `Đã nhận ${Number(cc.amount).toLocaleString()} ${cc.currency} credit cho ${groupTxt}${grant.expiresAt ? `, dùng tới ${grant.expiresAt}` : ''}`, link: '/billing' })
    return sendJson(res, 200, { ok: true, code: cc.code, amount: cc.amount, currency: cc.currency, group: grant.group, expiresAt: grant.expiresAt })
  }
  // GET validate/preview — no mutation; powers the "shows amount + expiry" step.
  const creditCodeValidate = sub.match(/^credit-codes\/([A-Za-z0-9_-]+)$/)
  if (creditCodeValidate && req.method === 'GET') {
    const cc = (config.creditCodes || []).find((c) => c.code === creditCodeValidate[1].toUpperCase())
    if (!cc || cc.enabled === false) return sendJson(res, 404, { error: 'invalid code' })
    const expired = !!(cc.validUntil && cc.validUntil < new Date().toISOString().slice(0, 10))
    const already = Array.isArray(cc.redeemedBy) && cc.redeemedBy.includes(user.id)
    const full = !!(cc.usageLimit && (cc.redeemedBy?.length || 0) >= cc.usageLimit)
    return sendJson(res, 200, {
      code: cc.code, amount: cc.amount, currency: cc.currency,
      productGroup: cc.productGroup || 'all', validUntil: cc.validUntil || '',
      expired, already, full, redeemable: !expired && !already && !full
    })
  }
  // Test-mode manual topup. ONLY active when billing.testMode is true; otherwise
  // production traffic must go via /billing/checkout â†' Stripe â†' webhook.
  if (req.method === 'POST' && sub === 'billing/topup') {
    if (!config.billing?.testMode) return sendJson(res, 403, { error: 'manual topup disabled; use /billing/checkout' })
    const body = await readJson(req)
    const amount = Math.floor(Number(body.amount) || 0)
    if (amount <= 0 || amount > 100_000_000) return sendJson(res, 400, { error: 'amount must be 1..100,000,000' })
    const next = recordBillingTx(user.id, 'topup', amount, `test topup: ${String(body.note || '').slice(0, 100)}`)
    audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/billing/topup', note: `+${amount} â†' ${next}` })
    return sendJson(res, 200, { ok: true, balance: next, mode: 'test' })
  }

  // Real billing â€” create Stripe Checkout Session, redirect customer.
  if (req.method === 'POST' && sub === 'billing/checkout') {
    if (!config.billing?.stripeSecretKey) return sendJson(res, 503, { error: 'billing not configured (stripeSecretKey missing)' })
    const body = await readJson(req)
    const amount = Math.floor(Number(body.amount) || 0)
    if (amount < 10000 || amount > 100_000_000) return sendJson(res, 400, { error: 'amount must be 10,000..100,000,000' })
    const currency = String(config.billing.currency || 'usd').toLowerCase()
    // Stripe accepts amount as the smallest currency unit. For VND (zero-decimal) that's just the integer.
    // For USD it would be cents â€” admin's responsibility to pick correct config.currency.
    // SECURITY: only accept successUrl/cancelUrl from config (admin-controlled).
    // Earlier we trusted req.headers.origin which an attacker can spoof â†' after
    // Stripe redirect the customer lands on attacker-controlled phishing page.
    if (!config.billing.successUrl || !config.billing.cancelUrl) {
      return sendJson(res, 503, { error: 'billing.successUrl and billing.cancelUrl must be configured' })
    }
    const successUrl = config.billing.successUrl
    const cancelUrl = config.billing.cancelUrl
    const form = {
      'mode': 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': `ProxyBox wallet top-up`,
      'metadata[userId]': user.id,
      'metadata[amount]': String(amount),
      'success_url': successUrl,
      'cancel_url': cancelUrl,
      'customer_email': user.email
    }
    try {
      const session = await stripeApi('/v1/checkout/sessions', form)
      audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/billing/checkout', note: `intent ${session.id} amount=${amount}` })
      return sendJson(res, 200, { url: session.url, sessionId: session.id })
    } catch (e) {
      return sendJson(res, 502, { error: `Stripe: ${e.message}` })
    }
  }

  // ── PayPal: create order (returns approveUrl for redirect) ──────────────
  if (req.method === 'POST' && sub === 'billing/paypal/create-order') {
    if (!config.billing?.paypalEnabled) return sendJson(res, 503, { error: 'PayPal not enabled' })
    if (!config.billing?.paypalClientId || !config.billing?.paypalSecret) {
      return sendJson(res, 503, { error: 'PayPal credentials missing' })
    }
    if (!config.billing?.paypalReturnUrl || !config.billing?.paypalCancelUrl) {
      return sendJson(res, 503, { error: 'paypalReturnUrl / paypalCancelUrl must be configured' })
    }
    const body = await readJson(req)
    const amount = Number(body.amount) || 0
    if (amount < 1 || amount > 1_000_000) return sendJson(res, 400, { error: 'amount must be 1..1,000,000' })
    const currency = String(body.currency || config.billing.paypalCurrency || 'USD').toUpperCase()
    // PayPal expects amount as decimal string with currency-appropriate fraction digits.
    // USD/EUR/etc use 2 digits, JPY/VND/HUF use 0 digits.
    const zeroDecimal = new Set(['VND', 'JPY', 'KRW', 'HUF', 'CLP', 'PYG', 'XOF'])
    const value = zeroDecimal.has(currency) ? String(Math.floor(amount)) : Number(amount).toFixed(2)
    try {
      const order = await paypalApi('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: `topup-${user.id}-${Date.now()}`,
          description: 'ProxyBox wallet top-up',
          amount: { currency_code: currency, value },
          custom_id: `${user.id}|${currency}|${value}`
        }],
        application_context: {
          brand_name: 'ProxyBox',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: config.billing.paypalReturnUrl,
          cancel_url: config.billing.paypalCancelUrl
        }
      })
      const approve = (order.links || []).find((l) => l.rel === 'approve')
      audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/billing/paypal/create-order', note: `order ${order.id} ${currency} ${value}` })
      return sendJson(res, 200, { orderId: order.id, approveUrl: approve?.href || '' })
    } catch (e) {
      return sendJson(res, 502, { error: `PayPal: ${e.message}` })
    }
  }

  // ── PayPal: capture order (call after PayPal redirect) ──────────────────
  if (req.method === 'POST' && sub === 'billing/paypal/capture') {
    if (!config.billing?.paypalEnabled) return sendJson(res, 503, { error: 'PayPal not enabled' })
    const body = await readJson(req)
    const orderId = String(body.orderId || '').trim()
    if (!/^[A-Z0-9_-]{8,}$/i.test(orderId)) return sendJson(res, 400, { error: 'invalid orderId' })
    // Dedup: PayPal capture is idempotent on their side but we still record so
    // we never double-credit if SPA retries during a race.
    if (sqliteDb) {
      try {
        sqliteDb.exec('CREATE TABLE IF NOT EXISTS paypal_seen (order_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ts TEXT NOT NULL)')
        const seen = sqliteDb.prepare('SELECT user_id FROM paypal_seen WHERE order_id = ?').get(orderId)
        if (seen) return sendJson(res, 200, { ok: true, alreadyCaptured: true })
      } catch { /* ignore */ }
    }
    try {
      const capture = await paypalApi('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {})
      const pu = (capture.purchase_units || [])[0]
      const cap = (pu?.payments?.captures || [])[0]
      const customId = String(pu?.payments?.captures?.[0]?.custom_id || pu?.custom_id || '')
      const [claimedUid, currency, value] = customId.split('|')
      if (claimedUid !== user.id) {
        return sendJson(res, 403, { error: 'order does not belong to this user' })
      }
      if (capture.status !== 'COMPLETED' && cap?.status !== 'COMPLETED') {
        return sendJson(res, 502, { error: `PayPal capture not completed: ${capture.status || cap?.status}` })
      }
      // Credit wallet with the customId amount (we set this when creating the order).
      const amount = Number(value) || 0
      if (amount <= 0) return sendJson(res, 502, { error: 'PayPal capture amount missing' })
      const note = `PayPal capture ${capture.id || orderId} (${currency} ${value})`
      const next = recordBillingTx(user.id, 'topup', amount, note)
      if (sqliteDb) {
        try { sqliteDb.prepare('INSERT OR IGNORE INTO paypal_seen (order_id, user_id, ts) VALUES (?, ?, ?)').run(orderId, user.id, new Date().toISOString()) } catch {}
      }
      audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/v1/user/billing/paypal/capture', note: `credited user=${user.id} +${amount} → ${next} (${currency})` })
      return sendJson(res, 200, { ok: true, amount, currency, balance: next })
    } catch (e) {
      return sendJson(res, 502, { error: `PayPal: ${e.message}` })
    }
  }

  // ── Tools: bulk proxy check ─────────────────────────────────────────────
  // POST /api/v1/user/tools/bulk-check { lines } — `lines` may be a string
  // (newline-separated) or array. Max 50 per batch, 5 batches/hour.
  if (sub === 'tools/bulk-check' && req.method === 'POST') {
    const body = await readJson(req)
    let lines = []
    if (Array.isArray(body.lines)) lines = body.lines
    else if (typeof body.lines === 'string') lines = body.lines.split(/\r?\n/)
    lines = lines.map((l) => String(l || '').trim()).filter(Boolean)
    if (lines.length === 0) return sendJson(res, 400, { error: 'no proxy lines provided' })
    if (lines.length > 50) return sendJson(res, 400, { error: 'max 50 proxies per batch' })
    const rateErr = rateCheck(user.id, 'bulk-check', 5)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'bulk-check')
    try {
      const results = await bulkProxyCheck(lines, 8)
      const ok = results.filter((r) => r.ok).length
      return sendJson(res, 200, { total: results.length, ok, fail: results.length - ok, results })
    } finally {
      rateRelease(user.id, 'bulk-check')
    }
  }

  // ── Tools: IP info (ASN / CIDR / org via Team Cymru DNS) ────────────────
  // POST /api/v1/user/tools/ip-info { ip }
  if (sub === 'tools/ip-info' && req.method === 'POST') {
    const body = await readJson(req)
    const ip = String(body.ip || '').trim()
    if (!net.isIP(ip)) return sendJson(res, 400, { error: 'invalid IP address' })
    const rateErr = rateCheck(user.id, 'ip-info', 100)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'ip-info')
    try {
      return sendJson(res, 200, await ipInfoLookup(ip))
    } finally {
      rateRelease(user.id, 'ip-info')
    }
  }

  // ── Tools: DNSBL blacklist check ────────────────────────────────────────
  // POST /api/v1/user/tools/blacklist { ip }  — IPv4 only.
  if (sub === 'tools/blacklist' && req.method === 'POST') {
    const body = await readJson(req)
    const ip = String(body.ip || '').trim()
    if (!net.isIP(ip)) return sendJson(res, 400, { error: 'invalid IP address' })
    const rateErr = rateCheck(user.id, 'blacklist', 100)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'blacklist')
    try {
      return sendJson(res, 200, await blacklistCheck(ip))
    } finally {
      rateRelease(user.id, 'blacklist')
    }
  }

  // ── Tools: speed test through customer's own proxy ──────────────────────
  // GET  /api/v1/user/tools/speedtest-isps?country=VN  → list of available ISPs
  // POST /api/v1/user/tools/speed-test { proxyId, country?, isp? }
  if (sub.startsWith('tools/speedtest-isps') && req.method === 'GET') {
    const country = String(url.searchParams.get('country') || 'VN').toUpperCase()
    if (!OOKLA_SUPPORTED_COUNTRIES.includes(country)) {
      return sendJson(res, 400, { error: `unsupported country (try one of: ${OOKLA_SUPPORTED_COUNTRIES.join(', ')})` })
    }
    const servers = await fetchOoklaServers(country)
    const counts = new Map()
    for (const s of servers) {
      const sp = (s.sponsor || '').trim()
      if (!sp) continue
      counts.set(sp, (counts.get(sp) || 0) + 1)
    }
    const isps = [...counts.entries()]
      .map(([sponsor, serverCount]) => ({ sponsor, serverCount }))
      .sort((a, b) => b.serverCount - a.serverCount)
    return sendJson(res, 200, {
      country,
      countryName: OOKLA_COUNTRY_NAME[country],
      totalServers: servers.length,
      isps
    })
  }

  if (sub === 'tools/speed-test' && req.method === 'POST') {
    const body = await readJson(req)
    const proxyId = String(body.proxyId || '')
    const country = String(body.country || 'VN').toUpperCase()
    const isp = String(body.isp || 'auto').toLowerCase()
    if (!OOKLA_SUPPORTED_COUNTRIES.includes(country)) {
      return sendJson(res, 400, { error: `unsupported country` })
    }
    const proxy = config.proxies.find((p) => p.id === proxyId && p.ownerId === user.id)
    if (!proxy) return sendJson(res, 404, { error: 'proxy not found or not yours' })
    if (proxy.status === 'expired') return sendJson(res, 400, { error: 'this proxy is expired' })
    const rateErr = rateCheck(user.id, 'speed-test', 5)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'speed-test')
    try {
      const servers = await fetchOoklaServers(country)
      if (!servers.length) return sendJson(res, 503, { error: `no speedtest servers available for ${country} right now` })
      const server = pickOoklaServer(servers, isp)
      if (!server) return sendJson(res, 404, { error: `no server matched ISP "${isp}" in ${country}` })
      // Run download phase (15s cap) then upload phase (12s cap) sequentially.
      const dl = await speedTestThroughProxy({ proxy, server, maxMs: 15_000, maxBytes: 80 * 1024 * 1024 })
      const ul = await speedTestUploadThroughProxy({ proxy, server, maxMs: 12_000, maxBytes: 60 * 1024 * 1024 })
      return sendJson(res, 200, {
        proxyId: proxy.id,
        proxyType: proxy.type,
        ok: dl.ok,
        // Combined view + legacy field for old callers
        mbps: dl.mbps,
        downloadMbps: dl.mbps,
        uploadMbps: ul.mbps,
        pingMs: dl.ttfbMs,
        ttfbMs: dl.ttfbMs,
        totalBytes: dl.totalBytes + ul.totalBytes,
        durationMs: dl.durationMs + ul.durationMs,
        server: dl.server,
        download: { mbps: dl.mbps, totalBytes: dl.totalBytes, durationMs: dl.durationMs, ttfbMs: dl.ttfbMs, error: dl.error },
        upload:   { mbps: ul.mbps, totalBytes: ul.totalBytes, durationMs: ul.durationMs, error: ul.error },
        error: dl.error
      })
    } finally {
      rateRelease(user.id, 'speed-test')
    }
  }

  // ── Tools: ping ─────────────────────────────────────────────────────────
  // POST /api/v1/user/tools/ping { ip, count? }
  // Auto-detects v4/v6 via net.isIP(). Hostnames intentionally rejected.
  if (sub === 'tools/ping' && req.method === 'POST') {
    const body = await readJson(req)
    const target = String(body.ip || '').trim()
    const family = net.isIP(target)
    if (!family) return sendJson(res, 400, { error: 'invalid IP address (expected IPv4 or IPv6)' })
    const count = Math.max(1, Math.min(10, Number(body.count) || 4))
    const rateErr = rateCheck(user.id, 'ping', 30)
    if (rateErr) return sendJson(res, 429, { error: rateErr })
    rateAcquire(user.id, 'ping')
    try {
      const r = await pingIp(target, family, count)
      const raw = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')
      const stats = parsePingOutput(raw)
      return sendJson(res, 200, {
        target,
        family: family === 6 ? 'ipv6' : 'ipv4',
        count,
        ok: r.code === 0 && stats.received > 0,
        ...stats,
        raw: raw.slice(0, 8192)
      })
    } finally {
      rateRelease(user.id, 'ping')
    }
  }

  return sendJson(res, 404, { error: 'unknown user endpoint' })
}

// Login failure tracker â€” separately tracks per-IP AND per-email. An attacker
// rotating IPs through a proxy pool would defeat per-IP alone, so the per-email
// counter survives independently with the same threshold.
const LOGIN_FAIL_MAX = 5
const LOGIN_FAIL_WINDOW_MS = 60_000
const LOGIN_LOCK_MS = 10 * 60_000
const loginFailsByIp = new Map()
const loginFailsByEmail = new Map()

function _isLocked(map, key) {
  const e = map.get(key); if (!e) return false
  if (e.lockedUntil && e.lockedUntil > Date.now()) return true
  if (e.lockedUntil && e.lockedUntil <= Date.now()) map.delete(key)
  return false
}
function _recordFail(map, key) {
  const now = Date.now()
  const e = map.get(key) || { count: 0, firstAt: now, lockedUntil: 0 }
  if (now - e.firstAt > LOGIN_FAIL_WINDOW_MS) { e.count = 0; e.firstAt = now }
  e.count += 1
  if (e.count >= LOGIN_FAIL_MAX) e.lockedUntil = now + LOGIN_LOCK_MS
  map.set(key, e)
}
function loginIsLocked(ip, email) { return _isLocked(loginFailsByIp, ip) || (email && _isLocked(loginFailsByEmail, email)) }
function recordLoginFail(ip, email) { _recordFail(loginFailsByIp, ip); if (email) _recordFail(loginFailsByEmail, email) }
function clearLoginFails(ip, email) { loginFailsByIp.delete(ip); if (email) loginFailsByEmail.delete(email) }

// Constant-time bcrypt-ish dummy compare so logins for non-existent emails take
// roughly the same time as real ones â€” defeats timing-based user enumeration.
const TIMING_DUMMY_HASH = crypto.scryptSync('timing-dummy', 'salt', 64).toString('hex')
function dummyVerify() {
  try { crypto.scryptSync('x', 'salt', 64) } catch {}
  return false
}

async function handleLogin(req, res) {
  const ip = clientIp(req)
  const body = await readJson(req)
  const email = String(body.email || '').toLowerCase()
  if (loginIsLocked(ip, email)) {
    audit({ actor: email || 'anon', ip, method: 'POST', path: '/api/auth/login', status: 429, note: 'locked' })
    return sendJson(res, 429, { error: 'too many failed logins â€” try again in a few minutes' })
  }
  const user = config.users.find((item) => String(item.email || '').toLowerCase() === email)
  // Run a verifyPassword (or equivalent CPU work) regardless of user existence
  // so a network observer can't distinguish "user not found" from "bad password".
  const okPass = user ? verifyPassword(String(body.password || ''), user.passwordHash || user.password) : dummyVerify()
  if (!user || !okPass) {
    recordLoginFail(ip, email)
    audit({ actor: email || 'anon', ip, method: 'POST', path: '/api/auth/login', status: 401, note: 'bad creds' })
    return sendJson(res, 401, { error: 'invalid email or password' })
  }
  // SECURITY: suspended accounts cannot log in (admin can lock abusive customers)
  if (user.suspended) {
    audit({ actor: email, ip, method: 'POST', path: '/api/auth/login', status: 403, note: 'suspended' })
    return sendJson(res, 403, { error: 'account suspended â€” contact support' })
  }
  // TOTP 2FA challenge â€” if enrolled, demand the 6-digit code on login.
  if (user.totp && user.totp.secret) {
    const code = String(body.totpCode || '').trim()
    if (!code) return sendJson(res, 401, { error: 'totp code required', totpRequired: true })
    if (!verifyTotp(user.totp.secret, code)) {
      recordLoginFail(ip, email)
      audit({ actor: email, ip, method: 'POST', path: '/api/auth/login', status: 401, note: 'bad totp' })
      return sendJson(res, 401, { error: 'invalid totp code', totpRequired: true })
    }
  }
  // require2FA enforcement: admin can set user.require2FA=true to force enrollment.
  if (user.require2FA && !(user.totp && user.totp.secret)) {
    audit({ actor: email, ip, method: 'POST', path: '/api/auth/login', status: 403, note: '2fa required, not enrolled' })
    return sendJson(res, 403, { error: '2FA enrollment required by admin â€” please enroll TOTP', enroll2FA: true })
  }
  clearLoginFails(ip, email)
  const token = createSession(user)
  return sendJson(res, 200, {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'admin',
      totpEnabled: !!user.totp,
      emailVerified: !!user.emailVerified,
      forcePasswordChange: !!user.forcePasswordChange
    }
  })
}

// â”€â”€â”€ TOTP helpers (RFC 6238 with HMAC-SHA1, 30s window, 6 digits) â”€â”€â”€
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0, out = ''
  for (const b of buf) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { bits -= 5; out += alphabet[(value >> bits) & 0x1f] }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 0x1f]
  return out
}
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  s = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0, value = 0, out = []
  for (const c of s) {
    const v = alphabet.indexOf(c); if (v < 0) continue
    value = (value << 5) | v; bits += 5
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff) }
  }
  return Buffer.from(out)
}
function totpCode(secret, time = Date.now(), step = 30) {
  const t = Math.floor(time / 1000 / step)
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(t), 0)
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(bin % 1_000_000).padStart(6, '0')
}
function verifyTotp(b32Secret, code) {
  const secret = base32Decode(b32Secret)
  const now = Date.now()
  for (const skew of [-1, 0, 1]) {
    if (totpCode(secret, now + skew * 30_000) === code) return true
  }
  return false
}

async function handleRegister(req, res) {
  const body = await readJson(req)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || password.length < 8) return sendJson(res, 400, { error: 'email and a password of at least 8 characters are required' })
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return sendJson(res, 400, { error: 'password must contain upper, lower, and a digit' })
  if (!body.acceptedTos) return sendJson(res, 400, { error: 'must accept Terms of Service (set acceptedTos: true)' })
  if (config.users.some((item) => String(item.email || '').toLowerCase() === email)) {
    return sendJson(res, 409, { error: 'email is already registered' })
  }
  // Affiliate referral: ?ref=<code> on register â†' credits both new + referrer.
  let referrer = null
  const ref = String(body.referralCode || '').trim()
  if (ref) referrer = config.users.find((u) => u.referralCode === ref)
  const verifyToken = crypto.randomBytes(32).toString('hex')
  const newUserId = `u-${Date.now().toString(36)}`
  const user = {
    id: newUserId,
    name: String(body.name || '').trim() || email,
    email,
    passwordHash: hashPassword(password),
    role: 'customer',
    apiKey: generateUserToken(newUserId),
    referralCode: crypto.randomBytes(4).toString('hex'),
    referredBy: referrer ? referrer.id : null,
    tosAcceptedAt: new Date().toISOString(),
    webhookUrl: '',
    totp: null,
    emailVerified: false,
    emailVerify: { token: verifyToken, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() },
    notifications: [],
    notes: '',
    tags: []
  }
  config.users.push(user)
  await saveConfig()
  // Trial credits — configurable (config.billing.trialCredits). Use nullish
  // coalescing so the admin can explicitly set 0 to disable; `0 || 50000`
  // would have silently fallen back to the old default.
  const trial = Number(config.billing?.trialCredits ?? 50000)
  if (trial > 0) recordBillingTx(user.id, 'trial', trial, 'signup trial credits')
  // Affiliate kickback â€” give referrer a configured bonus too.
  if (referrer) {
    const kickback = Number(config.billing?.affiliateKickback || 20000)
    if (kickback > 0) recordBillingTx(referrer.id, 'affiliate', kickback, `referral from ${user.email}`)
  }
  audit({ actor: email, ip: clientIp(req), method: 'POST', path: '/api/auth/register', note: `tos accepted; trial=${trial}; ref=${ref || 'none'}` })
  // Welcome email + email verification link (best-effort, async)
  const verifyLink = `${publicBaseUrl(req)}/verify-email?token=${verifyToken}`
  sendMail({
    to: email,
    subject: 'Welcome to ProxyBox â€” confirm your email',
    html: `<h2>Welcome, ${htmlEscape(user.name)}</h2><p>Your account is ready.</p><p>Trial credits: <strong>${trial.toLocaleString()}</strong> ${(config.pricing?.currency || 'vnd').toUpperCase()}</p><p>Referral code: <code>${user.referralCode}</code></p><p>Please confirm your email address:</p><p><a href="${htmlEscape(verifyLink)}">${htmlEscape(verifyLink)}</a></p>`
  }).catch(() => {})
  const token = createSession(user)
  return sendJson(res, 201, { token, user: { name: user.name, email: user.email, role: user.role, apiKey: user.apiKey, referralCode: user.referralCode } })
}

function handleLogout(req, res) {
  const session = sessionFromRequest(req)
  if (session) sessions.delete(session.token)
  return sendJson(res, 200, { ok: true })
}

// â”€â”€â”€ Password recovery + email verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tokens: 32-byte random hex, stored on user record with expiresAt. Never
// reveal whether an email exists (always 200) â€” prevents user enumeration.
function publicBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim()
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim()
  return host ? `${proto}://${host}` : ''
}
async function handleForgotPassword(req, res) {
  const ip = clientIp(req)
  // Cap blast radius: 5 reset emails per hour per IP. Caller gets the same
  // generic 200 either way so this doesn't help account enumeration.
  if (rateCheck(ip, 'forgot-password', 5)) return sendJson(res, 200, { ok: true })
  rateAcquire(ip, 'forgot-password')
  rateRelease(ip, 'forgot-password')
  const body = await readJson(req)
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return sendJson(res, 200, { ok: true })
  const user = config.users.find((u) => String(u.email || '').toLowerCase() === email)
  if (user) {
    const token = crypto.randomBytes(32).toString('hex')
    user.passwordReset = { token, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }
    await saveConfig()
    const link = `${publicBaseUrl(req)}/reset-password?token=${token}`
    sendMail({
      to: user.email,
      subject: 'ProxyBox: reset your password',
      html: `<h2>Reset password</h2><p>Click the link below to set a new password (valid for 1 hour):</p><p><a href="${htmlEscape(link)}">${htmlEscape(link)}</a></p><p>If you did not request this, ignore this email.</p>`
    }).catch(() => {})
    audit({ actor: email, ip: clientIp(req), method: 'POST', path: '/api/auth/forgot-password', note: 'reset token issued' })
  }
  return sendJson(res, 200, { ok: true })
}
async function handleResetPassword(req, res) {
  const ip = clientIp(req)
  if (rateCheck(ip, 'reset-password', 20)) return sendJson(res, 429, { error: 'too many attempts — try again later' })
  rateAcquire(ip, 'reset-password')
  rateRelease(ip, 'reset-password')
  const body = await readJson(req)
  const token = String(body.token || '').trim()
  const password = String(body.password || '')
  if (!token || password.length < 8) return sendJson(res, 400, { error: 'token and a password of at least 8 characters are required' })
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return sendJson(res, 400, { error: 'password must contain upper, lower, and a digit' })
  const user = config.users.find((u) => u.passwordReset && u.passwordReset.token && timingEqual(u.passwordReset.token, token))
  if (!user) return sendJson(res, 400, { error: 'invalid or expired token' })
  if (new Date(user.passwordReset.expiresAt).getTime() <= Date.now()) {
    delete user.passwordReset
    await saveConfig()
    return sendJson(res, 400, { error: 'invalid or expired token' })
  }
  user.passwordHash = hashPassword(password)
  delete user.password
  delete user.passwordReset
  delete user.forcePasswordChange
  // Revoke all live sessions belonging to this user â€” old creds are gone.
  for (const [tk, s] of sessions) if (s.userId === user.id) sessions.delete(tk)
  await saveConfig()
  audit({ actor: user.email, ip: clientIp(req), method: 'POST', path: '/api/auth/reset-password', note: 'password reset' })
  sendMail({ to: user.email, subject: 'ProxyBox: password changed', html: '<p>Your password was just reset. If this was not you, contact support immediately.</p>' }).catch(() => {})
  return sendJson(res, 200, { ok: true })
}
async function handleVerifyEmail(req, res, url) {
  const token = String(url.searchParams.get('token') || '').trim()
  if (!token) return sendJson(res, 400, { error: 'token required' })
  const user = config.users.find((u) => u.emailVerify && u.emailVerify.token === token)
  if (!user) return sendJson(res, 400, { error: 'invalid or expired token' })
  if (new Date(user.emailVerify.expiresAt).getTime() <= Date.now()) {
    delete user.emailVerify
    await saveConfig()
    return sendJson(res, 400, { error: 'invalid or expired token' })
  }
  user.emailVerified = true
  delete user.emailVerify
  await saveConfig()
  audit({ actor: user.email, ip: clientIp(req), method: 'GET', path: '/api/auth/verify-email', note: 'email verified' })
  return sendJson(res, 200, { ok: true, email: user.email })
}
async function handleResendVerify(req, res) {
  const session = sessionFromRequest(req)
  if (!session) return sendJson(res, 401, { error: 'login required' })
  const user = config.users.find((u) => u.id === session.userId)
  if (!user) return sendJson(res, 401, { error: 'session user not found' })
  if (user.emailVerified) return sendJson(res, 200, { ok: true, alreadyVerified: true })
  const token = crypto.randomBytes(32).toString('hex')
  user.emailVerify = { token, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() }
  await saveConfig()
  const link = `${publicBaseUrl(req)}/verify-email?token=${token}`
  sendMail({
    to: user.email,
    subject: 'ProxyBox: confirm your email',
    html: `<h2>Confirm your email</h2><p>Click the link below to verify your account (valid for 24 hours):</p><p><a href="${htmlEscape(link)}">${htmlEscape(link)}</a></p>`
  }).catch(() => {})
  return sendJson(res, 200, { ok: true })
}

// â”€â”€â”€ User notifications (in-app bell) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Stored on user record. Capped at 100 per user; oldest dropped on overflow.
function pushNotification(userId, { type = 'info', text = '', severity = 'info', link = '' } = {}) {
  const user = config.users.find((u) => u.id === userId)
  if (!user || !text) return
  if (!Array.isArray(user.notifications)) user.notifications = []
  user.notifications.unshift({
    id: 'n-' + crypto.randomBytes(4).toString('hex'),
    type, text: String(text).slice(0, 400), severity, link,
    createdAt: new Date().toISOString(), read: false
  })
  if (user.notifications.length > 100) user.notifications.length = 100
}

async function handleCreateOrder(req, res) {
  const body = await readJson(req)
  const type = String(body.type || 'ipv4').toLowerCase() === 'ipv6' ? 'IPv6' : 'IPv4'
  const rotate = type === 'IPv6' && Boolean(body.rotate)
  // Auto-balance: when `nodeId` is omitted and `balance: true` is set, pick a node
  // per-proxy by lowest combined score = (active proxies * 1.0) + (cpu% * 0.5) + (ram% * 0.3).
  // Otherwise use the explicit nodeId or fall back to local.
  const autoBalance = body.balance === true && !body.nodeId
  const nodeId = body.nodeId || 'local'
  if (!autoBalance && nodeId !== 'local' && !config.nodes.some((n) => n.id === nodeId)) {
    return sendJson(res, 400, { error: `node ${nodeId} not found` })
  }
  const quantity = clamp(Number(body.quantity || 1), 1, 5000)
  const durationDays = Number(body.duration || config.proxyDefaults.expiresDays || 30)
  // memberBytesPerSec is the per-member rate the agent enforces; orderBytesPerSec is the
  // group-wide shared cap. When the user passes only one, treat it as both for backwards compat.
  const orderBytesPerSec = nonNegInt(body.orderBytesPerSec || body.bytesPerSec)
  const country = typeof body.country === 'string' ? body.country.toLowerCase() : ''
  const asnReq = typeof body.asn === 'string' ? body.asn.toUpperCase() : ''
  const upstreamUrl = typeof body.upstreamUrl === 'string' ? body.upstreamUrl.trim() : ''
  // Admin can assign newly-created proxies to a customer user.
  const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId.trim() : ''
  if (ownerId && !config.users.some((u) => u.id === ownerId)) return sendJson(res, 400, { error: `ownerId ${ownerId} not found` })
  const limits = { maxConnections: body.maxConnections, bytesPerSec: body.bytesPerSec, monthlyQuotaBytes: body.monthlyQuotaBytes }
  const listenHost = typeof body.listenHost === 'string' && body.listenHost.trim() ? body.listenHost.trim() : undefined
  const orderId = `ORD-${Date.now().toString().slice(-6)}`
  const created = []
  for (let index = 0; index < quantity; index += 1) {
    const targetNodeId = autoBalance ? pickBalancedNode(type) : nodeId
    let proxy
    try { proxy = createProxy({ type, rotate, nodeId: targetNodeId, durationDays, listenHost, country, asn: asnReq, upstreamUrl, ...limits, name: `${type}${rotate ? ' Rotating' : ''} Order ${Date.now()}-${index + 1}` }) }
    catch (e) { return sendJson(res, 400, { error: e.message }) }
    proxy.orderId = orderId
    if (ownerId) proxy.ownerId = ownerId
    config.proxies.push(proxy)
    ensureStats(proxy.id)
    if (targetNodeId === 'local') await startProxy(proxy)
    created.push({ ...publicProxy(proxy), username: proxy.username, password: proxy.password })
  }
  const order = {
    id: orderId,
    ownerId: ownerId || null,
    item: `${type} x ${quantity}`,
    amount: Number(body.amount || 0),
    status: 'paid',
    date: new Date().toISOString().slice(0, 10),
    bytesPerSec: orderBytesPerSec,
    proxyIds: created.map((proxy) => proxy.id)
  }
  orders.unshift(order)
  await Promise.all([saveConfig(), saveOrders()])
  return sendJson(res, 201, { order, proxies: created })
}

function nonNegInt(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function createProxy(input = {}) {
  const type = String(input.type || 'IPv4').toLowerCase() === 'ipv6' ? 'IPv6' : 'IPv4'
  const rotate = type === 'IPv6' && Boolean(input.rotate)
  const nodeId = input.nodeId || 'local'
  // Enforce node-family constraint: every node is strictly ipv4 OR ipv6, so
  // the proxy type must match. Legacy 'dual' values in storage are still
  // accepted (no migration required), but new nodes can only be one family.
  const pf = type === 'IPv6' ? 'ipv6' : 'ipv4'
  if (nodeId === 'local') {
    const fam = localFamily()
    if (fam !== pf) {
      throw new Error(`control plane is ${fam}-only — cannot host ${type} proxies`)
    }
  } else {
    const node = config.nodes.find((n) => n.id === nodeId)
    if (node) {
      const fam = (node.family || '').toLowerCase()
      if (fam && fam !== 'dual' && fam !== pf) {
        throw new Error(`node ${node.name} is ${fam}-only — cannot host ${type} proxies`)
      }
    }
  }
  const bindIp = input.bindIp || allocateBindIp(type, nodeId)
  const port = Number(input.port || nextPort())
  const id = input.id || `px-${port}`
  return {
    id,
    nodeId,
    name: input.name || `${type}${rotate ? ' Rotating' : ''} ${bindIp}:${port}`,
    type,
    rotate,
    listenHost: input.listenHost || (type === 'IPv6' && config.proxyDefaults.ipv6ListenHost) || config.proxyDefaults.listenHost || '0.0.0.0',
    port,
    tlsPort: Number(input.tlsPort || tlsPortFor(port)),
    bindIp,
    username: input.username || `user_${port}`,
    password: input.password || crypto.randomBytes(6).toString('hex'),
    region: input.region || config.proxyDefaults.region || 'AUTO',
    city: input.city || 'Auto',
    status: 'active',
    protocol: input.protocol || 'HTTP/SOCKS5',
    maxConnections: nonNegInt(input.maxConnections),
    bytesPerSec: nonNegInt(input.bytesPerSec),
    monthlyQuotaBytes: nonNegInt(input.monthlyQuotaBytes),
    perSrcMax: nonNegInt(input.perSrcMax || config.proxyDefaults.perSrcMax),
    upstreamUrl: typeof input.upstreamUrl === 'string' ? input.upstreamUrl.trim() : '',
    country: typeof input.country === 'string' ? input.country.toLowerCase().slice(0, 8) : '',
    asn: typeof input.asn === 'string' ? input.asn.toUpperCase().slice(0, 16) : '',
    expires: input.expires || addDays(Number(input.durationDays || config.proxyDefaults.expiresDays || 30))
  }
}

// Customer-facing host shown in proxy credentials. The client connects to
// this IP:port — it must always be IPv4 (so v4-only clients can connect),
// even for IPv6 proxies where bindIp is a v6 egress. Falls back to bindIp
// only if no IPv4 is known for the serving node.
function customerFacingHost(proxy) {
  const isV6 = String(proxy.type).toLowerCase() === 'ipv6'
  if (!isV6) return proxy.bindIp
  // Find the IPv4 of the node serving this proxy.
  const nodeId = proxy.nodeId || 'local'
  if (nodeId === 'local') {
    const v4 = ipv4Pool()[0] || detected.ipv4[0]?.address
    return v4 || proxy.bindIp
  }
  const node = config.nodes.find((n) => n.id === nodeId)
  const v4 = (node?.network?.ipv4 || [])[0]?.address
  return v4 || node?.host || proxy.bindIp
}

function pickBindIp(type, nodeId) {
  const wantV6 = String(type).toLowerCase() === 'ipv6'
  if (nodeId && nodeId !== 'local') {
    const node = config.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`node ${nodeId} not found`)
    // IPv6: mint a fresh /128 from the routed prefix. Guarantees no
    // collision with currently-bound proxies, and ~80 bits of entropy
    // makes accidental reuse of a previously-rotated-away IP
    // statistically impossible. IPv4: still draw from the finite list
    // of attached addresses (small pool, no minting possible).
    if (wantV6) {
      const used = currentlyUsedBindIps(nodeId)
      const minted = mintFreshIpv6(node, used)
      if (minted) return minted
      // Fall back to attached list if no routable prefix declared.
      const attached = nodeAddressPool(node, type)
      return attached.length ? attached[Math.floor(Math.random() * attached.length)] : null
    }
    const pool = nodeAddressPool(node, type)
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
  }
  // local node: prefer mint-fresh for v6 too.
  if (wantV6) {
    const synthNode = { network: { ipv6: detected.ipv6Prefixes.map((p) => ({ address: p.prefix, cidr: `${p.prefix}/${p.prefixLength}` })) } }
    if (synthNode.network.ipv6.length > 0) {
      const used = currentlyUsedBindIps('local')
      const minted = mintFreshIpv6(synthNode, used)
      if (minted) return minted
    }
    const pool = ipv6Pool()
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
  }
  const pool = ipv4Pool()
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

// Each proxy reserves TWO ports: `port` (plain TCP) + `tlsPort = port + 443`.
// nextPort skips any base port whose +443 slot is already taken by another
// proxy's tlsPort, so allocations never collide.
function nextPort() {
  const usedPlain = new Set(config.proxies.map((p) => Number(p.port)))
  const usedTls   = new Set(config.proxies.map((p) => Number(p.tlsPort || p.port + 443)))
  let port = Number(config.proxyDefaults.portStart || 10000)
  while (usedPlain.has(port) || usedTls.has(port) || usedPlain.has(port + 443) || usedTls.has(port + 443)) port += 1
  return port
}
function tlsPortFor(port) { return Number(port) + 443 }

// ──────────────────────────────────────────────────────────────────────────
// Multi-client format exports. Same credentials, same egress — different
// wire format so customers can paste into whatever app they already use:
// Clash Verge / ClashX / Mihomo (YAML), Shadowrocket (deep link), Surge
// (INI), v2rayN/Hiddify (base64 subscription of trojan:// + http:// + ...).
// All formats are derived from the existing connectUrls — zero new
// backend protocol, zero new server. The customer downloads one URL and
// pastes / opens it.
// ──────────────────────────────────────────────────────────────────────────

// Yaml-escape a string for safe embedding in a quoted scalar. Just double
// the inner quotes — Clash configs are simple enough that we don't need a
// full YAML library.
function yamlQ(s) { return '"' + String(s ?? '').replace(/"/g, '""') + '"' }

// One proxy → Clash/Mihomo YAML entries. Returns multiple lines (a trojan
// entry + an HTTP-proxy entry + a SOCKS5 entry) so the customer can pick
// whichever fits their app. `name` is unique per protocol so Clash doesn't
// collide on the proxies list.
function proxyToClashYaml(proxy, host) {
  const port = Number(proxy.unifiedPort && proxy.unifiedPort > 0 ? proxy.unifiedPort : proxy.port)
  const tlsPort = Number(proxy.tlsPort) || (port + 443)
  const lines = []
  // Trojan — best modern fit (TLS + password). Mihomo/Clash Verge/Stash all support.
  if (tlsPort > 0) {
    lines.push(`  - { name: ${yamlQ('PB-' + proxy.id + '-trojan')}, type: trojan, server: ${yamlQ(host)}, port: ${tlsPort}, password: ${yamlQ(proxy.password)}, sni: ${yamlQ(host)}, skip-cert-verify: true, udp: true }`)
  }
  // HTTP CONNECT proxy.
  lines.push(`  - { name: ${yamlQ('PB-' + proxy.id + '-http')}, type: http, server: ${yamlQ(host)}, port: ${port}, username: ${yamlQ(proxy.username)}, password: ${yamlQ(proxy.password)} }`)
  // SOCKS5.
  lines.push(`  - { name: ${yamlQ('PB-' + proxy.id + '-socks')}, type: socks5, server: ${yamlQ(host)}, port: ${port}, username: ${yamlQ(proxy.username)}, password: ${yamlQ(proxy.password)}, udp: true }`)
  return lines
}

// Build a full Clash config snippet for a SET of proxies (one order, or
// all owned). Includes a sensible default proxy-group ("Auto") so the
// file is usable as-is, not just a fragment.
function buildClashConfig(proxies, hostFor) {
  const proxyLines = []
  const nameTrojan = []; const nameHttp = []; const nameSocks = []
  for (const p of proxies) {
    const host = hostFor(p)
    if (!host) continue
    const ls = proxyToClashYaml(p, host)
    proxyLines.push(...ls)
    const tlsPort = Number(p.tlsPort) || (Number(p.port) + 443)
    if (tlsPort > 0) nameTrojan.push('PB-' + p.id + '-trojan')
    nameHttp.push('PB-' + p.id + '-http')
    nameSocks.push('PB-' + p.id + '-socks')
  }
  const all = [...nameTrojan, ...nameHttp, ...nameSocks]
  const lines = [
    '# ProxyBox — Clash / Mihomo / Stash config',
    `# ${proxies.length} proxies, ${all.length} entries`,
    'mixed-port: 7890',
    'mode: rule',
    'log-level: info',
    '',
    '# ── VPN-like system-wide routing (works in Clash Verge / Mihomo / Stash) ──',
    '# Remove the leading "# " on the next 5 lines to make EVERY app on this',
    '# machine route through the proxies (no per-app proxy config needed).',
    '# Requires admin/root the first time it starts.',
    '# tun:',
    '#   enable: true',
    '#   stack: system           # system (best compat) | mixed | gvisor',
    '#   auto-route: true',
    '#   auto-detect-interface: true',
    '',
    '# DNS through the tunnel — uncomment alongside tun: to prevent DNS leaks.',
    '# dns:',
    '#   enable: true',
    '#   listen: 127.0.0.1:53',
    '#   enhanced-mode: fake-ip',
    '#   nameserver: [https://1.1.1.1/dns-query, https://8.8.8.8/dns-query]',
    '',
    'proxies:',
    ...proxyLines,
    'proxy-groups:',
    `  - { name: Auto, type: url-test, proxies: [${all.map(yamlQ).join(', ')}], url: "http://www.gstatic.com/generate_204", interval: 300 }`,
    `  - { name: Manual, type: select, proxies: [${all.map(yamlQ).join(', ')}] }`,
    'rules:',
    '  - MATCH,Auto'
  ]
  return lines.join('\n') + '\n'
}

// Surge / Stash INI format — one block per proxy. Surge's "http" + "socks5"
// + "trojan" types all match exactly what we already serve.
function buildSurgeConfig(proxies, hostFor) {
  const lines = ['# ProxyBox — Surge / Stash config', '[Proxy]']
  const names = []
  for (const p of proxies) {
    const host = hostFor(p)
    if (!host) continue
    const port = Number(p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port)
    const tlsPort = Number(p.tlsPort) || (port + 443)
    lines.push(`PB-${p.id}-trojan = trojan, ${host}, ${tlsPort}, password=${p.password}, sni=${host}, skip-cert-verify=true`)
    lines.push(`PB-${p.id}-http = http, ${host}, ${port}, ${p.username}, ${p.password}`)
    lines.push(`PB-${p.id}-socks = socks5, ${host}, ${port}, ${p.username}, ${p.password}`)
    names.push(`PB-${p.id}-trojan`, `PB-${p.id}-http`, `PB-${p.id}-socks`)
  }
  lines.push('', '[Proxy Group]')
  lines.push(`Auto = url-test, ${names.join(', ')}, url=http://www.gstatic.com/generate_204, interval=300`)
  lines.push('', '[Rule]', 'FINAL,Auto')
  return lines.join('\n') + '\n'
}

// Shadowrocket / v2rayN / Hiddify all accept a base64-encoded list of
// per-line URIs (trojan:// + http:// + socks://). One subscription URL
// → app fetches → base64-decodes → imports all entries.
function buildSubscriptionBase64(proxies, hostFor) {
  const lines = []
  for (const p of proxies) {
    const host = hostFor(p); if (!host) continue
    const port = Number(p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port)
    const tlsPort = Number(p.tlsPort) || (port + 443)
    if (tlsPort > 0) {
      lines.push(`trojan://${encodeURIComponent(p.password)}@${host}:${tlsPort}?security=tls&sni=${host}&allowInsecure=1&type=tcp#${encodeURIComponent('PB-' + p.id)}`)
    }
    lines.push(`http://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${host}:${port}#${encodeURIComponent('PB-' + p.id + '-http')}`)
    lines.push(`socks://${Buffer.from(p.username + ':' + p.password).toString('base64').replace(/=+$/, '')}@${host}:${port}#${encodeURIComponent('PB-' + p.id + '-socks')}`)
  }
  return Buffer.from(lines.join('\n')).toString('base64')
}

// Plain newline-separated URL list (works with curl-pipe scripts + any
// app that takes a list of URLs, e.g. simple scrapers).
function buildPlainList(proxies, hostFor) {
  const lines = []
  for (const p of proxies) {
    const host = hostFor(p); if (!host) continue
    const port = Number(p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port)
    lines.push(`http://${p.username}:${p.password}@${host}:${port}`)
    lines.push(`socks5://${p.username}:${p.password}@${host}:${port}`)
  }
  return lines.join('\n') + '\n'
}

// Shadowrocket "import URL" for one proxy — deep-link the user can tap on
// mobile to add the proxy without scanning a QR. Format: see Shadowrocket
// docs; we mirror what their share button produces.
function shadowrocketImportFor(proxy, host) {
  const port = Number(proxy.unifiedPort && proxy.unifiedPort > 0 ? proxy.unifiedPort : proxy.port)
  const tlsPort = Number(proxy.tlsPort) || (port + 443)
  // Use the trojan:// uri (Shadowrocket parses it natively and adds it as
  // a server entry). Same payload as our existing connectUrls.trojan.
  return `trojan://${encodeURIComponent(proxy.password)}@${host}:${tlsPort}?security=tls&sni=${host}&allowInsecure=1&type=tcp#${encodeURIComponent('PB-' + proxy.id)}`
}

function publicProxy(proxy) {
  const proxyStats = publicStats(proxy.id)
  const rotate = Boolean(proxy.rotate) && proxy.type === 'IPv6'
  // Lazily mint the magic rotate URL token + backfill tlsPort. Mutates
  // `proxy` in place. Does NOT trigger saveConfig() here — the caller
  // saves once at end of its operation. Without this guard, calling
  // publicProxy() in a 500-proxy bulk-create loop fires 500 concurrent
  // saveConfig() writes of the full 3 MB config, which nukes I/O for
  // tens of seconds and 502s the nginx upstream before the bulk loop
  // finishes. The next normal saveConfig (mounted via the request that
  // created these proxies) persists the mutations.
  if (proxy.type === 'IPv6' && !proxy.rotateUrlToken) {
    proxy.rotateUrlToken = crypto.randomBytes(16).toString('hex')
  }
  if (!proxy.tlsPort) {
    proxy.tlsPort = tlsPortFor(proxy.port)
  }
  const rotateUrl = proxy.type === 'IPv6' && proxy.rotateUrlToken
    ? `${controlBaseUrl()}/api/rotate/${proxy.rotateUrlToken}`
    : null
  const host = customerFacingHost(proxy)
  // Unified listener endpoint (one port, all proxies, routed by username).
  // When enabled, customers can use a single host:port for ALL their proxies
  // — scales the engine to 100k+ proxies/node without exhausting TCP ports.
  const unifiedCfg = config.unifiedListener || {}
  const unifiedPort = Number(unifiedCfg.plainPort || 0)
  const unifiedTlsPort = Number(unifiedCfg.tlsPort || 0)
  const unifiedEnabled = unifiedCfg.enabled !== false && unifiedPort > 0
  // Connection URLs across protocols. Same credentials, same egress, different
  // listen port + protocol. See `style.md` / FAQ for client app per platform.
  const connectUrls = {
    http:        `http://${proxy.username}:${proxy.password}@${host}:${proxy.port}`,
    socks5:      `socks5://${proxy.username}:${proxy.password}@${host}:${proxy.port}`,
    socks5h:     `socks5h://${proxy.username}:${proxy.password}@${host}:${proxy.port}`,
    httpsProxy:  `https://${proxy.username}:${proxy.password}@${host}:${proxy.tlsPort}`,
    trojan:      `trojan://${encodeURIComponent(proxy.password)}@${host}:${proxy.tlsPort}?security=tls&sni=${host}&peer=${host}&allowInsecure=1&type=tcp#${encodeURIComponent('ProxyBox-' + proxy.id)}`,
    // App-import formats — same creds, different wire format. The UI shows
    // these as "copy" / "import" buttons in the expanded connect view so
    // customers can paste into Clash / Shadowrocket / Surge directly.
    clashYaml:    proxyToClashYaml(proxy, host).join('\n'),
    shadowrocket: shadowrocketImportFor(proxy, host)
  }
  if (unifiedEnabled) {
    connectUrls.unifiedHttp = `http://${proxy.username}:${proxy.password}@${host}:${unifiedPort}`
    if (unifiedTlsPort > 0) {
      connectUrls.unifiedHttpsProxy = `https://${proxy.username}:${proxy.password}@${host}:${unifiedTlsPort}`
    }
  }
  return {
    id: proxy.id,
    nodeId: proxy.nodeId || 'local',
    name: proxy.name,
    type: proxy.type,
    family: proxy.type === 'IPv6' ? 'ipv6' : 'ipv4',
    rotate,
    mode: rotate ? 'rotating' : 'sticky',
    listenHost: proxy.listenHost || config.proxyDefaults.listenHost || '0.0.0.0',
    // Customer-facing host: the IPv4 address the client connects to. For an
    // IPv6 proxy on a v6 node, this is the NODE's IPv4 (so v4-only clients can
    // still reach the proxy) — egress IPv6 lives in bindIp. For an IPv4 proxy
    // it's the bindIp itself. See CLAUDE.md "IPv6 proxy mechanism".
    ip: host,
    host,
    bindIp: proxy.bindIp,  // egress (v6 for IPv6 proxies, v4 for IPv4 proxies)
    port: proxy.port,
    tlsPort: proxy.tlsPort,  // TLS-wrap port (HTTPS proxy + Trojan)
    unifiedPort: unifiedEnabled ? unifiedPort : 0,
    unifiedTlsPort: unifiedEnabled && unifiedTlsPort > 0 ? unifiedTlsPort : 0,
    connectUrls,
    protocol: proxy.protocol || 'HTTP/SOCKS5',
    region: proxy.region || 'AUTO',
    city: proxy.city || 'Auto',
    status: proxy.status || 'active',
    latency: proxy.latency || 0,
    traffic: formatBytes(proxyStats.uploadBytes + proxyStats.downloadBytes),
    maxConnections: proxy.maxConnections || 0,
    bytesPerSec: proxy.bytesPerSec || 0,
    monthlyQuotaBytes: proxy.monthlyQuotaBytes || 0,
    perSrcMax: proxy.perSrcMax || 0,
    upstreamUrl: proxy.upstreamUrl ? '***' : '',
    country: proxy.country || '',
    asn: proxy.asn || '',
    expires: proxy.expires,
    expiresAt: proxy.expiresAt || null,
    createdAt: proxy.createdAt || null,
    orderId: proxy.orderId || null,
    zone: proxy.zone || null,
    label: proxy.label || '',
    tags: Array.isArray(proxy.tags) ? proxy.tags.slice() : [],
    rotateEverySec: Number(proxy.rotateEverySec) || 0,
    rotateUrl,
    autoRenew: !!proxy.autoRenew,
    autoRenewBudget: Number(proxy.autoRenewBudget) || 0,
    lastCheckOk: proxy.lastCheckOk ?? null,
    allowedSrcIps: Array.isArray(proxy.allowedSrcIps) ? proxy.allowedSrcIps.slice() : [],
    allowedSrcIpNotes: (proxy.allowedSrcIpNotes && typeof proxy.allowedSrcIpNotes === 'object') ? { ...proxy.allowedSrcIpNotes } : {},
    lastCheckedAt: proxy.lastCheckedAt || null,
    // Active session count vs hard cap (anti-abuse). Customer can hit
    // /disconnect-all to kick everyone in one go.
    session: readProxySession(proxy.id),
    folder: proxy.status === 'expired' ? 'expired' : proxy.status === 'warning' ? 'expiring' : (proxy.type || 'ipv4').toLowerCase(),
    stats: proxyStats
  }
}

function publicStats(id) {
  const item = ensureStats(id)
  return {
    uploadBytes: item.uploadBytes,
    downloadBytes: item.downloadBytes,
    monthBytes: item.monthKey === new Date().toISOString().slice(0, 7) ? item.monthBytes : 0,
    activeConnections: item.activeConnections,
    totalConnections: item.totalConnections,
    bpsIn: item.bpsIn || 0,
    bpsOut: item.bpsOut || 0,
    lastResetAt: item.lastResetAt
  }
}

function publicNetwork() {
  return {
    ipv4: detected.ipv4,
    ipv6: detected.ipv6,
    ipv6Prefixes: detected.ipv6Prefixes,
    ipv4PoolSize: ipv4Pool().length,
    ipv6PoolSize: ipv6Pool().length
  }
}

// Resolve the local control plane's family. Admin pins it via
// config.network.localFamily ('ipv4' | 'ipv6'); when unset, prefer v4 if any
// v4 address is detected, otherwise v6. We never return 'dual' — every node
// is classified into exactly one family so proxy allocation and UI grouping
// stay unambiguous. Stray /128 v6 host addresses with no routable prefix
// don't promote a v4-detected node to v6.
function localFamily() {
  const pinned = String(config.network?.localFamily || '').toLowerCase()
  if (pinned === 'ipv4' || pinned === 'ipv6') return pinned
  const hasV4 = (detected.ipv4 || []).length > 0
  const hasV6Prefix = (detected.ipv6Prefixes || []).length > 0
  if (hasV4) return 'ipv4'
  if (hasV6Prefix) return 'ipv6'
  return 'ipv4'
}

// Network view that hides the irrelevant family — an ipv4 node sees v6
// arrays as empty (and vice versa). Keeps the admin UI / sync flow from
// "leaking" stale v6 state into a v4-only deployment.
function localNetworkForFamily(family) {
  if (family === 'ipv6') {
    return { ipv4: [], ipv6: detected.ipv6, ipv6Prefixes: detected.ipv6Prefixes, ipv4PoolSize: 0, ipv6PoolSize: ipv6Pool().length }
  }
  return { ipv4: detected.ipv4, ipv6: [], ipv6Prefixes: [], ipv4PoolSize: ipv4Pool().length, ipv6PoolSize: 0 }
}

function controlBaseUrl() {
  // Prefer explicit public URL (set when behind nginx + TLS) so install commands
  // shown to admin / customers carry the customer-facing https://my.domain URL
  // even though the node process is bound to 127.0.0.1.
  const pub = (config.api && config.api.publicUrl) || process.env.PROXYHUB_PUBLIC_URL
  if (pub) return String(pub).replace(/\/$/, '')
  const h = config.api.host
  if (h && h !== '0.0.0.0' && h !== '::' && h !== '127.0.0.1') return `http://${h}:${config.api.port}`
  return `http://${detected.ipv4[0]?.address || '127.0.0.1'}:${config.api.port}`
}
function mtlsPort() {
  return Number(config.api.mtlsPort) || (Number(config.api.port) + 1)
}
function mtlsHost() {
  // mTLS listener must remain publicly reachable so remote agents can connect.
  // Falls back to '0.0.0.0' even if the HTTP API is bound to 127.0.0.1.
  return (config.api && config.api.mtlsHost) || '0.0.0.0'
}
function mtlsBaseUrl() {
  // Agents connect to mTLS via IP, not hostname — the PKI server cert is
  // issued with IP SANs (one per detected eth0 alias) and no DNS SAN for the
  // public hostname, so using `proxybox.pro:8788` fails TLS verification.
  // controlUrl keeps the hostname because nginx terminates TLS at 443.
  const explicit = config.api && config.api.mtlsAdvertiseHost
  if (explicit) return `https://${explicit}:${mtlsPort()}`
  const ip = detected.ipv4[0]?.address
  if (ip) return `https://${ip}:${mtlsPort()}`
  const h = config.api.host
  if (h && h !== '0.0.0.0' && h !== '::' && h !== '127.0.0.1') return `https://${h}:${mtlsPort()}`
  return `https://127.0.0.1:${mtlsPort()}`
}

function localNode() {
  const fam = localFamily()
  return {
    id: 'local',
    name: 'Control plane',
    role: 'control+agent',
    family: fam,
    familyPinned: Boolean(config.network?.localFamily),
    region: (config.api.region || 'auto').toLowerCase(),
    zone: (config.api.zone || config.api.region || 'auto').toLowerCase(),
    host: detected.ipv4[0]?.address || config.api.host,
    status: 'online',
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    proxies: config.proxies.filter((p) => (p.nodeId || 'local') === 'local').length,
    listeners: listeners.size,
    network: localNetworkForFamily(fam),
    metrics: localSelfMetrics(),
    createdAt: null,
    lastSeenAt: new Date().toISOString()
  }
}

function nodeIsOnline(node) {
  return Boolean(node.lastSeenAt) && Date.now() - new Date(node.lastSeenAt).getTime() < 90_000
}

// Zone-aware variant: only consider nodes whose `zone` matches `wantZone`.
// Empty wantZone behaves like pickBalancedNode. Falls back to least-loaded
// across all zones if nothing matches (so a misconfigured fleet still works).
function pickZoneBalancedNode(type, wantZone) {
  if (!wantZone) return pickBalancedNode(type)
  const want = String(type).toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4'
  const candidates = []
  const localFam = localFamily()
  const localInZone = ((config.api?.zone || config.api?.region || '') === wantZone) || wantZone === 'auto'
  if (localInZone && localFam === want) {
    const localM = localSelfMetrics()
    const localProxies = config.proxies.filter((p) => (p.nodeId || 'local') === 'local').length
    candidates.push({ id: 'local', score: localProxies + (localM.cpuPct * 0.5) + (localM.ramPct * 0.3) })
  }
  for (const node of config.nodes) {
    if (!nodeIsOnline(node)) continue
    if ((node.zone || node.region || '') !== wantZone) continue
    const fam = (node.family || '').toLowerCase()
    if (fam && fam !== 'dual' && fam !== want) continue
    const m = node.metrics || {}
    const p = config.proxies.filter((x) => x.nodeId === node.id).length
    candidates.push({ id: node.id, score: p + (Number(m.cpuPct) || 0) * 0.5 + (Number(m.ramPct) || 0) * 0.3 })
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]?.id || pickBalancedNode(type)
}

// Pick the least-loaded node that can host a proxy of `type`. Considers all online
// agents + the local control plane. Score = activeProxies + cpu*0.5 + ramPct*0.3.
function pickBalancedNode(type) {
  const want = String(type).toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4'
  const candidates = []
  // Local only competes when its declared family matches the requested type.
  // An ipv4-only control plane is never picked for v6 proxies (and vice versa).
  const localFam = localFamily()
  if (localFam === want) {
    const localProxies = config.proxies.filter((p) => (p.nodeId || 'local') === 'local').length
    const localM = localSelfMetrics()
    candidates.push({ id: 'local', score: localProxies + (localM.cpuPct * 0.5) + (localM.ramPct * 0.3) })
  }
  for (const node of config.nodes) {
    if (!nodeIsOnline(node)) continue
    const fam = (node.family || '').toLowerCase()
    if (fam && fam !== 'dual' && fam !== want) continue
    const m = node.metrics || {}
    const p = config.proxies.filter((x) => x.nodeId === node.id).length
    const score = p + (Number(m.cpuPct) || 0) * 0.5 + (Number(m.ramPct) || 0) * 0.3
    candidates.push({ id: node.id, score })
  }
  candidates.sort((a, b) => a.score - b.score)
  // Fallback to 'local' only matters when there's literally no candidate;
  // createProxy() will then surface a clear family-mismatch error.
  return candidates[0]?.id || 'local'
}

// Sample CPU, RAM, load, and the eth0/primary NIC bytes from /proc â€” zero-dep, cached 5s.
// Returns { cpuPct, ramPct, ramTotal, ramUsed, load1, load5, netRxBps, netTxBps, uptimeSec }
function localSelfMetrics() {
  const now = Date.now()
  if (selfMetricsCache.value && now - selfMetricsCache.ts < 5000) return selfMetricsCache.value
  const cpuPct = readCpuPct()
  const { ramTotal, ramUsed, ramPct } = readMem()
  const { load1, load5 } = readLoad()
  const { netRxBps, netTxBps } = readNetBps()
  const uptimeSec = Math.round(process.uptime())
  selfMetricsCache = { ts: now, value: { cpuPct, ramTotal, ramUsed, ramPct, load1, load5, netRxBps, netTxBps, uptimeSec } }
  return selfMetricsCache.value
}

function readCpuPct() {
  try {
    const line = require('node:fs').readFileSync('/proc/stat', 'utf8').split('\n')[0]
    const parts = line.trim().split(/\s+/).slice(1).map((x) => Number(x))
    const idle = parts[3] + (parts[4] || 0)
    const total = parts.reduce((a, b) => a + b, 0)
    let pct = 0
    if (lastCpuSample) {
      const dT = total - lastCpuSample.total
      const dI = idle - lastCpuSample.idle
      if (dT > 0) pct = Math.max(0, Math.min(100, Math.round(((dT - dI) * 100) / dT)))
    }
    lastCpuSample = { idle, total }
    return pct
  } catch { return 0 }
}

function readMem() {
  try {
    const txt = require('node:fs').readFileSync('/proc/meminfo', 'utf8')
    const m = {}
    for (const line of txt.split('\n')) {
      const mm = line.match(/^(\S+):\s+(\d+)/)
      if (mm) m[mm[1]] = Number(mm[2]) * 1024
    }
    const ramTotal = m.MemTotal || 0
    const avail = m.MemAvailable || (m.MemFree || 0)
    const ramUsed = Math.max(0, ramTotal - avail)
    const ramPct = ramTotal ? Math.round((ramUsed * 100) / ramTotal) : 0
    return { ramTotal, ramUsed, ramPct }
  } catch { return { ramTotal: 0, ramUsed: 0, ramPct: 0 } }
}

function readLoad() {
  try {
    const txt = require('node:fs').readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/)
    return { load1: Number(txt[0]) || 0, load5: Number(txt[1]) || 0 }
  } catch { return { load1: 0, load5: 0 } }
}

function readNetBps() {
  try {
    const txt = require('node:fs').readFileSync('/proc/net/dev', 'utf8')
    let rx = 0, tx = 0
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([^:\s]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/)
      if (!m) continue
      const iface = m[1]
      if (iface === 'lo') continue
      rx += Number(m[2]); tx += Number(m[3])
    }
    const now = Date.now()
    let netRxBps = 0, netTxBps = 0
    if (lastNetSample) {
      const dt = (now - lastNetSample.ts) / 1000
      if (dt > 0) {
        netRxBps = Math.max(0, Math.round((rx - lastNetSample.rx) / dt))
        netTxBps = Math.max(0, Math.round((tx - lastNetSample.tx) / dt))
      }
    }
    lastNetSample = { ts: now, rx, tx }
    return { netRxBps, netTxBps }
  } catch { return { netRxBps: 0, netTxBps: 0 } }
}

function publicNode(node) {
  const online = nodeIsOnline(node)
  const owner = node.ownerId ? config.users.find((u) => u.id === node.ownerId) : null
  return {
    id: node.id,
    name: node.name,
    role: 'agent',
    family: (node.family || 'dual').toLowerCase(),
    region: (node.region || 'auto').toLowerCase(),
    zone: (node.zone || node.region || 'auto').toLowerCase(),
    tag: node.tag || '',
    host: node.host,
    sshUser: node.sshUser,
    status: online ? 'online' : (node.lastSeenAt ? 'offline' : (node.status || 'registered')),
    version: node.version || null,
    proxies: config.proxies.filter((p) => p.nodeId === node.id).length,
    network: node.network || null,
    metrics: node.metrics || null,
    hasCreds: Boolean(node.sshSecret || node.sshKeySecret),
    sshPort: node.sshPort || 22,
    createdAt: node.createdAt || null,
    lastSeenAt: node.lastSeenAt || null,
    installCommand: `curl -fsSL ${controlBaseUrl()}/api/agent/install/${node.enrollToken} | sudo bash`,
    latestAgentVersion: LATEST_AGENT_VERSION,
    outdated: Boolean(node.version && !agentVersionMatches(node.version, LATEST_AGENT_VERSION)),
    // BYON ownership — null/system = admin pool; otherwise the customer email
    // who claimed it. Frontend can render "BYON" tag + show owner inline.
    ownerId: node.ownerId || null,
    ownerEmail: owner ? owner.email : null,
    isByon: Boolean(node.ownerId)
  }
}

// Treat "1.3.0-rust" and "1.3.0" as the same logical release — agent reports
// the base + a "-rust" or "-node" suffix to indicate runtime, but the on-the-
// wire protocol is identical. Strip the suffix before comparing.
function agentVersionMatches(agentVer, latest) {
  const base = String(agentVer || '').split('-')[0]
  return base === String(latest || '')
}

function sweepNodes() {
  const failoverAfterMs = Number(config.api.clusterFailoverMs ?? 5 * 60_000) // default 5 min; 0 = disabled
  let changed = false
  for (const node of config.nodes) {
    const prev = node.status
    if (nodeIsOnline(node)) {
      node.status = 'online'
      if (prev === 'offline' || prev === 'node-down') pushAlert(`node:${node.id}:back`, `Node ${node.name} is back online`, 'info')
      const m = node.metrics
      if (m && Number(m.cpuPct) >= 90) pushAlert(`node:${node.id}:cpu`, `Node ${node.name} CPU=${m.cpuPct}%`, 'warn')
      if (m && Number(m.ramPct) >= 90) pushAlert(`node:${node.id}:ram`, `Node ${node.name} RAM=${m.ramPct}%`, 'warn')
    } else if (node.lastSeenAt) {
      node.status = 'offline'
      if (prev === 'online') pushAlert(`node:${node.id}:offline`, `Node ${node.name} went OFFLINE`, 'crit')
      // Cluster failover: if the node has been offline longer than the threshold,
      // try reassigning its proxies to another online node of compatible family.
      const downForMs = Date.now() - new Date(node.lastSeenAt).getTime()
      if (downForMs > failoverAfterMs && failoverAfterMs > 0) {
        for (const proxy of config.proxies) {
          if (proxy.nodeId !== node.id || proxy.status === 'expired' || proxy.status === 'failover-pending') continue
          try {
            const target = pickBalancedNode(proxy.type)
            if (target && target !== node.id && target !== 'local') {
              proxy.nodeId = target
              const newBind = pickBindIp(proxy.type, target)
              if (newBind) proxy.bindIp = newBind
              changed = true
              pushAlert(`proxy:${proxy.id}:failover`, `Proxy ${proxy.id} reassigned ${node.id}â†'${target}`, 'warn')
            } else if (target === 'local') {
              proxy.nodeId = 'local'
              const newBind = pickBindIp(proxy.type, 'local')
              if (newBind) proxy.bindIp = newBind
              startProxy(proxy)
              changed = true
            } else {
              proxy.status = 'failover-pending'
              changed = true
            }
          } catch { proxy.status = 'failover-pending'; changed = true }
        }
      }
    }
  }
  if (changed) saveConfig().catch(() => {})
}

function nodeFromRequest(req) {
  const h = req.headers['authorization'] || ''
  if (!h.toLowerCase().startsWith('bearer ')) return null
  const token = h.slice(7).trim()
  return config.nodes.find((n) => n.agentToken && timingEqual(n.agentToken, token)) || null
}

function agentProxy(p) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    rotate: Boolean(p.rotate),
    listenHost: p.listenHost || config.proxyDefaults.listenHost || '0.0.0.0',
    bindIp: p.bindIp,
    port: p.port,
    tlsPort: p.tlsPort || tlsPortFor(p.port),
    username: p.username,
    password: p.password,
    region: p.region || 'AUTO',
    status: p.status || 'active',
    maxConnections: p.maxConnections || 0,
    bytesPerSec: p.bytesPerSec || 0,
    monthlyQuotaBytes: p.monthlyQuotaBytes || 0,
    perSrcMax: Number(p.perSrcMax || config.proxyDefaults.perSrcMax || 0),
    upstreamUrl: p.upstreamUrl || '',
    country: p.country || '',
    asn: p.asn || '',
    allowPrivateTargets: p.allowPrivateTargets ?? config.proxyDefaults.allowPrivateTargets ?? false,
    allowedSrcIps: Array.isArray(p.allowedSrcIps) ? p.allowedSrcIps : [],
    // Kick counter — agent compares to its in-memory epoch and disconnects
    // all active sockets for this proxy when master's value is higher.
    kickEpoch: Number(p.kickEpoch || 0),
    expires: p.expires
  }
}


function winAgentInstallScript(node, base) {
  // PowerShell installer. Downloads agent.js, writes config, runs as a Windows
  // Service via NSSM if present, else a Scheduled Task (auto-start at boot),
  // else a foreground process. Idempotent — re-running upgrades agent.js in place.
  return `# ProxyBox agent (Windows) installer
# Node: "${node.name}" (${node.id})
# Usage: iwr -useb ${base}/api/agent/install-win/${node.enrollToken} | iex
$ErrorActionPreference = 'Stop'
$Control = '${base}'
$Enroll  = '${node.enrollToken}'
$AppDir  = Join-Path $env:ProgramData 'ProxyBox'
$ConfigPath = Join-Path $AppDir 'agent.json'
$AgentExe   = Join-Path $AppDir 'proxybox-agent.exe'
$AgentJs    = Join-Path $AppDir 'agent.js'
$LogDir     = Join-Path $AppDir 'logs'
New-Item -ItemType Directory -Force -Path $AppDir, $LogDir | Out-Null

Write-Host "[ProxyBox] Installing agent to $AppDir"

# 1) Try Rust native binary first (faster, no Node.js dep). Fall back to Node.js agent.js.
$UseRust = $false
try {
  Write-Host "[ProxyBox] Trying Rust binary..."
  Invoke-WebRequest -Uri "$Control/api/agent/binary-win/$Enroll" -OutFile "$AgentExe.new" -UseBasicParsing -ErrorAction Stop
  if ((Get-Item "$AgentExe.new").Length -gt 100000) {
    Move-Item -Force "$AgentExe.new" $AgentExe
    $UseRust = $true
    Write-Host "[ProxyBox] Rust binary downloaded ($([math]::Round((Get-Item $AgentExe).Length/1MB,1)) MB)."
  } else {
    Remove-Item "$AgentExe.new" -Force -ErrorAction SilentlyContinue
  }
} catch { Write-Host "[ProxyBox] Rust binary unavailable, falling back to Node.js: $($_.Exception.Message)" -ForegroundColor Yellow }

if (-not $UseRust) {
  # Verify Node.js
  try {
    $nodeVer = (& node --version) 2>$null
    if (-not $nodeVer) { throw 'no node' }
    $major = [int]($nodeVer -replace '^v','' -replace '\..+$','')
    if ($major -lt 16) { throw "node $nodeVer too old (need 16+)" }
    Write-Host "[ProxyBox] Node $nodeVer OK"
  } catch {
    Write-Host "[ProxyBox] ERROR: Need either Rust binary on server OR Node.js 16+ locally. Install: https://nodejs.org" -ForegroundColor Red
    exit 1
  }
  # Download agent.js
  Write-Host "[ProxyBox] Downloading agent.js..."
  try { Invoke-WebRequest -Uri "$Control/api/agent/code/$Enroll" -OutFile $AgentJs -UseBasicParsing }
  catch { Write-Host "[ProxyBox] ERROR: download agent.js failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}

# 3) Write config (only enrollToken — agent will swap it for a bearer token on first run).
$cfg = @{ controlUrl = $Control; enrollToken = $Enroll } | ConvertTo-Json
Set-Content -Path $ConfigPath -Value $cfg -Encoding utf8

# 4) Firewall: allow inbound TCP on proxy port range (default 20000-40000).
$progPath = if ($UseRust) { $AgentExe } else { (Get-Command node).Source }
$nodePath = if ($UseRust) { $AgentExe } else { (Get-Command node).Source }
try {
  if (-not (Get-NetFirewallRule -DisplayName 'ProxyBox Agent inbound' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'ProxyBox Agent inbound' -Direction Inbound -Action Allow -Protocol TCP -LocalPort '20000-40000' -Profile Any -Program $nodePath | Out-Null
    Write-Host "[ProxyBox] Firewall rule added (TCP 20000-40000)."
  }
} catch { Write-Host "[ProxyBox] Firewall rule skipped: $($_.Exception.Message)" -ForegroundColor Yellow }

# 5) Try NSSM (if installed) -> Windows Service.
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
  Write-Host "[ProxyBox] Registering Windows Service via NSSM..."
  & nssm stop ProxyBoxAgent 2>$null
  & nssm remove ProxyBoxAgent confirm 2>$null
  if ($UseRust) {
    & nssm install ProxyBoxAgent $AgentExe
  } else {
    & nssm install ProxyBoxAgent (Get-Command node).Source $AgentJs
  }
  & nssm set ProxyBoxAgent AppDirectory $AppDir
  & nssm set ProxyBoxAgent AppEnvironmentExtra "PROXYHUB_AGENT_CONFIG=$ConfigPath"
  & nssm set ProxyBoxAgent AppStdout (Join-Path $LogDir 'agent.log')
  & nssm set ProxyBoxAgent AppStderr (Join-Path $LogDir 'agent.err.log')
  & nssm set ProxyBoxAgent Start SERVICE_AUTO_START
  & nssm start ProxyBoxAgent
  Write-Host "[ProxyBox] Service running ($(if ($UseRust) {'Rust'} else {'Node.js'})). Log: $LogDir\\agent.log"
  exit 0
}

# 6) Fallback: Scheduled Task that runs at boot + immediately.
Write-Host "[ProxyBox] NSSM not found — using Scheduled Task instead. (Install NSSM for a proper service.)"
if ($UseRust) {
  $action = New-ScheduledTaskAction -Execute $AgentExe -WorkingDirectory $AppDir
} else {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "\`"$AgentJs\`"" -WorkingDirectory $AppDir
}
$trigger1 = New-ScheduledTaskTrigger -AtStartup
$trigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
try {
  Unregister-ScheduledTask -TaskName 'ProxyBoxAgent' -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName 'ProxyBoxAgent' -Action $action -Trigger @($trigger1, $trigger2) -Settings $settings -Principal $principal | Out-Null
  Write-Host "[ProxyBox] Scheduled Task registered (runs as SYSTEM at boot)."
  Write-Host "[ProxyBox] To inspect: Get-ScheduledTask ProxyBoxAgent | Get-ScheduledTaskInfo"
} catch {
  Write-Host "[ProxyBox] Could not register Scheduled Task (need admin?): $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "[ProxyBox] Starting agent in foreground instead. Press Ctrl+C to stop."
  $env:PROXYHUB_AGENT_CONFIG = $ConfigPath
  if ($UseRust) { & $AgentExe } else { & node $AgentJs }
}
`
}

// ── Fleet (zero-touch) enrollment helpers ────────────────────────────────
// Persisted in config.api.fleetEnrollToken. Admin can rotate or revoke.
function fleetTokenPayload(token) {
  const base = controlBaseUrl()
  return {
    token,
    // Recommended: bash -s <family> — single URL, operator picks v4/v6 inline.
    // Script parses `$1` and accepts ipv4/v4/4 → ipv4 and ipv6/v6/6 → ipv6.
    installLinuxV4: `curl -fsSL ${base}/api/agent/claim/${token} | sudo bash -s v4`,
    installLinuxV6: `curl -fsSL ${base}/api/agent/claim/${token} | sudo bash -s v6`,
    // Alternative — distinct URLs that preset FAMILY (for chat/email pastes
    // where `bash -s` might get mangled).
    installLinuxV4Url: `curl -fsSL ${base}/api/agent/claim-v4/${token} | sudo bash`,
    installLinuxV6Url: `curl -fsSL ${base}/api/agent/claim-v6/${token} | sudo bash`,
    // Generic (requires FAMILY env or `bash -s`)
    installLinux:   `curl -fsSL ${base}/api/agent/claim/${token} | sudo bash -s v4   # or 'v6'`,
    installWindows: `iwr -useb ${base}/api/agent/claim-win/${token} | iex`,
    // Uninstall one-liner (idempotent clean removal)
    uninstall:      `curl -fsSL ${base}/api/agent/uninstall/${token} | sudo bash`,
    downloadLinuxV4: `${base}/api/agent/claim-v4/${token}`,
    downloadLinuxV6: `${base}/api/agent/claim-v6/${token}`,
    downloadLinux:   `${base}/api/agent/claim/${token}`,
    downloadWindows: `${base}/api/agent/claim-win/${token}`,
    binaryLinux:    `${base}/api/agent/claim-binary/${token}`,
    binaryWindows:  `${base}/api/agent/claim-binary-win/${token}`
  }
}

function fleetTokenValid(candidate) {
  const cur = (config.api && config.api.fleetEnrollToken) ? String(config.api.fleetEnrollToken) : ''
  if (!cur || !candidate) return false
  return timingEqual(cur, String(candidate))
}

// Customer fleet tokens — opted-in BYON (Bring Your Own Node) feature. Each
// customer can generate their own enroll token; nodes claimed via a customer
// token get `ownerId` set, are visible only to that customer via
// /api/v1/user/nodes, and proxies created on them are FREE (skip billing).
// Token format: `usr_<userId-hex>_<random-hex>` so the userId is recoverable
// from the token without a DB lookup, and the `usr_` prefix distinguishes it
// from the global admin fleet token. Stored under user.fleetTokens[].
// Public shape of a customer-owned node (BYON). Same as admin's publicNode
// but trimmed: no SSH secrets, no admin-only fields.
function publicNodeForCustomer(node) {
  const ownedProxies = config.proxies.filter((p) => p.nodeId === node.id && p.ownerId === node.ownerId)
  const stats = ownedProxies.reduce((acc, p) => {
    const s = ensureStats(p.id)
    acc.active += (p.status !== 'expired') ? 1 : 0
    acc.up += Number(s.uploadBytes || 0)
    acc.dn += Number(s.downloadBytes || 0)
    acc.conns += Number(s.activeConnections || 0)
    return acc
  }, { active: 0, up: 0, dn: 0, conns: 0 })
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    family: node.family || 'dual',
    status: node.status || 'enrolled',
    version: node.version || null,
    lastSeenAt: node.lastSeenAt || null,
    disabled: !!node.disabled,
    proxyCount: ownedProxies.length,
    activeProxies: stats.active,
    activeConns: stats.conns,
    uploadBytes: stats.up,
    downloadBytes: stats.dn,
    network: node.network || null,
    region: node.region || '',
    zone: node.zone || '',
    tag: node.tag || ''
  }
}
function customerFleetTokenPayload(token) {
  const base = controlBaseUrl()
  return {
    token,
    installLinuxV4: `curl -fsSL ${base}/api/agent/claim/${token} | sudo bash -s v4`,
    installLinuxV6: `curl -fsSL ${base}/api/agent/claim/${token} | sudo bash -s v6`,
    installWindows: `iwr -useb ${base}/api/agent/claim-win/${token} | iex`,
    uninstall:      `curl -fsSL ${base}/api/agent/uninstall/${token} | sudo bash`
  }
}

// Public shape of a Virtualizor instance — strips encrypted creds + decrypted
// values. Hint = last 4 chars so admin recognizes which key is stored.
function publicVirtualizor(inst) {
  return {
    id: inst.id,
    label: inst.label || '',
    zone: inst.zone || '',
    panelUrl: inst.panelUrl || '',
    apiKey:  inst.apiKeyEncrypted  ? '••••••••' + (inst.apiKeyHint  || '') : '',
    apiPass: inst.apiPassEncrypted ? '••••••••' + (inst.apiPassHint || '') : '',
    insecureTls: inst.insecureTls !== false,
    enabled: !!inst.enabled,
    createdAt: inst.createdAt || null,
    lastTestedAt: inst.lastTestedAt || null,
    lastTestOk: inst.lastTestOk ?? null,
    lastTestError: inst.lastTestError || null
  }
}
// Decrypt a specific Virtualizor instance's creds for outbound API calls.
function decryptVirtualizorInstance(inst) {
  if (!inst || !inst.panelUrl || !inst.apiKeyEncrypted || !inst.apiPassEncrypted) return null
  try {
    return {
      panelUrl: inst.panelUrl,
      apiKey: decryptSecret(inst.apiKeyEncrypted),
      apiPass: decryptSecret(inst.apiPassEncrypted),
      insecureTls: inst.insecureTls !== false
    }
  } catch { return null }
}
// Resolve (and cache) the Virtualizor uid for this customer on a specific
// VZ instance. The map is keyed by VZ instance id so a customer who buys
// hubs on two different panels gets two independent uids cached. We never
// store the VZ password — once the uid exists we pass it directly to `addvs`.
async function ensureUserVzUid(user, vzInstanceId, cfg) {
  if (!user.virtualizorUidsByInstance) user.virtualizorUidsByInstance = {}
  const cached = user.virtualizorUidsByInstance[vzInstanceId]
  if (cached) return Number(cached)
  const r = await virtualizor.ensureUser(cfg, {
    email: user.email,
    firstName: user.firstName || user.name || 'ProxyBox',
    lastName: user.lastName || 'Customer'
  })
  if (!r.uid) throw new Error('Virtualizor user creation returned no uid')
  user.virtualizorUidsByInstance[vzInstanceId] = r.uid
  return r.uid
}

// Pick instance by id (preferred) or by zone (fallback for legacy plans).
function findVirtualizorInstance({ id, zone }) {
  const list = config.virtualizors || []
  if (id) {
    const byId = list.find((v) => v.id === id && v.enabled !== false)
    if (byId) return byId
  }
  if (zone) {
    const byZone = list.find((v) => v.zone === zone && v.enabled !== false)
    if (byZone) return byZone
  }
  return null
}

// Decrypt the Virtualizor config for outbound API calls. Returns null if
// not configured. Never store the plaintext object — call decrypt at each
// use-site so the secret is in memory for as short a time as possible.
function decryptedVirtualizorConfig() {
  const v = config.virtualizor
  if (!v || !v.panelUrl || !v.apiKeyEncrypted || !v.apiPassEncrypted) return null
  try {
    return {
      panelUrl: v.panelUrl,
      apiKey: decryptSecret(v.apiKeyEncrypted),
      apiPass: decryptSecret(v.apiPassEncrypted),
      insecureTls: v.insecureTls !== false
    }
  } catch { return null }
}

// Normalize + validate a hub-plan create/update payload. Internal vz.* IDs
// are stored separately from customer-visible fields so a future privacy
// change (or admin-only inspection) is straightforward.
function normalizeHubPlan(input) {
  const i = input || {}
  const out = {
    id: i.id,
    name: String(i.name || '').trim().slice(0, 80) || 'Unnamed plan',
    description: String(i.description || '').trim().slice(0, 500),
    region: String(i.region || '').trim().slice(0, 32),
    // Hub plans must be a single family. Each Virtualizor instance routes 1
    // network type — mixing ipv4/ipv6 in a hub creates customer-facing
    // ambiguity (which IP do they connect to?). Default ipv4.
    family: ['ipv4', 'ipv6'].includes(String(i.family || '').toLowerCase()) ? i.family.toLowerCase() : 'ipv4',
    enabled: i.enabled !== false,
    hourlyPrice: Math.max(0, Math.floor(Number(i.hourlyPrice) || 0)),
    currency: String(i.currency || 'VND').toUpperCase().slice(0, 5),
    maxQuantity: Math.max(0, Math.floor(Number(i.maxQuantity) || 0)),  // 0 = unlimited
    minHours: Math.max(1, Math.floor(Number(i.minHours) || 1)),
    maxHours: Math.max(1, Math.floor(Number(i.maxHours) || 8760)),
    specs: {
      cpu:       Math.max(1, Math.floor(Number(i.specs?.cpu) || 1)),
      ramGB:     Math.max(0, Number(i.specs?.ramGB) || 0),
      diskGB:    Math.max(0, Number(i.specs?.diskGB) || 0),
      bandwidthGB: Math.max(0, Number(i.specs?.bandwidthGB) || 0),
      ipv4Count: Math.max(0, Number(i.specs?.ipv4Count) || 0),
      ipv6Range: String(i.specs?.ipv6Range || '').slice(0, 16)
    },
    // Virtualizor mapping — admin-only, never exposed to customer. Use null
    // check (not truthy) so 0 (a valid Virtualizor serverId for the master)
    // is preserved instead of being coerced to null.
    vz: {
      instanceId: i.vz?.instanceId ? String(i.vz.instanceId).slice(0, 32) : null,
      virt: String(i.vz?.virt || 'kvm').slice(0, 16),
      serverId: (i.vz?.serverId !== undefined && i.vz?.serverId !== null && i.vz?.serverId !== '') ? Number(i.vz.serverId) : null,
      planId:   (i.vz?.planId   !== undefined && i.vz?.planId   !== null && i.vz?.planId   !== '') ? Number(i.vz.planId)   : null,
      osId:     (i.vz?.osId     !== undefined && i.vz?.osId     !== null && i.vz?.osId     !== '') ? Number(i.vz.osId)     : null,
      ipPool:   i.vz?.ipPool  ? String(i.vz.ipPool).slice(0, 32)  : null,
      ip6Pool:  i.vz?.ip6Pool ? String(i.vz.ip6Pool).slice(0, 32) : null,
      diskTemplate: (i.vz?.diskTemplate !== undefined && i.vz?.diskTemplate !== null && i.vz?.diskTemplate !== '') ? Number(i.vz.diskTemplate) : null
    },
    createdAt: i.createdAt || undefined
  }
  return out
}

// Public view of a hub plan — strips internal Virtualizor IDs.
function publicHubPlan(plan) {
  if (!plan) return null
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    region: plan.region,
    family: plan.family,
    enabled: plan.enabled,
    hourlyPrice: plan.hourlyPrice,
    currency: plan.currency,
    minHours: plan.minHours,
    maxHours: plan.maxHours,
    specs: plan.specs
  }
}

function customerFleetTokenOwner(candidate) {
  const tok = String(candidate || '')
  if (!tok.startsWith('usr_')) return null
  for (const u of config.users || []) {
    if (u.role && u.role !== 'customer') continue
    // Unified token: user.apiKey IS the fleet token (single-token model).
    // Legacy fleetTokens array still honored for backward compat.
    if (u.apiKey && timingEqual(u.apiKey, tok)) return u
    if (Array.isArray(u.fleetTokens)) {
      for (const t of u.fleetTokens) {
        if (timingEqual(t, tok)) return u
      }
    }
  }
  return null
}

// Generate the user-scoped unified token. Format `usr_<userId-alnum>_<24-hex>`
// so customerFleetTokenOwner() can short-circuit on the prefix and we can
// extract the userId for audit without a full table scan.
function generateUserToken(userId) {
  const slug = String(userId).replace(/[^a-z0-9]/gi, '').slice(0, 24)
  return `usr_${slug}_${crypto.randomBytes(20).toString('hex')}`
}

function buildAgentEnrollPayload(node) {
  const payload = {
    nodeId: node.id,
    token: node.agentToken,
    controlUrl: controlBaseUrl(),
    family: (node.family || 'dual').toLowerCase(),
    proxyDefaults: {
      listenHost: config.proxyDefaults.listenHost || '0.0.0.0',
      allowPrivateTargets: config.proxyDefaults.allowPrivateTargets || false,
      maxConnectionsPerProxy: config.proxyDefaults.maxConnectionsPerProxy || 0,
      bytesPerSec: config.proxyDefaults.bytesPerSec || 0,
      monthlyQuotaBytes: config.proxyDefaults.monthlyQuotaBytes || 0
    }
  }
  if (pki) {
    const client = issueClientCert(node.id)
    if (client) {
      payload.mtlsUrl = mtlsBaseUrl()
      payload.caCert = pki.caCertPem
      payload.clientCert = client.certPem
      payload.clientKey = client.keyPem
    }
  }
  return payload
}

async function serveAgentBinary(res, isWindows) {
  const candidates = isWindows
    ? [
        process.env.PROXYBOX_AGENT_BIN_WIN,
        process.env.PROXYHUB_AGENT_BIN_WIN,
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-pc-windows-gnu', 'release', 'proxybox-agent.exe'),
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-pc-windows-gnu', 'release', 'proxyhub-agent.exe')
      ].filter(Boolean)
    : [
        process.env.PROXYBOX_AGENT_BIN,
        process.env.PROXYHUB_AGENT_BIN,
        path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxybox-agent'),
        path.join(__dirname, '..', 'rust-core', 'target', 'release', 'proxyhub-agent'),
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-unknown-linux-musl', 'release', 'proxybox-agent'),
        path.join(__dirname, '..', 'rust-core', 'target', 'x86_64-unknown-linux-musl', 'release', 'proxyhub-agent')
      ].filter(Boolean)
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length })
      return res.end(buf)
    } catch { /* try next */ }
  }
  res.writeHead(503, { 'Content-Type': 'text/plain' })
  return res.end('agent binary not built on this control plane; falling back to Node.js agent\n')
}

// Create a node entry for an auto-claimed agent, or refresh an existing one
// with the same public IP (idempotent reinstall). Returns the node or { error }.
async function autoCreateOrRefreshClaimedNode({ hostname, publicIp, publicIp6, family, ownerId = null }) {
  const ipv4 = publicIp && net.isIP(publicIp) === 4 ? publicIp : null
  const ipv6 = publicIp6 && net.isIP(publicIp6) === 6 ? publicIp6 : null
  if (!ipv4 && !ipv6) return { error: 'agent did not report a usable public IPv4 or IPv6' }
  // Family MUST be explicitly declared at install time — no "dual" allowed.
  // Operators put a v4 server into the v4 pool and a v6 server into the v6
  // pool. A server that could serve both still picks one (the install script
  // exposes FAMILY=ipv4 or FAMILY=ipv6 to the operator).
  const fam = String(family || '').toLowerCase()
  if (fam !== 'ipv4' && fam !== 'ipv6') {
    return { error: 'family must be "ipv4" or "ipv6" — re-run installer with FAMILY=ipv4 or FAMILY=ipv6' }
  }
  if (fam === 'ipv4' && !ipv4) return { error: 'declared family=ipv4 but agent has no public IPv4 address' }
  if (fam === 'ipv6' && !ipv6) return { error: 'declared family=ipv6 but agent has no public IPv6 address' }
  // The node's `host` is the CUSTOMER-FACING endpoint — the address the
  // client connects to. ALWAYS prefer IPv4 so v4-only clients work, even
  // when family=ipv6 (egress only). If the node has no IPv4 (rare v6-only
  // mode) we fall back to the v6 — those customers must connect over v6.
  const host = ipv4 || ipv6
  // Hub placeholder adoption: when a customer just bought a hub, the buy flow
  // creates a `tag=hub, status=provisioning` node with hub.ipv4 = the VPS's
  // assigned IPv4. The agent install (run via SSH bootstrap) then claims
  // back — we adopt that placeholder instead of creating a duplicate node.
  if (ipv4 && ownerId) {
    const hubPlaceholder = config.nodes.find((n) =>
      n.tag === 'hub' && n.ownerId === ownerId &&
      n.hub?.ipv4 === ipv4 && (n.status === 'provisioning' || !n.agentToken)
    )
    if (hubPlaceholder) {
      hubPlaceholder.agentToken = crypto.randomBytes(24).toString('hex')
      hubPlaceholder.status = 'enrolled'
      hubPlaceholder.family = fam
      hubPlaceholder.host = host
      hubPlaceholder.lastSeenAt = new Date().toISOString()
      hubPlaceholder.autoIp6 = ipv6 || hubPlaceholder.autoIp6 || null
      hubPlaceholder.claimMethod = 'hub'
      if (hubPlaceholder.hub) hubPlaceholder.hub.state = 'online'
      await saveConfig()
      return hubPlaceholder
    }
  }
  // Idempotency: same machine re-running install reuses the existing node.
  const existing = config.nodes.find((n) => (ipv4 && n.host === ipv4) || (ipv6 && n.host === ipv6))
  if (existing) {
    // Reject ownership takeover: if existing node belongs to someone else,
    // refuse the claim. Operator must delete first. Prevents customer A from
    // hijacking customer B's node (or admin's pool node) by replaying token.
    if (existing.ownerId && ownerId && existing.ownerId !== ownerId) {
      return { error: 'this IP is already claimed by another account; delete the existing node first' }
    }
    if (!existing.ownerId && ownerId) {
      return { error: 'this IP is already enrolled in the admin pool; admin must release it first' }
    }
    existing.agentToken = crypto.randomBytes(24).toString('hex')
    existing.status = 'enrolled'
    existing.family = fam
    existing.lastSeenAt = new Date().toISOString()
    if (ipv6 && !existing.autoIp6) existing.autoIp6 = ipv6
    if (ownerId && !existing.ownerId) existing.ownerId = ownerId
    await saveConfig()
    return existing
  }
  const safeBase = `auto-${String(hostname || 'host').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24).toLowerCase() || 'host'}`
  let name = safeBase, i = 2
  while (config.nodes.find((n) => n.name === name)) name = `${safeBase}-${i++}`
  const node = {
    id: `node-${crypto.randomBytes(4).toString('hex')}`,
    name,
    host,
    family: fam,
    region: '',
    zone: '',
    tag: ownerId ? 'byon' : 'fleet',
    ownerId: ownerId || null,            // null = system-owned (admin pool, paid)
                                          // user-id = customer-owned (private, free)
    sshUser: '',
    sshPort: 22,
    sshSecret: null,
    sshKeySecret: null,
    status: 'enrolled',
    agentToken: crypto.randomBytes(24).toString('hex'),
    enrollToken: null,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    claimMethod: 'fleet',
    autoIp6: ipv6 || null
  }
  config.nodes.push(node)
  await saveConfig()
  return node
}

// ── Install scripts for the claim flow ───────────────────────────────────
// Same shape as the per-node installers but: detect public IP locally, then
// POST /api/agent/claim, and write the returned credentials into the config
// file directly (no /api/agent/enroll round trip on first boot).

// Idempotent uninstall script — removes the agent service, binary, config,
// sysctl tweaks, and limits.conf entries. The mTLS client cert + token are
// inside /etc/proxybox-agent.json, deleted with it. On a clean machine this
// just prints "already removed" and exits 0.
function agentUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "[uninstall] run as root"; exit 1; }
echo "[uninstall] ProxyBox agent — removing service + files"

for UNIT in proxybox-agent proxyhub-agent; do
  if systemctl list-unit-files | grep -q "^\${UNIT}\\.service"; then
    systemctl stop "$UNIT" 2>/dev/null || true
    systemctl disable "$UNIT" 2>/dev/null || true
    rm -f /etc/systemd/system/\${UNIT}.service
    echo "[uninstall] systemd unit \${UNIT} removed"
  fi
done
systemctl daemon-reload

# Kill any lingering process (covers both legacy proxyhub-agent and proxybox-agent installs)
pkill -f /opt/proxybox-agent/ 2>/dev/null || true
pkill -f /opt/proxyhub-agent/ 2>/dev/null || true

rm -rf /opt/proxybox-agent /opt/proxyhub-agent
rm -f  /etc/proxybox-agent.json /etc/proxyhub-agent.json
rm -f  /etc/proxybox-agent.cert.pem /etc/proxybox-agent.key.pem
rm -f  /etc/proxyhub-agent.cert.pem /etc/proxyhub-agent.key.pem
rm -f  /etc/sysctl.d/99-proxybox-agent.conf /etc/sysctl.d/99-proxyhub-agent.conf
rm -f  /etc/security/limits.d/proxybox-agent.conf /etc/security/limits.d/proxyhub-agent.conf
sysctl --system >/dev/null 2>&1 || true

# Remove any IPv6 addresses we may have added (script-side adds are best-effort).
# These were assigned by the agent's own \`detect_network\` flow; agent doesn't
# track them so we leave the kernel state alone — operator can ip -6 addr del
# manually if needed. This keeps uninstall safe for shared interfaces.

echo "[uninstall] done — node directory + config + service all gone"
echo "[uninstall] NOTE: control plane still has this node's entry; remove via"
echo "          /admin/nodes UI or  DELETE /api/nodes/<id>  if you want it gone."
`
}

function agentClaimInstallScript(token, base, presetFamily) {
  const presetLine = presetFamily === 'ipv4' || presetFamily === 'ipv6'
    ? `FAMILY="${presetFamily}"   # preset by /api/agent/claim-${presetFamily === 'ipv4' ? 'v4' : 'v6'}/<token>\n`
    : ''
  return `#!/usr/bin/env bash
set -euo pipefail
# ProxyBox fleet installer — zero-touch claim
CONTROL="${base}"
TOKEN="${token}"
${presetLine}APP_DIR=/opt/proxybox-agent
BIN="$APP_DIR/proxybox-agent"
CONF=/etc/proxybox-agent.json
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

# FAMILY is REQUIRED — operator must declare v4 or v6 node up front.
# Resolution order (first non-empty wins):
#   1. Positional arg after \`bash -s\`   →   ... | sudo bash -s ipv6
#   2. \`v4\` / \`v6\` shortcut             →   ... | sudo bash -s v6
#   3. FAMILY env var                      →   ... | sudo FAMILY=ipv6 bash
#   4. The presetLine above (claim-v4 / claim-v6 URL embeds it).
ARG_FAMILY="\${1:-}"
case "$ARG_FAMILY" in
  ipv4|v4|IPV4|V4|4) FAMILY="ipv4" ;;
  ipv6|v6|IPV6|V6|6) FAMILY="ipv6" ;;
esac
FAMILY="\${FAMILY:-}"
if [ "$FAMILY" != "ipv4" ] && [ "$FAMILY" != "ipv6" ]; then
  echo "[install] family required (v4 or v6). Use one of:"
  echo "  curl -fsSL $CONTROL/api/agent/claim/$TOKEN | sudo bash -s v4"
  echo "  curl -fsSL $CONTROL/api/agent/claim/$TOKEN | sudo bash -s v6"
  echo "  (alt: claim-v4/claim-v6 URL variants, or FAMILY=ipv6 env var)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl jq >/dev/null

HOST=$(hostname -s 2>/dev/null || hostname || echo host)
IPV4=$(curl -fsSL --max-time 6 -4 https://api64.ipify.org 2>/dev/null || echo "")
IPV6=$(curl -fsSL --max-time 6 -6 https://api64.ipify.org 2>/dev/null || echo "")
if [ "$FAMILY" = "ipv4" ] && [ -z "$IPV4" ]; then echo "[install] FAMILY=ipv4 but no public IPv4 detected"; exit 1; fi
if [ "$FAMILY" = "ipv6" ] && [ -z "$IPV6" ]; then echo "[install] FAMILY=ipv6 but no public IPv6 detected"; exit 1; fi

# IPv6 prefix auto-detection. Cloud providers usually pin /128 on the
# interface even when /64 is routed; default to /64 unless operator declared
# wider via PROXYHUB_IPV6_PREFIX_LEN (32-64 valid range). The agent uses this
# at startup to synthesize rotation pool from the routed range.
PROXYHUB_IPV6_PREFIX_LEN="\${PROXYHUB_IPV6_PREFIX_LEN:-64}"
case "$PROXYHUB_IPV6_PREFIX_LEN" in
  32|40|44|48|52|56|60|64) ;;
  *) echo "[install] invalid PROXYHUB_IPV6_PREFIX_LEN=$PROXYHUB_IPV6_PREFIX_LEN (must be 32..64), defaulting to 64"; PROXYHUB_IPV6_PREFIX_LEN=64 ;;
esac
if [ "$FAMILY" = "ipv6" ] && [ -n "$IPV6" ]; then
  HAS_DEF_V6=$(ip -6 route show default 2>/dev/null | head -1)
  if [ -n "$HAS_DEF_V6" ]; then
    echo "[install] IPv6 routed prefix assumed: /$PROXYHUB_IPV6_PREFIX_LEN (override: PROXYHUB_IPV6_PREFIX_LEN=48 for wider)"
  fi
fi

echo "[install] claiming node host=$HOST family=$FAMILY ipv4=$IPV4 ipv6=$IPV6 v6prefix=/$PROXYHUB_IPV6_PREFIX_LEN"
PAYLOAD=$(printf '{"token":"%s","hostname":"%s","publicIp":"%s","publicIp6":"%s","family":"%s"}' "$TOKEN" "$HOST" "$IPV4" "$IPV6" "$FAMILY")
CLAIM=$(curl -fsSL --max-time 20 -H 'Content-Type: application/json' -X POST -d "$PAYLOAD" "$CONTROL/api/agent/claim")
[ -n "$CLAIM" ] || { echo "[install] empty claim response"; exit 1; }
NODE_ID=$(echo "$CLAIM" | jq -r .nodeId)
[ "$NODE_ID" != "null" ] && [ -n "$NODE_ID" ] || { echo "[install] claim failed: $CLAIM"; exit 1; }

install -d -m 0755 "$APP_DIR"
RUST_OK=0
if curl -fsSL --max-time 60 "$CONTROL/api/agent/claim-binary/$TOKEN" -o "$BIN.new" && [ -s "$BIN.new" ]; then
  chmod +x "$BIN.new"; mv -f "$BIN.new" "$BIN"; RUST_OK=1
  echo "[install] using Rust agent"
else
  rm -f "$BIN.new"
  echo "[install] Rust binary unavailable, falling back to Node.js agent"
  if ! command -v node >/dev/null 2>&1; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq; apt-get install -y -qq nodejs >/dev/null
  fi
  curl -fsSL "$CONTROL/api/agent/claim-code/$TOKEN" -o "$APP_DIR/agent.js"
fi

# Write the claim response straight into the agent config (token, certs, etc.)
umask 077
echo "$CLAIM" > "$CONF"
chmod 600 "$CONF"

cat > /etc/sysctl.d/99-proxybox-agent.conf <<SYS
# Connection backlog
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
net.core.netdev_max_backlog = 65535
# Source port range (full ephemeral range)
net.ipv4.ip_local_port_range = 1024 65535
# Non-local bind (cho IPv6 rotation từ /48 prefix)
net.ipv4.ip_nonlocal_bind = 1
net.ipv6.ip_nonlocal_bind = 1
# Fair queueing + BBR — best for long-haul proxy traffic
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
# Socket buffer ceilings (16MB) — without these, agent's setsockopt SO_RCVBUF=4MB
# is silently clamped to ~200KB, capping throughput to ~10 Mbps per connection.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
# Per-connection auto-tune ranges (min, default, max)
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
# Faster cleanup + reuse for high-conn proxy workloads
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_slow_start_after_idle = 0
# File descriptors
fs.file-max = 10000000
SYS
sysctl --system >/dev/null 2>&1 || true
modprobe tcp_bbr 2>/dev/null || true
printf 'root soft nofile 1048576\\nroot hard nofile 1048576\\n' > /etc/security/limits.d/proxybox-agent.conf

if [ "$RUST_OK" = "1" ]; then
  EXEC_LINE="ExecStart=$BIN"
else
  EXEC_LINE="ExecStart=/usr/bin/node $APP_DIR/agent.js"
fi
cat > /etc/systemd/system/proxybox-agent.service <<UNIT
[Unit]
Description=ProxyBox agent (fleet-claimed)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=PROXYHUB_AGENT_CONFIG=$CONF
Environment=UV_THREADPOOL_SIZE=64
Environment=PROXYHUB_IPV6_PREFIX_LEN=$PROXYHUB_IPV6_PREFIX_LEN
$EXEC_LINE
Restart=always
RestartSec=3
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now proxybox-agent
sleep 2
if systemctl is-active --quiet proxybox-agent; then
  echo "ProxyBox agent running. Auto-registered as node $NODE_ID."
else
  echo "agent failed to start:"; journalctl -u proxybox-agent --no-pager -n 25; exit 1
fi
`
}


function winAgentClaimInstallScript(token, base) {
  return `# ProxyBox fleet installer (Windows) — zero-touch claim
$ErrorActionPreference = 'Stop'
$Control = '${base}'
$Token = '${token}'
$AppDir = 'C:\\ProxyBoxAgent'
$Conf = "$AppDir\\agent.json"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')) {
  Write-Error 'Run as Administrator'; exit 1
}
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$Hostname = $env:COMPUTERNAME
$Ipv4 = (Invoke-RestMethod -Uri 'https://api64.ipify.org' -TimeoutSec 6 -UseBasicParsing -ErrorAction SilentlyContinue) 2>$null
$Ipv6 = ''
try { $Ipv6 = (Invoke-RestMethod -Uri 'https://api6.ipify.org' -TimeoutSec 6 -UseBasicParsing) } catch { $Ipv6 = '' }
if (-not $Ipv4 -and -not $Ipv6) { Write-Error 'No public IP detected'; exit 1 }

# IPv6 prefix length detection (cloud providers usually pin /128 on the
# interface, route /64 via default). Override via env PROXYHUB_IPV6_PREFIX_LEN.
$Ipv6PrefixLen = $env:PROXYHUB_IPV6_PREFIX_LEN
if (-not $Ipv6PrefixLen) { $Ipv6PrefixLen = '64' }
if ($Ipv6PrefixLen -notmatch '^(32|40|44|48|52|56|60|64)$') { $Ipv6PrefixLen = '64' }
if ($Ipv6) { Write-Host "[install] IPv6 routed prefix assumed: /$Ipv6PrefixLen" }

$Payload = @{ token = $Token; hostname = $Hostname; publicIp = "$Ipv4"; publicIp6 = "$Ipv6" } | ConvertTo-Json -Compress
$Claim = Invoke-RestMethod -Method Post -Uri "$Control/api/agent/claim" -Body $Payload -ContentType 'application/json' -TimeoutSec 20
if (-not $Claim.nodeId) { Write-Error "claim failed: $Claim"; exit 1 }
$NodeId = $Claim.nodeId
$ClaimJson = $Claim | ConvertTo-Json -Depth 8
Set-Content -Path $Conf -Value $ClaimJson -Encoding utf8
$Exe = "$AppDir\\proxybox-agent.exe"
$UsedExe = $false
try {
  Invoke-WebRequest -Uri "$Control/api/agent/claim-binary-win/$Token" -OutFile $Exe -UseBasicParsing -TimeoutSec 60
  if ((Get-Item $Exe).Length -gt 1024) { $UsedExe = $true }
} catch { Write-Host "Rust agent unavailable, using Node.js fallback" }
if (-not $UsedExe) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not installed. Install from https://nodejs.org and re-run."; exit 1
  }
  Invoke-WebRequest -Uri "$Control/api/agent/claim-code/$Token" -OutFile "$AppDir\\agent.js" -UseBasicParsing
}
# Register as Windows service via sc.exe (uses NSSM if present, else schtasks).
$ServiceName = 'ProxyBoxAgent'
sc.exe delete $ServiceName 2>$null | Out-Null
if (Get-Command nssm.exe -ErrorAction SilentlyContinue) {
  if ($UsedExe) { nssm.exe install $ServiceName $Exe }
  else { nssm.exe install $ServiceName (Get-Command node).Source "$AppDir\\agent.js" }
  nssm.exe set $ServiceName AppEnvironmentExtra "PROXYHUB_AGENT_CONFIG=$Conf" "PROXYHUB_IPV6_PREFIX_LEN=$Ipv6PrefixLen"
  nssm.exe set $ServiceName Start SERVICE_AUTO_START
  Start-Service $ServiceName
} else {
  # Fallback: scheduled task that runs at boot
  $Action = if ($UsedExe) { New-ScheduledTaskAction -Execute $Exe } else { New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument "$AppDir\\agent.js" }
  $Trigger = New-ScheduledTaskTrigger -AtStartup
  $Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
  $Settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $ServiceName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
  Start-ScheduledTask -TaskName $ServiceName
}
Write-Host "ProxyBox agent installed. Auto-registered as node $NodeId."
`
}

// Bash upgrade script — keeps existing config + systemd unit, only swaps the
// binary (and falls back to refreshing agent.js if the node uses the Node
// fallback). Idempotent: if the unit doesn't exist, it bails with a clear msg.
function agentUpgradeScript(node, base) {
  return `#!/usr/bin/env bash
set -euo pipefail
# ProxyBox agent upgrade — node "${node.name}" (${node.id})
# Replaces the binary in-place and restarts systemd. Config + PKI untouched.
CONTROL="${base}"
TOKEN="${node.upgradeToken}"
APP_DIR=/opt/proxybox-agent
BIN="$APP_DIR/proxybox-agent"
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
[ -f /etc/systemd/system/proxybox-agent.service ] || { echo "proxybox-agent.service not installed; run the installer first"; exit 1; }
install -d -m 0755 "$APP_DIR"

# Prefer the Rust binary; fall back to Node fallback if the binary isn't built.
if curl -fsSL --max-time 90 "$CONTROL/api/agent/binary-upgrade/$TOKEN" -o "$BIN.new" && [ -s "$BIN.new" ]; then
  chmod +x "$BIN.new"
  systemctl stop proxybox-agent || true
  mv -f "$BIN.new" "$BIN"
  systemctl start proxybox-agent
  echo "[upgrade] Rust agent updated → $(/$BIN --version 2>/dev/null || echo 'restarted')"
else
  rm -f "$BIN.new"
  echo "[upgrade] Rust binary unavailable, refreshing Node fallback agent.js"
  curl -fsSL "$CONTROL/api/agent/code-upgrade/$TOKEN" -o "$APP_DIR/agent.js.new"
  [ -s "$APP_DIR/agent.js.new" ] || { rm -f "$APP_DIR/agent.js.new"; echo "[upgrade] code-upgrade fetch failed"; exit 1; }
  systemctl stop proxybox-agent || true
  mv -f "$APP_DIR/agent.js.new" "$APP_DIR/agent.js"
  systemctl start proxybox-agent
  echo "[upgrade] Node fallback agent.js refreshed → service restarted"
fi

systemctl is-active --quiet proxybox-agent && echo "[upgrade] proxybox-agent active" || { echo "[upgrade] service failed to start — journalctl -u proxybox-agent -n 50"; exit 1; }
`
}

function agentInstallScript(node, base) {
  return `#!/usr/bin/env bash
set -euo pipefail
# ProxyBox agent installer â€” node "${node.name}" (${node.id})
# Tries the Rust binary first; falls back to the Node.js agent if the binary is
# not yet built on the control plane. Everything lives in predictable paths so
# admin can: journalctl -u proxybox-agent -f
CONTROL="${base}"
ENROLL="${node.enrollToken}"
APP_DIR=/opt/proxybox-agent
BIN="$APP_DIR/proxybox-agent"
CONF=/etc/proxybox-agent.json
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl >/dev/null

install -d -m 0755 "$APP_DIR"
RUST_OK=0
if curl -fsSL --max-time 60 "$CONTROL/api/agent/binary/$ENROLL" -o "$BIN.new" && [ -s "$BIN.new" ]; then
  chmod +x "$BIN.new"; mv -f "$BIN.new" "$BIN"; RUST_OK=1
  echo "[install] using Rust agent"
else
  rm -f "$BIN.new"
  echo "[install] Rust binary unavailable, falling back to Node.js agent"
  if ! command -v node >/dev/null 2>&1; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq; apt-get install -y -qq nodejs >/dev/null
  fi
  curl -fsSL "$CONTROL/api/agent/code/$ENROLL" -o "$APP_DIR/agent.js"
fi
printf '{ "controlUrl": "%s", "enrollToken": "%s" }\\n' "$CONTROL" "$ENROLL" > "$CONF"
chmod 600 "$CONF"

cat > /etc/sysctl.d/99-proxybox-agent.conf <<SYS
# Connection backlog
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
net.core.netdev_max_backlog = 65535
# Source port range (full ephemeral range)
net.ipv4.ip_local_port_range = 1024 65535
# Non-local bind (cho IPv6 rotation từ /48 prefix)
net.ipv4.ip_nonlocal_bind = 1
net.ipv6.ip_nonlocal_bind = 1
# Fair queueing + BBR — best for long-haul proxy traffic
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
# Socket buffer ceilings (16MB) — without these, agent's setsockopt SO_RCVBUF=4MB
# is silently clamped to ~200KB, capping throughput to ~10 Mbps per connection.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
# Per-connection auto-tune ranges (min, default, max)
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
# Faster cleanup + reuse for high-conn proxy workloads
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_slow_start_after_idle = 0
# File descriptors
fs.file-max = 10000000
SYS
sysctl --system >/dev/null 2>&1 || true
modprobe tcp_bbr 2>/dev/null || true
printf 'root soft nofile 1048576\\nroot hard nofile 1048576\\n' > /etc/security/limits.d/proxybox-agent.conf

if [ "$RUST_OK" = "1" ]; then
  EXEC_LINE="ExecStart=$BIN"
else
  EXEC_LINE="ExecStartPre=-/usr/bin/curl -fsSL $CONTROL/api/agent/code/$ENROLL -o $APP_DIR/agent.js
ExecStart=/usr/bin/node $APP_DIR/agent.js"
fi
cat > /etc/systemd/system/proxybox-agent.service <<UNIT
[Unit]
Description=ProxyBox agent (node ${node.id})
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=PROXYHUB_AGENT_CONFIG=$CONF
Environment=UV_THREADPOOL_SIZE=64
Environment=PROXYHUB_IPV6_PREFIX_LEN=$PROXYHUB_IPV6_PREFIX_LEN
$EXEC_LINE
Restart=always
RestartSec=3
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now proxybox-agent
sleep 2
if systemctl is-active --quiet proxybox-agent; then echo "ProxyBox agent running (node ${node.id})."; else echo "agent failed to start:"; journalctl -u proxybox-agent --no-pager -n 25; exit 1; fi
`
}

function sendMetrics(res) {
  const lines = [
    '# TYPE proxyhub_uptime_seconds gauge',
    `proxyhub_uptime_seconds ${Math.round(process.uptime())}`,
    '# TYPE proxyhub_proxies_total gauge',
    `proxyhub_proxies_total ${config.proxies.length}`,
    '# TYPE proxyhub_listeners_active gauge',
    `proxyhub_listeners_active ${listeners.size}`,
    '# TYPE proxyhub_dns_cache_entries gauge',
    `proxyhub_dns_cache_entries ${dnsCache.size}`,
    '# TYPE proxyhub_proxy_upload_bytes counter',
    '# TYPE proxyhub_proxy_download_bytes counter',
    '# TYPE proxyhub_proxy_month_bytes gauge',
    '# TYPE proxyhub_proxy_total_connections counter',
    '# TYPE proxyhub_proxy_active_connections gauge',
    '# TYPE proxyhub_proxy_bps_in gauge',
    '# TYPE proxyhub_proxy_bps_out gauge'
  ]
  const monthKey = new Date().toISOString().slice(0, 7)
  for (const proxy of config.proxies) {
    const s = ensureStats(proxy.id)
    const lbl = `{id="${proxy.id}",type="${(proxy.type || 'ipv4').toLowerCase()}"}`
    lines.push(`proxyhub_proxy_upload_bytes${lbl} ${s.uploadBytes}`)
    lines.push(`proxyhub_proxy_download_bytes${lbl} ${s.downloadBytes}`)
    lines.push(`proxyhub_proxy_month_bytes${lbl} ${s.monthKey === monthKey ? s.monthBytes : 0}`)
    lines.push(`proxyhub_proxy_total_connections${lbl} ${s.totalConnections}`)
    lines.push(`proxyhub_proxy_active_connections${lbl} ${s.activeConnections}`)
    lines.push(`proxyhub_proxy_bps_in${lbl} ${s.bpsIn || 0}`)
    lines.push(`proxyhub_proxy_bps_out${lbl} ${s.bpsOut || 0}`)
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
  res.end(lines.join('\n') + '\n')
}

// Sweep IPv6 proxies that opted into auto-rotate. Each proxy with
// `rotateEverySec > 0` gets its bindIp rotated once that many seconds have
// elapsed since `rotateLastAt`. Pool is pre-computed once per node per sweep
// so large batches (1000+ proxies on one node) don't O(n²) the event loop.
function sweepAutoRotate() {
  const now = Date.now()
  let changed = false
  // Build per-node "currently bound" set ONCE per sweep so each rotation
  // sees its peers' fresh IPs without an O(N²) scan. We update the set
  // in-place as proxies rotate this sweep — guarantees no two proxies
  // in the same sweep collide on the new IP either.
  const usedByNode = new Map()
  for (const p of config.proxies) {
    if (!p.bindIp) continue
    const nid = p.nodeId || 'local'
    if (!usedByNode.has(nid)) usedByNode.set(nid, new Set())
    usedByNode.get(nid).add(p.bindIp)
  }
  // Cache node lookup + the synthesized "local" node for mint helpers.
  const nodeCache = new Map()
  function nodeFor(nodeId) {
    if (nodeCache.has(nodeId)) return nodeCache.get(nodeId)
    let node
    if (!nodeId || nodeId === 'local') {
      node = { network: { ipv6: detected.ipv6Prefixes.map((p) => ({ address: p.prefix, cidr: `${p.prefix}/${p.prefixLength}` })) } }
    } else {
      node = config.nodes.find((n) => n.id === nodeId) || null
    }
    nodeCache.set(nodeId, node)
    return node
  }
  for (const proxy of config.proxies) {
    if (!proxy.rotateEverySec || proxy.type !== 'IPv6') continue
    if (proxy.status === 'expired') continue
    const last = Number(proxy.rotateLastAt || 0)
    if (now - last < proxy.rotateEverySec * 1000) continue
    try {
      const nid = proxy.nodeId || 'local'
      const node = nodeFor(nid)
      if (!node) { proxy.rotateLastAt = now; continue }
      const used = usedByNode.get(nid) || new Set()
      // Mint a brand-new /128 from the prefix; crypto.randomBytes entropy
      // makes it statistically impossible to repeat a previously-assigned
      // IP across the /48 (2^80 host bits).
      const next = mintFreshIpv6(node, used)
      if (next && next !== proxy.bindIp) {
        used.delete(proxy.bindIp)
        used.add(next)
        usedByNode.set(nid, used)
        proxy.bindIp = next
        changed = true
        dispatchWebhook(proxy.ownerId, 'proxy.ipRotated', { proxyId: proxy.id, bindIp: next })
      }
      proxy.rotateLastAt = now
    } catch { /* ignore — next tick will try again */ }
  }
  if (changed) saveConfig().catch(() => {})
}

// Convenience wrapper so sweepExpired's existing auto-renew loop can keep its
// behaviour. Customers set `autoRenew` + optional `renewHours` + optional
// `autoRenewBudget` (max VND per renewal — 0 = no cap).
function sweepAutoRenew() {
  // The actual renewal is performed by sweepExpired (runs every 5min). This
  // 10-min cron is reserved for future per-group accounting / notification
  // batching; intentionally a no-op for now to avoid double-renewal races.
}

// ── Webhook dispatch ─────────────────────────────────────────────────────
// Fires when a customer-relevant event happens (proxy.expired, .checkFailed,
// .ipRotated, .expiringSoon). User config: user.webhookUrl + user.webhookEvents.
function dispatchWebhook(userId, event, payload) {
  if (!userId) return
  const user = config.users.find((u) => u.id === userId)
  if (!user || !user.webhookUrl) return
  const events = Array.isArray(user.webhookEvents) && user.webhookEvents.length ? user.webhookEvents : null
  if (events && !events.includes(event)) return
  const body = JSON.stringify({ event, ts: new Date().toISOString(), user: user.email, ...payload })
  try {
    const u = new URL(user.webhookUrl)
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ProxyBox-Webhook/1.0' },
      timeout: 5_000
    }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(opts, (res) => { res.resume() })
    req.on('error', () => { /* fire-and-forget */ })
    req.on('timeout', () => { try { req.destroy() } catch { /* noop */ } })
    req.write(body)
    req.end()
  } catch { /* bad URL or unreachable — silent */ }
}

// Notify a proxy's owner ONCE per expiry window (throttled via expiryNotifiedFor):
// either "renew soon", or — for auto-renew proxies the wallet can't cover — a
// low-balance warning. Returns true if it sent something (so caller persists).
function notifyProxyExpiry(proxy) {
  if (!proxy.ownerId || proxy.expiryNotifiedFor === proxy.expiresAt) return false
  const user = config.users.find((u) => u.id === proxy.ownerId)
  if (!user) return false
  if (proxy.autoRenew) {
    const pricing = config.pricing || defaultPricing()
    const perHour = (String(proxy.type).toLowerCase() === 'ipv6' ? pricing.ipv6 : pricing.ipv4)?.perHour || 0
    const cost = perHour * Number(proxy.renewHours || 24)
    const grp = String(proxy.type).toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4'
    const need = cost - previewScopedCredit(proxy.ownerId, grp, cost).applied
    if (userBalance(proxy.ownerId) >= need) return false   // renews fine — no nag
    proxy.expiryNotifiedFor = proxy.expiresAt
    pushNotification(proxy.ownerId, { type: 'billing', severity: 'warn', text: `Số dư không đủ để tự gia hạn proxy ${proxy.id} (cần ${need.toLocaleString()}). Nạp thêm để tránh gián đoạn.`, link: '/billing' })
    sendMail({ to: user.email, subject: 'ProxyBox: số dư thấp — proxy sắp không gia hạn được', html: `<p>Proxy <code>${proxy.id}</code> đến hạn tự gia hạn nhưng số dư ví không đủ (cần <strong>${need.toLocaleString()}</strong>). <a href="/billing">Nạp thêm</a> để tránh gián đoạn.</p>` }).catch(() => {})
  } else {
    proxy.expiryNotifiedFor = proxy.expiresAt
    pushNotification(proxy.ownerId, { type: 'proxy', severity: 'warn', text: `Proxy ${proxy.id} sắp hết hạn (dưới 6h). Gia hạn để không mất proxy.`, link: '/proxies' })
    sendMail({ to: user.email, subject: 'ProxyBox: proxy sắp hết hạn', html: `<p>Proxy <code>${proxy.id}</code> sẽ hết hạn lúc <strong>${proxy.expiresAt}</strong>. <a href="/proxies">Gia hạn ngay</a> để giữ proxy.</p>` }).catch(() => {})
  }
  return true
}

function sweepExpired() {
  // Hourly precision: compare expiresAt (ISO datetime) when set, fall back to
  // expires (YYYY-MM-DD) for legacy proxies created before hourly migration.
  const now = Date.now()
  const SOON_MS = 6 * 3600_000 // 6h warning band
  let changed = false
  let expiredCount = 0
  let expiringSoon = 0
  let renewed = 0
  const pricing = config.pricing || defaultPricing()
  migratePricingToHourly()
  // Pass 1: auto-renew
  for (const proxy of config.proxies) {
    if (!proxy.autoRenew || !proxy.ownerId) continue
    if (proxy.status === 'expired') continue
    const expMs = proxy.expiresAt ? new Date(proxy.expiresAt).getTime() : (proxy.expires ? new Date(proxy.expires + 'T23:59:59Z').getTime() : 0)
    if (!expMs || expMs > now + SOON_MS) continue
    const perHour = (String(proxy.type).toLowerCase() === 'ipv6' ? pricing.ipv6 : pricing.ipv4)?.perHour || 0
    if (perHour <= 0) continue
    const renewHours = Number(proxy.renewHours || 24) // default = renew 24h
    const cost = perHour * renewHours
    // Spend matching scoped free-credit first; wallet covers the remainder.
    const rgrp = String(proxy.type).toLowerCase() === 'ipv6' ? 'ipv6' : 'ipv4'
    const rc = previewScopedCredit(proxy.ownerId, rgrp, cost)
    const walletCost = cost - rc.applied
    const balance = userBalance(proxy.ownerId)
    if (balance >= walletCost) {
      const t = addHours(renewHours)
      proxy.expires = t.expires
      proxy.expiresAt = t.expiresAt
      proxy.status = 'active'
      commitScopedCredit(rc.plan)
      if (walletCost > 0) recordBillingTx(proxy.ownerId, 'renewal', walletCost, `auto-renew ${proxy.id} +${renewHours}h${rc.applied ? ` credit=-${rc.applied}` : ''}`)
      renewed += 1
      changed = true
    }
  }
  // Pass 2: enter grace, then truly expire. Industry-standard grace = 1h so
  // customer can renew without losing the IP. During grace the listener is still
  // open and auth still passes; we only emit a warning + alert.
  const GRACE_MS = 60 * 60_000
  for (const proxy of config.proxies) {
    const expMs = proxy.expiresAt ? new Date(proxy.expiresAt).getTime() : (proxy.expires ? new Date(proxy.expires + 'T23:59:59Z').getTime() : 0)
    if (!expMs) continue
    if (expMs < now - GRACE_MS && proxy.status !== 'expired') {
      proxy.status = 'expired'
      changed = true
      expiredCount += 1
      if ((proxy.nodeId || 'local') === 'local') stopProxy(proxy.id)
      dispatchWebhook(proxy.ownerId, 'proxy.expired', { proxyId: proxy.id, bindIp: proxy.bindIp, port: proxy.port })
    } else if (expMs < now && proxy.status !== 'expired' && proxy.status !== 'grace') {
      proxy.status = 'grace'
      changed = true
      expiringSoon += 1
      pushAlert(`proxy:${proxy.id}:grace`, `Proxy ${proxy.id} entered grace period (1h to renew)`, 'warn')
      dispatchWebhook(proxy.ownerId, 'proxy.expiringSoon', { proxyId: proxy.id, expiresAt: proxy.expiresAt })
      notifyProxyExpiry(proxy)
    } else if (expMs <= now + SOON_MS && proxy.status !== 'expired' && proxy.status !== 'grace') {
      expiringSoon += 1
      if (notifyProxyExpiry(proxy)) changed = true
    }
  }
  if (renewed > 0) pushAlert('proxy:renewed', `${renewed} proxy auto-renewed`, 'info')
  if (expiredCount > 0) pushAlert('proxy:expired', `${expiredCount} proxy expired`, 'warn')
  if (expiringSoon > 0) pushAlert('proxy:expiring', `${expiringSoon} proxy expiring within 6h`, 'info')
  // Monthly bandwidth-quota alert: warn owner + admin once/month when a proxy's
  // month usage exceeds config.pricing.bandwidthQuotaGB (0 = unlimited).
  const quotaBytes = (Number(config.pricing?.bandwidthQuotaGB) || 0) * 1e9
  if (quotaBytes > 0) {
    const mk = new Date().toISOString().slice(0, 7)
    for (const proxy of config.proxies) {
      if (!proxy.ownerId || proxy.status === 'expired') continue
      const used = Number(stats.get(proxy.id)?.monthBytes || 0)
      if (used > quotaBytes && proxy.quotaAlertedMonth !== mk) {
        proxy.quotaAlertedMonth = mk; changed = true
        const owner = config.users.find((u) => u.id === proxy.ownerId)
        pushNotification(proxy.ownerId, { type: 'proxy', severity: 'warn', text: `Proxy ${proxy.id} đã vượt quota ${config.pricing.bandwidthQuotaGB}GB tháng này (${(used / 1e9).toFixed(1)}GB).`, link: '/usage' })
        pushAlert(`proxy:${proxy.id}:quota`, `Proxy ${proxy.id} over ${config.pricing.bandwidthQuotaGB}GB quota (${(used / 1e9).toFixed(1)}GB)`, 'warn')
        if (owner) sendMail({ to: owner.email, subject: 'ProxyBox: proxy vượt quota băng thông', html: `<p>Proxy <code>${proxy.id}</code> đã dùng <strong>${(used / 1e9).toFixed(1)}GB</strong>, vượt quota ${config.pricing.bandwidthQuotaGB}GB tháng này.</p>` }).catch(() => {})
      }
    }
  }
  // Reap credit grants that are spent (remaining 0), expired, or owned by a
  // deleted user, so config.creditGrants doesn't grow unbounded.
  if (Array.isArray(config.creditGrants) && config.creditGrants.length) {
    const today = new Date().toISOString().slice(0, 10)
    const kept = config.creditGrants.filter((g) =>
      Number(g.remaining) > 0 && (!g.expiresAt || g.expiresAt >= today) && config.users.some((u) => u.id === g.userId))
    if (kept.length !== config.creditGrants.length) { config.creditGrants = kept; changed = true }
  }
  if (changed) saveConfig().catch((error) => console.error(`[api] saveConfig failed: ${error.message}`))
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function addDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + (Number.isFinite(days) ? days : 30))
  return date.toISOString().slice(0, 10)
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  // SECURITY: deny iframe embed + nosniff so a phishing page can't wrap our UI.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  if (status === 204) return res.end()
  return res.end(JSON.stringify(payload))
}

function setCors(req, res) {
  const origin = req.headers.origin
  const allowed = config.api.corsOrigins || []
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key,X-Customer-Key,Stripe-Signature')
  // SECURITY: HSTS + Strict baseline headers on every response, including OPTIONS.
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

async function serveStatic(req, res, url) {
  try {
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const safePath = path.normalize(requested).replace(/^(\.\.([/\\]|$))+/, '')
    let filePath = path.join(distDir, safePath)
    if (!filePath.startsWith(distDir)) filePath = path.join(distDir, 'index.html')
    try {
      const stat = await fs.stat(filePath)
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
    } catch {
      filePath = path.join(distDir, 'index.html')
    }
    const data = await fs.readFile(filePath)
    const ext = path.extname(filePath)
    const headers = { 'Content-Type': contentTypes[ext] || 'application/octet-stream' }
    if (ext === '.html' || filePath.endsWith('index.html')) {
      // SECURITY: locked-down CSP for the dashboard SPA — no inline scripts, no
      // remote scripts other than self, no third-party frames. The Vite-built
      // bundle is self-hosted under /assets/ so 'self' is enough.
      headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self' https://api.stripe.com; frame-ancestors 'none'; base-uri 'self'"
      headers['X-Frame-Options'] = 'DENY'
      headers['X-Content-Type-Options'] = 'nosniff'
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
      headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains'
      // HTML must never be cached so updated index.html (with fresh chunk hashes)
      // reaches the client on the next navigation. Otherwise stale HTML can point
      // at chunks that no longer exist → dynamic import 404 → blank SPA page.
      headers['Cache-Control'] = 'no-store, must-revalidate'
      headers['Pragma'] = 'no-cache'
    } else if (url.pathname.startsWith('/assets/')) {
      // Vite-hashed assets (chunks, css, fonts) are content-addressed — safe to
      // cache forever. `immutable` tells browsers to skip revalidation entirely.
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }
    res.writeHead(200, headers)
    res.end(data)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}

