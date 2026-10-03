<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Empty } from 'ant-design-vue'
import { apiFetch } from '../../api'
import { formatBytes } from '../../utils/format'
import { useI18n } from '../../i18n'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

const REFRESH_MS = 3000
const HISTORY = 60

const samples = ref(new Map())
const paused = ref(false)
const lastFetchMs = ref(0)
const fetchError = ref('')
let timer = null

function push(nodeId, metrics) {
  const arr = samples.value.get(nodeId) || []
  arr.push({
    ts: Date.now(),
    cpu: Number(metrics?.cpuPct) || 0,
    ram: Number(metrics?.ramPct) || 0,
    load1: Number(metrics?.load1) || 0,
    netRx: Number(metrics?.netRxBps) || 0,
    netTx: Number(metrics?.netTxBps) || 0
  })
  while (arr.length > HISTORY) arr.shift()
  samples.value.set(nodeId, arr)
}

const nodes = ref([])
async function refresh() {
  if (paused.value) return
  try {
    const r = await apiFetch('/api/admin/fleet-metrics')
    const list = Array.isArray(r?.nodes) ? r.nodes : []
    nodes.value = list.map((n) => ({
      id: n.id,
      name: n.name || n.id,
      host: n.host || (n.isLocal ? 'control plane' : ''),
      status: n.status,
      version: n.version || '',
      family: n.family || 'auto',
      isLocal: !!n.isLocal,
      metrics: n.metrics || null,
      alerts: n.alerts || {},
      proxies: Number(n.proxies) || 0
    }))
    for (const n of nodes.value) if (n.metrics) push(n.id, n.metrics)
    lastFetchMs.value = Date.now()
    fetchError.value = ''
  } catch (e) { fetchError.value = e.message }
}

onMounted(() => { refresh(); timer = setInterval(refresh, REFRESH_MS) })
onUnmounted(() => { if (timer) clearInterval(timer) })

function togglePause() { paused.value = !paused.value }

