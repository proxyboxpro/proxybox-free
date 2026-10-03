<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CloudServerOutlined, DeploymentUnitOutlined, GlobalOutlined, ShoppingCartOutlined, CloudOutlined
} from '@ant-design/icons-vue'
import { Empty } from 'ant-design-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'
import CountryFlag from '../../components/CountryFlag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// Source mode: 'pool' = buy proxy from system pool (paid).
//               'byon' = use customer's own node (free).
//               'hub'  = rent VPS hub from us (paid hourly, agent auto-installed).
const sourceMode = ref('pool')
const sourceOptions = [
  { id: 'pool', icon: ShoppingCartOutlined, titleKey: 'cust.buy.src.poolTitle', subKey: 'cust.buy.src.poolSub' },
  { id: 'hub', icon: CloudOutlined, titleKey: 'cust.buy.src.hubTitle', subKey: 'cust.buy.src.hubSub', badge: 'PRO', badgeColor: 'cyan' },
  { id: 'byon', icon: DeploymentUnitOutlined, titleKey: 'cust.buy.src.byonTitle', subKey: 'cust.buy.src.byonSub', badge: 'FREE', badgeColor: 'green' }
]
const byonNodes = ref([])
const byonForm = ref({ nodeId: '', type: 'ipv6', quantity: 1, rotate: false, durationDays: 365 })
const byonBusy = ref(false)

// Hub plans (rentable VPS, auto-installs agent). Zone-first flow: customer
// picks zone (= Virtualizor instance region) → list of plans in that zone → buy.
const hubPlans = ref([])
const hubZones = ref([])
const hubForm = ref({ zone: '', planId: '', hours: 24 })
const hubBusy = ref(false)
async function loadHubPlans() {
  try {
    hubZones.value = await apiFetch('/api/v1/user/hub-zones').catch(() => [])
    hubPlans.value = await apiFetch('/api/v1/user/hub-plans').catch(() => [])
    if (hubZones.value.length && !hubForm.value.zone) hubForm.value.zone = hubZones.value[0].id
  } catch { hubPlans.value = []; hubZones.value = [] }
}
const hubPlansForZone = computed(() => hubPlans.value.filter((p) => p.region === hubForm.value.zone))
const selectedHubPlan = computed(() => hubPlans.value.find((p) => p.id === hubForm.value.planId) || null)
const hubCost = computed(() => Math.ceil((Number(hubForm.value.hours) || 0) * (selectedHubPlan.value?.hourlyPrice || 0)))
function pickHubZone(zoneId) {
  hubForm.value.zone = zoneId
  hubForm.value.planId = ''
}
function pickHubPlan(plan) {
  hubForm.value.planId = plan.id
  // Auto-clamp hours into plan limits
  hubForm.value.hours = Math.max(plan.minHours || 1, Math.min(plan.maxHours || 720, hubForm.value.hours))
}
async function placeHubOrder() {
  if (hubBusy.value) return
  if (!hubForm.value.planId) { fail(t('cust.buy.hub.pickPlanErr')); return }
  hubBusy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/hubs/buy', { method: 'POST', body: hubForm.value })
    message.success(t('cust.buy.hub.provisioned', { hint: r.hint || 'Hub provisioned', cost: r.totalCost?.toLocaleString() || '' }))
    setTimeout(() => router.push('/my-nodes'), 1800)
  } catch (e) { fail(e.message) }
  finally { hubBusy.value = false }
}
async function loadByon() {
  try { byonNodes.value = (await apiFetch('/api/v1/user/nodes')) || [] }
  catch { byonNodes.value = [] }
  if (byonNodes.value.length && !byonForm.value.nodeId) byonForm.value.nodeId = byonNodes.value[0].id
}
const selectedByonNode = computed(() => byonNodes.value.find((n) => n.id === byonForm.value.nodeId) || null)
const byonNodeOptions = computed(() => byonNodes.value.map((n) => ({
  value: n.id,
  label: `${n.name} — ${n.host} (${(n.family || 'dual').toUpperCase()}) · ${n.status}`
})))
async function placeFreeOrder() {
  if (byonBusy.value) return
  if (!byonForm.value.nodeId) { fail(t('cust.buy.byon.noNodeErr')); return }
  byonBusy.value = true; err.value = ''
  try {
    const body = { ...byonForm.value }
    if (selectedByonNode.value?.family && selectedByonNode.value.family !== 'dual') body.type = selectedByonNode.value.family
    const r = await apiFetch('/api/v1/user/proxies/from-own-node', { method: 'POST', body })
    message.success(t('cust.buy.byon.created', { count: r.count, node: selectedByonNode.value?.name || r.nodeId }))
    setTimeout(() => router.push({ name: 'proxies' }), 1500)
  } catch (e) { fail(e.message) }
  finally { byonBusy.value = false }
}

const pricing = ref(null)   // { currency, ipv4:{perHour}, ipv6:{perHour}, minHours, maxHours, tiers:[{min,discount}] }
const zones = ref([])       // [{ id, name, flag, timezone, onlineNodes }]
const account = ref(null)
const grants = ref([])   // active scoped free-credit grants for this user
const busy = ref(false)
const err = ref('')
// Action failures: toast + keep the inline a-alert, which carries the "Top up now" shortcut.
function fail(msg) { err.value = msg; message.error(msg) }

const form = ref({
  type: 'ipv4',          // 'ipv4' | 'ipv6'  — ONLY shape backend accepts
  zone: '',              // backend zone slug; required (defaults to first VN zone once zones load)
  rotate: false,         // only meaningful when type === 'ipv6'
  hours: 24,
  quantity: 1,
  autoRenew: false
})

