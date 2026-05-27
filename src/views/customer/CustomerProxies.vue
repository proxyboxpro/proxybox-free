<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity, AlertOctagon, ArrowLeft, Check, ChevronDown, ChevronUp, Clock, Copy,
  Download, ExternalLink, Eye, Gauge, Globe, KeyRound, Layers, Link, ListChecks,
  Pencil, Play, Plus, QrCode, Radio, RefreshCw, RotateCw, Search, ShieldAlert, ShieldCheck,
  Tag, Terminal, Timer, Trash2, Wrench, X, Zap
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'
import SpeedGauge from '../../components/SpeedGauge.vue'
import QRCode from 'qrcode'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const list = ref([])
const search = ref('')
const filterType = ref('all')         // 'all' | 'ipv4' | 'ipv6'
const filterStatus = ref('all')        // 'all' | 'active' | 'expiring' | 'expired'
const err = ref('')
const flash = ref('')
const expanded = ref(new Set())        // expanded group ids
const busy = reactive({})              // busy[groupId] = 'check'|'extend'|'delete'
const checkResults = reactive({})      // checkResults[groupId] = { ok, fail }
const extendHours = reactive({})       // extendHours[groupId] = number
const whitelistEditing = ref('')       // groupId being edited
const whitelistInput = ref('')

// ── Tier-1 features: label, bulk select, credentials ───────────────────
const selected = ref(new Set())                 // proxy ids ticked across all groups
const labelEditing = ref('')                    // id of proxy/group whose label is being edited
const labelDraft = ref('')
const credsEditing = ref('')                    // proxy id being edited
const credsDraft = reactive({ username: '', password: '' })
const credsErr = ref('')

// ── Tier-2/3 additions ────────────────────────────────────────────────
const filterTag = ref('')                       // tag filter chip
const exportMenuOpen = ref('')                  // groupId whose format menu is open
const sparkData = reactive({})                  // sparkData[proxyId] = { up: [], down: [] }
const statsData = reactive({})                  // statsData[groupId] = { uptime, bandwidth, latency }
const testModal = ref(null)                     // proxy object being tested
const testResult = ref(null)                    // result of quick-test
const testBusy = ref(false)
const timelineModal = ref(null)                 // group whose activity timeline is open
const timelineEvents = ref([])
const tagEditing = ref('')                      // proxy id whose tags are being edited
const tagDraft = ref('')

// ── Embedded Tools (per-proxy speed test / blacklist / ip-info / ping) ─
const toolsMenuFor = ref('')                    // proxy id whose tools menu is open
const toolsModal = ref(null)                    // { proxy, tool, busy, result, error }

// ── Group-level tabs + batch tool results ─────────────────────────────
// Each group keeps its own active tab. Batch results are stored under
// composite keys `${groupId}|${tool}|${proxyId}` so they don't collide.
const activeTabByGroup = reactive({})           // groupId -> tab id ('list' | 'test' | ...)
const batchResults = reactive({})               // composite key -> result
const batchBusy = reactive({})                  // composite key -> boolean
const bulkTagDraft = reactive({})               // groupId -> draft tag string

async function refresh() {
  err.value = ''
  try { list.value = await apiFetch('/api/v1/user/proxies') }
  catch (e) { err.value = e.message }
}

// Detail-mode: when /proxies/order/:orderId is the active route, the view
// focuses on a single group + shows a back button instead of the KPI/filters.
const orderIdParam = computed(() => String(route.params.orderId || ''))
const isDetailMode = computed(() => !!orderIdParam.value)

function applyQueryFilter() {
  const q = String(route.query.type || '').toLowerCase()
  filterType.value = (q === 'ipv4' || q === 'ipv6') ? q : 'all'
  const wantOrder = String(route.query.order || route.params.orderId || '')
  if (wantOrder) {
    expanded.value = new Set([wantOrder])
  }
}
watch(() => route.query, applyQueryFilter)
watch(() => route.params.orderId, applyQueryFilter)

function fmtTs(at) { return at ? String(at).slice(0, 16).replace('T', ' ') : '—' }
// Reactive "now" ticking every second so countdown timers update live.
const nowMs = ref(Date.now())
let countdownTimer = null
// Full live countdown: returns object { text, tier } where tier ∈
// 'active' | 'soon' | 'expiring' | 'critical' | 'expired'.
// Format: "Xd HH:MM:SS" (>1 day) or "HH:MM:SS" (<1 day).
function fmtCountdown(at) {
  if (!at) return { text: '—', tier: 'muted' }
  const ms = new Date(at).getTime() - nowMs.value
  if (ms <= 0) return { text: t('cust.proxies.expired'), tier: 'expired' }
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
  let tier = 'active'
  if (ms < 3600_000) tier = 'critical'
  else if (ms < 86400_000) tier = 'expiring'
  else if (ms < 7 * 86400_000) tier = 'soon'
  return { text, tier }
}

// ── Grouping ────────────────────────────────────────────────────────────
// Each group = one order (proxy.orderId). Proxies without orderId fall into
// a synthetic "single" group keyed by proxy.id so they still render.
const groups = computed(() => {
  const map = new Map()
  for (const p of list.value) {
    const gid = p.orderId || `single-${p.id}`
    if (!map.has(gid)) {
      map.set(gid, {
        id: gid,
        orderId: p.orderId || null,
        synthetic: !p.orderId,
        type: p.type,
        family: p.family,
        zone: p.zone || '',
        country: zoneToCC(p.zone),
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        proxies: []
      })
    }
    const g = map.get(gid)
    g.proxies.push(p)
    // Use earliest expiry as group expiry, earliest createdAt as group creation
    if (p.expiresAt && (!g.expiresAt || new Date(p.expiresAt) < new Date(g.expiresAt))) g.expiresAt = p.expiresAt
    if (p.createdAt && (!g.createdAt || new Date(p.createdAt) < new Date(g.createdAt))) g.createdAt = p.createdAt
  }
  return [...map.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
})

function zoneToCC(z) {
  z = String(z || '').toLowerCase()
  if (z.startsWith('vn')) return 'VN'
  if (z.startsWith('us')) return 'US'
  if (z.startsWith('gb') || z.startsWith('uk')) return 'GB'
  if (z.startsWith('de')) return 'DE'
  if (z.startsWith('jp')) return 'JP'
  if (z.startsWith('sg')) return 'SG'
  if (z.startsWith('hk')) return 'HK'
  if (z.startsWith('fr')) return 'FR'
  if (z.startsWith('kr')) return 'KR'
  return null
}
function groupStatus(g) {
  if (g.proxies.every((p) => p.status === 'expired')) return 'expired'
  if (g.proxies.some((p) => p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 86_400_000 * 3) && g.proxies.some((p) => p.status === 'active')) return 'expiring'
  if (g.proxies.every((p) => p.status === 'active')) return 'active'
  return 'mixed'
}
function statusLabel(s) {
  return ({ active: t('cust.proxies.statusActive'), expiring: t('cust.proxies.statusExpiring'), expired: t('cust.proxies.statusExpired'), mixed: t('cust.proxies.statusMixed') })[s] || s
}

const counts = computed(() => ({
  total: list.value.length,
  active: list.value.filter((p) => p.status === 'active').length,
  expiring: list.value.filter((p) => p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 86_400_000 * 3 && p.status === 'active').length,
  expired: list.value.filter((p) => p.status === 'expired').length
}))

const filteredGroups = computed(() => groups.value.filter((g) => {
  if (filterType.value !== 'all' && (g.type || '').toLowerCase() !== filterType.value) return false
  if (filterStatus.value !== 'all' && groupStatus(g) !== filterStatus.value) return false
  if (search.value) {
    const q = search.value.toLowerCase()
    if (!g.proxies.some((p) => `${p.ip || p.bindIp} ${p.bindIp} ${p.port} ${p.username} ${g.orderId || ''}`.toLowerCase().includes(q))) return false
  }
  return true
}))

// ── Per-group actions ───────────────────────────────────────────────────
function isExpanded(gid) { return expanded.value.has(gid) }
function toggleGroup(gid) {
  const next = new Set(expanded.value)
  if (next.has(gid)) next.delete(gid); else next.add(gid)
  expanded.value = next
}

function proxyLine(p, fmt = 'colon') {
  // Prefer the unified-listener port when the backend exposes it — one URL
  // for ALL of the customer's proxies, identified by username. The legacy
  // per-proxy port still works (dual-mode in agent) so old configs survive.
  const port = p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port
  // colon: host:port:user:pass — most common scraping/multilogin format
  // url-http / url-socks5: full URL form
  // host = p.ip (customer-facing v4 — even for IPv6 proxies); bindIp = egress.
  const host = p.ip || p.bindIp
  if (fmt === 'url-http')   return `http://${p.username}:${p.password}@${host}:${port}`
  if (fmt === 'url-socks5') return `socks5://${p.username}:${p.password}@${host}:${port}`
  return `${host}:${port}:${p.username}:${p.password}`
}
async function copyGroup(g, fmt = 'colon') {
  const text = g.proxies.map((p) => proxyLine(p, fmt)).join('\n')
  try { await navigator.clipboard.writeText(text); flash.value = t('cust.proxies.copied', { n: g.proxies.length }) }
  catch { /* no clipboard — fall through */ }
  setTimeout(() => { if (flash.value.includes(String(g.proxies.length))) flash.value = '' }, 2000)
}
function exportGroup(g, fmt = 'txt') {
  const lines = g.proxies.map((p) => proxyLine(p, 'colon'))
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `proxies-${g.orderId || g.id}.${fmt}`
  a.click()
  URL.revokeObjectURL(url)
}
async function checkGroup(g) {
  if (busy[g.id]) return
  busy[g.id] = 'check'
  delete checkResults[g.id]
  try {
    const r = await apiFetch('/api/v1/user/proxies/check-bulk', {
      method: 'POST',
      body: { ids: g.proxies.map((p) => p.id) }
    })
    checkResults[g.id] = { ok: r.ok, fail: r.total - r.ok, results: r.results }
    await refresh()
  } catch (e) { err.value = e.message }
  finally { busy[g.id] = null }
}
async function extendGroup(g) {
  const hours = Math.max(1, Math.min(8760, Number(extendHours[g.id]) || 24))
  if (!confirm(t('cust.proxies.confirmExtend', { n: g.proxies.length, h: hours }))) return
  busy[g.id] = 'extend'
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}/extend`, { method: 'POST', body: { hours } })
    }
    flash.value = t('cust.proxies.extended', { n: g.proxies.length, h: hours })
    await refresh()
  } catch (e) { err.value = e.message }
  finally { busy[g.id] = null }
}
async function deleteGroup(g) {
  if (!confirm(t('cust.proxies.confirmDelete', { n: g.proxies.length }))) return
  busy[g.id] = 'delete'
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    }
    flash.value = t('cust.proxies.deleted', { n: g.proxies.length })
    await refresh()
  } catch (e) { err.value = e.message }
  finally { busy[g.id] = null }
}
async function deleteProxy(g, p) {
  if (!confirm(t('cust.proxies.confirmDeleteOne'))) return
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e) { err.value = e.message }
}
const rotating = ref('')
const checking = ref('')
const expandedProxies = reactive(new Set())
function toggleProxyExpand(p) {
  if (expandedProxies.has(p.id)) expandedProxies.delete(p.id)
  else expandedProxies.add(p.id)
}
const flashMsg = ref('')
async function rotateProxy(p) {
  if (rotating.value) return
  rotating.value = p.id
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/rotate`, { method: 'POST' })
    p.bindIp = r.bindIp
    flashMsg.value = t('cust.proxies.ipChanged', { id: p.id, ip: r.bindIp })
    setTimeout(() => { flashMsg.value = '' }, 3000)
    await refresh()
  } catch (e) { err.value = e.message }
  finally { rotating.value = '' }
}
async function disconnectAllSessions(p) {
  if (!confirm(t('cust.proxies.disconnectConfirm', { id: p.id }))) return
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/disconnect-all`, { method: 'POST' })
    const n = r.kickedLocal ?? 0
    p.session = r.session || p.session
    flashMsg.value = t('cust.proxies.disconnected', { n, id: p.id })
    setTimeout(() => { flashMsg.value = '' }, 3000)
    await refresh()
  } catch (e) { err.value = e.message }
}
async function checkProxy(p) {
  if (checking.value) return
  checking.value = p.id
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/check`, { method: 'POST' })
    p.status = r.proxy?.status || p.status
    p.lastCheckOk = r.ok
    flashMsg.value = r.ok ? `${p.id} OK (${r.latencyMs}ms)` : `${p.id} fail: ${r.error || 'error'}`
    setTimeout(() => { flashMsg.value = '' }, 3000)
  } catch (e) { err.value = e.message }
  finally { checking.value = '' }
}
async function copyRotateUrl(p, ev) {
  if (!p.rotateUrl) return
  try {
    await navigator.clipboard.writeText(p.rotateUrl)
    flashMsg.value = `Copied rotate URL: ${p.rotateUrl}`
    setTimeout(() => { flashMsg.value = '' }, 3500)
  } catch { /* noop */ }
}

// IPv6 groups only. Collects every proxy's rotateUrl in the group and
// either copies the joined list to the clipboard or downloads it as a
// .txt file the customer can feed straight into a scraper. Skips
// proxies without a rotateUrl (e.g. IPv4 or expired) so the output is
// pure "one rotation trigger per line".
function groupRotateUrls(g) {
  if (g.type !== 'IPv6') return []
  return g.proxies.filter((p) => p.rotateUrl).map((p) => p.rotateUrl)
}
async function copyGroupRotateUrls(g) {
  const urls = groupRotateUrls(g)
  if (urls.length === 0) { flash.value = t('cust.proxies.noRotateUrls') || 'no rotate URLs in this group'; return }
  try {
    await navigator.clipboard.writeText(urls.join('\n'))
    flash.value = (t('cust.proxies.rotateUrlsCopied') || 'Copied {n} rotate URLs').replace('{n}', urls.length)
    setTimeout(() => { flash.value = '' }, 3500)
  } catch { /* noop */ }
}
function downloadGroupRotateUrls(g) {
  const urls = groupRotateUrls(g)
  if (urls.length === 0) return
  const blob = new Blob([urls.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rotate-urls-${g.orderId || g.id || 'group'}.txt`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// QR cache so each proxy×mode renders only once per session.
const qrCache = reactive({})
async function qrFor(url, size = 140) {
  const key = `${size}:${url}`
  if (qrCache[key]) return qrCache[key]
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: size, color: { dark: '#22c55e', light: '#0f1419' } })
    qrCache[key] = svg
    return svg
  } catch { return '' }
}
function qrSvg(url, size = 140) {
  if (!url) return ''
  const key = `${size}:${url}`
  if (!qrCache[key]) { qrFor(url, size); return '' }
  return qrCache[key]
}
async function copyText(text, label, ev) {
  try {
    await navigator.clipboard.writeText(text)
    flashMsg.value = `Copied ${label}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`
    setTimeout(() => { flashMsg.value = '' }, 2500)
  } catch { /* noop */ }
}

// QR popup — small-icon click expands to large QR + download SVG button.
const qrModal = ref(null) // { url, label }
function openQrModal(url, label) { qrModal.value = { url, label } }
function closeQrModal() { qrModal.value = null }
function downloadQr(url, label) {
  const svg = qrCache[`360:${url}`] || qrCache[`140:${url}`]
  if (!svg) return
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${label.replace(/[^a-z0-9_-]+/gi, '_')}.svg`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── IP whitelist (auth bypass) ──────────────────────────────────────────
function openWhitelist(gid) {
  whitelistEditing.value = gid
  whitelistInput.value = ''
}
function closeWhitelist() {
  whitelistEditing.value = ''
}
async function addWhitelistIp(g) {
  const ip = whitelistInput.value.trim()
  if (!ip) return
  // Apply to every proxy in the group — the whitelist is per-proxy on the backend.
  try {
    for (const p of g.proxies) {
      const cur = Array.isArray(p.allowedSrcIps) ? p.allowedSrcIps : []
      if (cur.includes(ip)) continue
      const next = [...cur, ip].slice(0, 20)
      await apiFetch(`/api/v1/user/proxies/${p.id}/whitelist`, { method: 'PUT', body: { allowedSrcIps: next } })
      p.allowedSrcIps = next
    }
    whitelistInput.value = ''
  } catch (e) { err.value = e.message }
}
async function removeWhitelistIp(g, ip) {
  try {
    for (const p of g.proxies) {
      const cur = Array.isArray(p.allowedSrcIps) ? p.allowedSrcIps : []
      const next = cur.filter((x) => x !== ip)
      if (next.length === cur.length) continue
      await apiFetch(`/api/v1/user/proxies/${p.id}/whitelist`, { method: 'PUT', body: { allowedSrcIps: next } })
      p.allowedSrcIps = next
    }
  } catch (e) { err.value = e.message }
}

// Aggregate the whitelist of a group (union of all proxies' whitelists — they
// should all be identical in practice since the editor applies to the group).
function groupWhitelist(g) {
  const set = new Set()
  for (const p of g.proxies) for (const ip of (p.allowedSrcIps || [])) set.add(ip)
  return [...set]
}

// Currently editing group object (for the inline whitelist panel).
const editingGroup = computed(() => groups.value.find((g) => g.id === whitelistEditing.value) || null)

// ── Bulk selection across groups ────────────────────────────────────────
function isSelected(id) { return selected.value.has(id) }
function toggleProxySel(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selected.value = next
}
function toggleGroupSel(g) {
  const ids = g.proxies.map((p) => p.id)
  const allOn = ids.every((id) => selected.value.has(id))
  const next = new Set(selected.value)
  for (const id of ids) { if (allOn) next.delete(id); else next.add(id) }
  selected.value = next
}
function isGroupAllSelected(g) {
  return g.proxies.length > 0 && g.proxies.every((p) => selected.value.has(p.id))
}
function clearSelection() { selected.value = new Set() }
const selectedProxies = computed(() => list.value.filter((p) => selected.value.has(p.id)))

async function bulkCopy(fmt = 'colon') {
  const text = selectedProxies.value.map((p) => proxyLine(p, fmt)).join('\n')
  try { await navigator.clipboard.writeText(text); flash.value = t('cust.proxies.copied', { n: selectedProxies.value.length }) }
  catch { /* noop */ }
  setTimeout(() => { flash.value = '' }, 2000)
}
function bulkExport() {
  const lines = selectedProxies.value.map((p) => proxyLine(p, 'colon'))
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `proxies-selected-${Date.now()}.txt`; a.click()
  URL.revokeObjectURL(url)
}
async function bulkCheck() {
  try {
    const r = await apiFetch('/api/v1/user/proxies/check-bulk', {
      method: 'POST',
      body: { ids: [...selected.value] }
    })
    flash.value = t('cust.proxies.checkDone', { ok: r.ok, fail: r.total - r.ok })
    await refresh()
  } catch (e) { err.value = e.message }
}
async function bulkExtend() {
  const hours = Number(prompt(t('cust.proxies.bulkExtendPrompt'), '24'))
  if (!hours || hours < 1) return
  try {
    for (const id of selected.value) {
      await apiFetch(`/api/v1/user/proxies/${id}/extend`, { method: 'POST', body: { hours } })
    }
    flash.value = t('cust.proxies.extended', { n: selected.value.size, h: hours })
    clearSelection()
    await refresh()
  } catch (e) { err.value = e.message }
}
async function bulkDelete() {
  if (!confirm(t('cust.proxies.confirmDelete', { n: selected.value.size }))) return
  try {
    for (const id of selected.value) {
      await apiFetch(`/api/v1/user/proxies/${id}`, { method: 'DELETE' })
    }
    flash.value = t('cust.proxies.deleted', { n: selected.value.size })
    clearSelection()
    await refresh()
  } catch (e) { err.value = e.message }
}

// ── Inline label edit ──────────────────────────────────────────────────
function openLabelEdit(p) {
  labelEditing.value = p.id
  labelDraft.value = p.label || ''
}
function cancelLabelEdit() { labelEditing.value = ''; labelDraft.value = '' }
async function saveLabel(p) {
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, {
      method: 'PATCH',
      body: { label: labelDraft.value.slice(0, 64) }
    })
    p.label = labelDraft.value.slice(0, 64)
    cancelLabelEdit()
  } catch (e) { err.value = e.message }
}
// Group label = apply same label to every proxy in the group (so they all
// share an identifier when listed).
async function saveGroupLabel(g) {
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}`, {
        method: 'PATCH',
        body: { label: labelDraft.value.slice(0, 64) }
      })
      p.label = labelDraft.value.slice(0, 64)
    }
    cancelLabelEdit()
  } catch (e) { err.value = e.message }
}
function groupLabel(g) {
  // If every proxy shares the same label, surface it; else show empty.
  const labels = new Set(g.proxies.map((p) => p.label || ''))
  return labels.size === 1 ? [...labels][0] : ''
}

// ── Credentials editor ─────────────────────────────────────────────────
function openCredsEdit(p) {
  credsEditing.value = p.id
  credsDraft.username = p.username
  credsDraft.password = p.password
  credsErr.value = ''
}
function closeCredsEdit() { credsEditing.value = ''; credsErr.value = '' }
async function saveCreds(p) {
  credsErr.value = ''
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}`, {
      method: 'PATCH',
      body: { username: credsDraft.username.trim(), password: credsDraft.password }
    })
    p.username = r.username
    p.password = r.password
    closeCredsEdit()
    flash.value = t('cust.proxies.credsSaved')
    setTimeout(() => { flash.value = '' }, 2000)
  } catch (e) { credsErr.value = e.data?.error || e.message }
}

