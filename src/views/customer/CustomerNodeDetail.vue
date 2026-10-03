<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const nodeId = computed(() => String(route.params.id || ''))

const node = ref(null)
const proxies = ref([])
const err = ref('')
const busy = ref(false)
const refreshing = ref(false)

// Inline buy form for "create proxy on this node"
const buyForm = ref({ type: 'ipv4', quantity: 1, rotate: false, durationDays: 365 })
const buyBusy = ref(false)

async function loadAll() {
  err.value = ''
  try {
    const nodes = await apiFetch('/api/v1/user/nodes')
    node.value = (nodes || []).find((n) => n.id === nodeId.value) || null
    if (!node.value) { err.value = t('cust.nodeDetail.notFound'); return }
  } catch (e) { err.value = e.message }
  try {
    const all = await apiFetch('/api/v1/user/proxies')
    proxies.value = (all || []).filter((p) => p.nodeId === nodeId.value)
  } catch { proxies.value = [] }
}

// Auto-refresh node stats every 10s so the customer sees live connections /
// bandwidth without manually hitting refresh.
let refreshTimer = null
function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(loadAll, 10_000)
}
function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}

onMounted(() => { loadAll(); startAutoRefresh() })
onBeforeUnmount(stopAutoRefresh)

async function refresh() {
  refreshing.value = true
  try { await loadAll() } finally { refreshing.value = false }
}

async function toggleNode() {
  if (!node.value) return
  busy.value = true
  try {
    await apiFetch(`/api/v1/user/nodes/${node.value.id}/${node.value.disabled ? 'enable' : 'disable'}`, { method: 'POST' })
    await loadAll()
    message.success(node.value?.disabled ? t('cust.nodeDetail.enabled') : t('cust.nodeDetail.disabled'), 3.5)
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}

async function deleteNode() {
  if (!node.value) return
  if (!(await confirmAsync({ title: t('cust.nodeDetail.delNodeConfirm', { name: node.value.name }), danger: true }))) return
  busy.value = true
  try {
    await apiFetch(`/api/v1/user/nodes/${node.value.id}`, { method: 'DELETE' })
    router.push('/my-nodes')
  } catch (e) { message.error(e.message); busy.value = false }
}

async function deleteProxy(p) {
  if (!(await confirmAsync({ title: t('cust.nodeDetail.delProxyConfirm', { id: p.id }), danger: true }))) return
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    await loadAll()
    message.success(t('cust.nodeDetail.proxyDeleted', { id: p.id }))
  } catch (e) { message.error(e.message) }
}

async function rotateProxy(p) {
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}/rotate`, { method: 'POST' })
    await loadAll()
    message.success(t('cust.nodeDetail.ipRotated', { id: p.id }))
  } catch (e) { message.error(e.message) }
}

async function checkProxy(p) {
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/check`, { method: 'POST' })
    message[r.ok ? 'success' : 'warning'](`[${p.id}] ${r.ok ? 'OK' : 'FAIL'} · ${r.latency || '-'}ms`, 4)
    await loadAll()
  } catch (e) { message.error(e.message) }
}

async function createProxies() {
  if (buyBusy.value || !node.value) return
  buyBusy.value = true
  try {
    const body = {
      nodeId: node.value.id,
      type: buyForm.value.type,
      quantity: Math.max(1, Math.min(50, Number(buyForm.value.quantity) || 1)),
      rotate: buyForm.value.type === 'ipv6' && Boolean(buyForm.value.rotate),
      durationDays: Math.max(1, Math.min(3650, Number(buyForm.value.durationDays) || 365))
    }
    const r = await apiFetch('/api/v1/user/proxies/from-own-node', { method: 'POST', body })
    message.success(t('cust.buy.byon.created', { count: r.count, node: node.value.name }), 4)
    await loadAll()
  } catch (e) { message.error(e.message) }
  finally { buyBusy.value = false }
}

function copyToClipboard(s, key) {
  navigator.clipboard?.writeText(s).then(() => {
    message.success(`Copied ${key}`, 1.5)
  })
}

// Live totals derived from the proxy list on this node.
const totals = computed(() => {
  const ps = proxies.value
  return {
    count: ps.length,
    active: ps.filter((p) => p.status === 'active').length,
    conns: ps.reduce((s, p) => s + (p.stats?.activeConnections || 0), 0),
    bw: ps.reduce((s, p) => s + (p.stats?.uploadBytes || 0) + (p.stats?.downloadBytes || 0), 0)
  }
})

