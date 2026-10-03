<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()
const win = ref('h24')          // h1 | h24 | d30
const proxies = ref([])
const totals = ref({ up: 0, down: 0, conns: 0, proxyCount: 0 })
const err = ref('')
const loading = ref(false)
const typeFilter = ref('')
const search = ref('')
const sortDir = ref('desc')     // desc = most first, asc = least first
const autoRefresh = ref(false)
let timer = null

const WINDOWS = computed(() => [
  { value: 'h1', label: t('admin.bw.win1h') },
  { value: 'h24', label: t('admin.bw.win24h') },
  { value: 'd30', label: t('admin.bw.win30d') }
])

async function refresh() {
  loading.value = true; err.value = ''
  try {
    const data = await apiFetch(`/api/admin/bandwidth?window=${win.value}`)
    proxies.value = data?.proxies || []
    totals.value = data?.totals || { up: 0, down: 0, conns: 0, proxyCount: 0 }
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

function setWindow(v) { if (win.value !== v) { win.value = v; refresh() } }

const filtered = computed(() => {
  let list = proxies.value
  if (typeFilter.value) list = list.filter((p) => p.type === typeFilter.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter((p) => `${p.proxyId} ${p.ownerEmail} ${p.bindIp} ${p.ip} ${p.port} ${p.zone} ${p.nodeName}`.toLowerCase().includes(q))
  }
  // Backend returns desc by total; re-sort for the "ít nhất" view.
  const sorted = [...list].sort((a, b) => sortDir.value === 'asc' ? a.total - b.total : b.total - a.total)
  return sorted
})
// Rank across pages (bodyCell's index restarts on every page).
const rankOf = computed(() => new Map(filtered.value.map((p, i) => [p.proxyId, i + 1])))

// Largest total in the current filtered set — drives the relative bar width.
const maxTotal = computed(() => filtered.value.reduce((m, p) => Math.max(m, p.total || 0), 0) || 1)
function barPercent(p) { return Math.max(2, Math.round(((p.total || 0) / maxTotal.value) * 100)) }

const kpi = computed(() => ({
  total: (totals.value.up || 0) + (totals.value.down || 0),
  up: totals.value.up || 0,
  down: totals.value.down || 0,
  conns: totals.value.conns || 0,
  count: totals.value.proxyCount || 0
}))
const fmtBytes = ({ value }) => formatBytes(value)
const fmtNum = ({ value }) => formatNumber(value)

const typeOptions = computed(() => [
  { value: '', label: t('admin.bw.filterAll') },
  { value: 'IPv4', label: 'IPv4' },
  { value: 'IPv6', label: 'IPv6' },
  { value: 'Hub', label: 'Hub' }
])
const sortOptions = computed(() => [
  { value: 'desc', label: t('admin.bw.sortDesc') },
  { value: 'asc', label: t('admin.bw.sortAsc') }
])

const columns = computed(() => [
  { title: '#', key: 'rank', width: 56, align: 'right' },
  { title: t('admin.bw.colOwner'), key: 'owner' },
  { title: t('admin.bw.colNode'), key: 'node', responsive: ['md'] },
  { title: t('admin.bw.colIpPort'), key: 'ip' },
  { title: t('admin.bw.colConns'), key: 'conns', align: 'right', width: 110, responsive: ['md'] },
  { title: t('admin.bw.colUpDown'), key: 'updown', align: 'right', width: 130 },
  { title: t('admin.bw.colTotal'), key: 'total', align: 'right', width: 160 }
])
const pagination = { defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['50', '100', '200'], hideOnSinglePage: true }
const BAR_COLOR = { '0%': '#3b82f6', '100%': '#16a34a' }

function fmtLastTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('vi-VN', { hour12: false })
}
function goDetail(p) { if (p.exists) router.push({ name: 'admin-connection-detail', params: { proxyId: p.proxyId } }) }
const customRow = (p) => ({ onClick: () => goDetail(p) })
const rowClass = (p) => (p.exists ? 'clickable' : '')

onMounted(() => {
  refresh()
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 30_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">
        <BarChartOutlined />
        {{ t('admin.bw.eyebrowSuffix') }} · {{ filtered.length }} {{ t('admin.bw.ports') }}
      </a-typography-text>
      <a-space wrap>
        <a-checkbox v-model:checked="autoRefresh">{{ t('admin.bw.autoRefresh') }}</a-checkbox>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.bw.refresh') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-typography-paragraph type="secondary" class="intro">{{ t('admin.bw.intro') }}</a-typography-paragraph>

    <!-- Window selector -->
    <div>
      <a-segmented :value="win" :options="WINDOWS" @change="setWindow" />
    </div>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.bw.kpiTotal')" :value="kpi.total" :formatter="fmtBytes">
            <template #prefix><BarChartOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.bw.kpiTotalSub', { n: kpi.count }) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.bw.kpiUpload')" :value="kpi.up" :formatter="fmtBytes">
            <template #prefix><ArrowUpOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.bw.kpiUploadSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.bw.kpiDownload')" :value="kpi.down" :formatter="fmtBytes">
            <template #prefix><ArrowDownOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.bw.kpiDownloadSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.bw.kpiConns')" :value="kpi.conns" :formatter="fmtNum">
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.bw.kpiConnsSub') }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- Filters -->
    <a-card size="small">
      <a-form layout="inline" class="filters">
        <a-form-item :label="t('admin.bw.filterType')">
          <a-select v-model:value="typeFilter" :options="typeOptions" style="width: 130px" />
        </a-form-item>
        <a-form-item :label="t('admin.bw.filterSort')">
          <a-select v-model:value="sortDir" :options="sortOptions" style="width: 170px" />
        </a-form-item>
        <a-form-item :label="t('admin.bw.filterSearch')" class="grow">
          <a-input-search v-model:value="search" allow-clear :placeholder="t('admin.bw.searchPh')" />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Ranking table -->
    <a-card :title="t('admin.bw.rankTitle', { n: filtered.length })" :body-style="{ padding: 0 }">
      <template #extra>
        <a-typography-text type="secondary" class="card-note">{{ t('admin.bw.rankNote') }}</a-typography-text>
      </template>
      <a-table
        :columns="columns"
        :data-source="filtered"
        :loading="loading"
        :pagination="pagination"
        row-key="proxyId"
        size="middle"
        :scroll="{ x: 640 }"
        :custom-row="customRow"
        :row-class-name="rowClass"
        :locale="{ emptyText: t('admin.bw.empty') }"
      >
        <template #bodyCell="{ column, record: p }">
          <template v-if="column.key === 'rank'">
            <a-typography-text type="secondary" class="mono">{{ rankOf.get(p.proxyId) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'owner'">
            <a-typography-text strong>{{ p.ownerEmail || '—' }}</a-typography-text>
            <div>
              <a-typography-text type="secondary" class="mono small">
                {{ p.proxyId }} · {{ p.type || '?' }}
              </a-typography-text>
              <a-typography-text v-if="!p.exists" type="danger" class="small">{{ t('admin.bw.deletedSuffix') }}</a-typography-text>
            </div>
          </template>
          <template v-else-if="column.key === 'node'">
            <div>{{ p.nodeName || '—' }}</div>
            <a-typography-text type="secondary" class="small">{{ p.zone || '—' }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'ip'">
            <span class="mono">{{ p.ip || p.bindIp || '—' }}<template v-if="p.port">:{{ p.port }}</template></span>
            <div v-if="p.ip && p.bindIp && p.ip !== p.bindIp">
              <a-typography-text type="secondary" class="mono small">{{ t('admin.bw.egressPrefix') }}{{ p.bindIp }}</a-typography-text>
            </div>
          </template>
          <template v-else-if="column.key === 'conns'">
            <strong>{{ formatNumber(p.conns) }}</strong>
            <div v-if="p.srcCount">
              <a-typography-text type="secondary" class="small">{{ formatNumber(p.srcCount) }} {{ t('admin.bw.clientIp') }}</a-typography-text>
            </div>
          </template>
          <template v-else-if="column.key === 'updown'">
            <span class="mono nowrap">↑ {{ formatBytes(p.up) }}</span><br />
            <span class="mono nowrap">↓ {{ formatBytes(p.down) }}</span>
          </template>
          <template v-else-if="column.key === 'total'">
            <a-tooltip :title="fmtLastTs(p.lastTs)">
              <strong class="mono">{{ formatBytes(p.total) }}</strong>
            </a-tooltip>
            <a-progress :percent="barPercent(p)" :show-info="false" size="small" :stroke-color="BAR_COLOR" class="bw-bar" />
          </template>
        </template>
      </a-table>
      <div v-if="filtered.length" class="card-footer">
        <a-typography-text type="secondary" class="card-note">{{ t('admin.bw.footer') }}</a-typography-text>
      </div>
    </a-card>
  </div>
</template>

<style scoped>
.intro { margin: 0; max-width: 760px; }
.kpi-sub { font-size: 12px; }
.card-note { font-size: 12px; font-weight: 400; }
.card-footer { padding: 10px 16px 14px; }
.filters { row-gap: 8px; }
.filters .grow { flex: 1 1 240px; }
.small { font-size: 11.5px; }
.bw-bar { margin: 2px 0 0; }
:deep(.clickable) { cursor: pointer; }
</style>
