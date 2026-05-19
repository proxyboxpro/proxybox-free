// ProxyBox agent — runs on a worker node, controlled by the control plane.
// Zero npm deps (Node 18+ builtins only). Reuses the same proxy engine logic as
// the control plane's local engine.
//
// Config (in order of precedence): /etc/proxybox-agent.json (or legacy /etc/proxyhub-agent.json) > env vars.
//   { "controlUrl": "http://CONTROL:8787", "token": "<agentToken>", "enrollToken": "<enrollToken>" }
// env: PROXYBOX_CONTROL / PROXYBOX_TOKEN / PROXYBOX_ENROLL (legacy PROXYHUB_* still accepted).

import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const AGENT_VERSION = '1.3.0'
// Default config path per OS. New default is /etc/proxybox-agent.json; we fall
// back to /etc/proxyhub-agent.json so pre-rebrand installs keep working without
// a manual migration step.
//   • Linux:   /etc/proxybox-agent.json (legacy /etc/proxyhub-agent.json)
//   • macOS:   /usr/local/etc/proxybox-agent.json (legacy /usr/local/etc/proxyhub-agent.json)
//   • Windows: %ProgramData%\ProxyBox\agent.json
function defaultConfigPath() {
  if (process.env.PROXYBOX_AGENT_CONFIG) return process.env.PROXYBOX_AGENT_CONFIG
  if (process.env.PROXYHUB_AGENT_CONFIG) return process.env.PROXYHUB_AGENT_CONFIG
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir()
    return path.join(base, 'ProxyBox', 'agent.json')
  }
  if (process.platform === 'darwin') {
    const newP = '/usr/local/etc/proxybox-agent.json'
    const legacy = '/usr/local/etc/proxyhub-agent.json'
    if (fs.existsSync(newP) || !fs.existsSync(legacy)) return newP
    return legacy
  }
  const newP = '/etc/proxybox-agent.json'
  const legacy = '/etc/proxyhub-agent.json'
  if (fs.existsSync(newP) || !fs.existsSync(legacy)) return newP
  return legacy
}
const CONFIG_PATH = defaultConfigPath()

let cfg = loadConfig()
let detected = detectNetwork()
const listeners = new Map() // proxyId -> { server, proxy }
const stats = new Map()

function loadConfig() {
  let fileCfg = {}
  try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch { /* none */ }
  return {
    controlUrl: (fileCfg.controlUrl || process.env.PROXYBOX_CONTROL || process.env.PROXYHUB_CONTROL || '').replace(/\/$/, ''),
    token: fileCfg.token || process.env.PROXYBOX_TOKEN || process.env.PROXYHUB_TOKEN || '',
    enrollToken: fileCfg.enrollToken || process.env.PROXYBOX_ENROLL || process.env.PROXYHUB_ENROLL || '',
    mtlsUrl: (fileCfg.mtlsUrl || '').replace(/\/$/, ''),
    caCert: fileCfg.caCert || '',
    clientCert: fileCfg.clientCert || '',
    clientKey: fileCfg.clientKey || '',
    proxyDefaults: fileCfg.proxyDefaults || { listenHost: '0.0.0.0', allowPrivateTargets: false }
  }
}
async function saveConfig() {
  const out = { controlUrl: cfg.controlUrl, token: cfg.token, enrollToken: cfg.enrollToken, mtlsUrl: cfg.mtlsUrl, caCert: cfg.caCert, clientCert: cfg.clientCert, clientKey: cfg.clientKey, proxyDefaults: cfg.proxyDefaults }
  try {
    // mkdir -p the parent dir on first run (Windows needs %ProgramData%\ProxyBox to exist).
    await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true }).catch(() => {})
    // mode 0o600 is a no-op on Windows (FAT/NTFS ACL model) — harmless.
    await fsp.writeFile(CONFIG_PATH, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 })
  } catch (e) { console.error(`[agent] save config failed: ${e.message}`) }
}

