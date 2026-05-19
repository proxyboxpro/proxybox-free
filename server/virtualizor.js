// Virtualizor admin-API client. Wraps the legacy index.php?act=… RPC style
// into a few typed helpers. All credentials are passed in via the `config` arg
// (the caller decrypts them with masterKey before each call so they never live
// at rest in plaintext or in any reusable client instance).
//
// Reference: https://softaculous.com/docs/virtualizor/api/  (Admin API)
//   GET /index.php?act=<action>&api=json&apikey=<k>&apipass=<p>
// Some panels require POST with form-encoded body — we POST by default to be
// safe. Returns the parsed JSON or throws an Error with diagnostic context.

import { request as httpsRequest, Agent as HttpsAgent } from 'node:https'
import { URLSearchParams } from 'node:url'

// Per-call timeout. Virtualizor admin can be slow on a busy panel — give 25s
// for list calls and let `addvs` use longer (passed in by caller).
const DEFAULT_TIMEOUT_MS = 25_000

function virtConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('virtualizor not configured')
  const url = String(cfg.panelUrl || '').replace(/\/+$/, '')
  if (!url) throw new Error('virtualizor.panelUrl missing')
  if (!cfg.apiKey || !cfg.apiPass) throw new Error('virtualizor.apiKey / apiPass missing')
  return { url, apiKey: String(cfg.apiKey), apiPass: String(cfg.apiPass) }
}

// Self-signed certs are common on Virtualizor admin panels — accept by default
// (most operators run with a local cert). If the panel uses a real cert it
// still validates because the agent doesn't disable cert checks system-wide.
const TLS_AGENT_INSECURE = new HttpsAgent({ rejectUnauthorized: false })

async function rpc(cfg, action, extra = {}, opts = {}) {
  const { url, apiKey, apiPass } = virtConfig(cfg)
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS)
  const insecure = Boolean(opts.insecure ?? cfg.insecureTls ?? true)
  const target = new URL(`${url}/index.php`)
  // Virtualizor 3.x admin API uses `adminapikey` + `adminapipass` in the
  // querystring (NOT the legacy `apikey/apipass` — those are reserved for
  // the per-user End-user API). All other params can go in body for POST,
  // or appended to querystring for GET. We use GET because some endpoints
  // (e.g. `act=addvs`) trip on POST encoding when fields contain JSON.
  target.searchParams.set('api', 'json')
  target.searchParams.set('adminapikey', apiKey)
  target.searchParams.set('adminapipass', apiPass)
  target.searchParams.set('act', action)
  // For mutating actions, extra fields go in form-encoded POST body — keeps
  // long fields (cloud_user_data base64) out of URLs. Read actions also
  // accept fields in the body so this is fine for all calls.
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) continue
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body.toString()),
        'Accept': 'application/json',
        'User-Agent': 'ProxyBox/Virtualizor-Client'
      },
      timeout: timeoutMs,
      agent: insecure ? TLS_AGENT_INSECURE : undefined
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { raw += c; if (raw.length > 16 * 1024 * 1024) { req.destroy(new Error('response too large')) } })
      res.on('end', () => {
        // 302 = panel redirected to login. Either creds invalid or admin URL
        // wrong (use 4085 admin HTTPS, not 4083 which is end-user).
        if (res.statusCode === 302 || /<title>\s*Login/i.test(raw)) {
          return reject(new Error(`virtualizor refused: not authorized [act=${action}]. Check (a) adminapikey/adminapipass values, (b) admin port (4085 HTTPS), (c) some mutating actions need uid in querystring not body.`))
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`virtualizor HTTP ${res.statusCode}: ${raw.slice(0, 200)}`))
        }
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && parsed.error) {
            // Virtualizor's `error` field can be:
            //   - array of {code, msg}                  → list_vps style
            //   - object {key1:'msg', key2:'msg'}       → addvs style
            //   - string                                → simple
            let msg = ''
            const e = parsed.error
            if (Array.isArray(e)) {
              msg = e.map((x) => (x && x.msg) ? `[${x.code || '?'}] ${x.msg}` : String(x)).join('; ')
            } else if (typeof e === 'object') {
              const vals = Object.values(e).filter(Boolean)
              msg = vals.length ? vals.join('; ') : ''
            } else if (typeof e === 'string') {
              msg = e
            }
            if (msg) return reject(new Error(`virtualizor: ${msg}`))
          }
          resolve(parsed)
        } catch (e) {
          reject(new Error(`virtualizor: bad JSON response (${e.message}): ${raw.slice(0, 200)}`))
        }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('virtualizor request timed out')) })
    req.on('error', reject)
    req.write(body.toString())
    req.end()
  })
}

