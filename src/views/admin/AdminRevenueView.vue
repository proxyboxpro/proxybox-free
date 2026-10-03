<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import { Empty } from 'ant-design-vue'
import { ArrowUpOutlined, DollarOutlined, RiseOutlined, RollbackOutlined, TeamOutlined } from '@ant-design/icons-vue'
import { apiFetch, adminAnalyticsHeatmap, adminAnalyticsChurn, adminRevenueBreakdown } from '../../api'
import { useI18n } from '../../i18n'
import { isDark } from '../../theme'

// Local registration — keeps apexcharts out of the initial bundle. Loaded only
// when this admin route is opened (lazy-imported via router code-splitting).
const apexchart = VueApexCharts.component || VueApexCharts
const emptyImage = Empty.PRESENTED_IMAGE_SIMPLE

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
function setPeriod(v) { period.value = v; refresh() }

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

const periodOptions = computed(() => [
  { label: t('admin.rev.daily'), value: 'day' },
  { label: t('admin.rev.weekly'), value: 'week' },
  { label: t('admin.rev.monthly'), value: 'month' }
])

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

// ── KPI cards ───────────────────────────────────────────────────────────────
// Delta pill: `good` = green. Refunds are inverted (less refund = good).
function delta(now, before, { invert = false } = {}) {
  const d = pctDelta(now, before)
  const good = invert ? d <= 0 : d >= 0
  return { color: good ? 'success' : 'error', up: invert ? d > 0 : d >= 0, text: Math.abs(d).toFixed(1) }
}

// ── ApexCharts shared theme (follows dark / light) ─────────────────────────
const palette = computed(() => (isDark.value
  ? { mode: 'dark', text: 'rgba(255, 255, 255, 0.65)', muted: 'rgba(255, 255, 255, 0.45)', strong: 'rgba(255, 255, 255, 0.88)', grid: 'rgba(148, 163, 184, 0.10)', surface: '#11161d', zero: 'rgba(148, 163, 184, 0.08)' }
  : { mode: 'light', text: 'rgba(0, 0, 0, 0.65)', muted: 'rgba(0, 0, 0, 0.45)', strong: 'rgba(0, 0, 0, 0.88)', grid: 'rgba(0, 0, 0, 0.06)', surface: '#ffffff', zero: 'rgba(0, 0, 0, 0.05)' }))
const baseChart = computed(() => ({
  background: 'transparent',
  foreColor: palette.value.text,
  fontFamily: 'Inter, system-ui, sans-serif',
  toolbar: { show: false },
  zoom: { enabled: false },
  animations: { enabled: true, speed: 400 }
}))
const baseTheme = computed(() => ({ mode: palette.value.mode }))
const baseGrid = computed(() => ({ borderColor: palette.value.grid, strokeDashArray: 4, xaxis: { lines: { show: false } } }))
const axisLabels = (size) => ({ style: { colors: palette.value.muted, fontSize: size } })

// ── Hero chart: revenue trend ──────────────────────────────────────────────
const mainSeries = computed(() => [
  { name: t('admin.rev.legendGross'),  data: series.value.map((r) => Math.round(r.gross || 0)) },
  { name: t('admin.rev.legendTopups'), data: series.value.map((r) => Math.round(r.topups || 0)) }
])
const mainOptions = computed(() => ({
  chart: { ...baseChart.value, type: 'area', toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } }, sparkline: { enabled: false } },
  theme: baseTheme.value,
  colors: ['#22c55e', '#3b82f6'],
  stroke: { curve: 'smooth', width: 2.5 },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.0, stops: [0, 90, 100] }
  },
  dataLabels: { enabled: false },
  legend: { position: 'top', horizontalAlign: 'left', fontSize: '12px', markers: { width: 8, height: 8, radius: 4 } },
  grid: baseGrid.value,
  xaxis: {
    categories: series.value.map((r) => String(r.bucket || '').slice(-5)),
    labels: axisLabels('11px'),
    axisBorder: { show: false }, axisTicks: { show: false }
  },
  yaxis: {
    labels: { ...axisLabels('11px'), formatter: (v) => fmtCompact(v) },
    axisBorder: { show: false }
  },
  tooltip: { theme: palette.value.mode, y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── KPI sparklines ─────────────────────────────────────────────────────────
function makeSparkOptions(color) {
  return {
    chart: { background: 'transparent', type: 'area', sparkline: { enabled: true }, animations: { enabled: true, speed: 400 } },
    stroke: { curve: 'smooth', width: 2 },
    colors: [color],
    fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0 } },
    tooltip: { enabled: false }
  }
}
const sparkOptions = {
  gross: makeSparkOptions('#22c55e'),
  topups: makeSparkOptions('#3b82f6'),
  refunded: makeSparkOptions('#ef4444'),
  arpu: makeSparkOptions('#f59e0b')
}
const sparkGross  = computed(() => [{ data: series.value.map((r) => Math.round(r.gross  || 0)) }])
const sparkTopups = computed(() => [{ data: series.value.map((r) => Math.round(r.topups || 0)) }])
const sparkRefund = computed(() => [{ data: series.value.map((r) => Math.round(r.refunded || 0)) }])
const sparkPayers = computed(() => [{ data: series.value.map(() => totals.value.payers || 0) }])

