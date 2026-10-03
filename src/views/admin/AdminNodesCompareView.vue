<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { loadNodes, nodesState } from '../../store/nodes'
import { formatBytes } from '../../utils/format'
import { useI18n } from '../../i18n'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const a = ref(route.query.a || '')
const b = ref(route.query.b || '')
const result = ref(null)
const loading = ref(false)
const errorText = ref('')

// nodesState.nodes (from /api/nodes) also carries the control plane as id
// "local" — it is listed once, first, under its own label.
const nodeOpts = computed(() => {
  const opts = [{ value: '', label: t('admin.nodesCmp.pick') }, { value: 'local', label: t('admin.nodesCmp.localCtrlPlane') }]
  for (const n of nodesState.nodes) if (n.id !== 'local') opts.push({ value: n.id, label: `${n.name} — ${n.host}` })
  return opts
})

async function runCompare() {
  if (!a.value || !b.value || a.value === b.value) { result.value = null; return }
  loading.value = true; errorText.value = ''
  router.replace({ query: { a: a.value, b: b.value } }).catch(() => {})
  try { result.value = await apiFetch(`/api/admin/nodes/compare?a=${encodeURIComponent(a.value)}&b=${encodeURIComponent(b.value)}`) }
  catch (e) { errorText.value = e.message; result.value = null }
  finally { loading.value = false }
}

function diffClass(av, bv, lowerIsBetter = false) {
  if (av == null || bv == null || av === bv) return ''
  const aIsBetter = lowerIsBetter ? Number(av) < Number(bv) : Number(av) > Number(bv)
  return aIsBetter ? 'better' : 'worse'
}
const DIFF_TYPE = { better: 'success', worse: 'danger' }

// One row per metric. `diff` → highlight better/worse; `fixed` → constant colour.
const rows = computed(() => {
  const r = result.value
  if (!r || !r.a || !r.b) return []
  const A = r.a, B = r.b
  const out = [
    { key: 'host', label: t('admin.nodesCmp.host'), a: A.host || '—', b: B.host || '—', mono: true },
    { key: 'status', label: t('admin.nodesCmp.status'), a: A.status, b: B.status, status: true },
    { key: 'family', label: t('admin.nodesCmp.family'), a: A.family, b: B.family, mono: true },
    { key: 'version', label: t('admin.nodesCmp.version'), a: A.version || '—', b: B.version || '—', mono: true },
    { key: 'total', label: t('admin.nodesCmp.totalProxy'), a: A.proxies.total, b: B.proxies.total, mono: true, diff: [A.proxies.total, B.proxies.total] },
    { key: 'active', label: t('admin.nodesCmp.proxyActive'), a: A.proxies.active, b: B.proxies.active, mono: true, fixed: 'success' },
    { key: 'failing', label: t('admin.nodesCmp.proxyFailing'), a: A.proxies.failing, b: B.proxies.failing, mono: true, fixed: 'danger' },
    { key: 'owners', label: t('admin.nodesCmp.owners'), a: A.owners, b: B.owners, mono: true },
    { key: 'bwUp', label: t('admin.nodesCmp.bw30dUp'), a: formatBytes(A.bandwidth30d.up), b: formatBytes(B.bandwidth30d.up), mono: true },
    { key: 'bwDown', label: t('admin.nodesCmp.bw30dDown'), a: formatBytes(A.bandwidth30d.down), b: formatBytes(B.bandwidth30d.down), mono: true }
  ]
  if (A.metrics && B.metrics) {
    out.push(
      { key: 'cpu', label: t('admin.nodesCmp.cpu'), a: `${A.metrics.cpuPct}%`, b: `${B.metrics.cpuPct}%`, mono: true, diff: [A.metrics.cpuPct, B.metrics.cpuPct], lower: true },
      { key: 'ram', label: t('admin.nodesCmp.ram'), a: `${A.metrics.ramPct}%`, b: `${B.metrics.ramPct}%`, mono: true, diff: [A.metrics.ramPct, B.metrics.ramPct], lower: true },
      { key: 'load1', label: t('admin.nodesCmp.load1'), a: Number(A.metrics.load1).toFixed(2), b: Number(B.metrics.load1).toFixed(2), mono: true, diff: [A.metrics.load1, B.metrics.load1], lower: true }
    )
  }
  return out
})
function cellType(row, side) {
  if (row.fixed) return row.fixed
  if (!row.diff) return undefined
  const [av, bv] = side === 'a' ? row.diff : [row.diff[1], row.diff[0]]
  return DIFF_TYPE[diffClass(av, bv, row.lower)]
}

const columns = computed(() => [
  { title: t('admin.nodesCmp.metric'), key: 'label', dataIndex: 'label', width: 180 },
  { key: 'a', side: 'a' },
  { key: 'b', side: 'b' }
])

function openDetail(id) { router.push({ name: 'admin-node-detail', params: { nodeId: id } }) }

watch(() => [a.value, b.value], runCompare)
onMounted(async () => { await loadNodes(); if (a.value && b.value) runCompare() })
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.nodesCmp.pickTitle') }}</a-typography-text>
      <a-button @click="router.push({ name: 'admin-nodes' })">{{ t('admin.nodesCmp.back') }}</a-button>
    </a-flex>

    <a-card size="small">
      <a-form layout="vertical" class="pick-form">
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('admin.nodesCmp.nodeA')">
              <a-select v-model:value="a" :options="nodeOpts" show-search option-filter-prop="label" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('admin.nodesCmp.nodeB')">
              <a-select v-model:value="b" :options="nodeOpts" show-search option-filter-prop="label" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-card>

    <a-alert v-if="errorText" type="error" show-icon :message="errorText" />
    <a-card v-if="loading && !result"><a-spin :tip="t('admin.nodesCmp.loading')"><div class="spin-box" /></a-spin></a-card>

    <a-card v-if="result && result.a && result.b" :body-style="{ padding: 0 }">
      <template #title><CloudServerOutlined /> {{ t('admin.nodesCmp.compareTitle') }}</template>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        row-key="key"
        size="middle"
        :pagination="false"
        :scroll="{ x: 560 }"
      >
        <template #headerCell="{ column }">
          <template v-if="column.side">
            <a-space :size="6" wrap>
              <span>{{ result[column.side].name }}</span>
              <a-typography-text type="secondary" class="mono small">({{ result[column.side].id }})</a-typography-text>
            </a-space>
          </template>
        </template>
        <template #bodyCell="{ column, record: row }">
          <template v-if="column.side">
            <StatusTag
              v-if="row.status"
              :status="row[column.side]"
              :color="row[column.side] === 'online' ? 'success' : 'warning'"
            />
            <a-typography-text v-else :type="cellType(row, column.side)" :class="{ mono: row.mono }">{{ row[column.side] }}</a-typography-text>
          </template>
        </template>
      </a-table>
      <a-flex wrap="wrap" gap="small" class="detail-links">
        <a-button @click="openDetail(result.a.id)">{{ t('admin.nodesCmp.openDetail', { name: result.a.name }) }}</a-button>
        <a-button @click="openDetail(result.b.id)">{{ t('admin.nodesCmp.openDetail', { name: result.b.name }) }}</a-button>
      </a-flex>
    </a-card>
  </div>
</template>

<style scoped>
.small { font-size: 12px; }
.pick-form :deep(.ant-form-item) { margin-bottom: 4px; }
.spin-box { min-height: 80px; }
.detail-links { padding: 16px; }
</style>