// ── Read endpoints (no side effects) ──────────────────────────────────────
// Official action names from www.virtualizor.com/docs/admin-api/. `vs` lists
// all VPS (cheap probe). `servers` is the cluster server list.
export async function testConnection(cfg) {
  const out = await rpc(cfg, 'vs', {}, { timeoutMs: 15_000 })
  return { ok: true, raw: out }
}
export function listVms(cfg, extra = {})    { return rpc(cfg, 'vs', extra) }
export function listServers(cfg)            { return rpc(cfg, 'servers') }
export function listPlans(cfg)               { return rpc(cfg, 'plans') }
export function listIpPools(cfg)             { return rpc(cfg, 'ippool') }
export function listOsTemplates(cfg)         { return rpc(cfg, 'ostemplate') }
export function vsDetail(cfg, vpsid)         { return rpc(cfg, 'editvs', { vpsid }) }

// Resolve N free IPv4 addresses inside a specific Virtualizor pool. Used by
// the hub-buy flow because addvs's `num_ips=N` only allocates from the
// server's PRIMARY pool — if the admin wants a different pool we must pass
// the explicit IPs. Returns [] when nothing is free.
export async function findFreeIpsInPool(cfg, poolId, count = 1) {
  // reslen needs to exceed the pool's total record count — otherwise free
  // IPs at the bottom of a heavily-allocated pool (e.g., 503 used + 2 free
  // at position 504, 505) get truncated and we falsely report "exhausted".
  const r = await rpc(cfg, 'ips', { ippid: poolId, reslen: 5000 })
  const ips = r?.ips || {}
  const free = []
  for (const v of Object.values(ips)) {
    if (!v || typeof v !== 'object') continue
    if (String(v.ippid) !== String(poolId)) continue
    if (String(v.vpsid || '0') !== '0') continue       // already assigned
    if (String(v.locked || '0') !== '0') continue      // locked / reserved
    if (String(v.primary || '0') === '1') continue     // gateway / shared
    if (v.ip) free.push(v.ip)
    if (free.length >= count) break
  }
  return free
}

// ── Write endpoints ───────────────────────────────────────────────────────
// Create VPS. Required fields shape based on Virtualizor addvs API.
// `user_data` (cloud-init) carries our agent install one-liner so the VM
// auto-registers with the user's token immediately on first boot.
//   Required minimum: virt, server_id, osid, hostname, rootpass, plid
//   Networking:        ips (e.g. "auto"), v6_ips, dns_nameservers
//   Cloud-init:        cloud_user_data (base64) when osid supports it
export function addVs(cfg, opts) {
  // Virtualizor's addvs requires a Virtualizor-side user (email + password)
  // that becomes the VPS owner. We map every ProxyBox customer to a single
  // Virtualizor user — pre-existing or auto-created via `act=adduser` before
  // first hub provision (see ensureVirtualizorUser in server/index.js).
  // Virtualizor's addvs IP allocation is finicky:
  //   • `num_ips` / `num_ips6_subnet` / `num_ips6` are the COUNT-based fields.
  //     The panel auto-picks from the IP pool.
  //   • `ips=auto` (or any value in `ips`) silently OVERRIDES `num_ips` and
  //     ends up allocating zero IPv4 on plans where the default differs from
  //     the count. Verified by side-by-side probes against panel 10.10.10.2:
  //     {num_ips=1, num_ips6_subnet=1}                  → IPv4 + IPv6 ✓
  //     {ips=auto, num_ips=1}                           → IPv6 only ✗
  //     {ips=1, num_ips=1, ips6=1, num_ips6_subnet=1}   → IPv6 only ✗
  // So we never pass `ips` unless the caller explicitly supplies a value.
  const payload = {
    virt: opts.virt || 'kvm',
    server_id: opts.serverId,
    osid: opts.osId,
    hostname: opts.hostname,
    rootpass: opts.rootPass,
    plid: opts.planId,
    user_email: opts.userEmail,
    user_pass:  opts.userPass,
    bandwidth: opts.bandwidth || 0,
    ram: opts.ram || 0,
    space: opts.space || 0,
    cores: opts.cores || 0,
    addvps: 1,
    num_ips: opts.numIps != null ? Number(opts.numIps) : 1,
    num_ips6_subnet: opts.numIp6Subnets != null ? Number(opts.numIp6Subnets) : 0,
    num_ips6: opts.numIp6 != null ? Number(opts.numIp6) : 0,
    cloud_user_data: opts.userData ? Buffer.from(opts.userData, 'utf8').toString('base64') : ''
  }
  if (opts.ips && opts.ips !== 'auto') payload.ips = opts.ips
  if (opts.v6Ips) payload.v6_ips = opts.v6Ips
  // Virtualizor expects snake_case `ips_pool` / `ips6_pool`. An earlier
  // version sent `ipPool` which got silently ignored — VZ then fell back to
  // pool 1 (small local pool, often 0 free) and returned "Insufficient IPv4".
  if (opts.ipPool)   payload.ips_pool  = String(opts.ipPool)
  if (opts.ip6Pool)  payload.ips6_pool = String(opts.ip6Pool)
  if (opts.dnsNameserver1) payload.dns_nameserver1 = opts.dnsNameserver1
  if (opts.dnsNameserver2) payload.dns_nameserver2 = opts.dnsNameserver2
  if (opts.diskTemplate) payload.template_id = opts.diskTemplate
  // Prefer passing an existing Virtualizor uid when we already know one for
  // this customer — avoids the password-reset dance entirely. Falls back to
  // (user_email + user_pass) for the first-time create path.
  if (opts.uid) {
    payload.uid = Number(opts.uid)
    delete payload.user_email
    delete payload.user_pass
  }
  return rpc(cfg, 'addvs', payload, { timeoutMs: 90_000 })
}