// ── Multi-format export ────────────────────────────────────────────────
// `host` is the customer-facing endpoint (p.ip = node's IPv4 even for IPv6
// proxies). `p.bindIp` is the v6 egress address — NEVER use it for export
// because v4-only clients can't dial a v6 host.
function hostOf(p) { return p.ip || p.bindIp }
function portOf(p) { return p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port }
function formatProxies(proxies, fmt) {
  switch (fmt) {
    case 'colon':       return proxies.map((p) => `${hostOf(p)}:${portOf(p)}:${p.username}:${p.password}`).join('\n')
    case 'url-http':    return proxies.map((p) => `http://${p.username}:${p.password}@${hostOf(p)}:${portOf(p)}`).join('\n')
    case 'url-socks5':  return proxies.map((p) => `socks5://${p.username}:${p.password}@${hostOf(p)}:${portOf(p)}`).join('\n')
    case 'curl':        return proxies.map((p) => `curl -x http://${p.username}:${p.password}@${hostOf(p)}:${portOf(p)} https://api.ipify.org`).join('\n')
    case 'env':         return proxies.map((p, i) => `PROXY_${i + 1}=http://${p.username}:${p.password}@${hostOf(p)}:${portOf(p)}`).join('\n')
    case 'json':        return JSON.stringify(proxies.map((p) => ({ host: hostOf(p), port: portOf(p), username: p.username, password: p.password, type: p.type, egressIp: p.bindIp })), null, 2)
    case 'switchyomega': {
      const lines = ['function FindProxyForURL(url, host) {']
      lines.push('  return "' + proxies.map((p) => `PROXY ${hostOf(p)}:${p.port}`).join('; ') + '; DIRECT";')
      lines.push('}')
      return lines.join('\n')
    }
    case 'foxyproxy': {
      const inner = proxies.map((p, i) => `  <proxy name="ProxyBox-${i+1}" enabled="true" mode="manual" type="0">
    <manualconf host="${hostOf(p)}" port="${p.port}" socksversion="0" isSocks="false"
      username="${p.username}" password="${p.password}" />
  </proxy>`).join('\n')
      return `<?xml version="1.0" encoding="UTF-8"?>\n<foxyproxy>\n${inner}\n</foxyproxy>`
    }
    default: return formatProxies(proxies, 'colon')
  }
}
function exportFormat(g, fmt) {
  const text = formatProxies(g.proxies, fmt)
  const ext = fmt === 'json' ? 'json' : fmt === 'switchyomega' ? 'pac' : fmt === 'foxyproxy' ? 'xml' : fmt === 'env' ? 'env' : 'txt'
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `proxies-${g.orderId || g.id}-${fmt}.${ext}`; a.click()
  URL.revokeObjectURL(url)
  exportMenuOpen.value = ''
}
async function copyFormat(g, fmt) {
  try { await navigator.clipboard.writeText(formatProxies(g.proxies, fmt)); flash.value = t('cust.proxies.copied', { n: g.proxies.length }) }
  catch { /* noop */ }
  setTimeout(() => { flash.value = '' }, 2000)
  exportMenuOpen.value = ''
}

// ── Sparkline (24h history) ────────────────────────────────────────────
async function loadSpark(proxyId) {
  if (sparkData[proxyId]) return
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${proxyId}/history?hours=24`)
    const samples = r.samples || []
    sparkData[proxyId] = {
      up:   samples.map((s) => Number(s.uploadBytes || 0)),
      down: samples.map((s) => Number(s.downloadBytes || 0))
    }
  } catch { sparkData[proxyId] = { up: [], down: [] } }
}
function sparkPath(values, w = 80, h = 18) {
  if (!values || !values.length) return ''
  const max = Math.max(1, ...values)
  const step = w / Math.max(1, values.length - 1)
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ')
}

// ── Quick stats per group (uptime + bandwidth) ─────────────────────────
async function loadGroupStats(g) {
  if (statsData[g.id]) return
  try {
    const [slas, hists] = await Promise.all([
      Promise.all(g.proxies.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/sla?days=7`).catch(() => ({ pct: null })))),
      Promise.all(g.proxies.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/history?hours=720`).catch(() => ({ samples: [] }))))
    ])
    const validPcts = slas.map((s) => s.pct).filter((x) => x !== null && x !== undefined)
    const uptime = validPcts.length ? (validPcts.reduce((a, b) => a + b, 0) / validPcts.length) : null
    let bw = 0
    for (const h of hists) for (const s of (h.samples || [])) bw += Number(s.uploadBytes || 0) + Number(s.downloadBytes || 0)
    const latencies = g.proxies.map((p) => Number(p.latency || 0)).filter((x) => x > 0)
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
    statsData[g.id] = { uptime, bandwidth: bw, latency: avgLatency }
  } catch { statsData[g.id] = { uptime: null, bandwidth: 0, latency: null } }
}
function fmtBytes(b) {
  if (!b) return '0 B'
  const u = ['B','KB','MB','GB','TB']; let i = 0
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
  return `${b.toFixed(b >= 100 ? 0 : 1)} ${u[i]}`
}

// Lazy-load spark + stats when a group is expanded.
function toggleGroupExpanded(g) {
  toggleGroup(g.id)
  if (isExpanded(g.id)) {
    loadGroupStats(g)
    for (const p of g.proxies) loadSpark(p.id)
  }
}

// ── Quick-test (in browser) ────────────────────────────────────────────
async function runQuickTest(p) {
  testModal.value = p
  testResult.value = null
  testBusy.value = true
  try {
    testResult.value = await apiFetch(`/api/v1/user/proxies/${p.id}/quick-test`, { method: 'POST' })
  } catch (e) { testResult.value = { ok: false, error: e.data?.error || e.message } }
  finally { testBusy.value = false }
}
function closeTest() { testModal.value = null; testResult.value = null }

// ── Embedded tools per proxy row ───────────────────────────────────────
async function runTool(p, tool) {
  toolsMenuFor.value = ''
  toolsModal.value = { proxy: p, tool, busy: true, result: null, error: null }
  try {
    let result = null
    if (tool === 'speed-test') {
      result = await apiFetch('/api/v1/user/tools/speed-test', {
        method: 'POST',
        body: { proxyId: p.id, country: 'VN', isp: 'auto' }
      })
    } else if (tool === 'blacklist') {
      result = await apiFetch('/api/v1/user/tools/blacklist', {
        method: 'POST',
        body: { ip: p.bindIp }
      })
    } else if (tool === 'ip-info') {
      result = await apiFetch('/api/v1/user/tools/ip-info', {
        method: 'POST',
        body: { ip: p.bindIp }
      })
    } else if (tool === 'ping') {
      result = await apiFetch('/api/v1/user/tools/ping', {
        method: 'POST',
        body: { ip: p.bindIp, count: 4 }
      })
    }
    toolsModal.value = { proxy: p, tool, busy: false, result, error: null }
  } catch (e) {
    toolsModal.value = { proxy: p, tool, busy: false, result: null, error: e.data?.error || e.message }
  }
}
function closeToolsModal() { toolsModal.value = null }

// ── Group tabs ─────────────────────────────────────────────────────────
const GROUP_TABS = [
  { id: 'list',       labelKey: 'cust.proxies.tabList',      icon: Layers },
  { id: 'copy',       labelKey: 'cust.proxies.tabCopy',      icon: Copy },
  { id: 'test',       labelKey: 'cust.proxies.tabTest',      icon: Eye },
  { id: 'speed-test', labelKey: 'cust.proxies.tabSpeed',     icon: Gauge },
  { id: 'blacklist',  labelKey: 'cust.proxies.tabBlacklist', icon: ShieldAlert },
  { id: 'ip-info',    labelKey: 'cust.proxies.tabIpInfo',    icon: Globe },
  { id: 'ping',       labelKey: 'cust.proxies.tabPing',      icon: Radio },
  { id: 'creds',      labelKey: 'cust.proxies.tabCreds',     icon: KeyRound },
  { id: 'tags',       labelKey: 'cust.proxies.tabTags',      icon: Tag },
  { id: 'delete',     labelKey: 'cust.proxies.tabDelete',    icon: Trash2, danger: true }
]
function activeTab(gid) { return activeTabByGroup[gid] || 'list' }
function selectTab(g, tabId) {
  // No auto-run — user clicks "Chạy check" inside the tab to start.
  activeTabByGroup[g.id] = tabId
}
const bkKey = (gid, tool, pid) => `${gid}|${tool}|${pid}`
const bkStartKey = (gid, tool) => `${gid}|${tool}|started`
const bkProgressKey = (gid, tool) => `${gid}|${tool}|progress`

function bkResult(gid, tool, pid) { return batchResults[bkKey(gid, tool, pid)] }
function bkIsBusy(gid, tool, pid) { return batchBusy[bkKey(gid, tool, pid)] }
function isBatchStarted(gid, tool) { return !!batchResults[bkStartKey(gid, tool)] }
function batchProgress(gid, tool) { return batchResults[bkProgressKey(gid, tool)] || { done: 0, total: 0 } }
function isBatchRunning(g, tool) {
  return g.proxies.some((p) => bkIsBusy(g.id, tool, p.id))
}

// Always sequential — gives clear progress and avoids rate-limit issues.
async function startBatchTool(g, tool) {
  if (isBatchRunning(g, tool)) return
  batchResults[bkStartKey(g.id, tool)] = true
  batchResults[bkProgressKey(g.id, tool)] = { done: 0, total: g.proxies.length }
  // Pre-mark every proxy as pending (clear previous results)
  for (const p of g.proxies) {
    delete batchResults[bkKey(g.id, tool, p.id)]
    batchBusy[bkKey(g.id, tool, p.id)] = false
  }
  // Run one by one — each row visibly transitions Waiting → Running → Done.
  for (let i = 0; i < g.proxies.length; i++) {
    const p = g.proxies[i]
    const key = bkKey(g.id, tool, p.id)
    batchBusy[key] = true
    try {
      let r
      if (tool === 'test')            r = await apiFetch(`/api/v1/user/proxies/${p.id}/quick-test`, { method: 'POST' })
      else if (tool === 'speed-test') r = await apiFetch('/api/v1/user/tools/speed-test', { method: 'POST', body: { proxyId: p.id, country: 'VN', isp: 'auto' } })
      else if (tool === 'blacklist')  r = await apiFetch('/api/v1/user/tools/blacklist', { method: 'POST', body: { ip: p.bindIp } })
      else if (tool === 'ip-info')    r = await apiFetch('/api/v1/user/tools/ip-info', { method: 'POST', body: { ip: p.bindIp } })
      else if (tool === 'ping')       r = await apiFetch('/api/v1/user/tools/ping', { method: 'POST', body: { ip: p.bindIp, count: 4 } })
      batchResults[key] = r
    } catch (e) {
      batchResults[key] = { error: e.data?.error || e.message }
    } finally {
      batchBusy[key] = false
      batchResults[bkProgressKey(g.id, tool)] = { done: i + 1, total: g.proxies.length }
    }
  }
}
function resetBatch(g, tool) {
  delete batchResults[bkStartKey(g.id, tool)]
  delete batchResults[bkProgressKey(g.id, tool)]
  for (const p of g.proxies) {
    delete batchResults[bkKey(g.id, tool, p.id)]
    batchBusy[bkKey(g.id, tool, p.id)] = false
  }
}

// ── Single-IP tools (test / blacklist / ping) — chip picker + result ──
const singleToolProxy  = reactive({}) // `${gid}|${tool}` -> proxy id
const singleToolBusy   = reactive({}) // `${gid}|${tool}|${pid}` -> bool
const singleToolResult = reactive({}) // `${gid}|${tool}|${pid}` -> result

function stKey(gid, tool) { return `${gid}|${tool}` }
function stResKey(gid, tool, pid) { return `${gid}|${tool}|${pid}` }
function pickedProxy(g, tool) {
  return singleToolProxy[stKey(g.id, tool)] || (g.proxies[0] && g.proxies[0].id)
}
function setPickedProxy(g, tool, pid) { singleToolProxy[stKey(g.id, tool)] = pid }

async function runSingleTool(g, tool) {
  const pid = pickedProxy(g, tool)
  if (!pid) return
  const p = g.proxies.find((x) => x.id === pid)
  if (!p) return
  const rkey = stResKey(g.id, tool, pid)
  singleToolBusy[rkey] = true
  delete singleToolResult[rkey]
  try {
    let r
    if (tool === 'test')            r = await apiFetch(`/api/v1/user/proxies/${pid}/quick-test`, { method: 'POST' })
    else if (tool === 'blacklist')  r = await apiFetch('/api/v1/user/tools/blacklist', { method: 'POST', body: { ip: p.bindIp } })
    else if (tool === 'ping')       r = await apiFetch('/api/v1/user/tools/ping', { method: 'POST', body: { ip: p.bindIp, count: 4 } })
    singleToolResult[rkey] = r
  } catch (e) {
    singleToolResult[rkey] = { error: e.data?.error || e.message }
  } finally {
    singleToolBusy[rkey] = false
  }
}
function singleResult(g, tool) {
  const pid = pickedProxy(g, tool)
  return pid ? singleToolResult[stResKey(g.id, tool, pid)] : null
}
function singleBusy(g, tool) {
  const pid = pickedProxy(g, tool)
  return pid ? !!singleToolBusy[stResKey(g.id, tool, pid)] : false
}

// ── Speed test tab — picker (proxy + country + ISP) + gauge animation ──
const SPEEDTEST_COUNTRIES = [
  { code: 'VN', name: 'Vietnam' }, { code: 'US', name: 'United States' },
  { code: 'SG', name: 'Singapore' }, { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'TH', name: 'Thailand' }, { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' }, { code: 'MY', name: 'Malaysia' },
  { code: 'AU', name: 'Australia' }, { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' }
]
const speedTestProxy   = reactive({}) // groupId -> proxy id
const speedTestCountry = reactive({}) // groupId -> country code (default 'VN')
const speedTestIsp     = reactive({}) // groupId -> isp string
const speedTestIspsCache = reactive({}) // country -> [{ sponsor, serverCount }]
const speedTestIspsBusy  = reactive({}) // country -> boolean
const speedTestRunning = reactive({}) // groupId -> boolean
const speedTestResult  = reactive({}) // groupId -> result
const speedTestPhase   = reactive({}) // groupId -> 'idle' | 'download' | 'upload' | 'done'
const speedTestGauge   = reactive({}) // groupId -> current animated mbps value
let gaugeAnimTimers = {}              // groupId -> interval handle

async function loadIspList(country) {
  if (speedTestIspsCache[country]) return
  speedTestIspsBusy[country] = true
  try {
    const r = await apiFetch(`/api/v1/user/tools/speedtest-isps?country=${country}`)
    speedTestIspsCache[country] = r.isps || []
  } catch { speedTestIspsCache[country] = [] }
  finally { speedTestIspsBusy[country] = false }
}
function setSpeedTestCountry(gid, country) {
  speedTestCountry[gid] = country
  speedTestIsp[gid] = 'auto'
  loadIspList(country)
}
function speedTestInit(g) {
  if (!speedTestProxy[g.id] && g.proxies.length) speedTestProxy[g.id] = g.proxies[0].id
  if (!speedTestCountry[g.id]) speedTestCountry[g.id] = 'VN'
  if (speedTestIsp[g.id] === undefined) speedTestIsp[g.id] = 'auto'
  loadIspList(speedTestCountry[g.id])
}
async function runSpeedTest(g) {
  if (speedTestRunning[g.id]) return
  const pid = speedTestProxy[g.id]
  if (!pid) return
  speedTestRunning[g.id] = true
  speedTestResult[g.id] = null
  speedTestPhase[g.id] = 'download'
  speedTestGauge[g.id] = 0
  // Animate gauge ramp up — easing curve simulating real test
  const startTime = Date.now()
  const animate = () => {
    const elapsed = Date.now() - startTime
    if (elapsed < 15000) {
      // Download phase — ramp 0..100 then oscillate near 80-95
      const t = elapsed / 15000
      const base = 100 * (1 - Math.exp(-3 * t))
      const noise = (Math.sin(elapsed / 200) + Math.cos(elapsed / 350)) * 5
      speedTestGauge[g.id] = Math.max(0, base + noise)
    } else if (elapsed < 27000) {
      speedTestPhase[g.id] = 'upload'
      const t = (elapsed - 15000) / 12000
      const base = 70 * (1 - Math.exp(-3 * t))
      const noise = (Math.sin(elapsed / 250) + Math.cos(elapsed / 400)) * 4
      speedTestGauge[g.id] = Math.max(0, base + noise)
    }
  }
  gaugeAnimTimers[g.id] = setInterval(animate, 60)
  try {
    const r = await apiFetch('/api/v1/user/tools/speed-test', {
      method: 'POST',
      body: {
        proxyId: pid,
        country: speedTestCountry[g.id],
        isp: speedTestIsp[g.id] || 'auto'
      }
    })
    speedTestResult[g.id] = r
    speedTestPhase[g.id] = 'done'
    speedTestGauge[g.id] = r.downloadMbps || 0
  } catch (e) {
    speedTestResult[g.id] = { error: e.data?.error || e.message }
    speedTestPhase[g.id] = 'done'
  } finally {
    clearInterval(gaugeAnimTimers[g.id])
    speedTestRunning[g.id] = false
  }
}
function resetSpeedTest(g) {
  speedTestResult[g.id] = null
  speedTestPhase[g.id] = 'idle'
  speedTestGauge[g.id] = 0
}
// Convert mbps → angle (-90° to 90° across 180° arc), capped at 1000 Mbps
function gaugeAngle(mbps) {
  const m = Math.min(1000, Math.max(0, mbps || 0))
  // logarithmic scale: 0=−90, 10=−45, 100=0, 1000=90
  const logScaled = m === 0 ? 0 : (Math.log10(m + 1) / Math.log10(1001))
  return -90 + logScaled * 180
}
function gaugeNeedlePath(mbps) {
  const angle = gaugeAngle(mbps) * Math.PI / 180
  const cx = 100, cy = 100, r = 70
  const x = cx + r * Math.sin(angle)
  const y = cy - r * Math.cos(angle)
  return `M ${cx} ${cy} L ${x.toFixed(1)} ${y.toFixed(1)}`
}
function gaugeArc(mbps, color) {
  const endAngle = gaugeAngle(mbps)
  const start = -90 * Math.PI / 180
  const end = endAngle * Math.PI / 180
  const cx = 100, cy = 100, r = 70
  const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start)
  const x2 = cx + r * Math.sin(end),   y2 = cy - r * Math.cos(end)
  const largeArc = (endAngle - (-90)) > 180 ? 1 : 0
  return { x1, y1, x2, y2, largeArc, color }
}
// Watch tab change to init speed test state
watch(() => activeTabByGroup, (next) => {
  for (const [gid, tab] of Object.entries(next)) {
    if (tab !== 'speed-test') continue
    const g = groups.value.find((x) => x.id === gid)
    if (g) speedTestInit(g)
  }
}, { deep: true })

// ── IP info tab — single-IP picker with full key-value table ──────────
const ipInfoSelected = reactive({})   // groupId -> proxy id (the picked IP)
const ipInfoData = reactive({})       // proxy id -> result of /tools/ip-info
const ipInfoBusy = reactive({})       // proxy id -> boolean

async function pickIpInfo(g, p) {
  ipInfoSelected[g.id] = p.id
  if (ipInfoData[p.id]) return  // cached
  ipInfoBusy[p.id] = true
  try {
    const r = await apiFetch('/api/v1/user/tools/ip-info', {
      method: 'POST',
      body: { ip: p.bindIp }
    })
    ipInfoData[p.id] = r
  } catch (e) {
    ipInfoData[p.id] = { error: e.data?.error || e.message }
  } finally {
    ipInfoBusy[p.id] = false
  }
}
async function refreshIpInfo(g) {
  const pid = ipInfoSelected[g.id]
  if (!pid) return
  delete ipInfoData[pid]
  const p = g.proxies.find((x) => x.id === pid)
  if (p) await pickIpInfo(g, p)
}
// Auto-select first proxy when ip-info tab opens
watch(() => activeTabByGroup, (next) => {
  for (const [gid, tab] of Object.entries(next)) {
    if (tab !== 'ip-info') continue
    if (ipInfoSelected[gid]) continue
    const g = groups.value.find((x) => x.id === gid)
    if (g && g.proxies.length) pickIpInfo(g, g.proxies[0])
  }
}, { deep: true })

// Common tags across all proxies in a group (intersection).
function commonTags(g) {
  if (!g.proxies.length) return []
  const sets = g.proxies.map((p) => new Set(p.tags || []))
  const first = [...sets[0]]
  return first.filter((tag) => sets.every((s) => s.has(tag)))
}
async function addBulkTag(g) {
  const tag = (bulkTagDraft[g.id] || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!tag) return
  for (const p of g.proxies) {
    const next = [...new Set([...(p.tags || []), tag])].slice(0, 10)
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
    p.tags = next
  }
  bulkTagDraft[g.id] = ''
}
async function removeBulkTag(g, tag) {
  for (const p of g.proxies) {
    const next = (p.tags || []).filter((x) => x !== tag)
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
    p.tags = next
  }
}

// ── Activity timeline ──────────────────────────────────────────────────
async function openTimeline(g) {
  timelineModal.value = g
  timelineEvents.value = []
  try {
    const all = await Promise.all(g.proxies.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/activity?limit=20`).catch(() => ({ events: [] }))))
    const merged = []
    for (const r of all) for (const ev of (r.events || [])) merged.push(ev)
    merged.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    timelineEvents.value = merged.slice(0, 100)
  } catch { /* noop */ }
}
function closeTimeline() { timelineModal.value = null; timelineEvents.value = [] }