const kpiCards = computed(() => [
  {
    key: 'gross', icon: DollarOutlined, label: t('admin.rev.kpiGross'), value: totals.value.gross,
    delta: delta(totals.value.gross, prev.value.gross),
    foot: `30d · ${t('admin.rev.vsPrev')} ${fmtCompact(prev.value.gross)}`, spark: sparkGross.value
  },
  {
    key: 'topups', icon: ArrowUpOutlined, label: t('admin.rev.kpiTopups'), value: totals.value.topups,
    delta: delta(totals.value.topups, prev.value.topups),
    foot: `30d · ${t('admin.rev.vsPrev')} ${fmtCompact(prev.value.topups)}`, spark: sparkTopups.value
  },
  {
    key: 'refunded', icon: RollbackOutlined, label: t('admin.rev.kpiRefunded'), value: totals.value.refunded, danger: true,
    delta: prev.value.refunded === 0 && totals.value.refunded === 0 ? { color: 'default', flat: true, text: '0' } : delta(totals.value.refunded, prev.value.refunded, { invert: true }),
    foot: `30d · ${t('admin.rev.vsPrev')} ${fmtCompact(prev.value.refunded)}`, spark: sparkRefund.value
  },
  {
    key: 'arpu', icon: RiseOutlined, label: t('admin.rev.kpiArpu'), value: arpu.value,
    delta: arpuPrev.value > 0 ? delta(arpu.value, arpuPrev.value) : null,
    footIcon: TeamOutlined, foot: `${totals.value.payers || 0} ${t('admin.rev.payersSub')}`, spark: sparkPayers.value
  }
])