// ── HTTP(S) client to the control plane (mTLS when a client cert is present) ──
function rawRequest(fullUrl, { method = 'GET', body, headers = {}, tls } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl)
    const mod = u.protocol === 'https:' ? https : http
    const opts = { method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`, headers: { ...headers } }
    if (u.protocol === 'https:' && tls) { opts.cert = tls.cert; opts.key = tls.key; opts.ca = tls.ca }
    if (body) opts.headers['Content-Type'] = 'application/json'
    const req = mod.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = data ? JSON.parse(data) : null } catch { parsed = data }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed)
        else reject(new Error(`${method} ${u.pathname} -> ${res.statusCode} ${typeof parsed === 'object' ? JSON.stringify(parsed) : parsed}`))
      })
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => req.destroy(new Error('request timeout')))
    req.end(body ? JSON.stringify(body) : undefined)
  })
}
async function api(path, { method = 'GET', body, token, bootstrap } = {}) {
  const useMtls = !bootstrap && cfg.mtlsUrl && cfg.clientCert && cfg.clientKey && cfg.caCert
  const base = useMtls ? cfg.mtlsUrl : cfg.controlUrl
  const headers = {}
  const tok = token ?? cfg.token
  if (!useMtls && tok) headers.Authorization = `Bearer ${tok}`
  return rawRequest(`${base}${path}`, { method, body, headers, tls: useMtls ? { cert: cfg.clientCert, key: cfg.clientKey, ca: cfg.caCert } : undefined })
}

// ── Network detection (mirror of the control plane) ───────────────────────────
// PROXYHUB_IPV6_PREFIX_LEN lets the operator declare a wider routed prefix
// (typically /48 from upstream BGP). Default 64 matches every mainstream VPS.
function envPrefixLen() {
  const n = Number(process.env.PROXYHUB_IPV6_PREFIX_LEN)
  return Number.isFinite(n) && n >= 32 && n <= 64 ? Math.floor(n) : 64
}
// Detect whether the host has an outbound IPv6 default route. We honor the
// detection per-platform but degrade gracefully (false → keep raw mask).
function hasDefaultIpv6Route() {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process')
      const out = execSync('route -6 print', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString()
      // "::/0" appears in destinations when a default IPv6 route exists.
      return /\s::\/0\s/.test(out) || /\sDefault\s/i.test(out)
    } catch { return false }
  }
  try {
    const fs = require('node:fs')
    const lines = fs.readFileSync('/proc/net/ipv6_route', 'utf8').split('\n')
    for (const line of lines) {
      const f = line.split(/\s+/)
      if (f.length < 10) continue
      if (f[0] === '00000000000000000000000000000000' && f[1] === '00') {
        const flags = parseInt(f[8], 16)
        if (!(flags & 0x01000000)) return true   // skip RTF_CACHE entries
      }
    }
  } catch { /* fall through */ }
  return false
}
function detectNetwork() {
  const ifaces = os.networkInterfaces()
  const ipv4 = []
  const ipv6 = []
  const ipv6Prefixes = []
  const envPlen = envPrefixLen()
  const hasDefV6 = hasDefaultIpv6Route()
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.internal) continue
      if (a.family === 'IPv4' || a.family === 4) ipv4.push({ iface: name, address: a.address, cidr: a.cidr || `${a.address}/32` })
      else if (a.family === 'IPv6' || a.family === 6) {
        if (a.scopeid) continue
        const lower = a.address.toLowerCase()
        if (lower === '::1' || lower === '::' || /^fe[89ab]/.test(lower) || /^f[cd]/.test(lower)) continue
        const raw = a.cidr ? Number(a.cidr.split('/')[1]) : 128
        // Effective routed prefix: clamp env value down to raw (smaller = wider)
        const effective = hasDefV6 ? Math.min(envPlen, raw) : raw
        ipv6.push({ iface: name, address: a.address, cidr: `${a.address}/${effective}` })
        if (effective > 0 && effective <= 64) {
          const prefix = ipv6PrefixOf(a.address, effective)
          if (!ipv6Prefixes.some((p) => p.prefix === prefix && p.prefixLen === effective)) {
            ipv6Prefixes.push({ iface: name, address: a.address, cidr: `${prefix}/${effective}`, prefix, prefixLen: effective })
          }
        }
      }
    }
  }
  return { ipv4, ipv6, ipv6Prefixes }
}
function ipv4Pool() { return [...new Set(detected.ipv4.map((e) => e.address))] }
function ipv6Pool() { return [...new Set(detected.ipv6.map((e) => e.address))] }

// ── IPv6 helpers ──────────────────────────────────────────────────────────────
function expandIPv6(addr) {
  const clean = addr.split('%')[0]
  let head = []; let tail = []
  if (clean.includes('::')) { const [h, t] = clean.split('::'); head = h ? h.split(':') : []; tail = t ? t.split(':') : [] } else head = clean.split(':')
  const missing = 8 - head.length - tail.length
  return [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail].slice(0, 8).map((x) => parseInt(x || '0', 16) & 0xffff)
}
function ipv6FromParts(parts) {
  const hex = parts.map((p) => (p & 0xffff).toString(16))
  let bs = -1; let bl = 0; let cs = -1; let cl = 0
  for (let i = 0; i < 8; i++) { if (hex[i] === '0') { if (cs === -1) cs = i; cl++; if (cl > bl) { bl = cl; bs = cs } } else { cs = -1; cl = 0 } }
  if (bl < 2) return hex.join(':')
  return `${hex.slice(0, bs).join(':')}::${hex.slice(bs + bl).join(':')}`
}
function ipv6PrefixOf(addr, plen) {
  const parts = expandIPv6(addr)
  for (let i = 0; i < 8; i++) { const start = i * 16; if (start >= plen) parts[i] = 0; else if (start + 16 > plen) parts[i] &= (0xffff << (16 - (plen - start))) & 0xffff }
  return ipv6FromParts(parts)
}

// ── SSRF protection ───────────────────────────────────────────────────────────
function ipv4ToInt(ip) { return ip.split('.').reduce((a, o) => ((a << 8) | (Number(o) & 0xff)) >>> 0, 0) }
function inCidr4(ip, base, bits) { if (bits === 0) return true; const m = (0xffffffff << (32 - bits)) >>> 0; return (ipv4ToInt(ip) & m) === (ipv4ToInt(base) & m) }
const BLOCKED_V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]
function isBlockedIPv4(ip) { return net.isIP(ip) !== 4 || BLOCKED_V4.some(([b, n]) => inCidr4(ip, b, n)) }
function isBlockedIPv6(ip) { const l = ip.toLowerCase(); const m = l.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); if (m) return isBlockedIPv4(m[1]); if (l === '::' || l === '::1' || /^fe[89ab]/.test(l) || /^f[cd]/.test(l) || l.startsWith('ff')) return true; return false }
function isBlockedTarget(ip) { const v = net.isIP(ip); if (v === 4) return isBlockedIPv4(ip); if (v === 6) return isBlockedIPv6(ip); return true }

// ── DNS cache ─────────────────────────────────────────────────────────────────
const dnsCache = new Map()
async function resolveHost(host, family) {
  const key = `${family}:${host}`; const now = Date.now()
  const hit = dnsCache.get(key); if (hit && hit.expires > now) return hit.addresses
  let addrs
  try { addrs = family === 6 ? await dns.resolve6(host) : await dns.resolve4(host) } catch { const r = await dns.lookup(host, { all: true, family }); addrs = r.map((x) => x.address) }
  if (!addrs || addrs.length === 0) throw new Error(`no IPv${family} address`)
  if (dnsCache.size >= 4096) dnsCache.clear()
  dnsCache.set(key, { addresses: addrs, expires: now + 60_000 })
  return addrs
}
async function resolveTarget(host, family, allowPrivate) {
  if (net.isIP(host)) { if (net.isIP(host) !== family) throw new Error(`target ${host} is not IPv${family}`); if (!allowPrivate && isBlockedTarget(host)) throw new Error(`blocked target ${host}`); return host }
  let addrs
  try { addrs = await resolveHost(host, family) } catch (e) { throw new Error(`no IPv${family} address for ${host} (${e.code || e.message})`) }
  if (!allowPrivate) for (const a of addrs) if (isBlockedTarget(a)) throw new Error(`blocked target ${host} -> ${a}`)
  return addrs[0]
}

// ── stats ─────────────────────────────────────────────────────────────────────
const TOP_TARGETS_MAX = 50
const RECENT_CONNS_MAX = 50
function ensureStats(id) {
  if (!stats.has(id)) stats.set(id, { uploadBytes: 0, downloadBytes: 0, activeConnections: 0, totalConnections: 0, monthKey: new Date().toISOString().slice(0, 7), monthBytes: 0, secKey: 0, secBytes: 0, topTargets: new Map(), recentConns: [], recentConnsPending: [] })
  const m = stats.get(id)
  if (!m.topTargets) m.topTargets = new Map()
  if (!m.recentConns) m.recentConns = []
  if (!m.recentConnsPending) m.recentConnsPending = []
  return m
}
function addTraffic(m, up, down) { m.uploadBytes += up; m.downloadBytes += down; const mk = new Date().toISOString().slice(0, 7); if (m.monthKey !== mk) { m.monthKey = mk; m.monthBytes = 0 } m.monthBytes += up + down }
function recordConnection(m, info) {
  if (!info || !info.host) return
  const host = String(info.host).slice(0, 253).toLowerCase()
  const now = Date.now()
  let t = m.topTargets.get(host)
  if (!t) {
    if (m.topTargets.size >= TOP_TARGETS_MAX) {
      let ok = null, ot = Infinity
      for (const [k, v] of m.topTargets) if (v.lastTs < ot) { ot = v.lastTs; ok = k }
      if (ok) m.topTargets.delete(ok)
    }
    t = { count: 0, bytesUp: 0, bytesDown: 0, lastTs: 0 }
    m.topTargets.set(host, t)
  }
  t.count += 1; t.bytesUp += info.up || 0; t.bytesDown += info.down || 0; t.lastTs = now
  const rec = { ts: now, src: info.src || '', srcPort: info.srcPort || 0, host, port: info.port || 0, up: info.up || 0, down: info.down || 0, ms: info.ms || 0, kind: info.kind || 'http' }
  m.recentConns.push(rec); if (m.recentConns.length > RECENT_CONNS_MAX) m.recentConns.splice(0, m.recentConns.length - RECENT_CONNS_MAX)
  m.recentConnsPending.push(rec); if (m.recentConnsPending.length > RECENT_CONNS_MAX) m.recentConnsPending.splice(0, m.recentConnsPending.length - RECENT_CONNS_MAX)
}
function limitFor(proxy, key, dkey) { const v = proxy[key]; if (Number.isFinite(v) && v > 0) return v; const d = cfg.proxyDefaults[dkey]; return Number.isFinite(d) && d > 0 ? d : 0 }
function proxyFamily(p) { return (p.type || 'IPv4').toLowerCase() === 'ipv6' ? 6 : 4 }
function effectiveBindIp(p) { if (p.type === 'IPv6' && p.rotate) { const pool = ipv6Pool(); if (pool.length) return pool[Math.floor(Math.random() * pool.length)] } return p.bindIp }

// ── proxy engine ──────────────────────────────────────────────────────────────
function startProxy(proxy) {
  if (listeners.has(proxy.id)) return Promise.resolve()
  const server = net.createServer((client) => handleProxyClient(proxy, client))
  listeners.set(proxy.id, { server, proxy })
  const host = proxy.listenHost || cfg.proxyDefaults.listenHost || '0.0.0.0'
  return new Promise((resolve) => {
    server.on('error', (e) => { console.error(`[proxy:${proxy.id}] ${e.message}`); resolve() })
    server.listen(proxy.port, host, 65535, () => { console.log(`[proxy:${proxy.id}] ${host}:${proxy.port} -> ${proxy.bindIp}`); resolve() })
  })
}
function stopProxy(id) { const l = listeners.get(id); if (l) { l.server.close(); listeners.delete(id) } }
function timingEqual(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }
function isProxyAuthorized(p, u, pw) { if (p.status === 'expired') return false; return timingEqual(p.username, u) && timingEqual(p.password, pw) }

async function handleProxyClient(proxy, client) {
  const m = ensureStats(proxy.id)
  const maxConns = limitFor(proxy, 'maxConnections', 'maxConnectionsPerProxy')
  const quota = limitFor(proxy, 'monthlyQuotaBytes', 'monthlyQuotaBytes')
  if (maxConns > 0 && m.activeConnections >= maxConns) return client.destroy()
  if (quota > 0 && m.monthKey === new Date().toISOString().slice(0, 7) && m.monthBytes >= quota) return client.destroy()
  m.activeConnections += 1; m.totalConnections += 1
  client.setNoDelay(true); client.setTimeout(120_000); client.once('timeout', () => client.destroy())
  try {
    const first = await onceData(client)
    if (!first || first.length === 0) return client.destroy()
    if (first[0] === 0x05) await handleSocks5(proxy, client, first)
    else await handleHttpProxy(proxy, client, first)
  } catch { if (!client.destroyed) client.destroy() } finally { m.activeConnections = Math.max(0, m.activeConnections - 1) }
}
function onceData(socket) { return new Promise((resolve, reject) => { const cleanup = () => { socket.off('data', d); socket.off('error', e); socket.off('end', n) }; const d = (c) => { cleanup(); resolve(c) }; const e = (x) => { cleanup(); reject(x) }; const n = () => { cleanup(); resolve(Buffer.alloc(0)) }; socket.once('data', d); socket.once('error', e); socket.once('end', n) }) }

class SocketReader {
  constructor(socket, initial) { this.socket = socket; this.buffer = initial || Buffer.alloc(0); this.waiters = []; this.onData = (c) => { this.buffer = Buffer.concat([this.buffer, c]); this.flush() }; this.onError = (e) => { for (const w of this.waiters.splice(0)) w.reject(e) }; socket.on('data', this.onData); socket.on('error', this.onError) }
  flush() { for (let i = 0; i < this.waiters.length; i++) if (this.waiters[i].tryResolve()) { this.waiters.splice(i, 1); i-- } }
  readBytes(n) { if (this.buffer.length >= n) { const o = this.buffer.subarray(0, n); this.buffer = this.buffer.subarray(n); return Promise.resolve(o) } return new Promise((resolve, reject) => { this.waiters.push({ reject, tryResolve: () => { if (this.buffer.length < n) return false; const o = this.buffer.subarray(0, n); this.buffer = this.buffer.subarray(n); resolve(o); return true } }) }) }
  readUntil(delim, max = 65536) { const mk = Buffer.from(delim); const read = () => { const i = this.buffer.indexOf(mk); if (i !== -1) { const e = i + mk.length; const o = this.buffer.subarray(0, e); this.buffer = this.buffer.subarray(e); return o } if (this.buffer.length > max) throw new Error('header too large'); return null }; const im = read(); if (im) return Promise.resolve(im); return new Promise((resolve, reject) => { this.waiters.push({ reject, tryResolve: () => { try { const o = read(); if (!o) return false; resolve(o); return true } catch (e) { reject(e); return true } } }) }) }
  detach() { this.socket.off('data', this.onData); this.socket.off('error', this.onError); const r = this.buffer; this.buffer = Buffer.alloc(0); return r }
}

async function handleSocks5(proxy, client, initial) {
  const r = new SocketReader(client, initial)
  const head = await r.readBytes(2); if (head[0] !== 0x05) throw new Error('bad SOCKS version')
  const methods = await r.readBytes(head[1]); if (!methods.includes(0x02)) { client.write(Buffer.from([0x05, 0xff])); return client.destroy() }
  client.write(Buffer.from([0x05, 0x02]))
  const ah = await r.readBytes(2); const u = (await r.readBytes(ah[1])).toString('utf8'); const pl = (await r.readBytes(1))[0]; const pw = (await r.readBytes(pl)).toString('utf8')
  if (!isProxyAuthorized(proxy, u, pw)) { client.write(Buffer.from([0x01, 0x01])); return client.destroy() }
  client.write(Buffer.from([0x01, 0x00]))
  const req = await r.readBytes(4); if (req[1] !== 0x01) { client.write(Buffer.from([0x05, 0x07, 0, 1, 0, 0, 0, 0, 0, 0])); return client.destroy() }
  const host = await readSocksAddr(r, req[3]); const port = (await r.readBytes(2)).readUInt16BE(0); const rest = r.detach()
  const srcIp = (client.remoteAddress || '').replace(/^::ffff:/, '')
  let up
  try { up = await connectUpstream(proxy, host, port) } catch (e) { client.write(Buffer.from([0x05, e.message.startsWith('blocked') ? 2 : 5, 0, 1, 0, 0, 0, 0, 0, 0])); return client.destroy() }
  client.write(Buffer.from([0x05, 0, 0, 1, 0, 0, 0, 0, 0, 0])); relay(proxy, client, up, rest, { src: srcIp, srcPort: client.remotePort || 0, host, port, kind: 'socks5' })
}
async function readSocksAddr(r, atyp) { if (atyp === 1) return Array.from(await r.readBytes(4)).join('.'); if (atyp === 3) { const n = (await r.readBytes(1))[0]; return (await r.readBytes(n)).toString('utf8') } if (atyp === 4) { const b = await r.readBytes(16); const p = []; for (let i = 0; i < 16; i += 2) p.push(b.readUInt16BE(i).toString(16)); return p.join(':') } throw new Error('bad SOCKS atyp') }

async function handleHttpProxy(proxy, client, initial) {
  const r = new SocketReader(client, initial)
  const hb = await r.readUntil('\r\n\r\n'); const ht = hb.toString('latin1'); const [reqLine, ...hdrLines] = ht.split('\r\n'); const [method, target, protocol] = reqLine.split(' ')
  const headers = {}; for (const ln of hdrLines) { const i = ln.indexOf(':'); if (i !== -1) headers[ln.slice(0, i).trim().toLowerCase()] = ln.slice(i + 1).trim() }
  const auth = parseBasic(headers['proxy-authorization'])
  if (!auth || !isProxyAuthorized(proxy, auth.username, auth.password)) { client.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="ProxyBox"\r\nContent-Length: 0\r\n\r\n'); return client.destroy() }
  const rest = r.detach()
  const srcIp = (client.remoteAddress || '').replace(/^::ffff:/, '')
  if (method?.toUpperCase() === 'CONNECT') {
    const [h, pt] = splitHostPort(target, 443); let up
    try { up = await connectUpstream(proxy, h, Number(pt)) } catch (e) { client.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: ${e.message}\r\n\r\n`); return client.destroy() }
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: ProxyBox\r\n\r\n'); relay(proxy, client, up, rest, { src: srcIp, srcPort: client.remotePort || 0, host: h, port: Number(pt), kind: 'connect' }); return
  }
  let url; try { url = new URL(target) } catch { client.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'); return client.destroy() }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80)); let up
  try { up = await connectUpstream(proxy, url.hostname, port) } catch (e) { client.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nX-Proxy-Error: ${e.message}\r\n\r\n`); return client.destroy() }
  const clean = hdrLines.filter((l) => l && !/^proxy-/i.test(l)).join('\r\n')
  up.write(`${method} ${url.pathname}${url.search} ${protocol}\r\n${clean}\r\n\r\n`); relay(proxy, client, up, rest, { src: srcIp, srcPort: client.remotePort || 0, host: url.hostname, port, kind: 'http' })
}
function splitHostPort(v, d) { const i = v.lastIndexOf(':'); return i === -1 ? [v, d] : [v.slice(0, i), v.slice(i + 1)] }
function parseBasic(v) { if (!v || !v.toLowerCase().startsWith('basic ')) return null; const dec = Buffer.from(v.slice(6), 'base64').toString('utf8'); const i = dec.indexOf(':'); return i === -1 ? null : { username: dec.slice(0, i), password: dec.slice(i + 1) } }

async function connectUpstream(proxy, host, port) {
  const family = proxyFamily(proxy); const bindIp = effectiveBindIp(proxy)
  const allowPrivate = proxy.allowPrivateTargets ?? cfg.proxyDefaults.allowPrivateTargets ?? false
  const target = await resolveTarget(host, family, allowPrivate)
  return new Promise((resolve, reject) => {
    const opts = { host: target, port: Number(port), timeout: 30_000 }
    if (bindIp && net.isIP(bindIp) === family) opts.localAddress = bindIp
    const s = net.createConnection(opts); s.setNoDelay(true)
    s.once('connect', () => resolve(s)); s.once('timeout', () => { s.destroy(); reject(new Error(`connect timeout ${host}:${port}`)) }); s.once('error', reject)
  })
}
function relay(proxy, client, up, initialToUpstream, connInfo) {
  const m = ensureStats(proxy.id); up.setNoDelay(true)
  let cc = false; let uc = false; let acc = false
  const startTs = Date.now()
  const settle = () => {
    if (acc || !cc || !uc) return; acc = true
    const u = client.bytesRead || 0, d = up.bytesRead || 0
    addTraffic(m, u, d)
    if (connInfo && connInfo.host) recordConnection(m, { src: connInfo.src, srcPort: connInfo.srcPort, host: connInfo.host, port: connInfo.port, kind: connInfo.kind, up: u, down: d, ms: Date.now() - startTs })
  }
  up.on('error', () => client.destroy()); client.on('error', () => up.destroy())
  client.on('close', () => { cc = true; up.destroy(); settle() }); up.on('close', () => { uc = true; client.destroy(); settle() })
  const rate = limitFor(proxy, 'bytesPerSec', 'bytesPerSec')
  if (rate > 0) {
    const onChunk = (len) => { const sec = Math.floor(Date.now() / 1000); if (m.secKey !== sec) { m.secKey = sec; m.secBytes = 0 } m.secBytes += len; if (m.secBytes > rate && !client.isPaused()) { client.pause(); up.pause(); setTimeout(() => { if (!client.destroyed) client.resume(); if (!up.destroyed) up.resume() }, Math.max(1, (sec + 1) * 1000 - Date.now())) } }
    client.on('data', (c) => onChunk(c.length)); up.on('data', (c) => onChunk(c.length))
  }
  if (initialToUpstream?.length) up.write(initialToUpstream)
  client.pipe(up); up.pipe(client)
}

// ── control-plane sync loop ───────────────────────────────────────────────────
async function reconcile() {
  let wanted
  try { wanted = await api('/api/agent/proxies') } catch (e) {
    console.error(`[agent] pull proxies failed: ${e.message}`)
    // Disowned by control plane (node deleted / token revoked) → drop every
    // listener so we don't keep serving traffic the server no longer tracks.
    if (/HTTP 401|HTTP 403|Unauthorized/i.test(e.message || '')) {
      for (const id of [...listeners.keys()]) {
        console.log(`[agent] disowned — stopping proxy ${id}`)
        stopProxy(id); stats.delete(id)
      }
    }
    return
  }
  if (!Array.isArray(wanted)) return
  const wantIds = new Set(wanted.map((p) => p.id))
  for (const id of [...listeners.keys()]) if (!wantIds.has(id)) { console.log(`[agent] removing proxy ${id}`); stopProxy(id); stats.delete(id) }
  for (const p of wanted) {
    const cur = listeners.get(p.id)
    if (!cur) { ensureStats(p.id); await startProxy(p) }
    else { cur.proxy = p } // pick up cred / status / limit changes (rotate uses live config)
  }
}
async function heartbeat() {
  const statsPayload = {}
  for (const [id, s] of stats) {
    const topTargets = {}
    for (const [host, v] of s.topTargets) topTargets[host] = { count: v.count, bytesUp: v.bytesUp, bytesDown: v.bytesDown, lastTs: v.lastTs }
    statsPayload[id] = {
      uploadBytes: s.uploadBytes,
      downloadBytes: s.downloadBytes,
      monthBytes: s.monthKey === new Date().toISOString().slice(0, 7) ? s.monthBytes : 0,
      activeConnections: s.activeConnections,
      totalConnections: s.totalConnections,
      topTargets,
      recentConns: s.recentConnsPending.slice()
    }
    s.recentConnsPending.length = 0
  }
  try { await api('/api/agent/heartbeat', { method: 'POST', body: { version: AGENT_VERSION, network: detected, stats: statsPayload } }) } catch (e) { console.error(`[agent] heartbeat failed: ${e.message}`) }
}
async function enrollIfNeeded() {
  if (cfg.token && cfg.clientCert) return            // fully provisioned (token + mTLS cert)
  if (!cfg.enrollToken) {
    if (cfg.token) return                            // have a token but cannot (re-)enroll; use bearer
    throw new Error('agent has no token and no enrollToken — re-run the install command')
  }
  const data = await api('/api/agent/enroll', { method: 'POST', body: { enrollToken: cfg.enrollToken }, token: '', bootstrap: true })
  cfg.token = data.token
  // keep the controlUrl we already have (the one that reached /enroll)
  if (!cfg.controlUrl && data.controlUrl) cfg.controlUrl = String(data.controlUrl).replace(/\/$/, '')
  if (data.proxyDefaults) cfg.proxyDefaults = data.proxyDefaults
  if (data.mtlsUrl && data.caCert && data.clientCert && data.clientKey) {
    cfg.mtlsUrl = String(data.mtlsUrl).replace(/\/$/, '')
    cfg.caCert = data.caCert; cfg.clientCert = data.clientCert; cfg.clientKey = data.clientKey
    console.log('[agent] received mTLS client cert; agent channel will use mTLS')
  }
  await saveConfig()
  console.log(`[agent] enrolled as node ${data.nodeId}`)
}

async function main() {
  if (!cfg.controlUrl) { console.error('[agent] no controlUrl configured'); process.exit(1) }
  await enrollIfNeeded()
  await api('/api/agent/register', { method: 'POST', body: { version: AGENT_VERSION, network: detected } })
  console.log(`[agent] registered with ${cfg.controlUrl} (v${AGENT_VERSION})`)
  await reconcile()
  setInterval(() => { detected = detectNetwork() }, 5 * 60 * 1000).unref()
  setInterval(() => { reconcile().catch(() => {}) }, 10_000)
  setInterval(() => { heartbeat().catch(() => {}) }, 20_000)
  heartbeat().catch(() => {})
}
main().catch((e) => { console.error(`[agent] fatal: ${e.message}`); process.exit(1) })