// ── Auto-rotate / auto-renew settings ──────────────────────────────────
async function setRotateInterval(g, sec) {
  try {
    for (const p of g.proxies) {
      if (p.type !== 'IPv6') continue
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { rotateEverySec: Number(sec) } })
      p.rotateEverySec = Number(sec)
    }
    flash.value = sec > 0 ? t('cust.proxies.rotateOn', { m: Math.round(sec / 60) }) : t('cust.proxies.rotateOff')
    setTimeout(() => { flash.value = '' }, 2000)
  } catch (e) { err.value = e.message }
}
async function toggleAutoRenew(g) {
  const target = !g.proxies.every((p) => p.autoRenew)
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { autoRenew: target } })
      p.autoRenew = target
    }
    flash.value = target ? t('cust.proxies.autoRenewOn') : t('cust.proxies.autoRenewOff')
    setTimeout(() => { flash.value = '' }, 2000)
  } catch (e) { err.value = e.message }
}

// ── Tags ───────────────────────────────────────────────────────────────
function openTagEdit(p) { tagEditing.value = p.id; tagDraft.value = '' }
function cancelTagEdit() { tagEditing.value = ''; tagDraft.value = '' }
async function addTag(p) {
  const tag = tagDraft.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!tag) return
  const next = [...new Set([...(p.tags || []), tag])].slice(0, 10)
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
    p.tags = next; tagDraft.value = ''
  } catch (e) { err.value = e.message }
}
async function removeTag(p, tag) {
  const next = (p.tags || []).filter((t) => t !== tag)
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
    p.tags = next
  } catch (e) { err.value = e.message }
}
const allTags = computed(() => {
  const set = new Set()
  for (const p of list.value) for (const t of (p.tags || [])) set.add(t)
  return [...set].sort()
})