// Pick a sensible default zone after zones load: prefer first online VN zone,
// else first online zone of any country. Customer must always have one selected.
function pickDefaultZone() {
  const onlineVN = zones.value.find((z) => z.id.startsWith('vn-') && (z.onlineNodes ?? 0) > 0)
  if (onlineVN) return onlineVN.id
  const anyOnline = zones.value.find((z) => (z.onlineNodes ?? 0) > 0)
  if (anyOnline) return anyOnline.id
  return zones.value[0]?.id || ''
}

async function refresh() {
  try {
    pricing.value = await apiFetch('/api/v1/user/pricing')
    zones.value = await apiFetch('/api/v1/user/zones').catch(() => [])
    account.value = await apiFetch('/api/v1/user/account')
    grants.value = await apiFetch('/api/v1/user/credit-grants').catch(() => [])
    // clamp hours to backend min/max once pricing loads
    if (pricing.value) {
      form.value.hours = Math.min(Math.max(form.value.hours, pricing.value.minHours || 1), pricing.value.maxHours || 8760)
    }
    // Auto-balance was removed — pick first VN zone as default if nothing chosen yet.
    if (!form.value.zone) form.value.zone = pickDefaultZone()
  } catch (e) { err.value = e.message }
}

// 2 real product types backed by the API. Cards stay visual but pricing is honest.
const productTypes = computed(() => {
  if (!pricing.value) return []
  return [
    { id: 'ipv4', color: 'blue',  icon: CloudServerOutlined, labelKey: 'cust.buy.t.ipv4', subKey: 'cust.buy.t.ipv4Sub', perHour: Number(pricing.value.ipv4?.perHour || 0), backendType: 'ipv4' },
    { id: 'ipv6', color: 'green', icon: GlobalOutlined,      labelKey: 'cust.buy.t.ipv6', subKey: 'cust.buy.t.ipv6Sub', perHour: Number(pricing.value.ipv6?.perHour || 0), backendType: 'ipv6' }
  ]
})

const selectedProduct = computed(() => productTypes.value.find((p) => p.id === form.value.type) || productTypes.value[0] || null)
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const minHours = computed(() => Number(pricing.value?.minHours || 1))
const maxHours = computed(() => Number(pricing.value?.maxHours || 8760))
const methodOptions = computed(() => [
  { label: t('cust.buy.sticky'), value: false },
  { label: `${t('cust.buy.rotating')} — ${t('cust.buy.rotatingSub')}`, value: true }
])

// Hour presets matching backend hours-based pricing
const hourPresets = [
  { hours: 1,   labelKey: 'cust.buy.h.1h' },
  { hours: 6,   labelKey: 'cust.buy.h.6h' },
  { hours: 24,  labelKey: 'cust.buy.h.1d' },
  { hours: 72,  labelKey: 'cust.buy.h.3d' },
  { hours: 168, labelKey: 'cust.buy.h.7d' },
  { hours: 720, labelKey: 'cust.buy.h.30d' }
]
const quantityPresets = [1, 5, 10, 20, 50, 100]

// Resolve a country code (or partial slug) into a real backend zone id.
// Sidebar passes `?country=VN` etc., but the backend's zones are slugs like
// `vn-hcm`, `us-east`, `de-fra`. Pick the first zone matching the prefix that
// still has online nodes; fall back to '' (auto-balance) if nothing fits.
function resolveZone(input) {
  if (!input) return ''
  const wanted = String(input).toLowerCase()
  if (wanted === 'global') return ''
  // exact match (already a real zone id)
  const exact = zones.value.find((z) => z.id === wanted)
  if (exact) return exact.id
  // prefix match (country code → first online zone in that country)
  const prefix = wanted.length === 2 ? `${wanted}-` : wanted
  const online = zones.value
    .filter((z) => z.id.startsWith(prefix) && (z.onlineNodes ?? 0) > 0)
    .sort((a, b) => (b.onlineNodes || 0) - (a.onlineNodes || 0))
  if (online.length) return online[0].id
  // no online node in this country → return '' so backend auto-balances
  const anyMatch = zones.value.find((z) => z.id.startsWith(prefix))
  return anyMatch ? anyMatch.id : ''
}
function applyQuery() {
  // source=hub → jump straight to Mua Hub tab
  const src = String(route.query.source || '').toLowerCase()
  if (src === 'hub')  sourceMode.value = 'hub'
  if (src === 'byon') sourceMode.value = 'byon'
  if (src === 'pool') sourceMode.value = 'pool'

  const q = String(route.query.type || '').toLowerCase()
  if (q === 'ipv4' || q === 'ipv6') form.value.type = q
  else if (q === 'residential' || q === 'datacenter') form.value.type = 'ipv4'
  else if (q === 'mobile' || q === 'isp') form.value.type = 'ipv6'

  if (route.query.country) form.value.zone = resolveZone(route.query.country)
}
watch(() => route.query, applyQuery)
// Re-resolve once zones load (sidebar may have been clicked before zones fetched)
watch(zones, () => { if (route.query.country && !form.value.zone) form.value.zone = resolveZone(route.query.country) })

function selectType(id) { form.value.type = id }
function setQuantity(n) { form.value.quantity = Math.max(1, Math.min(254, Number(n) || 1)) }
function setHours(h) { form.value.hours = Math.max(minHours.value, Math.min(maxHours.value, Number(h) || 1)) }

