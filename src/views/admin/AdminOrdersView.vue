<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const router = useRouter()
const list = ref([])
const users = ref([])
const nodes = ref([])
const zones = ref([])
const expanded = ref(new Set())
const expandedMembers = ref(new Map())  // orderId → members[]
// Default to "Đang chạy" tab so admin lands on the active business.
const filters = ref({ ownerId: '', status: 'active', type: '', from: '', to: '', nodeId: '', zone: '', q: '' })
const err = ref('')
const loading = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    const qs = Object.entries(filters.value)
      .filter(([k, v]) => v && k !== 'q')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    list.value = await apiFetch(`/api/admin/orders${qs ? '?' + qs : ''}`)
    if (!users.value.length) users.value = await apiFetch('/api/admin/users').catch(() => [])
    if (!nodes.value.length) nodes.value = await apiFetch('/api/nodes').catch(() => [])
    if (!zones.value.length) zones.value = await apiFetch('/api/admin/zones').catch(() => [])
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function toggleExpand(o) {
  if (expanded.value.has(o.id)) {
    expanded.value.delete(o.id)
  } else {
    expanded.value.add(o.id)
    if (!expandedMembers.value.has(o.id)) {
      try {
        const r = await apiFetch(`/api/admin/orders/${o.id}/members`)
        expandedMembers.value.set(o.id, r.members || [])
      } catch { expandedMembers.value.set(o.id, []) }
    }
  }
  expanded.value = new Set(expanded.value)
}
const expandedKeys = computed(() => [...expanded.value])

async function cancelOrder(o) {
  if (!(await confirmAsync({ title: t('admin.orders.confirmCancel', { id: o.id }), danger: true }))) return
  try {
    const r = await apiFetch(`/api/admin/orders/${o.id}/cancel-refund`, { method: 'POST' })
    message.success(t('admin.orders.flashRefund', { amount: Number(r.refund).toLocaleString() }))
    await refresh()
  } catch (e) { message.error(e.message) }
}
function openDetail(o) { router.push({ name: 'admin-order-detail', params: { orderId: o.id } }) }
function copyable(text) {
  return { text, tooltip: false, onCopy: () => message.success(t('admin.orders.flashCopy', { text: text.slice(0, 30) }), 1.5) }
}

const userById = computed(() => Object.fromEntries(users.value.map((u) => [u.id, u.email || u.id])))
const nodeById = computed(() => Object.fromEntries(nodes.value.map((n) => [n.id, n])))
const zoneById = computed(() => Object.fromEntries(zones.value.map((z) => [z.id, z])))

const filtered = computed(() => {
  if (!filters.value.q) return list.value
  const q = filters.value.q.toLowerCase()
  return list.value.filter((o) => `${o.id} ${o.item || ''} ${o.ownerId || ''} ${userById.value[o.ownerId] || ''} ${o.nodeId || ''} ${o.zone || ''}`.toLowerCase().includes(q))
})

// Aggregated KPIs across the filtered set.
const kpi = computed(() => {
  const total = filtered.value.length
  const active = filtered.value.filter((o) => o.effectiveStatus === 'active').length
  const cancelled = filtered.value.filter((o) => o.effectiveStatus === 'cancelled' || o.effectiveStatus === 'refunded' || o.effectiveStatus === 'deleted').length
  const totalProxies = filtered.value.reduce((s, o) => s + (Number(o.memberCount) || 0), 0)
  const totalIpv4 = filtered.value.reduce((s, o) => s + (Number(o.ipv4Count) || 0), 0)
  const totalIpv6 = filtered.value.reduce((s, o) => s + (Number(o.ipv6Count) || 0), 0)
  const revenue = filtered.value.reduce((s, o) => s + (Number(o.amount || o.totalCost) || 0), 0)
  // Top node by order count
  const byNode = new Map()
  for (const o of filtered.value) byNode.set(o.nodeId, (byNode.get(o.nodeId) || 0) + 1)
  const topNodeEntry = [...byNode.entries()].sort((a, b) => b[1] - a[1])[0]
  return { total, active, cancelled, totalProxies, totalIpv4, totalIpv6, revenue, topNode: topNodeEntry ? topNodeEntry[0] : '—', topNodeCount: topNodeEntry ? topNodeEntry[1] : 0 }
})