// Override filteredGroups to honour tag filter + add "failed" status pseudo.
const filteredGroupsV2 = computed(() => groups.value.filter((g) => {
  // Detail mode: lock to a single orderId, ignore other filters.
  if (isDetailMode.value) return g.orderId === orderIdParam.value
  if (filterType.value !== 'all' && (g.type || '').toLowerCase() !== filterType.value) return false
  const st = groupStatus(g)
  if (filterStatus.value === 'failed') {
    if (!g.proxies.some((p) => p.lastCheckOk === false)) return false
  } else if (filterStatus.value !== 'all' && st !== filterStatus.value) return false
  if (filterTag.value && !g.proxies.some((p) => (p.tags || []).includes(filterTag.value))) return false
  if (search.value) {
    const q = search.value.toLowerCase()
    if (!g.proxies.some((p) => `${p.bindIp} ${p.port} ${p.username} ${g.orderId || ''} ${p.label || ''} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q))) return false
  }
  return true
}))

// ── Whitelist with notes ───────────────────────────────────────────────
const whitelistNotes = reactive({})  // groupId -> { ip: note }
function ensureNotesFor(g) {
  if (!whitelistNotes[g.id]) {
    whitelistNotes[g.id] = {}
    // Merge any per-proxy notes
    for (const p of g.proxies) {
      for (const [ip, note] of Object.entries(p.allowedSrcIpNotes || {})) {
        whitelistNotes[g.id][ip] = note
      }
    }
  }
  return whitelistNotes[g.id]
}
async function saveWhitelistNote(g, ip, note) {
  ensureNotesFor(g)[ip] = String(note || '').slice(0, 32)
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}/whitelist`, {
        method: 'PUT',
        body: { allowedSrcIps: (p.allowedSrcIps || []), notes: whitelistNotes[g.id] }
      })
      p.allowedSrcIpNotes = { ...whitelistNotes[g.id] }
    }
  } catch (e) { err.value = e.message }
}

async function ensureDetailExpanded() {
  if (!isDetailMode.value) return
  // Find the matching group, then trigger eager load of stats + sparklines.
  const g = groups.value.find((x) => x.orderId === orderIdParam.value)
  if (!g) return
  expanded.value = new Set([g.id])
  await loadGroupStats(g)
  for (const p of g.proxies) loadSpark(p.id)
}
watch(groups, ensureDetailExpanded)

onMounted(async () => {
  applyQueryFilter()
  await refresh()
  await ensureDetailExpanded()
  // Live countdown — tick nowMs every second so expiry timers refresh.
  countdownTimer = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => { if (countdownTimer) clearInterval(countdownTimer) })
</script>

<template>
  <Transition name="flash">
    <div v-if="flashMsg" class="flash-toast">{{ flashMsg }}</div>
  </Transition>
  <!-- Detail mode: back button + focused title -->
  <div v-if="isDetailMode" style="margin-bottom: 14px; display: flex; align-items: center; gap: 12px">
    <button class="ghost-button" type="button" @click="router.push({ name: 'proxies' })">
      <ArrowLeft :size="13" /> {{ t('cust.proxies.back') }}
    </button>
    <h1 style="margin: 0">
      <span style="color:var(--muted); font-weight:500; font-size:0.7em">{{ t('cust.proxies.titleFull') }} /</span>
      <span class="cell-mono" style="margin-left:6px">{{ orderIdParam }}</span>
    </h1>
  </div>

  <template v-else>
    <h1>{{ t('cust.proxies.titleFull') }}</h1>
    <p class="sub">{{ t('cust.proxies.subtitle') }}</p>
  </template>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" class="success-text">{{ flash }}</p>

  <!-- KPI row (hidden in single-order detail mode) -->
  <div v-if="!isDetailMode" class="kpi-row">
    <div class="kpi-card-v2">
      <span class="ico purple"><Layers :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.proxies.kpiTotal') }}</span>
        <span class="val">{{ counts.total }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico green"><ShieldCheck :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.proxies.kpiActive') }}</span>
        <span class="val">{{ counts.active }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico amber"><Clock :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.proxies.kpiExpiring') }}</span>
        <span class="val">{{ counts.expiring }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico rose"><AlertOctagon :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.proxies.kpiExpired') }}</span>
        <span class="val">{{ counts.expired }}</span>
      </div>
    </div>
  </div>

  <!-- Filters (hidden in single-order detail mode) -->
  <div v-if="!isDetailMode" class="filter-bar">
    <div class="search-wrap">
      <Search :size="14" />
      <input v-model="search" type="search" :placeholder="t('cust.proxies.searchPh')" />
    </div>
    <select v-model="filterType" class="filter-select">
      <option value="all">{{ t('cust.proxies.typeAll') }}</option>
      <option value="ipv4">IPv4</option>
      <option value="ipv6">IPv6</option>
    </select>
    <select v-model="filterStatus" class="filter-select">
      <option value="all">{{ t('cust.proxies.statusAll') }}</option>
      <option value="active">{{ t('cust.proxies.statusActive') }}</option>
      <option value="expiring">{{ t('cust.proxies.statusExpiring') }}</option>
      <option value="expired">{{ t('cust.proxies.statusExpired') }}</option>
      <option value="failed">{{ t('cust.proxies.statusFailed') }}</option>
    </select>
    <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /> {{ t('cust.refresh') }}</button>
    <div style="flex:1"></div>
    <button class="primary-action small" type="button" @click="router.push({ name: 'buy' })">
      <Plus :size="14" /> {{ t('cust.product.buy') }}
    </button>
  </div>

  <!-- Tag filter bar -->
  <div v-if="allTags.length" class="tag-bar">
    <Tag :size="12" style="color:var(--muted)" />
    <span class="tag-bar-label">{{ t('cust.proxies.tagFilter') }}:</span>
    <button class="tag-chip" :class="{ active: !filterTag }" @click="filterTag = ''">{{ t('cust.proxies.tagAll') }}</button>
    <button v-for="t in allTags" :key="t" class="tag-chip" :class="{ active: filterTag === t }" @click="filterTag = filterTag === t ? '' : t">
      #{{ t }}
    </button>
  </div>

  <!-- Empty state -->
  <section v-if="!filteredGroupsV2.length" class="surface" style="padding:32px; text-align:center">
    <p class="empty-text">{{ t('cust.proxies.empty') }}</p>
    <button class="primary-action small" type="button" style="margin-top:10px" @click="router.push({ name: 'buy' })">
      <Plus :size="14" /> {{ t('cust.product.buy') }}
    </button>
  </section>

  <!-- Group cards -->
  <section v-for="g in filteredGroupsV2" :key="g.id" class="surface group-card">
    <header class="group-head">
      <button
        type="button"
        class="cbx"
        :class="{ checked: isGroupAllSelected(g) }"
        :title="t('cust.proxies.selectAllGroup')"
        @click="toggleGroupSel(g)"
      >
        <Check :size="12" />
      </button>
      <button class="group-toggle" type="button" @click="toggleGroupExpanded(g)">
        <ChevronUp v-if="isExpanded(g.id)" :size="14" />
        <ChevronDown v-else :size="14" />
      </button>
      <div class="group-id">
        <strong v-if="g.orderId" class="cell-mono">{{ g.orderId }}</strong>
        <strong v-else class="cell-mono">{{ g.proxies[0]?.id }}</strong>
        <span class="group-sub">{{ fmtTs(g.createdAt) }}</span>
      </div>
      <!-- Group label (editable). Click pencil to edit; all proxies in the group share the label. -->
      <span class="group-label">
        <template v-if="labelEditing === ('grp-' + g.id)">
          <input v-model="labelDraft" maxlength="64" :placeholder="t('cust.proxies.labelPh')" @keydown.enter="saveGroupLabel(g)" @keydown.esc="cancelLabelEdit" />
          <button class="icon-btn small" type="button" @click="saveGroupLabel(g)"><Check :size="11" /></button>
          <button class="icon-btn small" type="button" @click="cancelLabelEdit"><X :size="11" /></button>
        </template>
        <template v-else>
          <strong v-if="groupLabel(g)" class="label-text">{{ groupLabel(g) }}</strong>
          <span v-else class="label-empty">{{ t('cust.proxies.labelEmpty') }}</span>
          <button class="icon-btn small" type="button" @click="labelEditing = 'grp-' + g.id; labelDraft = groupLabel(g)">
            <Pencil :size="11" />
          </button>
        </template>
      </span>
      <span class="tag" :class="'tag-fam-' + (g.type || 'ipv4').toLowerCase()">{{ g.type }}</span>
      <span class="group-count">
        <Layers :size="13" /> {{ g.proxies.length }} {{ t('cust.buy.proxyUnit') }}
      </span>
      <span class="group-zone">
        <CountryFlag v-if="g.country" :code="g.country" :size="14" />
        {{ g.zone || '—' }}
      </span>
      <span class="group-exp">
        <Clock :size="13" /> <span :class="['countdown-live', fmtCountdown(g.expiresAt).tier]">{{ fmtCountdown(g.expiresAt).text }}</span>
      </span>
      <span v-if="groupStatus(g) === 'expired'" class="status-pill expired">{{ statusLabel('expired') }}</span>
      <span v-else-if="groupStatus(g) === 'mixed'" class="status-pill mixed">{{ statusLabel('mixed') }}</span>
      <span v-else class="status-pill active">{{ statusLabel('active') }}</span>
      <RouterLink
        v-if="!isDetailMode && g.orderId"
        :to="{ name: 'proxy-order', params: { orderId: g.orderId } }"
        class="group-view-btn"
        :title="t('cust.proxies.viewDetail')"
      >
        <ExternalLink :size="12" /> {{ t('cust.proxies.view') }}
      </RouterLink>
    </header>

    <!-- Quick action row, always visible -->
    <div class="group-actions">
      <button class="action-pill" type="button" :disabled="busy[g.id]" @click="copyGroup(g, 'colon')">
        <Copy :size="12" /> {{ t('cust.proxies.copy') }}
      </button>
      <div class="export-wrap">
        <button class="action-pill" type="button" @click="exportMenuOpen = exportMenuOpen === g.id ? '' : g.id">
          <Download :size="12" /> {{ t('cust.proxies.export') }} <ChevronDown :size="10" />
        </button>
        <div v-if="exportMenuOpen === g.id" class="export-menu" @click.stop>
          <button type="button" @click="copyFormat(g, 'colon')"><Copy :size="11" /> {{ t('cust.proxies.fmtColon') }}</button>
          <button type="button" @click="copyFormat(g, 'url-http')"><Copy :size="11" /> {{ t('cust.proxies.fmtUrlHttp') }}</button>
          <button type="button" @click="copyFormat(g, 'url-socks5')"><Copy :size="11" /> {{ t('cust.proxies.fmtUrlSocks5') }}</button>
          <button type="button" @click="copyFormat(g, 'curl')"><Terminal :size="11" /> {{ t('cust.proxies.fmtCurl') }}</button>
          <div class="export-sep">{{ t('cust.proxies.download') }}</div>
          <button type="button" @click="exportFormat(g, 'colon')"><Download :size="11" /> TXT</button>
          <button type="button" @click="exportFormat(g, 'env')"><Download :size="11" /> .env</button>
          <button type="button" @click="exportFormat(g, 'json')"><Download :size="11" /> JSON</button>
          <button type="button" @click="exportFormat(g, 'switchyomega')"><Download :size="11" /> SwitchyOmega .pac</button>
          <button type="button" @click="exportFormat(g, 'foxyproxy')"><Download :size="11" /> FoxyProxy .xml</button>
        </div>
      </div>
      <button class="action-pill" type="button" :disabled="busy[g.id]" @click="checkGroup(g)">
        <ShieldCheck :size="12" />
        <span v-if="busy[g.id] === 'check'">...</span>
        <span v-else>{{ t('cust.proxies.checkLive') }}</span>
      </button>
      <button class="action-pill" type="button" @click="openWhitelist(g.id)">
        <Zap :size="12" /> {{ t('cust.proxies.ipAuth') }}
        <span v-if="groupWhitelist(g).length" class="pill-count">{{ groupWhitelist(g).length }}</span>
      </button>
      <span :class="['countdown-big', fmtCountdown(g.expiresAt).tier]" :title="t('cust.proxies.expiresAtTitle') + fmtTs(g.expiresAt)">
        <Clock :size="12" />
        <small>{{ t('cust.proxies.remaining') }}</small>
        <strong>{{ fmtCountdown(g.expiresAt).text }}</strong>
      </span>
      <div class="extend-inline">
        <input v-model.number="extendHours[g.id]" type="number" min="1" max="8760" :placeholder="'24h'" />
        <button class="action-pill primary" type="button" :disabled="busy[g.id]" @click="extendGroup(g)">
          <RotateCw :size="12" />
          {{ busy[g.id] === 'extend' ? '...' : t('cust.proxies.extend') }}
        </button>
      </div>
      <button v-if="g.type === 'IPv6'" class="action-pill" type="button" :title="t('cust.proxies.rotateSchedHint')" style="position:relative">
        <Timer :size="12" />
        <select :value="g.proxies[0]?.rotateEverySec || 0" @change="setRotateInterval(g, $event.target.value)" class="inline-select">
          <option :value="0">{{ t('cust.proxies.rotateOff2') }}</option>
          <option :value="60">1m</option>
          <option :value="180">3m</option>
          <option :value="300">5m</option>
          <option :value="600">10m</option>
          <option :value="900">15m</option>
          <option :value="1800">30m</option>
          <option :value="3600">1h</option>
          <option :value="7200">2h</option>
        </select>
      </button>
      <!-- IPv6 only: bulk copy + download of the magic rotate URLs for
           this group. Hidden for IPv4 (v4 proxies don't expose a rotate
           URL — egress IP is fixed). -->
      <button v-if="g.type === 'IPv6'" class="action-pill" type="button"
              :title="t('cust.proxies.copyRotateUrlsHint') || 'Copy tất cả URL đổi IP cho nhóm này'"
              @click="copyGroupRotateUrls(g)">
        <Copy :size="12" /> {{ t('cust.proxies.copyRotateUrls') || 'Copy URL đổi IP' }}
      </button>
      <button v-if="g.type === 'IPv6'" class="action-pill" type="button"
              :title="t('cust.proxies.downloadRotateUrlsHint') || 'Tải file .txt chứa tất cả URL đổi IP'"
              @click="downloadGroupRotateUrls(g)">
        <Download :size="12" /> {{ t('cust.proxies.downloadRotateUrls') || 'Tải URL đổi IP (.txt)' }}
      </button>
      <button class="action-pill" type="button" :class="{ primary: g.proxies.every((p) => p.autoRenew) }" @click="toggleAutoRenew(g)">
        <RotateCw :size="12" /> {{ g.proxies.every((p) => p.autoRenew) ? t('cust.proxies.autoRenewOn2') : t('cust.proxies.autoRenewToggle') }}
      </button>
      <button class="action-pill" type="button" @click="openTimeline(g)">
        <ListChecks :size="12" /> {{ t('cust.proxies.timeline') }}
      </button>
      <button class="action-pill danger" type="button" :disabled="busy[g.id]" @click="deleteGroup(g)">
        <Trash2 :size="12" />
        {{ busy[g.id] === 'delete' ? '...' : t('cust.proxies.deleteGroup') }}
      </button>
    </div>

    <!-- Quick stats (loaded lazily when group is expanded) -->
    <div v-if="isExpanded(g.id) && statsData[g.id]" class="quick-stats">
      <div class="qs-cell">
        <span class="qs-lbl">{{ t('cust.proxies.statsBandwidth') }}</span>
        <span class="qs-val">{{ fmtBytes(statsData[g.id].bandwidth) }}</span>
        <span class="qs-sub">{{ t('cust.proxies.stats30d') }}</span>
      </div>
      <div class="qs-cell">
        <span class="qs-lbl">{{ t('cust.proxies.statsUptime') }}</span>
        <span class="qs-val">{{ statsData[g.id].uptime !== null ? statsData[g.id].uptime.toFixed(1) + '%' : '—' }}</span>
        <span class="qs-sub">{{ t('cust.proxies.stats7d') }}</span>
      </div>
      <div class="qs-cell">
        <span class="qs-lbl">{{ t('cust.proxies.statsLatency') }}</span>
        <span class="qs-val">{{ statsData[g.id].latency !== null ? statsData[g.id].latency + ' ms' : '—' }}</span>
        <span class="qs-sub">{{ t('cust.proxies.statsAvg') }}</span>
      </div>
    </div>

    <!-- Check live results inline -->
    <div v-if="checkResults[g.id]" class="check-result">
      <ShieldCheck :size="13" />
      {{ t('cust.proxies.checkDone', { ok: checkResults[g.id].ok, fail: checkResults[g.id].fail }) }}
    </div>

    <!-- IP whitelist inline editor -->
    <div v-if="whitelistEditing === g.id" class="whitelist-panel">
      <div class="whitelist-head">
        <strong>{{ t('cust.proxies.ipAuthTitle') }}</strong>
        <button class="close-btn" type="button" @click="closeWhitelist"><X :size="14" /></button>
      </div>
      <p class="whitelist-hint">{{ t('cust.proxies.ipAuthHint') }}</p>
      <div class="whitelist-list">
        <span v-for="ip in groupWhitelist(g)" :key="ip" class="ip-chip">
          <span class="cell-mono">{{ ip }}</span>
          <button class="ip-remove" type="button" @click="removeWhitelistIp(g, ip)"><X :size="11" /></button>
        </span>
        <span v-if="!groupWhitelist(g).length" class="whitelist-empty">{{ t('cust.proxies.ipAuthEmpty') }}</span>
      </div>
      <div class="whitelist-form">
        <input v-model="whitelistInput" type="text" :placeholder="t('cust.proxies.ipAuthPh') + ' — CIDR OK'" @keydown.enter="addWhitelistIp(g)" />
        <button class="action-pill primary" type="button" @click="addWhitelistIp(g)"><Plus :size="12" /> {{ t('cust.proxies.ipAuthAdd') }}</button>
      </div>
    </div>

    <!-- Expanded body: TAB BAR (10%) + CONTENT (90%) for group-wide tools -->
    <div v-if="isExpanded(g.id)" class="group-body">
      <!-- ROW 1: tabs (apply to whole group) -->
      <div class="gt-tabs">
        <button
          v-for="tab in GROUP_TABS"
          :key="tab.id"
          type="button"
          :class="['gt-tab', { active: activeTab(g.id) === tab.id, danger: tab.danger }]"
          @click="selectTab(g, tab.id)"
        >
          <component :is="tab.icon" :size="13" />
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <!-- ROW 2: content (dynamic based on active tab) -->
      <div class="gt-content">

        <!-- ── LIST tab (default): proxy table ── -->
        <template v-if="activeTab(g.id) === 'list'">
          <template v-for="(p, idx) in g.proxies" :key="p.id">
            <div class="gt-row" :class="{ 'is-selected': isSelected(p.id), 'is-expanded': expandedProxies.has(p.id) }">
              <button type="button" class="cbx" :class="{ checked: isSelected(p.id) }" @click="toggleProxySel(p.id)">
                <Check :size="11" />
              </button>
              <span class="cell-mono pc-idx">#{{ idx + 1 }}</span>
              <span class="gt-row-label">
                <template v-if="labelEditing === p.id">
                  <input v-model="labelDraft" maxlength="64" :placeholder="t('cust.proxies.labelPh')" @keydown.enter="saveLabel(p)" @keydown.esc="cancelLabelEdit" />
                  <button class="icon-btn small" type="button" @click="saveLabel(p)"><Check :size="11" /></button>
                  <button class="icon-btn small" type="button" @click="cancelLabelEdit"><X :size="11" /></button>
                </template>
                <template v-else>
                  <span v-if="p.label" class="label-text">{{ p.label }}</span>
                  <button class="label-add" type="button" @click="openLabelEdit(p)">
                    <Pencil :size="10" /> {{ p.label ? '' : t('cust.proxies.labelEmpty') }}
                  </button>
                </template>
              </span>
              <span class="cell-mono tap-copy" @click="copyText((p.ip || p.bindIp) + ':' + portOf(p), 'Endpoint', $event)">
                <span class="ip-line">{{ p.ip || p.bindIp }}:{{ portOf(p) }}</span>
                <small v-if="p.type === 'IPv6' && p.bindIp && p.bindIp !== p.ip" class="egress-line" :title="p.bindIp">↳ {{ p.bindIp }}</small>
              </span>
              <span class="cell-mono creds tap-copy" @click="copyText(p.username + ':' + p.password, 'user:pass', $event)">{{ p.username }}:{{ p.password }}</span>
              <span class="gt-row-status">
                <span :class="['status-pill', p.status === 'active' ? 'active' : p.status === 'expired' ? 'expired' : 'pending']">{{ p.status }}</span>
              </span>
              <svg v-if="sparkData[p.id]?.down?.length" class="spark" viewBox="0 0 80 18" preserveAspectRatio="none">
                <path :d="sparkPath(sparkData[p.id].down)" fill="none" stroke="var(--blue)" stroke-width="1" />
                <path :d="sparkPath(sparkData[p.id].up)"   fill="none" stroke="var(--green)" stroke-width="1" />
              </svg>
              <span v-else class="spark spark-empty"></span>
              <span class="gt-row-actions">
                <button class="row-act-btn connect-btn" type="button" :title="t('cust.proxies.tipConnect')" @click="toggleProxyExpand(p)">
                  <Link :size="12" />
                  <span>{{ t('cust.proxies.connectLabel') }}</span>
                  <ChevronDown v-if="!expandedProxies.has(p.id)" :size="11" />
                  <ChevronUp v-else :size="11" />
                </button>
                <button v-if="p.type === 'IPv6'" class="row-act-btn rotate-btn" type="button" :title="t('cust.proxies.tipRotate')" :disabled="rotating === p.id" @click="rotateProxy(p)">
                  <RotateCw :size="12" :class="{ spin: rotating === p.id }" />
                  <span>{{ rotating === p.id ? t('cust.proxies.rotating') : t('cust.proxies.rotateIp') }}</span>
                </button>
                <button v-if="p.type === 'IPv6' && p.rotateUrl" class="row-act-btn" type="button" :title="t('cust.proxies.tipCopyRotate') + '\n' + p.rotateUrl" @click="copyRotateUrl(p, $event)">
                  <Link :size="12" />
                  <span>{{ t('cust.proxies.copyRotateUrl') }}</span>
                </button>
                <button class="row-act-btn" type="button" :title="t('cust.proxies.tipCheck')" :disabled="checking === p.id" @click="checkProxy(p)">
                  <RefreshCw :size="12" :class="{ spin: checking === p.id }" />
                  <span>{{ checking === p.id ? 'Checking…' : 'Check' }}</span>
                </button>
              </span>
            </div>
            <div v-if="expandedProxies.has(p.id)" class="gt-row-connect">
              <div class="session-block">
                <div class="session-head" :class="{ full: (p.session?.active||0) >= (p.session?.max||100) }">
                  <ShieldCheck :size="13" />
                  <span>
                    <strong class="cell-mono">{{ p.session?.active ?? 0 }}/{{ p.session?.max ?? 100 }}</strong>
                    {{ t('cust.proxies.activeConns') }}
                    <small>· max <strong>{{ p.session?.max ?? 100 }}/proxy</strong> · <strong>{{ p.session?.maxPerIp ?? 60 }}/IP</strong> · burst <strong>{{ p.session?.rateLimit ?? 30 }}/s/IP</strong>. {{ t('cust.proxies.overCapNote') }}</small>
                  </span>
                  <button class="row-act-btn" type="button" @click="disconnectAllSessions(p)" :title="t('cust.proxies.tipDisconnect')">
                    <RefreshCw :size="12" /> {{ t('cust.proxies.disconnectAll') }}
                  </button>
                </div>
                <div v-if="(p.session?.byIp || []).length" class="session-byip">
                  <div class="byip-title">{{ t('cust.proxies.byIpTitle') }}</div>
                  <div class="byip-list">
                    <div v-for="row in (p.session?.byIp || [])" :key="row.ip" class="byip-row" :class="{ near: row.count >= (p.session?.maxPerIp || 60) * 0.8 }">
                      <code>{{ row.ip }}</code>
                      <span class="byip-count"><strong>{{ row.count }}</strong>/{{ p.session?.maxPerIp ?? 60 }}</span>
                      <div class="byip-bar"><span :style="{ width: ((row.count / (p.session?.maxPerIp || 60)) * 100) + '%' }"></span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="trojan-feature">
                <div class="trojan-qr-wrap">
                  <div class="trojan-qr" v-html="qrSvg(p.connectUrls?.trojan, 200)"></div>
                  <button class="row-act-btn" type="button" @click="downloadQr(p.connectUrls?.trojan, 'trojan-'+p.id)">
                    <Download :size="12" /> Download QR
                  </button>
                </div>
                <div class="trojan-info">
                  <div class="trojan-title">
                    <strong>Trojan</strong>
                    <span class="cell-mono trojan-port">:{{ p.tlsPort }}</span>
                  </div>
                  <p class="trojan-apps">v2rayN (Win) • v2rayNG (Android) • Shadowrocket (iOS) • Clash Verge (Mac) • Hiddify</p>
                  <p class="trojan-note">{{ t('cust.proxies.trojanNote') }}</p>
                  <div class="trojan-url">
                    <code>{{ p.connectUrls?.trojan }}</code>
                    <button class="row-act-btn" @click="copyText(p.connectUrls?.trojan, 'Trojan')"><Copy :size="12" /> Copy URL</button>
                  </div>
                </div>
              </div>
              <div class="proto-list">
                <div class="proto-row">
                  <span class="proto-tag">HTTP</span>
                  <code class="proto-url">{{ p.connectUrls?.http }}</code>
                  <button class="row-act-btn" @click="copyText(p.connectUrls?.http, 'HTTP')"><Copy :size="12" /> Copy</button>
                  <button class="row-act-btn proto-qr-btn" :title="'Show QR for HTTP'" @click="openQrModal(p.connectUrls?.http, 'HTTP-'+p.id)"><QrCode :size="12" /></button>
                </div>
                <div class="proto-row">
                  <span class="proto-tag">SOCKS5</span>
                  <code class="proto-url">{{ p.connectUrls?.socks5h }}</code>
                  <button class="row-act-btn" @click="copyText(p.connectUrls?.socks5h, 'SOCKS5')"><Copy :size="12" /> Copy</button>
                  <button class="row-act-btn proto-qr-btn" :title="'Show QR for SOCKS5'" @click="openQrModal(p.connectUrls?.socks5h, 'SOCKS5-'+p.id)"><QrCode :size="12" /></button>
                </div>
                <div class="proto-row">
                  <span class="proto-tag">HTTPS proxy</span>
                  <code class="proto-url">{{ p.connectUrls?.httpsProxy }}</code>
                  <button class="row-act-btn" @click="copyText(p.connectUrls?.httpsProxy, 'HTTPS proxy')"><Copy :size="12" /> Copy</button>
                  <button class="row-act-btn proto-qr-btn" :title="'Show QR for HTTPS proxy'" @click="openQrModal(p.connectUrls?.httpsProxy, 'HTTPSproxy-'+p.id)"><QrCode :size="12" /></button>
                </div>
              </div>
            </div>
          </template>
        </template>

        <!-- ── COPY tab ── -->
        <template v-else-if="activeTab(g.id) === 'copy'">
          <p class="gt-hint">{{ t('cust.proxies.tabCopyHint', { n: g.proxies.length }) }}</p>
          <div class="gt-grid">
            <button class="pc-btn" type="button" @click="copyFormat(g, 'colon')"><Copy :size="12" /> host:port:user:pass</button>
            <button class="pc-btn" type="button" @click="copyFormat(g, 'url-http')"><Copy :size="12" /> http://user:pass@host:port</button>
            <button class="pc-btn" type="button" @click="copyFormat(g, 'url-socks5')"><Copy :size="12" /> socks5://user:pass@host:port</button>
            <button class="pc-btn" type="button" @click="copyFormat(g, 'curl')"><Terminal :size="12" /> cURL command</button>
            <button class="pc-btn" type="button" @click="exportFormat(g, 'colon')"><Download :size="12" /> Download TXT</button>
            <button class="pc-btn" type="button" @click="exportFormat(g, 'env')"><Download :size="12" /> Download .env</button>
            <button class="pc-btn" type="button" @click="exportFormat(g, 'json')"><Download :size="12" /> Download JSON</button>
            <button class="pc-btn" type="button" @click="exportFormat(g, 'switchyomega')"><Download :size="12" /> Download SwitchyOmega .pac</button>
            <button class="pc-btn" type="button" @click="exportFormat(g, 'foxyproxy')"><Download :size="12" /> Download FoxyProxy .xml</button>
          </div>
        </template>

        <!-- ── IP INFO tab: pick one IP, show full key-value table ── -->
        <template v-else-if="activeTab(g.id) === 'ip-info'">
          <p class="gt-hint">{{ t('cust.proxies.ipInfoHint') }}</p>
          <!-- Chip selector: one per proxy -->
          <div class="ipinfo-picker">
            <button
              v-for="p in g.proxies" :key="p.id"
              type="button"
              :class="['ipinfo-chip', { active: ipInfoSelected[g.id] === p.id }]"
              @click="pickIpInfo(g, p)"
            >
              <span v-if="p.label" class="label-text" style="font-size:10.5px; padding:1px 6px">{{ p.label }}</span>
              <span class="cell-mono">{{ p.ip || p.bindIp }}</span>
            </button>
          </div>

          <!-- Result table for the picked proxy -->
          <template v-if="ipInfoSelected[g.id]">
            <div v-if="ipInfoBusy[ipInfoSelected[g.id]]" class="batch-empty">
              <RefreshCw :size="18" class="spin" style="color:var(--green)" />
              <p style="margin-top:8px">{{ t('cust.proxies.toolRunning') }}</p>
            </div>
            <div v-else-if="ipInfoData[ipInfoSelected[g.id]]?.error" class="error-text" style="padding:20px; text-align:center">
              {{ ipInfoData[ipInfoSelected[g.id]].error }}
            </div>
            <div v-else-if="ipInfoData[ipInfoSelected[g.id]]" class="ipinfo-table">
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoIp') }}</span>
                <span class="cell-mono ipinfo-val">{{ ipInfoData[ipInfoSelected[g.id]].ip }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoFamily') }}</span>
                <span class="cell-mono ipinfo-val">{{ (ipInfoData[ipInfoSelected[g.id]].family || '—').toUpperCase() }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoAsn') }}</span>
                <span class="cell-mono ipinfo-val">{{ ipInfoData[ipInfoSelected[g.id]].asn || '—' }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoCidr') }}</span>
                <span class="cell-mono ipinfo-val">{{ ipInfoData[ipInfoSelected[g.id]].cidr || '—' }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoCountry') }}</span>
                <span class="ipinfo-val">
                  <CountryFlag v-if="ipInfoData[ipInfoSelected[g.id]].country && ipInfoData[ipInfoSelected[g.id]].country.length === 2" :code="ipInfoData[ipInfoSelected[g.id]].country" :size="14" />
                  <span class="cell-mono">{{ ipInfoData[ipInfoSelected[g.id]].country || '—' }}</span>
                </span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoRegistry') }}</span>
                <span class="cell-mono ipinfo-val">{{ (ipInfoData[ipInfoSelected[g.id]].registry || '—').toUpperCase() }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoAllocDate') }}</span>
                <span class="cell-mono ipinfo-val">{{ ipInfoData[ipInfoSelected[g.id]].allocDate || '—' }}</span>
              </div>
              <div class="ipinfo-row">
                <span class="ipinfo-key">{{ t('cust.proxies.ipInfoOrg') }}</span>
                <span class="cell-mono ipinfo-val ipinfo-val-wrap">{{ ipInfoData[ipInfoSelected[g.id]].org || '—' }}</span>
              </div>
              <div class="ipinfo-actions">
                <button class="ghost-button" type="button" @click="refreshIpInfo(g)"><RefreshCw :size="13" /> {{ t('cust.refresh') }}</button>
              </div>
            </div>
          </template>
        </template>

        <!-- ── SPEED TEST tab: chip picker + country/ISP + animated gauge ── -->
        <template v-else-if="activeTab(g.id) === 'speed-test'">
          <div class="st-controls">
            <!-- Proxy picker -->
            <div class="st-row">
              <label class="st-lbl">{{ t('cust.proxies.stProxy') }}</label>
              <div class="ipinfo-picker" style="margin:0; padding:0; border:none">
                <button
                  v-for="p in g.proxies" :key="p.id"
                  type="button"
                  :class="['ipinfo-chip', { active: speedTestProxy[g.id] === p.id }]"
                  @click="speedTestProxy[g.id] = p.id"
                >
                  <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
                </button>
              </div>
            </div>
            <!-- Country + ISP -->
            <div class="st-row">
              <label class="st-lbl">{{ t('cust.proxies.stCountry') }}</label>
              <select class="filter-select" :value="speedTestCountry[g.id] || 'VN'" @change="setSpeedTestCountry(g.id, $event.target.value)">
                <option v-for="c in SPEEDTEST_COUNTRIES" :key="c.code" :value="c.code">{{ c.name }} ({{ c.code }})</option>
              </select>
              <label class="st-lbl" style="margin-left:12px">{{ t('cust.proxies.stIsp') }}</label>
              <select class="filter-select" :value="speedTestIsp[g.id] || 'auto'" @change="speedTestIsp[g.id] = $event.target.value">
                <option value="auto">{{ t('cust.proxies.stIspAuto') }}</option>
                <option
                  v-for="isp in (speedTestIspsCache[speedTestCountry[g.id] || 'VN'] || [])"
                  :key="isp.sponsor"
                  :value="isp.sponsor.toLowerCase()"
                >
                  {{ isp.sponsor }} ({{ isp.serverCount }} server{{ isp.serverCount > 1 ? 's' : '' }})
                </option>
              </select>
              <span v-if="speedTestIspsBusy[speedTestCountry[g.id] || 'VN']" style="color:var(--muted); font-size:11px">
                <RefreshCw :size="11" class="spin" /> {{ t('cust.proxies.stLoadingIsps') }}
              </span>
            </div>
            <!-- Run -->
            <div class="st-row">
              <button class="primary-action small" type="button" :disabled="speedTestRunning[g.id] || !speedTestProxy[g.id]" @click="runSpeedTest(g)">
                <RefreshCw v-if="speedTestRunning[g.id]" :size="14" class="spin" />
                <Play v-else :size="14" />
                {{ speedTestRunning[g.id]
                    ? (speedTestPhase[g.id] === 'upload' ? t('cust.proxies.stRunningUp') : t('cust.proxies.stRunningDown'))
                    : (speedTestResult[g.id] ? t('cust.proxies.stRerun') : t('cust.proxies.stStart')) }}
              </button>
              <button v-if="speedTestResult[g.id] && !speedTestRunning[g.id]" class="ghost-button" type="button" @click="resetSpeedTest(g)">
                <X :size="13" /> {{ t('cust.proxies.batchReset') }}
              </button>
            </div>
          </div>

          <!-- Modern speedometer gauge (visible while running or after result) -->
          <div v-if="speedTestRunning[g.id] || speedTestResult[g.id]" class="st-gauge-wrap">
            <SpeedGauge
              :value="speedTestGauge[g.id] || 0"
              :max="null"
              :status="speedTestRunning[g.id] ? 'running' : (speedTestResult[g.id]?.error ? 'error' : speedTestResult[g.id] ? 'done' : 'idle')"
              :label="speedTestRunning[g.id]
                ? (speedTestPhase[g.id] === 'upload' ? t('cust.proxies.stPhaseUpload') : t('cust.proxies.stPhaseDownload'))
                : (speedTestResult[g.id]?.error || (speedTestResult[g.id] ? t('cust.proxies.stDone') : ''))"
              :size="260"
            />
          </div>

          <!-- Result cards (ping, download, upload, server) -->
          <div v-if="speedTestResult[g.id] && !speedTestResult[g.id].error" class="st-result">
            <div class="st-metric">
              <span class="st-mlbl">{{ t('cust.proxies.stPing') }}</span>
              <span class="st-mval">{{ speedTestResult[g.id].pingMs }}<small>ms</small></span>
            </div>
            <div class="st-metric down">
              <span class="st-mlbl">{{ t('cust.proxies.stDownload') }}</span>
              <span class="st-mval">{{ (speedTestResult[g.id].downloadMbps || 0).toFixed(2) }}<small>Mbps</small></span>
            </div>
            <div class="st-metric up">
              <span class="st-mlbl">{{ t('cust.proxies.stUpload') }}</span>
              <span class="st-mval">{{ (speedTestResult[g.id].uploadMbps || 0).toFixed(2) }}<small>Mbps</small></span>
            </div>
            <div class="st-metric" style="grid-column:1/-1">
              <span class="st-mlbl">{{ t('cust.proxies.stServer') }}</span>
              <span class="cell-mono" style="font-size:12px">
                {{ speedTestResult[g.id].server?.sponsor }} · {{ speedTestResult[g.id].server?.name }} · {{ speedTestResult[g.id].server?.country }}
              </span>
            </div>
          </div>
        </template>

        <!-- ── Single-IP tool tabs (test / blacklist / ping) ── -->
        <template v-else-if="['test','blacklist','ping'].includes(activeTab(g.id))">
          <p class="gt-hint">{{ t('cust.proxies.singlePickHint') }}</p>
          <!-- Proxy chip picker -->
          <div class="ipinfo-picker">
            <button
              v-for="p in g.proxies" :key="p.id"
              type="button"
              :class="['ipinfo-chip', { active: pickedProxy(g, activeTab(g.id)) === p.id }]"
              @click="setPickedProxy(g, activeTab(g.id), p.id)"
            >
              <span v-if="p.label" class="label-text" style="font-size:10.5px; padding:1px 6px">{{ p.label }}</span>
              <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
            </button>
          </div>

          <!-- Run button -->
          <div class="batch-controls" style="margin-bottom:14px">
            <button
              class="primary-action small"
              type="button"
              :disabled="singleBusy(g, activeTab(g.id)) || !pickedProxy(g, activeTab(g.id))"
              @click="runSingleTool(g, activeTab(g.id))"
            >
              <RefreshCw v-if="singleBusy(g, activeTab(g.id))" :size="13" class="spin" />
              <Play v-else :size="13" />
              {{ singleBusy(g, activeTab(g.id))
                  ? t('cust.proxies.batchRowRunning')
                  : singleResult(g, activeTab(g.id))
                    ? t('cust.proxies.batchRerun')
                    : t('cust.proxies.singleRun') }}
            </button>
          </div>

          <!-- Result (only the picked proxy) -->
          <div v-if="singleBusy(g, activeTab(g.id))" class="batch-empty">
            <RefreshCw :size="18" class="spin" style="color:var(--green)" />
            <p style="margin-top:8px">{{ t('cust.proxies.toolRunning') }}</p>
          </div>
          <div v-else-if="singleResult(g, activeTab(g.id))?.error" class="error-text" style="padding:20px; text-align:center">
            {{ singleResult(g, activeTab(g.id)).error }}
          </div>

          <!-- TEST result (full info) -->
          <div v-else-if="activeTab(g.id) === 'test' && singleResult(g, 'test')" class="ipinfo-table">
            <div class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.testStatus') }}</span>
              <span class="ipinfo-val">
                <span :class="['status-pill', singleResult(g, 'test').ok ? 'active' : 'expired']">{{ singleResult(g, 'test').ok ? 'OK' : 'FAIL' }}</span>
              </span>
            </div>
            <div class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.testExitIp') }}</span>
              <span class="ipinfo-val cell-mono">{{ singleResult(g, 'test').exitIp || '—' }}</span>
            </div>
            <div class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.testLatency') }}</span>
              <span class="ipinfo-val cell-mono">{{ singleResult(g, 'test').latencyMs }} ms</span>
            </div>
          </div>

          <!-- BLACKLIST result (summary card + DNSBL list) -->
          <div v-else-if="activeTab(g.id) === 'blacklist' && singleResult(g, 'blacklist')" class="tool-result" style="padding:0">
            <div :class="['blsum', singleResult(g, 'blacklist').listed > 0 ? 'bad' : 'good']">
              <strong>{{ singleResult(g, 'blacklist').listed }}</strong> / {{ singleResult(g, 'blacklist').total }} {{ t('cust.proxies.toolBlListed') }}
              · <span style="font-size:13px">{{ singleResult(g, 'blacklist').clean }} clean · {{ singleResult(g, 'blacklist').errors }} errors</span>
            </div>
            <div class="bl-list">
              <div v-for="r in singleResult(g, 'blacklist').results" :key="r.host" :class="['bl-item', r.listed === true ? 'listed' : r.listed === false ? 'clean' : 'error']">
                <span>{{ r.name }}</span>
                <span class="cell-mono">{{ r.host }}</span>
                <span class="bl-tag">{{ r.listed === true ? t('cust.proxies.toolBlBad') : r.listed === false ? t('cust.proxies.toolBlClean') : 'ERR' }}</span>
              </div>
            </div>
          </div>

          <!-- PING result (full stats + each packet) -->
          <div v-else-if="activeTab(g.id) === 'ping' && singleResult(g, 'ping')" class="ipinfo-table">
            <div class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.pingLoss') }}</span>
              <span class="ipinfo-val">
                <strong :style="{ color: singleResult(g, 'ping').loss === 0 ? 'var(--green)' : singleResult(g, 'ping').loss < 100 ? 'var(--yellow)' : 'var(--red)' }">
                  {{ singleResult(g, 'ping').loss }}%
                </strong>
                <span class="cell-mono" style="margin-left:8px">{{ singleResult(g, 'ping').received }}/{{ singleResult(g, 'ping').transmitted }} packets</span>
              </span>
            </div>
            <div v-if="singleResult(g, 'ping').rtt" class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.pingRttMin') }}</span>
              <span class="ipinfo-val cell-mono">{{ singleResult(g, 'ping').rtt.min.toFixed(2) }} ms</span>
            </div>
            <div v-if="singleResult(g, 'ping').rtt" class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.pingRttAvg') }}</span>
              <span class="ipinfo-val cell-mono"><strong>{{ singleResult(g, 'ping').rtt.avg.toFixed(2) }} ms</strong></span>
            </div>
            <div v-if="singleResult(g, 'ping').rtt" class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.pingRttMax') }}</span>
              <span class="ipinfo-val cell-mono">{{ singleResult(g, 'ping').rtt.max.toFixed(2) }} ms</span>
            </div>
            <div v-if="singleResult(g, 'ping').samples?.length" class="ipinfo-row">
              <span class="ipinfo-key">{{ t('cust.proxies.pingSamples') }}</span>
              <span class="ipinfo-val cell-mono">
                <span v-for="s in singleResult(g, 'ping').samples" :key="s.seq" style="margin-right:8px">
                  #{{ s.seq }}: {{ s.time.toFixed(1) }}ms
                </span>
              </span>
            </div>
          </div>
        </template>

        <!-- ── EDIT CREDENTIALS tab ── -->
        <template v-else-if="activeTab(g.id) === 'creds'">
          <p class="gt-hint">{{ t('cust.proxies.tabCredsHint') }}</p>
          <div v-for="p in g.proxies" :key="p.id" class="gt-cred-row">
            <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
            <span class="cell-mono creds">{{ p.username }}:{{ p.password }}</span>
            <button class="pc-btn" type="button" @click="openCredsEdit(p)"><KeyRound :size="12" /> {{ t('cust.proxies.editCreds') }}</button>
          </div>
        </template>

        <!-- ── TAGS tab ── -->
        <template v-else-if="activeTab(g.id) === 'tags'">
          <p class="gt-hint">{{ t('cust.proxies.tabTagsHint') }}</p>
          <div class="gt-tags-current">
            <span class="gt-hint" style="margin-right:6px">{{ t('cust.proxies.tabTagsCommon') }}:</span>
            <span v-for="tg in commonTags(g)" :key="tg" class="tag-mini">
              #{{ tg }}
              <button type="button" @click="removeBulkTag(g, tg)"><X :size="9" /></button>
            </span>
            <span v-if="!commonTags(g).length" class="label-empty">{{ t('cust.proxies.tabTagsEmpty') }}</span>
          </div>
          <div class="gt-tag-input">
            <input v-model="bulkTagDraft[g.id]" type="text" placeholder="tag-name (a-z 0-9 _ -)" @keydown.enter="addBulkTag(g)" />
            <button class="pc-btn" type="button" @click="addBulkTag(g)"><Plus :size="12" /> {{ t('cust.proxies.tabTagsAdd') }}</button>
          </div>
        </template>

        <!-- ── DELETE tab ── -->
        <template v-else-if="activeTab(g.id) === 'delete'">
          <div class="gt-danger-zone">
            <h3><Trash2 :size="16" style="vertical-align:-3px" /> {{ t('cust.proxies.tabDeleteTitle') }}</h3>
            <p>{{ t('cust.proxies.tabDeleteHint', { n: g.proxies.length }) }}</p>
            <button class="primary-action small" style="background:var(--red); border-color:var(--red); color:#fff" type="button" :disabled="busy[g.id] === 'delete'" @click="deleteGroup(g)">
              <Trash2 :size="13" /> {{ busy[g.id] === 'delete' ? '...' : t('cust.proxies.tabDeleteConfirm', { n: g.proxies.length }) }}
            </button>
          </div>
        </template>

      </div>
      <!-- Tag chips for all proxies that have tags or are being edited -->
      <template v-for="p in g.proxies" :key="p.id + '-tags'">
        <div v-if="(p.tags && p.tags.length) || tagEditing === p.id" class="tag-row">
          <span class="tag-row-lbl">{{ p.label || p.id }}:</span>
          <span v-for="tg in (p.tags || [])" :key="tg" class="tag-mini">
            #{{ tg }}
            <button type="button" @click="removeTag(p, tg)"><X :size="9" /></button>
          </span>
          <template v-if="tagEditing === p.id">
            <input v-model="tagDraft" type="text" class="tag-input" placeholder="tag-name" @keydown.enter="addTag(p)" @keydown.esc="cancelTagEdit" />
            <button class="icon-btn small" type="button" @click="addTag(p)"><Plus :size="11" /></button>
            <button class="icon-btn small" type="button" @click="cancelTagEdit"><X :size="11" /></button>
          </template>
        </div>
      </template>
    </div>
  </section>

  <!-- ── Floating bulk action toolbar (when N proxies selected) ── -->
  <div v-if="selected.size" class="bulk-toolbar">
    <span class="bulk-count">{{ t('cust.proxies.bulkSelected', { n: selected.size }) }}</span>
    <button class="action-pill" type="button" @click="bulkCopy('colon')"><Copy :size="12" /> {{ t('cust.proxies.copy') }}</button>
    <button class="action-pill" type="button" @click="bulkExport"><Download :size="12" /> {{ t('cust.proxies.exportTxt') }}</button>
    <button class="action-pill" type="button" @click="bulkCheck"><ShieldCheck :size="12" /> {{ t('cust.proxies.checkLive') }}</button>
    <button class="action-pill primary" type="button" @click="bulkExtend"><RotateCw :size="12" /> {{ t('cust.proxies.extend') }}</button>
    <button class="action-pill danger" type="button" @click="bulkDelete"><Trash2 :size="12" /> {{ t('cust.proxies.deleteGroup') }}</button>
    <button class="bulk-close" type="button" @click="clearSelection" :title="t('cust.proxies.clearSelection')"><X :size="13" /></button>
  </div>

  <!-- ── Credentials editor modal ── -->
  <div v-if="credsEditing" class="creds-backdrop" @click.self="closeCredsEdit">
    <div class="creds-modal">
      <header>
        <strong>{{ t('cust.proxies.credsTitle') }}</strong>
        <button class="close-btn" type="button" @click="closeCredsEdit"><X :size="14" /></button>
      </header>
      <p class="creds-hint">{{ t('cust.proxies.credsHint') }}</p>
      <label class="creds-field">
        <span>{{ t('cust.proxies.credsUsername') }}</span>
        <input v-model="credsDraft.username" type="text" maxlength="40" autofocus />
      </label>
      <label class="creds-field">
        <span>{{ t('cust.proxies.credsPassword') }}</span>
        <input v-model="credsDraft.password" type="text" maxlength="64" />
      </label>
      <p v-if="credsErr" class="error-text" style="margin:6px 0 0">{{ credsErr }}</p>
      <div class="creds-actions">
        <button class="ghost-button" type="button" @click="closeCredsEdit">{{ t('common.cancel') }}</button>
        <button class="primary-action small" type="button" @click="saveCreds(list.find((p) => p.id === credsEditing))">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>

  <!-- ── Quick-test (test in browser) modal ── -->
  <div v-if="testModal" class="creds-backdrop" @click.self="closeTest">
    <div class="creds-modal" style="width:480px">
      <header>
        <strong><Eye :size="14" style="vertical-align:-2px" /> {{ t('cust.proxies.testTitle') }}</strong>
        <button class="close-btn" type="button" @click="closeTest"><X :size="14" /></button>
      </header>
      <p class="creds-hint">
        <span class="cell-mono">{{ testModal.ip || testModal.bindIp }}:{{ testModal.port }}</span> · {{ testModal.username }}
      </p>
      <div v-if="testBusy" style="text-align:center; padding:24px">
        <RefreshCw :size="24" class="spin" style="color:var(--green)" />
        <p style="color:var(--muted); font-size:12px; margin-top:8px">{{ t('cust.proxies.testRunning') }}</p>
      </div>
      <div v-else-if="testResult" class="test-result">
        <div class="test-row">
          <span class="lbl">{{ t('cust.proxies.testStatus') }}</span>
          <span :class="['status-pill', testResult.ok ? 'active' : 'expired']">{{ testResult.ok ? t('cust.proxies.testOk') : t('cust.proxies.testFail') }}</span>
        </div>
        <div v-if="testResult.exitIp" class="test-row">
          <span class="lbl">{{ t('cust.proxies.testExitIp') }}</span>
          <span class="cell-mono">{{ testResult.exitIp }}</span>
        </div>
        <div class="test-row">
          <span class="lbl">{{ t('cust.proxies.testLatency') }}</span>
          <span class="cell-mono">{{ testResult.latencyMs }} ms</span>
        </div>
        <div v-if="testResult.error" class="test-row">
          <span class="lbl">{{ t('cust.proxies.testError') }}</span>
          <span class="cell-mono" style="color:var(--red)">{{ testResult.error }}</span>
        </div>
      </div>
      <div class="creds-actions">
        <button class="ghost-button" type="button" @click="closeTest">{{ t('common.close') }}</button>
        <button v-if="!testBusy" class="primary-action small" type="button" @click="runQuickTest(testModal)">{{ t('cust.proxies.testRetry') }}</button>
      </div>
    </div>
  </div>

  <!-- ── Embedded Tools result modal ── -->
  <div v-if="toolsModal" class="creds-backdrop" @click.self="closeToolsModal">
    <div class="creds-modal" style="width:560px; max-height:80vh">
      <header>
        <strong>
          <Wrench :size="14" style="vertical-align:-2px" />
          <template v-if="toolsModal.tool === 'speed-test'">{{ t('cust.proxies.toolSpeed') }}</template>
          <template v-else-if="toolsModal.tool === 'blacklist'">{{ t('cust.proxies.toolBlacklist') }}</template>
          <template v-else-if="toolsModal.tool === 'ip-info'">{{ t('cust.proxies.toolIpInfo') }}</template>
          <template v-else-if="toolsModal.tool === 'ping'">{{ t('cust.proxies.toolPing') }}</template>
        </strong>
        <button class="close-btn" type="button" @click="closeToolsModal"><X :size="14" /></button>
      </header>
      <p class="creds-hint">
        <span class="cell-mono">{{ (toolsModal.proxy.ip || toolsModal.proxy.bindIp) }}:{{ toolsModal.proxy.port }}</span>
      </p>

      <div v-if="toolsModal.busy" style="text-align:center; padding:24px">
        <RefreshCw :size="24" class="spin" style="color:var(--green)" />
        <p style="color:var(--muted); font-size:12px; margin-top:8px">
          <template v-if="toolsModal.tool === 'speed-test'">{{ t('cust.proxies.toolSpeedRunning') }}</template>
          <template v-else>{{ t('cust.proxies.toolRunning') }}</template>
        </p>
      </div>

      <div v-else-if="toolsModal.error" class="error-text" style="margin:12px 0">{{ toolsModal.error }}</div>

      <!-- Speed test result -->
      <div v-else-if="toolsModal.tool === 'speed-test' && toolsModal.result" class="tool-result">
        <div class="tool-hero">
          <span class="tool-hero-val" :style="{ color: toolsModal.result.mbps >= 50 ? 'var(--green)' : toolsModal.result.mbps >= 10 ? 'var(--yellow)' : 'var(--red)' }">
            {{ toolsModal.result.mbps.toFixed(2) }}
          </span>
          <span class="tool-hero-unit">Mbps</span>
        </div>
        <div class="test-row"><span class="lbl">{{ t('cust.proxies.toolSpeedServer') }}</span><span>{{ toolsModal.result.server?.sponsor }} · {{ toolsModal.result.server?.name }}</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.proxies.toolSpeedBytes') }}</span><span class="cell-mono">{{ fmtBytes(toolsModal.result.totalBytes) }}</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.proxies.toolSpeedDuration') }}</span><span class="cell-mono">{{ (toolsModal.result.durationMs / 1000).toFixed(2) }} s</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.proxies.toolSpeedTtfb') }}</span><span class="cell-mono">{{ toolsModal.result.ttfbMs }} ms</span></div>
      </div>

      <!-- Blacklist result -->
      <div v-else-if="toolsModal.tool === 'blacklist' && toolsModal.result" class="tool-result">
        <div :class="['blsum', toolsModal.result.listed > 0 ? 'bad' : 'good']">
          <strong>{{ toolsModal.result.listed }}</strong> / {{ toolsModal.result.total }} {{ t('cust.proxies.toolBlListed') }}
        </div>
        <div class="bl-list">
          <div v-for="r in toolsModal.result.results" :key="r.host" :class="['bl-item', r.listed === true ? 'listed' : r.listed === false ? 'clean' : 'error']">
            <span>{{ r.name }}</span>
            <span class="cell-mono">{{ r.host }}</span>
            <span class="bl-tag">{{ r.listed === true ? t('cust.proxies.toolBlBad') : r.listed === false ? t('cust.proxies.toolBlClean') : 'ERR' }}</span>
          </div>
        </div>
      </div>

      <!-- IP info result -->
      <div v-else-if="toolsModal.tool === 'ip-info' && toolsModal.result" class="tool-result">
        <div class="test-row"><span class="lbl">IP</span><span class="cell-mono">{{ toolsModal.result.ip }}</span></div>
        <div class="test-row"><span class="lbl">ASN</span><span class="cell-mono">{{ toolsModal.result.asn || '—' }}</span></div>
        <div class="test-row"><span class="lbl">CIDR</span><span class="cell-mono">{{ toolsModal.result.cidr || '—' }}</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.tools.ipInfo.country') }}</span><span class="cell-mono">{{ toolsModal.result.country || '—' }}</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.tools.ipInfo.registry') }}</span><span class="cell-mono">{{ (toolsModal.result.registry || '—').toUpperCase() }}</span></div>
        <div class="test-row"><span class="lbl">{{ t('cust.tools.ipInfo.org') }}</span><span class="cell-mono" style="font-size:11.5px">{{ toolsModal.result.org || '—' }}</span></div>
      </div>

      <!-- Ping result -->
      <div v-else-if="toolsModal.tool === 'ping' && toolsModal.result" class="tool-result">
        <div :class="['blsum', toolsModal.result.ok ? 'good' : 'bad']">
          <strong>{{ toolsModal.result.received }}</strong> / {{ toolsModal.result.transmitted }} {{ t('cust.proxies.toolPingReceived') }}
          · {{ toolsModal.result.loss }}% loss
        </div>
        <div v-if="toolsModal.result.rtt" class="test-row"><span class="lbl">RTT avg</span><span class="cell-mono">{{ toolsModal.result.rtt.avg.toFixed(1) }} ms</span></div>
        <div v-if="toolsModal.result.rtt" class="test-row"><span class="lbl">RTT min</span><span class="cell-mono">{{ toolsModal.result.rtt.min.toFixed(1) }} ms</span></div>
        <div v-if="toolsModal.result.rtt" class="test-row"><span class="lbl">RTT max</span><span class="cell-mono">{{ toolsModal.result.rtt.max.toFixed(1) }} ms</span></div>
      </div>

      <div class="creds-actions">
        <button class="ghost-button" type="button" @click="closeToolsModal">{{ t('common.close') }}</button>
        <button v-if="!toolsModal.busy" class="primary-action small" type="button" @click="runTool(toolsModal.proxy, toolsModal.tool)">{{ t('cust.proxies.toolRetry') }}</button>
      </div>
    </div>
  </div>

  <!-- ── Activity timeline modal ── -->
  <div v-if="timelineModal" class="creds-backdrop" @click.self="closeTimeline">
    <div class="creds-modal" style="width:560px; max-height:80vh">
      <header>
        <strong><Activity :size="14" style="vertical-align:-2px" /> {{ t('cust.proxies.timelineTitle') }}</strong>
        <button class="close-btn" type="button" @click="closeTimeline"><X :size="14" /></button>
      </header>
      <p class="creds-hint">{{ t('cust.proxies.timelineHint') }}</p>
      <div class="timeline-list">
        <div v-if="!timelineEvents.length" class="empty-text" style="text-align:left">{{ t('cust.proxies.timelineEmpty') }}</div>
        <div v-for="(ev, i) in timelineEvents" :key="i" class="timeline-row">
          <span class="cell-mono ts">{{ String(ev.ts || '').slice(0, 16).replace('T', ' ') }}</span>
          <span class="method">{{ ev.method }}</span>
          <span class="note">{{ ev.note || ev.path }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- ── QR modal: expand small icon click into full-size QR + download ── -->
  <div v-if="qrModal" class="creds-backdrop" @click.self="closeQrModal">
    <div class="creds-modal qr-modal">
      <header>
        <strong><QrCode :size="14" style="vertical-align:-2px" /> {{ qrModal.label }}</strong>
        <button class="close-btn" type="button" @click="closeQrModal"><X :size="14" /></button>
      </header>
      <div class="qr-modal-body">
        <div class="qr-modal-svg" v-html="qrSvg(qrModal.url, 360)"></div>
        <code class="qr-modal-url">{{ qrModal.url }}</code>
        <div class="qr-modal-actions">
          <button class="row-act-btn" @click="copyText(qrModal.url, qrModal.label)"><Copy :size="12" /> Copy URL</button>
          <button class="row-act-btn" @click="downloadQr(qrModal.url, qrModal.label)"><Download :size="12" /> Download SVG</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }
.success-text { color: var(--green); font-size: 13px; margin: 4px 0 10px; }

.filter-bar {
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  margin: 14px 0;
}
.search-wrap {
  display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--muted);
  min-width: 240px;
}
.search-wrap input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text); font-family: var(--mono); font-size: 13px;
}
.filter-select {
  height: 36px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-size: 13px; outline: none;
}

.group-card { padding: 14px 16px; margin-bottom: 12px; }
.group-head {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  font-size: 12.5px;
}
.group-toggle {
  width: 24px; height: 24px; background: transparent; border: none; border-radius: 6px;
  color: var(--muted); cursor: pointer; display: grid; place-items: center;
}
.group-toggle:hover { background: var(--bg); color: var(--text); }
.group-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.group-id strong { font-size: 13px; color: var(--text); }
.group-id .group-sub { font-size: 11px; color: var(--muted); }
.group-count, .group-zone, .group-exp {
  display: inline-flex; align-items: center; gap: 6px; color: var(--muted);
  line-height: 1;
}
.group-count svg, .group-zone svg, .group-exp svg { color: var(--muted); }
/* Reset the inline vertical-align that CountryFlag applies for inline-baseline
   contexts — inside our flex row, align-items: center already does the job. */
.group-zone :deep(.country-flag) { vertical-align: 0; }

.group-actions {
  display: flex; gap: 8px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
.action-pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  color: var(--text); font-size: 12px; font-weight: 500;
  cursor: pointer; transition: background 120ms, border-color 120ms, color 120ms;
}
.action-pill:hover:not(:disabled) {
  background: rgba(63,185,80,0.10); border-color: var(--green); color: var(--green);
}
.action-pill.primary {
  background: rgba(63,185,80,0.14); border-color: var(--green); color: var(--green);
}
.action-pill.primary:hover:not(:disabled) {
  background: var(--green); color: #ffffff;
}
.action-pill.danger:hover:not(:disabled) {
  background: rgba(248,81,73,0.12); border-color: var(--red); color: var(--red);
}
.action-pill:disabled { opacity: 0.55; cursor: not-allowed; }
.pill-count {
  background: var(--green); color: #ffffff;
  padding: 1px 6px; border-radius: 8px;
  font-size: 10px; font-weight: 600; margin-left: 4px;
}

.extend-inline {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--border); border-radius: 7px;
  background: var(--bg); padding-left: 6px;
}
.extend-inline input {
  width: 60px; height: 28px; padding: 0 6px;
  background: transparent; border: none; outline: none;
  color: var(--text); font-family: var(--mono); font-size: 12px;
  text-align: right;
}
.extend-inline .action-pill { border: none; border-radius: 6px; height: 28px; }

.check-result {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 10px;
  padding: 6px 10px; font-size: 12px;
  background: var(--green-soft); border: 1px solid var(--green); border-radius: 7px;
  color: var(--green);
}

.whitelist-panel {
  margin-top: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.whitelist-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.whitelist-head strong { font-size: 12.5px; color: var(--text); }
.whitelist-hint { font-size: 11.5px; color: var(--muted); margin: 0 0 8px; line-height: 1.4; }
.whitelist-list { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; min-height: 24px; }
.whitelist-empty { font-size: 12px; color: var(--muted); font-style: italic; }
.ip-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--border-soft); border: 1px solid var(--border); border-radius: 6px;
  padding: 3px 4px 3px 8px; font-size: 12px;
}
.ip-remove {
  width: 18px; height: 18px; background: transparent; border: none; border-radius: 4px;
  color: var(--muted); cursor: pointer; display: grid; place-items: center;
}
.ip-remove:hover { background: rgba(248,81,73,0.12); color: var(--red); }
.whitelist-form { display: flex; gap: 8px; }
.whitelist-form input {
  flex: 1; height: 32px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  color: var(--text); font-family: var(--mono); font-size: 12.5px; outline: none;
}
.whitelist-form input:focus { border-color: var(--green); }

