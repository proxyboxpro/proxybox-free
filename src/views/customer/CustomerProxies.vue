<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Grid, theme } from 'ant-design-vue'
import {
  CopyOutlined, DashboardOutlined, DeleteOutlined, EyeOutlined, GlobalOutlined, KeyOutlined,
  MobileOutlined, SecurityScanOutlined, TagsOutlined, UnorderedListOutlined, WifiOutlined
} from '@ant-design/icons-vue'
import QRCode from 'qrcode'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync, promptAsync } from '../../ui/feedback'
import CountryFlag from '../../components/CountryFlag.vue'
import SpeedGauge from '../../components/SpeedGauge.vue'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { token } = theme.useToken()
const screens = Grid.useBreakpoint()

const list = ref([])                   // proxies of groups that have been expanded/loaded
const groupSummaries = ref([])         // lightweight per-order summaries (counts only)
const summaryCounts = ref({ total: 0, active: 0, expiring: 0, expired: 0 })
const loadedGroups = ref(new Set())    // group ids whose proxies are in `list`
const loading = ref(false)
function groupIdOf(p) { return p.shared ? `shared-${p.id}` : (p.orderId || `single-${p.id}`) }
// Per-group pagination of the in-group proxy list (10 rows/page) — a 500-proxy
// order would otherwise render every row at once. Keyed by group id (0-based).
const PROXY_PAGE_SIZE = 10
const proxyPage = reactive({})
function proxyPageOf(gid) { return proxyPage[gid] || 0 }
function setProxyPage(gid, pg) { proxyPage[gid] = Math.max(0, pg) }
function proxyPagination(g) {
  return { current: proxyPageOf(g.id) + 1, pageSize: PROXY_PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false, size: 'small' }
}
function onProxyTableChange(g, pag) { setProxyPage(g.id, (pag?.current || 1) - 1) }
// Tool tabs (test/speed/blacklist/ip-info/ping) pick ONE proxy via a dropdown
// (not a chip per proxy — a 500-proxy order rendered 500 chips).
function onPickIpInfo(g, pid) { const p = (g.proxies || []).find((x) => x.id === pid); if (p) pickIpInfo(g, p) }
function proxyOptions(g) {
  return (g.proxies || []).map((p) => ({ value: p.id, label: `${p.label ? p.label + ' · ' : ''}${p.ip || p.bindIp}:${portOf(p)}` }))
}
const search = ref('')
const filterType = ref('all')         // 'all' | 'ipv4' | 'ipv6'
const filterStatus = ref('all')        // 'all' | 'active' | 'expiring' | 'expired' | 'failed'
const err = ref('')                    // load errors (kept visible as an alert)
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
const credsSaving = ref(false)

// ── Tier-2/3 additions ────────────────────────────────────────────────
const filterTag = ref('')                       // tag filter chip
const sparkData = reactive({})                  // sparkData[proxyId] = { up: [], down: [] }
const statsData = reactive({})                  // statsData[groupId] = { uptime, bandwidth, latency }
const testModal = ref(null)                     // proxy object being tested
const testResult = ref(null)                    // result of quick-test
const testBusy = ref(false)
const timelineModal = ref(null)                 // group whose activity timeline is open
const timelineEvents = ref([])
const timelineLoading = ref(false)
const tagEditing = ref('')                      // proxy id whose tags are being edited
const tagDraft = ref('')

// ── Embedded Tools (per-proxy speed test / blacklist / ip-info / ping) ─
const toolsModal = ref(null)                    // { proxy, tool, busy, result, error }

// ── Group-level tabs ──────────────────────────────────────────────────
const activeTabByGroup = reactive({})           // groupId -> tab id ('list' | 'test' | ...)
const bulkTagDraft = reactive({})               // groupId -> draft tag string

// Load lightweight group summaries only (instant even for 1000+ proxy accounts).
// Each group's proxies are fetched lazily on expand via loadGroup(). Re-loads any
// group that was already expanded so a manual refresh keeps it populated.
async function refresh() {
  err.value = ''
  loading.value = true
  try {
    const data = await apiFetch('/api/v1/user/proxies/groups')
    groupSummaries.value = data?.groups || []
    summaryCounts.value = data?.counts || { total: 0, active: 0, expiring: 0, expired: 0 }
    list.value = []
    loadedGroups.value = new Set()
    // Page paints NOW from the lightweight summaries; hydrate each group's
    // proxies in the background (one fetch per group, sequential = gentle) so
    // every per-group action keeps working. Expanding a group loads it
    // immediately via loadGroup() regardless of how far the prefetch has got.
    prefetchAllGroups()
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}
let prefetchToken = 0
async function prefetchAllGroups() {
  const mine = ++prefetchToken
  for (const g of groupSummaries.value) {
    if (mine !== prefetchToken) return   // superseded by a newer refresh
    await loadGroup(g)
  }
}
// Fetch one group's proxies (full creds/URLs) and merge into `list`. No-op if
// already loaded. Accepts a group object or a raw group id.
async function loadGroup(g) {
  const gid = typeof g === 'string' ? g : g?.id
  if (!gid || loadedGroups.value.has(gid)) return
  try {
    const rows = await apiFetch(`/api/v1/user/proxies?orderId=${encodeURIComponent(gid)}`)
    const arr = Array.isArray(rows) ? rows : (rows?.items || [])
    const have = new Set(list.value.map((p) => p.id))
    list.value = [...list.value, ...arr.filter((p) => !have.has(p.id))]
    loadedGroups.value = new Set([...loadedGroups.value, gid])
  } catch (e) { err.value = e.message }
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
// Countdown tier → antd tag preset / token colour.
const TIER_TAG = { active: 'success', soon: 'processing', expiring: 'warning', critical: 'error', expired: 'default', muted: 'default' }
function tierColor(tier) {
  const tk = token.value
  return ({ active: tk.colorSuccess, soon: tk.colorInfo, expiring: tk.colorWarning, critical: tk.colorError, expired: tk.colorError })[tier] || tk.colorTextTertiary
}

// ── Grouping ────────────────────────────────────────────────────────────
// Each group = one order (proxy.orderId). Proxies without orderId fall into
// a synthetic "single" group keyed by proxy.id so they still render.
// Groups come from the server summaries (always present, even when collapsed).
// Each group's `proxies` are attached from `list` once the group is loaded;
// `total`/`active`/`expiring`/`expired` are summary counts for header + status.
const groups = computed(() => {
  const byGroup = new Map()
  for (const p of list.value) {
    const gid = groupIdOf(p)
    if (!byGroup.has(gid)) byGroup.set(gid, [])
    byGroup.get(gid).push(p)
  }
  return groupSummaries.value.map((s) => ({
    ...s,
    country: zoneToCC(s.zone),
    proxies: byGroup.get(s.id) || [],
    loaded: loadedGroups.value.has(s.id)
  }))
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
// Status from server summary counts (works whether or not the group is loaded).
function groupStatus(g) {
  const total = g.total ?? g.proxies.length
  if (total === 0) return 'active'
  if ((g.expired ?? 0) === total) return 'expired'
  if ((g.expiring ?? 0) > 0 && (g.active ?? 0) > 0) return 'expiring'
  if ((g.active ?? 0) === total) return 'active'
  return 'mixed'
}
function statusLabel(s) {
  return ({ active: t('cust.proxies.statusActive'), expiring: t('cust.proxies.statusExpiring'), expired: t('cust.proxies.statusExpired'), mixed: t('cust.proxies.statusMixed') })[s] || s
}
const GROUP_STATUS_COLOR = { active: 'success', expiring: 'warning', expired: 'default', mixed: 'processing' }

const counts = computed(() => summaryCounts.value)

const typeOptions = computed(() => [
  { label: t('cust.proxies.typeAll'), value: 'all' },
  { label: 'IPv4', value: 'ipv4' },
  { label: 'IPv6', value: 'ipv6' }
])
const statusOptions = computed(() => [
  { label: t('cust.proxies.statusAll'), value: 'all' },
  { label: t('cust.proxies.statusActive'), value: 'active' },
  { label: t('cust.proxies.statusExpiring'), value: 'expiring' },
  { label: t('cust.proxies.statusExpired'), value: 'expired' },
  { label: t('cust.proxies.statusFailed'), value: 'failed' }
])
const ROTATE_OPTIONS = computed(() => [
  { label: t('cust.proxies.rotateOff2'), value: 0 },
  ...[[60, '1m'], [180, '3m'], [300, '5m'], [600, '10m'], [900, '15m'], [1800, '30m'], [3600, '1h'], [7200, '2h']].map(([value, label]) => ({ value, label }))
])

// ── Per-group actions ───────────────────────────────────────────────────
function isExpanded(gid) { return expanded.value.has(gid) }
function toggleGroup(gid) {
  const next = new Set(expanded.value)
  if (next.has(gid)) next.delete(gid); else next.add(gid)
  expanded.value = next
}
function hasExpired(g) { return g.proxies.some((p) => p.status === 'expired') }
function allAutoRenew(g) { return g.proxies.every((p) => p.autoRenew) }

// Blob download helper shared by every export / QR / rotate-URL download.
function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  try { await navigator.clipboard.writeText(text); message.success(t('cust.proxies.copied', { n: g.proxies.length })) }
  catch { /* no clipboard — fall through */ }
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
  } catch (e) { message.error(e.message) }
  finally { busy[g.id] = null }
}
function clearCheckResult(g) { delete checkResults[g.id] }
async function extendGroup(g) {
  const hours = Math.max(1, Math.min(8760, Number(extendHours[g.id]) || 24))
  if (!(await confirmAsync({ title: t('cust.proxies.confirmExtend', { n: g.proxies.length, h: hours }) }))) return
  busy[g.id] = 'extend'
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}/extend`, { method: 'POST', body: { hours } })
    }
    message.success(t('cust.proxies.extended', { n: g.proxies.length, h: hours }))
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy[g.id] = null }
}
async function deleteGroup(g) {
  if (!(await confirmAsync({ title: t('cust.proxies.confirmDelete', { n: g.proxies.length }), danger: true }))) return
  busy[g.id] = 'delete'
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    }
    message.success(t('cust.proxies.deleted', { n: g.proxies.length }))
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy[g.id] = null }
}
async function deleteProxy(g, p) {
  if (!(await confirmAsync({ title: t('cust.proxies.confirmDeleteOne'), danger: true }))) return
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    message.success(t('cust.proxies.deleted', { n: 1 }))
    await refresh()
  } catch (e) { message.error(e.message) }
}
const rotating = ref('')
const checking = ref('')

// ── Per-proxy connect drawer (sessions, Trojan QR, protocol URLs) ──────
const drawerProxyId = ref('')
const drawerProxyRef = ref(null)
// Resolve by id so the drawer follows refreshed data; fall back to the
// clicked object while a refresh is re-hydrating `list`.
const drawerProxy = computed(() => (drawerProxyId.value ? (list.value.find((p) => p.id === drawerProxyId.value) || drawerProxyRef.value) : null))
function openProxyDrawer(p) { drawerProxyRef.value = p; drawerProxyId.value = p.id }
function closeProxyDrawer() { drawerProxyId.value = ''; drawerProxyRef.value = null }

async function rotateProxy(p) {
  if (rotating.value) return
  rotating.value = p.id
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/rotate`, { method: 'POST' })
    p.bindIp = r.bindIp
    message.success(t('cust.proxies.ipChanged', { id: p.id, ip: r.bindIp }))
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { rotating.value = '' }
}
async function disconnectAllSessions(p) {
  const [title, ...rest] = t('cust.proxies.disconnectConfirm', { id: p.id }).split('\n\n')
  if (!(await confirmAsync({ title, content: rest.join('\n\n') || undefined, danger: true }))) return
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/disconnect-all`, { method: 'POST' })
    const n = r.kickedLocal ?? 0
    p.session = r.session || p.session
    message.success(t('cust.proxies.disconnected', { n, id: p.id }))
    await refresh()
  } catch (e) { message.error(e.message) }
}
async function checkProxy(p) {
  if (checking.value) return
  checking.value = p.id
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/check`, { method: 'POST' })
    p.status = r.proxy?.status || p.status
    p.lastCheckOk = r.ok
    if (r.ok) message.success(`${p.id} OK (${r.latencyMs}ms)`)
    else message.error(`${p.id} fail: ${r.error || 'error'}`)
  } catch (e) { message.error(e.message) }
  finally { checking.value = '' }
}
async function copyRotateUrl(p) {
  if (!p.rotateUrl) return
  try {
    await navigator.clipboard.writeText(p.rotateUrl)
    message.success(`Copied rotate URL: ${p.rotateUrl}`)
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
  if (urls.length === 0) { message.warning(t('cust.proxies.noRotateUrls')); return }
  try {
    await navigator.clipboard.writeText(urls.join('\n'))
    message.success(t('cust.proxies.rotateUrlsCopied', { n: urls.length }))
  } catch { /* noop */ }
}
function downloadGroupRotateUrls(g) {
  const urls = groupRotateUrls(g)
  if (urls.length === 0) return
  downloadText(urls.join('\n') + '\n', `rotate-urls-${g.orderId || g.id || 'group'}.txt`)
}

async function copyText(text, label) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    message.success(`Copied ${label}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`)
  } catch { /* noop */ }
}

