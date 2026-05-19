<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Save, Server } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { fetchOrder, patchOrder } from '../store/proxies'
import { formatBytes, formatRate } from '../utils/format'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const order = ref(null)
const loading = ref(true)
const saving = ref(false)
const errorText = ref('')
const successMsg = ref('')

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
  saving.value = true; errorText.value = ''; successMsg.value = ''
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
    successMsg.value = `${t('orders.applyOk')} (${result.applied || members.value.length})`
  } catch (e) { errorText.value = e.message }
  finally { saving.value = false }
}

watch(orderId, load)
onMounted(load)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <button class="ghost-button" type="button" @click="router.push({ name: 'admin-orders' })"><ArrowLeft :size="15" /> {{ t('orders.backToList') }}</button>
    </div>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>
    <p v-if="loading && !order" class="empty-text">{{ t('common.loading') }}</p>

    <section v-if="order" class="surface">
      <div class="section-head">
        <h2>{{ t('orders.detail') }} · <span class="cell-mono">{{ order.id }}</span></h2>
        <span :class="['status-pill', order.status]">{{ order.status }}</span>
      </div>
      <div class="detail-grid">
        <div><span>{{ t('orders.product') }}</span><strong>{{ order.item }}</strong></div>
        <div><span>{{ t('orders.date') }}</span><strong>{{ order.date }}</strong></div>
        <div><span>{{ t('orders.members') }}</span><strong>{{ members.length }}</strong></div>
        <div><span>{{ t('detail.traffic') }} ↑/↓</span><strong class="cell-mono">{{ formatBytes(totalUp) }} / {{ formatBytes(totalDown) }}</strong></div>
        <div><span>{{ t('detail.monthUsage') }}</span><strong class="cell-mono">{{ formatBytes(totalMonth) }}</strong></div>
      </div>
    </section>

    <section v-if="order" class="surface">
      <div class="section-head">
        <h2>{{ t('orders.groupSettings') }}</h2>
        <span class="eyebrow">{{ t('orders.groupSettingsHint') }}</span>
      </div>
      <div class="form-grid">
        <label v-if="isIpv6Order" class="check-line" style="grid-column:1/-1">
          <input v-model="form.rotate" type="checkbox" />
          <span><strong style="color:var(--text)">{{ t('proxy.rotateOn') }}</strong> · {{ t('market.rotateIpv6Help') }}</span>
        </label>
        <label class="input-field"><span>{{ t('detail.maxConnections') }} (0 = ∞)</span><input v-model.number="form.maxConnections" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('detail.bandwidthLimit') }} MB/s (0 = ∞)</span><input v-model.number="form.mbps" type="number" min="0" step="0.5" /></label>
        <label class="input-field"><span>{{ t('detail.monthlyQuota') }} GB (0 = ∞)</span><input v-model.number="form.monthlyGb" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('orders.extendDays') }} (0 = {{ t('common.noChange') }})</span><input v-model.number="form.durationDays" type="number" min="0" /></label>
      </div>
      <p v-if="successMsg" style="color:#15803d; font-size:13px">{{ successMsg }}</p>
      <button class="primary-action" type="button" :disabled="saving" @click="applyAll"><Save :size="16" /> {{ saving ? t('common.loading') : t('orders.applyGroup') }}</button>
    </section>

    <section v-if="members.length" class="surface">
      <div class="section-head"><h2><Server :size="16" style="vertical-align:-3px" /> {{ t('orders.members') }} ({{ members.length }})</h2></div>
      <div class="data-table">
        <div class="table-head" style="grid-template-columns:1fr 1.6fr 0.8fr 0.8fr auto">
          <span>{{ t('orders.id') }}</span>
          <span>{{ t('detail.endpoint') }}</span>
          <span>{{ t('detail.bandwidthLimit') }}</span>
          <span>{{ t('detail.monthlyQuota') }}</span>
          <span>{{ t('orders.status') }}</span>
        </div>
        <div v-for="p in members" :key="p.id" class="table-row" style="grid-template-columns:1fr 1.6fr 0.8fr 0.8fr auto">
          <span class="cell-mono">{{ p.id }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}<span v-if="p.mode === 'rotating'" class="tag rotating" style="margin-left:6px">rot</span></span>
          <span>{{ formatRate(p.bytesPerSec) || '∞' }}</span>
          <span>{{ p.monthlyQuotaBytes ? formatBytes(p.monthlyQuotaBytes) : '∞' }}</span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
      </div>
    </section>
  </section>
</template>