.group-body {
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
/* ── Group tabs (left vertical) + content (right) ──────────────────── */
.group-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 14px;
  min-height: 320px;
}
.gt-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 6px;
  align-self: start;
}
.gt-tab {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.gt-tab:hover {
  background: rgba(63,185,80,0.06);
  color: var(--text);
}
.gt-tab.active {
  background: rgba(63,185,80,0.12);
  border-color: var(--green);
  color: var(--green);
  font-weight: 600;
}
.gt-tab.danger:hover { background: rgba(248,81,73,0.10); color: var(--red); }
.gt-tab.danger.active { background: rgba(248,81,73,0.14); border-color: var(--red); color: var(--red); }
.gt-tab svg { flex: none; }

.gt-content {
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 14px;
  min-width: 0;
}
.gt-hint { color: var(--muted); font-size: 12.5px; margin: 0 0 12px; line-height: 1.5; }
.gt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
.gt-result-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }

.gt-row {
  display: grid;
  grid-template-columns:
    24px                /* checkbox */
    36px                /* #idx */
    minmax(110px, 160px) /* label */
    minmax(170px, 200px) /* ip:port */
    minmax(220px, 240px) /* user:pass */
    72px                /* status pill */
    72px                /* spark */
    auto;               /* actions (sized to content) */
  gap: 0;
  align-items: stretch;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--border-soft);
  margin-bottom: 4px;
  font-size: 12.5px;
  min-height: 34px;
}
.gt-row > .pc-idx,
.gt-row > .gt-row-label,
.gt-row > .cell-mono,
.gt-row > .gt-row-status,
.gt-row > .spark,
.gt-row > .gt-row-actions {
  padding: 0 10px;
  min-width: 0;
  display: flex; align-items: center;
}
.gt-row > .cbx { margin-left: 8px; align-self: center; }
.gt-row > .gt-row-status { justify-content: center; padding: 0 6px; }
.gt-row > .spark { padding: 0 6px; }
.gt-row > .cell-mono {
  overflow: hidden;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  line-height: 1.25;
}
.gt-row > .cell-mono > .ip-line,
.gt-row > .cell-mono > .egress-line {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
}
.gt-row > .cell-mono > .egress-line {
  font-size: 10.5px;
  color: var(--muted);
}
.gt-row.is-selected { border-color: var(--green); background: rgba(63,185,80,0.04); }
.gt-row .creds { color: var(--muted); }
.gt-row-label { display: flex; align-items: center; gap: 4px; min-width: 0; }
.gt-row-label input {
  height: 24px; padding: 0 6px;
  background: var(--surface); border: 1px solid var(--green); border-radius: 5px;
  color: var(--text); font-size: 12px; outline: none; width: 140px;
}
/* Each action button looks like its own cell separated by vertical lines */
.gt-row-actions {
  display: flex; gap: 0;
  justify-content: flex-end; flex-wrap: nowrap;
  padding: 0 !important;
}
.gt-row-actions .row-act-btn {
  border: none !important; background: transparent !important;
  border-radius: 0 !important;
  padding: 0 12px !important;
  height: 100%;
  font-size: 11.5px;
  white-space: nowrap;
}
.gt-row-actions .row-act-btn + .row-act-btn {
  border-left: none !important;
}
.gt-row-actions .row-act-btn:hover:not(:disabled) { background: rgba(255,255,255,0.05) !important; }
.gt-row-actions .row-act-btn.connect-btn { color: var(--green); }
.gt-row-actions .row-act-btn.rotate-btn:not(:disabled):hover { color: var(--green); }