// Pricing math — mirrors backend logic in handleCreateOrder + tiers
const perHour = computed(() => selectedProduct.value?.perHour || 0)
const base = computed(() => perHour.value * form.value.hours * form.value.quantity)
const tierDiscount = computed(() => {
  const tiers = (pricing.value?.tiers || [])
    .filter((tier) => form.value.quantity >= (tier.min || 0))
    .sort((a, b) => (b.min || 0) - (a.min || 0))
  return tiers[0]?.discount || 0
})
const discountAmount = computed(() => Math.round(base.value * tierDiscount.value))
const total = computed(() => Math.max(0, Math.round(base.value - discountAmount.value)))
const balance = computed(() => Number(account.value?.balance || 0))
// Scoped free-credit applicable to the selected product type (group match or 'all').
const applicableCredit = computed(() => grants.value
  .filter((g) => g.group === 'all' || g.group === form.value.type)
  .reduce((s, g) => s + Number(g.remaining || 0), 0))
const creditApplied = computed(() => Math.min(total.value, applicableCredit.value))
const walletNeeded = computed(() => Math.max(0, total.value - creditApplied.value))
const canAfford = computed(() => balance.value >= walletNeeded.value)

const selectedZoneInfo = computed(() => {
  if (!form.value.zone) return null
  return zones.value.find((z) => z.id === form.value.zone) || null
})
const selectedCountryCode = computed(() => (form.value.zone || '').slice(0, 2).toUpperCase() || 'GLOBAL')

// Each zone is one clickable card showing flag + name + node count.
// Auto-balance card was removed — customer must pick a real zone explicitly.
const zoneCards = computed(() => zones.value.map((z) => ({
  id: z.id,
  name: z.name,
  sub: z.timezone || '',
  flag: (z.flag || z.id.slice(0, 2)).toUpperCase(),
  online: z.onlineNodes ?? 0,
  comingSoon: (z.onlineNodes ?? 0) === 0
})))
function selectZoneCard(card) {
  if (card.comingSoon) return
  form.value.zone = card.id
}

async function placeOrder() {
  if (busy.value) return
  if (!selectedProduct.value) { fail(t('cust.buy.errNoPricing')); return }
  // Auto-balance was removed — zone must be a real, loaded zone id.
  if (!form.value.zone || !zones.value.some((z) => z.id === form.value.zone)) {
    fail(t('cust.buy.errNoZone'))
    return
  }
  busy.value = true; err.value = ''
  try {
    const safeZone = form.value.zone
    const body = {
      type: selectedProduct.value.backendType,
      quantity: form.value.quantity,
      hours: form.value.hours,
      zone: safeZone,
      rotate: form.value.type === 'ipv6' && form.value.rotate,
      autoRenew: form.value.autoRenew
    }
    const r = await apiFetch('/api/v1/user/orders', { method: 'POST', body })
    message.success(t('cust.buy.success', { id: r.order?.id || '' }))
    // Orders page was removed in the /proxies refactor — proxy groups now live
    // inside /proxies (route name 'proxy-order'). The old 'order-detail' name no
    // longer resolves, so pushing it threw and the buyer was never redirected.
    const orderId = r.order?.id
    setTimeout(() => router.push(orderId ? { name: 'proxy-order', params: { orderId } } : { name: 'proxies' }), 1200)
  } catch (e) { fail(e.message) }
  finally { busy.value = false }
}
function goTopup() { router.push({ name: 'billing' }) }
function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') }
// Summary rows: label left, value right-aligned.
const kvContent = { justifyContent: 'flex-end', textAlign: 'right' }
const totalStyle = { color: 'var(--pb-primary)', fontFamily: 'var(--pb-mono)', fontWeight: 700 }
const simpleEmpty = Empty.PRESENTED_IMAGE_SIMPLE

