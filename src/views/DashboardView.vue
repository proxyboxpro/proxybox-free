<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, ChevronRight, Cpu, Database, FileText,
  Gauge, Globe, HardDrive, KeyRound, Network, Plus, RefreshCw, Server, ShieldAlert,
  ShieldCheck, Users, Zap
} from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { formatBytes, formatNumber } from '../utils/format'
import { apiFetch } from '../api'

const apexchart = VueApexCharts.component || VueApexCharts
const { t } = useI18n()
const router = useRouter()

// ── State ──────────────────────────────────────────────────────────────────
const dashboard = ref(null)
const tsRange = ref('1h')
const tsPoints = ref([])
const tsLoading = ref(false)
const tsTab = ref('conns') // conns | bandwidth
const refreshing = ref(false)
let pollTimer = null, tsTimer = null

async function loadDashboard() {
  refreshing.value = true
  try { dashboard.value = await apiFetch('/api/admin/dashboard') }
  catch { /* keep last */ }
  finally { refreshing.value = false }
}
async function loadTimeseries() {
  tsLoading.value = true
  try {
    const data = await apiFetch(`/api/admin/metrics/timeseries?range=${tsRange.value}`)
    tsPoints.value = data?.points || []
  } catch { /* keep last */ }
  finally { tsLoading.value = false }
}
function setTsRange(r) { tsRange.value = r; loadTimeseries() }

// ── Computed shortcuts ─────────────────────────────────────────────────────
const sys = computed(() => dashboard.value?.system || null)
const px = computed(() => dashboard.value?.proxies || { total: 0, active: 0, expired: 0, grace: 0, error: 0, ipv4: 0, ipv6: 0, expiringSoon: 0 })
const nd = computed(() => dashboard.value?.nodes || { total: 0, online: 0, offline: 0, list: [] })
const tr = computed(() => dashboard.value?.traffic || { liveConns: 0, totalConns: 0, uploadBytes: 0, downloadBytes: 0, monthBytes: 0 })
const tops = computed(() => dashboard.value?.topTargets || [])
const audit = computed(() => dashboard.value?.recentAudit || [])
const saturation = computed(() => dashboard.value?.saturation || [])
const caps = computed(() => dashboard.value?.caps || { maxConnsPerProxy: 100, maxConnsPerSrcIp: 60, newConnsPerSecPerIp: 30 })

const verdict = computed(() => {
  if (px.value.expired > 0 || nd.value.offline > 0 || px.value.error > 0) return 'alert'
  if (px.value.expiringSoon > 0 || px.value.grace > 0) return 'warn'
  return 'ok'
})