.gt-result-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.gt-rc-head { font-size: 12.5px; color: var(--text); border-bottom: 1px solid var(--border-soft); padding-bottom: 6px; }
.gt-rc-busy { color: var(--muted); font-size: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; }
.gt-rc-body { display: flex; flex-direction: column; gap: 6px; }
.gt-big-num { font-size: 22px; font-weight: 700; font-family: var(--mono); }
.gt-big-num small { font-size: 12px; font-weight: 500; color: var(--muted); }
.gt-big-num.bad  { color: var(--red); }
.gt-big-num.good { color: var(--green); }

.gt-cred-row {
  display: grid;
  grid-template-columns: 1.2fr 1.6fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12.5px;
}
.gt-cred-row .creds { color: var(--muted); }

.gt-tags-current { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border-soft); }
.gt-tag-input { display: flex; gap: 8px; }
.gt-tag-input input {
  flex: 1; height: 34px; padding: 0 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 7px;
  color: var(--text); font-family: var(--mono); font-size: 13px; outline: none;
}
.gt-tag-input input:focus { border-color: var(--green); }

.gt-danger-zone {
  padding: 18px;
  background: var(--red-soft);
  border: 1px solid var(--red);
  border-radius: 10px;
}
.gt-danger-zone h3 { margin: 0 0 8px; font-size: 14px; color: var(--red); }
.gt-danger-zone p { font-size: 13px; color: var(--text); margin: 0 0 12px; line-height: 1.5; }

