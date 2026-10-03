<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import { theme as antdTheme } from 'ant-design-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { formatBytes } from '../../utils/format'
import { FONT_MONO, isDark } from '../../theme'
import CountryFlag from '../../components/CountryFlag.vue'

const apexchart = VueApexCharts.component || VueApexCharts
const { t } = useI18n()
const { token } = antdTheme.useToken()
const data = ref(null)
const err = ref('')
const loading = ref(false)
const search = ref('')
const ppWin = ref('30d')   // per-proxy table window: '24h' | '30d'
const ppPage = ref(0)      // per-proxy table page (10 rows/page — big accounts have 1000s)
const PP_PAGE_SIZE = 10

// Series colours (upload = green, download = blue) — shared by chart, donut and table.
const UP_COLOR = '#22c55e'
const DOWN_COLOR = '#3b82f6'

async function refresh() {
  err.value = ''
  loading.value = true
  try { data.value = await apiFetch('/api/v1/user/usage/summary') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

function fmtRate(bps) { return bps ? `${formatBytes(bps)}/s` : '0 B/s' }
function countryFromZone(z) {
  z = String(z || '').toLowerCase()
  if (z.startsWith('vn')) return 'VN'
  if (z.startsWith('us')) return 'US'
  if (z.startsWith('uk') || z.startsWith('gb')) return 'GB'
  if (z.startsWith('de')) return 'DE'
  if (z.startsWith('jp')) return 'JP'
  if (z.startsWith('sg')) return 'SG'
  if (z.startsWith('hk')) return 'HK'
  return 'GLOBAL'
}

const totals = computed(() => data.value?.totals || { upload: 0, download: 0, conns: 0, proxyCount: 0 })
const totalBytes = computed(() => (totals.value.upload || 0) + (totals.value.download || 0))
const quotaGB = computed(() => Number(data.value?.quotaGB) || 0)
const quotaUsedGB = computed(() => totalBytes.value / 1e9)
const quotaOver = computed(() => quotaUsedGB.value > quotaGB.value)

// KPI tiles (quota tile only when the admin configured a per-proxy quota).
const kpis = computed(() => {
  const list = [
    { key: 'total', label: t('cust.usage.kpiTotal'),    value: formatBytes(totalBytes.value),                     foot: t('cust.billing.thisMonth'),     icon: 'total' },
    { key: 'up',    label: t('cust.usage.kpiUpload'),   value: formatBytes(totals.value.upload),                  foot: '↑ outbound',                    icon: 'up' },
    { key: 'down',  label: t('cust.usage.kpiDownload'), value: formatBytes(totals.value.download),                foot: '↓ inbound',                     icon: 'down' },
    { key: 'conns', label: t('cust.usage.kpiConns'),    value: Number(totals.value.conns || 0).toLocaleString(), foot: t('cust.usage.totalConns'),       icon: 'conns' }
  ]
  if (quotaGB.value > 0) {
    list.push({ key: 'quota', label: t('cust.usage.quotaLabel'), value: `${quotaUsedGB.value.toFixed(1)} / ${quotaGB.value} GB`, foot: t('cust.usage.quotaFoot'), icon: 'quota', quota: true })
  }
  list.push({ key: 'count', label: t('cust.usage.kpiProxyCount'), value: totals.value.proxyCount ?? 0, foot: t('cust.proxies.kpiTotalSub'), icon: 'count' })
  return list
})

// Accurate cumulative transferred volume over rolling windows (from conn_events).
const EMPTY_WIN = { up: 0, down: 0 }
const windows = computed(() => data.value?.windows || { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN })
const windowCards = computed(() => {
  const w = windows.value
  return [
    { key: 'h1',  label: t('cust.usage.win1h'),  up: w.h1?.up || 0,  down: w.h1?.down || 0 },
    { key: 'h24', label: t('cust.usage.win24h'), up: w.h24?.up || 0, down: w.h24?.down || 0 },
    { key: 'd30', label: t('cust.usage.win30d'), up: w.d30?.up || 0, down: w.d30?.down || 0 }
  ]
})

// Normalize hourly into 24 fixed buckets — pad with zeros if API returns less.
// No synthetic data: flat-empty is honest when no traffic yet.
const buckets = computed(() => {
  const h = data.value?.hourly || []
  const n = 24
  const out = []
  const start = Math.max(0, h.length - n)
  const slice = h.slice(start)
  const pad = n - slice.length
  const now = Date.now()
  for (let i = 0; i < pad; i += 1) {
    out.push({ uploadBytes: 0, downloadBytes: 0, ts: now - (n - i) * 3600_000 })
  }
  for (let i = 0; i < slice.length; i += 1) {
    const r = slice[i]
    out.push({
      uploadBytes: Number(r.uploadBytes || 0),
      downloadBytes: Number(r.downloadBytes || 0),
      ts: r.ts ? new Date(r.ts).getTime() : (now - (slice.length - i) * 3600_000)
    })
  }
  return out
})
const hasUsageData = computed(() => buckets.value.some((b) => b.uploadBytes > 0 || b.downloadBytes > 0))
const maxY = computed(() => buckets.value.reduce((m, b) => Math.max(m, b.uploadBytes, b.downloadBytes), 0))

// ApexCharts series + options (theme-aware: follows the antd dark/light tokens)
const chartSeries = computed(() => [
  { name: t('cust.usage.up'),   data: buckets.value.map((b) => [b.ts, b.uploadBytes]) },
  { name: t('cust.usage.down'), data: buckets.value.map((b) => [b.ts, b.downloadBytes]) }
])
const chartOptions = computed(() => {
  const tk = token.value
  const mode = isDark.value ? 'dark' : 'light'
  const axisLabel = { colors: tk.colorTextSecondary, fontSize: '11px', fontFamily: FONT_MONO }
  return {
    chart: { type: 'area', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 350 }, background: 'transparent', fontFamily: 'inherit', foreColor: tk.colorTextSecondary },
    theme: { mode },
    colors: [UP_COLOR, DOWN_COLOR],
    stroke: { curve: 'smooth', width: 2 },
    dataLabels: { enabled: false },
    fill: { type: 'gradient', gradient: { shadeIntensity: 0.8, opacityFrom: 0.45, opacityTo: 0.04, stops: [0, 100] } },
    grid: { borderColor: tk.colorBorderSecondary, strokeDashArray: 3, padding: { top: 6, right: 12, bottom: 0, left: 6 } },
    xaxis: {
      type: 'datetime',
      labels: { style: axisLabel, datetimeUTC: false },
      axisBorder: { show: false }, axisTicks: { color: tk.colorBorderSecondary }
    },
    yaxis: {
      labels: {
        style: axisLabel,
        formatter: (v) => formatBytes(v)
      }
    },
    tooltip: {
      theme: mode,
      x: { format: 'HH:mm dd/MM' },
      y: { formatter: (v) => formatBytes(v) }
    },
    legend: { show: false }
  }
})

// ── Donut: upload vs download split ─────────────────────────────────────────
const donut = computed(() => {
  const up = totals.value.upload || 0
  const dn = totals.value.download || 0
  const total = up + dn
  if (total === 0) return { upPct: 0, dnPct: 0 }
  return { upPct: up / total, dnPct: dn / total }
})

// ── Per-proxy table data ────────────────────────────────────────────────────
// Per-proxy up/down for the selected window (accurate, from conn_events). Falls
// back to since-restart counters if the backend didn't attach window data.
function proxyWin(p) {
  const w = ppWin.value === '24h' ? p.win24 : p.win30
  if (w) return { up: w.up || 0, down: w.down || 0 }
  return { up: p.uploadBytes || 0, down: p.downloadBytes || 0 }
}
const rows = computed(() => {
  const r = (data.value?.perProxy || []).map((p) => {
    const w = proxyWin(p)
    return { ...p, wUp: w.up, wDown: w.down, total: w.up + w.down }
  })
  const max = Math.max(1, ...r.map((p) => p.total))
  return r
    .filter((p) => {
      if (!search.value) return true
      const q = search.value.toLowerCase()
      return `${p.name || ''} ${p.bindIp || ''} ${p.port || ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => b.total - a.total)
    .map((p) => ({ ...p, share: Math.min(100, Math.round((p.total / max) * 100)) }))
})
// Paginate the per-proxy table at 10/page — a 1000+ proxy account would otherwise
// render every row at once. Search/window changes reset to the first page.
watch([search, ppWin, () => rows.value.length], () => { ppPage.value = 0 })
const ppPagination = computed(() => ({
  current: ppPage.value + 1,
  pageSize: PP_PAGE_SIZE,
  hideOnSinglePage: true,
  showSizeChanger: false,
  size: 'small'
}))
function onPpChange(p) { ppPage.value = p.current - 1 }

const ppColumns = computed(() => [
  { title: t('cust.col.name'),     key: 'name',     width: 160 },
  { title: t('cust.col.endpoint'), key: 'endpoint', width: 200 },
  { title: t('cust.col.country'),  key: 'country',  width: 130 },
  { title: t('cust.usage.up'),     key: 'up',       width: 110, align: 'right' },
  { title: t('cust.usage.down'),   key: 'down',     width: 110, align: 'right' },
  { title: t('cust.usage.live'),   key: 'live',     width: 190 },
  { title: t('cust.usage.share'),  key: 'share',    width: 180 }
])

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('cust.usage.subtitle') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('cust.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI row -->
    <a-flex wrap="wrap" :gap="12">
      <a-card v-for="k in kpis" :key="k.key" size="small" class="kpi">
        <a-statistic
          :title="k.label"
          :value="k.value"
          :value-style="k.quota && quotaOver ? { color: 'var(--pb-error)', fontSize: '20px' } : { fontSize: '20px' }"
        >
          <template #prefix>
            <DashboardOutlined v-if="k.icon === 'total'" class="kpi-ico" />
            <ArrowUpOutlined v-else-if="k.icon === 'up'" class="kpi-ico" :style="{ color: UP_COLOR }" />
            <ArrowDownOutlined v-else-if="k.icon === 'down'" class="kpi-ico" :style="{ color: DOWN_COLOR }" />
            <WifiOutlined v-else-if="k.icon === 'conns'" class="kpi-ico" />
            <PieChartOutlined v-else-if="k.icon === 'quota'" class="kpi-ico" />
            <AppstoreOutlined v-else class="kpi-ico" />
          </template>
        </a-statistic>
        <a-progress
          v-if="k.quota"
          :percent="Math.min(100, Math.round((quotaUsedGB / quotaGB) * 100))"
          :status="quotaOver ? 'exception' : 'normal'"
          :show-info="false"
          size="small"
        />
        <a-typography-text type="secondary" class="foot">{{ k.foot }}</a-typography-text>
      </a-card>
    </a-flex>

    <!-- Accurate cumulative traffic totals over 1h / 24h / 30d -->
    <a-card size="small">
      <template #title><BarChartOutlined class="title-ico" /> {{ t('cust.usage.windowsTitle') }}</template>
      <a-typography-paragraph type="secondary" class="hint">{{ t('cust.usage.windowsHint') }}</a-typography-paragraph>
      <a-row :gutter="[12, 12]">
        <a-col v-for="w in windowCards" :key="w.key" :xs="24" :md="8">
          <a-card size="small" class="win-card">
            <a-statistic :title="w.label" :value="formatBytes(w.up + w.down)" :value-style="{ fontFamily: 'var(--pb-mono)', fontWeight: 700 }" />
            <a-space :size="16" class="mono small">
              <span :style="{ color: UP_COLOR }"><ArrowUpOutlined /> {{ formatBytes(w.up) }}</span>
              <span :style="{ color: DOWN_COLOR }"><ArrowDownOutlined /> {{ formatBytes(w.down) }}</span>
            </a-space>
          </a-card>
        </a-col>
      </a-row>
    </a-card>

    <!-- Main chart + donut split -->
    <a-row :gutter="[16, 16]">
      <!-- Dual-line area chart -->
      <a-col :xs="24" :lg="16" :xl="18">
        <a-card size="small" class="fill">
          <template #title><BarChartOutlined class="title-ico" /> {{ t('cust.usage.chart24h') }}</template>
          <template v-if="hasUsageData" #extra>
            <a-space :size="14" wrap class="small">
              <a-badge :color="UP_COLOR" :text="t('cust.usage.up')" />
              <a-badge :color="DOWN_COLOR" :text="t('cust.usage.down')" />
              <a-typography-text type="secondary" class="small">{{ t('cust.usage.peak') }} ≈ <span class="mono">{{ formatBytes(maxY) }}</span></a-typography-text>
            </a-space>
          </template>
          <!-- ApexCharts area chart — smooth gradient + hover tooltip + responsive. Renders
               empty (flat zero) when no traffic yet — that's an honest "no data" signal. -->
          <apexchart type="area" height="280" :options="chartOptions" :series="chartSeries" />
          <a-typography-paragraph v-if="!hasUsageData" type="secondary" class="chart-empty">
            {{ t('cust.usage.empty') }}
          </a-typography-paragraph>
        </a-card>
      </a-col>

      <!-- Donut: upload vs download split -->
      <a-col :xs="24" :lg="8" :xl="6">
        <a-card size="small" :title="t('cust.usage.split')" class="fill">
          <a-flex justify="center" class="donut-wrap">
            <a-progress
              type="circle"
              :size="170"
              :stroke-width="10"
              :percent="totalBytes ? 100 : 0"
              :stroke-color="DOWN_COLOR"
              :success="{ percent: Math.round(donut.upPct * 100), strokeColor: UP_COLOR }"
            >
              <template #format>
                <a-flex vertical align="center" :gap="2">
                  <a-typography-text type="secondary" class="donut-lbl">{{ t('cust.usage.kpiTotal') }}</a-typography-text>
                  <a-typography-text strong class="mono donut-val">{{ formatBytes(totalBytes) }}</a-typography-text>
                </a-flex>
              </template>
            </a-progress>
          </a-flex>
          <a-flex vertical :gap="8">
            <a-card size="small" class="split-row">
              <a-flex align="center" gap="small">
                <a-badge :color="UP_COLOR" />
                <span class="split-name">{{ t('cust.usage.up') }}</span>
                <span class="mono" :style="{ color: UP_COLOR }">{{ Math.round(donut.upPct * 100) }}%</span>
                <a-typography-text type="secondary" class="mono small">{{ formatBytes(totals.upload) }}</a-typography-text>
              </a-flex>
            </a-card>
            <a-card size="small" class="split-row">
              <a-flex align="center" gap="small">
                <a-badge :color="DOWN_COLOR" />
                <span class="split-name">{{ t('cust.usage.down') }}</span>
                <span class="mono" :style="{ color: DOWN_COLOR }">{{ Math.round(donut.dnPct * 100) }}%</span>
                <a-typography-text type="secondary" class="mono small">{{ formatBytes(totals.download) }}</a-typography-text>
              </a-flex>
            </a-card>
          </a-flex>
        </a-card>
      </a-col>
    </a-row>

    <!-- Per-proxy table -->
    <a-card :body-style="{ paddingTop: '12px' }">
      <template #title>{{ t('cust.usage.perProxy') }} ({{ rows.length }})</template>
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="pp-filters">
        <a-tooltip :title="t('cust.usage.ppWindow')">
          <a-segmented v-model:value="ppWin" :options="['24h', '30d']" class="mono" />
        </a-tooltip>
        <a-input-search
          v-model:value="search"
          allow-clear
          :placeholder="t('cust.proxies.searchPlaceholder')"
          class="pp-search"
        />
      </a-flex>

      <a-table
        :columns="ppColumns"
        :data-source="rows"
        :pagination="ppPagination"
        :loading="loading && !data"
        row-key="id"
        size="middle"
        :scroll="{ x: 1000 }"
        :locale="{ emptyText: t('cust.usage.empty') }"
        @change="onPpChange"
      >
        <template #bodyCell="{ column, record: p }">
          <template v-if="column.key === 'name'">
            <a-typography-text strong>{{ p.name || p.id }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'endpoint'">
            <a-typography-text class="mono" :copyable="{ text: `${p.ip || p.bindIp}:${p.port}` }">{{ p.ip || p.bindIp }}:{{ p.port }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'country'">
            <a-space :size="6"><CountryFlag :code="countryFromZone(p.zone)" :size="18" /> <span class="mono">{{ p.zone || 'auto' }}</span></a-space>
          </template>
          <template v-else-if="column.key === 'up'">
            <span class="mono" :style="{ color: UP_COLOR }">{{ formatBytes(p.wUp || 0) }}</span>
          </template>
          <template v-else-if="column.key === 'down'">
            <span class="mono" :style="{ color: DOWN_COLOR }">{{ formatBytes(p.wDown || 0) }}</span>
          </template>
          <template v-else-if="column.key === 'live'">
            <span class="mono small">↑{{ fmtRate(p.bpsOut) }} ↓{{ fmtRate(p.bpsIn) }}</span>
          </template>
          <template v-else-if="column.key === 'share'">
            <span class="mono small">{{ formatBytes(p.total) }}</span>
            <a-progress :percent="p.share" :show-info="false" size="small" class="share-bar" />
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.kpi { flex: 1 1 170px; min-width: 0; }
.kpi-ico { color: var(--pb-primary); margin-inline-end: 4px; }
.foot { font-size: 12px; }
.title-ico { color: var(--pb-primary); }
.hint { font-size: 12px; margin-bottom: 12px !important; }
.small { font-size: 12px; }
.win-card :deep(.ant-statistic-content) { font-size: 22px; }
.fill { height: 100%; }
.chart-empty { text-align: center; margin: -24px 0 0 !important; font-size: 12.5px; }
.donut-wrap { padding: 8px 0 16px; }
.donut-lbl { font-size: 12px; }
.donut-val { font-size: 18px; }
.split-name { flex: 1; }
.pp-filters { margin-bottom: 12px; }
.pp-search { width: 280px; max-width: 100%; }
.share-bar { margin: 0 !important; }
</style>
