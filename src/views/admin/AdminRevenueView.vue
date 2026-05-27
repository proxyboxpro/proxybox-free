<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import {
  ArrowDownRight, ArrowUpRight, Crown, DollarSign, Download, Minus,
  RefreshCw, RotateCcw, TrendingUp, Users
} from 'lucide-vue-next'
import { apiFetch, adminAnalyticsHeatmap, adminAnalyticsChurn, adminRevenueBreakdown } from '../../api'
import { useI18n } from '../../i18n'

// Local registration — keeps apexcharts out of the initial bundle. Loaded only
// when this admin route is opened (lazy-imported via router code-splitting).
const apexchart = VueApexCharts.component || VueApexCharts

const { t } = useI18n()
const router = useRouter()

const data = ref(null)
const orders = ref([])
const users = ref([])
const heatmap = ref(null)
const churn = ref(null)
const breakdown = ref(null)
const err = ref('')
const period = ref('day')
const loading = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    [data.value, orders.value, users.value, heatmap.value, churn.value, breakdown.value] = await Promise.all([
      apiFetch(`/api/admin/revenue?period=${period.value}`),
      apiFetch('/api/admin/orders').catch(() => []),
      apiFetch('/api/admin/users').catch(() => []),
      adminAnalyticsHeatmap().catch(() => null),
      adminAnalyticsChurn().catch(() => null),
      adminRevenueBreakdown().catch(() => null)
    ])
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