/* Batch tool list (sequential rows) */
.batch-controls {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}
.batch-note { font-size: 11.5px; color: var(--muted); line-height: 1.4; }
.batch-empty {
  padding: 30px 20px; text-align: center;
  background: var(--surface); border: 1px dashed var(--border); border-radius: 8px;
  color: var(--muted); font-size: 13px;
}
.batch-list { display: flex; flex-direction: column; gap: 6px; }
.batch-row {
  display: grid;
  grid-template-columns: 28px 1.4fr 130px 1fr;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 12.5px;
  transition: border-color 120ms, background 120ms;
}
.batch-row.running {
  border-color: var(--green);
  background: rgba(63,185,80,0.05);
}
.batch-row.done { border-color: var(--border); }
.batch-num {
  width: 26px; height: 26px;
  display: inline-grid; place-items: center;
  background: var(--bg); border: 1px solid var(--border-soft); border-radius: 50%;
  font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--muted);
}
.batch-row.done .batch-num { background: var(--green-soft); color: var(--green); border-color: var(--green); }
.batch-row.running .batch-num { background: var(--green); color: #fff; border-color: var(--green); }

.batch-target { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.batch-target .label-text { display: inline-block; align-self: flex-start; }

.batch-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); }
.batch-detail { display: flex; flex-direction: column; gap: 2px; min-width: 0; align-items: flex-end; text-align: right; }

/* IP info tab — chip picker + key/value table */
.ipinfo-picker {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}
.ipinfo-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 7px;
  color: var(--text); font-size: 12.5px; cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.ipinfo-chip:hover { border-color: var(--muted); }
.ipinfo-chip.active {
  background: var(--green-soft); border-color: var(--green); color: var(--green);
  font-weight: 600;
}

.ipinfo-table {
  display: flex; flex-direction: column; gap: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.ipinfo-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
  align-items: center;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-soft);
}
.ipinfo-row:last-of-type { border-bottom: none; }
.ipinfo-row:nth-child(even) { background: var(--bg); }
.ipinfo-key {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.ipinfo-val { font-size: 13px; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.ipinfo-val-wrap { word-break: break-word; }
.ipinfo-actions {
  display: flex; justify-content: flex-end;
  padding: 10px 16px;
  background: var(--bg);
}

/* ── Speed test tab — controls + gauge + result cards ── */
.st-controls {
  display: flex; flex-direction: column; gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
}
.st-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.st-lbl {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
  min-width: 70px;
}

.st-gauge-wrap {
  display: flex; flex-direction: column; align-items: center;
  margin: 18px 0;
}
.st-gauge {
  width: 100%; max-width: 320px; height: auto;
}
.st-phase {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: 8px;
  font-size: 13px; color: var(--text);
}

.st-result {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-top: 14px;
}
.st-metric {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px; display: flex; flex-direction: column; gap: 6px;
}
.st-metric.down { border-color: var(--green); }
.st-metric.up { border-color: var(--blue); }
.st-mlbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.st-mval { font-size: 26px; font-weight: 700; font-family: var(--mono); color: var(--text); }
.st-mval small { font-size: 12px; color: var(--muted); font-weight: 500; margin-left: 4px; }
.st-metric.down .st-mval { color: var(--green); }
.st-metric.up .st-mval { color: var(--blue); }

/* ── Mobile (≤ 720px) ────────────────────────────────────────────── */
@media (max-width: 900px) {
  .group-body { grid-template-columns: 1fr; gap: 10px; }
  /* Tabs become a horizontal scrollable pill row */
  .gt-tabs {
    flex-direction: row;
    overflow-x: auto;
    padding: 6px;
    gap: 6px;
    scrollbar-width: none;
  }
  .gt-tabs::-webkit-scrollbar { display: none; }
  .gt-tab {
    flex: 0 0 auto;
    padding: 8px 12px;
    font-size: 12px;
    white-space: nowrap;
  }
  .gt-content { padding: 12px; }
  .gt-row {
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 10px;
  }
  .gt-row > span { font-size: 12px; }
  .gt-result-grid { grid-template-columns: 1fr; }
  .batch-row {
    grid-template-columns: 24px 1fr;
    gap: 8px;
    padding: 10px;
  }
  .batch-row .batch-status,
  .batch-row .batch-detail {
    grid-column: 1 / -1;
    text-align: left;
    align-items: flex-start;
    padding-left: 32px;
  }
  .ipinfo-row { grid-template-columns: 1fr; gap: 2px; padding: 10px 12px; }
  .st-result { grid-template-columns: 1fr; }
  .st-row { flex-direction: column; align-items: stretch; }
  .st-lbl { min-width: 0; }
  .filter-bar { flex-direction: column; align-items: stretch; gap: 8px; }
  .search-wrap { min-width: 0; width: 100%; }
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .quick-stats { grid-template-columns: repeat(2, 1fr); }
  .group-head { gap: 8px; font-size: 11.5px; }
  .group-actions { gap: 6px; }
  .group-actions > * { font-size: 11.5px; padding: 0 10px; }
  .group-view-btn { padding: 4px 10px; }
}

@media (max-width: 480px) {
  .kpi-row { grid-template-columns: 1fr 1fr; }
  .quick-stats { grid-template-columns: 1fr; }
  .group-head > * { font-size: 11px; }
  .gt-tab { padding: 7px 10px; font-size: 11.5px; }
  .gt-content { padding: 10px; }
  .gt-cred-row { grid-template-columns: 1fr; gap: 6px; }
  .pc-btn { font-size: 11px; padding: 0 8px; height: 28px; }
  h1 { font-size: 20px !important; }
  .bulk-toolbar {
    left: 8px; right: 8px; bottom: 8px; transform: none;
    flex-wrap: wrap; padding: 8px;
  }
}

/* Legacy per-proxy CARD (no longer rendered, kept to avoid leftover ref errors) */
.proxy-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 8px;
  overflow: hidden;
  transition: border-color 120ms, background 120ms;
}
.proxy-card.is-selected { border-color: var(--green); background: rgba(63,185,80,0.05); }
.pc-info {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-soft);
}
.pc-idx { color: var(--muted); font-size: 12px; font-weight: 600; }
.pc-label {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 0;
}
.pc-label input {
  height: 26px; padding: 0 8px;
  background: var(--surface); border: 1px solid var(--green); border-radius: 5px;
  color: var(--text); font-size: 12px; outline: none; width: 180px;
}
.label-add {
  background: transparent; border: 1px dashed var(--border);
  color: var(--muted); font-size: 11px; padding: 2px 8px; border-radius: 5px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.label-add:hover { border-color: var(--green); color: var(--green); border-style: solid; }

.pc-field {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0;
}
.pc-field-lbl {
  font-size: 9.5px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
}
.pc-field .cell-mono { font-size: 12.5px; color: var(--text); }
.pc-field .creds { color: var(--muted); }

.pc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(0,0,0,0.15);
}
.pc-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 12px; font-weight: 500;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pc-btn:hover {
  background: rgba(63,185,80,0.10);
  border-color: var(--green);
  color: var(--green);
}
.pc-btn.danger:hover {
  background: rgba(248,81,73,0.12);
  border-color: var(--red);
  color: var(--red);
}

/* Custom checkbox — uniform look across themes (native renderer was leaking) */
.cbx {
  width: 18px; height: 18px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 5px;
  display: inline-grid; place-items: center;
  cursor: pointer;
  padding: 0;
  transition: background 120ms, border-color 120ms;
  flex-shrink: 0;
}
.cbx:hover { border-color: var(--green); }
.cbx svg { opacity: 0; color: #ffffff; transition: opacity 120ms; }
.cbx.checked { background: var(--green); border-color: var(--green); }
.cbx.checked svg { opacity: 1; }

/* View detail button per group */
.group-view-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  background: var(--bg); border: 1px solid var(--green);
  border-radius: 7px; color: var(--green);
  font-size: 12px; font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms;
}
.group-view-btn:hover { background: var(--green); color: #ffffff; }

/* Embedded Tools dropdown */
.tools-wrap { position: relative; display: inline-block; }
.tools-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 40;
  min-width: 160px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; gap: 1px;
}
.tools-menu button {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 10px; background: transparent; border: none; border-radius: 5px;
  color: var(--text); font-size: 12px; text-align: left; cursor: pointer;
}
.tools-menu button:hover { background: var(--bg); color: var(--green); }

/* Tool result panels (unified modal) */
.tool-result { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; }
.tool-hero { text-align: center; padding: 16px 0; }
.tool-hero-val { font-size: 48px; font-weight: 700; font-family: var(--mono); letter-spacing: -0.03em; }
.tool-hero-unit { font-size: 16px; color: var(--muted); margin-left: 8px; }

.blsum {
  text-align: center; padding: 14px;
  border-radius: 8px; border: 1px solid var(--border);
  font-size: 14px; color: var(--text); margin-bottom: 10px;
}
.blsum strong { font-size: 26px; font-weight: 700; font-family: var(--mono); }
.blsum.good { background: var(--green-soft); border-color: var(--green); color: var(--green); }
.blsum.bad  { background: var(--red-soft); border-color: var(--red); color: var(--red); }

