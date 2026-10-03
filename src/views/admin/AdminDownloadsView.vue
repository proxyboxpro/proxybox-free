<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { isDark } from '../../theme'

// Local registration — this route is lazy-loaded, so ApexCharts stays out of
// the initial bundle.
const apexchart = VueApexCharts.component || VueApexCharts

const { t } = useI18n()
const stats = ref(null)
const err = ref('')
const loading = ref(false)
let pollHandle = null

async function refresh() {
  loading.value = true; err.value = ''
  try { stats.value = await apiFetch('/api/admin/downloads/stats') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

onMounted(() => {
  refresh()
  // Auto-refresh every 60s so admin can leave the tab open during a launch
  // and see counters tick up without a manual reload.
  pollHandle = setInterval(refresh, 60_000)
})
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })

// Friendly labels for the kind enum surfaced by the API.
const KIND_LABEL_KEYS = {
  'install-panel':     'admin.dl.kindInstallPanel',
  'agent-script-linux':'admin.dl.kindAgentScriptLinux',
  'agent-script-win':  'admin.dl.kindAgentScriptWin',
  'agent-script-v4':   'admin.dl.kindAgentScriptV4',
  'agent-script-v6':   'admin.dl.kindAgentScriptV6',
  'agent-binary-linux':'admin.dl.kindAgentBinaryLinux',
  'agent-binary-win':  'admin.dl.kindAgentBinaryWin',
  'agent-code':        'admin.dl.kindAgentCode',
  'agent-other':       'admin.dl.kindAgentOther'
}
function kindLabel(k) { return KIND_LABEL_KEYS[k] ? t(KIND_LABEL_KEYS[k]) : k }
// Data-series colours (badge dot + share bar), same in both themes.
function kindColor(k) {
  if (k === 'install-panel') return '#22d3ee'
  if (k.startsWith('agent-binary')) return '#a78bfa'
  if (k.startsWith('agent-script')) return '#4ade80'
  if (k === 'agent-code') return '#f59e0b'
  return '#94a3b8'
}

// Fill missing days in the daily series so the chart shows continuous bars
// even when no downloads happen on certain days.
const dailySeries = computed(() => {
  if (!stats.value?.daily) return []
  const map = new Map(stats.value.daily.map((d) => [d.day, d.c]))
  const out = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, count: map.get(key) || 0 })
  }
  return out
})

const chartText = computed(() => (isDark.value ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'))
const chartSeries = computed(() => [{ name: t('admin.dl.colCount'), data: dailySeries.value.map((d) => d.count) }])
const chartOptions = computed(() => ({
  chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  colors: ['#16a34a'],
  plotOptions: { bar: { borderRadius: 3, columnWidth: '70%' } },
  dataLabels: { enabled: false },
  grid: { borderColor: isDark.value ? '#1f2631' : '#f0f0f0', strokeDashArray: 3 },
  xaxis: {
    categories: dailySeries.value.map((d) => d.day.slice(5)),
    labels: { style: { colors: chartText.value, fontSize: '10px' }, rotate: -45, hideOverlappingLabels: true },
    axisBorder: { show: false },
    axisTicks: { show: false },
    tooltip: { enabled: false }
  },
  yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: chartText.value }, formatter: (v) => Math.round(v) } },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    x: { formatter: (_, opts) => dailySeries.value[opts?.dataPointIndex]?.day || '' }
  },
  // Phones: hide the 30 date labels (tooltip still shows the day), shorter chart.
  responsive: [{ breakpoint: 700, options: { chart: { height: 140 }, xaxis: { labels: { show: false } } } }]
}))

const uniqByKind = computed(() => new Map((stats.value?.byKindUniq || []).map((x) => [x.kind, x.uniqIps || 0])))
function sharePct(count) {
  const total = stats.value?.totals?.lifetime || 0
  return total ? (count / total) * 100 : 0
}

const kindColumns = computed(() => [
  { title: t('admin.dl.colKind'), key: 'kind', dataIndex: 'kind' },
  { title: t('admin.dl.colCount'), key: 'count', dataIndex: 'count', align: 'right', width: 110 },
  { title: t('admin.dl.colUniqIp'), key: 'uniq', align: 'right', width: 130 },
  { title: t('admin.dl.colShare'), key: 'share', width: 240 }
])
const recentColumns = computed(() => [
  { title: t('admin.dl.colWhen'), key: 'ts', dataIndex: 'ts', width: 180 },
  { title: t('admin.dl.colKind'), key: 'kind', dataIndex: 'kind' },
  { title: t('admin.dl.colIp'), key: 'ip', dataIndex: 'ip', width: 150 },
  { title: t('admin.dl.colClient'), key: 'ua', dataIndex: 'ua', width: 130 },
  { title: t('admin.dl.colReferer'), key: 'referer', dataIndex: 'referer', ellipsis: true }
])
const recentRows = computed(() => (stats.value?.recent || []).map((r, i) => ({ ...r, _k: i })))