const isHub = computed(() => Boolean(node.value?.hub))
const hub = computed(() => node.value?.hub || null)
const ipv6PrefixHint = computed(() => {
  const pfx = node.value?.network?.ipv6Prefixes?.[0]
  if (!pfx) return null
  return `${pfx.prefix}/${pfx.prefixLen}`
})

const typeOptions = computed(() => {
  const fam = node.value?.family
  const out = []
  if (!fam || fam === 'dual' || fam === 'ipv4') out.push({ value: 'ipv4', label: 'IPv4' })
  if (!fam || fam === 'dual' || fam === 'ipv6') out.push({ value: 'ipv6', label: `IPv6 ${ipv6PrefixHint.value ? `(${ipv6PrefixHint.value})` : ''}` })
  return out
})

const proxyColumns = [
  { key: 'id', width: 230 },
  { key: 'endpoint' },
  { key: 'stats', width: 170 },
  { key: 'actions', width: 120, align: 'right' }
]
const proxyPagination = { pageSize: 20, hideOnSinglePage: true, size: 'small' }
function proxyRowClass(p) { return p.status === 'expired' || p.status === 'error' ? 'row-dim' : '' }
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-flex align="center" wrap="wrap" gap="small" class="head">
        <a-button @click="router.push('/my-nodes')">
          <template #icon><ArrowLeftOutlined /></template>
          {{ t('cust.nodeDetail.back') }}
        </a-button>
        <template v-if="node">
          <a-typography-title :level="4" class="node-title">{{ node.name }}</a-typography-title>
          <a-space wrap :size="6">
            <a-tag :color="node.family === 'ipv6' ? 'purple' : 'blue'" :bordered="false" class="mono">{{ (node.family || 'dual').toUpperCase() }}</a-tag>
            <StatusTag :status="node.status" />
            <a-tag v-if="node.tag === 'hub'" color="cyan" :bordered="false">HUB · {{ hub?.planName || hub?.planId }}</a-tag>
            <a-typography-text class="mono" :copyable="{ text: node.host }">{{ node.host }}</a-typography-text>
          </a-space>
        </template>
      </a-flex>
      <a-button :loading="refreshing" :disabled="busy" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('cust.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />

    <template v-if="node">
      <!-- KPI strip -->
      <a-row :gutter="[12, 12]">
        <a-col :xs="12" :md="6">
          <a-card size="small">
            <a-statistic :title="t('cust.nodeDetail.statProxies')" :value="totals.active" :suffix="`/ ${totals.count}`">
              <template #prefix><ApartmentOutlined /></template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small">
            <a-statistic :title="t('cust.nodeDetail.statConns')" :value="formatNumber(totals.conns)">
              <template #prefix><ThunderboltOutlined /></template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small">
            <a-statistic :title="t('cust.nodeDetail.statBandwidth')" :value="formatBytes(totals.bw)">
              <template #prefix><WifiOutlined /></template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small">
            <a-statistic :title="t('cust.nodeDetail.statAgent')" :value="`v${node.version || '—'}`" class="mono-stat">
              <template #prefix><DesktopOutlined /></template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]">
        <!-- LEFT: proxies + create form -->
        <a-col :xs="24" :lg="16">
          <a-flex vertical gap="middle">
            <a-card size="small">
              <template #title>
                <a-space :size="6" wrap>
                  <PlusOutlined />
                  <span>{{ t('cust.nodeDetail.createTitle') }}</span>
                  <a-typography-text type="secondary" class="small">{{ t('cust.nodeDetail.freeSmall') }}</a-typography-text>
                </a-space>
              </template>
              <a-form layout="vertical" :model="buyForm" @finish="createProxies">
                <a-row :gutter="12">
                  <a-col :xs="24" :sm="12">
                    <a-form-item :label="t('cust.buy.byon.typeLabel')">
                      <a-select v-model:value="buyForm.type" :options="typeOptions" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="12" :sm="6">
                    <a-form-item :label="t('cust.buy.quantity')">
                      <a-input-number v-model:value="buyForm.quantity" :min="1" :max="50" :precision="0" class="full-width" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="12" :sm="6">
                    <a-form-item :label="t('cust.buy.byon.durationDays')">
                      <a-input-number v-model:value="buyForm.durationDays" :min="1" :max="3650" :precision="0" class="full-width" />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
                  <a-checkbox v-if="buyForm.type === 'ipv6'" v-model:checked="buyForm.rotate">
                    {{ t('cust.nodeDetail.rotationPool') }}
                  </a-checkbox>
                  <span v-else />
                  <a-button type="primary" html-type="submit" :loading="buyBusy">
                    <template #icon><PlusOutlined /></template>
                    {{ buyBusy ? t('cust.buy.byon.creating') : t('cust.nodeDetail.createBtn', { n: buyForm.quantity }) }}
                  </a-button>
                </a-flex>
              </a-form>
            </a-card>

            <a-card size="small" :body-style="{ padding: 0 }">
              <template #title><ApartmentOutlined /> {{ t('cust.nodeDetail.proxiesTitle', { n: proxies.length }) }}</template>
              <a-table
                :columns="proxyColumns"
                :data-source="proxies"
                row-key="id"
                size="small"
                :show-header="false"
                :pagination="proxyPagination"
                :row-class-name="proxyRowClass"
                :scroll="{ x: 720 }"
                :locale="{ emptyText: t('cust.nodeDetail.emptyProxies') }"
              >
                <template #bodyCell="{ column, record: p }">
                  <template v-if="column.key === 'id'">
                    <a-space wrap :size="4">
                      <a-typography-text strong class="mono">{{ p.id }}</a-typography-text>
                      <StatusTag :status="p.status" />
                      <a-tag :color="p.type === 'IPv6' ? 'purple' : 'blue'" :bordered="false" class="mono">{{ p.type }}</a-tag>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'endpoint'">
                    <a-space wrap :size="4">
                      <span class="mono">{{ (p.ip || p.host) }}:{{ p.port }}</span>
                      <a-button size="small" @click="copyToClipboard(p.http || `http://${p.username}:${p.password}@${p.ip}:${p.port}`, p.id)">
                        <template #icon><CopyOutlined /></template>
                        http
                      </a-button>
                      <a-button size="small" @click="copyToClipboard(p.socks5 || `socks5://${p.username}:${p.password}@${p.ip}:${p.port}`, p.id + '-s5')">
                        <template #icon><CopyOutlined /></template>
                        socks5
                      </a-button>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'stats'">
                    <a-typography-text type="secondary" class="mono small">
                      conns: {{ p.stats?.activeConnections || 0 }} · bw: {{ formatBytes((p.stats?.uploadBytes || 0) + (p.stats?.downloadBytes || 0)) }}
                    </a-typography-text>
                  </template>
                  <template v-else-if="column.key === 'actions'">
                    <a-space :size="4">
                      <a-tooltip v-if="p.type === 'IPv6'" :title="t('cust.nodeDetail.tipRotateIp')">
                        <a-button size="small" @click="rotateProxy(p)"><template #icon><SyncOutlined /></template></a-button>
                      </a-tooltip>
                      <a-tooltip :title="t('cust.nodeDetail.healthCheck')">
                        <a-button size="small" @click="checkProxy(p)"><template #icon><SafetyCertificateOutlined /></template></a-button>
                      </a-tooltip>
                      <a-tooltip :title="t('cust.nodeDetail.del')">
                        <a-button size="small" danger @click="deleteProxy(p)"><template #icon><DeleteOutlined /></template></a-button>
                      </a-tooltip>
                    </a-space>
                  </template>
                </template>
              </a-table>
            </a-card>

            <!-- Hub-specific info (when this node is a rented hub VPS) -->
            <a-card v-if="isHub" size="small">
              <template #title><CloudServerOutlined /> {{ t('cust.nodeDetail.hubInfo') }}</template>
              <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2 }">
                <a-descriptions-item label="Plan">{{ hub.planName }}</a-descriptions-item>
                <a-descriptions-item label="VPS ID"><span class="mono">{{ hub.vpsid }}</span></a-descriptions-item>
                <a-descriptions-item :label="t('cust.nodeDetail.paid')">{{ hub.hoursPaid }} {{ t('cust.nodeDetail.hoursUnit') }}</a-descriptions-item>
                <a-descriptions-item :label="t('cust.nodeDetail.expires')"><span class="mono">{{ hub.expiresAt?.slice(0,16).replace('T',' ') }}</span></a-descriptions-item>
                <a-descriptions-item :label="t('cust.nodeDetail.status')">{{ hub.state || '—' }}</a-descriptions-item>
                <a-descriptions-item :label="t('cust.nodeDetail.price')">{{ Number(hub.hourlyPrice || 0).toLocaleString() }} {{ t('cust.nodeDetail.perHourUnit') }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-flex>
        </a-col>

        <!-- RIGHT: node info + actions -->
        <a-col :xs="24" :lg="8">
          <a-flex vertical gap="middle">
            <a-card size="small">
              <template #title><CloudServerOutlined /> {{ t('cust.nodeDetail.nodeInfo') }}</template>
              <a-descriptions size="small" :column="1" bordered>
                <a-descriptions-item label="Host">
                  <a-typography-text class="mono" :copyable="{ text: node.host }">{{ node.host }}</a-typography-text>
                </a-descriptions-item>
                <a-descriptions-item :label="t('nodes.family')">{{ (node.family || 'dual').toUpperCase() }}</a-descriptions-item>
                <a-descriptions-item label="Zone">{{ node.zone || node.region || '—' }}</a-descriptions-item>
                <a-descriptions-item label="Tag">{{ node.tag || 'byon' }}</a-descriptions-item>
                <a-descriptions-item label="Agent"><span class="mono">v{{ node.version || '—' }}</span></a-descriptions-item>
                <a-descriptions-item :label="t('cust.nodeDetail.dtLastSeen')"><span class="mono">{{ node.lastSeenAt?.slice(11,19) || '—' }}</span></a-descriptions-item>
              </a-descriptions>
              <a-collapse v-if="node.network" ghost class="net">
                <a-collapse-panel key="net" header="Network">
                  <a-flex vertical gap="small">
                    <div v-if="node.network.ipv4?.length">
                      <a-typography-text strong>IPv4:</a-typography-text>
                      <div class="net-list">
                        <a-tag v-for="ip in node.network.ipv4" :key="ip.address" class="mono">{{ ip.address }}</a-tag>
                      </div>
                    </div>
                    <div v-if="node.network.ipv6Prefixes?.length">
                      <a-typography-text strong>IPv6 prefixes:</a-typography-text>
                      <div class="net-list">
                        <a-tag v-for="p in node.network.ipv6Prefixes" :key="p.prefix" class="mono">{{ p.prefix }}/{{ p.prefixLen }}</a-tag>
                      </div>
                    </div>
                  </a-flex>
                </a-collapse-panel>
              </a-collapse>
            </a-card>

            <a-card size="small">
              <template #title><SafetyCertificateOutlined /> {{ t('cust.nodeDetail.actions') }}</template>
              <a-flex vertical gap="middle">
                <div>
                  <a-button block :disabled="busy" @click="toggleNode">
                    <template #icon><PlayCircleOutlined v-if="node.disabled" /><PauseCircleOutlined v-else /></template>
                    {{ node.disabled ? t('cust.nodeDetail.enableNode') : t('cust.nodeDetail.pauseNode') }}
                  </a-button>
                  <a-typography-text type="secondary" class="small action-hint">
                    {{ node.disabled ? t('cust.nodeDetail.agentResume') : t('cust.nodeDetail.agentPause') }}
                  </a-typography-text>
                </div>
                <div>
                  <a-button block danger :disabled="busy" @click="deleteNode">
                    <template #icon><DeleteOutlined /></template>
                    {{ t('cust.nodeDetail.deleteNode') }}
                  </a-button>
                  <a-typography-text type="secondary" class="small action-hint">{{ t('cust.nodeDetail.deleteNodeHint') }}</a-typography-text>
                </div>
              </a-flex>
            </a-card>
          </a-flex>
        </a-col>
      </a-row>
    </template>

    <a-spin v-else-if="!err" :tip="t('common.loading')">
      <div class="loading-box" />
    </a-spin>
  </div>
</template>

<style scoped>
.head { min-width: 0; }
.node-title { margin: 0 !important; }
.small { font-size: 12px; }
.mono-stat :deep(.ant-statistic-content) { font-family: var(--pb-mono); }
.net { margin-top: 8px; }
.net-list { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
.net-list :deep(.ant-tag) { margin-inline-end: 0; }
.action-hint { display: block; margin-top: 4px; }
.loading-box { height: 160px; }
:deep(.row-dim) { opacity: 0.55; }
</style>