// QR popup — small-icon click expands to large QR + download SVG button.
const qrModal = ref(null) // { url, label }
function openQrModal(url, label) { if (url) qrModal.value = { url, label } }
function closeQrModal() { qrModal.value = null }
// Downloaded SVG keeps the original green-on-dark rendering.
async function downloadQr(url, label) {
  if (!url) return
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 360, color: { dark: '#22c55e', light: '#0f1419' } })
    downloadText(svg, `${label.replace(/[^a-z0-9_-]+/gi, '_')}.svg`, 'image/svg+xml')
  } catch { /* noop */ }
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
  } catch (e) { message.error(e.message) }
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
  } catch (e) { message.error(e.message) }
}

// Aggregate the whitelist of a group (union of all proxies' whitelists — they
// should all be identical in practice since the editor applies to the group).
function groupWhitelist(g) {
  const set = new Set()
  for (const p of g.proxies) for (const ip of (p.allowedSrcIps || [])) set.add(ip)
  return [...set]
}

// Currently editing group object (for the whitelist modal).
const editingGroup = computed(() => groups.value.find((g) => g.id === whitelistEditing.value) || null)

// ── Bulk selection across groups ────────────────────────────────────────
// Each group's table reports its own selection; merge it into the global set.
function rowSelectionOf(g) {
  return {
    selectedRowKeys: g.proxies.filter((p) => selected.value.has(p.id)).map((p) => p.id),
    onChange: (keys) => {
      const next = new Set(selected.value)
      for (const p of g.proxies) next.delete(p.id)
      for (const k of keys) next.add(k)
      selected.value = next
    }
  }
}
async function toggleGroupSel(g) {
  await loadGroup(g)   // need the proxy ids — fetch them if the group isn't loaded yet
  const ids = list.value.filter((p) => groupIdOf(p) === g.id).map((p) => p.id)
  const allOn = ids.length > 0 && ids.every((id) => selected.value.has(id))
  const next = new Set(selected.value)
  for (const id of ids) { if (allOn) next.delete(id); else next.add(id) }
  selected.value = next
}
function isGroupAllSelected(g) {
  return g.loaded && g.proxies.length > 0 && g.proxies.every((p) => selected.value.has(p.id))
}
function isGroupPartSelected(g) {
  return g.loaded && !isGroupAllSelected(g) && g.proxies.some((p) => selected.value.has(p.id))
}
function clearSelection() { selected.value = new Set() }
const selectedProxies = computed(() => list.value.filter((p) => selected.value.has(p.id)))

async function bulkCopy(fmt = 'colon') {
  const text = selectedProxies.value.map((p) => proxyLine(p, fmt)).join('\n')
  try { await navigator.clipboard.writeText(text); message.success(t('cust.proxies.copied', { n: selectedProxies.value.length })) }
  catch { /* noop */ }
}
function bulkExport() {
  const lines = selectedProxies.value.map((p) => proxyLine(p, 'colon'))
  downloadText(lines.join('\n') + '\n', `proxies-selected-${Date.now()}.txt`)
}
async function bulkCheck() {
  try {
    const r = await apiFetch('/api/v1/user/proxies/check-bulk', {
      method: 'POST',
      body: { ids: [...selected.value] }
    })
    message.success(t('cust.proxies.checkDone', { ok: r.ok, fail: r.total - r.ok }))
    await refresh()
  } catch (e) { message.error(e.message) }
}
async function bulkExtend() {
  const hours = Number(await promptAsync({ title: t('cust.proxies.bulkExtendPrompt'), defaultValue: '24', inputType: 'number' }))
  if (!hours || hours < 1) return
  try {
    for (const id of selected.value) {
      await apiFetch(`/api/v1/user/proxies/${id}/extend`, { method: 'POST', body: { hours } })
    }
    message.success(t('cust.proxies.extended', { n: selected.value.size, h: hours }))
    clearSelection()
    await refresh()
  } catch (e) { message.error(e.message) }
}
async function bulkDelete() {
  if (!(await confirmAsync({ title: t('cust.proxies.confirmDelete', { n: selected.value.size }), danger: true }))) return
  try {
    for (const id of selected.value) {
      await apiFetch(`/api/v1/user/proxies/${id}`, { method: 'DELETE' })
    }
    message.success(t('cust.proxies.deleted', { n: selected.value.size }))
    clearSelection()
    await refresh()
  } catch (e) { message.error(e.message) }
}

// ── Inline label edit ──────────────────────────────────────────────────
function openLabelEdit(p) {
  labelEditing.value = p.id
  labelDraft.value = p.label || ''
}
function openGroupLabelEdit(g) {
  labelEditing.value = 'grp-' + g.id
  labelDraft.value = groupLabel(g)
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
  } catch (e) { message.error(e.message) }
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
  } catch (e) { message.error(e.message) }
}
function groupLabel(g) {
  // If every proxy shares the same label, surface it; else show empty.
  const labels = new Set(g.proxies.map((p) => p.label || ''))
  return labels.size === 1 ? [...labels][0] : ''
}

