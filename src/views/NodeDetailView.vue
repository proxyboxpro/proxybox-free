<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Activity, AlertCircle, ArrowLeft, BarChart3, Bell, ChevronDown, ChevronRight, Cpu, Download, FileText, HardDrive, Network, Pause, Play, RefreshCw, Server, Terminal, Trash2, Trash, Users, Wrench, Zap } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { fetchNode, syncNode, removeNode, installNode } from '../store/nodes'
import { formatBytes } from '../utils/format'

const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts'))

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const node = ref(null)
const loading = ref(true)
const errorText = ref('')
const syncing = ref(false)
const installing = ref(false)
const installOutput = ref('')
const familySaving = ref(false)
const logsOpen = ref(false)
const logsLoading = ref(false)
const logsOutput = ref('')
const logsLines = ref(200)
const logsErr = ref('')

const nodeId = computed(() => route.params.nodeId)
const isLocal = computed(() => nodeId.value === 'local')

async function load() {
  loading.value = true; errorText.value = ''
  try { node.value = await fetchNode(nodeId.value) }
  catch (e) { errorText.value = e.message; node.value = null }
  finally { loading.value = false }
}

async function onSync() {
  if (syncing.value) return
  syncing.value = true
  try { await syncNode(nodeId.value); setTimeout(load, 1500) }
  catch (e) { errorText.value = e.message }
  finally { syncing.value = false }
}

async function setFamily(fam) {
  if (familySaving.value) return
  if (node.value && (node.value.family || '').toLowerCase() === fam) return
  familySaving.value = true; errorText.value = ''
  try {
    const updated = await apiFetch(`/api/nodes/${nodeId.value}`, { method: 'PATCH', body: { family: fam } })
    node.value = { ...node.value, ...updated }
    setTimeout(load, 300)
  } catch (e) { errorText.value = e.message }
  finally { familySaving.value = false }
}

async function onInstall() {
  if (installing.value || isLocal.value) return
  installing.value = true; installOutput.value = ''
  try {
    const r = await installNode(nodeId.value)
    installOutput.value = r.output || r.error || (r.ok ? 'OK' : 'failed')
    setTimeout(load, 1500)
  } catch (e) { installOutput.value = e.message }
  finally { installing.value = false }
}

async function onDelete() {
  if (isLocal.value) return
  if (!confirm(t('nodes.confirmDelete'))) return
  try { await removeNode(nodeId.value); router.push({ name: 'admin-nodes' }) }
  catch (e) { errorText.value = e.message }
}

const upgrade = ref(null)
const upgradeLoading = ref(false)
const upgradeCopied = ref(false)
async function loadUpgrade() {
  if (isLocal.value) return
  upgradeLoading.value = true
  try { upgrade.value = await apiFetch(`/api/nodes/${nodeId.value}/upgrade-command`) }
  catch (e) { errorText.value = e.message }
  finally { upgradeLoading.value = false }
}
async function rotateUpgradeToken() {
  if (!confirm('Tạo token mới? URL cũ sẽ ngừng hoạt động.')) return
  upgradeLoading.value = true
  try { upgrade.value = await apiFetch(`/api/nodes/${nodeId.value}/upgrade-command`, { method: 'POST' }) }
  catch (e) { errorText.value = e.message }
  finally { upgradeLoading.value = false }
}
async function copyUpgradeCmd() {
  if (!upgrade.value?.oneLiner) return
  try { await navigator.clipboard.writeText(upgrade.value.oneLiner); upgradeCopied.value = true; setTimeout(() => { upgradeCopied.value = false }, 2000) } catch { /* noop */ }
}

async function fetchLogs() {
  if (logsLoading.value) return
  logsLoading.value = true; logsErr.value = ''
  try {
    const r = await apiFetch(`/api/nodes/${nodeId.value}/logs?lines=${Math.max(10, Math.min(5000, Number(logsLines.value) || 200))}`)
    logsOutput.value = r.output || r.error || ''
  } catch (e) { logsErr.value = e.message }
  finally { logsLoading.value = false }
}
function toggleLogs() {
  logsOpen.value = !logsOpen.value
  if (logsOpen.value && !logsOutput.value) fetchLogs()
}

function uptime(seconds) {
  const s = Number(seconds) || 0
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

const family = computed(() => (node.value?.family || '').toLowerCase())
const isV4 = computed(() => family.value === 'ipv4')
const isV6 = computed(() => family.value === 'ipv6')
const ipv4 = computed(() => node.value?.network?.ipv4 || [])
const ipv6 = computed(() => node.value?.network?.ipv6 || [])
const ipv6Prefixes = computed(() => node.value?.network?.ipv6Prefixes || [])
const proxies = computed(() => node.value?.proxies || [])
const ipv4Proxies = computed(() => proxies.value.filter((p) => (p.type || '').toLowerCase() === 'ipv4'))
const ipv6Proxies = computed(() => proxies.value.filter((p) => (p.type || '').toLowerCase() === 'ipv6'))

const totalUp = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.uploadBytes || 0), 0))
const totalDown = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.downloadBytes || 0), 0))
const totalMonth = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.monthBytes || 0), 0))

