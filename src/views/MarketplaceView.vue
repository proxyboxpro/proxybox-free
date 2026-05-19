<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Network, Plus } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { createProxyOrder } from '../store/proxies'
import { nodesState, loadNodes } from '../store/nodes'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const type = ref('ipv4')
const quantity = ref(10)
const duration = ref(30)
const rotate = ref(false)
const nodeId = ref('local')
const balance = ref(false)
const ipv6Host = ref('')
const advanced = ref(false)
const maxConnections = ref(0)
const mbps = ref(0)        // 0 = unlimited; converted to bytes/sec
const monthlyGb = ref(0)   // 0 = unlimited; converted to bytes
const creating = ref(false)
const errorText = ref('')

const nodeOptions = computed(() => nodesState.nodes.filter((n) => n.id === 'local' || n.status === 'online'))
const selectedNode = computed(() => nodesState.nodes.find((n) => n.id === nodeId.value) || null)
const nodeIpv4Hosts = computed(() => {
  const list = selectedNode.value?.network?.ipv4 || []
  return list.map((e) => e.address)
})

onMounted(loadNodes)

function selectType(value) {
  type.value = value
  if (value !== 'ipv6') rotate.value = false
}

async function create() {
  if (creating.value) return
  errorText.value = ''
  creating.value = true
  try {
    const payload = {
      type: type.value,
      rotate: type.value === 'ipv6' && rotate.value,
      quantity: Math.max(1, Math.min(254, Number(quantity.value) || 1)),
      duration: Number(duration.value) || 30,
      maxConnections: Math.max(0, Number(maxConnections.value) || 0),
      bytesPerSec: Math.round(Math.max(0, Number(mbps.value) || 0) * 1_000_000),
      monthlyQuotaBytes: Math.round(Math.max(0, Number(monthlyGb.value) || 0) * 1_000_000_000)
    }
    if (balance.value) payload.balance = true
    else payload.nodeId = nodeId.value
    if (type.value === 'ipv6' && ipv6Host.value) payload.listenHost = ipv6Host.value
    await createProxyOrder(payload)
    router.push({ name: type.value === 'ipv6' ? 'proxies-ipv6' : 'proxies-ipv4' })
  } catch (error) {
    errorText.value = error.message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section class="page-stack">
    <section class="surface" style="max-width:560px">
      <div class="section-head">
        <h2>{{ t('market.choosePlan') }}</h2>
        <Network :size="18" />
      </div>

      <div class="segment-tabs compact" style="margin-bottom:16px">
        <button :class="{ active: type === 'ipv4' }" type="button" @click="selectType('ipv4')">IPv4</button>
        <button :class="{ active: type === 'ipv6' }" type="button" @click="selectType('ipv6')">IPv6</button>
      </div>

      <div class="form-grid">
        <label class="input-field"><span>{{ t('market.quantity') }}</span><input v-model.number="quantity" type="number" min="1" max="254" /></label>
        <label class="input-field">
          <span>{{ t('market.duration') }}</span>
          <select v-model.number="duration">
            <option :value="7">7 {{ t('duration.days') }}</option>
            <option :value="30">30 {{ t('duration.days') }}</option>
            <option :value="60">60 {{ t('duration.days') }}</option>
            <option :value="90">90 {{ t('duration.days') }}</option>
          </select>
        </label>
        <label class="input-field" style="grid-column:1/-1">
          <span>{{ t('market.node') }}</span>
          <select v-model="nodeId" :disabled="balance">
            <option v-for="n in nodeOptions" :key="n.id" :value="n.id">{{ n.name }} ({{ n.id === 'local' ? 'control plane' : n.host }})<span v-if="n.tag"> · {{ n.tag }}</span></option>
          </select>
        </label>
        <label class="check-line" style="grid-column:1/-1">
          <input v-model="balance" type="checkbox" />
          <span><strong style="color:var(--text)">{{ t('market.autoBalance') }}</strong><br>{{ t('market.autoBalanceHelp') }}</span>
        </label>
      </div>

      <label v-if="type === 'ipv6'" class="input-field" style="margin-bottom:12px">
        <span>{{ t('market.ipv6Host') }}</span>
        <select v-model="ipv6Host">
          <option value="">{{ t('market.ipv6HostAuto') }}</option>
          <option v-for="ip in nodeIpv4Hosts" :key="ip" :value="ip">{{ ip }}</option>
        </select>
        <small style="color:var(--muted); margin-top:4px; font-size:11.5px">{{ t('market.ipv6HostHelp') }}</small>
      </label>

      <label v-if="type === 'ipv6'" class="check-line" style="margin-bottom:12px">
        <input v-model="rotate" type="checkbox" />
        <span><strong style="color:var(--text)">{{ t('market.rotateIpv6') }}</strong><br>{{ t('market.rotateIpv6Help') }}</span>
      </label>

      <button class="text-mini" type="button" style="margin-bottom:8px" @click="advanced = !advanced">
        {{ advanced ? '▾' : '▸' }} {{ t('market.advanced') }}
      </button>
      <div v-if="advanced" class="form-grid" style="margin-bottom:8px">
        <label class="input-field"><span>{{ t('detail.maxConnections') }} (0 = ∞)</span><input v-model.number="maxConnections" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('detail.bandwidthLimit') }} MB/s (0 = ∞)</span><input v-model.number="mbps" type="number" min="0" step="0.5" /></label>
        <label class="input-field"><span>{{ t('detail.monthlyQuota') }} GB (0 = ∞)</span><input v-model.number="monthlyGb" type="number" min="0" /></label>
      </div>

      <p v-if="errorText" class="error-text">{{ errorText }}</p>
      <button class="primary-action" type="button" :disabled="creating" @click="create">
        <Plus :size="18" /> {{ creating ? t('market.creating') : t('market.createOrder') }}
      </button>
    </section>
  </section>
</template>
