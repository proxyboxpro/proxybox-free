<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

// Series colours (upload = green, download = blue).
const UP_COLOR = '#22c55e'
const DOWN_COLOR = '#3b82f6'

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
}
function fmtDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false })
}

const EMPTY_WIN = { up: 0, down: 0 }
const summary = ref({ proxies: 0, active: 0, total: 0, uploadBytes: 0, downloadBytes: 0, monthBytes: 0, topTargets: [], windows: { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN } })
const windows = computed(() => summary.value?.windows || { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN })
const windowCards = computed(() => {
  const w = windows.value
  return [
    { key: 'h1',  label: t('cust.usage.win1h'),  up: w.h1?.up || 0,  down: w.h1?.down || 0 },
    { key: 'h24', label: t('cust.usage.win24h'), up: w.h24?.up || 0, down: w.h24?.down || 0 },
    { key: 'd30', label: t('cust.usage.win30d'), up: w.d30?.up || 0, down: w.d30?.down || 0 }
  ]
})
const sessions = ref([])
const sessionsHours = ref(1)
const sessionFilters = ref({ host: '', proxyId: '', kind: '' })
const sessionsTotal = ref(0)
const sessionsPage = ref(0)
const sessionsPageSize = ref(50)
const err = ref('')
const loading = ref(false)
let timer = null

const RANGES = [{ label: '1h', value: 1 }, { label: '6h', value: 6 }, { label: '24h', value: 24 }, { label: '7d', value: 168 }, { label: '30d', value: 720 }]
const KIND_COLOR = { http: 'blue', connect: 'purple', socks5: 'orange' }
const kindOptions = computed(() => [
  { label: t('cust.conn.allProtocols'), value: '' },
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS (CONNECT)', value: 'connect' },
  { label: 'SOCKS5', value: 'socks5' }
])

async function loadSummary() {
  try { summary.value = await apiFetch('/api/v1/user/proxies/connections/summary') }
  catch (e) { err.value = e.message }
}
async function loadSessions() {
  loading.value = true
  try {
    const f = sessionFilters.value
    const qs = [`hours=${sessionsHours.value}`, `limit=${sessionsPageSize.value}`, `offset=${sessionsPage.value * sessionsPageSize.value}`]
    if (f.host)    qs.push(`host=${encodeURIComponent(f.host)}`)
    if (f.proxyId) qs.push(`proxyId=${encodeURIComponent(f.proxyId)}`)
    if (f.kind)    qs.push(`kind=${encodeURIComponent(f.kind)}`)
    const data = await apiFetch(`/api/v1/user/proxies/sessions?${qs.join('&')}`)
    sessions.value = data?.sessions || []
    sessionsTotal.value = data?.total || 0
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadSessions()])
}

function setRange(hours) {
  sessionsHours.value = hours
  sessionsPage.value = 0
  loadSessions()
}
function onFilterChange() {
  sessionsPage.value = 0
  loadSessions()
}

// Server-side pagination (limit/offset) driven by the antd table pager.
const pagination = computed(() => ({
  current: sessionsPage.value + 1,
  pageSize: sessionsPageSize.value,
  total: sessionsTotal.value,
  showSizeChanger: true,
  pageSizeOptions: ['25', '50', '100', '200'],
  size: 'small',
  showTotal: () => `${t('cust.conn.page')} ${sessionsPage.value + 1} / ${Math.max(1, Math.ceil(sessionsTotal.value / sessionsPageSize.value))}`
}))
function onTableChange(p) {
  if (p.pageSize !== sessionsPageSize.value) {
    sessionsPageSize.value = p.pageSize
    sessionsPage.value = 0
  } else {
    sessionsPage.value = p.current - 1
  }
  loadSessions()
}

const columns = computed(() => [
  { title: t('cust.conn.colProxy'),    key: 'proxy',    width: 190 },
  { title: t('cust.conn.colDest'),     key: 'dest' },
  { title: t('cust.conn.colProtocol'), key: 'kind',     width: 110 },
  { title: t('cust.conn.colPort'),     key: 'port',     width: 80,  align: 'right', responsive: ['md'] },
  { title: t('cust.conn.colBytes'),    key: 'bytes',    width: 110, align: 'right' },
  { title: t('cust.conn.colDuration'), key: 'duration', width: 110, align: 'right', responsive: ['md'] },
  { title: t('cust.conn.colTime'),     key: 'time',     width: 100, align: 'right' }
])