// ── Donut: revenue by proxy type ───────────────────────────────────────────
const donutTypeSeries = computed(() => {
  if (!breakdown.value) return []
  return [Number(breakdown.value.byType?.ipv4 || 0), Number(breakdown.value.byType?.ipv6 || 0)]
})
const donutTypeOptions = computed(() => ({
  chart: { ...baseChart.value, type: 'donut' },
  theme: baseTheme.value,
  labels: ['IPv4', 'IPv6'],
  colors: ['#3b82f6', '#22c55e'],
  legend: { position: 'bottom', fontSize: '12px', markers: { width: 10, height: 10, radius: 5 } },
  plotOptions: {
    pie: {
      donut: {
        size: '72%',
        labels: {
          show: true,
          name: { fontSize: '12px', color: palette.value.muted },
          value: {
            fontSize: '20px', fontWeight: 700, color: palette.value.strong,
            formatter: (v) => fmtCompact(v) + ' ' + currencyCode
          },
          total: {
            show: true, label: t('admin.rev.totalSpend'), color: palette.value.muted,
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
  tooltip: { theme: palette.value.mode, y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── Bar: revenue by hour-of-day ─────────────────────────────────────────────
const hourSeries = computed(() => [{
  name: 'Revenue',
  data: (breakdown.value?.byHour || new Array(24).fill(0)).map((v) => Math.round(v))
}])
const hourOptions = computed(() => ({
  chart: { ...baseChart.value, type: 'bar' },
  theme: baseTheme.value,
  colors: ['#22c55e'],
  plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
  dataLabels: { enabled: false },
  stroke: { width: 0 },
  grid: baseGrid.value,
  xaxis: {
    categories: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    labels: axisLabels('10px'),
    axisBorder: { show: false }, axisTicks: { show: false }
  },
  yaxis: { labels: { ...axisLabels('11px'), formatter: (v) => fmtCompact(v) } },
  tooltip: { theme: palette.value.mode, y: { formatter: (v) => fmtMoney(v) + ' ' + currencyCode } }
}))

// ── Donut: churn buckets ────────────────────────────────────────────────────
const churnSeries = computed(() => {
  if (!churn.value) return []
  return [churn.value.active7, churn.value.active30, churn.value.dormant30_60, churn.value.dormant60_90, churn.value.churned90plus, churn.value.never]
})
const churnOptions = computed(() => ({
  chart: { ...baseChart.value, type: 'donut' },
  theme: baseTheme.value,
  labels: ['0–7d', '8–30d', '31–60d', '61–90d', '90d+', 'Never'],
  colors: ['#16a34a', '#22c55e', '#f59e0b', '#fb923c', '#ef4444', '#6b7280'],
  legend: { position: 'right', fontSize: '11px', markers: { width: 8, height: 8, radius: 4 } },
  plotOptions: { pie: { donut: { size: '68%' } } },
  stroke: { width: 0 },
  dataLabels: { enabled: false },
  tooltip: { theme: palette.value.mode },
  responsive: [{ breakpoint: 576, options: { legend: { position: 'bottom' } } }]
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
  chart: { ...baseChart.value, type: 'heatmap', toolbar: { show: false } },
  theme: baseTheme.value,
  dataLabels: { enabled: false },
  stroke: { width: 1, colors: [palette.value.surface] },
  colors: ['#22c55e'],
  plotOptions: {
    heatmap: {
      shadeIntensity: 0.7,
      enableShades: false,
      radius: 3,
      colorScale: {
        ranges: [
          { from: 0, to: 0,   color: palette.value.zero,           name: '0' },
          { from: 1, to: 1,   color: 'rgba(34, 197, 94, 0.18)',   name: '1' },
          { from: 2, to: 4,   color: 'rgba(34, 197, 94, 0.36)',   name: '2–4' },
          { from: 5, to: 9,   color: 'rgba(34, 197, 94, 0.58)',   name: '5–9' },
          { from: 10, to: 99, color: 'rgba(34, 197, 94, 0.95)',   name: '10+' }
        ]
      }
    }
  },
  grid: { padding: { right: 12, left: 4 } },
  xaxis: { labels: axisLabels('10px'), axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: axisLabels('10px') },
  tooltip: { theme: palette.value.mode, y: { formatter: (v) => `${v} đơn` } }
}))

onMounted(refresh)
</script>

<template>
  <div class="page">
    <!-- ─── Toolbar ─── -->
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.rev.heroSub') }}</a-typography-text>
      <a-space>
        <a-segmented :value="period" :options="periodOptions" @change="setPeriod" />
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />

    <!-- ─── KPI hero ─── -->
    <a-row :gutter="[16, 16]">
      <a-col v-for="k in kpiCards" :key="k.key" :xs="24" :sm="12" :xl="6">
        <a-card size="small" class="kpi-card" :body-style="{ paddingBottom: 0 }">
          <a-flex justify="space-between" align="center" gap="small" class="kpi-head">
            <a-typography-text type="secondary" class="kpi-label">
              <component :is="k.icon" /> {{ k.label }}
            </a-typography-text>
            <a-tag v-if="k.delta" :color="k.delta.color" :bordered="false" class="kpi-delta">
              <MinusOutlined v-if="k.delta.flat" />
              <ArrowUpOutlined v-else-if="k.delta.up" />
              <ArrowDownOutlined v-else />
              {{ k.delta.text }}%
            </a-tag>
          </a-flex>
          <a-statistic :value="k.value" :suffix="currencyCode" class="kpi-stat" :value-style="k.danger ? { color: 'var(--pb-error)' } : undefined">
            <template #formatter="{ value }">{{ fmtMoney(value) }}</template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-foot">
            <component :is="k.footIcon" v-if="k.footIcon" /> {{ k.foot }}
          </a-typography-text>
          <apexchart v-if="series.length" type="area" :options="sparkOptions[k.key]" :series="k.spark" :height="50" />
          <div v-else class="spark-gap"></div>
        </a-card>
      </a-col>
    </a-row>

    <!-- ─── Main chart: trend ─── -->
    <a-card :title="t('admin.rev.trendTitle')" :loading="loading && !data">
      <a-typography-text type="secondary" class="card-sub">{{ t('admin.rev.trendSub', { period: t('admin.rev.period.' + period) }) }}</a-typography-text>
      <apexchart v-if="series.length" type="area" :options="mainOptions" :series="mainSeries" :height="340" />
      <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
    </a-card>

    <!-- ─── Row 2: donut by type + bar by hour ─── -->
    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="12">
        <a-card :title="t('admin.rev.byTypeTitle')" class="full-height">
          <apexchart
            v-if="breakdown && (donutTypeSeries[0] || donutTypeSeries[1])"
            type="donut" :options="donutTypeOptions" :series="donutTypeSeries" :height="280"
          />
          <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
        </a-card>
      </a-col>
      <a-col :xs="24" :lg="12">
        <a-card :title="t('admin.rev.byHourTitle')" class="full-height">
          <apexchart v-if="breakdown" type="bar" :options="hourOptions" :series="hourSeries" :height="280" />
          <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
        </a-card>
      </a-col>
    </a-row>

    <!-- ─── Row 3: top spenders + churn donut ─── -->
    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="12">
        <a-card class="full-height">
          <template #title><CrownOutlined class="crown" /> {{ t('admin.rev.topSpenders') }}</template>
          <a-typography-text type="secondary" class="card-sub">{{ t('admin.rev.topSub') }}</a-typography-text>
          <a-list v-if="topSpenders.length" :data-source="topSpenders" :split="false" size="small">
            <template #renderItem="{ item: r, index: i }">
              <a-list-item class="spender" @click="viewUser(r.ownerId)">
                <div class="spender-row">
                  <a-flex align="center" gap="small">
                    <a-typography-text type="warning" strong class="mono rank">#{{ i + 1 }}</a-typography-text>
                    <div class="spender-body">
                      <a-typography-text strong :ellipsis="{ tooltip: r.user.email }" :content="r.user.email" class="spender-email" />
                      <a-typography-text type="secondary" class="small">{{ r.orderCount }} đơn</a-typography-text>
                    </div>
                    <a-typography-text type="success" strong class="mono">{{ fmtCompact(r.total) }}</a-typography-text>
                  </a-flex>
                  <a-progress :percent="(r.total / maxSpend) * 100" :show-info="false" size="small" stroke-color="#22c55e" class="spender-bar" />
                </div>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="12">
        <a-card :title="t('admin.rev.churnTitle')" class="full-height">
          <a-typography-text type="secondary" class="card-sub">{{ t('admin.rev.churnHelp') }}</a-typography-text>
          <apexchart v-if="churn" type="donut" :options="churnOptions" :series="churnSeries" :height="280" />
          <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
        </a-card>
      </a-col>
    </a-row>

    <!-- ─── Order heatmap ─── -->
    <a-card :title="t('admin.rev.heatmapTitle')">
      <a-typography-text type="secondary" class="card-sub">{{ t('admin.rev.heatmapHelp') }}</a-typography-text>
      <apexchart v-if="heatmap" type="heatmap" :options="heatmapOptions" :series="heatmapSeries" :height="280" />
      <a-empty v-else :image="emptyImage" :description="t('admin.rev.empty')" class="empty" />
    </a-card>
  </div>
</template>

<style scoped>
.full-height { height: 100%; }
.kpi-card { height: 100%; overflow: hidden; }
.kpi-head { min-height: 24px; }
.kpi-label { font-size: 12px; }
.kpi-delta { margin-inline-end: 0; font-weight: 600; }
.kpi-stat { margin-top: 6px; }
.kpi-stat :deep(.ant-statistic-content-value) { font-family: var(--pb-mono); font-weight: 700; }
.kpi-stat :deep(.ant-statistic-content-suffix) { font-size: 12px; opacity: 0.6; }
.kpi-foot { display: block; font-size: 12px; margin: 2px 0 6px; }
.spark-gap { height: 12px; }
.card-sub { display: block; font-size: 12px; margin-bottom: 8px; }
.empty { padding: 32px 0; }
.crown { color: var(--pb-warning); }
.small { font-size: 12px; }

.spender { cursor: pointer; border-radius: 8px; padding-inline: 8px !important; }
.spender:hover { background: var(--pb-primary-soft); }
.spender-row { width: 100%; min-width: 0; }
.rank { width: 28px; flex-shrink: 0; font-size: 12px; }
.spender-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.spender-email { max-width: 100%; }
.spender-bar { margin: 2px 0 0; }
.spender-bar :deep(.ant-progress-outer) { padding: 0; }
</style>
