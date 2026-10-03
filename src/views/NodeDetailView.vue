<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Empty } from 'ant-design-vue'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { fetchNode, syncNode, removeNode, installNode } from '../store/nodes'
import { formatBytes } from '../utils/format'
import { isDark } from '../theme'
import { message, confirmAsync } from '../ui/feedback'
import StatusTag from '../components/ui/StatusTag.vue'

const ApexChart = defineAsyncComponent(() => import('vue3-apexcharts'))
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const node = ref(null)
const loading = ref(true)
const errorText = ref('')   // persistent load errors (node, upgrade cmd, bandwidth, drilldown)
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
  catch (e) { message.error(e.message) }
  finally { syncing.value = false }
}

async function setFamily(fam) {
  if (familySaving.value) return
  if (node.value && (node.value.family || '').toLowerCase() === fam) return
  familySaving.value = true
  try {
    const updated = await apiFetch(`/api/nodes/${nodeId.value}`, { method: 'PATCH', body: { family: fam } })
    node.value = { ...node.value, ...updated }
    setTimeout(load, 300)
  } catch (e) { message.error(e.message) }
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
  if (!(await confirmAsync({ title: t('nodes.confirmDelete'), danger: true }))) return
  try { await removeNode(nodeId.value); router.push({ name: 'admin-nodes' }) }
  catch (e) { message.error(e.message) }
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
  if (!(await confirmAsync({ title: t('nodeDetail.confirmUpgradeTokenRotate'), danger: true }))) return
  upgradeLoading.value = true
  try { upgrade.value = await apiFetch(`/api/nodes/${nodeId.value}/upgrade-command`, { method: 'POST' }) }
  catch (e) { message.error(e.message) }
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
const recentFixes = computed(() => (node.value?.recentFixes || []).map((f, i) => ({ ...f, _k: i })))
const recentErrors = computed(() => node.value?.recentErrors || [])
const bwWindows = computed(() => [
  { key: 'h1', label: t('nodeDetail.bw1h'), w: windows.value.h1 },
  { key: 'h24', label: t('nodeDetail.bw24h'), w: windows.value.h24 },
  { key: 'd30', label: t('nodeDetail.bw30d'), w: windows.value.d30 }
])
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
  if (confirmText && !(await confirmAsync({ title: confirmText }))) return
  actionBusy.value = name
  try {
    const r = await apiFetch(`/api/nodes/${nodeId.value}/action/${name}`, { method: 'POST' })
    if (r && r.error) message.error(r.error)
    setTimeout(load, 1500)
  } catch (e) { message.error(e.message) }
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
const chartOptions = computed(() => {
  const fg = isDark.value ? '#94a3b8' : '#64748b'
  return {
    chart: { id: 'node-bw', toolbar: { show: false }, foreColor: fg, animations: { enabled: false }, background: 'transparent', fontFamily: 'inherit' },
    theme: { mode: isDark.value ? 'dark' : 'light' },
    colors: ['#4ade80', '#60a5fa'],
    stroke: { curve: 'smooth', width: 2 },
    dataLabels: { enabled: false },
    legend: { labels: { colors: fg } },
    xaxis: { type: 'datetime', labels: { style: { colors: fg } } },
    yaxis: { labels: { style: { colors: fg }, formatter: (v) => formatBytes(v) } },
    tooltip: { theme: isDark.value ? 'dark' : 'light', y: { formatter: (v) => formatBytes(v) } },
    grid: { borderColor: isDark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', strokeDashArray: 3 }
  }
})
const chartSeries = computed(() => ([
  { name: 'Upload',   data: bwSeries.value.map((p) => [new Date(p.hour + ':00:00Z').getTime(), p.up]) },
  { name: 'Download', data: bwSeries.value.map((p) => [new Date(p.hour + ':00:00Z').getTime(), p.down]) }
]))

// ─── ipv6 pool stats ───────────────────────────────────────────────
const pool = ref(null)
async function loadPool() {
  try { pool.value = await apiFetch(`/api/admin/nodes/${nodeId.value}/pool`) }
  catch { /* not fatal */ pool.value = null }
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
const expandedOwnerKeys = computed(() => {
  if (ownerDrillLoading.value) return [ownerDrillLoading.value]
  return ownerDrill.value?.owner?.id ? [ownerDrill.value.owner.id] : []
})

// ─── per-node alert thresholds ─────────────────────────────────────
// Inputs hold numbers or null (empty → server default).
const alertsForm = ref({ ramPct: null, load1: null, failPct: null })
const alertsSaving = ref(false)
function syncAlertsForm() {
  const a = node.value?.alerts || {}
  alertsForm.value = {
    ramPct: a.ramPct != null ? Number(a.ramPct) : null,
    load1: a.load1 != null ? Number(a.load1) : null,
    failPct: a.failPct != null ? Number(a.failPct) : null
  }
}
async function saveAlerts() {
  if (alertsSaving.value) return
  alertsSaving.value = true
  const payload = {}
  for (const k of ['ramPct', 'load1', 'failPct']) {
    const v = alertsForm.value[k]
    payload[k] = v === '' || v == null ? null : Number(v)
  }
  try {
    const updated = await apiFetch(`/api/nodes/${nodeId.value}`, { method: 'PATCH', body: { alerts: payload } })
    node.value = { ...node.value, ...updated }
    syncAlertsForm()
  } catch (e) { message.error(e.message) }
  finally { alertsSaving.value = false }
}

watch(node, syncAlertsForm)
watch(nodeId, () => { load(); loadUpgrade(); loadBandwidthSeries(); loadPool(); ownerDrill.value = null })
onMounted(() => { load(); loadUpgrade(); loadBandwidthSeries(); loadPool() })

// reaper telemetry from heartbeat
const reaper = computed(() => node.value?.reaper || null)
function fmtMs(iso) {
  if (!iso) return '—'
  try { const ts = new Date(iso).getTime(); return fmtAgo(ts) } catch { return '—' }
}

// suspended count for management UI hint
const suspendedCount = computed(() => proxies.value.filter((p) => p.suspended).length)

function nodeStatusColor(s) { return s === 'online' ? 'success' : (s === 'install-failed' ? 'error' : 'warning') }
function fixAction(f) {
  const path = f.path || ''
  if (path.endsWith('/rotate')) return { label: 'rotate', color: 'warning' }
  if (path.endsWith('/replace')) return { label: 'replace', color: 'success' }
  return { label: path.split('/').pop(), color: 'error' }
}

// ─── table columns ─────────────────────────────────────────────────
const ownerColumns = computed(() => [
  { title: t('nodeDetail.colCustomer'), key: 'email' },
  { title: t('nodeDetail.colProxy'), key: 'total', align: 'right', width: 80 },
  { title: t('nodeDetail.colActive'), key: 'active', align: 'right', width: 80 },
  { title: t('nodeDetail.colExpired'), key: 'expired', align: 'right', width: 90 },
  { title: t('nodeDetail.colBw30d'), key: 'bw', align: 'right', width: 160 },
  { title: t('nodeDetail.colAutoFix'), key: 'autofix', align: 'right', width: 90 },
  { title: t('nodeDetail.colLastCheck'), key: 'last', align: 'right', width: 120 }
])
const drillColumns = [
  { title: 'Proxy', key: 'name', ellipsis: true },
  { title: 'Endpoint', key: 'endpoint' },
  { title: 'Status', key: 'status', width: 170 },
  { title: 'Auto-fix', key: 'autofix', align: 'right', width: 90 },
  { title: '30d', key: 'bytes', align: 'right', width: 150 }
]
const errorColumns = [
  { title: '', key: 'ago', width: 64 },
  { title: 'Level', key: 'level', width: 100 },
  { title: 'Source', key: 'source', width: 200 },
  { title: 'Message', key: 'message', dataIndex: 'message', ellipsis: true },
  { title: '', key: 'count', align: 'right', width: 70 }
]
const fixColumns = [
  { title: '', key: 'ts', width: 90 },
  { title: '', key: 'action', width: 220 },
  { title: '', key: 'note', dataIndex: 'note', ellipsis: true }
]
const proxyColumns = [
  { title: 'Name', key: 'name', dataIndex: 'name', ellipsis: true },
  { title: 'Endpoint', key: 'endpoint' },
  { title: 'Status', key: 'status', width: 120, align: 'right' }
]
const proxyGroups = computed(() => [
  { key: 'v4', label: 'IPv4', show: !isV6.value && ipv4Proxies.value.length, list: ipv4Proxies.value },
  { key: 'v6', label: 'IPv6', show: !isV4.value && ipv6Proxies.value.length, list: ipv6Proxies.value }
].filter((g) => g.show))
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-button @click="router.push({ name: 'admin-nodes' })">
        <template #icon><ArrowLeftOutlined /></template>
        {{ t('nodes.backToList') }}
      </a-button>
      <a-flex wrap="wrap" gap="small">
        <a-button type="primary" :loading="syncing" @click="onSync">
          <template #icon><SyncOutlined /></template>
          {{ syncing ? t('nodes.syncing') : t('nodes.sync') }}
        </a-button>
        <a-button v-if="!isLocal && node && node.hasCreds && node.status !== 'online'" :loading="installing" @click="onInstall">
          {{ installing ? t('nodes.installing') : t('nodes.install') }}
        </a-button>
        <a-button v-if="!isLocal" danger @click="onDelete">
          <template #icon><DeleteOutlined /></template>
        </a-button>
      </a-flex>
    </a-flex>

    <a-alert v-if="errorText" type="error" show-icon :message="errorText" closable @close="errorText = ''" />
    <a-card v-if="loading && !node"><a-skeleton active /></a-card>

    <!-- ── Overview ── -->
    <a-card v-if="node">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <a-space :size="8" wrap>
            <CloudServerOutlined />
            <span>{{ node.name }}</span>
            <a-typography-text type="secondary" class="mono small">{{ nodeId }}</a-typography-text>
          </a-space>
          <StatusTag :status="node.status" :color="nodeStatusColor(node.status)" />
        </a-flex>
      </template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">
        <a-descriptions-item :label="t('nodes.role')">{{ node.role }}</a-descriptions-item>
        <a-descriptions-item :label="t('nodes.family')">
          <a-radio-group :value="family" size="small" button-style="solid" :disabled="familySaving" @change="(e) => setFamily(e.target.value)">
            <a-radio-button value="ipv4">IPv4</a-radio-button>
            <a-radio-button value="ipv6">IPv6</a-radio-button>
          </a-radio-group>
        </a-descriptions-item>
        <a-descriptions-item :label="t('nodes.host')">
          <a-typography-text class="mono" :copyable="node.host ? { text: node.host } : false">{{ node.host }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item :label="t('nodes.version')">
          <a-space :size="6" wrap>
            <span class="mono">{{ node.version || '—' }}</span>
            <StatusTag v-if="node.outdated" status="pending" label="outdated" />
            <StatusTag v-else-if="node.version && node.latestAgentVersion === node.version" status="active" label="latest" />
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item v-if="isLocal" :label="t('nodes.uptime')">{{ uptime(node.uptimeSeconds) }}</a-descriptions-item>
        <a-descriptions-item v-else :label="t('nodes.lastSeen')"><span class="mono">{{ node.lastSeenAt || '—' }}</span></a-descriptions-item>
        <a-descriptions-item :label="t('nodes.proxies')">{{ proxies.length }}</a-descriptions-item>
        <a-descriptions-item :label="`${t('detail.traffic')} ↑/↓ ${t('common.thisMonth')}`">
          <span class="mono">{{ formatBytes(totalUp) }} / {{ formatBytes(totalDown) }} ({{ formatBytes(totalMonth) }})</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- ── Live metrics ── -->
    <a-card v-if="node && node.metrics">
      <template #title><DashboardOutlined /> {{ t('nodes.metrics') }}</template>
      <a-row :gutter="[16, 16]">
        <a-col :xs="12" :sm="8" :xl="4">
          <a-statistic title="CPU" :value="node.metrics.cpuPct" suffix="%" />
          <a-progress :percent="Number(node.metrics.cpuPct) || 0" :show-info="false" size="small" />
        </a-col>
        <a-col :xs="12" :sm="8" :xl="4">
          <a-statistic title="RAM" :value="node.metrics.ramPct" suffix="%" />
          <a-typography-text type="secondary" class="foot mono">{{ formatBytes(node.metrics.ramUsed) }} / {{ formatBytes(node.metrics.ramTotal) }}</a-typography-text>
        </a-col>
        <a-col :xs="12" :sm="8" :xl="4">
          <a-statistic title="Load (1m / 5m)" :value="`${Number(node.metrics.load1).toFixed(2)} / ${Number(node.metrics.load5).toFixed(2)}`" />
        </a-col>
        <a-col :xs="12" :sm="8" :xl="4"><a-statistic title="Net RX" :value="`${formatBytes(node.metrics.netRxBps)}/s`" /></a-col>
        <a-col :xs="12" :sm="8" :xl="4"><a-statistic title="Net TX" :value="`${formatBytes(node.metrics.netTxBps)}/s`" /></a-col>
        <a-col :xs="12" :sm="8" :xl="4"><a-statistic :title="t('nodes.uptime')" :value="uptime(node.metrics.uptimeSec)" /></a-col>
      </a-row>
    </a-card>

    <!-- ── Bandwidth (1h / 24h / 30d) — total traffic served from this node ── -->
    <a-card v-if="node">
      <template #title><BarChartOutlined /> {{ t('nodeDetail.bwTitle') }}</template>
      <a-row :gutter="[16, 16]">
        <a-col v-for="b in bwWindows" :key="b.key" :xs="12" :md="6">
          <a-statistic :title="b.label" :value="formatBytes(b.w.up + b.w.down)" />
          <a-typography-text type="secondary" class="foot">↑ {{ formatBytes(b.w.up) }} · ↓ {{ formatBytes(b.w.down) }}</a-typography-text>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.bwOwners')" :value="owners.length" />
          <a-typography-text type="secondary" class="foot">{{ t('nodeDetail.bwOwnersSub', { n: proxies.length }) }}</a-typography-text>
        </a-col>
      </a-row>
      <a-flex align="center" gap="small" class="chart-controls">
        <a-segmented :value="bwRange" :options="['24h', '7d', '30d']" size="small" @change="setBwRange" />
        <a-typography-text v-if="bwLoading" type="secondary" class="small">{{ t('nodeDetail.loading') }}</a-typography-text>
      </a-flex>
      <ApexChart v-if="bwSeries.length" type="area" height="240" :options="chartOptions" :series="chartSeries" />
      <a-empty v-else :image="simpleImage" :description="t('nodeDetail.bwEmpty')" />
    </a-card>

    <!-- ── Customers on this node — who's using it, how much ── -->
    <a-card v-if="node && owners.length" :body-style="{ padding: 0 }">
      <template #title><TeamOutlined /> {{ t('nodeDetail.ownersTitle', { n: owners.length }) }}</template>
      <a-typography-paragraph type="secondary" class="card-note">{{ t('nodeDetail.ownersNote') }}</a-typography-paragraph>
      <a-table
        :columns="ownerColumns"
        :data-source="owners"
        row-key="ownerId"
        size="middle"
        :pagination="false"
        :scroll="{ x: 860 }"
        :expanded-row-keys="expandedOwnerKeys"
        expand-row-by-click
        class="clickable-rows"
        @expand="(_, o) => toggleOwnerDrill(o.ownerId)"
      >
        <template #bodyCell="{ column, record: o }">
          <template v-if="column.key === 'email'">
            <a-space :size="4" wrap>
              <span>{{ o.email }}</span>
              <StatusTag v-if="o.suspended" status="error" :label="t('nodeDetail.suspended')" />
            </a-space>
          </template>
          <template v-else-if="column.key === 'total'"><a-typography-text strong class="mono">{{ o.total }}</a-typography-text></template>
          <template v-else-if="column.key === 'active'"><a-typography-text type="success" class="mono">{{ o.active }}</a-typography-text></template>
          <template v-else-if="column.key === 'expired'"><a-typography-text type="secondary" class="mono">{{ o.expired }}</a-typography-text></template>
          <template v-else-if="column.key === 'bw'">
            <div class="mono">{{ formatBytes(o.bytes30dTotal) }}</div>
            <a-typography-text type="secondary" class="mono small">↑{{ formatBytes(o.bytes30dUp) }} ↓{{ formatBytes(o.bytes30dDown) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'autofix'">
            <a-typography-text v-if="o.autoFixCount > 0" type="warning" strong class="mono">{{ o.autoFixCount }}</a-typography-text>
            <a-typography-text v-else type="secondary">—</a-typography-text>
          </template>
          <template v-else-if="column.key === 'last'"><a-typography-text type="secondary" class="mono small">{{ fmtAgo(o.lastActive) }}</a-typography-text></template>
        </template>
        <template #expandedRowRender="{ record: o }">
          <a-space v-if="ownerDrillLoading === o.ownerId">
            <a-spin size="small" />
            <a-typography-text type="secondary">{{ t('nodeDetail.drillLoading') }}</a-typography-text>
          </a-space>
          <div v-else-if="ownerDrill && ownerDrill.owner?.id === o.ownerId" class="drill">
            <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="drill-head">
              <a-typography-text type="secondary">{{ t('nodeDetail.drilldown', { email: ownerDrill.owner?.email || o.email, n: ownerDrill.proxies.length }) }}</a-typography-text>
              <a-button size="small" @click.stop="goToUser(o.ownerId)">{{ t('nodeDetail.openCustomer') }}</a-button>
            </a-flex>
            <a-table :columns="drillColumns" :data-source="ownerDrill.proxies" row-key="id" size="small" :pagination="false" :scroll="{ x: 720 }">
              <template #bodyCell="{ column, record: p }">
                <template v-if="column.key === 'name'"><span class="mono">{{ p.name || p.id }}</span></template>
                <template v-else-if="column.key === 'endpoint'"><a-typography-text class="mono" :copyable="{ text: `${p.ip || p.bindIp}:${p.port}` }">{{ p.ip || p.bindIp }}:{{ p.port }}</a-typography-text></template>
                <template v-else-if="column.key === 'status'">
                  <a-space :size="4" wrap>
                    <StatusTag :status="p.status" />
                    <StatusTag v-if="p.suspended" status="error" :label="t('nodeDetail.suspended')" />
                  </a-space>
                </template>
                <template v-else-if="column.key === 'autofix'">
                  <a-typography-text v-if="p.autoFixCount > 0" type="warning" strong class="mono">×{{ p.autoFixCount }}</a-typography-text>
                  <a-typography-text v-else type="secondary">—</a-typography-text>
                </template>
                <template v-else-if="column.key === 'bytes'">
                  <div class="mono">{{ formatBytes(p.bytes30d.up + p.bytes30d.down) }}</div>
                  <a-typography-text type="secondary" class="mono small">↑{{ formatBytes(p.bytes30d.up) }} ↓{{ formatBytes(p.bytes30d.down) }}</a-typography-text>
                </template>
              </template>
            </a-table>
          </div>
        </template>
      </a-table>
    </a-card>

    <!-- ── Management actions ── -->
    <a-card v-if="node && !isLocal">
      <template #title><ToolOutlined /> {{ t('nodeDetail.manageTitle') }}</template>
      <a-space wrap>
        <a-button :disabled="!!actionBusy && actionBusy !== 'drain' && actionBusy !== 'undrain'" :loading="actionBusy === 'drain' || actionBusy === 'undrain'" @click="nodeAction(node.disabled ? 'undrain' : 'drain', node.disabled ? null : t('nodeDetail.confirmDrain'))">
          <template #icon><PlayCircleOutlined v-if="node.disabled" /><PauseCircleOutlined v-else /></template>
          {{ node.disabled ? t('nodeDetail.btnUndrain') : t('nodeDetail.btnDrain') }}
        </a-button>
        <a-button :disabled="!!actionBusy && !actionBusy.endsWith('-all-proxies')" :loading="actionBusy.endsWith('-all-proxies')" @click="nodeAction(suspendedCount > 0 ? 'resume-all-proxies' : 'suspend-all-proxies', suspendedCount > 0 ? t('nodeDetail.confirmResumeAll') : t('nodeDetail.confirmSuspendAll'))">
          <template #icon><PlayCircleOutlined v-if="suspendedCount > 0" /><PauseCircleOutlined v-else /></template>
          {{ suspendedCount > 0 ? t('nodeDetail.btnResumeN', { n: suspendedCount }) : t('nodeDetail.btnSuspendAll') }}
        </a-button>
        <a-button :disabled="!!actionBusy && actionBusy !== 'restart-agent'" :loading="actionBusy === 'restart-agent'" @click="nodeAction('restart-agent', t('nodeDetail.confirmRestartAgent'))">
          <template #icon><ReloadOutlined /></template>
          {{ t('nodeDetail.btnRestartAgent') }}
        </a-button>
        <a-button :disabled="!!actionBusy && actionBusy !== 'refresh-network'" :loading="actionBusy === 'refresh-network'" @click="nodeAction('refresh-network', null)">
          <template #icon><ThunderboltOutlined /></template>
          {{ t('nodeDetail.btnRefreshNet') }}
        </a-button>
        <a-button :disabled="!!actionBusy && actionBusy !== 'diagnostics'" :loading="actionBusy === 'diagnostics'" @click="nodeAction('diagnostics', null)">
          <template #icon><MedicineBoxOutlined /></template>
          {{ t('nodeDetail.btnDiagnostics') }}
        </a-button>
        <a-button danger :disabled="!!actionBusy && actionBusy !== 'rotate-token'" :loading="actionBusy === 'rotate-token'" @click="nodeAction('rotate-token', t('nodeDetail.confirmRotateToken'))">
          <template #icon><KeyOutlined /></template>
          {{ t('nodeDetail.btnRotateToken') }}
        </a-button>
      </a-space>
      <div v-if="actionBusy" class="action-running">
        <a-typography-text type="secondary">{{ t('nodeDetail.actionRunning', { name: actionBusy }) }}</a-typography-text>
      </div>
    </a-card>

    <!-- ── Alert thresholds (per-node override) ── -->
    <a-card v-if="node && !isLocal">
      <template #title><BellOutlined /> {{ t('nodeDetail.alertsTitle') }}</template>
      <a-typography-paragraph type="secondary">{{ t('nodeDetail.alertsHint') }}</a-typography-paragraph>
      <a-form :model="alertsForm" layout="vertical" @finish="saveAlerts">
        <a-row :gutter="16" align="bottom">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('nodeDetail.alertsRam')" name="ramPct">
              <a-input-number v-model:value="alertsForm.ramPct" :min="1" :max="100" placeholder="90" class="full-width mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('nodeDetail.alertsLoad')" name="load1">
              <a-input-number v-model:value="alertsForm.load1" :min="1" :max="10000" placeholder="100" class="full-width mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('nodeDetail.alertsFail')" name="failPct">
              <a-input-number v-model:value="alertsForm.failPct" :min="1" :max="100" placeholder="80" class="full-width mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item>
              <a-button type="primary" html-type="submit" :loading="alertsSaving">{{ alertsSaving ? t('nodeDetail.alertsSaving') : t('nodeDetail.alertsSave') }}</a-button>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-card>

    <!-- ── Reaper telemetry (IPv6 stale-address sweeper) ── -->
    <a-card v-if="reaper">
      <template #title><ClearOutlined /> {{ t('nodeDetail.reaperTitle') }}</template>
      <a-row :gutter="[16, 16]">
        <a-col :xs="12" :md="6"><a-statistic :title="t('nodeDetail.reaperActive')" :value="reaper.activeCount" /></a-col>
        <a-col :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.reaperLastSweep')" :value="fmtMs(reaper.lastSweepAt)" />
          <a-typography-text type="secondary" class="foot mono">{{ reaper.lastSweepAt }}</a-typography-text>
        </a-col>
        <a-col :xs="12" :md="6"><a-statistic :title="t('nodeDetail.reaperLastReaped')" :value="reaper.lastReapedCount" /></a-col>
        <a-col :xs="12" :md="6"><a-statistic :title="t('nodeDetail.reaperTotal')" :value="reaper.totalReaped" /></a-col>
      </a-row>
    </a-card>

    <!-- ── IP pool utilization ── -->
    <a-card v-if="pool">
      <template #title><ApartmentOutlined /> {{ t('nodeDetail.poolTitle', { family: pool.family }) }}</template>
      <a-row :gutter="[16, 16]">
        <a-col :xs="12" :md="6"><a-statistic :title="t('nodeDetail.poolProxies')" :value="pool.proxiesOnNode" /></a-col>
        <a-col v-if="pool.family === 'ipv6'" :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.poolIpv6Attached')" :value="pool.ipv6Attached" />
          <a-typography-text type="secondary" class="foot">{{ t('nodeDetail.poolIpv6InUse', { n: pool.ipv6InUse, pct: pool.utilizationPctOfAttached }) }}</a-typography-text>
        </a-col>
        <a-col v-if="pool.family === 'ipv4'" :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.poolIpv4Attached')" :value="pool.ipv4Attached" />
          <a-typography-text type="secondary" class="foot">{{ t('nodeDetail.poolIpv4InUse', { n: pool.ipv4InUse }) }}</a-typography-text>
        </a-col>
        <a-col v-if="pool.family === 'ipv6'" :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.poolDistinct64')" :value="pool.distinct64InUse" />
          <a-typography-text type="secondary" class="foot">{{ t('nodeDetail.poolDistinct64A', { n: pool.distinct64Attached }) }}</a-typography-text>
        </a-col>
        <a-col v-if="pool.family === 'ipv6' && pool.capacityCidr" :xs="12" :md="6">
          <a-statistic :title="t('nodeDetail.poolCapacity')" :value="pool.capacityCidr" :value-style="{ fontFamily: 'var(--pb-mono)', fontSize: '16px' }" />
          <a-typography-text type="secondary" class="foot">{{ t('nodeDetail.poolHosts', { n: 128 - Number(pool.capacityCidr.split('/')[1] || 0) }) }}</a-typography-text>
        </a-col>
      </a-row>
    </a-card>

    <!-- ── Recent activity: auto-heal events + open errors for this node ── -->
    <a-card v-if="node && (recentFixes.length || recentErrors.length)">
      <template #title><HistoryOutlined /> {{ t('nodeDetail.recentTitle') }}</template>
      <template v-if="recentErrors.length">
        <a-typography-title :level="5" type="danger" class="sub-title"><ExclamationCircleOutlined /> {{ t('nodeDetail.openErrors', { n: recentErrors.length }) }}</a-typography-title>
        <a-table :columns="errorColumns" :data-source="recentErrors" row-key="id" size="small" :pagination="false" :show-header="false" :scroll="{ x: 640 }" class="block-gap">
          <template #bodyCell="{ column, record: e }">
            <template v-if="column.key === 'ago'"><a-typography-text type="secondary" class="mono small">{{ fmtAgo(e.last_ts) }}</a-typography-text></template>
            <template v-else-if="column.key === 'level'"><StatusTag :status="e.level" :color="e.level === 'error' ? 'error' : 'warning'" /></template>
            <template v-else-if="column.key === 'source'"><span class="mono">{{ e.source }}/{{ e.code }}</span></template>
            <template v-else-if="column.key === 'count'"><a-typography-text type="warning" class="mono">×{{ e.count }}</a-typography-text></template>
          </template>
        </a-table>
      </template>
      <template v-if="recentFixes.length">
        <a-typography-title :level="5" type="secondary" class="sub-title">{{ t('nodeDetail.autoHeal', { n: recentFixes.length }) }}</a-typography-title>
        <a-table :columns="fixColumns" :data-source="recentFixes" row-key="_k" size="small" :pagination="false" :show-header="false" :scroll="{ x: 560 }">
          <template #bodyCell="{ column, record: f }">
            <template v-if="column.key === 'ts'"><a-typography-text type="secondary" class="mono small">{{ (f.ts || '').slice(11, 19) }}</a-typography-text></template>
            <template v-else-if="column.key === 'action'">
              <a-space :size="4">
                <StatusTag :status="fixAction(f).label" :label="fixAction(f).label" :color="fixAction(f).color" />
                <a-typography-text type="secondary" class="mono small">{{ (f.path || '').match(/\/proxy\/([^/]+)/)?.[1] }}</a-typography-text>
              </a-space>
            </template>
            <template v-else-if="column.key === 'note'"><span class="mono">{{ f.note }}</span></template>
          </template>
        </a-table>
      </template>
    </a-card>

    <!-- ── Upgrade agent — admin runs the one-liner on the node to swap binary ── -->
    <a-card v-if="node && !isLocal">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <a-space :size="8" wrap>
            <span><CloudDownloadOutlined /> {{ t('nodeDetail.upgradeTitle') }}</span>
            <StatusTag v-if="upgrade?.outdated" status="pending" :label="t('nodeDetail.upgradeOutdated', { cur: upgrade.currentVersion, latest: upgrade.latestVersion })" />
            <StatusTag v-else-if="upgrade && !upgrade.outdated && upgrade.currentVersion" status="active" :label="t('nodeDetail.upgradeLatest', { latest: upgrade.latestVersion })" />
          </a-space>
          <a-button size="small" :loading="upgradeLoading" @click="rotateUpgradeToken">{{ t('nodeDetail.upgradeRotate') }}</a-button>
        </a-flex>
      </template>
      <a-space v-if="!upgrade">
        <a-spin size="small" />
        <a-typography-text type="secondary">{{ t('nodeDetail.upgradeLoading') }}</a-typography-text>
      </a-space>
      <template v-else>
        <!-- eslint-disable-next-line vue/no-v-html -- trusted i18n markup (<code>) -->
        <a-typography-paragraph type="secondary"><span v-html="t('nodeDetail.upgradeHint', { host: node.host })"></span></a-typography-paragraph>
        <a-flex align="flex-start" gap="small" class="cmd-row">
          <a-typography-paragraph class="cmd-block"><pre class="mono">{{ upgrade.oneLiner }}</pre></a-typography-paragraph>
          <a-button @click="copyUpgradeCmd">
            <template #icon><CheckOutlined v-if="upgradeCopied" /><CopyOutlined v-else /></template>
            {{ upgradeCopied ? t('nodeDetail.upgradeCopied') : t('nodeDetail.upgradeCopy') }}
          </a-button>
        </a-flex>
        <a-typography-text type="secondary" class="small">
          {{ t('nodeDetail.upgradeScript') }}: <a-typography-link :href="upgrade.upgradeScriptUrl" target="_blank" rel="noopener">{{ t('nodeDetail.upgradeScriptView') }}</a-typography-link> ·
          {{ t('nodeDetail.upgradeBinary') }}: <a-typography-link :href="upgrade.binaryUrl" target="_blank" rel="noopener">{{ t('nodeDetail.upgradeBinaryDl') }}</a-typography-link>
        </a-typography-text>
      </template>
    </a-card>

    <!-- ── Network infrastructure ── -->
    <a-card v-if="node">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span><HddOutlined /> {{ t('nodes.networkInfra') }}</span>
          <a-button size="small" :loading="syncing" @click="onSync"><template #icon><SyncOutlined /></template>{{ t('nodes.syncIPs') }}</a-button>
        </a-flex>
      </template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 4 }">
        <a-descriptions-item v-if="!isV6" :label="t('nodes.ipv4Count')">{{ ipv4.length }} {{ t('nodes.addresses') }}</a-descriptions-item>
        <a-descriptions-item v-if="!isV4" :label="t('nodes.ipv6Count')">{{ ipv6.length }} {{ t('nodes.addresses') }}</a-descriptions-item>
        <a-descriptions-item v-if="!isV4" :label="t('nodes.ipv6Prefix')"><span class="mono">{{ ipv6Prefixes.length ? ipv6Prefixes.map((p) => p.cidr).join(', ') : '—' }}</span></a-descriptions-item>
        <a-descriptions-item v-if="node.network && node.network.ipv4PoolSize !== undefined" :label="t('nodes.poolSize')">
          {{ isV6 ? (node.network.ipv6PoolSize || 0) : (isV4 ? (node.network.ipv4PoolSize || 0) : (node.network.ipv4PoolSize || 0) + (node.network.ipv6PoolSize || 0)) }}
        </a-descriptions-item>
      </a-descriptions>
      <a-collapse v-if="(!isV6 && ipv4.length) || (!isV4 && ipv6.length)" ghost class="ip-lists">
        <a-collapse-panel v-if="!isV6 && ipv4.length" key="v4" :header="`${t('nodes.showIpv4List')} (${ipv4.length})`">
          <a-typography-paragraph class="cmd-block scroll-block" :copyable="{ text: ipv4.map((e) => e.address).join(', ') }"><pre class="mono">{{ ipv4.map((e) => e.address).join(', ') }}</pre></a-typography-paragraph>
        </a-collapse-panel>
        <a-collapse-panel v-if="!isV4 && ipv6.length" key="v6" :header="`${t('nodes.showIpv6List')} (${ipv6.length})`">
          <a-typography-paragraph class="cmd-block scroll-block" :copyable="{ text: ipv6.map((e) => e.address).join(', ') }"><pre class="mono">{{ ipv6.map((e) => e.address).join(', ') }}</pre></a-typography-paragraph>
        </a-collapse-panel>
      </a-collapse>
    </a-card>

    <!-- ── Proxies on this node ── -->
    <a-card v-if="node && proxyGroups.length">
      <template #title><ClusterOutlined /> {{ t('nodes.proxiesOnNode') }}</template>
      <div v-for="g in proxyGroups" :key="g.key" class="block-gap">
        <a-typography-text type="secondary">{{ g.label }} ({{ g.list.length }})</a-typography-text>
        <a-table :columns="proxyColumns" :data-source="g.list.slice(0, 20)" row-key="id" size="small" :pagination="false" :show-header="false" :scroll="{ x: 480 }">
          <template #bodyCell="{ column, record: p }">
            <template v-if="column.key === 'endpoint'">
              <a-space :size="6" wrap>
                <a-typography-text class="mono" :copyable="{ text: `${p.ip || p.bindIp}:${p.port}` }">{{ p.ip || p.bindIp }}:{{ p.port }}</a-typography-text>
                <a-tag v-if="p.mode === 'rotating'" color="purple" :bordered="false">rotating</a-tag>
              </a-space>
            </template>
            <template v-else-if="column.key === 'status'"><StatusTag :status="p.status" /></template>
          </template>
        </a-table>
        <a-typography-text v-if="g.list.length > 20" type="secondary">… {{ t('nodes.andMore') }} {{ g.list.length - 20 }}</a-typography-text>
      </div>
    </a-card>

    <a-card v-if="installOutput" :title="t('nodes.installOutput')">
      <a-typography-paragraph class="cmd-block scroll-block"><pre class="mono">{{ installOutput }}</pre></a-typography-paragraph>
    </a-card>

    <!-- ── Logs viewer (journalctl via SSH for remote, local file for control plane) ── -->
    <a-card>
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span><CodeOutlined /> {{ t('nodes.logs') }}</span>
          <a-space wrap :size="8">
            <a-input-number v-model:value="logsLines" :min="10" :max="5000" size="small" :addon-before="t('nodes.logsLines')" class="lines-input" />
            <a-button size="small" :loading="logsLoading" @click="fetchLogs"><template #icon><ReloadOutlined /></template>{{ logsLoading ? t('common.loading') : t('common.refresh') }}</a-button>
            <a-button size="small" @click="toggleLogs">{{ logsOpen ? t('nodes.logsHide') : t('nodes.logsShow') }}</a-button>
          </a-space>
        </a-flex>
      </template>
      <a-alert v-if="logsErr" type="error" show-icon :message="logsErr" class="block-gap" />
      <pre v-if="logsOpen" class="mono log-block">{{ logsOutput || t('nodes.logsEmpty') }}</pre>
      <a-typography-text v-else-if="!logsErr" type="secondary">
        <FileTextOutlined /> {{ isLocal ? t('nodes.logsHintLocal') : t('nodes.logsHintRemote') }}
      </a-typography-text>
    </a-card>
  </div>
</template>

<style scoped>
.card-head-controls { padding: 8px 0; }
.card-head-controls :deep(.ant-btn), .card-head-controls :deep(.ant-input-number-group-addon) { font-weight: 400; }
.small { font-size: 12px; }
.foot { display: block; font-size: 12px; margin-top: 2px; }
.block-gap { margin-bottom: 16px; }
.sub-title { font-size: 14px !important; margin-bottom: 8px !important; }
.chart-controls { margin: 16px 0 8px; }
.card-note { margin: 12px 16px !important; }
.clickable-rows :deep(.ant-table-row) { cursor: pointer; }
.drill-head { margin-bottom: 8px; }
.action-running { margin-top: 12px; }
.cmd-row { flex-wrap: wrap; }
.cmd-row .cmd-block { flex: 1; min-width: 0; }
.cmd-block { margin-bottom: 8px !important; }
.cmd-block pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
.scroll-block pre { max-height: 240px; overflow: auto; }
.ip-lists { margin-top: 12px; }
.lines-input { width: 140px; }
.log-block {
  margin: 0;
  max-height: 480px;
  overflow: auto;
  padding: 12px;
  font-size: 11.5px;
  white-space: pre-wrap;
  background: var(--pb-bg);
  border: 1px solid var(--pb-border-soft);
  border-radius: 8px;
}
</style>