function fmtTs(ms) {
  const d = new Date(Number(ms) || 0)
  if (isNaN(d.getTime())) return '?'
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function shortUa(ua) {
  if (!ua) return ''
  // Common installer/cron UA matches — collapse to friendly tag.
  if (/curl/i.test(ua)) return 'curl'
  if (/wget/i.test(ua)) return 'wget'
  if (/PowerShell|WindowsPowerShell/i.test(ua)) return 'PowerShell'
  // Browser short-form
  const m = ua.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)
  if (m) return m[1]
  return ua.slice(0, 40)
}
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.dl.subtitle') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.dl.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <template v-if="stats">
      <!-- KPI strip -->
      <a-flex wrap="wrap" gap="middle">
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.dl.kpiTotal')" :value="stats.totals.lifetime">
            <template #prefix><DownloadOutlined /></template>
          </a-statistic>
        </a-card>
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.dl.kpi24h')" :value="stats.totals.last24h">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.dl.uniqIpSub', { n: stats.totals.uniqIp24h }) }}</a-typography-text>
        </a-card>
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.dl.kpi7d')" :value="stats.totals.last7d">
            <template #prefix><LineChartOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.dl.uniqIpSub', { n: stats.totals.uniqIp7d }) }}</a-typography-text>
        </a-card>
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.dl.kpi30d')" :value="stats.totals.last30d">
            <template #prefix><GlobalOutlined /></template>
          </a-statistic>
        </a-card>
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.dl.kpiUniqIp')" :value="stats.totals.uniqIpAll">
            <template #prefix><TeamOutlined /></template>
          </a-statistic>
        </a-card>
      </a-flex>

      <!-- 30-day bar chart -->
      <a-card size="small">
        <template #title><BarChartOutlined /> {{ t('admin.dl.chart30d') }}</template>
        <apexchart type="bar" height="200" :options="chartOptions" :series="chartSeries" />
      </a-card>

      <!-- Breakdown by kind -->
      <a-card size="small" :body-style="{ padding: 0 }">
        <template #title><CloudServerOutlined /> {{ t('admin.dl.byKind') }}</template>
        <a-table
          :columns="kindColumns"
          :data-source="stats.byKind"
          :pagination="false"
          row-key="kind"
          size="middle"
          :scroll="{ x: 640 }"
          :locale="{ emptyText: t('admin.dl.byKindEmpty') }"
        >
          <template #bodyCell="{ column, record: row }">
            <template v-if="column.key === 'kind'">
              <a-badge :color="kindColor(row.kind)" :text="kindLabel(row.kind)" />
            </template>
            <template v-else-if="column.key === 'count'">
              <span class="mono">{{ row.count.toLocaleString() }}</span>
            </template>
            <template v-else-if="column.key === 'uniq'">
              <span class="mono">{{ (uniqByKind.get(row.kind) || 0).toLocaleString() }}</span>
            </template>
            <template v-else-if="column.key === 'share'">
              <a-progress
                :percent="sharePct(row.count)"
                :stroke-color="kindColor(row.kind)"
                :format="(p) => `${p.toFixed(1)}%`"
                size="small"
              />
            </template>
          </template>
        </a-table>
      </a-card>

      <!-- Recent 100 hits -->
      <a-card size="small" :body-style="{ padding: 0 }">
        <template #title>
          <a-space wrap :size="[8, 0]">
            <span><HistoryOutlined /> {{ t('admin.dl.recent', { n: stats.recent.length }) }}</span>
            <a-typography-text type="secondary" class="note">{{ t('admin.dl.recentNote') }}</a-typography-text>
          </a-space>
        </template>
        <a-table
          :columns="recentColumns"
          :data-source="recentRows"
          :pagination="{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }"
          row-key="_k"
          size="small"
          :scroll="{ x: 860 }"
          :locale="{ emptyText: t('admin.dl.recentEmpty') }"
        >
          <template #bodyCell="{ column, record: r }">
            <template v-if="column.key === 'ts'">
              <span class="mono">{{ fmtTs(r.ts) }}</span>
            </template>
            <template v-else-if="column.key === 'kind'">
              <a-badge :color="kindColor(r.kind)" :text="kindLabel(r.kind)" />
            </template>
            <template v-else-if="column.key === 'ip'">
              <span class="mono">{{ r.ip || '-' }}</span>
            </template>
            <template v-else-if="column.key === 'ua'">
              <a-tooltip v-if="r.ua" :title="r.ua"><span>{{ shortUa(r.ua) }}</span></a-tooltip>
            </template>
            <template v-else-if="column.key === 'referer'">
              <a-typography-text type="secondary" class="mono">{{ r.referer || '-' }}</a-typography-text>
            </template>
          </template>
        </a-table>
      </a-card>
    </template>

    <a-card v-else-if="!err">
      <a-flex justify="center" class="loading-box">
        <a-spin :tip="t('admin.dl.loading')"><div class="spin-pad" /></a-spin>
      </a-flex>
    </a-card>
  </div>
</template>

<style scoped>
.kpi { flex: 1 1 170px; min-width: 0; }
.kpi-sub { font-size: 12px; }
.note { font-size: 12px; font-weight: 400; }
.loading-box { padding: 24px 0; }
.spin-pad { width: 120px; height: 48px; }
</style>