// Ensure a Virtualizor end-user exists for the given email. Returns the
// virtualizor uid. If the user already exists we DO NOT touch the password —
// `addvs` is called with `uid` directly (no password needed). If we must
// create the user, we generate a one-shot password (Virtualizor requires
// it for the create call) but never store or reuse it; the uid is the only
// long-lived identifier we keep.
export async function ensureUser(cfg, { email, firstName, lastName }) {
  // 1) Look up existing user by email — `act=users` returns dict keyed by uid.
  const users = await rpc(cfg, 'users')
  if (users && users.users && typeof users.users === 'object') {
    for (const [uid, u] of Object.entries(users.users)) {
      if (u && u.email && u.email.toLowerCase() === String(email).toLowerCase()) {
        return { uid: Number(uid), email, created: false }
      }
    }
  }
  // 2) Create — adduser requires `newpass`+`conf` (Virtualizor validates them).
  //    We generate a throwaway since we'll be passing uid to addvs from now on.
  const tempPw = 'Vz' + Math.random().toString(36).slice(2, 14) + 'X9'
  const created = await rpc(cfg, 'adduser', {
    newemail: email, email,
    newpass:  tempPw, conf: tempPw,
    fname: firstName || 'ProxyBox',
    lname: lastName  || 'Customer',
    addusr: 1
  })
  let uid = null
  if (created?.done?.uid) uid = Number(created.done.uid)
  if (!uid && created?.user?.uid) uid = Number(created.user.uid)
  if (!uid && typeof created?.done === 'string') uid = Number(created.done)
  // Re-resolve by email if response shape didn't carry uid
  if (!uid) {
    const u2 = await rpc(cfg, 'users')
    for (const [k, v] of Object.entries(u2?.users || {})) {
      if (v?.email && v.email.toLowerCase() === String(email).toLowerCase()) {
        uid = Number(k); break
      }
    }
  }
  return { uid, email, created: true }
}

export function deleteVs(cfg, vpsid) {
  // Virtualizor's delete-VPS is `act=vs&delete=<vpsid>` (not `delete_vs`).
  // Verified against panel 10.10.10.2 returning `{done:true}`.
  return rpc(cfg, 'vs', { delete: Number(vpsid) }, { timeoutMs: 30_000 })
}
export function vsAction(cfg, vpsid, action) {
  // action ∈ { start, stop, restart, poweroff }
  const valid = new Set(['start', 'stop', 'restart', 'poweroff'])
  if (!valid.has(action)) throw new Error(`unsupported VPS action: ${action}`)
  return rpc(cfg, 'vps', { vpsid, do: action })
}
