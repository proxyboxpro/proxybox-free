<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()

const data = ref(null)
const err = ref('')
const loading = ref(false)
const sweeping = ref(false)
const autoRefresh = ref(true)
let timer = null

async function refresh() {
  loading.value = true; err.value = ''
  try { data.value = await apiFetch('/api/admin/health') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function runSweep() {
  if (sweeping.value) return
  sweeping.value = true; err.value = ''
  try {
    await apiFetch('/api/admin/health/sweep', { method: 'POST' })
    // Sweep is async on the server; give probes ~18s before refreshing.
    setTimeout(() => { refresh(); sweeping.value = false }, 18000)
  } catch (e) { err.value = e.message; sweeping.value = false }
}

function fmtMs(ms) {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return (s / 3600).toFixed(1) + 'h'
}
function fmtAgo(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

const counters = computed(() => data.value?.counters || { total: 0, active: 0, error: 0, expired: 0, replaced: 0, failing: 0, neverChecked: 0 })
const settings = computed(() => data.value?.settings || {})
const perNode = computed(() => data.value?.perNode || [])
const failers = computed(() => data.value?.topFailers || [])
const recentFixes = computed(() => (data.value?.recentFixes || []).map((f, i) => ({ ...f, _k: i })))

function fixAction(f) {
  const path = f.path || ''
  if (path.endsWith('/rotate')) return { label: 'rotate', color: 'warning' }
  if (path.endsWith('/replace')) return { label: 'replace', color: 'success' }
  return { label: path.split('/').pop(), color: 'error' }
}
function failerColor(s) { return s === 'active' ? 'success' : s === 'expired' ? 'default' : 'warning' }

const nodeColumns = computed(() => [
  { title: t('admin.health.colNode'), key: 'nodeName', dataIndex: 'nodeName' },
  { title: t('admin.health.colHost'), key: 'host', width: 180 },
  { title: t('admin.health.colTotal'), key: 'total', align: 'right', width: 90 },
  { title: t('admin.health.colFail'), key: 'failing', align: 'right', width: 90 },
  { title: t('admin.health.colFailPct'), key: 'failPct', align: 'right', width: 90 },
  { title: t('admin.health.colStatus'), key: 'status', align: 'right', width: 120 }
])
const fixColumns = computed(() => [
  { title: t('admin.health.colTime'), key: 'ts', width: 200 },
  { title: t('admin.health.colAction'), key: 'action', width: 200 },
  { title: t('admin.health.colDetail'), key: 'note' }
])
const failerColumns = computed(() => [
  { title: t('admin.health.colProxy'), key: 'proxy', width: 140 },
  { title: t('admin.health.colType'), key: 'type', dataIndex: 'type', width: 70 },
  { title: t('admin.health.colOwner'), key: 'owner', ellipsis: true },
  { title: t('admin.health.colNode'), key: 'nodeName', dataIndex: 'nodeName', ellipsis: true, width: 140 },
  { title: t('admin.health.colFailStreak'), key: 'streak', align: 'right', width: 120 },
  { title: t('admin.health.colTotalFail'), key: 'totalFails', align: 'right', width: 90 },
  { title: t('admin.health.colAutoFixed'), key: 'autofix', align: 'right', width: 140 },
  { title: t('admin.health.colLastCheck'), key: 'last', align: 'right', width: 120 },
  { title: t('admin.health.colStatus'), key: 'status', align: 'right', width: 110 }
])

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
        <HeartOutlined />
        Auto-heal · {{ formatNumber(counters.total) }} {{ t('admin.health.eyebrowSuffix') }}
      </a-typography-text>
      <a-flex wrap="wrap" gap="small" align="center">
        <a-checkbox v-model:checked="autoRefresh">{{ t('admin.health.autoRefresh') }}</a-checkbox>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.health.refresh') }}
        </a-button>
        <a-button type="primary" ghost :loading="sweeping" @click="runSweep">
          <template #icon><ThunderboltOutlined /></template>
          {{ sweeping ? t('admin.health.sweeping') : t('admin.health.sweepNow') }}
        </a-button>
      </a-flex>
    </a-flex>

    <a-typography-paragraph type="secondary" class="intro">
      {{ t('admin.health.intro', { cooldown: fmtMs(settings.autoFixCooldownMs), maxFix: settings.maxAutoFixPerSweep, suspectPct: settings.nodeSuspectPct }) }}
    </a-typography-paragraph>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :lg="6">
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.health.kpiActive')" :value="formatNumber(counters.active)" :value-style="{ color: 'var(--pb-success)' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="foot">{{ t('admin.health.kpiActiveSub', { total: formatNumber(counters.total) }) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :lg="6">
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.health.kpiFailing')" :value="formatNumber(counters.failing)" :value-style="{ color: counters.failing > 0 ? 'var(--pb-warning)' : 'var(--pb-text-3)' }">
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="foot mono">{{ t('admin.health.kpiFailingSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :lg="6">
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.health.kpiFixes')" :value="recentFixes.length" :value-style="{ color: 'var(--pb-info)' }">
            <template #prefix><ToolOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="foot">{{ t('admin.health.kpiFixesSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :lg="6">
        <a-card size="small" class="kpi">
          <a-statistic :title="t('admin.health.kpiReplaced')" :value="formatNumber(counters.replaced || 0)">
            <template #prefix><SwapOutlined /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="foot">{{ t('admin.health.kpiReplacedSub', { n: counters.expired || 0 }) }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- Per-node fail rate -->
    <a-card :body-style="{ padding: 0 }">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span>{{ t('admin.health.perNodeTitle') }}</span>
          <a-typography-text type="secondary" class="note">{{ t('admin.health.perNodeNote', { pct: settings.nodeSuspectPct }) }}</a-typography-text>
        </a-flex>
      </template>
      <a-table
        :columns="nodeColumns"
        :data-source="perNode"
        row-key="nodeId"
        size="middle"
        :pagination="false"
        :scroll="{ x: 720 }"
        :row-class-name="(r) => (r.suspect ? 'row-suspect' : '')"
        :locale="{ emptyText: t('admin.health.empty') }"
      >
        <template #bodyCell="{ column, record: n }">
          <template v-if="column.key === 'host'"><span class="mono">{{ n.host || '—' }}</span></template>
          <template v-else-if="column.key === 'total'">{{ formatNumber(n.total) }}</template>
          <template v-else-if="column.key === 'failing'">
            <a-typography-text :type="n.failing > 0 ? 'warning' : 'secondary'">{{ formatNumber(n.failing) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'failPct'"><span class="mono">{{ n.failPct }}%</span></template>
          <template v-else-if="column.key === 'status'">
            <StatusTag v-if="n.suspect" status="error" label="SUSPECT" />
            <StatusTag v-else-if="n.failPct === 0" status="active" label="OK" />
            <StatusTag v-else status="pending" :label="`${n.failPct.toFixed(1)}%`" />
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Recent auto-fix audit -->
    <a-card :body-style="{ padding: 0 }">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span>{{ t('admin.health.recentTitle', { n: recentFixes.length }) }}</span>
          <a-typography-text type="secondary" class="note">{{ t('admin.health.recentNote') }}</a-typography-text>
        </a-flex>
      </template>
      <a-table
        :columns="fixColumns"
        :data-source="recentFixes"
        row-key="_k"
        size="middle"
        :pagination="recentFixes.length > 25 ? { pageSize: 25, showSizeChanger: false } : false"
        :scroll="{ x: 720 }"
        :locale="{ emptyText: t('admin.health.recentEmpty') }"
      >
        <template #bodyCell="{ column, record: f }">
          <template v-if="column.key === 'ts'"><a-typography-text type="secondary" class="mono small">{{ f.ts }}</a-typography-text></template>
          <template v-else-if="column.key === 'action'">
            <StatusTag :status="fixAction(f).label" :label="fixAction(f).label" :color="fixAction(f).color" />
            <div><a-typography-text type="secondary" class="mono small">{{ (f.path || '').match(/\/proxy\/([^/]+)/)?.[1] || '—' }}</a-typography-text></div>
          </template>
          <template v-else-if="column.key === 'note'"><span class="mono small">{{ f.note }}</span></template>
        </template>
      </a-table>
    </a-card>

    <!-- Top current failers -->
    <a-card :body-style="{ padding: 0 }">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span>{{ t('admin.health.failersTitle', { n: data?.failerCount || 0 }) }}</span>
          <a-typography-text type="secondary" class="note">{{ t('admin.health.failersNote') }}</a-typography-text>
        </a-flex>
      </template>
      <a-table
        :columns="failerColumns"
        :data-source="failers"
        row-key="proxyId"
        size="middle"
        :pagination="failers.length > 50 ? { pageSize: 50, showSizeChanger: false } : false"
        :scroll="{ x: 1100 }"
        :locale="{ emptyText: t('admin.health.failersEmpty') }"
      >
        <template #bodyCell="{ column, record: f }">
          <template v-if="column.key === 'proxy'">
            <div class="mono">{{ f.proxyId }}</div>
            <a-typography-text type="secondary" class="mono small">:{{ f.port }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'owner'">{{ f.ownerEmail || '—' }}</template>
          <template v-else-if="column.key === 'streak'"><a-typography-text type="warning" strong class="mono">{{ f.checkFailCount }}</a-typography-text></template>
          <template v-else-if="column.key === 'totalFails'"><a-typography-text type="secondary" class="mono">{{ f.totalFails }}</a-typography-text></template>
          <template v-else-if="column.key === 'autofix'">
            <template v-if="f.autoFixCount > 0">
              <div><strong class="mono">{{ f.autoFixCount }}</strong></div>
              <a-typography-text type="secondary" class="mono small">{{ f.lastAutoFixAction }} · {{ fmtAgo(f.lastAutoFixAt) }}</a-typography-text>
            </template>
            <a-typography-text v-else type="secondary">—</a-typography-text>
          </template>
          <template v-else-if="column.key === 'last'"><a-typography-text type="secondary" class="small">{{ fmtAgo(f.lastCheckedAt) }}</a-typography-text></template>
          <template v-else-if="column.key === 'status'"><StatusTag :status="f.status" :color="failerColor(f.status)" /></template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.intro { max-width: 920px; margin-bottom: 0 !important; line-height: 1.6; }
.kpi { height: 100%; }
.foot { display: block; font-size: 12px; margin-top: 2px; }
.small { font-size: 12px; }
.card-head-controls { padding: 8px 0; }
.note { font-size: 12px; font-weight: 400; white-space: normal; }
:deep(.row-suspect) > td { background: color-mix(in srgb, var(--pb-error) 8%, transparent) !important; }
</style>