onMounted(() => {
  refreshAll()
  timer = setInterval(() => { loadSummary(); loadSessions() }, 10_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-space :size="8">
        <a-badge status="processing" />
        <a-typography-text type="secondary">{{ t('cust.conn.live') }} · <span class="mono">{{ summary.proxies || 0 }}</span> proxy</a-typography-text>
      </a-space>
      <a-button :loading="loading" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        {{ t('cust.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- Aggregate KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :md="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('cust.conn.openConns')" :value="formatNumber(summary.active || 0)" :value-style="{ color: 'var(--pb-success)' }">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="foot">{{ formatNumber(summary.total || 0) }} all-time</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('cust.conn.bw24h')" :value="formatBytes((windows.h24.up || 0) + (windows.h24.down || 0))" :value-style="{ fontSize: '20px' }" />
          <a-typography-text type="secondary" class="foot mono">↑ {{ formatBytes(windows.h24.up || 0) }} · ↓ {{ formatBytes(windows.h24.down || 0) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('cust.conn.bwMonth')" :value="formatBytes((windows.d30.up || 0) + (windows.d30.down || 0))" :value-style="{ fontSize: '20px' }" />
          <a-typography-text type="secondary" class="foot mono">↑ {{ formatBytes(windows.d30.up || 0) }} · ↓ {{ formatBytes(windows.d30.down || 0) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small" class="fill">
          <a-statistic :title="t('cust.conn.topDest')" :value="summary.topTargets?.length || 0" />
          <a-typography-text type="secondary" class="foot">{{ t('cust.conn.uniqueHosts') }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- Accurate cumulative transferred volume over 1h / 24h / 30d -->
    <a-card size="small">
      <template #title><BarChartOutlined class="title-ico" /> {{ t('cust.usage.windowsTitle') }}</template>
      <a-typography-paragraph type="secondary" class="hint">{{ t('cust.usage.windowsHint') }}</a-typography-paragraph>
      <a-row :gutter="[12, 12]">
        <a-col v-for="w in windowCards" :key="w.key" :xs="24" :md="8">
          <a-card size="small">
            <a-statistic :title="w.label" :value="formatBytes(w.up + w.down)" :value-style="{ fontFamily: 'var(--pb-mono)', fontWeight: 700, fontSize: '20px' }" />
            <a-space :size="14" class="mono small">
              <span :style="{ color: UP_COLOR }"><ArrowUpOutlined /> {{ formatBytes(w.up) }}</span>
              <span :style="{ color: DOWN_COLOR }"><ArrowDownOutlined /> {{ formatBytes(w.down) }}</span>
            </a-space>
          </a-card>
        </a-col>
      </a-row>
    </a-card>

    <!-- Sessions table -->
    <a-card :body-style="{ paddingTop: '12px' }">
      <template #title>
        <a-space :size="8" wrap class="sessions-title">
          <span><ThunderboltOutlined class="title-ico" /> {{ t('cust.conn.live') }}</span>
          <a-tag :bordered="false" class="mono count-tag">{{ sessions.length }} {{ t('cust.conn.shown') }} · {{ sessionsTotal.toLocaleString() }} {{ t('cust.conn.total') }}</a-tag>
        </a-space>
      </template>

      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="filters">
        <a-segmented :value="sessionsHours" :options="RANGES" class="mono" @change="setRange" />
        <a-flex wrap="wrap" gap="small" class="filter-controls">
          <a-input
            v-model:value="sessionFilters.host"
            allow-clear
            :placeholder="t('cust.conn.filterHost')"
            class="host-filter"
            @change="onFilterChange"
          >
            <template #prefix><SearchOutlined class="muted-ico" /></template>
          </a-input>
          <a-select v-model:value="sessionFilters.kind" :options="kindOptions" class="kind-filter" @change="onFilterChange" />
        </a-flex>
      </a-flex>

      <a-table
        :columns="columns"
        :data-source="sessions"
        :pagination="pagination"
        :loading="loading && !sessions.length"
        row-key="id"
        size="small"
        :scroll="{ x: 760 }"
        @change="onTableChange"
      >
        <template #emptyText>
          <a-empty :description="t('cust.conn.empty')" />
        </template>
        <template #bodyCell="{ column, record: s }">
          <template v-if="column.key === 'proxy'">
            <span class="mono">{{ s.proxyBindIp }}:{{ s.proxyPort }}</span>
          </template>
          <template v-else-if="column.key === 'dest'">
            <a-flex vertical>
              <a-space :size="5">
                <a-tooltip v-if="s.hostGeo?.cc" :title="s.hostGeo.country"><span class="flag">{{ ccToFlag(s.hostGeo.cc) }}</span></a-tooltip>
                <span class="mono">{{ s.host }}</span>
              </a-space>
              <a-typography-text v-if="s.hostIp" type="secondary" class="mono tiny">{{ s.hostIp }}</a-typography-text>
            </a-flex>
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-tag :color="KIND_COLOR[s.kind] || 'default'" :bordered="false" class="mono kind-tag">{{ s.kind }}</a-tag>
          </template>
          <template v-else-if="column.key === 'port'">
            <span class="mono">{{ s.port }}</span>
          </template>
          <template v-else-if="column.key === 'bytes'">
            <a-typography-text strong class="mono">{{ formatBytes((s.up || 0) + (s.down || 0)) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'duration'">
            <a-typography-text type="secondary" class="mono">{{ fmtDuration(s.ms) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'time'">
            <a-typography-text type="secondary" class="mono small">{{ fmtTime(s.ts) }}</a-typography-text>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.fill { height: 100%; }
.foot { font-size: 11.5px; }
.title-ico { color: var(--pb-primary); }
.hint { font-size: 12px; margin-bottom: 12px !important; }
.small { font-size: 12px; }
.tiny { font-size: 11px; }
.muted-ico { color: var(--pb-text-3); }
.sessions-title { font-weight: 600; }
.count-tag { font-weight: 400; margin: 0; }
.filters { margin-bottom: 12px; }
.filter-controls { flex: 1 1 360px; justify-content: flex-end; }
.host-filter { flex: 1 1 220px; max-width: 360px; }
.kind-filter { width: 190px; }
.flag { font-size: 13px; line-height: 1; }
.kind-tag { text-transform: uppercase; font-weight: 600; margin: 0; }
@media (max-width: 575px) {
  .filter-controls { flex-basis: 100%; }
  .host-filter { max-width: none; }
  .kind-filter { flex: 1 1 160px; width: auto; }
}
</style>