function fmtUptime(s) {
  if (!s) return '—'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`)
}
function pct(num, den) { return den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0 }

// ── Chart configs ──────────────────────────────────────────────────────────
const COLORS = { green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', yellow: '#f59e0b', red: '#ef4444', cyan: '#06b6d4', grey: '#64748b' }
const CHART_BASE = {
  chart: { toolbar: { show: false }, animations: { enabled: false }, background: 'transparent', fontFamily: 'inherit' },
  theme: { mode: 'dark' },
  dataLabels: { enabled: false },
  grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 2 },
  tooltip: { theme: 'dark' }
}

const connSeries = computed(() => [{ name: 'Kết nối live', data: tsPoints.value.map((p) => [p.ts, p.active || 0]) }])
const connOptions = computed(() => ({
  ...CHART_BASE,
  chart: { ...CHART_BASE.chart, type: 'area' },
  stroke: { curve: 'smooth', width: 2 },
  colors: [COLORS.green],
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.8, opacityFrom: 0.4, opacityTo: 0.02 } },
  xaxis: { type: 'datetime', labels: { style: { colors: '#94a3b8', fontSize: '11px' } } },
  yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (v) => formatNumber(Math.round(v)) } },
  tooltip: { ...CHART_BASE.tooltip, x: { format: tsRange.value === '1h' ? 'HH:mm' : 'dd/MM HH:mm' } }
}))

const bwSeries = computed(() => [
  { name: 'Download', data: tsPoints.value.map((p) => [p.ts, (p.down ?? p.bpsIn) || 0]) },
  { name: 'Upload',   data: tsPoints.value.map((p) => [p.ts, (p.up   ?? p.bpsOut) || 0]) }
])
const bwOptions = computed(() => ({
  ...CHART_BASE,
  chart: { ...CHART_BASE.chart, type: 'area', stacked: true },
  stroke: { curve: 'smooth', width: 1.5 },
  colors: [COLORS.blue, COLORS.purple],
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.6, opacityFrom: 0.35, opacityTo: 0.05 } },
  xaxis: { type: 'datetime', labels: { style: { colors: '#94a3b8', fontSize: '11px' } } },
  yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (v) => formatBytes(v) } },
  tooltip: { ...CHART_BASE.tooltip, y: { formatter: (v) => formatBytes(v) }, x: { format: tsRange.value === '1h' ? 'HH:mm' : 'dd/MM HH:mm' } },
  legend: { labels: { colors: '#94a3b8' }, fontSize: '11px' }
}))

// Status donut
const statusDonutSeries = computed(() => [px.value.active, px.value.expiringSoon, px.value.grace, px.value.expired, px.value.error])
const statusDonutOptions = computed(() => ({
  ...CHART_BASE,
  chart: { ...CHART_BASE.chart, type: 'donut' },
  labels: ['Active', 'Sắp hết hạn', 'Grace', 'Hết hạn', 'Lỗi'],
  colors: [COLORS.green, COLORS.yellow, COLORS.cyan, COLORS.red, COLORS.grey],
  legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px', itemMargin: { horizontal: 6, vertical: 4 } },
  plotOptions: { pie: { donut: { size: '68%', labels: { show: true, name: { color: '#94a3b8', fontSize: '11px' }, value: { color: '#e2e8f0', fontSize: '20px', fontWeight: 700 }, total: { show: true, label: 'Tổng', color: '#94a3b8', formatter: () => px.value.total } } } } },
  stroke: { width: 0 }
}))

// Family donut
const familyDonutSeries = computed(() => [px.value.ipv4, px.value.ipv6])
const familyDonutOptions = computed(() => ({
  ...CHART_BASE,
  chart: { ...CHART_BASE.chart, type: 'donut' },
  labels: ['IPv4', 'IPv6'],
  colors: [COLORS.blue, COLORS.purple],
  legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
  plotOptions: { pie: { donut: { size: '68%', labels: { show: true, name: { color: '#94a3b8', fontSize: '11px' }, value: { color: '#e2e8f0', fontSize: '20px', fontWeight: 700 }, total: { show: true, label: 'Pool', color: '#94a3b8', formatter: () => px.value.total } } } } },
  stroke: { width: 0 }
}))

// ── Nav helpers ────────────────────────────────────────────────────────────
function goNodes()   { router.push({ name: 'admin-nodes' }) }
function goProxies() { router.push({ name: 'admin-orders' }) }
function goSettings(){ router.push({ name: 'admin-features' }) }
function goConn(id)  { router.push({ name: 'admin-connection-detail', params: { proxyId: id } }) }

onMounted(() => {
  loadDashboard(); loadTimeseries()
  pollTimer = setInterval(() => loadDashboard(), 15_000)
  tsTimer   = setInterval(() => loadTimeseries(), 30_000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tsTimer)   clearInterval(tsTimer)
})
</script>

<template>
  <section class="dash">
    <!-- ── Header bar: status pill + refresh + version ─────────────────────── -->
    <div class="dash-head">
      <div class="dh-left">
        <span :class="['health-dot', verdict]"></span>
        <h1>Dashboard</h1>
        <span class="muted-sm">{{ verdict === 'ok' ? 'Tất cả ổn định' : verdict === 'warn' ? 'Cần chú ý' : 'Có sự cố' }}</span>
      </div>
      <div class="dh-right">
        <span v-if="sys" class="muted-sm">v{{ sys.version }} · uptime {{ fmtUptime(sys.uptimeSeconds) }}</span>
        <button class="ghost-button" type="button" :disabled="refreshing" @click="loadDashboard">
          <RefreshCw :size="13" :class="{ spin: refreshing }" />
        </button>
      </div>
    </div>

    <!-- ── 6-card KPI hero ──────────────────────────────────────────────────── -->
    <div class="kpi-row">
      <article class="kpi" @click="goProxies">
        <div class="kpi-icon" style="background:rgba(34,197,94,0.12);color:#22c55e"><Network :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Proxies</span>
          <strong class="kpi-val">{{ formatNumber(px.active) }} <small>/ {{ formatNumber(px.total) }}</small></strong>
          <span class="kpi-sub"><span class="cell-mono">{{ px.ipv4 }}</span> v4 · <span class="cell-mono">{{ px.ipv6 }}</span> v6</span>
        </div>
      </article>
      <article class="kpi" @click="goNodes">
        <div class="kpi-icon" style="background:rgba(139,92,246,0.12);color:#a78bfa"><Server :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Nodes</span>
          <strong class="kpi-val">{{ nd.online }} <small>/ {{ nd.total }}</small></strong>
          <span class="kpi-sub" :class="{ 'err-text': nd.offline > 0 }">{{ nd.offline === 0 ? 'all online' : `${nd.offline} offline` }}</span>
        </div>
      </article>
      <article class="kpi">
        <div class="kpi-icon" style="background:rgba(59,130,246,0.12);color:#60a5fa"><Activity :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Live connections</span>
          <strong class="kpi-val">{{ formatNumber(tr.liveConns) }}</strong>
          <span class="kpi-sub">{{ formatNumber(tr.totalConns) }} all-time</span>
        </div>
      </article>
      <article class="kpi">
        <div class="kpi-icon" style="background:rgba(245,158,11,0.12);color:#fbbf24"><AlertTriangle :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Sắp hết hạn 7d</span>
          <strong class="kpi-val">{{ px.expiringSoon }}</strong>
          <span class="kpi-sub" :class="{ 'err-text': px.expired > 0 }">{{ px.expired }} expired</span>
        </div>
      </article>
      <article class="kpi">
        <div class="kpi-icon" style="background:rgba(6,182,212,0.12);color:#22d3ee"><HardDrive :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Băng thông tháng</span>
          <strong class="kpi-val">{{ formatBytes(tr.monthBytes) }}</strong>
          <span class="kpi-sub">↑ {{ formatBytes(tr.uploadBytes) }} · ↓ {{ formatBytes(tr.downloadBytes) }}</span>
        </div>
      </article>
      <article class="kpi" @click="goSettings">
        <div class="kpi-icon" style="background:rgba(239,68,68,0.12);color:#f87171"><ShieldAlert :size="16" /></div>
        <div class="kpi-body">
          <span class="kpi-label">Cap (A/B/C)</span>
          <strong class="kpi-val cell-mono">{{ caps.maxConnsPerProxy }}/{{ caps.maxConnsPerSrcIp }}/{{ caps.newConnsPerSecPerIp }}</strong>
          <span class="kpi-sub">proxy · IP · /s</span>
        </div>
      </article>
    </div>

    <!-- ── Main timeseries (tabbed: conns | bandwidth) ──────────────────────── -->
    <section class="surface chart-panel">
      <header class="ch-head">
        <div class="ch-tabs">
          <button type="button" :class="{ active: tsTab === 'conns' }" @click="tsTab = 'conns'"><Activity :size="12" /> Kết nối live</button>
          <button type="button" :class="{ active: tsTab === 'bandwidth' }" @click="tsTab = 'bandwidth'"><HardDrive :size="12" /> Băng thông</button>
        </div>
        <div class="seg-range">
          <button v-for="r in ['1h','24h','7d','30d']" :key="r" type="button" :class="{ active: tsRange === r }" @click="setTsRange(r)">{{ r }}</button>
        </div>
      </header>
      <div class="ch-body">
        <p v-if="!tsPoints.length" class="empty-text">Chưa có dữ liệu cho khoảng <strong>{{ tsRange }}</strong>. Biểu đồ tự cập nhật khi có request.</p>
        <apexchart v-else-if="tsTab === 'conns'" type="area" :options="connOptions" :series="connSeries" :height="280" />
        <apexchart v-else type="area" :options="bwOptions" :series="bwSeries" :height="280" />
      </div>
    </section>

    <!-- ── 3-col mid row: status donut + family donut + cap saturation ──────── -->
    <div class="mid-grid">
      <section class="surface mid-card">
        <header class="card-h"><span>Trạng thái proxy</span></header>
        <apexchart v-if="px.total" type="donut" :options="statusDonutOptions" :series="statusDonutSeries" :height="240" />
        <p v-else class="empty-text">Chưa có proxy nào.</p>
      </section>
      <section class="surface mid-card">
        <header class="card-h"><span>Phân bổ family</span></header>
        <apexchart v-if="px.total" type="donut" :options="familyDonutOptions" :series="familyDonutSeries" :height="240" />
        <p v-else class="empty-text">Chưa có proxy nào.</p>
      </section>
      <section class="surface mid-card">
        <header class="card-h">
          <span>Cap saturation</span>
          <small class="muted-sm">≥50% cap A</small>
        </header>
        <div v-if="saturation.length" class="sat-list">
          <button v-for="s in saturation" :key="s.id" type="button" class="sat-row" :class="{ near: s.pct >= 80 }" @click="goConn(s.id)">
            <code class="cell-mono">{{ s.id }}</code>
            <span class="sat-bar"><span :style="{ width: s.pct + '%' }"></span></span>
            <span class="sat-num cell-mono">{{ s.active }}/{{ s.max }}</span>
          </button>
        </div>
        <p v-else class="empty-text" style="padding-top:20px">Không có proxy nào đang gần cap.</p>
      </section>
    </div>

    <!-- ── Per-node load grid ───────────────────────────────────────────────── -->
    <section class="surface">
      <header class="card-h">
        <span><Server :size="13" style="vertical-align:-2px" /> Nodes ({{ nd.list.length }})</span>
        <button class="text-mini" type="button" @click="goNodes">Xem chi tiết <ChevronRight :size="12" /></button>
      </header>
      <div v-if="nd.list.length" class="node-grid">
        <article v-for="n in nd.list" :key="n.id" class="node-card" :class="{ offline: n.status !== 'online' }">
          <div class="nc-head">
            <span :class="['node-fam', n.family]">{{ (n.family || 'dual').toUpperCase() }}</span>
            <strong class="nc-name">{{ n.name }}</strong>
            <span :class="['nc-status', n.status === 'online' ? 'on' : 'off']">{{ n.status }}</span>
          </div>
          <p class="nc-host cell-mono">{{ n.host }}</p>
          <div class="nc-metrics">
            <div>
              <small>Proxies</small>
              <strong>{{ n.proxies }}</strong>
            </div>
            <div>
              <small>Active conn</small>
              <strong style="color:var(--green)">{{ formatNumber(n.activeConns) }}</strong>
            </div>
            <div>
              <small>Bandwidth</small>
              <strong>{{ formatBytes(n.monthBytes) }}</strong>
            </div>
          </div>
          <div class="nc-bar">
            <span :style="{ width: pct(n.activeConns, Math.max(1, n.proxies * caps.maxConnsPerProxy)) + '%' }"></span>
          </div>
        </article>
      </div>
      <p v-else class="empty-text">Chưa có node nào.</p>
    </section>

    <!-- ── 2-col bottom: top destinations + recent activity ─────────────────── -->
    <div class="bot-grid">
      <section class="surface">
        <header class="card-h"><span><Globe :size="13" style="vertical-align:-2px" /> Top destination hosts</span></header>
        <div v-if="tops.length" class="dst-list">
          <div v-for="(t, i) in tops" :key="t.host" class="dst-row">
            <span class="dst-rank">{{ i + 1 }}</span>
            <code class="dst-host cell-mono">{{ t.host }}</code>
            <span class="dst-bar"><span :style="{ width: pct(t.bytes, tops[0]?.bytes) + '%' }"></span></span>
            <span class="dst-bytes cell-mono">{{ formatBytes(t.bytes) }}</span>
            <span class="dst-count">{{ formatNumber(t.count) }} req</span>
          </div>
        </div>
        <p v-else class="empty-text">Chưa có traffic.</p>
      </section>

      <section class="surface">
        <header class="card-h"><span><FileText :size="13" style="vertical-align:-2px" /> Recent activity</span></header>
        <div v-if="audit.length" class="audit-list">
          <div v-for="(a, i) in audit" :key="i" class="audit-row">
            <span :class="['audit-method', `m-${(a.method || '').toLowerCase()}`]">{{ a.method }}</span>
            <code class="audit-path cell-mono" :title="a.path">{{ a.path }}</code>
            <span :class="['audit-status', a.status >= 400 ? 'err' : a.status >= 300 ? 'warn' : 'ok']">{{ a.status || '—' }}</span>
            <span class="audit-actor muted-sm">{{ a.actor || '—' }}</span>
            <span class="audit-ts muted-sm">{{ a.ts ? a.ts.slice(11,19) : '' }}</span>
          </div>
        </div>
        <p v-else class="empty-text">Chưa có hoạt động.</p>
      </section>
    </div>

    <!-- ── System health strip (footer) ─────────────────────────────────────── -->
    <section v-if="sys" class="surface sys-strip">
      <div class="ss-item">
        <span class="muted-sm">Heap RAM</span>
        <strong class="cell-mono">{{ formatBytes(sys.memory.heapUsed) }} <small>/ {{ formatBytes(sys.memory.heapTotal) }}</small></strong>
        <div class="mini-bar"><span :style="{ width: pct(sys.memory.heapUsed, sys.memory.heapTotal) + '%' }"></span></div>
      </div>
      <div class="ss-item">
        <span class="muted-sm">RSS</span>
        <strong class="cell-mono">{{ formatBytes(sys.memory.rss) }}</strong>
      </div>
      <div class="ss-item">
        <span class="muted-sm">Listeners</span>
        <strong class="cell-mono">{{ sys.listeners }}</strong>
      </div>
      <div class="ss-item">
        <span class="muted-sm">Sessions</span>
        <strong class="cell-mono">{{ sys.sessions.active }}</strong>
      </div>
      <div class="ss-item">
        <span class="muted-sm">Users</span>
        <strong class="cell-mono">{{ formatNumber(sys.users) }}</strong>
      </div>
      <div class="ss-item">
        <span class="muted-sm">DB size</span>
        <strong class="cell-mono">{{ formatBytes(sys.dbSize) }}</strong>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dash { display: flex; flex-direction: column; gap: 14px; padding-bottom: 30px; }
.muted-sm { color: var(--muted); font-size: 11.5px; }
.err-text { color: var(--red); }

/* Head bar */
.dash-head { display: flex; align-items: center; gap: 14px; }
.dash-head h1 { font-size: 22px; margin: 0; font-weight: 700; letter-spacing: -0.01em; }
.dh-left { display: flex; align-items: center; gap: 12px; }
.dh-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.health-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
.health-dot.ok    { background: var(--green); color: var(--green); }
.health-dot.warn  { background: var(--yellow); color: var(--yellow); }
.health-dot.alert { background: var(--red); color: var(--red); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* KPI strip */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
@media (max-width: 1100px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 640px)  { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
.kpi {
  display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px;
  cursor: pointer; transition: border-color 120ms, transform 120ms;
}
.kpi:hover { border-color: var(--muted); transform: translateY(-1px); }
.kpi-icon { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; flex-shrink: 0; }
.kpi-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.kpi-label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.kpi-val { font-size: 22px; font-weight: 700; color: var(--text); font-family: var(--mono); letter-spacing: -0.01em; }
.kpi-val small { font-size: 13px; color: var(--muted); font-weight: 400; }
.kpi-sub { font-size: 11px; color: var(--muted); }

/* Charts */
.chart-panel { padding: 0; overflow: hidden; }
.ch-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 10px; }
.ch-tabs, .seg-range { display: inline-flex; gap: 2px; background: var(--surface-2); padding: 3px; border-radius: 7px; border: 1px solid var(--border); }
.ch-tabs button, .seg-range button {
  background: transparent; border: none; color: var(--muted);
  font-size: 11.5px; padding: 4px 10px; border-radius: 5px;
  cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
}
.ch-tabs button:hover, .seg-range button:hover { color: var(--text); }
.ch-tabs button.active, .seg-range button.active { background: var(--surface); color: var(--green); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
.ch-body { padding: 6px 8px; min-height: 280px; }

/* Mid grid: 2 donuts + saturation */
.mid-grid { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 12px; }
@media (max-width: 900px) { .mid-grid { grid-template-columns: 1fr; } }
.mid-card { padding: 12px 14px; }
.card-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.card-h span { font-size: 13px; color: var(--text); font-weight: 600; }
.card-h .text-mini { font-size: 11.5px; color: var(--muted); background: none; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
.card-h .text-mini:hover { color: var(--green); }

.sat-list { display: flex; flex-direction: column; gap: 4px; }
.sat-row {
  display: grid; grid-template-columns: 100px 1fr 70px; gap: 8px;
  align-items: center; background: transparent; border: none; padding: 5px 8px;
  border-radius: 5px; cursor: pointer; color: var(--text); font-size: 11.5px;
}
.sat-row:hover { background: var(--surface-2); }
.sat-bar { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
.sat-bar span { display: block; height: 100%; background: var(--green); transition: width 0.3s; }
.sat-row.near .sat-bar span { background: var(--yellow); }
.sat-row.near.near .sat-bar span { background: var(--red); }
.sat-num { text-align: right; color: var(--muted); }
.sat-row.near .sat-num { color: var(--yellow); }

/* Node grid */
.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.node-card {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.node-card.offline { opacity: 0.55; border-color: var(--red); }
.nc-head { display: flex; align-items: center; gap: 8px; }
.node-fam {
  font-family: var(--mono); font-size: 9.5px; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(59,130,246,0.16); color: #60a5fa;
}
.node-fam.ipv6 { background: rgba(139,92,246,0.16); color: #a78bfa; }
.node-fam.dual { background: rgba(6,182,212,0.16); color: #22d3ee; }
.nc-name { font-size: 13px; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 4px; }
.nc-status.on { background: rgba(34,197,94,0.16); color: var(--green); }
.nc-status.off { background: rgba(239,68,68,0.16); color: var(--red); }
.nc-host { font-size: 11px; color: var(--muted); margin: 0; }
.nc-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.nc-metrics > div { display: flex; flex-direction: column; gap: 1px; }
.nc-metrics small { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.nc-metrics strong { font-size: 13px; color: var(--text); font-family: var(--mono); }
.nc-bar { height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; }
.nc-bar span { display: block; height: 100%; background: var(--green); }

/* Bottom 2-col */
.bot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 900px) { .bot-grid { grid-template-columns: 1fr; } }

.dst-list { display: flex; flex-direction: column; gap: 5px; }
.dst-row { display: grid; grid-template-columns: 24px 1fr 80px 90px 80px; gap: 8px; align-items: center; font-size: 11.5px; padding: 4px 0; }
.dst-rank { font-family: var(--mono); color: var(--muted); font-size: 10.5px; text-align: right; }
.dst-host { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dst-bar { height: 5px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
.dst-bar span { display: block; height: 100%; background: var(--blue); }
.dst-bytes { text-align: right; color: var(--text); }
.dst-count { text-align: right; color: var(--muted); font-size: 10.5px; }

.audit-list { display: flex; flex-direction: column; gap: 3px; }
.audit-row {
  display: grid; grid-template-columns: 50px 1fr 50px 100px 60px; gap: 8px;
  align-items: center; font-size: 11.5px;
  padding: 4px 6px; border-radius: 4px;
}
.audit-row:hover { background: var(--surface-2); }
.audit-method { font-family: var(--mono); font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-align: center; }
.audit-method.m-get    { background: rgba(34,197,94,0.16);  color: #22c55e; }
.audit-method.m-post   { background: rgba(59,130,246,0.16); color: #60a5fa; }
.audit-method.m-patch  { background: rgba(245,158,11,0.16); color: #f59e0b; }
.audit-method.m-delete { background: rgba(239,68,68,0.16);  color: #ef4444; }
.audit-method.m-put    { background: rgba(245,158,11,0.16); color: #f59e0b; }
.audit-path { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audit-status { font-family: var(--mono); font-size: 10.5px; text-align: center; }
.audit-status.ok   { color: var(--green); }
.audit-status.warn { color: var(--yellow); }
.audit-status.err  { color: var(--red); }
.audit-actor { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audit-ts { text-align: right; font-family: var(--mono); font-size: 10.5px; }

/* System strip footer */
.sys-strip {
  display: grid; grid-template-columns: repeat(6, 1fr);
  gap: 14px; padding: 12px 16px;
}
@media (max-width: 800px) { .sys-strip { grid-template-columns: repeat(3, 1fr); } }
.ss-item { display: flex; flex-direction: column; gap: 2px; }
.ss-item strong { font-size: 13px; color: var(--text); font-family: var(--mono); }
.ss-item strong small { color: var(--muted); font-size: 11px; font-weight: 400; }
.mini-bar { height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; margin-top: 4px; overflow: hidden; }
.mini-bar span { display: block; height: 100%; background: var(--green); }
</style>