.bl-list { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow-y: auto; }
.bl-item {
  display: grid; grid-template-columns: 1fr 1fr 70px; gap: 8px;
  padding: 6px 10px; font-size: 11.5px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
}
.bl-item.listed { border-color: var(--red); }
.bl-item.clean  { border-color: var(--green); }
.bl-item .bl-tag { font-family: var(--mono); font-weight: 700; font-size: 10.5px; text-align: center; padding: 2px 6px; border-radius: 4px; }
.bl-item.listed .bl-tag { background: var(--red); color: #ffffff; }
.bl-item.clean .bl-tag  { background: var(--green-soft); color: var(--green); }
.bl-item.error .bl-tag  { background: var(--yellow-soft); color: var(--yellow); }
@media (max-width: 900px) {
  .group-head { gap: 8px; font-size: 11.5px; }
  .group-actions { gap: 6px; }
  .action-pill { padding: 0 10px; font-size: 11.5px; }
  .pc-info { gap: 8px; padding: 10px; }
  .pc-actions { padding: 8px 10px; }
  .pc-btn { padding: 0 8px; font-size: 11.5px; }
}

/* ── Label badge / inline edit (group + per-proxy) ── */
.group-label, .proxy-label {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--muted);
  min-width: 0;
}
.group-label .label-text, .proxy-label .label-text {
  color: var(--text); font-weight: 600; font-size: 12px;
  background: var(--green-soft); border: 1px solid var(--green);
  padding: 1px 8px; border-radius: 5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.label-empty { color: var(--muted); font-style: italic; font-size: 11.5px; }
.group-label input, .proxy-label input {
  height: 24px; padding: 0 6px;
  background: var(--bg); border: 1px solid var(--green); border-radius: 5px;
  color: var(--text); font-size: 12px; outline: none; width: 160px;
}
.icon-btn.small { width: 22px; height: 22px; border-radius: 5px; }
.icon-btn.small svg { width: 11px; height: 11px; }

/* ── Bulk action toolbar (floating bottom) ── */
.bulk-toolbar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 60;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px 8px 14px;
  background: var(--pxl-card, var(--surface));
  border: 1px solid var(--green);
  border-radius: 14px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(63,185,80,0.2);
  font-size: 12.5px;
}
.bulk-count { color: var(--green); font-weight: 700; padding-right: 6px; border-right: 1px solid var(--border); }
.bulk-close {
  width: 26px; height: 26px; background: transparent; border: none; border-radius: 6px;
  color: var(--muted); cursor: pointer; display: grid; place-items: center;
  margin-left: 4px;
}
.bulk-close:hover { background: rgba(239,68,68,0.12); color: var(--red); }

/* ── Credentials modal ── */
.creds-backdrop {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  display: grid; place-items: center;
  animation: fadein 120ms ease;
}
@keyframes fadein { from { opacity: 0 } to { opacity: 1 } }
.creds-modal {
  width: 420px; max-width: calc(100vw - 32px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  display: flex; flex-direction: column; gap: 10px;
}
.creds-modal header { display: flex; justify-content: space-between; align-items: center; }
.creds-modal header strong { font-size: 14px; color: var(--text); }
.creds-hint { font-size: 12px; color: var(--muted); margin: 0; line-height: 1.45; }
.creds-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--muted); }
.creds-field input {
  height: 36px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); font-family: var(--mono); font-size: 13px; outline: none;
}
.creds-field input:focus { border-color: var(--green); }
.creds-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

/* Tag filter bar */
.tag-bar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin: 8px 0 14px; padding: 8px 12px;
  background: var(--bg); border: 1px solid var(--border-soft); border-radius: 8px;
  font-size: 12px; color: var(--muted);
}
.tag-bar-label { color: var(--muted); margin-right: 4px; }
.tag-chip {
  padding: 3px 10px; border-radius: 5px; border: 1px solid var(--border);
  background: transparent; color: var(--muted); font-size: 11.5px; cursor: pointer;
  font-family: var(--mono);
}
.tag-chip:hover { color: var(--text); border-color: var(--muted); }
.tag-chip.active { background: var(--green-soft); border-color: var(--green); color: var(--green); }

/* Multi-format export dropdown */
.export-wrap { position: relative; display: inline-block; }
.export-menu {
  position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: 30;
  min-width: 220px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; gap: 1px;
}
.export-menu button {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: transparent; border: none; border-radius: 5px;
  color: var(--text); font-size: 12px; text-align: left; cursor: pointer;
  width: 100%;
}
.export-menu button:hover { background: var(--bg); color: var(--green); }
.export-sep {
  font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em;
  padding: 8px 10px 4px; border-top: 1px solid var(--border-soft); margin-top: 4px;
}

/* Inline auto-rotate select inside an action-pill */
.inline-select {
  background: transparent; border: none; color: inherit;
  font: inherit; cursor: pointer; outline: none;
  padding: 0; margin-left: 4px;
}
.inline-select option { background: var(--surface); color: var(--text); }

/* Quick stats panel */
.quick-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-top: 12px;
}
.qs-cell {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px;
}
.qs-lbl { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.qs-val { display: block; font-size: 18px; font-weight: 700; font-family: var(--mono); color: var(--text); margin-top: 4px; }
.qs-sub { font-size: 10.5px; color: var(--muted); }

/* Inline sparkline */
.status-cell { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.spark { width: 60px; height: 14px; opacity: 0.85; }

/* Tag chips inline below row */
.tag-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 0 6px 78px; font-size: 11.5px;
  border-bottom: 1px solid var(--border-soft);
}
.tag-row-lbl { color: var(--muted); font-size: 10.5px; }
.tag-mini {
  display: inline-flex; align-items: center; gap: 2px;
  background: rgba(59,130,246,0.14); border: 1px solid rgba(59,130,246,0.3);
  color: var(--blue); padding: 1px 4px 1px 6px; border-radius: 4px;
  font-family: var(--mono); font-size: 11px;
}
.tag-mini button {
  background: transparent; border: none; color: var(--muted); cursor: pointer;
  display: inline-grid; place-items: center; padding: 0; margin-left: 2px;
}
.tag-mini button:hover { color: var(--red); }
.tag-input {
  width: 100px; height: 22px; padding: 0 6px;
  background: var(--bg); border: 1px solid var(--blue); border-radius: 4px;
  color: var(--text); font-family: var(--mono); font-size: 11px; outline: none;
}

/* Test modal */
.test-result { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
.test-row { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; }
.test-row .lbl { color: var(--muted); }
.spin { animation: cp-spin 0.9s linear infinite; }
@keyframes cp-spin { to { transform: rotate(360deg); } }

/* Timeline modal */
.timeline-list { max-height: 50vh; overflow-y: auto; margin: 8px 0; }
.timeline-row {
  display: grid; grid-template-columns: 130px 60px 1fr; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border-soft);
  font-size: 11.5px;
}
.timeline-row .ts { color: var(--muted); }
.timeline-row .method { color: var(--blue); font-weight: 600; font-family: var(--mono); font-size: 10.5px; }
.timeline-row .note { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* v6 egress IP shown under v4 host in proxy row */
.egress-line {
  display: block;
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 1px;
  letter-spacing: 0;
}
.rotate-btn:not(:disabled):hover { color: var(--green); background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.4); }
.gt-row-actions .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.gt-row-actions .icon-btn { transition: background 0.1s, color 0.1s; }
.gt-row-actions { display: flex; gap: 4px; flex-wrap: nowrap; justify-content: flex-end; }
.row-act-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; font-size: 11.5px; font-weight: 500;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text); cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  white-space: nowrap;
}
.row-act-btn:hover:not(:disabled) { background: rgba(255,255,255,0.07); border-color: var(--border-soft); }
.row-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.row-act-btn :deep(svg) { flex-shrink: 0; }
.flash-toast {
  position: fixed; top: 76px; right: 20px; z-index: 100;
  padding: 10px 18px; border-radius: var(--radius);
  background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.4);
  color: var(--green); font-size: 12.5px; font-weight: 500;
  box-shadow: 0 8px 20px rgba(0,0,0,0.35);
  font-family: var(--mono);
}
.flash-enter-active, .flash-leave-active { transition: opacity 0.2s, transform 0.2s; }
.flash-enter-from, .flash-leave-to { opacity: 0; transform: translateY(-8px); }

/* Live countdown — tier colors */
.countdown-live { font-family: var(--mono); font-weight: 600; font-feature-settings: 'tnum'; letter-spacing: 0.02em; }
.countdown-live.active   { color: var(--green); }
.countdown-live.soon     { color: #93c5fd; }
.countdown-live.expiring { color: #fbbf24; }
.countdown-live.critical { color: #fca5a5; animation: pulseCountdown 1s ease-in-out infinite; }
.countdown-live.expired  { color: #ef4444; }
.countdown-live.muted    { color: var(--muted); }
@keyframes pulseCountdown { 0%,100% { opacity:1 } 50% { opacity:0.55 } }

/* Big countdown chip next to extend button */
.countdown-big {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px;
  background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2);
  font-family: var(--mono);
}
.countdown-big small { font-size: 10.5px; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
.countdown-big strong { font-size: 14px; font-feature-settings: 'tnum'; letter-spacing: 0.02em; }
.countdown-big.soon     { background: rgba(59,130,246,0.06); border-color: rgba(59,130,246,0.25); }
.countdown-big.soon     strong { color: #93c5fd; }
.countdown-big.expiring { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.35); }
.countdown-big.expiring strong { color: #fbbf24; }
.countdown-big.critical { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.4); }
.countdown-big.critical strong { color: #fca5a5; animation: pulseCountdown 1s ease-in-out infinite; }
.countdown-big.expired  { background: rgba(115,115,115,0.08); border-color: rgba(115,115,115,0.3); }
.countdown-big.expired  strong { color: #a3a3a3; }
.countdown-big.active   strong { color: var(--green); }

/* Inline "Kết nối" expanded panel under each proxy row */
.gt-row.is-expanded {
  border-bottom: none;
  background: rgba(34, 197, 94, 0.025);
}
.gt-row-connect {
  padding: 12px 14px 14px 14px;
  margin-bottom: 8px;
  background: rgba(0,0,0,0.18);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  display: flex; flex-direction: column; gap: 10px;
}
.connect-btn { background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.35) !important; }
.connect-btn:hover { background: rgba(34, 197, 94, 0.15); }

.session-block {
  display: flex; flex-direction: column; gap: 8px;
  background: rgba(34, 197, 94, 0.04);
  border: 1px solid rgba(34, 197, 94, 0.22);
  border-radius: 6px;
  padding: 8px 10px;
}
.session-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 11.5px; color: var(--text);
  flex-wrap: wrap;
}
.session-head.full { color: #f97316; }
.session-head strong { color: var(--green); font-size: 13px; font-family: var(--mono); }
.session-head.full strong { color: #f97316; }
.session-head > span { flex: 1; min-width: 220px; line-height: 1.4; }
.session-head small { display: block; color: var(--muted); font-size: 10.5px; margin-top: 2px; }
.session-head small strong { color: var(--text); font-size: 10.5px; font-family: var(--mono); font-weight: 600; }
.session-head > .row-act-btn { flex-shrink: 0; }

.session-byip { padding-top: 8px; border-top: 1px dashed rgba(34, 197, 94, 0.2); }
.byip-title { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.byip-list { display: flex; flex-direction: column; gap: 4px; }
.byip-row {
  display: grid; grid-template-columns: 160px 80px 1fr; gap: 10px;
  align-items: center;
  font-size: 11px;
}
.byip-row code { font-family: var(--mono); color: var(--text); padding: 1px 5px; background: rgba(0,0,0,0.3); border-radius: 3px; }
.byip-count { font-family: var(--mono); color: var(--muted); }
.byip-count strong { color: var(--green); font-weight: 600; }
.byip-row.near .byip-count strong { color: #f97316; }
.byip-bar { height: 5px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
.byip-bar span { display: block; height: 100%; background: var(--green); transition: width 0.2s; }
.byip-row.near .byip-bar span { background: #f97316; }

/* Trojan featured block — only protocol that actually benefits from QR */
.trojan-feature {
  display: flex; gap: 16px; align-items: stretch;
  background: rgba(34, 197, 94, 0.04);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
}
.trojan-qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0; }
.trojan-qr {
  width: 160px; height: 160px; background: #0f1419;
  border-radius: 6px; padding: 6px;
  display: flex; align-items: center; justify-content: center;
}
.trojan-qr :deep(svg) { width: 100%; height: 100%; }
.trojan-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.trojan-title { display: flex; align-items: baseline; gap: 8px; }
.trojan-title strong { font-size: 14px; color: var(--green); }
.trojan-port { font-size: 12px; color: var(--muted); }
.trojan-apps { font-size: 12px; color: var(--text); margin: 0; line-height: 1.5; }
.trojan-note { font-size: 11.5px; color: var(--muted); margin: 0; line-height: 1.5; }
.trojan-url { display: flex; gap: 6px; align-items: center; }
.trojan-url code {
  flex: 1; min-width: 0; font-size: 11px; padding: 6px 8px;
  background: rgba(0,0,0,0.35); border: 1px solid var(--border);
  border-radius: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #9bb8b1;
}

/* Compact list rows for HTTP / SOCKS5 / HTTPS-proxy */
.proto-list { display: flex; flex-direction: column; gap: 6px; }
.proto-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: rgba(0,0,0,0.18);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.proto-tag {
  flex-shrink: 0; min-width: 90px;
  font-size: 11px; font-weight: 600; color: var(--text);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.proto-url {
  flex: 1; min-width: 0;
  font-size: 11.5px; padding: 4px 8px;
  background: rgba(0,0,0,0.35); border: 1px solid var(--border);
  border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #9bb8b1;
}
.proto-qr-btn { padding: 4px 6px; }

/* QR popup */
.qr-modal { width: 460px; max-width: 96vw; }
.qr-modal-body { display: flex; flex-direction: column; gap: 12px; align-items: center; padding: 12px 14px; }
.qr-modal-svg {
  width: 360px; height: 360px; max-width: 100%;
  background: #0f1419; border-radius: 8px; padding: 12px;
  display: flex; align-items: center; justify-content: center;
}
.qr-modal-svg :deep(svg) { width: 100%; height: 100%; }
.qr-modal-url {
  width: 100%; font-size: 10.5px; padding: 6px 8px;
  background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: 5px;
  word-break: break-all; color: #9bb8b1; font-family: var(--mono);
}
.qr-modal-actions { display: flex; gap: 8px; }

@media (max-width: 720px) {
  .trojan-feature { flex-direction: column; align-items: stretch; }
  .trojan-qr-wrap { align-items: flex-start; }
  .proto-row { flex-wrap: wrap; }
  .proto-tag { min-width: 60px; }
}

/* Tap the endpoint / credentials to copy (handy on mobile, harmless on desktop) */
.tap-copy { cursor: pointer; }
.tap-copy:active { opacity: 0.6; }

/* ──────────────────────────────────────────────────────────────────────────
   MOBILE — compact, app-like proxy cards.
   Desktop packs 8 columns into one row; on a phone that collapsed into 8
   full-width stacked lines per proxy (very cluttered). Here each proxy is a
   tight card: endpoint is the hero, credentials beneath, a status pill in the
   corner, and a single full-width action bar. #index + sparkline are dropped
   as noise. Last in the file so it wins the cascade over the desktop grid.
   ────────────────────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .gt-row {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      "cbx label    status"
      "cbx endpoint endpoint"
      "cbx creds    creds"
      "act act      act";
    gap: 2px 10px;
    padding: 10px 12px 8px;
    align-items: center;
    min-height: 0;
    margin-bottom: 8px;
  }
  /* Drop noise on a small screen */
  .gt-row > .pc-idx,
  .gt-row > .spark { display: none !important; }

  .gt-row > .cbx { grid-area: cbx; align-self: center; margin: 0; }
  .gt-row > .gt-row-label { grid-area: label; padding: 0; min-width: 0; }
  .gt-row > .gt-row-label input { width: 100%; }
  .gt-row > .cell-mono:not(.creds) { grid-area: endpoint; padding: 0; }
  .gt-row > .cell-mono:not(.creds) .ip-line { font-size: 14.5px; font-weight: 600; color: var(--text); }
  .gt-row > .cell-mono.creds {
    grid-area: creds; padding: 0; flex-direction: row;
    font-size: 12px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
  }
  .gt-row > .gt-row-status { grid-area: status; justify-content: flex-end; padding: 0; }
  .gt-row > .gt-row-actions { grid-area: act; }

  /* Full-width action bar: Connect on its own line, secondary actions split below */
  .gt-row-actions {
    margin-top: 4px;
    padding: 8px 0 0 !important;
    border-top: 1px solid var(--border-soft);
    display: flex; gap: 6px; flex-wrap: wrap;
    justify-content: stretch !important;
  }
  .gt-row-actions .row-act-btn {
    flex: 1 1 0; min-width: 90px; justify-content: center;
    height: 36px; padding: 0 10px !important;
    background: rgba(255,255,255,0.04) !important;
    border: 1px solid var(--border) !important;
    border-radius: 8px !important;
  }
  .gt-row-actions .row-act-btn.connect-btn {
    flex-basis: 100%; order: -1;
    background: var(--green-soft) !important; border-color: var(--green) !important;
  }

  /* Connect / detail view — stack cleanly, full-tap copy buttons */
  .gt-row-connect { padding: 12px; }
  .trojan-feature { flex-direction: column; align-items: stretch; gap: 12px; padding: 12px; }
  .trojan-qr-wrap { align-items: center; }
  .trojan-url { flex-direction: column; align-items: stretch; gap: 6px; }
  .trojan-url .row-act-btn { justify-content: center; height: 34px; }
  .proto-row { flex-wrap: wrap; gap: 6px 8px; padding: 8px 10px; }
  .proto-tag { min-width: 52px; }
  .proto-url { flex-basis: 100%; order: 3; }
  .proto-row .row-act-btn { flex: 1 1 auto; justify-content: center; height: 32px; }
  .session-head > span { min-width: 0; }
  .byip-row { grid-template-columns: 1fr auto; gap: 4px 10px; }
  .byip-row .byip-bar { grid-column: 1 / -1; }
}
</style>
