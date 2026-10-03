<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber, formatRate } from '../../utils/format'
import { useI18n } from '../../i18n'
import { isDark } from '../../theme'
import { message, confirmAsync } from '../../ui/feedback'

const { t } = useI18n()

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
}

const apexchart = VueApexCharts.component || VueApexCharts
const route = useRoute()
const router = useRouter()
const proxyId = computed(() => route.params.proxyId)

const summary = ref(null)
const events = ref([])
const topHosts = ref([])
const history = ref([])
const hostFilter = ref('')
const srcFilter = ref('')
const range = ref('24h')
const err = ref('')
const loading = ref(false)
let timer = null

async function loadSummary() {
  try {
    const all = await apiFetch('/api/admin/connections')
    summary.value = all.find((r) => r.proxyId === proxyId.value) || null
  } catch (e) { err.value = e.message }
}
function rangeToHours() { return range.value === '1h' ? 1 : range.value === '24h' ? 24 : range.value === '7d' ? 168 : 720 }
async function loadHistory() {
  try {
    // hourly traffic
    const hr = await apiFetch(`/api/admin/metrics/timeseries?range=${range.value === '1h' ? '1h' : (range.value === '24h' ? '24h' : (range.value === '7d' ? '7d' : '30d'))}`)
    history.value = hr?.points || []
  } catch { history.value = [] }
}
async function loadTopHosts() {
  try {
    const r = await apiFetch(`/api/admin/connections/${proxyId.value}/top-hosts?hours=${rangeToHours()}`)
    topHosts.value = r?.hosts || []
  } catch { topHosts.value = [] }
}
async function loadEvents() {
  loading.value = true
  try {
    const since = Date.now() - rangeToHours() * 3600_000
    let qs = `from=${since}&limit=300`
    if (hostFilter.value) qs += `&host=${encodeURIComponent(hostFilter.value)}`
    if (srcFilter.value) qs += `&src=${encodeURIComponent(srcFilter.value)}`
    const r = await apiFetch(`/api/admin/connections/${proxyId.value}/events?${qs}`)
    events.value = r?.events || []
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function refresh() { await Promise.all([loadSummary(), loadHistory(), loadTopHosts(), loadEvents()]) }
async function blockHost(host) {
  if (!(await confirmAsync({ title: t('admin.connDetail.confirmBlock', { host }), danger: true }))) return
  try {
    await apiFetch('/api/admin/deny-hosts', { method: 'POST', body: { host } })
    message.success(t('admin.connDetail.blocked', { host }))
  } catch (e) { message.error(t('admin.connDetail.blockErr', { msg: e.message })) }
}

watch(range, refresh)
onMounted(() => { refresh(); timer = setInterval(refresh, 10_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const RANGES = ['1h', '24h', '7d', '30d']
const fmtNum = ({ value }) => formatNumber(value)
const fmtBytes = ({ value }) => formatBytes(value)

const bwSeries = computed(() => [
  { name: 'Bytes ↓', data: history.value.map((p) => [p.ts, p.down || 0]) },
  { name: 'Bytes ↑', data: history.value.map((p) => [p.ts, p.up || 0]) }
])
const bwOptions = computed(() => {
  const dark = isDark.value
  const muted = dark ? '#94a3b8' : '#64748b'
  return {
    chart: { type: 'area', toolbar: { show: false }, animations: { enabled: false }, background: 'transparent', stacked: true },
    theme: { mode: dark ? 'dark' : 'light' },
    stroke: { curve: 'smooth', width: 1.5 },
    dataLabels: { enabled: false },
    colors: ['#3b82f6', '#8b5cf6'],
    fill: { type: 'gradient', gradient: { shadeIntensity: 0.6, opacityFrom: 0.4, opacityTo: 0.05 } },
    grid: { borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', strokeDashArray: 2 },
    xaxis: { type: 'datetime', labels: { style: { colors: muted, fontSize: '11px' } } },
    yaxis: { labels: { style: { colors: muted, fontSize: '11px' }, formatter: (v) => formatBytes(v) } },
    tooltip: { theme: dark ? 'dark' : 'light', y: { formatter: (v) => formatBytes(v) } },
    legend: { labels: { colors: muted } }
  }
})

const hostColumns = computed(() => [
  { title: t('admin.connDetail.colHost'), key: 'host' },
  { title: t('admin.connDetail.colHits'), key: 'count', align: 'right', width: 90 },
  { title: t('admin.connDetail.colBytes'), key: 'bytes', align: 'right', width: 120 },
  { title: t('admin.connDetail.colLast'), key: 'last', align: 'right', width: 180, responsive: ['sm'] },
  { title: '', key: 'block', align: 'right', width: 56 }
])
const eventColumns = computed(() => [
  { title: t('admin.connDetail.colWhen'), key: 'when', width: 170 },
  { title: t('admin.connDetail.colClient'), key: 'client' },
  { title: t('admin.connDetail.colTarget'), key: 'target' },
  { title: t('admin.connDetail.colBytes'), key: 'bytes', align: 'right', width: 100 },
  { title: t('admin.connDetail.colMs'), key: 'ms', align: 'right', width: 80, responsive: ['sm'] },
  { title: t('admin.connDetail.colKind'), key: 'kind', width: 100, responsive: ['sm'] }
])
// Events carry no id — key rows by their position in the fetched list.
const eventRows = computed(() => events.value.map((c, i) => ({ ...c, _k: i })))
const pagination = { defaultPageSize: 20, showSizeChanger: true, hideOnSinglePage: true }
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-space :size="8" align="center">
        <a-button shape="circle" @click="router.push({ name: 'admin-connections' })">
          <template #icon><ArrowLeftOutlined /></template>
        </a-button>
        <a-typography-text type="secondary">
          <LineChartOutlined /> {{ t('admin.connDetail.proxyLabel') }}
        </a-typography-text>
        <a-typography-text :copyable="{ text: proxyId }" class="mono">{{ proxyId }}</a-typography-text>
      </a-space>
      <a-space wrap>
        <a-segmented v-model:value="range" :options="RANGES" />
        <a-button shape="circle" :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- Summary -->
    <a-row v-if="summary" :gutter="[12, 12]">
      <a-col :xs="24" :sm="12" :xl="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('admin.connDetail.owner')" :value="summary.ownerEmail || '—'" :value-style="{ fontSize: '16px' }" />
          <a-typography-text type="secondary" class="kpi-sub mono">{{ summary.ownerId }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :xl="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('admin.connDetail.host')" :value-style="{ fontSize: '16px' }">
            <template #formatter>
              <a-typography-text :copyable="{ text: `${summary.ip || summary.bindIp}:${summary.port}` }" class="mono">
                {{ summary.ip || summary.bindIp }}:{{ summary.port }}
              </a-typography-text>
            </template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">
            {{ t('admin.connDetail.egressPrefix') }}<span class="mono">{{ summary.bindIp }}</span> · {{ summary.nodeName }} · {{ summary.zone }}
          </a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="12" :xl="6">
        <a-card size="small" class="fill">
          <a-statistic
            :title="t('admin.connDetail.open')"
            :value="summary.active || 0"
            :formatter="fmtNum"
            :value-style="{ color: summary.active ? 'var(--pb-success)' : 'var(--pb-text-3)' }"
          />
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.connDetail.allTime', { n: formatNumber(summary.total) }) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="12" :xl="6">
        <a-card size="small" class="fill">
          <a-statistic
            :title="t('admin.connDetail.bandwidth')"
            :value="(summary.uploadBytes || 0) + (summary.downloadBytes || 0)"
            :formatter="fmtBytes"
          />
          <a-typography-text type="secondary" class="kpi-sub">↑ {{ formatRate(summary.bpsOut) }} · ↓ {{ formatRate(summary.bpsIn) }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- Bandwidth chart -->
    <a-card :title="t('admin.connDetail.bwTitle', { range })">
      <a-empty v-if="!history.length" :description="t('admin.connDetail.bwEmpty')" />
      <apexchart v-else :key="isDark ? 'dark' : 'light'" type="area" :options="bwOptions" :series="bwSeries" :height="240" />
    </a-card>

    <!-- Top hosts in window -->
    <a-card :title="t('admin.connDetail.topTitle', { range })" :body-style="{ padding: 0 }">
      <a-table
        :columns="hostColumns"
        :data-source="topHosts"
        :pagination="pagination"
        row-key="host"
        size="middle"
        :scroll="{ x: 520 }"
        :locale="{ emptyText: t('admin.connDetail.topEmpty') }"
      >
        <template #bodyCell="{ column, record: h }">
          <template v-if="column.key === 'host'">
            <a-tooltip v-if="h.geo?.cc" :title="`${h.geo.country}${h.geo.asn ? ' · ' + h.geo.asn : ''}`">
              <span class="flag">{{ ccToFlag(h.geo.cc) }}</span>
            </a-tooltip>
            <span class="mono">{{ h.host }}</span>
          </template>
          <template v-else-if="column.key === 'count'">{{ formatNumber(h.count) }}</template>
          <template v-else-if="column.key === 'bytes'">
            <span class="mono nowrap">{{ formatBytes((h.bytesUp || 0) + (h.bytesDown || 0)) }}</span>
          </template>
          <template v-else-if="column.key === 'last'">
            <a-typography-text type="secondary" class="small">{{ new Date(h.lastTs).toLocaleString('vi-VN') }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'block'">
            <a-tooltip :title="t('admin.connDetail.blockTitle')">
              <a-button size="small" type="text" danger @click="blockHost(h.host)">
                <template #icon><StopOutlined /></template>
              </a-button>
            </a-tooltip>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Event log -->
    <a-card :title="t('admin.connDetail.evLogTitle', { n: events.length })" :body-style="{ padding: 0 }">
      <a-flex wrap="wrap" gap="small" class="ev-filters">
        <a-input v-model:value="hostFilter" allow-clear :placeholder="t('admin.connDetail.filterHost')" class="ev-filter" @change="loadEvents">
          <template #prefix><SearchOutlined /></template>
        </a-input>
        <a-input v-model:value="srcFilter" allow-clear :placeholder="t('admin.connDetail.filterSrc')" class="ev-filter" @change="loadEvents">
          <template #prefix><SearchOutlined /></template>
        </a-input>
      </a-flex>
      <a-table
        :columns="eventColumns"
        :data-source="eventRows"
        :pagination="pagination"
        row-key="_k"
        size="small"
        :scroll="{ x: 620 }"
        :locale="{ emptyText: t('admin.connDetail.evEmpty') }"
      >
        <template #bodyCell="{ column, record: c }">
          <template v-if="column.key === 'when'">
            <a-typography-text type="secondary" class="small">{{ new Date(c.ts).toLocaleString('vi-VN') }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'client'">
            <a-tooltip v-if="c.srcGeo?.cc" :title="c.srcGeo.country">
              <span class="flag">{{ ccToFlag(c.srcGeo.cc) }}</span>
            </a-tooltip>
            <span class="mono">{{ c.src || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'target'">
            <a-tooltip v-if="c.hostGeo?.cc" :title="c.hostGeo.country">
              <span class="flag">{{ ccToFlag(c.hostGeo.cc) }}</span>
            </a-tooltip>
            <span class="mono">{{ c.host }}:{{ c.port }}</span>
          </template>
          <template v-else-if="column.key === 'bytes'">
            <span class="mono nowrap">{{ formatBytes((c.up || 0) + (c.dn || c.down || 0)) }}</span>
          </template>
          <template v-else-if="column.key === 'ms'">
            <span class="mono">{{ c.ms }}</span>
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-typography-text type="secondary" class="small">{{ c.kind }}</a-typography-text>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.fill { height: 100%; }
.kpi-sub { font-size: 12px; }
.small { font-size: 12px; }
.flag { margin-right: 4px; }
.ev-filters { padding: 12px 16px; }
.ev-filter { width: 240px; max-width: 100%; }
</style>
