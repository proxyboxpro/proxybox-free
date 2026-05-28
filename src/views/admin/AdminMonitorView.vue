<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Activity, Cpu, HardDrive, Network, Pause, Play, RefreshCw } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatBytes } from '../../utils/format'

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
    const arr = await apiFetch('/api/nodes')
    nodes.value = (Array.isArray(arr) ? arr : []).map((n) => ({
      id: n.id,
      name: n.name || n.id,
      host: n.host || (n.id === 'local' ? 'control plane' : ''),
      status: n.status,
      version: n.version || '',
      family: n.family || 'auto',
      isLocal: n.id === 'local',
      metrics: n.metrics || null,
      alerts: n.alerts || {},
      proxies: (n.proxies || []).length || n.proxiesCount || 0
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

function pctClass(v, warn, crit) {
  if (v >= crit) return 'crit'
  if (v >= warn) return 'warn'
  return 'ok'
}
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
  if (s < 2) return 'now'
  return s + 's ago'
}

const tick = ref(0)
const liveTimer = setInterval(() => { tick.value++ }, 1000)
onUnmounted(() => clearInterval(liveTimer))
const agoLive = computed(() => { /* eslint-disable-next-line no-unused-expressions */ tick.value; return ago() })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <h1 style="margin:0; font-size:18px"><Activity :size="16" style="vertical-align:-3px" /> Realtime monitor</h1>
      <span style="color:var(--muted); font-size:12px">Cập nhật mỗi {{ REFRESH_MS / 1000 }}s · last: {{ agoLive }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="togglePause">
        <Pause v-if="!paused" :size="13" /><Play v-else :size="13" />
        {{ paused ? 'Resume' : 'Pause' }}
      </button>
      <button class="ghost-button" type="button" :disabled="paused" @click="refresh"><RefreshCw :size="13" /> Refresh now</button>
    </div>

    <p v-if="fetchError" class="error-text">{{ fetchError }}</p>

    <!-- ── Fleet overview ── -->
    <section class="surface">
      <div class="section-head"><h2>Tổng quan fleet ({{ nodes.length }} node)</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Node online</div><div class="metric-value">{{ onlineCount }} / {{ nodes.length }}</div></div>
        <div class="metric-card"><div class="metric-label">CPU trung bình</div><div class="metric-value">{{ totalCpuAvg }}%</div></div>
        <div class="metric-card"><div class="metric-label">RAM (tổng)</div><div class="metric-value">{{ formatBytes(totalRamUsed) }}</div><div class="metric-foot">/ {{ formatBytes(totalRamMax) }}</div></div>
        <div class="metric-card"><div class="metric-label">Network ↓ tổng</div><div class="metric-value">{{ formatBytes(totalRxBps) }}/s</div></div>
        <div class="metric-card"><div class="metric-label">Network ↑ tổng</div><div class="metric-value">{{ formatBytes(totalTxBps) }}/s</div></div>
      </div>
    </section>

    <!-- ── Per-node cards ── -->
    <section v-for="n in nodes" :key="n.id" class="surface">
      <div class="section-head" style="display:flex; gap:8px; align-items:center">
        <h2 style="font-size:14px; margin:0">
          {{ n.name }}
          <small style="color:var(--muted); font-size:11px; margin-left:4px">{{ n.host }}</small>
        </h2>
        <span :class="['status-pill', n.status === 'online' ? 'active' : (n.status === 'install-failed' ? 'failed' : 'pending')]">{{ n.status }}</span>
        <span v-if="n.isLocal" class="status-pill pending" style="font-size:10px">control plane</span>
        <span v-if="n.version" class="cell-mono" style="color:var(--muted); font-size:11px">v{{ n.version }}</span>
        <div class="spacer"></div>
        <small style="color:var(--muted); font-size:11px">{{ n.proxies }} proxy</small>
      </div>
      <div v-if="!n.metrics" class="empty-text" style="padding:12px 0">Chưa có metrics.</div>
      <div v-else class="monitor-row">
        <!-- CPU -->
        <div class="monitor-cell">
          <div class="ml-head"><Cpu :size="13" /> CPU</div>
          <div class="ml-value" :class="pctClass(n.metrics.cpuPct, 70, 90)">{{ n.metrics.cpuPct }}%</div>
          <svg :viewBox="`0 0 120 28`" class="spark" preserveAspectRatio="none">
            <path :d="sparkPath(samples.get(n.id), 'cpu', 100)" />
          </svg>
        </div>
        <!-- RAM -->
        <div class="monitor-cell">
          <div class="ml-head"><HardDrive :size="13" /> RAM</div>
          <div class="ml-value" :class="pctClass(n.metrics.ramPct, ramThreshold(n) - 20, ramThreshold(n))">{{ n.metrics.ramPct }}%</div>
          <div class="ml-foot">{{ formatBytes(n.metrics.ramUsed) }} / {{ formatBytes(n.metrics.ramTotal) }}</div>
          <svg :viewBox="`0 0 120 28`" class="spark" preserveAspectRatio="none">
            <path :d="sparkPath(samples.get(n.id), 'ram', 100)" />
          </svg>
        </div>
        <!-- Load -->
        <div class="monitor-cell">
          <div class="ml-head"><Activity :size="13" /> Load 1m</div>
          <div class="ml-value" :class="pctClass(n.metrics.load1, loadThreshold(n) * 0.6, loadThreshold(n))">{{ Number(n.metrics.load1).toFixed(2) }}</div>
          <div class="ml-foot">5m: {{ Number(n.metrics.load5).toFixed(2) }}</div>
          <svg :viewBox="`0 0 120 28`" class="spark" preserveAspectRatio="none">
            <path :d="sparkPath(samples.get(n.id), 'load1', loadThreshold(n) * 1.2)" />
          </svg>
        </div>
        <!-- Network -->
        <div class="monitor-cell" style="flex:1.6">
          <div class="ml-head"><Network :size="13" /> Network</div>
          <div style="display:flex; gap:14px; align-items:baseline">
            <div><span class="ml-rx">↓</span> <strong class="cell-mono">{{ formatBytes(n.metrics.netRxBps) }}/s</strong></div>
            <div><span class="ml-tx">↑</span> <strong class="cell-mono">{{ formatBytes(n.metrics.netTxBps) }}/s</strong></div>
          </div>
          <svg :viewBox="`0 0 120 28`" class="spark net" preserveAspectRatio="none">
            <path class="rx" :d="netPath(n.id).rx" />
            <path class="tx" :d="netPath(n.id).tx" />
          </svg>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.monitor-row { display: flex; gap: 12px; align-items: stretch; flex-wrap: wrap }
.monitor-cell { flex: 1; min-width: 150px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px }
.ml-head { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: flex; align-items: center; gap: 4px }
.ml-value { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--text); line-height: 1.1 }
.ml-value.ok    { color: var(--green) }
.ml-value.warn  { color: var(--yellow) }
.ml-value.crit  { color: var(--red) }
.ml-foot { font-size: 11px; color: var(--muted); font-family: var(--mono) }
.ml-rx { color: var(--green) }
.ml-tx { color: var(--blue) }
.spark { width: 100%; height: 28px; margin-top: auto }
.spark path { fill: none; stroke: var(--green); stroke-width: 1.5 }
.spark.net path.rx { stroke: var(--green); opacity: 0.9 }
.spark.net path.tx { stroke: var(--blue); opacity: 0.9 }
</style>