function sparkPath(arr, key, max) {
  if (!arr || arr.length < 2) return ''
  const w = 120, h = 28
  const xs = w / Math.max(1, arr.length - 1)
  const peak = max ?? Math.max(1, ...arr.map((a) => a[key]))
  return arr.map((a, i) => {
    const x = (i * xs).toFixed(1)
    const y = (h - (a[key] / peak) * h).toFixed(1)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

function netPath(nodeId) {
  const arr = samples.value.get(nodeId) || []
  if (arr.length < 2) return { rx: '', tx: '', peak: 0 }
  const peak = Math.max(1, ...arr.map((a) => Math.max(a.netRx, a.netTx)))
  return { rx: sparkPath(arr, 'netRx', peak), tx: sparkPath(arr, 'netTx', peak), peak }
}

// ok → green, warn → amber, crit → red (antd typography types)
function pctClass(v, warn, crit) {
  if (v >= crit) return 'danger'
  if (v >= warn) return 'warning'
  return 'success'
}
function statusColor(s) { return s === 'online' ? 'success' : (s === 'install-failed' ? 'error' : 'warning') }
function ramThreshold(n) { return Number(n.alerts?.ramPct) || 90 }
function loadThreshold(n) { return Number(n.alerts?.load1) || 100 }

const totalCpuAvg = computed(() => {
  const v = nodes.value.filter((n) => n.metrics).map((n) => n.metrics.cpuPct)
  if (!v.length) return 0
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length)
})
const totalRamUsed = computed(() => nodes.value.reduce((a, n) => a + (n.metrics?.ramUsed || 0), 0))
const totalRamMax = computed(() => nodes.value.reduce((a, n) => a + (n.metrics?.ramTotal || 0), 0))
const totalRxBps = computed(() => nodes.value.reduce((a, n) => a + (n.metrics?.netRxBps || 0), 0))
const totalTxBps = computed(() => nodes.value.reduce((a, n) => a + (n.metrics?.netTxBps || 0), 0))
const onlineCount = computed(() => nodes.value.filter((n) => n.status === 'online').length)

function ago() {
  if (!lastFetchMs.value) return '—'
  const s = Math.floor((Date.now() - lastFetchMs.value) / 1000)
  if (s < 2) return t('admin.mon.now')
  return s + t('admin.mon.agoSuffix')
}

const tick = ref(0)
const liveTimer = setInterval(() => { tick.value++ }, 1000)
onUnmounted(() => clearInterval(liveTimer))
const agoLive = computed(() => { /* eslint-disable-next-line no-unused-expressions */ tick.value; return ago() })
</script>


<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.mon.refreshNote', { s: REFRESH_MS / 1000, ago: agoLive }) }}</a-typography-text>
      <a-flex wrap="wrap" gap="small">
        <a-button @click="togglePause">
          <template #icon><PauseCircleOutlined v-if="!paused" /><PlayCircleOutlined v-else /></template>
          {{ paused ? t('admin.mon.resume') : t('admin.mon.pause') }}
        </a-button>
        <a-button :disabled="paused" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.mon.refreshNow') }}
        </a-button>
      </a-flex>
    </a-flex>

    <a-alert v-if="fetchError" type="error" show-icon :message="fetchError" />

    <!-- ── Fleet overview ── -->
    <a-card :title="t('admin.mon.fleetTitle', { n: nodes.length })">
      <a-row :gutter="[16, 16]">
        <a-col flex="1 1 140px"><a-statistic :title="t('admin.mon.nodesOnline')" :value="onlineCount" :suffix="`/ ${nodes.length}`" /></a-col>
        <a-col flex="1 1 140px"><a-statistic :title="t('admin.mon.cpuAvg')" :value="totalCpuAvg" suffix="%" /></a-col>
        <a-col flex="1 1 140px">
          <a-statistic :title="t('admin.mon.ramTotal')" :value="formatBytes(totalRamUsed)" />
          <a-typography-text type="secondary" class="foot">/ {{ formatBytes(totalRamMax) }}</a-typography-text>
        </a-col>
        <a-col flex="1 1 140px"><a-statistic :title="t('admin.mon.netDown')" :value="`${formatBytes(totalRxBps)}/s`" /></a-col>
        <a-col flex="1 1 140px"><a-statistic :title="t('admin.mon.netUp')" :value="`${formatBytes(totalTxBps)}/s`" /></a-col>
      </a-row>
    </a-card>

    <!-- ── Per-node cards ── -->
    <a-card v-for="n in nodes" :key="n.id" size="small">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <a-space :size="8" wrap>
            <span>{{ n.name }}</span>
            <a-typography-text type="secondary" class="mono small">{{ n.host }}</a-typography-text>
            <StatusTag :status="n.status" :color="statusColor(n.status)" />
            <a-tag v-if="n.isLocal" color="orange" :bordered="false">{{ t('admin.mon.controlPlane') }}</a-tag>
            <a-typography-text v-if="n.version" type="secondary" class="mono small">v{{ n.version }}</a-typography-text>
          </a-space>
          <a-typography-text type="secondary" class="small">{{ n.proxies }} proxy</a-typography-text>
        </a-flex>
      </template>
      <a-empty v-if="!n.metrics" :image="simpleImage" :description="t('admin.mon.noMetrics')" />
      <a-row v-else :gutter="[12, 12]">
        <!-- CPU -->
        <a-col :xs="24" :sm="12" :xl="6">
          <a-card size="small" class="cell">
            <a-typography-text type="secondary" class="ml-head"><DashboardOutlined /> CPU</a-typography-text>
            <a-typography-text :type="pctClass(n.metrics.cpuPct, 70, 90)" class="ml-value">{{ n.metrics.cpuPct }}%</a-typography-text>
            <svg viewBox="0 0 120 28" class="spark" preserveAspectRatio="none">
              <path :d="sparkPath(samples.get(n.id), 'cpu', 100)" />
            </svg>
          </a-card>
        </a-col>
        <!-- RAM -->
        <a-col :xs="24" :sm="12" :xl="6">
          <a-card size="small" class="cell">
            <a-typography-text type="secondary" class="ml-head"><HddOutlined /> RAM</a-typography-text>
            <a-typography-text :type="pctClass(n.metrics.ramPct, ramThreshold(n) - 20, ramThreshold(n))" class="ml-value">{{ n.metrics.ramPct }}%</a-typography-text>
            <a-typography-text type="secondary" class="ml-foot">{{ formatBytes(n.metrics.ramUsed) }} / {{ formatBytes(n.metrics.ramTotal) }}</a-typography-text>
            <svg viewBox="0 0 120 28" class="spark" preserveAspectRatio="none">
              <path :d="sparkPath(samples.get(n.id), 'ram', 100)" />
            </svg>
          </a-card>
        </a-col>
        <!-- Load -->
        <a-col :xs="24" :sm="12" :xl="6">
          <a-card size="small" class="cell">
            <a-typography-text type="secondary" class="ml-head"><LineChartOutlined /> Load 1m</a-typography-text>
            <a-typography-text :type="pctClass(n.metrics.load1, loadThreshold(n) * 0.6, loadThreshold(n))" class="ml-value">{{ Number(n.metrics.load1).toFixed(2) }}</a-typography-text>
            <a-typography-text type="secondary" class="ml-foot">5m: {{ Number(n.metrics.load5).toFixed(2) }}</a-typography-text>
            <svg viewBox="0 0 120 28" class="spark" preserveAspectRatio="none">
              <path :d="sparkPath(samples.get(n.id), 'load1', loadThreshold(n) * 1.2)" />
            </svg>
          </a-card>
        </a-col>
        <!-- Network -->
        <a-col :xs="24" :sm="12" :xl="6">
          <a-card size="small" class="cell">
            <a-typography-text type="secondary" class="ml-head"><ApiOutlined /> Network</a-typography-text>
            <a-flex wrap="wrap" gap="middle" align="baseline">
              <span><a-typography-text type="success">↓</a-typography-text> <strong class="mono">{{ formatBytes(n.metrics.netRxBps) }}/s</strong></span>
              <span><span class="tx">↑</span> <strong class="mono">{{ formatBytes(n.metrics.netTxBps) }}/s</strong></span>
            </a-flex>
            <svg viewBox="0 0 120 28" class="spark net" preserveAspectRatio="none">
              <path class="rx" :d="netPath(n.id).rx" />
              <path class="tx" :d="netPath(n.id).tx" />
            </svg>
          </a-card>
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>

<style scoped>
.card-head-controls { padding: 6px 0; }
.small { font-size: 12px; }
.foot { display: block; font-size: 12px; margin-top: 2px; }
.cell { height: 100%; }
.cell :deep(.ant-card-body) { display: flex; flex-direction: column; gap: 4px; height: 100%; }
.ml-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.ml-value { font-family: var(--pb-mono); font-size: 22px; font-weight: 600; line-height: 1.2; }
.ml-foot { font-size: 11px; font-family: var(--pb-mono); }
.tx { color: var(--pb-info); }
.spark { width: 100%; height: 28px; margin-top: auto; }
.spark path { fill: none; stroke: var(--pb-success); stroke-width: 1.5; }
.spark.net path.rx { stroke: var(--pb-success); opacity: 0.9; }
.spark.net path.tx { stroke: var(--pb-info); opacity: 0.9; }
</style>
