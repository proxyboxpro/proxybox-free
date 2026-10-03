<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()

const data = ref({ errors: [], counters: { unresolved: 0, bySource: {}, byLevel: {} } })
const err = ref('')
const loading = ref(false)
const filterSource = ref('')
const filterLevel = ref('')
const filterResolved = ref('0')
const autoRefresh = ref(true)
const expandedKeys = ref([])
let timer = null

async function refresh() {
  loading.value = true; err.value = ''
  try {
    const qs = new URLSearchParams()
    if (filterSource.value) qs.set('source', filterSource.value)
    if (filterLevel.value) qs.set('level', filterLevel.value)
    if (filterResolved.value !== '') qs.set('resolved', filterResolved.value)
    qs.set('limit', '300')
    data.value = await apiFetch(`/api/admin/errors?${qs}`)
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function resolveOne(id) {
  try { await apiFetch(`/api/admin/errors/${id}/resolve`, { method: 'POST' }); refresh() }
  catch (e) { message.error(e.message) }
}
async function resolveAll() {
  if (!(await confirmAsync({ title: t('admin.errors.confirmResAll') }))) return
  try { await apiFetch('/api/admin/errors/resolve-all', { method: 'POST' }); refresh() }
  catch (e) { message.error(e.message) }
}

function fmtAgo(ms) {
  if (!ms) return '—'
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
// error → red, warn → orange, info → green (same mapping as the old pills)
function levelStatus(l) { return l === 'error' ? 'error' : l === 'warn' ? 'pending' : 'active' }
function fmtContext(c) { return typeof c === 'string' ? c : JSON.stringify(c, null, 2) }
const fmtNum = ({ value }) => formatNumber(value)

const counters = computed(() => data.value?.counters || {})
const errors = computed(() => data.value?.errors || [])
// Row number across pages (bodyCell's index restarts on every page).
const rankOf = computed(() => new Map(errors.value.map((e, i) => [e.id, i + 1])))
const SOURCES = ['', 'panel', 'agent', 'sweep', 'watchdog', 'auto-heal', 'mtls', 'client']
const LEVELS = ['', 'error', 'warn', 'info']
const KPI_SOURCES = ['agent', 'sweep', 'watchdog', 'auto-heal', 'panel']

const sourceOptions = computed(() => SOURCES.map((s) => ({ value: s, label: s || t('admin.errors.filterAll') })))
const levelOptions = computed(() => LEVELS.map((l) => ({ value: l, label: l || t('admin.errors.filterAll') })))
const statusOptions = computed(() => [
  { value: '0', label: t('admin.errors.statusOpen') },
  { value: '1', label: t('admin.errors.statusResolved') },
  { value: '', label: t('admin.errors.statusAll') }
])

const columns = computed(() => [
  { title: '#', key: 'idx', width: 52, align: 'right' },
  { title: t('admin.errors.colWhen'), key: 'when', width: 110 },
  { title: t('admin.errors.colSource'), key: 'source', width: 170 },
  { title: t('admin.errors.colMessage'), key: 'message' },
  { title: t('admin.errors.colRepeat'), key: 'count', width: 80, align: 'right' },
  { title: t('admin.errors.colAction'), key: 'action', width: 130, align: 'right' }
])
const pagination = { defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['50', '100', '300'], hideOnSinglePage: true }

onMounted(() => {
  refresh()
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 20_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">
        <BugOutlined />
        {{ t('admin.errors.eyebrowSuffix') }} · {{ formatNumber(counters.unresolved || 0) }} {{ t('admin.errors.openCount') }}
      </a-typography-text>
      <a-space wrap>
        <a-checkbox v-model:checked="autoRefresh">{{ t('admin.errors.autoRefresh') }}</a-checkbox>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.errors.refresh') }}
        </a-button>
        <a-button :disabled="!counters.unresolved" @click="resolveAll">
          <template #icon><CheckOutlined /></template>
          {{ t('admin.errors.resolveAll') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-typography-paragraph type="secondary" class="intro">{{ t('admin.errors.intro') }}</a-typography-paragraph>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :sm="8" :xl="4">
        <a-card size="small">
          <a-statistic
            :title="t('admin.errors.kpiTotal')"
            :value="counters.unresolved || 0"
            :formatter="fmtNum"
            :value-style="{ color: counters.unresolved > 0 ? 'var(--pb-error)' : 'var(--pb-text-3)' }"
          />
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.errors.kpiTotalSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col v-for="src in KPI_SOURCES" :key="src" :xs="12" :sm="8" :xl="4">
        <a-card size="small">
          <a-statistic :title="src" :value="counters.bySource?.[src] || 0" :formatter="fmtNum" />
          <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.errors.kpiSourceSub') }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- Filter bar -->
    <a-card size="small">
      <a-form layout="inline" class="filters">
        <a-form-item :label="t('admin.errors.filterSource')">
          <a-select v-model:value="filterSource" :options="sourceOptions" style="width: 150px" @change="refresh" />
        </a-form-item>
        <a-form-item :label="t('admin.errors.filterLevel')">
          <a-select v-model:value="filterLevel" :options="levelOptions" style="width: 130px" @change="refresh" />
        </a-form-item>
        <a-form-item :label="t('admin.errors.filterStatus')">
          <a-select v-model:value="filterResolved" :options="statusOptions" style="width: 140px" @change="refresh" />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Errors table -->
    <a-card :title="t('admin.errors.tableTitle', { n: errors.length })" :body-style="{ padding: 0 }">
      <template #extra>
        <a-typography-text type="secondary" class="card-note">{{ t('admin.errors.tableNote') }}</a-typography-text>
      </template>
      <a-table
        v-model:expanded-row-keys="expandedKeys"
        :columns="columns"
        :data-source="errors"
        :pagination="pagination"
        row-key="id"
        size="middle"
        table-layout="fixed"
        expand-row-by-click
        :scroll="{ x: 860 }"
        :locale="{ emptyText: t('admin.errors.empty') }"
        :row-class-name="() => 'clickable'"
      >
        <template #bodyCell="{ column, record: e }">
          <template v-if="column.key === 'idx'">
            <a-typography-text type="secondary" class="mono">{{ rankOf.get(e.id) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'when'">
            <span class="mono">{{ fmtAgo(e.last_ts) }}</span>
            <div v-if="e.count > 1">
              <a-typography-text type="secondary" class="small">{{ t('admin.errors.firstSeen', { ago: fmtAgo(e.first_ts) }) }}</a-typography-text>
            </div>
          </template>
          <template v-else-if="column.key === 'source'">
            <StatusTag :status="levelStatus(e.level)" :label="e.level" />
            <div>
              <a-typography-text type="secondary" class="small">
                {{ e.source }}<template v-if="e.code"> · <span class="mono">{{ e.code }}</span></template>
              </a-typography-text>
            </div>
          </template>
          <template v-else-if="column.key === 'message'">
            <div class="ellipsis" :title="e.message">{{ e.message || '—' }}</div>
            <a-typography-text v-if="e.nodeId || e.proxyId" type="secondary" class="mono small">
              <template v-if="e.nodeId">node={{ e.nodeId }}</template>
              <template v-if="e.proxyId"> · proxy={{ e.proxyId }}</template>
            </a-typography-text>
          </template>
          <template v-else-if="column.key === 'count'">
            <a-typography-text v-if="e.count > 1" type="warning" strong class="mono">×{{ e.count }}</a-typography-text>
            <a-typography-text v-else type="secondary">1</a-typography-text>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button v-if="!e.resolved" size="small" @click.stop="resolveOne(e.id)">
              <template #icon><CheckOutlined /></template>
              {{ t('admin.errors.btnResolve') }}
            </a-button>
            <StatusTag v-else status="active" :label="t('admin.errors.resolvedTag')" />
          </template>
        </template>

        <template #expandedRowRender="{ record: e }">
          <a-descriptions size="small" bordered :column="1" class="err-desc">
            <a-descriptions-item label="id"><span class="mono">{{ e.id }}</span></a-descriptions-item>
            <a-descriptions-item label="first_ts"><span class="mono">{{ new Date(e.first_ts).toISOString() }}</span></a-descriptions-item>
            <a-descriptions-item label="last_ts"><span class="mono">{{ new Date(e.last_ts).toISOString() }}</span></a-descriptions-item>
            <a-descriptions-item v-if="e.resolvedAt" label="resolved_at">
              <span class="mono">{{ t('admin.errors.resolvedBy', { ts: new Date(e.resolvedAt).toISOString(), who: e.resolvedBy }) }}</span>
            </a-descriptions-item>
          </a-descriptions>
          <pre v-if="e.context" class="mono err-context">{{ fmtContext(e.context) }}</pre>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.intro { margin: 0; max-width: 900px; }
.kpi-sub { font-size: 12px; }
.card-note { font-size: 12px; font-weight: 400; }
.filters { row-gap: 8px; }
.small { font-size: 11.5px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.err-desc { margin-bottom: 10px; }
.err-context {
  margin: 0; padding: 10px 12px; max-height: 240px; overflow: auto;
  font-size: 11.5px; white-space: pre-wrap; word-break: break-all;
  background: var(--pb-surface-2); border: 1px solid var(--pb-border); border-radius: 6px;
}
:deep(.clickable) { cursor: pointer; }
</style>