// Enrichment from the extended /api/nodes/:id payload (1.5.3+):
//   • owners[]       — per-customer breakdown for this node
//   • windowsBandwidth — { h1, h24, d30 } each { up, down }
//   • recentFixes[]  — last 20 auto-heal events affecting this node
//   • recentErrors[] — open errors keyed on this node
const owners = computed(() => node.value?.owners || [])
const windows = computed(() => node.value?.windowsBandwidth || { h1: { up: 0, down: 0 }, h24: { up: 0, down: 0 }, d30: { up: 0, down: 0 } })
const recentFixes = computed(() => node.value?.recentFixes || [])
const recentErrors = computed(() => node.value?.recentErrors || [])
function fmtAgo(ms) {
  if (!ms) return '—'
  const s = Math.floor((Date.now() - Number(ms)) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
function goToUser(uid) { router.push({ name: 'admin-user-detail', params: { userId: uid } }) }

// Management actions. Wired to the existing /api/nodes/:id/action/:action
// endpoint (drain, undrain, restart-agent etc.) — server already routes
// each whitelisted action through handleNodeAction.
const actionBusy = ref('')
async function nodeAction(name, confirmText) {
  if (actionBusy.value) return
  if (confirmText && !confirm(confirmText)) return
  actionBusy.value = name
  try {
    const r = await apiFetch(`/api/nodes/${nodeId.value}/action/${name}`, { method: 'POST' })
    if (r && r.error) errorText.value = r.error
    setTimeout(load, 1500)
  } catch (e) { errorText.value = e.message }
  finally { actionBusy.value = '' }
}

// ─── bandwidth series chart ───────────────────────────────────────
const bwRange = ref('24h')
const bwSeries = ref([])
const bwLoading = ref(false)
async function loadBandwidthSeries() {
  if (bwLoading.value) return
  bwLoading.value = true
  try {
    const r = await apiFetch(`/api/admin/nodes/${nodeId.value}/bandwidth-series?range=${bwRange.value}`)
    bwSeries.value = r.points || []
  } catch (e) { errorText.value = e.message; bwSeries.value = [] }
  finally { bwLoading.value = false }
}
function setBwRange(r) { if (bwRange.value === r) return; bwRange.value = r; loadBandwidthSeries() }
const chartOptions = computed(() => ({
  chart: { id: 'node-bw', toolbar: { show: false }, foreColor: '#9bb8b1', animations: { enabled: false }, background: 'transparent' },
  colors: ['#4ade80', '#60a5fa'],
  stroke: { curve: 'smooth', width: 2 },
  dataLabels: { enabled: false },
  legend: { labels: { colors: '#9bb8b1' } },
  xaxis: { type: 'datetime', labels: { style: { colors: '#9bb8b1' } } },
  yaxis: { labels: { style: { colors: '#9bb8b1' }, formatter: (v) => formatBytes(v) } },
  tooltip: { theme: 'dark', y: { formatter: (v) => formatBytes(v) } },
  grid: { borderColor: '#1f2a35', strokeDashArray: 3 }
}))
const chartSeries = computed(() => ([
  { name: 'Upload',   data: bwSeries.value.map((p) => [new Date(p.hour + ':00:00Z').getTime(), p.up]) },
  { name: 'Download', data: bwSeries.value.map((p) => [new Date(p.hour + ':00:00Z').getTime(), p.down]) }
]))

// ─── ipv6 pool stats ───────────────────────────────────────────────
const pool = ref(null)
async function loadPool() {
  try { pool.value = await apiFetch(`/api/admin/nodes/${nodeId.value}/pool`) }
  catch (e) { /* not fatal */ pool.value = null }
}

// ─── owner drilldown (per-proxy 30d bytes for one owner on this node) ──
const ownerDrill = ref(null)
const ownerDrillLoading = ref('')
async function toggleOwnerDrill(ownerId) {
  if (ownerDrill.value && ownerDrill.value.owner?.id === ownerId) { ownerDrill.value = null; return }
  ownerDrillLoading.value = ownerId
  try { ownerDrill.value = await apiFetch(`/api/admin/nodes/${nodeId.value}/owners/${ownerId}`) }
  catch (e) { errorText.value = e.message; ownerDrill.value = null }
  finally { ownerDrillLoading.value = '' }
}

// ─── per-node alert thresholds ─────────────────────────────────────
const alertsForm = ref({ ramPct: '', load1: '', failPct: '' })
const alertsSaving = ref(false)
function syncAlertsForm() {
  const a = node.value?.alerts || {}
  alertsForm.value = {
    ramPct: a.ramPct != null ? String(a.ramPct) : '',
    load1: a.load1 != null ? String(a.load1) : '',
    failPct: a.failPct != null ? String(a.failPct) : ''
  }
}
async function saveAlerts() {
  if (alertsSaving.value) return
  alertsSaving.value = true; errorText.value = ''
  const payload = {}
  for (const k of ['ramPct', 'load1', 'failPct']) {
    const v = alertsForm.value[k]
    payload[k] = v === '' ? null : Number(v)
  }
  try {
    const updated = await apiFetch(`/api/nodes/${nodeId.value}`, { method: 'PATCH', body: { alerts: payload } })
    node.value = { ...node.value, ...updated }
    syncAlertsForm()
  } catch (e) { errorText.value = e.message }
  finally { alertsSaving.value = false }
}

watch(node, syncAlertsForm)
watch(nodeId, () => { load(); loadUpgrade(); loadBandwidthSeries(); loadPool(); ownerDrill.value = null })
onMounted(() => { load(); loadUpgrade(); loadBandwidthSeries(); loadPool() })

// reaper telemetry from heartbeat
const reaper = computed(() => node.value?.reaper || null)
function fmtMs(iso) {
  if (!iso) return '—'
  try { const t = new Date(iso).getTime(); return fmtAgo(t) } catch { return '—' }
}

// suspended count for management UI hint
const suspendedCount = computed(() => proxies.value.filter((p) => p.suspended).length)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <button class="ghost-button" type="button" @click="router.push({ name: 'admin-nodes' })"><ArrowLeft :size="15" /> {{ t('nodes.backToList') }}</button>
      <div class="spacer"></div>
      <button class="primary-action small" type="button" :disabled="syncing" @click="onSync"><RefreshCw :size="15" /> {{ syncing ? t('nodes.syncing') : t('nodes.sync') }}</button>
      <button v-if="!isLocal && node && node.hasCreds && node.status !== 'online'" class="ghost-button" type="button" :disabled="installing" @click="onInstall">{{ installing ? t('nodes.installing') : t('nodes.install') }}</button>
      <button v-if="!isLocal" class="ghost-button" type="button" @click="onDelete"><Trash2 :size="14" /></button>
    </div>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>
    <p v-if="loading && !node" class="empty-text">{{ t('common.loading') }}</p>

    <section v-if="node" class="surface">
      <div class="section-head">
        <h2><Server :size="16" style="vertical-align:-3px" /> {{ node.name }} <span style="color:var(--muted); font-size:12px; margin-left:8px">{{ nodeId }}</span></h2>
        <span :class="['status-pill', node.status === 'online' ? 'active' : (node.status === 'install-failed' ? 'failed' : 'pending')]">{{ node.status }}</span>
      </div>
      <div class="detail-grid">
        <div><span>{{ t('nodes.role') }}</span><strong>{{ node.role }}</strong></div>
        <div>
          <span>{{ t('nodes.family') }}</span>
          <div class="family-toggle">
            <button
              type="button"
              :class="['family-btn', { active: isV4 }]"
              :disabled="familySaving"
              @click="setFamily('ipv4')"
            >IPv4</button>
            <button
              type="button"
              :class="['family-btn', { active: isV6 }]"
              :disabled="familySaving"
              @click="setFamily('ipv6')"
            >IPv6</button>
          </div>
        </div>
        <div><span>{{ t('nodes.host') }}</span><strong class="cell-mono">{{ node.host }}</strong></div>
        <div>
          <span>{{ t('nodes.version') }}</span>
          <strong>
            {{ node.version || '—' }}
            <span v-if="node.outdated" class="status-pill pending" style="margin-left:6px; font-size:10.5px">outdated</span>
            <span v-else-if="node.version && node.latestAgentVersion === node.version" class="status-pill active" style="margin-left:6px; font-size:10.5px">latest</span>
          </strong>
        </div>
        <div v-if="isLocal"><span>{{ t('nodes.uptime') }}</span><strong>{{ uptime(node.uptimeSeconds) }}</strong></div>
        <div v-else><span>{{ t('nodes.lastSeen') }}</span><strong>{{ node.lastSeenAt || '—' }}</strong></div>
        <div><span>{{ t('nodes.proxies') }}</span><strong>{{ proxies.length }}</strong></div>
        <div><span>{{ t('detail.traffic') }} ↑/↓ {{ t('common.thisMonth') }}</span><strong class="cell-mono">{{ formatBytes(totalUp) }} / {{ formatBytes(totalDown) }} ({{ formatBytes(totalMonth) }})</strong></div>
      </div>
    </section>

    <section v-if="node && node.metrics" class="surface">
      <div class="section-head"><h2><Cpu :size="16" style="vertical-align:-3px" /> {{ t('nodes.metrics') }}</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">CPU</div><div class="metric-value">{{ node.metrics.cpuPct }}%</div></div>
        <div class="metric-card"><div class="metric-label">RAM</div><div class="metric-value">{{ node.metrics.ramPct }}%</div><div class="metric-foot">{{ formatBytes(node.metrics.ramUsed) }} / {{ formatBytes(node.metrics.ramTotal) }}</div></div>
        <div class="metric-card"><div class="metric-label">Load (1m / 5m)</div><div class="metric-value">{{ Number(node.metrics.load1).toFixed(2) }} / {{ Number(node.metrics.load5).toFixed(2) }}</div></div>
        <div class="metric-card"><div class="metric-label">Net RX</div><div class="metric-value">{{ formatBytes(node.metrics.netRxBps) }}/s</div></div>
        <div class="metric-card"><div class="metric-label">Net TX</div><div class="metric-value">{{ formatBytes(node.metrics.netTxBps) }}/s</div></div>
        <div class="metric-card"><div class="metric-label">{{ t('nodes.uptime') }}</div><div class="metric-value">{{ uptime(node.metrics.uptimeSec) }}</div></div>
      </div>
    </section>

    <!-- ── Bandwidth (1h / 24h / 30d) — total traffic served from this node ── -->
    <section v-if="node" class="surface">
      <div class="section-head"><h2><BarChart3 :size="16" style="vertical-align:-3px" /> Băng thông node</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">1 giờ qua</div><div class="metric-value">{{ formatBytes((windows.h1.up + windows.h1.down)) }}</div><div class="metric-foot">↑ {{ formatBytes(windows.h1.up) }} · ↓ {{ formatBytes(windows.h1.down) }}</div></div>
        <div class="metric-card"><div class="metric-label">24 giờ qua</div><div class="metric-value">{{ formatBytes((windows.h24.up + windows.h24.down)) }}</div><div class="metric-foot">↑ {{ formatBytes(windows.h24.up) }} · ↓ {{ formatBytes(windows.h24.down) }}</div></div>
        <div class="metric-card"><div class="metric-label">30 ngày qua</div><div class="metric-value">{{ formatBytes((windows.d30.up + windows.d30.down)) }}</div><div class="metric-foot">↑ {{ formatBytes(windows.d30.up) }} · ↓ {{ formatBytes(windows.d30.down) }}</div></div>
        <div class="metric-card"><div class="metric-label">Khách trên node</div><div class="metric-value">{{ owners.length }}</div><div class="metric-foot">{{ proxies.length }} proxy</div></div>
      </div>
      <!-- chart -->
      <div style="display:flex; gap:6px; margin:14px 0 8px; align-items:center">
        <button v-for="r in ['24h','7d','30d']" :key="r" type="button" :class="['ghost-button', bwRange === r ? 'active' : '']" style="padding:4px 10px; font-size:11px" @click="setBwRange(r)">{{ r }}</button>
        <span v-if="bwLoading" style="font-size:11px; color:var(--muted); margin-left:8px">đang tải…</span>
      </div>
      <ApexChart v-if="bwSeries.length" type="area" height="240" :options="chartOptions" :series="chartSeries" />
      <p v-else class="empty-text" style="padding:24px 0; text-align:center">Chưa có dữ liệu băng thông cho khoảng thời gian này.</p>
    </section>

    <!-- ── Customers on this node — who's using it, how much ── -->
    <section v-if="node && owners.length" class="surface">
      <div class="section-head">
        <h2><Users :size="16" style="vertical-align:-3px" /> Khách dùng proxy trên node ({{ owners.length }})</h2>
        <span style="color:var(--muted); font-size:12px">Click vào dòng để xem chi tiết proxy của khách trên node này</span>
      </div>
      <div class="data-table">
        <div class="table-head" style="grid-template-columns: 0.2fr 1.4fr 0.6fr 0.5fr 0.5fr 1fr 0.7fr 0.5fr">
          <span></span>
          <span>Khách</span>
          <span style="text-align:right">Proxy</span>
          <span style="text-align:right">Active</span>
          <span style="text-align:right">Expired</span>
          <span style="text-align:right">Băng thông 30d</span>
          <span style="text-align:right">Auto-fix</span>
          <span style="text-align:right">Last check</span>
        </div>
        <template v-for="o in owners" :key="o.ownerId">
          <div class="table-row" style="grid-template-columns: 0.2fr 1.4fr 0.6fr 0.5fr 0.5fr 1fr 0.7fr 0.5fr; cursor:pointer" @click="toggleOwnerDrill(o.ownerId)">
            <span style="color:var(--muted)">
              <ChevronDown v-if="ownerDrill && ownerDrill.owner?.id === o.ownerId" :size="13" />
              <ChevronRight v-else :size="13" />
            </span>
            <span>
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block">{{ o.email }}</span>
              <small v-if="o.suspended" class="status-pill error" style="font-size:10px">suspended</small>
            </span>
            <span class="cell-mono" style="text-align:right; font-weight:600">{{ o.total }}</span>
            <span class="cell-mono" style="text-align:right; color:var(--green)">{{ o.active }}</span>
            <span class="cell-mono" style="text-align:right; color:var(--muted)">{{ o.expired }}</span>
            <span class="cell-mono" style="text-align:right">
              {{ formatBytes(o.bytes30dTotal) }}
              <small style="display:block; color:var(--muted); font-size:10.5px">↑{{ formatBytes(o.bytes30dUp) }} ↓{{ formatBytes(o.bytes30dDown) }}</small>
            </span>
            <span style="text-align:right">
              <strong v-if="o.autoFixCount > 0" class="cell-mono" style="color:var(--yellow)">{{ o.autoFixCount }}</strong>
              <span v-else style="color:var(--muted)">—</span>
            </span>
            <span class="cell-mono" style="text-align:right; font-size:11px; color:var(--muted)">{{ fmtAgo(o.lastActive) }}</span>
          </div>
          <!-- expanded drilldown -->
          <div v-if="ownerDrill && ownerDrill.owner?.id === o.ownerId" class="owner-drill">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border-soft)">
              <span style="font-size:12px; color:var(--muted)">Proxy của <strong style="color:var(--text)">{{ ownerDrill.owner?.email || o.email }}</strong> trên node này ({{ ownerDrill.proxies.length }})</span>
              <button class="ghost-button" type="button" style="font-size:11px; padding:3px 8px" @click.stop="goToUser(o.ownerId)">Mở trang khách →</button>
            </div>
            <div v-if="ownerDrillLoading === o.ownerId" class="empty-text" style="padding:14px">Đang tải…</div>
            <div v-else class="data-table" style="border:none">
              <div v-for="p in ownerDrill.proxies" :key="p.id" class="table-row" style="grid-template-columns: 1.2fr 1.4fr 0.5fr 0.7fr 1fr">
                <span class="cell-mono" style="font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ p.name || p.id }}</span>
                <span class="cell-mono" style="font-size:11.5px">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
                <span><span :class="['status-pill', p.status]">{{ p.status }}</span><span v-if="p.suspended" class="status-pill error" style="font-size:10px; margin-left:4px">suspended</span></span>
                <span style="text-align:right">
                  <strong v-if="p.autoFixCount > 0" class="cell-mono" style="color:var(--yellow)">×{{ p.autoFixCount }}</strong>
                  <span v-else style="color:var(--muted)">—</span>
                </span>
                <span class="cell-mono" style="text-align:right; font-size:11.5px">
                  {{ formatBytes(p.bytes30d.up + p.bytes30d.down) }}
                  <small style="display:block; color:var(--muted); font-size:10.5px">↑{{ formatBytes(p.bytes30d.up) }} ↓{{ formatBytes(p.bytes30d.down) }}</small>
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- ── Management actions ── -->
    <section v-if="node && !isLocal" class="surface">
      <div class="section-head"><h2><Wrench :size="16" style="vertical-align:-3px" /> Quản lý node</h2></div>
      <div class="action-row" style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction(node.disabled ? 'undrain' : 'drain', node.disabled ? null : 'Drain sẽ ngừng nhận kết nối MỚI trên node này (các kết nối hiện tại tiếp tục). Tiếp tục?')">
          <Play v-if="node.disabled" :size="13" /><Pause v-else :size="13" />
          {{ node.disabled ? 'Bật lại node (undrain)' : 'Drain (ngừng nhận conn mới)' }}
        </button>
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction(suspendedCount > 0 ? 'resume-all-proxies' : 'suspend-all-proxies', suspendedCount > 0 ? 'Bỏ tạm dừng toàn bộ proxy trên node?' : 'Tạm dừng toàn bộ proxy trên node? Khách sẽ mất khả năng dùng proxy đến khi resume.')">
          <Play v-if="suspendedCount > 0" :size="13" /><Pause v-else :size="13" />
          {{ suspendedCount > 0 ? `Resume ${suspendedCount} proxy đang suspend` : 'Suspend toàn bộ proxy' }}
        </button>
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction('restart-agent', 'Restart agent service trên node? (~30s downtime cho mọi proxy trên node này)')">
          <RefreshCw :size="13" /> Restart agent
        </button>
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction('refresh-network', null)">
          <Zap :size="13" /> Refresh network info
        </button>
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction('diagnostics', null)">
          <Activity :size="13" /> Diagnostics
        </button>
        <button class="ghost-button" type="button" :disabled="!!actionBusy" @click="nodeAction('rotate-token', 'Đổi agent token? Token cũ sẽ ngừng hoạt động ngay; agent restart sẽ pick up token mới.')">
          <RefreshCw :size="13" /> Rotate agent token
        </button>
      </div>
      <p v-if="actionBusy" class="empty-text" style="padding:8px 0">Đang chạy: {{ actionBusy }}…</p>
    </section>

    <!-- ── Alert thresholds (per-node override) ── -->
    <section v-if="node && !isLocal" class="surface">
      <div class="section-head">
        <h2><Bell :size="16" style="vertical-align:-3px" /> Ngưỡng cảnh báo node</h2>
        <span style="font-size:11.5px; color:var(--muted)">Bỏ trống → dùng mặc định (RAM 90%, Load 100, Fail 80%)</span>
      </div>
      <div class="detail-grid">
        <div>
          <span>RAM (%)</span>
          <input v-model="alertsForm.ramPct" type="number" min="1" max="100" placeholder="90" style="width:100%; padding:5px 8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:var(--radius); font-family:var(--mono); font-size:12px" />
        </div>
        <div>
          <span>Load 1m</span>
          <input v-model="alertsForm.load1" type="number" min="1" max="10000" placeholder="100" style="width:100%; padding:5px 8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:var(--radius); font-family:var(--mono); font-size:12px" />
        </div>
        <div>
          <span>Tỉ lệ fail (%)</span>
          <input v-model="alertsForm.failPct" type="number" min="1" max="100" placeholder="80" style="width:100%; padding:5px 8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:var(--radius); font-family:var(--mono); font-size:12px" />
        </div>
        <div style="display:flex; align-items:flex-end">
          <button class="primary-action small" type="button" :disabled="alertsSaving" @click="saveAlerts">{{ alertsSaving ? 'Đang lưu…' : 'Lưu ngưỡng' }}</button>
        </div>
      </div>
    </section>

    <!-- ── Reaper telemetry (IPv6 stale-address sweeper) ── -->
    <section v-if="reaper" class="surface">
      <div class="section-head"><h2><Trash :size="16" style="vertical-align:-3px" /> IPv6 reaper</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Active /128 đang giữ</div><div class="metric-value">{{ reaper.activeCount }}</div></div>
        <div class="metric-card"><div class="metric-label">Sweep gần nhất</div><div class="metric-value" style="font-size:18px">{{ fmtMs(reaper.lastSweepAt) }}</div><div class="metric-foot cell-mono">{{ reaper.lastSweepAt }}</div></div>
        <div class="metric-card"><div class="metric-label">Reaped lần cuối</div><div class="metric-value">{{ reaper.lastReapedCount }}</div></div>
        <div class="metric-card"><div class="metric-label">Tổng reaped (từ khi agent start)</div><div class="metric-value">{{ reaper.totalReaped }}</div></div>
      </div>
    </section>

    <!-- ── IPv6 pool utilization ── -->
    <section v-if="pool" class="surface">
      <div class="section-head"><h2><Network :size="16" style="vertical-align:-3px" /> IP pool ({{ pool.family }})</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Proxy đang dùng</div><div class="metric-value">{{ pool.proxiesOnNode }}</div></div>
        <div v-if="pool.family === 'ipv6'" class="metric-card"><div class="metric-label">IPv6 attached</div><div class="metric-value">{{ pool.ipv6Attached }}</div><div class="metric-foot">In use: {{ pool.ipv6InUse }} ({{ pool.utilizationPctOfAttached }}%)</div></div>
        <div v-if="pool.family === 'ipv4'" class="metric-card"><div class="metric-label">IPv4 attached</div><div class="metric-value">{{ pool.ipv4Attached }}</div><div class="metric-foot">In use: {{ pool.ipv4InUse }}</div></div>
        <div v-if="pool.family === 'ipv6'" class="metric-card"><div class="metric-label">Subnet /64 distinct</div><div class="metric-value">{{ pool.distinct64InUse }}</div><div class="metric-foot">Attached: {{ pool.distinct64Attached }}</div></div>
        <div v-if="pool.family === 'ipv6' && pool.capacityCidr" class="metric-card"><div class="metric-label">Capacity prefix</div><div class="metric-value cell-mono" style="font-size:14px">{{ pool.capacityCidr }}</div><div class="metric-foot">~2^{{ 128 - Number(pool.capacityCidr.split('/')[1] || 0) }} hosts</div></div>
      </div>
    </section>

    <!-- ── Recent activity: auto-heal events + open errors for this node ── -->
    <section v-if="node && (recentFixes.length || recentErrors.length)" class="surface">
      <div class="section-head"><h2><Activity :size="16" style="vertical-align:-3px" /> Hoạt động gần đây trên node</h2></div>
      <div v-if="recentErrors.length" style="margin-bottom:14px">
        <h3 style="font-size:13px; color:var(--red); margin:0 0 8px"><AlertCircle :size="13" style="vertical-align:-2px" /> Lỗi đang mở ({{ recentErrors.length }})</h3>
        <div class="data-table">
          <div v-for="e in recentErrors" :key="e.id" class="table-row" style="grid-template-columns: 0.5fr 0.7fr 1fr 1.6fr 0.4fr">
            <span class="cell-mono" style="font-size:11px; color:var(--muted)">{{ fmtAgo(e.last_ts) }}</span>
            <span><span :class="['status-pill', e.level === 'error' ? 'error' : 'pending']">{{ e.level }}</span></span>
            <span class="cell-mono" style="font-size:11.5px">{{ e.source }}/{{ e.code }}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11.5px">{{ e.message }}</span>
            <span class="cell-mono" style="text-align:right; color:var(--yellow)">×{{ e.count }}</span>
          </div>
        </div>
      </div>
      <div v-if="recentFixes.length">
        <h3 style="font-size:13px; color:var(--muted); margin:0 0 8px">Auto-heal ({{ recentFixes.length }})</h3>
        <div class="data-table">
          <div v-for="(f, i) in recentFixes" :key="i" class="table-row" style="grid-template-columns: 0.7fr 0.7fr 2fr">
            <span class="cell-mono" style="font-size:11px; color:var(--muted)">{{ f.ts.slice(11, 19) }}</span>
            <span><span v-if="f.path && f.path.endsWith('/rotate')" class="status-pill pending">rotate</span><span v-else-if="f.path && f.path.endsWith('/replace')" class="status-pill active">replace</span><span v-else class="status-pill error">{{ (f.path||'').split('/').pop() }}</span> <small class="cell-mono" style="color:var(--muted); font-size:10.5px">{{ (f.path||'').match(/\/proxy\/([^/]+)/)?.[1] }}</small></span>
            <span class="cell-mono" style="font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ f.note }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Upgrade agent — admin runs the one-liner on the node to swap binary -->
    <section v-if="node && !isLocal" class="surface">
      <div class="section-head" style="display:flex; align-items:center; gap:10px">
        <h2><Download :size="16" style="vertical-align:-3px" /> Cập nhật agent</h2>
        <span v-if="upgrade?.outdated" class="status-pill pending" style="font-size:11px">v{{ upgrade.currentVersion }} → v{{ upgrade.latestVersion }}</span>
        <span v-else-if="upgrade && !upgrade.outdated && upgrade.currentVersion" class="status-pill active" style="font-size:11px">đang dùng phiên bản mới nhất (v{{ upgrade.latestVersion }})</span>
        <div class="spacer"></div>
        <button class="ghost-button" type="button" :disabled="upgradeLoading" @click="rotateUpgradeToken" style="font-size:11px">Đổi token</button>
      </div>
      <p v-if="!upgrade" class="empty-text" style="padding:10px 0">Đang tải lệnh upgrade…</p>
      <div v-else>
        <p style="font-size:13px; color:var(--muted); margin:0 0 8px">
          SSH vào node <code>{{ node.host }}</code> và chạy lệnh dưới đây để cập nhật agent lên phiên bản mới nhất.
          Lệnh tự stop service, tải binary, restart — config + PKI giữ nguyên.
        </p>
        <div class="upgrade-cmd-box">
          <code>{{ upgrade.oneLiner }}</code>
          <button class="ghost-button" type="button" @click="copyUpgradeCmd">
            {{ upgradeCopied ? '✓ copied' : 'copy' }}
          </button>
        </div>
        <p style="font-size:11.5px; color:var(--muted); margin:8px 0 0">
          Script: <a :href="upgrade.upgradeScriptUrl" target="_blank" rel="noopener" style="color:var(--muted)">xem nội dung</a> ·
          Binary: <a :href="upgrade.binaryUrl" target="_blank" rel="noopener" style="color:var(--muted)">download</a>
        </p>
      </div>
    </section>

    <section v-if="node" class="surface">
      <div class="section-head">
        <h2><HardDrive :size="16" style="vertical-align:-3px" /> {{ t('nodes.networkInfra') }}</h2>
        <button class="ghost-button" type="button" :disabled="syncing" @click="onSync"><RefreshCw :size="14" /> {{ t('nodes.syncIPs') }}</button>
      </div>
      <div class="detail-grid">
        <div v-if="!isV6">
          <span>{{ t('nodes.ipv4Count') }}</span>
          <strong>{{ ipv4.length }} {{ t('nodes.addresses') }}</strong>
        </div>
        <div v-if="!isV4">
          <span>{{ t('nodes.ipv6Count') }}</span>
          <strong>{{ ipv6.length }} {{ t('nodes.addresses') }}</strong>
        </div>
        <div v-if="!isV4">
          <span>{{ t('nodes.ipv6Prefix') }}</span>
          <strong class="cell-mono">{{ ipv6Prefixes.length ? ipv6Prefixes.map((p) => p.cidr).join(', ') : '—' }}</strong>
        </div>
        <div v-if="node.network && node.network.ipv4PoolSize !== undefined">
          <span>{{ t('nodes.poolSize') }}</span>
          <strong>{{ isV6 ? (node.network.ipv6PoolSize || 0) : (isV4 ? (node.network.ipv4PoolSize || 0) : (node.network.ipv4PoolSize || 0) + (node.network.ipv6PoolSize || 0)) }}</strong>
        </div>
      </div>
      <details v-if="!isV6 && ipv4.length" style="margin-top:12px">
        <summary style="cursor:pointer; color:var(--muted); font-size:13px">{{ t('nodes.showIpv4List') }} ({{ ipv4.length }})</summary>
        <div class="credential-box" style="margin-top:8px; max-height:200px; overflow:auto">
          <code>{{ ipv4.map((e) => e.address).join(', ') }}</code>
        </div>
      </details>
      <details v-if="!isV4 && ipv6.length" style="margin-top:8px">
        <summary style="cursor:pointer; color:var(--muted); font-size:13px">{{ t('nodes.showIpv6List') }} ({{ ipv6.length }})</summary>
        <div class="credential-box" style="margin-top:8px; max-height:200px; overflow:auto">
          <code>{{ ipv6.map((e) => e.address).join(', ') }}</code>
        </div>
      </details>
    </section>

    <section v-if="node && (ipv4Proxies.length || ipv6Proxies.length)" class="surface">
      <div class="section-head"><h2><Cpu :size="16" style="vertical-align:-3px" /> {{ t('nodes.proxiesOnNode') }}</h2></div>
      <p v-if="!isV6 && ipv4Proxies.length" style="font-size:13px; color:var(--muted); margin-bottom:6px">IPv4 ({{ ipv4Proxies.length }})</p>
      <div v-if="!isV6 && ipv4Proxies.length" class="data-table" style="margin-bottom:14px">
        <div v-for="p in ipv4Proxies.slice(0, 20)" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.5fr auto">
          <span>{{ p.name }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
        <p v-if="ipv4Proxies.length > 20" class="empty-text">… {{ t('nodes.andMore') }} {{ ipv4Proxies.length - 20 }}</p>
      </div>
      <p v-if="!isV4 && ipv6Proxies.length" style="font-size:13px; color:var(--muted); margin-bottom:6px">IPv6 ({{ ipv6Proxies.length }})</p>
      <div v-if="!isV4 && ipv6Proxies.length" class="data-table">
        <div v-for="p in ipv6Proxies.slice(0, 20)" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.5fr auto">
          <span>{{ p.name }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}<span v-if="p.mode === 'rotating'" class="tag rotating" style="margin-left:6px">rotating</span></span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
        <p v-if="ipv6Proxies.length > 20" class="empty-text">… {{ t('nodes.andMore') }} {{ ipv6Proxies.length - 20 }}</p>
      </div>
    </section>

    <section v-if="installOutput" class="surface">
      <div class="section-head"><h2>{{ t('nodes.installOutput') }}</h2></div>
      <pre style="max-height:260px; overflow:auto"><code>{{ installOutput }}</code></pre>
    </section>

    <!-- Logs viewer (journalctl via SSH for remote, local file for control plane) -->
    <section class="surface">
      <div class="section-head">
        <h2><Terminal :size="15" style="vertical-align:-3px" /> {{ t('nodes.logs') }}</h2>
        <div class="action-row">
          <label class="input-field" style="flex-direction:row; align-items:center; gap:6px; padding:0; font-size:11px; color:var(--muted); text-transform:none; letter-spacing:0">
            {{ t('nodes.logsLines') }}:
            <input v-model.number="logsLines" type="number" min="10" max="5000" style="width:80px; padding:4px 8px; font-size:12px" />
          </label>
          <button class="ghost-button" type="button" :disabled="logsLoading" @click="fetchLogs"><RefreshCw :size="13" /> {{ logsLoading ? t('common.loading') : t('common.refresh') }}</button>
          <button class="ghost-button" type="button" @click="toggleLogs">{{ logsOpen ? t('nodes.logsHide') : t('nodes.logsShow') }}</button>
        </div>
      </div>
      <p v-if="logsErr" class="error-text" style="margin-bottom: 10px">{{ logsErr }}</p>
      <pre v-if="logsOpen" style="max-height: 480px; overflow: auto; font-size: 11.5px; background: #000; border-color: var(--border-soft)"><code style="color: #c4d8d4">{{ logsOutput || t('nodes.logsEmpty') }}</code></pre>
      <p v-else-if="!logsErr" style="font-size: 12px; color: var(--muted); margin: 0">
        <FileText :size="12" style="vertical-align:-2px" /> {{ isLocal ? t('nodes.logsHintLocal') : t('nodes.logsHintRemote') }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.upgrade-cmd-box { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#0f1419; border:1px solid var(--border); border-radius:var(--radius); font-family:var(--mono); font-size:12px }
.upgrade-cmd-box code { flex:1; overflow-x:auto; white-space:nowrap; color:#9bb8b1 }
.upgrade-cmd-box button { white-space:nowrap; font-size:11px }
.family-toggle { display:inline-flex; gap:4px; margin-top:2px }
.family-toggle .family-btn { background:var(--surface-2); border:1px solid var(--border); color:var(--muted); padding:3px 12px; border-radius:var(--radius); font-size:11.5px; font-weight:600; letter-spacing:0.4px; cursor:pointer; font-family:var(--mono) }
.family-toggle .family-btn:hover:not(:disabled) { border-color:var(--green); color:var(--text) }
.family-toggle .family-btn.active { background:rgba(74,222,128,0.12); border-color:var(--green); color:var(--green) }
.family-toggle .family-btn:disabled { opacity:0.6; cursor:default }
.ghost-button.active { background:rgba(74,222,128,0.12); border-color:var(--green); color:var(--green) }
.owner-drill { background:var(--surface-2); border-left:2px solid var(--green); padding:4px 0 8px }
</style>
