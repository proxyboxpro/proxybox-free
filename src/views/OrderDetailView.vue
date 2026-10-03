<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { fetchOrder, patchOrder } from '../store/proxies'
import { formatBytes, formatRate } from '../utils/format'
import { message } from '../ui/feedback'
import StatusTag from '../components/ui/StatusTag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const order = ref(null)
const loading = ref(true)
const saving = ref(false)
const errorText = ref('')

const form = reactive({
  rotate: false,
  maxConnections: 0,
  mbps: 0,
  monthlyGb: 0,
  durationDays: 0
})

const orderId = computed(() => route.params.orderId)
const members = computed(() => order.value?.proxies || [])
const isIpv6Order = computed(() => members.value.some((p) => (p.type || '').toLowerCase() === 'ipv6'))
const totalMonth = computed(() => members.value.reduce((a, p) => a + (p.stats?.monthBytes || 0), 0))
const totalUp = computed(() => members.value.reduce((a, p) => a + (p.stats?.uploadBytes || 0), 0))
const totalDown = computed(() => members.value.reduce((a, p) => a + (p.stats?.downloadBytes || 0), 0))

const memberColumns = computed(() => [
  { key: 'id', title: t('orders.id') },
  { key: 'endpoint', title: t('detail.endpoint') },
  { key: 'rate', title: t('detail.bandwidthLimit'), align: 'right' },
  { key: 'quota', title: t('detail.monthlyQuota'), align: 'right' },
  { key: 'status', title: t('orders.status'), width: 120 }
])

async function load() {
  loading.value = true; errorText.value = ''
  try {
    order.value = await fetchOrder(orderId.value)
    // seed form from majority/current values
    const first = order.value.proxies?.[0]
    if (first) {
      form.rotate = Boolean(first.rotate)
      form.maxConnections = first.maxConnections || 0
      form.mbps = first.bytesPerSec ? Number((first.bytesPerSec / 1_000_000).toFixed(2)) : 0
      form.monthlyGb = first.monthlyQuotaBytes ? Number((first.monthlyQuotaBytes / 1_000_000_000).toFixed(2)) : 0
    }
  } catch (e) { errorText.value = e.message; order.value = null }
  finally { loading.value = false }
}

async function applyAll() {
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      rotate: form.rotate,
      maxConnections: Math.max(0, Number(form.maxConnections) || 0),
      bytesPerSec: Math.round(Math.max(0, Number(form.mbps) || 0) * 1_000_000),
      monthlyQuotaBytes: Math.round(Math.max(0, Number(form.monthlyGb) || 0) * 1_000_000_000)
    }
    if (form.durationDays && Number(form.durationDays) > 0) body.durationDays = Number(form.durationDays)
    const result = await patchOrder(orderId.value, body)
    order.value = result
    message.success(`${t('orders.applyOk')} (${result.applied || members.value.length})`)
  } catch (e) { message.error(e.message) }
  finally { saving.value = false }
}

watch(orderId, load)
onMounted(load)
</script>

<template>
  <div class="page">
    <a-flex>
      <a-button @click="router.push({ name: 'admin-orders' })">
        <template #icon><ArrowLeftOutlined /></template>
        {{ t('orders.backToList') }}
      </a-button>
    </a-flex>

    <a-alert v-if="errorText" type="error" show-icon :message="errorText" />
    <a-card v-if="loading && !order" loading />

    <a-card v-if="order">
      <template #title>
        {{ t('orders.detail') }} · <span class="mono">{{ order.id }}</span>
      </template>
      <template #extra><StatusTag :status="order.status" /></template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">
        <a-descriptions-item :label="t('orders.product')">{{ order.item }}</a-descriptions-item>
        <a-descriptions-item :label="t('orders.date')"><span class="mono">{{ order.date }}</span></a-descriptions-item>
        <a-descriptions-item :label="t('orders.members')">{{ members.length }}</a-descriptions-item>
        <a-descriptions-item :label="`${t('detail.traffic')} ↑/↓`">
          <span class="mono">{{ formatBytes(totalUp) }} / {{ formatBytes(totalDown) }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('detail.monthUsage')">
          <span class="mono">{{ formatBytes(totalMonth) }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card v-if="order" :title="t('orders.groupSettings')">
      <a-typography-paragraph type="secondary">{{ t('orders.groupSettingsHint') }}</a-typography-paragraph>
      <a-form layout="vertical" :model="form" @finish="applyAll">
        <a-form-item v-if="isIpv6Order">
          <a-checkbox v-model:checked="form.rotate">
            <strong>{{ t('proxy.rotateOn') }}</strong> · <a-typography-text type="secondary">{{ t('market.rotateIpv6Help') }}</a-typography-text>
          </a-checkbox>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="`${t('detail.maxConnections')} (0 = ∞)`">
              <a-input-number v-model:value="form.maxConnections" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="`${t('detail.bandwidthLimit')} MB/s (0 = ∞)`">
              <a-input-number v-model:value="form.mbps" :min="0" :step="0.5" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="`${t('detail.monthlyQuota')} GB (0 = ∞)`">
              <a-input-number v-model:value="form.monthlyGb" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="`${t('orders.extendDays')} (0 = ${t('common.noChange')})`">
              <a-input-number v-model:value="form.durationDays" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="saving">
          <template #icon><SaveOutlined /></template>
          {{ saving ? t('common.loading') : t('orders.applyGroup') }}
        </a-button>
      </a-form>
    </a-card>

    <a-card v-if="members.length" :body-style="{ padding: 0 }">
      <template #title>
        <CloudServerOutlined /> {{ t('orders.members') }} ({{ members.length }})
      </template>
      <a-table
        :columns="memberColumns"
        :data-source="members"
        row-key="id"
        size="middle"
        :scroll="{ x: 760 }"
        :pagination="{ pageSize: 50, hideOnSinglePage: true }"
      >
        <template #bodyCell="{ column, record: p }">
          <template v-if="column.key === 'id'"><span class="mono">{{ p.id }}</span></template>
          <template v-else-if="column.key === 'endpoint'">
            <a-space :size="6">
              <a-typography-text class="mono" :copyable="{ text: `${p.ip || p.bindIp}:${p.port}` }">{{ p.ip || p.bindIp }}:{{ p.port }}</a-typography-text>
              <a-tag v-if="p.mode === 'rotating'" color="purple" :bordered="false">rot</a-tag>
            </a-space>
          </template>
          <template v-else-if="column.key === 'rate'"><span class="mono">{{ formatRate(p.bytesPerSec) || '∞' }}</span></template>
          <template v-else-if="column.key === 'quota'"><span class="mono">{{ p.monthlyQuotaBytes ? formatBytes(p.monthlyQuotaBytes) : '∞' }}</span></template>
          <template v-else-if="column.key === 'status'"><StatusTag :status="p.status" /></template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>