// ── Credentials editor ─────────────────────────────────────────────────
const credsProxy = computed(() => list.value.find((p) => p.id === credsEditing.value) || null)
function openCredsEdit(p) {
  credsEditing.value = p.id
  credsDraft.username = p.username
  credsDraft.password = p.password
  credsErr.value = ''
}
function closeCredsEdit() { credsEditing.value = ''; credsErr.value = '' }
async function saveCreds(p) {
  if (!p) return
  credsErr.value = ''
  credsSaving.value = true
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}`, {
      method: 'PATCH',
      body: { username: credsDraft.username.trim(), password: credsDraft.password }
    })
    p.username = r.username
    p.password = r.password
    closeCredsEdit()
    message.success(t('cust.proxies.credsSaved'))
  } catch (e) { credsErr.value = e.data?.error || e.message }
  finally { credsSaving.value = false }
}

// ── Multi-format export ────────────────────────────────────────────────
// `host` is the customer-facing endpoint (p.ip = node's IPv4 even for IPv6
// proxies). `p.bindIp` is the v6 egress address — NEVER use it for export
// because v4-only clients can't dial a v6 host.
function hostOf(p) { return p.ip || p.bindIp }
function portOf(p) { return p.unifiedPort && p.unifiedPort > 0 ? p.unifiedPort : p.port }
function endpointOf(p) { return `${hostOf(p)}:${portOf(p)}` }
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
  downloadText(text + '\n', `proxies-${g.orderId || g.id}-${fmt}.${ext}`)
}
async function copyFormat(g, fmt) {
  try { await navigator.clipboard.writeText(formatProxies(g.proxies, fmt)); message.success(t('cust.proxies.copied', { n: g.proxies.length })) }
  catch { /* noop */ }
}
// Export dropdown: keys are "copy:<fmt>" or "dl:<fmt>".
function onExportMenu(g, key) {
  const [kind, fmt] = String(key).split(':')
  if (kind === 'copy') copyFormat(g, fmt)
  else exportFormat(g, fmt)
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
    // Sample at most 30 proxies — a per-proxy SLA + history fan-out over a
    // 500-proxy group would fire ~1000 requests on expand. These are average
    // "quick stats", so a sample is representative (bandwidth is sample-scaled).
    const sample = g.proxies.slice(0, 30)
    const scale = sample.length ? g.proxies.length / sample.length : 1
    const [slas, hists] = await Promise.all([
      Promise.all(sample.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/sla?days=7`).catch(() => ({ pct: null })))),
      Promise.all(sample.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/history?hours=720`).catch(() => ({ samples: [] }))))
    ])
    const validPcts = slas.map((s) => s.pct).filter((x) => x !== null && x !== undefined)
    const uptime = validPcts.length ? (validPcts.reduce((a, b) => a + b, 0) / validPcts.length) : null
    let bw = 0
    for (const h of hists) for (const s of (h.samples || [])) bw += Number(s.uploadBytes || 0) + Number(s.downloadBytes || 0)
    bw = Math.round(bw * scale)   // scale the sampled sum back up to the whole group
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
async function toggleGroupExpanded(g) {
  toggleGroup(g.id)
  if (isExpanded(g.id)) {
    await loadGroup(g)                      // lazy-fetch this group's proxies
    const fresh = groups.value.find((x) => x.id === g.id) || g
    loadGroupStats(fresh)
    for (const p of fresh.proxies) loadSpark(p.id)
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
const TOOL_TITLE_KEYS = { 'speed-test': 'cust.proxies.toolSpeed', blacklist: 'cust.proxies.toolBlacklist', 'ip-info': 'cust.proxies.toolIpInfo', ping: 'cust.proxies.toolPing' }
function speedColor(mbps) {
  const tk = token.value
  return mbps >= 50 ? tk.colorSuccess : mbps >= 10 ? tk.colorWarning : tk.colorError
}

// Per-proxy row "more" menu.
function onRowMenu(g, p, key) {
  if (key === 'test') runQuickTest(p)
  else if (key === 'creds') openCredsEdit(p)
  else if (key === 'tags') openTagEdit(p)
  else if (key === 'delete') deleteProxy(g, p)
  else if (TOOL_TITLE_KEYS[key]) runTool(p, key)
}

// ── Group tabs ─────────────────────────────────────────────────────────
const GROUP_TABS = [
  { id: 'list',       labelKey: 'cust.proxies.tabList',      icon: UnorderedListOutlined },
  { id: 'apps',       labelKey: 'cust.proxies.tabApps',      icon: MobileOutlined },
  { id: 'copy',       labelKey: 'cust.proxies.tabCopy',      icon: CopyOutlined },
  { id: 'test',       labelKey: 'cust.proxies.tabTest',      icon: EyeOutlined },
  { id: 'speed-test', labelKey: 'cust.proxies.tabSpeed',     icon: DashboardOutlined },
  { id: 'blacklist',  labelKey: 'cust.proxies.tabBlacklist', icon: SecurityScanOutlined },
  { id: 'ip-info',    labelKey: 'cust.proxies.tabIpInfo',    icon: GlobalOutlined },
  { id: 'ping',       labelKey: 'cust.proxies.tabPing',      icon: WifiOutlined },
  { id: 'creds',      labelKey: 'cust.proxies.tabCreds',     icon: KeyOutlined },
  { id: 'tags',       labelKey: 'cust.proxies.tabTags',      icon: TagsOutlined },
  { id: 'delete',     labelKey: 'cust.proxies.tabDelete',    icon: DeleteOutlined, danger: true }
]
const SINGLE_TOOLS = ['test', 'blacklist', 'ping']
function activeTab(gid) { return activeTabByGroup[gid] || 'list' }
function selectTab(g, tabId) {
  // No auto-run — user clicks "Chạy check" inside the tab to start.
  activeTabByGroup[g.id] = tabId
}

const proxyColumns = computed(() => [
  { title: '#', key: 'idx', width: 56 },
  { title: t('cust.proxies.label'), key: 'label', width: 210 },
  { title: t('cust.proxies.host'), key: 'endpoint', width: 220 },
  { title: t('cust.proxies.creds'), key: 'creds', width: 230 },
  { title: t('cust.proxies.status'), key: 'status', width: 100 },
  { title: t('cust.proxies.spark24h'), key: 'spark', width: 110 },
  { title: t('cust.proxies.actions'), key: 'actions', width: 340 }
])
const credsColumns = computed(() => [
  { title: t('cust.proxies.host'), key: 'endpoint' },
  { title: t('cust.proxies.creds'), key: 'creds' },
  { title: t('cust.proxies.actions'), key: 'actions', width: 170 }
])

// ── Single-IP tools (test / blacklist / ping) — picker + result ──
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
function pingLossType(loss) { return loss === 0 ? 'success' : loss < 100 ? 'warning' : 'danger' }
function blTag(r) {
  if (r.listed === true) return { color: 'error', text: t('cust.proxies.toolBlBad') }
  if (r.listed === false) return { color: 'success', text: t('cust.proxies.toolBlClean') }
  return { color: 'default', text: 'ERR' }
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
const countryOptions = SPEEDTEST_COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))
const speedTestProxy   = reactive({}) // groupId -> proxy id
const speedTestCountry = reactive({}) // groupId -> country code (default 'VN')
const speedTestIsp     = reactive({}) // groupId -> isp string
const speedTestIspsCache = reactive({}) // country -> [{ sponsor, serverCount }]
const speedTestIspsBusy  = reactive({}) // country -> boolean
const speedTestRunning = reactive({}) // groupId -> boolean
const speedTestResult  = reactive({}) // groupId -> result
const speedTestPhase   = reactive({}) // groupId -> 'idle' | 'download' | 'upload' | 'done'
const speedTestGauge   = reactive({}) // groupId -> current animated mbps value
const gaugeAnimTimers = {}            // groupId -> interval handle

function ispOptions(g) {
  const isps = speedTestIspsCache[speedTestCountry[g.id] || 'VN'] || []
  return [
    { value: 'auto', label: t('cust.proxies.stIspAuto') },
    ...isps.map((isp) => ({ value: isp.sponsor.toLowerCase(), label: `${isp.sponsor} (${isp.serverCount} server${isp.serverCount > 1 ? 's' : ''})` }))
  ]
}
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
      const k = elapsed / 15000
      const base = 100 * (1 - Math.exp(-3 * k))
      const noise = (Math.sin(elapsed / 200) + Math.cos(elapsed / 350)) * 5
      speedTestGauge[g.id] = Math.max(0, base + noise)
    } else if (elapsed < 27000) {
      speedTestPhase[g.id] = 'upload'
      const k = (elapsed - 15000) / 12000
      const base = 70 * (1 - Math.exp(-3 * k))
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
function speedButtonLabel(g) {
  if (speedTestRunning[g.id]) return speedTestPhase[g.id] === 'upload' ? t('cust.proxies.stRunningUp') : t('cust.proxies.stRunningDown')
  return speedTestResult[g.id] ? t('cust.proxies.stRerun') : t('cust.proxies.stStart')
}
function speedGaugeLabel(g) {
  if (speedTestRunning[g.id]) return speedTestPhase[g.id] === 'upload' ? t('cust.proxies.stPhaseUpload') : t('cust.proxies.stPhaseDownload')
  return speedTestResult[g.id]?.error || (speedTestResult[g.id] ? t('cust.proxies.stDone') : '')
}
function speedGaugeStatus(g) {
  if (speedTestRunning[g.id]) return 'running'
  if (speedTestResult[g.id]?.error) return 'error'
  return speedTestResult[g.id] ? 'done' : 'idle'
}

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
// Tab opened: init speed-test pickers / auto-select the first IP for ip-info.
watch(() => activeTabByGroup, (next) => {
  for (const [gid, tab] of Object.entries(next)) {
    const g = groups.value.find((x) => x.id === gid)
    if (!g) continue
    if (tab === 'speed-test') speedTestInit(g)
    if (tab === 'ip-info' && !ipInfoSelected[gid] && g.proxies.length) pickIpInfo(g, g.proxies[0])
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
  try {
    for (const p of g.proxies) {
      const next = [...new Set([...(p.tags || []), tag])].slice(0, 10)
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
      p.tags = next
    }
    bulkTagDraft[g.id] = ''
  } catch (e) { message.error(e.message) }
}
async function removeBulkTag(g, tag) {
  try {
    for (const p of g.proxies) {
      const next = (p.tags || []).filter((x) => x !== tag)
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
      p.tags = next
    }
  } catch (e) { message.error(e.message) }
}

// ── Activity timeline ──────────────────────────────────────────────────
async function openTimeline(g) {
  timelineModal.value = g
  timelineEvents.value = []
  timelineLoading.value = true
  try {
    const all = await Promise.all(g.proxies.map((p) => apiFetch(`/api/v1/user/proxies/${p.id}/activity?limit=20`).catch(() => ({ events: [] }))))
    const merged = []
    for (const r of all) for (const ev of (r.events || [])) merged.push(ev)
    merged.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    timelineEvents.value = merged.slice(0, 100)
  } catch { /* noop */ }
  finally { timelineLoading.value = false }
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
    message.success(sec > 0 ? t('cust.proxies.rotateOn', { m: Math.round(sec / 60) }) : t('cust.proxies.rotateOff'))
  } catch (e) { message.error(e.message) }
}
async function toggleAutoRenew(g) {
  const target = !g.proxies.every((p) => p.autoRenew)
  try {
    for (const p of g.proxies) {
      await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { autoRenew: target } })
      p.autoRenew = target
    }
    message.success(target ? t('cust.proxies.autoRenewOn') : t('cust.proxies.autoRenewOff'))
  } catch (e) { message.error(e.message) }
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
  } catch (e) { message.error(e.message) }
}
async function removeTag(p, tag) {
  const next = (p.tags || []).filter((x) => x !== tag)
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'PATCH', body: { tags: next } })
    p.tags = next
  } catch (e) { message.error(e.message) }
}
const allTags = computed(() => {
  const set = new Set()
  for (const p of list.value) for (const tg of (p.tags || [])) set.add(tg)
  return [...set].sort()
})

// Visible groups: type / status (+ "failed" pseudo-status) / tag / search.
const visibleGroups = computed(() => groups.value.filter((g) => {
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

async function ensureDetailExpanded() {
  if (!isDetailMode.value) return
  // Find the matching group, then trigger eager load of proxies + stats + sparklines.
  const g = groups.value.find((x) => x.orderId === orderIdParam.value)
  if (!g) return
  expanded.value = new Set([g.id])
  await loadGroup(g)
  const fresh = groups.value.find((x) => x.id === g.id) || g
  await loadGroupStats(fresh)
  for (const p of fresh.proxies) loadSpark(p.id)
}
watch(groups, ensureDetailExpanded)

// ── Subscription URLs ──────────────────────────────────────────────────
// One token per customer → public /api/sub/<token>?format=… URL that
// Clash / Shadowrocket / Surge / v2rayN fetch directly. Loaded once on
// mount; same token re-used for every group, scoped with &orderId so each
// order has its own subscription link.
const subscription = ref(null)
async function loadSubscription() {
  try { subscription.value = await apiFetch('/api/v1/user/account/subscription') }
  catch { /* silent — sub URL is a convenience, not critical */ }
}
async function rotateSubscriptionToken() {
  if (!(await confirmAsync({ title: t('cust.proxies.subRotateConfirm'), danger: true }))) return
  try {
    await apiFetch('/api/v1/user/account/subscription/rotate', { method: 'POST' })
    await loadSubscription()
    message.success(t('cust.proxies.subRotated'))
  } catch (e) { message.error(e.message) }
}
// Build the per-format subscription URL for one group (order). Appends
// orderId so the link only carries this order's proxies.
function subUrlFor(format, orderId) {
  if (!subscription.value?.urls?.[format]) return ''
  const u = subscription.value.urls[format]
  return orderId ? `${u}&orderId=${encodeURIComponent(orderId)}` : u
}
const SUB_FORMATS = [
  { id: 'sub',   label: 'Subscription', hint: 'v2rayN · Hiddify · Shadowrocket · Stash' },
  { id: 'clash', label: 'Clash',        hint: 'Clash Verge · Mihomo · ClashX' },
  { id: 'surge', label: 'Surge',        hint: 'Surge · Stash (INI)' },
  { id: 'plain', label: 'Plain URLs',   hint: 'curl / scripts' },
  { id: 'json',  label: 'JSON',         hint: 'API automation' }
]
const PROTO_ROWS = [
  { key: 'http', tag: 'HTTP', qr: 'HTTP' },
  { key: 'socks5h', tag: 'SOCKS5', qr: 'SOCKS5' },
  { key: 'httpsProxy', tag: 'HTTPS proxy', qr: 'HTTPSproxy' }
]

onMounted(async () => {
  applyQueryFilter()
  await refresh()
  await ensureDetailExpanded()
  loadSubscription()
  // Live countdown — tick nowMs every second so expiry timers refresh.
  countdownTimer = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
  for (const h of Object.values(gaugeAnimTimers)) clearInterval(h)
})
</script>

<template>
  <div class="page" :class="{ 'has-bulk': selected.size }">
    <!-- Detail mode: back button + focused title -->
    <a-flex v-if="isDetailMode" align="center" gap="small" wrap="wrap">
      <a-button @click="router.push({ name: 'proxies' })">
        <template #icon><ArrowLeftOutlined /></template>
        {{ t('cust.proxies.back') }}
      </a-button>
      <a-typography-text type="secondary">{{ t('cust.proxies.titleFull') }} /</a-typography-text>
      <a-typography-text strong class="mono">{{ orderIdParam }}</a-typography-text>
    </a-flex>

    <a-flex v-else justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('cust.proxies.subtitle') }}</a-typography-text>
      <a-space wrap>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('cust.refresh') }}
        </a-button>
        <a-button type="primary" @click="router.push({ name: 'buy' })">
          <template #icon><PlusOutlined /></template>
          {{ t('cust.product.buy') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI row (hidden in single-order detail mode) -->
    <a-row v-if="!isDetailMode" :gutter="[12, 12]">
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.proxies.kpiTotal')" :value="counts.total">
            <template #prefix><AppstoreOutlined :style="{ color: token.purple }" /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.proxies.kpiActive')" :value="counts.active">
            <template #prefix><SafetyCertificateOutlined :style="{ color: token.colorSuccess }" /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.proxies.kpiExpiring')" :value="counts.expiring">
            <template #prefix><ClockCircleOutlined :style="{ color: token.colorWarning }" /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.proxies.kpiExpired')" :value="counts.expired">
            <template #prefix><ExclamationCircleOutlined :style="{ color: token.colorError }" /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Filters (hidden in single-order detail mode) -->
    <a-card v-if="!isDetailMode" size="small">
      <a-flex wrap="wrap" gap="small" align="center">
        <a-input-search v-model:value="search" allow-clear :placeholder="t('cust.proxies.searchPh')" class="filter-search" />
        <a-segmented v-model:value="filterType" :options="typeOptions" />
        <a-select v-model:value="filterStatus" :options="statusOptions" class="filter-select" />
      </a-flex>
      <a-flex v-if="allTags.length" wrap="wrap" gap="small" align="center" class="tag-filter">
        <a-typography-text type="secondary"><TagsOutlined /> {{ t('cust.proxies.tagFilter') }}:</a-typography-text>
        <a-checkable-tag :checked="!filterTag" @change="filterTag = ''">{{ t('cust.proxies.tagAll') }}</a-checkable-tag>
        <a-checkable-tag v-for="tg in allTags" :key="tg" :checked="filterTag === tg" @change="filterTag = filterTag === tg ? '' : tg">#{{ tg }}</a-checkable-tag>
      </a-flex>
    </a-card>

    <!-- First load -->
    <a-card v-if="loading && !groupSummaries.length"><a-skeleton active /></a-card>

    <!-- Empty state -->
    <a-card v-else-if="!visibleGroups.length">
      <a-empty :description="t('cust.proxies.empty')">
        <a-button type="primary" @click="router.push({ name: 'buy' })">
          <template #icon><PlusOutlined /></template>
          {{ t('cust.product.buy') }}
        </a-button>
      </a-empty>
    </a-card>

    <!-- Group cards (one per order) -->
    <a-card v-for="g in visibleGroups" :key="g.id" size="small">
      <!-- Header: select · expand · order id · label · meta -->
      <a-flex align="center" gap="small" wrap="wrap">
        <a-tooltip :title="t('cust.proxies.selectAllGroup')">
          <a-checkbox :checked="isGroupAllSelected(g)" :indeterminate="isGroupPartSelected(g)" @change="toggleGroupSel(g)" />
        </a-tooltip>
        <a-button type="text" size="small" @click="toggleGroupExpanded(g)">
          <template #icon><UpOutlined v-if="isExpanded(g.id)" /><DownOutlined v-else /></template>
        </a-button>
        <div class="group-id">
          <a-typography-text strong class="mono">{{ g.orderId || g.proxies[0]?.id }}</a-typography-text>
          <a-typography-text type="secondary" class="small-text">{{ fmtTs(g.createdAt) }}</a-typography-text>
        </div>
        <!-- Group label (editable) — applies to every proxy in the group. -->
        <a-space-compact v-if="labelEditing === ('grp-' + g.id)" size="small">
          <a-input v-model:value="labelDraft" :maxlength="64" :placeholder="t('cust.proxies.labelPh')" class="label-input" @press-enter="saveGroupLabel(g)" @keydown.esc="cancelLabelEdit" />
          <a-button type="primary" @click="saveGroupLabel(g)"><template #icon><CheckOutlined /></template></a-button>
          <a-button @click="cancelLabelEdit"><template #icon><CloseOutlined /></template></a-button>
        </a-space-compact>
        <a-space v-else :size="2">
          <a-typography-text v-if="groupLabel(g)" strong>{{ groupLabel(g) }}</a-typography-text>
          <a-typography-text v-else type="secondary" italic>{{ t('cust.proxies.labelEmpty') }}</a-typography-text>
          <a-tooltip :title="t('cust.proxies.labelEdit')">
            <a-button type="text" size="small" @click="openGroupLabelEdit(g)"><template #icon><EditOutlined /></template></a-button>
          </a-tooltip>
        </a-space>

        <a-flex align="center" gap="small" wrap="wrap" class="group-meta">
          <a-tag :color="g.type === 'IPv6' ? 'purple' : 'blue'" :bordered="false">{{ g.type }}</a-tag>
          <a-typography-text type="secondary"><ClusterOutlined /> {{ g.total ?? g.proxies.length }} {{ t('cust.buy.proxyUnit') }}</a-typography-text>
          <a-typography-text type="secondary" class="zone">
            <CountryFlag v-if="g.country" :code="g.country" :size="14" />
            {{ g.zone || '—' }}
          </a-typography-text>
          <span class="mono countdown" :class="{ pulse: fmtCountdown(g.expiresAt).tier === 'critical' }" :style="{ color: tierColor(fmtCountdown(g.expiresAt).tier) }">
            <ClockCircleOutlined /> {{ fmtCountdown(g.expiresAt).text }}
          </span>
          <StatusTag :status="groupStatus(g)" :label="statusLabel(groupStatus(g))" :color="GROUP_STATUS_COLOR[groupStatus(g)]" />
          <a-tooltip v-if="!isDetailMode && g.orderId" :title="t('cust.proxies.viewDetail')">
            <a-button size="small" type="link" @click="router.push({ name: 'proxy-order', params: { orderId: g.orderId } })">
              <template #icon><ExportOutlined /></template>
              {{ t('cust.proxies.view') }}
            </a-button>
          </a-tooltip>
        </a-flex>
      </a-flex>

      <a-divider class="group-divider" />

      <!-- Quick action row, always visible -->
      <a-flex wrap="wrap" gap="small" align="center">
        <a-button size="small" :disabled="!!busy[g.id]" @click="copyGroup(g, 'colon')">
          <template #icon><CopyOutlined /></template>
          {{ t('cust.proxies.copy') }}
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button size="small">
            <template #icon><DownloadOutlined /></template>
            {{ t('cust.proxies.export') }} <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="({ key }) => onExportMenu(g, key)">
              <a-menu-item key="copy:colon"><template #icon><CopyOutlined /></template><span class="mono">{{ t('cust.proxies.fmtColon') }}</span></a-menu-item>
              <a-menu-item key="copy:url-http"><template #icon><CopyOutlined /></template><span class="mono">{{ t('cust.proxies.fmtUrlHttp') }}</span></a-menu-item>
              <a-menu-item key="copy:url-socks5"><template #icon><CopyOutlined /></template><span class="mono">{{ t('cust.proxies.fmtUrlSocks5') }}</span></a-menu-item>
              <a-menu-item key="copy:curl"><template #icon><CodeOutlined /></template>{{ t('cust.proxies.fmtCurl') }}</a-menu-item>
              <a-menu-item-group :title="t('cust.proxies.download')">
                <a-menu-item key="dl:colon"><template #icon><DownloadOutlined /></template>TXT</a-menu-item>
                <a-menu-item key="dl:env"><template #icon><DownloadOutlined /></template>.env</a-menu-item>
                <a-menu-item key="dl:json"><template #icon><DownloadOutlined /></template>JSON</a-menu-item>
                <a-menu-item key="dl:switchyomega"><template #icon><DownloadOutlined /></template>SwitchyOmega .pac</a-menu-item>
                <a-menu-item key="dl:foxyproxy"><template #icon><DownloadOutlined /></template>FoxyProxy .xml</a-menu-item>
              </a-menu-item-group>
            </a-menu>
          </template>
        </a-dropdown>
        <a-button size="small" :loading="busy[g.id] === 'check'" :disabled="!!busy[g.id] && busy[g.id] !== 'check'" @click="checkGroup(g)">
          <template #icon><SafetyCertificateOutlined /></template>
          {{ t('cust.proxies.checkLive') }}
        </a-button>
        <a-badge :count="groupWhitelist(g).length" size="small" :number-style="{ backgroundColor: token.colorSuccess }">
          <a-button size="small" @click="openWhitelist(g.id)">
            <template #icon><ThunderboltOutlined /></template>
            {{ t('cust.proxies.ipAuth') }}
          </a-button>
        </a-badge>
        <a-tooltip :title="t('cust.proxies.expiresAtTitle') + fmtTs(g.expiresAt)">
          <a-tag :color="TIER_TAG[fmtCountdown(g.expiresAt).tier]" class="countdown-tag">
            <ClockCircleOutlined />
            {{ t('cust.proxies.remaining') }}
            <strong class="mono" :class="{ pulse: fmtCountdown(g.expiresAt).tier === 'critical' }">{{ fmtCountdown(g.expiresAt).text }}</strong>
          </a-tag>
        </a-tooltip>
        <a-space-compact size="small">
          <a-input-number v-model:value="extendHours[g.id]" :min="1" :max="8760" placeholder="24h" class="extend-hours" />
          <a-button type="primary" :ghost="!hasExpired(g)" :loading="busy[g.id] === 'extend'" :disabled="!!busy[g.id] && busy[g.id] !== 'extend'" @click="extendGroup(g)">
            <template #icon><FieldTimeOutlined /></template>
            {{ hasExpired(g) ? t('cust.proxies.renewNow') : t('cust.proxies.extend') }}
          </a-button>
        </a-space-compact>
        <template v-if="g.type === 'IPv6'">
          <a-tooltip :title="t('cust.proxies.rotateSchedHint')">
            <a-select size="small" :value="g.proxies[0]?.rotateEverySec || 0" :options="ROTATE_OPTIONS" class="rotate-select" @change="(v) => setRotateInterval(g, v)">
              <template #suffixIcon><FieldTimeOutlined /></template>
            </a-select>
          </a-tooltip>
          <!-- IPv6 only: bulk copy + download of the magic rotate URLs for this
               group (v4 proxies don't expose a rotate URL — egress IP is fixed). -->
          <a-tooltip :title="t('cust.proxies.copyRotateUrlsHint')">
            <a-button size="small" @click="copyGroupRotateUrls(g)">
              <template #icon><LinkOutlined /></template>
              {{ t('cust.proxies.copyRotateUrls') }}
            </a-button>
          </a-tooltip>
          <a-tooltip :title="t('cust.proxies.downloadRotateUrlsHint')">
            <a-button size="small" @click="downloadGroupRotateUrls(g)">
              <template #icon><DownloadOutlined /></template>
              {{ t('cust.proxies.downloadRotateUrls') }}
            </a-button>
          </a-tooltip>
        </template>
        <a-button size="small" :type="allAutoRenew(g) ? 'primary' : 'default'" :ghost="allAutoRenew(g)" @click="toggleAutoRenew(g)">
          <template #icon><SyncOutlined /></template>
          {{ allAutoRenew(g) ? t('cust.proxies.autoRenewOn2') : t('cust.proxies.autoRenewToggle') }}
        </a-button>
        <a-button size="small" @click="openTimeline(g)">
          <template #icon><HistoryOutlined /></template>
          {{ t('cust.proxies.timeline') }}
        </a-button>
        <a-button size="small" danger :loading="busy[g.id] === 'delete'" :disabled="!!busy[g.id] && busy[g.id] !== 'delete'" @click="deleteGroup(g)">
          <template #icon><DeleteOutlined /></template>
          {{ t('cust.proxies.deleteGroup') }}
        </a-button>
      </a-flex>

      <!-- Quick stats (loaded lazily when group is expanded) -->
      <a-row v-if="isExpanded(g.id) && statsData[g.id]" :gutter="[12, 12]" class="quick-stats">
        <a-col :xs="8">
          <a-statistic :title="t('cust.proxies.statsBandwidth')" :value="fmtBytes(statsData[g.id].bandwidth)" :value-style="{ fontSize: '18px' }" />
          <a-typography-text type="secondary" class="small-text">{{ t('cust.proxies.stats30d') }}</a-typography-text>
        </a-col>
        <a-col :xs="8">
          <a-statistic :title="t('cust.proxies.statsUptime')" :value="statsData[g.id].uptime !== null ? statsData[g.id].uptime.toFixed(1) + '%' : '—'" :value-style="{ fontSize: '18px' }" />
          <a-typography-text type="secondary" class="small-text">{{ t('cust.proxies.stats7d') }}</a-typography-text>
        </a-col>
        <a-col :xs="8">
          <a-statistic :title="t('cust.proxies.statsLatency')" :value="statsData[g.id].latency !== null ? statsData[g.id].latency + ' ms' : '—'" :value-style="{ fontSize: '18px' }" />
          <a-typography-text type="secondary" class="small-text">{{ t('cust.proxies.statsAvg') }}</a-typography-text>
        </a-col>
      </a-row>

      <!-- Check live results inline -->
      <a-alert
        v-if="checkResults[g.id]"
        type="success"
        show-icon
        closable
        class="check-result"
        :message="t('cust.proxies.checkDone', { ok: checkResults[g.id].ok, fail: checkResults[g.id].fail })"
        @close="clearCheckResult(g)"
      />

      <!-- Expanded body: tabs with group-wide tools -->
      <template v-if="isExpanded(g.id)">
        <a-divider class="group-divider" />
        <a-flex v-if="!g.loaded" justify="center" class="group-spin"><a-spin /></a-flex>
        <a-tabs v-else :active-key="activeTab(g.id)" size="small" destroy-inactive-tab-pane @change="(k) => selectTab(g, k)">
          <a-tab-pane v-for="tab in GROUP_TABS" :key="tab.id">
            <template #tab>
              <a-typography-text v-if="tab.danger" type="danger"><component :is="tab.icon" /> {{ t(tab.labelKey) }}</a-typography-text>
              <span v-else><component :is="tab.icon" /> {{ t(tab.labelKey) }}</span>
            </template>

            <!-- ── LIST tab (default): proxy table ── -->
            <a-table
              v-if="tab.id === 'list'"
              :columns="proxyColumns"
              :data-source="g.proxies"
              :pagination="proxyPagination(g)"
              :row-selection="rowSelectionOf(g)"
              row-key="id"
              size="small"
              :scroll="{ x: 1200 }"
              @change="(pag) => onProxyTableChange(g, pag)"
            >
              <template #bodyCell="{ column, record: p, index }">
                <template v-if="column.key === 'idx'">
                  <a-typography-text type="secondary" class="mono">#{{ proxyPageOf(g.id) * PROXY_PAGE_SIZE + index + 1 }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'label'">
                  <a-space-compact v-if="labelEditing === p.id" size="small">
                    <a-input v-model:value="labelDraft" :maxlength="64" :placeholder="t('cust.proxies.labelPh')" @press-enter="saveLabel(p)" @keydown.esc="cancelLabelEdit" />
                    <a-button type="primary" @click="saveLabel(p)"><template #icon><CheckOutlined /></template></a-button>
                    <a-button @click="cancelLabelEdit"><template #icon><CloseOutlined /></template></a-button>
                  </a-space-compact>
                  <a-space v-else :size="2">
                    <a-typography-text v-if="p.label" strong>{{ p.label }}</a-typography-text>
                    <a-button type="text" size="small" class="label-add" @click="openLabelEdit(p)">
                      <template #icon><EditOutlined /></template>
                      {{ p.label ? '' : t('cust.proxies.labelEmpty') }}
                    </a-button>
                  </a-space>
                  <!-- Per-proxy tags (row menu → "Thêm/bớt tag" opens the input) -->
                  <a-flex v-if="(p.tags && p.tags.length) || tagEditing === p.id" wrap="wrap" gap="4" align="center" class="row-tags">
                    <a-tag v-for="tg in (p.tags || [])" :key="tg" closable :bordered="false" color="blue" @close.prevent="removeTag(p, tg)">#{{ tg }}</a-tag>
                    <a-space-compact v-if="tagEditing === p.id" size="small">
                      <a-input v-model:value="tagDraft" placeholder="tag-name" class="tag-input" @press-enter="addTag(p)" @keydown.esc="cancelTagEdit" />
                      <a-button @click="addTag(p)"><template #icon><PlusOutlined /></template></a-button>
                      <a-button @click="cancelTagEdit"><template #icon><CloseOutlined /></template></a-button>
                    </a-space-compact>
                  </a-flex>
                </template>
                <template v-else-if="column.key === 'endpoint'">
                  <a-typography-text class="mono" :copyable="{ text: endpointOf(p) }">{{ endpointOf(p) }}</a-typography-text>
                  <div v-if="p.type === 'IPv6' && p.bindIp && p.bindIp !== p.ip">
                    <a-tooltip :title="p.bindIp">
                      <a-typography-text type="secondary" class="mono small-text egress">↳ {{ p.bindIp }}</a-typography-text>
                    </a-tooltip>
                  </div>
                </template>
                <template v-else-if="column.key === 'creds'">
                  <a-typography-text class="mono" :copyable="{ text: `${p.username}:${p.password}` }">{{ p.username }}:{{ p.password }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'status'">
                  <StatusTag :status="p.status" />
                </template>
                <template v-else-if="column.key === 'spark'">
                  <a-tooltip v-if="sparkData[p.id]?.down?.length" :title="t('cust.proxies.spark24h')">
                    <svg class="spark" viewBox="0 0 80 18" preserveAspectRatio="none">
                      <path :d="sparkPath(sparkData[p.id].down)" fill="none" :stroke="token.colorInfo" stroke-width="1" />
                      <path :d="sparkPath(sparkData[p.id].up)" fill="none" :stroke="token.colorSuccess" stroke-width="1" />
                    </svg>
                  </a-tooltip>
                  <a-typography-text v-else type="secondary">—</a-typography-text>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <a-space :size="4" wrap>
                    <a-tooltip :title="t('cust.proxies.tipConnect')">
                      <a-button size="small" type="primary" ghost @click="openProxyDrawer(p)">
                        <template #icon><LinkOutlined /></template>
                        {{ t('cust.proxies.connectLabel') }}
                      </a-button>
                    </a-tooltip>
                    <a-tooltip v-if="p.type === 'IPv6'" :title="t('cust.proxies.tipRotate')">
                      <a-button size="small" :disabled="!!rotating && rotating !== p.id" @click="rotateProxy(p)">
                        <template #icon><SyncOutlined :spin="rotating === p.id" /></template>
                        {{ rotating === p.id ? t('cust.proxies.rotating') : t('cust.proxies.rotateIp') }}
                      </a-button>
                    </a-tooltip>
                    <a-tooltip v-if="p.type === 'IPv6' && p.rotateUrl">
                      <template #title><strong>{{ t('cust.proxies.copyRotateUrl') }}</strong> — {{ t('cust.proxies.tipCopyRotate') }}<br /><span class="mono">{{ p.rotateUrl }}</span></template>
                      <a-button size="small" :aria-label="t('cust.proxies.copyRotateUrl')" @click="copyRotateUrl(p)">
                        <template #icon><LinkOutlined /></template>
                      </a-button>
                    </a-tooltip>
                    <a-tooltip :title="t('cust.proxies.tipCheck')">
                      <a-button size="small" :disabled="!!checking && checking !== p.id" @click="checkProxy(p)">
                        <template #icon><ReloadOutlined :spin="checking === p.id" /></template>
                        {{ checking === p.id ? 'Checking…' : 'Check' }}
                      </a-button>
                    </a-tooltip>
                    <a-dropdown :trigger="['click']" placement="bottomRight">
                      <a-button size="small"><template #icon><EllipsisOutlined /></template></a-button>
                      <template #overlay>
                        <a-menu @click="({ key }) => onRowMenu(g, p, key)">
                          <a-menu-item key="test"><template #icon><EyeOutlined /></template>{{ t('cust.proxies.testBrowser') }}</a-menu-item>
                          <a-menu-item-group :title="t('cust.proxies.tools')">
                            <a-menu-item key="speed-test"><template #icon><DashboardOutlined /></template>{{ t('cust.proxies.toolSpeed') }}</a-menu-item>
                            <a-menu-item key="blacklist"><template #icon><SecurityScanOutlined /></template>{{ t('cust.proxies.toolBlacklist') }}</a-menu-item>
                            <a-menu-item key="ip-info"><template #icon><GlobalOutlined /></template>{{ t('cust.proxies.toolIpInfo') }}</a-menu-item>
                            <a-menu-item key="ping"><template #icon><WifiOutlined /></template>{{ t('cust.proxies.toolPing') }}</a-menu-item>
                          </a-menu-item-group>
                          <a-menu-divider />
                          <a-menu-item key="creds"><template #icon><KeyOutlined /></template>{{ t('cust.proxies.editCreds') }}</a-menu-item>
                          <a-menu-item key="tags"><template #icon><TagsOutlined /></template>{{ t('cust.proxies.tagsEdit') }}</a-menu-item>
                          <a-menu-divider />
                          <a-menu-item key="delete" danger><template #icon><DeleteOutlined /></template>{{ t('cust.proxies.deleteOne') }}</a-menu-item>
                        </a-menu>
                      </template>
                    </a-dropdown>
                  </a-space>
                </template>
              </template>
            </a-table>

            <!-- ── APPS tab: subscription URLs for Clash / Shadowrocket / Surge / v2rayN ── -->
            <template v-else-if="tab.id === 'apps'">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.tabAppsHint') }}</a-typography-paragraph>
              <a-flex v-if="!subscription" align="center" gap="small">
                <a-spin size="small" />
                <a-typography-text type="secondary">{{ t('cust.proxies.subLoading') }}</a-typography-text>
              </a-flex>
              <template v-else>
                <a-list size="small" bordered :data-source="SUB_FORMATS" row-key="id">
                  <template #renderItem="{ item: fmt }">
                    <a-list-item>
                      <a-flex vertical gap="4" class="sub-item">
                        <a-space wrap :size="6">
                          <a-typography-text strong>{{ fmt.label }}</a-typography-text>
                          <a-typography-text type="secondary" class="small-text">{{ fmt.hint }}</a-typography-text>
                        </a-space>
                        <a-typography-text class="mono small-text" :copyable="{ text: subUrlFor(fmt.id, g.id) }">{{ subUrlFor(fmt.id, g.id) }}</a-typography-text>
                        <a-space wrap :size="6">
                          <a-button size="small" @click="copyText(subUrlFor(fmt.id, g.id), fmt.label + ' subscription')">
                            <template #icon><CopyOutlined /></template>{{ t('cust.proxies.copyUrl') }}
                          </a-button>
                          <a-button size="small" @click="openQrModal(subUrlFor(fmt.id, g.id), fmt.label + ' sub')">
                            <template #icon><QrcodeOutlined /></template>QR
                          </a-button>
                          <a-button size="small" :href="subUrlFor(fmt.id, g.id)" target="_blank" rel="noopener">
                            <template #icon><ExportOutlined /></template>{{ t('cust.proxies.openUrl') }}
                          </a-button>
                        </a-space>
                      </a-flex>
                    </a-list-item>
                  </template>
                </a-list>
                <a-alert type="warning" show-icon class="sub-rotate" :message="t('cust.proxies.subRotateNote')">
                  <template #action>
                    <a-button size="small" @click="rotateSubscriptionToken">
                      <template #icon><SyncOutlined /></template>{{ t('cust.proxies.subRotate') }}
                    </a-button>
                  </template>
                </a-alert>
              </template>
            </template>

            <!-- ── COPY tab ── -->
            <template v-else-if="tab.id === 'copy'">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.tabCopyHint', { n: g.proxies.length }) }}</a-typography-paragraph>
              <a-row :gutter="[8, 8]">
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="copyFormat(g, 'colon')"><template #icon><CopyOutlined /></template><span class="mono">host:port:user:pass</span></a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="copyFormat(g, 'url-http')"><template #icon><CopyOutlined /></template><span class="mono">http://user:pass@host:port</span></a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="copyFormat(g, 'url-socks5')"><template #icon><CopyOutlined /></template><span class="mono">socks5://user:pass@host:port</span></a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="copyFormat(g, 'curl')"><template #icon><CodeOutlined /></template>cURL command</a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="exportFormat(g, 'colon')"><template #icon><DownloadOutlined /></template>Download TXT</a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="exportFormat(g, 'env')"><template #icon><DownloadOutlined /></template>Download .env</a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="exportFormat(g, 'json')"><template #icon><DownloadOutlined /></template>Download JSON</a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="exportFormat(g, 'switchyomega')"><template #icon><DownloadOutlined /></template>Download SwitchyOmega .pac</a-button></a-col>
                <a-col :xs="24" :sm="12" :lg="8"><a-button block class="copy-btn" @click="exportFormat(g, 'foxyproxy')"><template #icon><DownloadOutlined /></template>Download FoxyProxy .xml</a-button></a-col>
              </a-row>
            </template>

            <!-- ── IP INFO tab: pick one IP, show full key-value table ── -->
            <template v-else-if="tab.id === 'ip-info'">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.ipInfoHint') }}</a-typography-paragraph>
              <a-select
                :value="ipInfoSelected[g.id]"
                :options="proxyOptions(g)"
                :placeholder="t('cust.proxies.singlePickHint')"
                show-search
                option-filter-prop="label"
                class="proxy-picker"
                @change="(v) => onPickIpInfo(g, v)"
              />
              <template v-if="ipInfoSelected[g.id]">
                <a-flex v-if="ipInfoBusy[ipInfoSelected[g.id]]" vertical align="center" gap="small" class="tool-wait">
                  <a-spin />
                  <a-typography-text type="secondary">{{ t('cust.proxies.toolRunning') }}</a-typography-text>
                </a-flex>
                <a-alert v-else-if="ipInfoData[ipInfoSelected[g.id]]?.error" type="error" show-icon :message="ipInfoData[ipInfoSelected[g.id]].error" />
                <template v-else-if="ipInfoData[ipInfoSelected[g.id]]">
                  <a-descriptions bordered size="small" :column="1" class="tool-desc">
                    <a-descriptions-item :label="t('cust.proxies.ipInfoIp')"><a-typography-text class="mono" copyable>{{ ipInfoData[ipInfoSelected[g.id]].ip }}</a-typography-text></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoFamily')"><span class="mono">{{ (ipInfoData[ipInfoSelected[g.id]].family || '—').toUpperCase() }}</span></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoAsn')"><span class="mono">{{ ipInfoData[ipInfoSelected[g.id]].asn || '—' }}</span></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoCidr')"><span class="mono">{{ ipInfoData[ipInfoSelected[g.id]].cidr || '—' }}</span></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoCountry')">
                      <a-space :size="6">
                        <CountryFlag v-if="ipInfoData[ipInfoSelected[g.id]].country && ipInfoData[ipInfoSelected[g.id]].country.length === 2" :code="ipInfoData[ipInfoSelected[g.id]].country" :size="14" />
                        <span class="mono">{{ ipInfoData[ipInfoSelected[g.id]].country || '—' }}</span>
                      </a-space>
                    </a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoRegistry')"><span class="mono">{{ (ipInfoData[ipInfoSelected[g.id]].registry || '—').toUpperCase() }}</span></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoAllocDate')"><span class="mono">{{ ipInfoData[ipInfoSelected[g.id]].allocDate || '—' }}</span></a-descriptions-item>
                    <a-descriptions-item :label="t('cust.proxies.ipInfoOrg')"><span class="mono">{{ ipInfoData[ipInfoSelected[g.id]].org || '—' }}</span></a-descriptions-item>
                  </a-descriptions>
                  <a-button size="small" class="tool-refresh" @click="refreshIpInfo(g)">
                    <template #icon><ReloadOutlined /></template>{{ t('cust.refresh') }}
                  </a-button>
                </template>
              </template>
            </template>

            <!-- ── SPEED TEST tab: picker + country/ISP + animated gauge ── -->
            <template v-else-if="tab.id === 'speed-test'">
              <a-form layout="vertical">
                <a-row :gutter="12">
                  <a-col :xs="24" :md="10">
                    <a-form-item :label="t('cust.proxies.stProxy')">
                      <a-select
                        :value="speedTestProxy[g.id]"
                        :options="proxyOptions(g)"
                        :placeholder="t('cust.proxies.singlePickHint')"
                        show-search
                        option-filter-prop="label"
                        @change="(v) => (speedTestProxy[g.id] = v)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :sm="12" :md="7">
                    <a-form-item :label="t('cust.proxies.stCountry')">
                      <a-select :value="speedTestCountry[g.id] || 'VN'" :options="countryOptions" show-search option-filter-prop="label" @change="(v) => setSpeedTestCountry(g.id, v)" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :sm="12" :md="7">
                    <a-form-item :label="t('cust.proxies.stIsp')" :extra="speedTestIspsBusy[speedTestCountry[g.id] || 'VN'] ? t('cust.proxies.stLoadingIsps') : undefined">
                      <a-select :value="speedTestIsp[g.id] || 'auto'" :options="ispOptions(g)" :loading="!!speedTestIspsBusy[speedTestCountry[g.id] || 'VN']" @change="(v) => (speedTestIsp[g.id] = v)" />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-space wrap>
                  <a-button type="primary" :loading="!!speedTestRunning[g.id]" :disabled="!speedTestProxy[g.id]" @click="runSpeedTest(g)">
                    <template v-if="!speedTestRunning[g.id]" #icon><PlayCircleOutlined /></template>
                    {{ speedButtonLabel(g) }}
                  </a-button>
                  <a-button v-if="speedTestResult[g.id] && !speedTestRunning[g.id]" @click="resetSpeedTest(g)">
                    <template #icon><CloseOutlined /></template>{{ t('cust.proxies.batchReset') }}
                  </a-button>
                </a-space>
              </a-form>

              <!-- Speedometer gauge (visible while running or after result) -->
              <a-flex v-if="speedTestRunning[g.id] || speedTestResult[g.id]" justify="center" class="st-gauge">
                <SpeedGauge
                  :value="speedTestGauge[g.id] || 0"
                  :max="null"
                  :status="speedGaugeStatus(g)"
                  :label="speedGaugeLabel(g)"
                  :size="260"
                />
              </a-flex>

              <!-- Result metrics (ping, download, upload, server) -->
              <template v-if="speedTestResult[g.id] && !speedTestResult[g.id].error">
                <a-row :gutter="[12, 12]">
                  <a-col :xs="8">
                    <a-card size="small"><a-statistic :title="t('cust.proxies.stPing')" :value="speedTestResult[g.id].pingMs" suffix="ms" /></a-card>
                  </a-col>
                  <a-col :xs="8">
                    <a-card size="small"><a-statistic :title="t('cust.proxies.stDownload')" :value="speedTestResult[g.id].downloadMbps || 0" :precision="2" suffix="Mbps" :value-style="{ color: token.colorInfo }" /></a-card>
                  </a-col>
                  <a-col :xs="8">
                    <a-card size="small"><a-statistic :title="t('cust.proxies.stUpload')" :value="speedTestResult[g.id].uploadMbps || 0" :precision="2" suffix="Mbps" :value-style="{ color: token.colorSuccess }" /></a-card>
                  </a-col>
                </a-row>
                <a-descriptions bordered size="small" :column="1" class="tool-desc">
                  <a-descriptions-item :label="t('cust.proxies.stServer')">
                    <span class="mono">{{ speedTestResult[g.id].server?.sponsor }} · {{ speedTestResult[g.id].server?.name }} · {{ speedTestResult[g.id].server?.country }}</span>
                  </a-descriptions-item>
                </a-descriptions>
              </template>
            </template>

            <!-- ── Single-IP tool tabs (test / blacklist / ping) ── -->
            <template v-else-if="SINGLE_TOOLS.includes(tab.id)">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.singlePickHint') }}</a-typography-paragraph>
              <a-flex wrap="wrap" gap="small" align="center">
                <a-select
                  :value="pickedProxy(g, tab.id)"
                  :options="proxyOptions(g)"
                  :placeholder="t('cust.proxies.singlePickHint')"
                  show-search
                  option-filter-prop="label"
                  class="proxy-picker"
                  @change="(v) => setPickedProxy(g, tab.id, v)"
                />
                <a-button type="primary" :loading="singleBusy(g, tab.id)" :disabled="!pickedProxy(g, tab.id)" @click="runSingleTool(g, tab.id)">
                  <template v-if="!singleBusy(g, tab.id)" #icon><PlayCircleOutlined /></template>
                  {{ singleBusy(g, tab.id)
                    ? t('cust.proxies.batchRowRunning')
                    : singleResult(g, tab.id)
                      ? t('cust.proxies.batchRerun')
                      : t('cust.proxies.singleRun') }}
                </a-button>
              </a-flex>

              <a-flex v-if="singleBusy(g, tab.id)" vertical align="center" gap="small" class="tool-wait">
                <a-spin />
                <a-typography-text type="secondary">{{ t('cust.proxies.toolRunning') }}</a-typography-text>
              </a-flex>
              <a-alert v-else-if="singleResult(g, tab.id)?.error" type="error" show-icon class="tool-desc" :message="singleResult(g, tab.id).error" />

              <!-- TEST result -->
              <a-descriptions v-else-if="tab.id === 'test' && singleResult(g, 'test')" bordered size="small" :column="1" class="tool-desc">
                <a-descriptions-item :label="t('cust.proxies.testStatus')">
                  <StatusTag :status="singleResult(g, 'test').ok ? 'ok' : 'failed'" :label="singleResult(g, 'test').ok ? 'OK' : 'FAIL'" />
                </a-descriptions-item>
                <a-descriptions-item :label="t('cust.proxies.testExitIp')"><span class="mono">{{ singleResult(g, 'test').exitIp || '—' }}</span></a-descriptions-item>
                <a-descriptions-item :label="t('cust.proxies.testLatency')"><span class="mono">{{ singleResult(g, 'test').latencyMs }} ms</span></a-descriptions-item>
              </a-descriptions>

              <!-- BLACKLIST result (summary + DNSBL list) -->
              <div v-else-if="tab.id === 'blacklist' && singleResult(g, 'blacklist')" class="tool-desc">
                <a-alert :type="singleResult(g, 'blacklist').listed > 0 ? 'error' : 'success'" show-icon>
                  <template #message>
                    <strong>{{ singleResult(g, 'blacklist').listed }}</strong> / {{ singleResult(g, 'blacklist').total }} {{ t('cust.proxies.toolBlListed') }}
                    · {{ singleResult(g, 'blacklist').clean }} clean · {{ singleResult(g, 'blacklist').errors }} errors
                  </template>
                </a-alert>
                <a-list size="small" bordered class="bl-list" :data-source="singleResult(g, 'blacklist').results || []">
                  <template #renderItem="{ item: r }">
                    <a-list-item>
                      <a-flex justify="space-between" align="center" gap="small" wrap="wrap" class="bl-row">
                        <span>{{ r.name }}</span>
                        <a-typography-text type="secondary" class="mono small-text">{{ r.host }}</a-typography-text>
                        <a-tag :color="blTag(r).color" :bordered="false">{{ blTag(r).text }}</a-tag>
                      </a-flex>
                    </a-list-item>
                  </template>
                </a-list>
              </div>

              <!-- PING result (stats + each packet) -->
              <a-descriptions v-else-if="tab.id === 'ping' && singleResult(g, 'ping')" bordered size="small" :column="1" class="tool-desc">
                <a-descriptions-item :label="t('cust.proxies.pingLoss')">
                  <a-typography-text strong :type="pingLossType(singleResult(g, 'ping').loss)">{{ singleResult(g, 'ping').loss }}%</a-typography-text>
                  <span class="mono ping-packets">{{ singleResult(g, 'ping').received }}/{{ singleResult(g, 'ping').transmitted }} packets</span>
                </a-descriptions-item>
                <template v-if="singleResult(g, 'ping').rtt">
                  <a-descriptions-item :label="t('cust.proxies.pingRttMin')"><span class="mono">{{ singleResult(g, 'ping').rtt.min.toFixed(2) }} ms</span></a-descriptions-item>
                  <a-descriptions-item :label="t('cust.proxies.pingRttAvg')"><strong class="mono">{{ singleResult(g, 'ping').rtt.avg.toFixed(2) }} ms</strong></a-descriptions-item>
                  <a-descriptions-item :label="t('cust.proxies.pingRttMax')"><span class="mono">{{ singleResult(g, 'ping').rtt.max.toFixed(2) }} ms</span></a-descriptions-item>
                </template>
                <a-descriptions-item v-if="singleResult(g, 'ping').samples?.length" :label="t('cust.proxies.pingSamples')">
                  <a-space wrap :size="[8, 2]">
                    <span v-for="s in singleResult(g, 'ping').samples" :key="s.seq" class="mono">#{{ s.seq }}: {{ s.time.toFixed(1) }}ms</span>
                  </a-space>
                </a-descriptions-item>
              </a-descriptions>
            </template>

            <!-- ── EDIT CREDENTIALS tab ── -->
            <template v-else-if="tab.id === 'creds'">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.tabCredsHint') }}</a-typography-paragraph>
              <a-table
                :columns="credsColumns"
                :data-source="g.proxies"
                :pagination="proxyPagination(g)"
                row-key="id"
                size="small"
                :scroll="{ x: 640 }"
                @change="(pag) => onProxyTableChange(g, pag)"
              >
                <template #bodyCell="{ column, record: p }">
                  <span v-if="column.key === 'endpoint'" class="mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
                  <span v-else-if="column.key === 'creds'" class="mono">{{ p.username }}:{{ p.password }}</span>
                  <a-button v-else-if="column.key === 'actions'" size="small" @click="openCredsEdit(p)">
                    <template #icon><KeyOutlined /></template>{{ t('cust.proxies.editCreds') }}
                  </a-button>
                </template>
              </a-table>
            </template>

            <!-- ── TAGS tab ── -->
            <template v-else-if="tab.id === 'tags'">
              <a-typography-paragraph type="secondary">{{ t('cust.proxies.tabTagsHint') }}</a-typography-paragraph>
              <a-flex wrap="wrap" gap="small" align="center">
                <a-typography-text type="secondary">{{ t('cust.proxies.tabTagsCommon') }}:</a-typography-text>
                <a-tag v-for="tg in commonTags(g)" :key="tg" closable color="blue" :bordered="false" @close.prevent="removeBulkTag(g, tg)">#{{ tg }}</a-tag>
                <a-typography-text v-if="!commonTags(g).length" type="secondary" italic>{{ t('cust.proxies.tabTagsEmpty') }}</a-typography-text>
              </a-flex>
              <a-space-compact class="bulk-tag-input">
                <a-input v-model:value="bulkTagDraft[g.id]" placeholder="tag-name (a-z 0-9 _ -)" @press-enter="addBulkTag(g)" />
                <a-button type="primary" @click="addBulkTag(g)"><template #icon><PlusOutlined /></template>{{ t('cust.proxies.tabTagsAdd') }}</a-button>
              </a-space-compact>
            </template>

            <!-- ── DELETE tab ── -->
            <a-alert
              v-else-if="tab.id === 'delete'"
              type="error"
              show-icon
              :message="t('cust.proxies.tabDeleteTitle')"
              :description="t('cust.proxies.tabDeleteHint', { n: g.proxies.length })"
            >
              <template #icon><DeleteOutlined /></template>
              <template #action>
                <a-button danger type="primary" :loading="busy[g.id] === 'delete'" @click="deleteGroup(g)">
                  {{ t('cust.proxies.tabDeleteConfirm', { n: g.proxies.length }) }}
                </a-button>
              </template>
            </a-alert>
          </a-tab-pane>
        </a-tabs>
      </template>
    </a-card>

    <!-- ── Floating bulk action toolbar (when N proxies selected) ── -->
    <div v-if="selected.size" class="bulk-bar">
      <a-card size="small" :body-style="{ padding: '8px 12px' }" :style="{ boxShadow: token.boxShadowSecondary }">
        <a-flex wrap="wrap" gap="small" align="center">
          <a-typography-text strong>{{ t('cust.proxies.bulkSelected', { n: selected.size }) }}</a-typography-text>
          <a-button size="small" @click="bulkCopy('colon')"><template #icon><CopyOutlined /></template>{{ t('cust.proxies.copy') }}</a-button>
          <a-button size="small" @click="bulkExport"><template #icon><DownloadOutlined /></template>{{ t('cust.proxies.exportTxt') }}</a-button>
          <a-button size="small" @click="bulkCheck"><template #icon><SafetyCertificateOutlined /></template>{{ t('cust.proxies.checkLive') }}</a-button>
          <a-button size="small" type="primary" @click="bulkExtend"><template #icon><FieldTimeOutlined /></template>{{ t('cust.proxies.extend') }}</a-button>
          <a-button size="small" danger @click="bulkDelete"><template #icon><DeleteOutlined /></template>{{ t('cust.proxies.deleteGroup') }}</a-button>
          <a-tooltip :title="t('cust.proxies.clearSelection')">
            <a-button size="small" type="text" @click="clearSelection"><template #icon><CloseOutlined /></template></a-button>
          </a-tooltip>
        </a-flex>
      </a-card>
    </div>

    <!-- ── Per-proxy connect drawer: details, sessions, Trojan QR, protocol URLs ── -->
    <a-drawer :open="!!drawerProxy" :width="screens.md ? 620 : '100%'" @close="closeProxyDrawer">
      <template #title>
        <a-space :size="8" wrap>
          <LinkOutlined />
          <span>{{ t('cust.proxies.connectLabel') }}</span>
          <a-typography-text v-if="drawerProxy" type="secondary" class="mono">{{ endpointOf(drawerProxy) }}</a-typography-text>
        </a-space>
      </template>
      <a-flex v-if="drawerProxy" vertical gap="middle">
        <a-descriptions bordered size="small" :column="1">
          <a-descriptions-item :label="t('cust.proxies.host')">
            <a-typography-text class="mono" :copyable="{ text: endpointOf(drawerProxy) }">{{ endpointOf(drawerProxy) }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item v-if="drawerProxy.type === 'IPv6' && drawerProxy.bindIp" :label="t('cust.proxies.egressIp')">
            <a-typography-text class="mono" copyable>{{ drawerProxy.bindIp }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item :label="t('cust.proxies.creds')">
            <a-typography-text class="mono" :copyable="{ text: `${drawerProxy.username}:${drawerProxy.password}` }">{{ drawerProxy.username }}:{{ drawerProxy.password }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item :label="t('cust.proxies.status')">
            <a-space :size="6" wrap>
              <StatusTag :status="drawerProxy.status" />
              <a-tag :color="drawerProxy.type === 'IPv6' ? 'purple' : 'blue'" :bordered="false">{{ drawerProxy.type }}</a-tag>
              <a-tooltip v-if="drawerProxy.expiresAt" :title="t('cust.proxies.expiresAtTitle') + fmtTs(drawerProxy.expiresAt)">
                <span class="mono" :style="{ color: tierColor(fmtCountdown(drawerProxy.expiresAt).tier) }">
                  <ClockCircleOutlined /> {{ fmtCountdown(drawerProxy.expiresAt).text }}
                </span>
              </a-tooltip>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item :label="t('cust.proxies.label')">
            <a-typography-text v-if="drawerProxy.label" strong>{{ drawerProxy.label }}</a-typography-text>
            <a-typography-text v-else type="secondary" italic>{{ t('cust.proxies.labelEmpty') }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item v-if="drawerProxy.tags?.length" :label="t('cust.proxies.tabTags')">
            <a-tag v-for="tg in drawerProxy.tags" :key="tg" color="blue" :bordered="false">#{{ tg }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <!-- Sessions / connection caps -->
        <a-card size="small">
          <a-flex justify="space-between" align="center" gap="small" wrap="wrap" class="session-head">
            <a-space :size="6" wrap>
              <SafetyCertificateOutlined />
              <a-typography-text strong class="mono" :type="(drawerProxy.session?.active || 0) >= (drawerProxy.session?.max || 100) ? 'danger' : undefined">
                {{ drawerProxy.session?.active ?? 0 }}/{{ drawerProxy.session?.max ?? 100 }}
              </a-typography-text>
              <a-typography-text strong>{{ t('cust.proxies.activeConns') }}</a-typography-text>
            </a-space>
            <a-tooltip :title="t('cust.proxies.tipDisconnect')">
              <a-button size="small" danger @click="disconnectAllSessions(drawerProxy)">
                <template #icon><DisconnectOutlined /></template>{{ t('cust.proxies.disconnectAll') }}
              </a-button>
            </a-tooltip>
          </a-flex>
          <a-typography-text type="secondary" class="small-text">
            max <strong>{{ drawerProxy.session?.max ?? 100 }}/proxy</strong> · <strong>{{ drawerProxy.session?.maxPerIp ?? 60 }}/IP</strong> · burst <strong>{{ drawerProxy.session?.rateLimit ?? 30 }}/s/IP</strong>. {{ t('cust.proxies.overCapNote') }}
          </a-typography-text>
          <template v-if="(drawerProxy.session?.byIp || []).length">
            <a-divider class="group-divider" />
            <a-typography-text type="secondary" class="small-text">{{ t('cust.proxies.byIpTitle') }}</a-typography-text>
            <div v-for="row in (drawerProxy.session?.byIp || [])" :key="row.ip" class="byip-row">
              <a-flex justify="space-between" gap="small">
                <span class="mono">{{ row.ip }}</span>
                <span class="mono"><strong>{{ row.count }}</strong>/{{ drawerProxy.session?.maxPerIp ?? 60 }}</span>
              </a-flex>
              <a-progress
                :percent="Math.min(100, Math.round((row.count / (drawerProxy.session?.maxPerIp || 60)) * 100))"
                :status="row.count >= (drawerProxy.session?.maxPerIp || 60) * 0.8 ? 'exception' : 'normal'"
                :show-info="false"
                size="small"
              />
            </div>
          </template>
        </a-card>

        <!-- Trojan (TLS) -->
        <a-card v-if="drawerProxy.connectUrls?.trojan" size="small">
          <template #title>
            <a-space :size="6">
              <span>Trojan</span>
              <a-typography-text type="secondary" class="mono">:{{ drawerProxy.tlsPort }}</a-typography-text>
            </a-space>
          </template>
          <a-row :gutter="[16, 12]">
            <a-col :xs="24" :sm="10">
              <a-flex vertical align="center" gap="small">
                <a-qrcode :value="drawerProxy.connectUrls.trojan" :size="180" :color="token.colorText" :bg-color="token.colorBgContainer" />
                <a-button size="small" @click="downloadQr(drawerProxy.connectUrls.trojan, 'trojan-' + drawerProxy.id)">
                  <template #icon><DownloadOutlined /></template>Download QR
                </a-button>
              </a-flex>
            </a-col>
            <a-col :xs="24" :sm="14">
              <a-typography-paragraph type="secondary" class="small-text">v2rayN (Win) • v2rayNG (Android) • Shadowrocket (iOS) • Clash Verge (Mac) • Hiddify</a-typography-paragraph>
              <a-typography-paragraph class="small-text">{{ t('cust.proxies.trojanNote') }}</a-typography-paragraph>
              <a-typography-paragraph class="mono small-text" :copyable="{ text: drawerProxy.connectUrls.trojan }">{{ drawerProxy.connectUrls.trojan }}</a-typography-paragraph>
              <a-button size="small" @click="copyText(drawerProxy.connectUrls.trojan, 'Trojan')">
                <template #icon><CopyOutlined /></template>Copy URL
              </a-button>
            </a-col>
          </a-row>
        </a-card>

        <!-- Protocol URLs -->
        <a-list size="small" bordered :data-source="PROTO_ROWS" row-key="key">
          <template #renderItem="{ item: proto }">
            <a-list-item>
              <a-flex vertical gap="4" class="proto-item">
                <a-flex justify="space-between" align="center" gap="small" wrap="wrap">
                  <a-tag color="green" :bordered="false">{{ proto.tag }}</a-tag>
                  <a-space :size="4">
                    <a-button size="small" @click="copyText(drawerProxy.connectUrls?.[proto.key], proto.tag)">
                      <template #icon><CopyOutlined /></template>Copy
                    </a-button>
                    <a-tooltip :title="'Show QR for ' + proto.tag">
                      <a-button size="small" @click="openQrModal(drawerProxy.connectUrls?.[proto.key], proto.qr + '-' + drawerProxy.id)">
                        <template #icon><QrcodeOutlined /></template>
                      </a-button>
                    </a-tooltip>
                  </a-space>
                </a-flex>
                <a-typography-text class="mono small-text">{{ drawerProxy.connectUrls?.[proto.key] || '—' }}</a-typography-text>
              </a-flex>
            </a-list-item>
          </template>
        </a-list>
      </a-flex>
    </a-drawer>

    <!-- ── IP whitelist modal ── -->
    <a-modal :open="!!editingGroup" :title="t('cust.proxies.ipAuthTitle')" :footer="null" @cancel="closeWhitelist">
      <template v-if="editingGroup">
        <a-typography-paragraph type="secondary">{{ t('cust.proxies.ipAuthHint') }}</a-typography-paragraph>
        <a-flex wrap="wrap" gap="small" class="wl-list">
          <a-tag v-for="ip in groupWhitelist(editingGroup)" :key="ip" closable class="mono" @close.prevent="removeWhitelistIp(editingGroup, ip)">{{ ip }}</a-tag>
          <a-typography-text v-if="!groupWhitelist(editingGroup).length" type="secondary" italic>{{ t('cust.proxies.ipAuthEmpty') }}</a-typography-text>
        </a-flex>
        <a-space-compact block>
          <a-input v-model:value="whitelistInput" class="mono" :placeholder="t('cust.proxies.ipAuthPh') + ' — CIDR OK'" @press-enter="addWhitelistIp(editingGroup)" />
          <a-button type="primary" @click="addWhitelistIp(editingGroup)"><template #icon><PlusOutlined /></template>{{ t('cust.proxies.ipAuthAdd') }}</a-button>
        </a-space-compact>
      </template>
    </a-modal>

    <!-- ── Credentials editor modal ── -->
    <a-modal
      :open="!!credsEditing"
      :title="t('cust.proxies.credsTitle')"
      :ok-text="t('common.save')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="credsSaving"
      @ok="saveCreds(credsProxy)"
      @cancel="closeCredsEdit"
    >
      <a-typography-paragraph type="secondary">{{ t('cust.proxies.credsHint') }}</a-typography-paragraph>
      <a-form layout="vertical" :model="credsDraft">
        <a-form-item :label="t('cust.proxies.credsUsername')" name="username">
          <a-input v-model:value="credsDraft.username" :maxlength="40" class="mono" autofocus />
        </a-form-item>
        <a-form-item :label="t('cust.proxies.credsPassword')" name="password">
          <a-input v-model:value="credsDraft.password" :maxlength="64" class="mono" @press-enter="saveCreds(credsProxy)" />
        </a-form-item>
      </a-form>
      <a-alert v-if="credsErr" type="error" show-icon :message="credsErr" />
    </a-modal>

    <!-- ── Quick-test (test in browser) modal ── -->
    <a-modal :open="!!testModal" @cancel="closeTest">
      <template #title><EyeOutlined /> {{ t('cust.proxies.testTitle') }}</template>
      <template v-if="testModal">
        <a-typography-paragraph type="secondary">
          <span class="mono">{{ testModal.ip || testModal.bindIp }}:{{ testModal.port }}</span> · {{ testModal.username }}
        </a-typography-paragraph>
        <a-flex v-if="testBusy" vertical align="center" gap="small" class="tool-wait">
          <a-spin />
          <a-typography-text type="secondary">{{ t('cust.proxies.testRunning') }}</a-typography-text>
        </a-flex>
        <a-descriptions v-else-if="testResult" bordered size="small" :column="1">
          <a-descriptions-item :label="t('cust.proxies.testStatus')">
            <StatusTag :status="testResult.ok ? 'ok' : 'failed'" :label="testResult.ok ? t('cust.proxies.testOk') : t('cust.proxies.testFail')" />
          </a-descriptions-item>
          <a-descriptions-item v-if="testResult.exitIp" :label="t('cust.proxies.testExitIp')"><span class="mono">{{ testResult.exitIp }}</span></a-descriptions-item>
          <a-descriptions-item :label="t('cust.proxies.testLatency')"><span class="mono">{{ testResult.latencyMs }} ms</span></a-descriptions-item>
          <a-descriptions-item v-if="testResult.error" :label="t('cust.proxies.testError')"><a-typography-text type="danger" class="mono">{{ testResult.error }}</a-typography-text></a-descriptions-item>
        </a-descriptions>
      </template>
      <template #footer>
        <a-button @click="closeTest">{{ t('common.close') }}</a-button>
        <a-button v-if="!testBusy && testModal" type="primary" @click="runQuickTest(testModal)">{{ t('cust.proxies.testRetry') }}</a-button>
      </template>
    </a-modal>

    <!-- ── Embedded Tools result modal ── -->
    <a-modal :open="!!toolsModal" :width="560" @cancel="closeToolsModal">
      <template #title><ToolOutlined /> {{ toolsModal ? t(TOOL_TITLE_KEYS[toolsModal.tool]) : '' }}</template>
      <template v-if="toolsModal">
        <a-typography-paragraph type="secondary"><span class="mono">{{ (toolsModal.proxy.ip || toolsModal.proxy.bindIp) }}:{{ toolsModal.proxy.port }}</span></a-typography-paragraph>

        <a-flex v-if="toolsModal.busy" vertical align="center" gap="small" class="tool-wait">
          <a-spin />
          <a-typography-text type="secondary">{{ toolsModal.tool === 'speed-test' ? t('cust.proxies.toolSpeedRunning') : t('cust.proxies.toolRunning') }}</a-typography-text>
        </a-flex>

        <a-alert v-else-if="toolsModal.error" type="error" show-icon :message="toolsModal.error" />

        <!-- Speed test result -->
        <template v-else-if="toolsModal.tool === 'speed-test' && toolsModal.result">
          <a-flex justify="center" class="tool-hero">
            <a-statistic :value="toolsModal.result.mbps || 0" :precision="2" suffix="Mbps" :value-style="{ color: speedColor(toolsModal.result.mbps || 0), fontSize: '36px' }" />
          </a-flex>
          <a-descriptions bordered size="small" :column="1">
            <a-descriptions-item :label="t('cust.proxies.toolSpeedServer')">{{ toolsModal.result.server?.sponsor }} · {{ toolsModal.result.server?.name }}</a-descriptions-item>
            <a-descriptions-item :label="t('cust.proxies.toolSpeedBytes')"><span class="mono">{{ fmtBytes(toolsModal.result.totalBytes) }}</span></a-descriptions-item>
            <a-descriptions-item :label="t('cust.proxies.toolSpeedDuration')"><span class="mono">{{ ((toolsModal.result.durationMs || 0) / 1000).toFixed(2) }} s</span></a-descriptions-item>
            <a-descriptions-item :label="t('cust.proxies.toolSpeedTtfb')"><span class="mono">{{ toolsModal.result.ttfbMs }} ms</span></a-descriptions-item>
          </a-descriptions>
        </template>

        <!-- Blacklist result -->
        <template v-else-if="toolsModal.tool === 'blacklist' && toolsModal.result">
          <a-alert :type="toolsModal.result.listed > 0 ? 'error' : 'success'" show-icon>
            <template #message><strong>{{ toolsModal.result.listed }}</strong> / {{ toolsModal.result.total }} {{ t('cust.proxies.toolBlListed') }}</template>
          </a-alert>
          <a-list size="small" bordered class="bl-list" :data-source="toolsModal.result.results || []">
            <template #renderItem="{ item: r }">
              <a-list-item>
                <a-flex justify="space-between" align="center" gap="small" wrap="wrap" class="bl-row">
                  <span>{{ r.name }}</span>
                  <a-typography-text type="secondary" class="mono small-text">{{ r.host }}</a-typography-text>
                  <a-tag :color="blTag(r).color" :bordered="false">{{ blTag(r).text }}</a-tag>
                </a-flex>
              </a-list-item>
            </template>
          </a-list>
        </template>

        <!-- IP info result -->
        <a-descriptions v-else-if="toolsModal.tool === 'ip-info' && toolsModal.result" bordered size="small" :column="1">
          <a-descriptions-item label="IP"><span class="mono">{{ toolsModal.result.ip }}</span></a-descriptions-item>
          <a-descriptions-item label="ASN"><span class="mono">{{ toolsModal.result.asn || '—' }}</span></a-descriptions-item>
          <a-descriptions-item label="CIDR"><span class="mono">{{ toolsModal.result.cidr || '—' }}</span></a-descriptions-item>
          <a-descriptions-item :label="t('cust.tools.ipInfo.country')"><span class="mono">{{ toolsModal.result.country || '—' }}</span></a-descriptions-item>
          <a-descriptions-item :label="t('cust.tools.ipInfo.registry')"><span class="mono">{{ (toolsModal.result.registry || '—').toUpperCase() }}</span></a-descriptions-item>
          <a-descriptions-item :label="t('cust.tools.ipInfo.org')"><span class="mono">{{ toolsModal.result.org || '—' }}</span></a-descriptions-item>
        </a-descriptions>

        <!-- Ping result -->
        <template v-else-if="toolsModal.tool === 'ping' && toolsModal.result">
          <a-alert :type="toolsModal.result.ok ? 'success' : 'error'" show-icon>
            <template #message>
              <strong>{{ toolsModal.result.received }}</strong> / {{ toolsModal.result.transmitted }} {{ t('cust.proxies.toolPingReceived') }} · {{ toolsModal.result.loss }}% loss
            </template>
          </a-alert>
          <a-descriptions v-if="toolsModal.result.rtt" bordered size="small" :column="1" class="tool-desc">
            <a-descriptions-item label="RTT avg"><span class="mono">{{ toolsModal.result.rtt.avg.toFixed(1) }} ms</span></a-descriptions-item>
            <a-descriptions-item label="RTT min"><span class="mono">{{ toolsModal.result.rtt.min.toFixed(1) }} ms</span></a-descriptions-item>
            <a-descriptions-item label="RTT max"><span class="mono">{{ toolsModal.result.rtt.max.toFixed(1) }} ms</span></a-descriptions-item>
          </a-descriptions>
        </template>
      </template>
      <template #footer>
        <a-button @click="closeToolsModal">{{ t('common.close') }}</a-button>
        <a-button v-if="toolsModal && !toolsModal.busy" type="primary" @click="runTool(toolsModal.proxy, toolsModal.tool)">{{ t('cust.proxies.toolRetry') }}</a-button>
      </template>
    </a-modal>

    <!-- ── Activity timeline modal ── -->
    <a-modal :open="!!timelineModal" :width="560" :footer="null" :body-style="{ maxHeight: '65vh', overflowY: 'auto' }" @cancel="closeTimeline">
      <template #title><HistoryOutlined /> {{ t('cust.proxies.timelineTitle') }}</template>
      <a-typography-paragraph type="secondary">{{ t('cust.proxies.timelineHint') }}</a-typography-paragraph>
      <a-flex v-if="timelineLoading" justify="center" class="tool-wait"><a-spin /></a-flex>
      <a-empty v-else-if="!timelineEvents.length" :description="t('cust.proxies.timelineEmpty')" />
      <a-timeline v-else class="timeline">
        <a-timeline-item v-for="(ev, i) in timelineEvents" :key="i">
          <a-space :size="6" wrap>
            <a-typography-text type="secondary" class="mono small-text">{{ String(ev.ts || '').slice(0, 16).replace('T', ' ') }}</a-typography-text>
            <a-tag :bordered="false" class="mono">{{ ev.method }}</a-tag>
            <span>{{ ev.note || ev.path }}</span>
          </a-space>
        </a-timeline-item>
      </a-timeline>
    </a-modal>

    <!-- ── QR modal: full-size QR + download ── -->
    <a-modal :open="!!qrModal" :footer="null" :width="420" @cancel="closeQrModal">
      <template #title><QrcodeOutlined /> {{ qrModal?.label }}</template>
      <a-flex v-if="qrModal" vertical align="center" gap="middle">
        <a-qrcode :value="qrModal.url" :size="280" :color="token.colorText" :bg-color="token.colorBgContainer" />
        <a-typography-paragraph class="mono small-text qr-url" :copyable="{ text: qrModal.url }">{{ qrModal.url }}</a-typography-paragraph>
        <a-space wrap>
          <a-button @click="copyText(qrModal.url, qrModal.label)"><template #icon><CopyOutlined /></template>Copy URL</a-button>
          <a-button @click="downloadQr(qrModal.url, qrModal.label)"><template #icon><DownloadOutlined /></template>Download SVG</a-button>
        </a-space>
      </a-flex>
    </a-modal>
  </div>
</template>

<style scoped>
.has-bulk { padding-bottom: 72px; }
.filter-search { width: 320px; max-width: 100%; }
.filter-select { width: 180px; }
.tag-filter { margin-top: 12px; }

.group-id { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
.group-meta { margin-left: auto; }
.group-divider { margin: 12px 0; }
.group-spin { padding: 16px 0; }
.small-text { font-size: 12px; }
.zone { display: inline-flex; align-items: center; gap: 6px; }
.zone :deep(.country-flag) { vertical-align: 0; }
.countdown { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.countdown-tag { margin-inline-end: 0; }
.countdown-tag strong { font-variant-numeric: tabular-nums; }
.pulse { animation: pb-pulse 1s ease-in-out infinite; }
@keyframes pb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

.extend-hours { width: 84px; }
.rotate-select { width: 150px; }
.label-input { width: 200px; }
.label-add { padding-inline: 0; }
.row-tags { margin-top: 4px; }
.row-tags :deep(.ant-tag) { margin-inline-end: 0; }
.tag-input { width: 110px; }
.egress { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.spark { width: 80px; height: 18px; display: block; }

.quick-stats { margin-top: 12px; }
.check-result { margin-top: 12px; }

.proxy-picker { width: 100%; max-width: 420px; }
.tool-wait { padding: 24px 0; }
.tool-desc { margin-top: 12px; }
.tool-refresh { margin-top: 12px; }
.tool-hero { margin: 4px 0 12px; }
.bl-list { margin-top: 8px; max-height: 320px; overflow-y: auto; }
.bl-row { width: 100%; }
.ping-packets { margin-left: 8px; }
.st-gauge { margin: 16px 0; }

.sub-item { width: 100%; min-width: 0; }
.sub-rotate { margin-top: 12px; }
.copy-btn { text-align: left; overflow: hidden; text-overflow: ellipsis; }
.bulk-tag-input { margin-top: 12px; max-width: 420px; }

.proto-item { width: 100%; min-width: 0; }
.session-head { margin-bottom: 8px; }
.byip-row { margin-top: 8px; }
.wl-list { margin-bottom: 12px; min-height: 24px; }
.qr-url { max-width: 100%; text-align: center; margin-bottom: 0; }
.timeline { margin-top: 8px; }

.bulk-bar {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 100; width: max-content; max-width: calc(100vw - 32px);
}
</style>