const currencyCode = 'VND'
const totals = computed(() => data.value?.totals || { gross: 0, topups: 0, refunded: 0, payers: 0 })
const prev = computed(() => data.value?.prevTotals || { gross: 0, topups: 0, refunded: 0, payers: 0 })
const series = computed(() => data.value?.series || [])

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') }
function fmtCompact(n) {
  const v = Number(n || 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}
function pctDelta(now, prev) {
  if (!prev) return now > 0 ? 100 : 0
  return ((now - prev) / prev) * 100
}
function viewUser(id) { router.push({ name: 'admin-user-detail', params: { userId: id } }) }

// ── Top spenders ────────────────────────────────────────────────────────────
const topSpenders = computed(() => {
  const byUser = new Map()
  for (const o of orders.value) {
    if (!o.ownerId) continue
    const amount = Number(o.amount || 0)
    if (amount <= 0) continue
    const prev = byUser.get(o.ownerId) || { ownerId: o.ownerId, total: 0, orderCount: 0 }
    prev.total += amount; prev.orderCount += 1
    byUser.set(o.ownerId, prev)
  }
  const userMap = new Map(users.value.map((u) => [u.id, u]))
  return [...byUser.values()]
    .map((r) => ({ ...r, user: userMap.get(r.ownerId) || { email: '—', plan: '—' } }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
})
const maxSpend = computed(() => Math.max(1, ...topSpenders.value.map((s) => s.total)))
const arpu = computed(() => totals.value.payers > 0 ? Math.round(totals.value.gross / totals.value.payers) : 0)
const arpuPrev = computed(() => prev.value.payers > 0 ? Math.round(prev.value.gross / prev.value.payers) : 0)

// ── ApexCharts shared theme ────────────────────────────────────────────────
const baseChart = {
  background: 'transparent',
  foreColor: '#9ca3af',
  fontFamily: 'Inter, system-ui, sans-serif',
  toolbar: { show: false },
  zoom: { enabled: false },
  animations: { enabled: true, speed: 400 }
}
const baseGrid = { borderColor: 'rgba(148, 163, 184, 0.08)', strokeDashArray: 4, xaxis: { lines: { show: false } } }

// ── Hero chart: revenue trend ──────────────────────────────────────────────
const mainSeries = computed(() => [
  { name: t('admin.rev.legendGross'),  data: series.value.map((r) => Math.round(r.gross || 0)) },
  { name: t('admin.rev.legendTopups'), data: series.value.map((r) => Math.round(r.topups || 0)) }
])
const mainOptions = computed(() => ({
  chart: { ...baseChart, type: 'area', toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } }, sparkline: { enabled: false } },
  colors: ['#22c55e', '#3b82f6'],
  stroke: { curve: 'smooth', width: 2.5 },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.0, stops: [0, 90, 100] }
  },
  dataLabels: { enabled: false },
  legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px', markers: { width: 8, height: 8, radius: 4 } },
  grid: baseGrid,
  xaxis: {
    categories: series.value.map((r) => String(r.bucket || '').slice(-5)),
    labels: { style: { colors: '#6b7280', fontSize: '11px' } },
    axisBorder: { show: false }, axisTicks: { show: false }
  },
  yaxis: {
    labels: { style: { colors: '#6b7280', fontSize: '11px' }, formatter: (v) => fmtCompact(v) },
    axisBorder: { show: false }
  },
  tooltip: { theme: 'dark', y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── KPI sparklines ─────────────────────────────────────────────────────────
function makeSparkOptions(color) {
  return {
    chart: { ...baseChart, type: 'area', sparkline: { enabled: true } },
    stroke: { curve: 'smooth', width: 2 },
    colors: [color],
    fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0 } },
    tooltip: { enabled: false }
  }
}
const sparkGross  = computed(() => [{ data: series.value.map((r) => Math.round(r.gross  || 0)) }])
const sparkTopups = computed(() => [{ data: series.value.map((r) => Math.round(r.topups || 0)) }])
const sparkRefund = computed(() => [{ data: series.value.map((r) => Math.round(r.refunded || 0)) }])
const sparkPayers = computed(() => [{ data: series.value.map(() => totals.value.payers || 0) }])

// ── Donut: revenue by proxy type ───────────────────────────────────────────
const donutTypeSeries = computed(() => {
  if (!breakdown.value) return []
  return [Number(breakdown.value.byType?.ipv4 || 0), Number(breakdown.value.byType?.ipv6 || 0)]
})
const donutTypeOptions = computed(() => ({
  chart: { ...baseChart, type: 'donut' },
  labels: ['IPv4', 'IPv6'],
  colors: ['#3b82f6', '#22c55e'],
  legend: { position: 'bottom', fontSize: '12px', markers: { width: 10, height: 10, radius: 5 } },
  plotOptions: {
    pie: {
      donut: {
        size: '72%',
        labels: {
          show: true,
          name: { fontSize: '12px', color: '#9ca3af' },
          value: {
            fontSize: '20px', fontWeight: 700, color: '#fff',
            formatter: (v) => fmtCompact(v) + ' ' + currencyCode
          },
          total: {
            show: true, label: t('admin.rev.totalSpend'), color: '#9ca3af',
            formatter: () => {
              const sum = donutTypeSeries.value.reduce((a, b) => a + b, 0)
              return fmtCompact(sum) + ' ' + currencyCode
            }
          }
        }
      }
    }
  },
  stroke: { width: 0 },
  dataLabels: { enabled: false },
  tooltip: { theme: 'dark', y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── Bar: revenue by hour-of-day ─────────────────────────────────────────────
const hourSeries = computed(() => [{
  name: 'Revenue',
  data: (breakdown.value?.byHour || new Array(24).fill(0)).map((v) => Math.round(v))
}])
const hourOptions = computed(() => ({
  chart: { ...baseChart, type: 'bar' },
  colors: ['#22c55e'],
  plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
  dataLabels: { enabled: false },
  stroke: { width: 0 },
  grid: baseGrid,
  xaxis: {
    categories: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    labels: { style: { colors: '#6b7280', fontSize: '10px' } },
    axisBorder: { show: false }, axisTicks: { show: false }
  },
  yaxis: { labels: { style: { colors: '#6b7280', fontSize: '11px' }, formatter: (v) => fmtCompact(v) } },
  tooltip: { theme: 'dark', y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── Donut: churn buckets ────────────────────────────────────────────────────
const churnSeries = computed(() => {
  if (!churn.value) return []
  return [churn.value.active7, churn.value.active30, churn.value.dormant30_60, churn.value.dormant60_90, churn.value.churned90plus, churn.value.never]
})
const churnOptions = computed(() => ({
  chart: { ...baseChart, type: 'donut' },
  labels: ['0–7d', '8–30d', '31–60d', '61–90d', '90d+', 'Never'],
  colors: ['#16a34a', '#22c55e', '#f59e0b', '#fb923c', '#ef4444', '#6b7280'],
  legend: { position: 'right', fontSize: '11px', markers: { width: 8, height: 8, radius: 4 } },
  plotOptions: { pie: { donut: { size: '68%' } } },
  stroke: { width: 0 },
  dataLabels: { enabled: false },
  tooltip: { theme: 'dark' }
}))

// ── Heatmap: orders by day × hour ──────────────────────────────────────────
const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const heatmapSeries = computed(() => {
  if (!heatmap.value?.grid) return []
  // ApexCharts heatmap: each "series" = one row (day), data = 24 cells (hours)
  return heatmap.value.grid.map((row, di) => ({
    name: dayLabels[di],
    data: row.map((v, hi) => ({ x: String(hi).padStart(2, '0'), y: v }))
  })).reverse()  // Sunday on top → bottom (visual: T7 top, CN bottom)
})
const heatmapOptions = computed(() => ({
  chart: { ...baseChart, type: 'heatmap', toolbar: { show: false } },
  dataLabels: { enabled: false },
  stroke: { width: 1, colors: ['#0a0e14'] },
  colors: ['#22c55e'],
  plotOptions: {
    heatmap: {
      shadeIntensity: 0.7,
      radius: 3,
      colorScale: {
        ranges: [
          { from: 0, to: 0,   color: 'rgba(148, 163, 184, 0.06)', name: '0' },
          { from: 1, to: 1,   color: 'rgba(34, 197, 94, 0.18)',   name: '1' },
          { from: 2, to: 4,   color: 'rgba(34, 197, 94, 0.36)',   name: '2–4' },
          { from: 5, to: 9,   color: 'rgba(34, 197, 94, 0.58)',   name: '5–9' },
          { from: 10, to: 99, color: 'rgba(34, 197, 94, 0.95)',   name: '10+' }
        ]
      }
    }
  },
  grid: { padding: { right: 12, left: 4 } },
  xaxis: { labels: { style: { colors: '#6b7280', fontSize: '10px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { style: { colors: '#6b7280', fontSize: '10px' } } },
  tooltip: { theme: 'dark', y: { formatter: (v) => `${v} đơn` } }
}))

onMounted(refresh)
</script>

<template>
  <section class="finrev">
    <!-- ─── Header ─── -->
    <header class="finrev-head">
      <div>
        <p class="eyebrow"><DollarSign :size="12" /> {{ t('admin.rev.title') }}</p>
        <h1>{{ t('admin.rev.heroTitle') }}</h1>
        <p class="sub">{{ t('admin.rev.heroSub') }}</p>
      </div>
      <div class="head-actions">
        <div class="segment-tabs">
          <button :class="{ active: period === 'day' }" type="button" @click="period = 'day'; refresh()">{{ t('admin.rev.daily') }}</button>
          <button :class="{ active: period === 'week' }" type="button" @click="period = 'week'; refresh()">{{ t('admin.rev.weekly') }}</button>
          <button :class="{ active: period === 'month' }" type="button" @click="period = 'month'; refresh()">{{ t('admin.rev.monthly') }}</button>
        </div>
        <button class="icon-btn" type="button" :disabled="loading" @click="refresh"><RefreshCw :size="14" :class="{ spin: loading }" /></button>
      </div>
    </header>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- ─── KPI hero ─── -->
    <div class="kpi-hero">
      <article class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label"><DollarSign :size="13" /> {{ t('admin.rev.kpiGross') }}</span>
          <span class="kpi-delta" :class="pctDelta(totals.gross, prev.gross) >= 0 ? 'up' : 'down'">
            <component :is="pctDelta(totals.gross, prev.gross) >= 0 ? ArrowUpRight : ArrowDownRight" :size="12" />
            {{ Math.abs(pctDelta(totals.gross, prev.gross)).toFixed(1) }}%
          </span>
        </div>
        <strong class="kpi-value">{{ fmtMoney(totals.gross) }}<small>{{ currencyCode }}</small></strong>
        <span class="kpi-foot">30d · {{ t('admin.rev.vsPrev') }} {{ fmtCompact(prev.gross) }}</span>
        <apexchart v-if="series.length" type="area" :options="makeSparkOptions('#22c55e')" :series="sparkGross" :height="50" />
      </article>

      <article class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label"><ArrowUpRight :size="13" /> {{ t('admin.rev.kpiTopups') }}</span>
          <span class="kpi-delta" :class="pctDelta(totals.topups, prev.topups) >= 0 ? 'up' : 'down'">
            <component :is="pctDelta(totals.topups, prev.topups) >= 0 ? ArrowUpRight : ArrowDownRight" :size="12" />
            {{ Math.abs(pctDelta(totals.topups, prev.topups)).toFixed(1) }}%
          </span>
        </div>
        <strong class="kpi-value">{{ fmtMoney(totals.topups) }}<small>{{ currencyCode }}</small></strong>
        <span class="kpi-foot">30d · {{ t('admin.rev.vsPrev') }} {{ fmtCompact(prev.topups) }}</span>
        <apexchart v-if="series.length" type="area" :options="makeSparkOptions('#3b82f6')" :series="sparkTopups" :height="50" />
      </article>

      <article class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label"><RotateCcw :size="13" /> {{ t('admin.rev.kpiRefunded') }}</span>
          <span class="kpi-delta neutral" v-if="prev.refunded === 0 && totals.refunded === 0"><Minus :size="12" />0%</span>
          <span class="kpi-delta" :class="pctDelta(totals.refunded, prev.refunded) <= 0 ? 'up' : 'down'" v-else>
            <component :is="pctDelta(totals.refunded, prev.refunded) <= 0 ? ArrowDownRight : ArrowUpRight" :size="12" />
            {{ Math.abs(pctDelta(totals.refunded, prev.refunded)).toFixed(1) }}%
          </span>
        </div>
        <strong class="kpi-value danger">{{ fmtMoney(totals.refunded) }}<small>{{ currencyCode }}</small></strong>
        <span class="kpi-foot">30d · {{ t('admin.rev.vsPrev') }} {{ fmtCompact(prev.refunded) }}</span>
        <apexchart v-if="series.length" type="area" :options="makeSparkOptions('#ef4444')" :series="sparkRefund" :height="50" />
      </article>

      <article class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-label"><TrendingUp :size="13" /> {{ t('admin.rev.kpiArpu') }}</span>
          <span class="kpi-delta" :class="pctDelta(arpu, arpuPrev) >= 0 ? 'up' : 'down'" v-if="arpuPrev > 0">
            <component :is="pctDelta(arpu, arpuPrev) >= 0 ? ArrowUpRight : ArrowDownRight" :size="12" />
            {{ Math.abs(pctDelta(arpu, arpuPrev)).toFixed(1) }}%
          </span>
        </div>
        <strong class="kpi-value">{{ fmtMoney(arpu) }}<small>{{ currencyCode }}</small></strong>
        <span class="kpi-foot"><Users :size="11" /> {{ totals.payers || 0 }} {{ t('admin.rev.payersSub') }}</span>
        <apexchart v-if="series.length" type="area" :options="makeSparkOptions('#f59e0b')" :series="sparkPayers" :height="50" />
      </article>
    </div>

    <!-- ─── Main chart: trend ─── -->
    <section class="card-block">
      <div class="card-head">
        <div>
          <h3>{{ t('admin.rev.trendTitle') }}</h3>
          <p class="muted">{{ t('admin.rev.trendSub', { period: t('admin.rev.period.' + period) }) }}</p>
        </div>
      </div>
      <apexchart v-if="series.length" type="area" :options="mainOptions" :series="mainSeries" :height="340" />
      <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
    </section>

    <!-- ─── Row 2: donut by type + bar by hour ─── -->
    <div class="grid-2">
      <section class="card-block">
        <div class="card-head"><h3>{{ t('admin.rev.byTypeTitle') }}</h3></div>
        <apexchart v-if="breakdown && (donutTypeSeries[0] || donutTypeSeries[1])"
          type="donut" :options="donutTypeOptions" :series="donutTypeSeries" :height="280" />
        <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
      </section>

      <section class="card-block">
        <div class="card-head"><h3>{{ t('admin.rev.byHourTitle') }}</h3></div>
        <apexchart v-if="breakdown" type="bar" :options="hourOptions" :series="hourSeries" :height="280" />
        <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
      </section>
    </div>

    <!-- ─── Row 3: top spenders + churn donut ─── -->
    <div class="grid-2">
      <section class="card-block">
        <div class="card-head">
          <h3><Crown :size="14" style="vertical-align:-2px; color:#f59e0b" /> {{ t('admin.rev.topSpenders') }}</h3>
          <span class="muted small">{{ t('admin.rev.topSub') }}</span>
        </div>
        <div v-if="topSpenders.length" class="spender-list">
          <article v-for="(r, i) in topSpenders" :key="r.ownerId" class="spender-row" @click="viewUser(r.ownerId)">
            <span class="rank">#{{ i + 1 }}</span>
            <div class="spender-body">
              <strong>{{ r.user.email }}</strong>
              <span class="muted">{{ r.orderCount }} đơn</span>
            </div>
            <span class="spender-amt">{{ fmtCompact(r.total) }}</span>
            <div class="spender-bar"><span :style="{ width: (r.total / maxSpend * 100) + '%' }"></span></div>
          </article>
        </div>
        <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
      </section>

      <section class="card-block">
        <div class="card-head">
          <h3>{{ t('admin.rev.churnTitle') }}</h3>
          <span class="muted small">{{ t('admin.rev.churnHelp') }}</span>
        </div>
        <apexchart v-if="churn" type="donut" :options="churnOptions" :series="churnSeries" :height="280" />
        <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
      </section>
    </div>

    <!-- ─── Order heatmap ─── -->
    <section class="card-block">
      <div class="card-head">
        <h3>{{ t('admin.rev.heatmapTitle') }}</h3>
        <span class="muted small">{{ t('admin.rev.heatmapHelp') }}</span>
      </div>
      <apexchart v-if="heatmap" type="heatmap" :options="heatmapOptions" :series="heatmapSeries" :height="280" />
      <p v-else class="empty">{{ t('admin.rev.empty') }}</p>
    </section>
  </section>
</template>

<style scoped>
.finrev { display: flex; flex-direction: column; gap: 18px; padding-bottom: 24px; }

/* ── Header ─────────────────────────────────────────────────── */
.finrev-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px; }
.finrev-head .eyebrow { color: #22c55e; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 4px; }
.finrev-head h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.finrev-head .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.head-actions { display: inline-flex; gap: 10px; align-items: center; }
.icon-btn { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 7px 9px; cursor: pointer; display: inline-flex; align-items: center; }
.icon-btn:hover { background: rgba(148, 163, 184, 0.08); }
.icon-btn .spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── KPI hero ───────────────────────────────────────────────── */
.kpi-hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi-card {
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.04) 0%, transparent 50%), var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 18px 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: 0.2s;
}
.kpi-card:hover { border-color: rgba(34, 197, 94, 0.3); transform: translateY(-1px); }
.kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.kpi-label { color: var(--muted); font-size: 11.5px; font-weight: 500; letter-spacing: 0.02em; display: inline-flex; align-items: center; gap: 5px; }
.kpi-delta { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 6px; display: inline-flex; align-items: center; gap: 2px; }
.kpi-delta.up { color: #22c55e; background: rgba(34, 197, 94, 0.12); }
.kpi-delta.down { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.kpi-delta.neutral { color: var(--muted); background: rgba(148, 163, 184, 0.1); }
.kpi-value { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 26px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; color: var(--text); display: flex; align-items: baseline; gap: 4px; }
.kpi-value.danger { color: #ef4444; }
.kpi-value small { font-size: 10.5px; color: var(--muted); font-weight: 500; }
.kpi-foot { color: var(--muted); font-size: 10.5px; margin: 4px 0 8px; display: inline-flex; align-items: center; gap: 4px; }

/* ── Card blocks ────────────────────────────────────────────── */
.card-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px;
}
.card-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 12px; gap: 8px; flex-wrap: wrap; }
.card-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
.card-head .muted { color: var(--muted); font-size: 12px; margin-top: 2px; }
.card-head .small { font-size: 11px; }
.empty { padding: 60px 0; text-align: center; color: var(--muted); font-size: 13px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

/* ── Top spenders ───────────────────────────────────────────── */
.spender-list { display: flex; flex-direction: column; gap: 4px; }
.spender-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  grid-template-rows: auto auto;
  grid-template-areas: 'rank body amt' 'bar bar bar';
  gap: 4px 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.15s;
}
.spender-row:hover { background: rgba(148, 163, 184, 0.05); }
.spender-row .rank { grid-area: rank; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #f59e0b; font-size: 12px; }
.spender-body { grid-area: body; display: flex; flex-direction: column; min-width: 0; }
.spender-body strong { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spender-body .muted { font-size: 10.5px; color: var(--muted); }
.spender-amt { grid-area: amt; font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; color: #22c55e; align-self: center; }
.spender-bar { grid-area: bar; height: 3px; background: rgba(148, 163, 184, 0.08); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.spender-bar span { display: block; height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); border-radius: 2px; transition: width 0.4s; }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .kpi-hero { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .kpi-hero { grid-template-columns: 1fr; }
  .finrev-head h1 { font-size: 22px; }
  .kpi-value { font-size: 22px; }
}
</style>