onMounted(async () => { await refresh(); applyQuery(); loadByon(); loadHubPlans() })
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.buy.subtitle') }}</a-typography-text>

    <!-- Source switcher: pool (paid) vs hub (rent VPS) vs own node (free) -->
    <a-row :gutter="[12, 12]" role="radiogroup">
      <a-col v-for="s in sourceOptions" :key="s.id" :xs="24" :md="8">
        <a-card
          size="small"
          hoverable
          class="choice"
          :class="{ 'is-selected': sourceMode === s.id }"
          role="radio"
          tabindex="0"
          :aria-checked="sourceMode === s.id"
          @click="sourceMode = s.id"
          @keydown.enter.space.prevent="sourceMode = s.id"
        >
          <a-flex align="center" gap="middle">
            <a-avatar shape="square" :size="40" class="ico ico-green">
              <template #icon><component :is="s.icon" /></template>
            </a-avatar>
            <div class="choice-text">
              <span class="choice-title">
                <a-typography-text strong>{{ t(s.titleKey) }}</a-typography-text>
                <a-tag v-if="s.badge" :color="s.badgeColor" :bordered="false" class="mini-tag">{{ s.badge }}</a-tag>
              </span>
              <a-typography-text type="secondary" class="choice-sub">{{ t(s.subKey) }}</a-typography-text>
            </div>
          </a-flex>
          <CheckCircleFilled v-if="sourceMode === s.id" class="choice-check" />
        </a-card>
      </a-col>
    </a-row>

    <a-alert v-if="err" type="error" show-icon closable :message="err" @close="err = ''">
      <template v-if="/balance|insufficient/i.test(err)" #action>
        <a-button size="small" type="primary" @click="goTopup">{{ t('cust.detail.topupNow') }}</a-button>
      </template>
    </a-alert>

    <!-- ── HUB branch: rent VPS hub from us (paid hourly, auto-installed) ── -->
    <a-row v-if="sourceMode === 'hub'" :gutter="[16, 16]">
      <a-col :xs="24" :lg="15" :xl="16">
        <a-flex vertical gap="middle">
          <!-- 1. ZONE selector — derived from admin's Virtualizor instances -->
          <a-card>
            <template #title>
              <span class="step-title"><a-avatar :size="22" class="step-num">1</a-avatar><EnvironmentOutlined /> {{ t('cust.buy.hub.stepZone') }}</span>
            </template>
            <template #extra><a-typography-text type="secondary" class="step-help">{{ t('cust.buy.hub.stepZoneHelp') }}</a-typography-text></template>
            <a-empty v-if="!hubZones.length" :image="simpleEmpty" :description="t('cust.buy.hub.noPlans')" />
            <a-row v-else :gutter="[10, 10]" role="radiogroup">
              <a-col v-for="z in hubZones" :key="z.id" :xs="24" :sm="12" :md="8" :xxl="6">
                <a-card
                  size="small"
                  hoverable
                  class="choice"
                  :class="{ 'is-selected': hubForm.zone === z.id }"
                  role="radio"
                  tabindex="0"
                  :aria-checked="hubForm.zone === z.id"
                  @click="pickHubZone(z.id)"
                  @keydown.enter.space.prevent="pickHubZone(z.id)"
                >
                  <a-flex align="center" gap="small">
                    <CountryFlag :code="z.flag" :size="28" />
                    <div class="choice-text">
                      <a-typography-text strong class="choice-title">{{ z.name }}</a-typography-text>
                      <a-typography-text type="secondary" class="choice-sub mono one-line">{{ z.planCount }} plan · {{ z.sub }}</a-typography-text>
                    </div>
                  </a-flex>
                  <CheckCircleFilled v-if="hubForm.zone === z.id" class="choice-check" />
                </a-card>
              </a-col>
            </a-row>
          </a-card>

          <!-- 2. PLAN cards filtered by selected zone -->
          <a-card v-if="hubPlansForZone.length">
            <template #title>
              <span class="step-title"><a-avatar :size="22" class="step-num">2</a-avatar><CloudOutlined /> {{ t('cust.buy.hub.stepConfig') }}</span>
            </template>
            <template #extra><a-typography-text type="secondary" class="step-help">{{ t('cust.buy.hub.stepConfigHelp') }}</a-typography-text></template>
            <a-row :gutter="[12, 12]" role="radiogroup">
              <a-col v-for="p in hubPlansForZone" :key="p.id" :xs="24" :sm="12" :xl="8">
                <a-card
                  size="small"
                  hoverable
                  class="choice"
                  :class="{ 'is-selected': hubForm.planId === p.id }"
                  role="radio"
                  tabindex="0"
                  :aria-checked="hubForm.planId === p.id"
                  @click="pickHubPlan(p)"
                  @keydown.enter.space.prevent="pickHubPlan(p)"
                >
                  <a-flex vertical gap="small">
                    <a-flex align="center" gap="middle">
                      <a-avatar shape="square" :size="44" :class="['ico', p.family === 'ipv6' ? 'ico-purple' : 'ico-blue']">
                        <template #icon><CloudOutlined /></template>
                      </a-avatar>
                      <div class="choice-text">
                        <a-typography-text strong class="choice-title">{{ p.name }}</a-typography-text>
                        <span>
                          <a-tag :color="p.family === 'ipv6' ? 'purple' : 'blue'" :bordered="false" class="mini-tag">Proxy Hub {{ p.family.toUpperCase() }}</a-tag>
                          <a-typography-text type="secondary" class="choice-sub">· {{ p.region }}</a-typography-text>
                        </span>
                      </div>
                    </a-flex>
                    <a-typography-text v-if="p.description" type="secondary" class="small-text"><CheckOutlined class="ok-ico" /> {{ p.description }}</a-typography-text>
                    <a-row :gutter="[12, 2]" class="small-text">
                      <a-col :span="12"><strong class="mono">{{ p.specs.cpu }}</strong> vCPU</a-col>
                      <a-col :span="12"><strong class="mono">{{ p.specs.ramGB }}</strong> GB RAM</a-col>
                      <a-col :span="12"><strong class="mono">{{ p.specs.diskGB }}</strong> GB Disk</a-col>
                      <a-col v-if="p.specs.bandwidthGB" :span="12"><strong class="mono">{{ p.specs.bandwidthGB }}</strong> GB BW/m</a-col>
                      <a-col v-if="p.specs.ipv4Count" :span="12"><strong class="mono">{{ p.specs.ipv4Count }}</strong> IPv4</a-col>
                      <a-col v-if="p.specs.ipv6Range" :span="12"><strong class="mono">{{ p.specs.ipv6Range }}</strong> IPv6</a-col>
                    </a-row>
                    <div class="price">
                      <a-typography-text type="secondary">{{ t('cust.product.from') }}</a-typography-text>
                      <strong class="mono price-val">{{ Number(p.hourlyPrice).toLocaleString() }}</strong>
                      <a-typography-text type="secondary" class="small-text">{{ p.currency }} {{ t('cust.buy.hub.perHour') }}</a-typography-text>
                    </div>
                  </a-flex>
                  <CheckCircleFilled v-if="hubForm.planId === p.id" class="choice-check" />
                </a-card>
              </a-col>
            </a-row>
          </a-card>
          <a-card v-else-if="hubForm.zone">
            <a-empty :image="simpleEmpty" :description="t('cust.buy.hub.zoneNoPlan', { zone: hubForm.zone })" />
          </a-card>
        </a-flex>
      </a-col>

      <!-- RIGHT: hours + total + buy -->
      <a-col :xs="24" :lg="9" :xl="8">
        <div class="aside">
          <a-card>
            <template #title><ClockCircleOutlined /> {{ t('cust.buy.hub.hoursLabel') }}</template>
            <a-flex vertical gap="middle">
              <a-input-number
                v-model:value="hubForm.hours"
                :min="selectedHubPlan?.minHours || 1"
                :max="selectedHubPlan?.maxHours || 720"
                size="large"
                class="mono full-width"
              />
              <template v-if="selectedHubPlan">
                <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent" class="summary">
                  <a-descriptions-item label="Plan">{{ selectedHubPlan.name }}</a-descriptions-item>
                  <a-descriptions-item :label="t('cust.buy.hub.pricePerHour')">
                    <span class="mono">{{ Number(selectedHubPlan.hourlyPrice).toLocaleString() }} {{ selectedHubPlan.currency }}</span>
                  </a-descriptions-item>
                  <a-descriptions-item :label="t('cust.buy.hub.numHours')"><span class="mono">{{ hubForm.hours }}</span></a-descriptions-item>
                </a-descriptions>
                <a-statistic :title="t('cust.buy.hub.total')" :value="hubCost" :suffix="selectedHubPlan.currency" :value-style="totalStyle">
                  <template #formatter="{ value }">{{ Number(value).toLocaleString() }}</template>
                </a-statistic>
              </template>
              <a-button type="primary" size="large" block :loading="hubBusy" :disabled="!hubForm.planId" @click="placeHubOrder">
                <template #icon><PlusOutlined /></template>
                {{ hubBusy ? t('cust.buy.hub.creating') : (hubForm.planId ? t('cust.buy.hub.rentBtn', { cost: Number(hubCost).toLocaleString(), currency: selectedHubPlan?.currency || 'VND' }) : t('cust.buy.hub.pickPlan')) }}
              </a-button>
              <a-typography-text type="secondary" class="small-text html-note"><span v-html="t('cust.buy.hub.note')"></span></a-typography-text>
            </a-flex>
          </a-card>
        </div>
      </a-col>
    </a-row>

    <!-- ── BYON branch: free creation on customer's own node ── -->
    <a-card v-if="sourceMode === 'byon'">
      <a-empty v-if="!byonNodes.length" :image="simpleEmpty">
        <template #description>
          <a-flex vertical gap="small" class="html-note byon-empty">
            <a-typography-text strong>{{ t('cust.buy.byon.noNodes') }}</a-typography-text>
            <a-typography-text><span v-html="t('cust.buy.byon.noNodesHint')"></span></a-typography-text>
            <a-typography-text type="secondary" class="small-text"><span v-html="t('cust.buy.byon.freeNote')"></span></a-typography-text>
          </a-flex>
        </template>
      </a-empty>
      <a-form v-else layout="vertical" :model="byonForm">
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item label="Node">
              <a-select v-model:value="byonForm.nodeId" :options="byonNodeOptions" class="mono" />
            </a-form-item>
          </a-col>
          <a-col v-if="selectedByonNode && selectedByonNode.family === 'dual'" :xs="24" :md="12">
            <a-form-item :label="t('cust.buy.byon.typeLabel')">
              <a-select v-model:value="byonForm.type">
                <a-select-option value="ipv4">IPv4</a-select-option>
                <a-select-option value="ipv6">IPv6 (rotating pool)</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('cust.buy.quantity')">
              <a-input-number v-model:value="byonForm.quantity" :min="1" :max="20" class="mono full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('cust.buy.byon.durationDays')">
              <a-input-number v-model:value="byonForm.durationDays" :min="1" :max="3650" class="mono full-width" />
            </a-form-item>
          </a-col>
          <a-col v-if="byonForm.type === 'ipv6' || selectedByonNode?.family === 'ipv6'" :span="24">
            <a-form-item>
              <a-checkbox v-model:checked="byonForm.rotate">{{ t('cust.buy.byon.rotationPool') }}</a-checkbox>
            </a-form-item>
          </a-col>
        </a-row>
        <a-flex vertical gap="small" align="flex-start">
          <a-button type="primary" size="large" :loading="byonBusy" :disabled="!byonForm.nodeId" @click="placeFreeOrder">
            <template #icon><PlusOutlined /></template>
            {{ byonBusy ? t('cust.buy.byon.creating') : t('cust.buy.byon.createBtn', { n: byonForm.quantity }) }}
          </a-button>
          <a-typography-text type="secondary" class="small-text html-note"><span v-html="t('cust.buy.byon.note', { n: byonForm.quantity })"></span></a-typography-text>
        </a-flex>
      </a-form>
    </a-card>

    <a-card v-if="!pricing && sourceMode === 'pool'">
      <a-flex justify="center" align="center" gap="small" class="loading-box">
        <a-spin />
        <a-typography-text type="secondary">{{ t('common.loading') }}</a-typography-text>
      </a-flex>
    </a-card>

    <a-row v-else-if="sourceMode === 'pool'" :gutter="[16, 16]">
      <!-- LEFT: zone → product → form -->
      <a-col :xs="24" :lg="15" :xl="16">
        <a-flex vertical gap="middle">
          <!-- 1. ZONE SELECTOR (flag cards, first step) -->
          <a-card>
            <template #title>
              <span class="step-title"><a-avatar :size="22" class="step-num">1</a-avatar><EnvironmentOutlined /> {{ t('cust.buy.stepZone') }}</span>
            </template>
            <template #extra><a-typography-text type="secondary" class="step-help">{{ t('cust.buy.stepZoneHelp') }}</a-typography-text></template>
            <a-row :gutter="[10, 10]" role="radiogroup">
              <a-col v-for="z in zoneCards" :key="z.id || 'auto'" :xs="24" :sm="12" :md="8" :xxl="6">
                <a-card
                  size="small"
                  :hoverable="!z.comingSoon"
                  class="choice"
                  :class="{ 'is-selected': form.zone === z.id, 'is-disabled': z.comingSoon }"
                  role="radio"
                  :tabindex="z.comingSoon ? -1 : 0"
                  :aria-checked="form.zone === z.id"
                  :aria-disabled="z.comingSoon"
                  @click="selectZoneCard(z)"
                  @keydown.enter.space.prevent="selectZoneCard(z)"
                >
                  <a-flex align="center" gap="small">
                    <CountryFlag :code="z.flag" :size="28" />
                    <div class="choice-text">
                      <a-typography-text strong class="choice-title">{{ z.name }}</a-typography-text>
                      <a-typography-text v-if="z.comingSoon" type="warning" strong class="choice-sub">{{ t('cust.side.comingSoon') }}</a-typography-text>
                      <a-typography-text v-else type="secondary" class="choice-sub mono one-line">{{ z.online }} node · {{ z.sub }}</a-typography-text>
                    </div>
                  </a-flex>
                  <CheckCircleFilled v-if="form.zone === z.id" class="choice-check" />
                </a-card>
              </a-col>
            </a-row>
          </a-card>

          <!-- 2. PRODUCT TYPE -->
          <a-card>
            <template #title>
              <span class="step-title"><a-avatar :size="22" class="step-num">2</a-avatar><CloudServerOutlined /> {{ t('cust.buy.stepType') }}</span>
            </template>
            <template #extra><a-typography-text type="secondary" class="step-help">{{ t('cust.buy.stepTypeHelp') }}</a-typography-text></template>
            <a-row :gutter="[12, 12]" role="radiogroup">
              <a-col v-for="p in productTypes" :key="p.id" :xs="24" :sm="12">
                <a-card
                  size="small"
                  hoverable
                  class="choice"
                  :class="{ 'is-selected': form.type === p.id }"
                  role="radio"
                  tabindex="0"
                  :aria-checked="form.type === p.id"
                  @click="selectType(p.id)"
                  @keydown.enter.space.prevent="selectType(p.id)"
                >
                  <a-flex vertical gap="middle">
                    <a-flex align="center" gap="middle">
                      <a-avatar shape="square" :size="44" :class="['ico', `ico-${p.color}`]">
                        <template #icon><component :is="p.icon" /></template>
                      </a-avatar>
                      <div class="choice-text">
                        <a-typography-text strong class="choice-title">{{ t(p.labelKey) }}</a-typography-text>
                        <a-typography-text type="secondary" class="choice-sub">{{ t(p.subKey) }}</a-typography-text>
                      </div>
                    </a-flex>
                    <div class="price">
                      <a-typography-text type="secondary">{{ t('cust.product.from') }}</a-typography-text>
                      <strong class="mono price-val">{{ fmtMoney(p.perHour) }}</strong>
                      <a-typography-text type="secondary" class="small-text">{{ currencyCode }} / {{ t('cust.buy.hour') }}</a-typography-text>
                    </div>
                  </a-flex>
                  <CheckCircleFilled v-if="form.type === p.id" class="choice-check" />
                </a-card>
              </a-col>
            </a-row>
          </a-card>

          <!-- 3. CONFIG -->
          <a-card>
            <template #title>
              <span class="step-title"><a-avatar :size="22" class="step-num">3</a-avatar><ClockCircleOutlined /> {{ t('cust.buy.configTitle') }}</span>
            </template>
            <template #extra><a-typography-text type="secondary" class="step-help">{{ t('cust.buy.stepConfigHelp') }}</a-typography-text></template>
            <a-form layout="vertical" :model="form">
              <a-form-item v-if="form.type === 'ipv6'" :label="t('cust.buy.method')">
                <a-radio-group v-model:value="form.rotate" option-type="button" button-style="solid" :options="methodOptions" />
              </a-form-item>
              <a-form-item>
                <a-checkbox v-model:checked="form.autoRenew">{{ t('cust.buy.autoRenew') }}</a-checkbox>
                <a-typography-text type="secondary" class="small-text">{{ t('cust.buy.autoRenewDesc') }}</a-typography-text>
              </a-form-item>

              <!-- Hours (slider + stepper + presets) -->
              <a-form-item :label="`${t('cust.buy.hours')} (${minHours} – ${maxHours} h)`">
                <a-row :gutter="[16, 8]" align="middle">
                  <a-col flex="1 1 220px">
                    <a-slider v-model:value="form.hours" :min="minHours" :max="Math.min(maxHours, 720)" :step="1" />
                  </a-col>
                  <a-col flex="none" class="stepper-col">
                    <a-space-compact class="stepper">
                      <a-button :aria-label="'-1 h'" @click="setHours(form.hours - 1)"><template #icon><MinusOutlined /></template></a-button>
                      <a-input-number
                        v-model:value="form.hours"
                        :min="minHours"
                        :max="maxHours"
                        :controls="false"
                        addon-after="h"
                        class="mono stepper-input"
                        @blur="setHours(form.hours)"
                      />
                      <a-button :aria-label="'+1 h'" @click="setHours(form.hours + 1)"><template #icon><PlusOutlined /></template></a-button>
                    </a-space-compact>
                  </a-col>
                </a-row>
                <a-flex wrap="wrap" gap="small" class="presets">
                  <a-button
                    v-for="h in hourPresets"
                    :key="h.hours"
                    size="small"
                    :type="form.hours === h.hours ? 'primary' : 'default'"
                    :ghost="form.hours === h.hours"
                    @click="setHours(h.hours)"
                  >
                    {{ t(h.labelKey) }}
                  </a-button>
                </a-flex>
              </a-form-item>

              <!-- Quantity (slider + stepper + presets) -->
              <a-form-item :label="`${t('cust.buy.quantity')} (1 – 254)`">
                <a-row :gutter="[16, 8]" align="middle">
                  <a-col flex="1 1 220px">
                    <a-slider v-model:value="form.quantity" :min="1" :max="100" :step="1" />
                  </a-col>
                  <a-col flex="none" class="stepper-col">
                    <a-space-compact class="stepper">
                      <a-button :aria-label="'-1'" @click="setQuantity(form.quantity - 1)"><template #icon><MinusOutlined /></template></a-button>
                      <a-input-number
                        v-model:value="form.quantity"
                        :min="1"
                        :max="254"
                        :controls="false"
                        :addon-after="t('cust.buy.proxyUnit')"
                        class="mono stepper-input"
                        @blur="setQuantity(form.quantity)"
                      />
                      <a-button :aria-label="'+1'" @click="setQuantity(form.quantity + 1)"><template #icon><PlusOutlined /></template></a-button>
                    </a-space-compact>
                  </a-col>
                </a-row>
                <a-flex wrap="wrap" gap="small" class="presets">
                  <a-button
                    v-for="q in quantityPresets"
                    :key="q"
                    size="small"
                    :type="form.quantity === q ? 'primary' : 'default'"
                    :ghost="form.quantity === q"
                    @click="setQuantity(q)"
                  >
                    {{ q }} {{ t('cust.buy.proxyUnit') }}
                  </a-button>
                </a-flex>
              </a-form-item>
            </a-form>

            <a-alert
              type="info"
              show-icon
              :message="form.zone ? t('cust.buy.hint', { country: selectedZoneInfo?.name || form.zone }) : t('cust.buy.hintAuto')"
            >
              <template #icon><BulbOutlined /></template>
            </a-alert>
          </a-card>

          <!-- Why-choose-us -->
          <a-card :title="t('cust.why.title')">
            <a-row :gutter="[16, 16]">
              <a-col :xs="24" :sm="12">
                <a-flex gap="middle" align="flex-start">
                  <a-avatar shape="square" :size="36" class="ico ico-green"><template #icon><SafetyCertificateOutlined /></template></a-avatar>
                  <div><a-typography-text strong>{{ t('cust.why.ipReal') }}</a-typography-text><br /><a-typography-text type="secondary" class="small-text">{{ t('cust.why.ipRealDesc') }}</a-typography-text></div>
                </a-flex>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-flex gap="middle" align="flex-start">
                  <a-avatar shape="square" :size="36" class="ico ico-green"><template #icon><CheckCircleOutlined /></template></a-avatar>
                  <div><a-typography-text strong>{{ t('cust.why.success') }}</a-typography-text><br /><a-typography-text type="secondary" class="small-text">{{ t('cust.why.successDesc') }}</a-typography-text></div>
                </a-flex>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-flex gap="middle" align="flex-start">
                  <a-avatar shape="square" :size="36" class="ico ico-green"><template #icon><ClockCircleOutlined /></template></a-avatar>
                  <div><a-typography-text strong>{{ t('cust.why.hourly') }}</a-typography-text><br /><a-typography-text type="secondary" class="small-text">{{ t('cust.why.hourlyDesc') }}</a-typography-text></div>
                </a-flex>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-flex gap="middle" align="flex-start">
                  <a-avatar shape="square" :size="36" class="ico ico-green"><template #icon><ThunderboltOutlined /></template></a-avatar>
                  <div><a-typography-text strong>{{ t('cust.why.support247') }}</a-typography-text><br /><a-typography-text type="secondary" class="small-text">{{ t('cust.why.support247Desc') }}</a-typography-text></div>
                </a-flex>
              </a-col>
            </a-row>
          </a-card>
        </a-flex>
      </a-col>

      <!-- RIGHT: order summary -->
      <a-col :xs="24" :lg="9" :xl="8">
        <a-flex vertical gap="middle" class="aside">
          <a-card :title="t('cust.buy.summary')">
            <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent" class="summary">
              <a-descriptions-item :label="t('cust.col.type')">
                <a-typography-text strong type="success">{{ selectedProduct ? t(selectedProduct.labelKey) : '—' }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.col.country')">
                <a-space :size="6">
                  <CountryFlag v-if="form.zone" :code="selectedCountryCode" :size="16" />
                  <span>{{ form.zone ? (selectedZoneInfo?.name || form.zone) : '—' }}</span>
                </a-space>
              </a-descriptions-item>
              <a-descriptions-item v-if="form.type === 'ipv6'" :label="t('cust.buy.method')">
                {{ form.rotate ? t('cust.buy.rotating') : t('cust.buy.sticky') }}
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.buy.hours')">{{ form.hours }} h</a-descriptions-item>
              <a-descriptions-item :label="t('cust.buy.quantity')">{{ form.quantity }} {{ t('cust.buy.proxyUnit') }}</a-descriptions-item>
              <a-descriptions-item :label="t('cust.buy.unitPrice')"><span class="mono">{{ fmtMoney(perHour) }} / h</span></a-descriptions-item>
            </a-descriptions>
            <a-divider class="tight-divider" />
            <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent" class="summary">
              <a-descriptions-item :label="t('cust.buy.subtotal')"><span class="mono">{{ fmtMoney(base) }} {{ currencyCode }}</span></a-descriptions-item>
              <a-descriptions-item v-if="tierDiscount > 0">
                <template #label>
                  {{ t('cust.buy.discount') }}
                  <a-tag color="success" :bordered="false" class="mini-tag">-{{ (tierDiscount * 100).toFixed(0) }}%</a-tag>
                </template>
                <a-typography-text type="success" class="mono">-{{ fmtMoney(discountAmount) }}</a-typography-text>
              </a-descriptions-item>
            </a-descriptions>

            <a-statistic :title="t('cust.buy.total')" :value="total" :suffix="currencyCode" :value-style="totalStyle" class="total-stat">
              <template #formatter="{ value }">{{ fmtMoney(value) }}</template>
            </a-statistic>

            <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent" class="summary">
              <a-descriptions-item v-if="creditApplied > 0">
                <template #label>
                  {{ t('cust.buy.creditApplied') }}
                  <a-tag color="success" :bordered="false" class="mini-tag">{{ form.type.toUpperCase() }}</a-tag>
                </template>
                <a-typography-text type="success" class="mono">-{{ fmtMoney(creditApplied) }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item v-if="creditApplied > 0" :label="t('cust.buy.walletNeeded')">
                <a-typography-text strong class="mono">{{ fmtMoney(walletNeeded) }} {{ currencyCode }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.side.balance')">
                <a-typography-text :type="canAfford ? 'success' : 'danger'" class="mono">{{ fmtMoney(balance) }} {{ currencyCode }}</a-typography-text>
              </a-descriptions-item>
            </a-descriptions>

            <a-flex vertical gap="small" class="pay-block">
              <a-button type="primary" size="large" block :loading="busy" :disabled="!canAfford || !form.zone" @click="placeOrder">
                <template #icon><LockOutlined /></template>
                {{ busy ? t('common.loading') : t('cust.buy.payNow') }}
              </a-button>
              <a-alert v-if="!form.zone" type="warning" show-icon :message="t('cust.buy.errNoZone')" />
              <a-alert v-if="!canAfford" type="error" show-icon :message="t('cust.buy.insufficient')">
                <template #action>
                  <a-button size="small" type="primary" @click="goTopup">{{ t('cust.detail.topupNow') }}</a-button>
                </template>
              </a-alert>
            </a-flex>
          </a-card>

          <a-card size="small" :title="t('cust.buy.policyTitle')">
            <a-flex vertical gap="small">
              <span><CheckOutlined class="ok-ico" /> {{ t('cust.buy.policy1') }}</span>
              <span><CheckOutlined class="ok-ico" /> {{ t('cust.buy.policy2') }}</span>
              <span><CheckOutlined class="ok-ico" /> {{ t('cust.buy.policy3') }}</span>
              <span><CheckOutlined class="ok-ico" /> {{ t('cust.buy.policy4') }}</span>
            </a-flex>
          </a-card>

          <!-- Pricing tiers reveal -->
          <a-card v-if="pricing.tiers?.length" size="small" :title="t('cust.buy.tiersTitle')">
            <a-flex wrap="wrap" gap="small">
              <a-tag v-for="tier in pricing.tiers" :key="tier.min" color="blue" :bordered="false" class="mono">≥{{ tier.min }} → -{{ ((tier.discount || 0) * 100).toFixed(0) }}%</a-tag>
            </a-flex>
          </a-card>
        </a-flex>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
/* Selectable card (source / zone / product / plan) */
.choice { position: relative; height: 100%; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s; }
.choice:focus-visible { outline: 2px solid var(--pb-primary); outline-offset: 2px; }
.choice.is-selected { border-color: var(--pb-primary); box-shadow: 0 0 0 1px var(--pb-primary); background: var(--pb-primary-soft); }
.choice.is-disabled { opacity: 0.45; cursor: not-allowed; }
.choice-check { position: absolute; top: 8px; right: 8px; color: var(--pb-primary); font-size: 16px; }
.choice-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; padding-right: 18px; }
.choice-title { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.choice-sub { font-size: 12px; }
.one-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: normal; }
.mini-tag { margin-inline: 6px 0; font-size: 10px; line-height: 16px; padding: 0 5px; font-weight: 700; }

/* Soft-tinted icon boxes */
.ico { flex: none; background: color-mix(in srgb, var(--ico) 16%, transparent); color: var(--ico); }
.ico-green { --ico: var(--pb-primary); }
.ico-blue { --ico: var(--pb-info); }
.ico-purple { --ico: #8b5cf6; }

/* Card step headers */
.step-title { display: inline-flex; align-items: center; gap: 8px; }
.step-num { background: var(--pb-primary); font-weight: 700; font-size: 12px; flex: none; }
.step-help { font-size: 12px; font-weight: 400; }

.price { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
.price-val { font-size: 20px; }
.small-text { font-size: 12px; }
.ok-ico { color: var(--pb-primary); margin-inline-end: 4px; }
.full-width { width: 100%; }
.loading-box { padding: 48px 0; }

.stepper-input { width: 150px; }
.presets { margin-top: 8px; }

.summary :deep(.ant-descriptions-item) { padding-bottom: 6px; }
.tight-divider { margin: 6px 0 12px; }
.total-stat { margin: 4px 0 12px; }
.pay-block { margin-top: 12px; }
.byon-empty { max-width: 520px; margin: 0 auto; }

/* i18n HTML snippets reference the legacy --green var inline */
.html-note { --green: var(--pb-primary); }

@media (min-width: 992px) {
  .aside { position: sticky; top: 84px; }
}
@media (max-width: 767px) {
  .step-help { display: none; }
}
@media (max-width: 575px) {
  .stepper-col { flex: 1 1 100% !important; }
  .stepper { display: flex; width: 100%; }
  .stepper-input { flex: 1; width: auto; min-width: 0; }
}
</style>