function setType(v) { filters.value.type = v; refresh() }
function setStatus(v) { filters.value.status = v; refresh() }
function setFilter(key, v) { filters.value[key] = v || ''; refresh() }
function clearFilters() {
  filters.value = { ownerId: '', status: '', type: '', from: '', to: '', nodeId: '', zone: '', q: '' }
  refresh()
}
function flagFor(zoneId) {
  const z = zoneById.value[zoneId]
  if (z?.flag) return z.flag
  return zoneId ? zoneId.slice(0, 2).toUpperCase() : ''
}
function fmtTs(ts) {
  if (!ts) return '—'
  return String(ts).slice(0, 16).replace('T', ' ')
}
function timeLeft(ms) {
  if (!ms) return '—'
  const diff = ms - Date.now()
  if (diff <= 0) return t('admin.orders.expired')
  const h = Math.floor(diff / 3600_000)
  const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`
}

const hasActiveFilters = computed(() => Object.entries(filters.value).some(([k, v]) => v && k !== 'q'))

// ── antd option lists / columns ─────────────────────────────────────────────
const typeOptions = computed(() => [
  { label: t('admin.orders.tabAll'), value: '' },
  { label: 'IPv4', value: 'IPv4' },
  { label: 'IPv6', value: 'IPv6' }
])
const statusLabels = computed(() => ({
  active: t('admin.orders.statusActive'),
  expired: t('admin.orders.statusExpired'),
  deleted: t('admin.orders.statusDeleted'),
  cancelled: t('admin.orders.statusCancelled'),
  refunded: t('admin.orders.statusRefunded')
}))
const statusOptions = computed(() => [
  ...['active', 'expired', 'deleted', 'cancelled', 'refunded'].map((s) => ({ label: statusLabels.value[s], value: s })),
  { label: t('admin.orders.statusAll'), value: '' }
])
const nodeOptions = computed(() => [
  { label: t('admin.orders.filterAllNodes'), value: '' },
  { label: t('admin.orders.localCp'), value: 'local' },
  ...nodes.value.map((n) => ({ label: `${n.name} (${n.id})`, value: n.id }))
])
const zoneOptions = computed(() => [
  { label: t('admin.orders.filterAllZones'), value: '' },
  ...zones.value.map((z) => ({ label: `${z.flag || z.id} ${z.name}`, value: z.id }))
])
const ownerOptions = computed(() => [
  { label: t('admin.orders.filterAllOwners'), value: '' },
  ...users.value.map((u) => ({ label: u.email, value: u.id }))
])

const orderStatusColor = (s) => (s === 'active' ? 'success' : s === 'expired' ? 'warning' : 'error')
const memberStatusColor = (s) => (s === 'active' ? 'success' : s === 'expired' ? 'error' : 'warning')
const TYPE_TAG = { ipv6: { color: 'green', label: 'IPv6' }, ipv4: { color: 'blue', label: 'IPv4' }, mixed: { color: 'orange', label: 'MIX' } }

const columns = computed(() => [
  { key: 'id', title: t('admin.orders.colId'), width: 130, ellipsis: true },
  { key: 'owner', title: t('admin.orders.colOwner'), width: 200, ellipsis: true },
  { key: 'item', title: t('admin.orders.colItem') },
  { key: 'type', title: t('admin.orders.colType'), width: 80 },
  { key: 'zone', title: t('admin.orders.colZone'), width: 130 },
  { key: 'node', title: t('admin.orders.colNodeC'), width: 130, ellipsis: true },
  { key: 'revenue', title: t('admin.orders.colRevenue'), width: 120, align: 'right' },
  { key: 'created', title: t('admin.orders.colCreatedAt'), width: 150 },
  { key: 'status', title: t('admin.orders.colStatus'), width: 110 },
  { key: 'actions', width: 92, fixed: 'right', align: 'center' }
])
const memberColumns = computed(() => [
  { key: 'proxy', title: t('admin.orders.colProxy') },
  { key: 'endpoint', title: t('admin.orders.colEndpoint') },
  { key: 'creds', title: t('admin.orders.colCreds') },
  { key: 'status', title: t('admin.orders.colStatus'), width: 110 },
  { key: 'expires', title: t('admin.orders.colExpires'), width: 150 },
  { key: 'rot', width: 60 }
])

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.orders.subtitle') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.orders.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />

    <!-- ── KPI strip ── -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :xl="6">
        <a-card size="small" class="kpi">
          <a-statistic :value="kpi.total">
            <template #title><ShoppingCartOutlined /> {{ t('admin.orders.kpiTotal') }}</template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-foot">{{ t('admin.orders.kpiTotalSub', { active: kpi.active, cancelled: kpi.cancelled }) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :xl="6">
        <a-card size="small" class="kpi">
          <a-statistic :value="kpi.totalProxies">
            <template #title><ClusterOutlined /> {{ t('admin.orders.kpiProxies') }}</template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-foot">{{ t('admin.orders.kpiProxiesSub', { v4: kpi.totalIpv4, v6: kpi.totalIpv6 }) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :xl="6">
        <a-card size="small" class="kpi">
          <a-statistic :value="kpi.revenue" suffix="VND">
            <template #title><DollarOutlined /> {{ t('admin.orders.kpiRevenue') }}</template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-foot">{{ t('admin.orders.kpiRevenueSub') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :xl="6">
        <a-card size="small" class="kpi">
          <a-statistic :value="kpi.topNode" class="mono-stat small-stat">
            <template #title><CloudServerOutlined /> {{ t('admin.orders.kpiTopNode') }}</template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-foot">{{ t('admin.orders.kpiTopNodeSub', { n: kpi.topNodeCount }) }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- ── Filter bar ── -->
    <a-card size="small">
      <a-flex wrap="wrap" gap="small" align="center">
        <div class="seg-scroll">
          <a-segmented :value="filters.type" :options="typeOptions" @change="setType" />
        </div>
        <div class="seg-scroll">
          <a-segmented :value="filters.status" :options="statusOptions" @change="setStatus" />
        </div>
        <a-input v-model:value="filters.q" allow-clear :placeholder="t('admin.orders.searchPh')" class="search">
          <template #prefix><SearchOutlined /></template>
        </a-input>
      </a-flex>
      <a-divider dashed class="filter-divider" />
      <a-row :gutter="[12, 12]" align="bottom">
        <a-col :xs="24" :sm="12" :lg="5">
          <div class="filter-label"><CloudServerOutlined /> {{ t('admin.orders.filterNode') }}</div>
          <a-select :value="filters.nodeId" :options="nodeOptions" show-search option-filter-prop="label" class="full-width" @change="(v) => setFilter('nodeId', v)" />
        </a-col>
        <a-col :xs="24" :sm="12" :lg="5">
          <div class="filter-label"><GlobalOutlined /> {{ t('admin.orders.filterZone') }}</div>
          <a-select :value="filters.zone" :options="zoneOptions" show-search option-filter-prop="label" class="full-width" @change="(v) => setFilter('zone', v)" />
        </a-col>
        <a-col :xs="24" :sm="12" :lg="5">
          <div class="filter-label"><TeamOutlined /> {{ t('admin.orders.filterOwner') }}</div>
          <a-select :value="filters.ownerId" :options="ownerOptions" show-search option-filter-prop="label" class="full-width" @change="(v) => setFilter('ownerId', v)" />
        </a-col>
        <a-col :xs="12" :sm="6" :lg="3">
          <div class="filter-label"><CalendarOutlined /> {{ t('admin.orders.filterFrom') }}</div>
          <a-date-picker :value="filters.from" value-format="YYYY-MM-DD" class="full-width" @change="(v) => setFilter('from', v)" />
        </a-col>
        <a-col :xs="12" :sm="6" :lg="3">
          <div class="filter-label"><CalendarOutlined /> {{ t('admin.orders.filterTo') }}</div>
          <a-date-picker :value="filters.to" value-format="YYYY-MM-DD" class="full-width" @change="(v) => setFilter('to', v)" />
        </a-col>
        <a-col v-if="hasActiveFilters" :xs="24" :sm="12" :lg="3">
          <a-button danger block @click="clearFilters">
            <template #icon><CloseOutlined /></template>
            {{ t('admin.orders.clear') }}
          </a-button>
        </a-col>
      </a-row>
    </a-card>

    <!-- ── Orders table ── -->
    <a-card :body-style="{ padding: 0 }">
      <a-table
        :columns="columns"
        :data-source="filtered"
        :loading="loading"
        row-key="id"
        size="middle"
        :scroll="{ x: 1260 }"
        :pagination="{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100', '200'], hideOnSinglePage: false }"
        :locale="{ emptyText: loading ? t('admin.orders.loading') : t('admin.orders.empty') }"
        :expanded-row-keys="expandedKeys"
        expand-row-by-click
        class="orders-table"
        @expand="(_, o) => toggleExpand(o)"
      >
        <template #bodyCell="{ column, record: o }">
          <template v-if="column.key === 'id'">
            <a-tooltip :title="o.id"><span class="mono">{{ o.id }}</span></a-tooltip>
          </template>
          <template v-else-if="column.key === 'owner'">
            {{ userById[o.ownerId] || (o.ownerId ? t('admin.orders.unknown') : '—') }}
          </template>
          <template v-else-if="column.key === 'item'">
            <div>{{ o.item }}</div>
            <a-typography-text type="secondary" class="small">{{ t('admin.orders.proxiesSuffix', { n: o.memberCount }) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag v-if="TYPE_TAG[o.typesLabel]" :color="TYPE_TAG[o.typesLabel].color" :bordered="false" class="mono">{{ TYPE_TAG[o.typesLabel].label }}</a-tag>
            <a-tag v-else :bordered="false">—</a-tag>
          </template>
          <template v-else-if="column.key === 'zone'">
            <a-space :size="4">
              <a-tag v-if="o.zone" :bordered="false" class="mono flag">{{ flagFor(o.zone) }}</a-tag>
              <span class="small">{{ o.zone || '—' }}</span>
            </a-space>
          </template>
          <template v-else-if="column.key === 'node'">
            <span class="mono">{{ o.nodeId === 'local' ? 'local' : (nodeById[o.nodeId]?.name || o.nodeId) }}</span>
          </template>
          <template v-else-if="column.key === 'revenue'">
            <a-typography-text type="success" strong class="mono">{{ Number(o.amount || o.totalCost || 0).toLocaleString() }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'created'">
            <div class="mono small">{{ fmtTs(o.createdAt || o.date) }}</div>
            <a-typography-text v-if="o.expiringMs" type="warning" class="small">{{ t('admin.orders.timeLeft', { left: timeLeft(o.expiringMs) }) }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'status'">
            <StatusTag :status="o.effectiveStatus" :color="orderStatusColor(o.effectiveStatus)" :label="statusLabels[o.effectiveStatus] || o.effectiveStatus" />
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space :size="4" @click.stop>
              <a-tooltip :title="t('admin.orders.actDetail')">
                <a-button size="small" shape="circle" @click="openDetail(o)">
                  <template #icon><EyeOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip v-if="o.status === 'paid' && o.ownerId" :title="t('admin.orders.actCancel')">
                <a-button size="small" shape="circle" danger @click="cancelOrder(o)">
                  <template #icon><CloseOutlined /></template>
                </a-button>
              </a-tooltip>
            </a-space>
          </template>
        </template>

        <!-- Expanded member proxies -->
        <template #expandedRowRender="{ record: o }">
          <a-flex v-if="!expandedMembers.get(o.id)" justify="center" gap="small" class="members-state">
            <a-spin size="small" />
            <a-typography-text type="secondary">{{ t('admin.orders.loadingMembers') }}</a-typography-text>
          </a-flex>
          <a-empty v-else-if="!expandedMembers.get(o.id).length" :image="null" :description="t('admin.orders.noMembers')" class="members-state" />
          <a-table
            v-else
            :columns="memberColumns"
            :data-source="expandedMembers.get(o.id)"
            row-key="id"
            size="small"
            :pagination="false"
            :scroll="{ x: 860 }"
          >
            <template #bodyCell="{ column, record: p }">
              <template v-if="column.key === 'proxy'"><span class="mono">{{ p.name || p.id.slice(0, 12) }}</span></template>
              <template v-else-if="column.key === 'endpoint'">
                <a-typography-text class="mono" :copyable="copyable(`${p.ip || p.bindIp || p.listenHost}:${p.port}`)">{{ p.ip || p.bindIp || p.listenHost }}:{{ p.port }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'creds'">
                <a-typography-text class="mono" :copyable="copyable(`${p.username}:${p.password}`)">{{ p.username }}:{{ p.password }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'status'">
                <StatusTag :status="p.status" :color="memberStatusColor(p.status)" />
              </template>
              <template v-else-if="column.key === 'expires'"><span class="mono small">{{ fmtTs(p.expiresAt) }}</span></template>
              <template v-else-if="column.key === 'rot'">
                <a-tag v-if="p.rotate" color="green" :bordered="false" class="mono">rot</a-tag>
              </template>
            </template>
          </a-table>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.kpi { height: 100%; }
.kpi-foot { font-size: 12px; }
.mono-stat :deep(.ant-statistic-content) { font-family: var(--pb-mono); }
.small-stat :deep(.ant-statistic-content) { font-size: 16px; line-height: 1.9; word-break: break-all; }
.seg-scroll { max-width: 100%; overflow-x: auto; }
.search { width: 300px; max-width: 100%; }
.filter-divider { margin: 12px 0; }
.filter-label { font-size: 12px; color: var(--pb-text-3); margin-bottom: 4px; }
.small { font-size: 12px; }
.flag { margin-inline-end: 0; font-size: 11px; }
.orders-table :deep(.ant-table-tbody > tr.ant-table-row) { cursor: pointer; }
.members-state { padding: 16px 0; }
</style>
