<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle, Box, Check, CheckCircle2, Clock, Globe, Info, Lock, MapPin, Minus, Plus,
  RefreshCw, Server, ShieldCheck, ShoppingCart, Sparkles, Zap
} from 'lucide-vue-next'
import { Cloud, Cpu, MapPin as MapPinIcon, Wifi } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// Source mode: 'pool' = buy proxy from system pool (paid).
//               'byon' = use customer's own node (free).
//               'hub'  = rent VPS hub from us (paid hourly, agent auto-installed).
const sourceMode = ref('pool')
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
  if (!hubForm.value.planId) { err.value = 'Chọn 1 hub plan'; return }
  hubBusy.value = true; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch('/api/v1/user/hubs/buy', { method: 'POST', body: hubForm.value })
    flash.value = `${r.hint || 'Hub provisioned'}. Tổng phí ${r.totalCost?.toLocaleString() || ''} đã trừ.`
    setTimeout(() => router.push('/my-nodes'), 1800)
  } catch (e) { err.value = e.message }
  finally { hubBusy.value = false }
}
async function loadByon() {
  try { byonNodes.value = (await apiFetch('/api/v1/user/nodes')) || [] }
  catch { byonNodes.value = [] }
  if (byonNodes.value.length && !byonForm.value.nodeId) byonForm.value.nodeId = byonNodes.value[0].id
}
const selectedByonNode = computed(() => byonNodes.value.find((n) => n.id === byonForm.value.nodeId) || null)
async function placeFreeOrder() {
  if (byonBusy.value) return
  if (!byonForm.value.nodeId) { err.value = 'Chọn 1 node của bạn'; return }
  byonBusy.value = true; err.value = ''; flash.value = ''
  try {
    const body = { ...byonForm.value }
    if (selectedByonNode.value?.family && selectedByonNode.value.family !== 'dual') body.type = selectedByonNode.value.family
    const r = await apiFetch('/api/v1/user/proxies/from-own-node', { method: 'POST', body })
    flash.value = `Đã tạo ${r.count} proxy MIỄN PHÍ trên ${selectedByonNode.value?.name || r.nodeId}.`
    setTimeout(() => router.push({ name: 'proxies' }), 1500)
  } catch (e) { err.value = e.message }
  finally { byonBusy.value = false }
}

const pricing = ref(null)   // { currency, ipv4:{perHour}, ipv6:{perHour}, minHours, maxHours, tiers:[{min,discount}] }
const zones = ref([])       // [{ id, name, flag, timezone, onlineNodes }]
const account = ref(null)
const busy = ref(false)
const err = ref('')
const flash = ref('')

const form = ref({
  type: 'ipv4',          // 'ipv4' | 'ipv6'  — ONLY shape backend accepts
  zone: '',              // backend zone slug; required (defaults to first VN zone once zones load)
  rotate: false,         // only meaningful when type === 'ipv6'
  hours: 24,
  quantity: 1,
  coupon: '',
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
    { id: 'ipv4', color: 'blue',  icon: Server, labelKey: 'cust.buy.t.ipv4',     subKey: 'cust.buy.t.ipv4Sub',     perHour: Number(pricing.value.ipv4?.perHour || 0), backendType: 'ipv4' },
    { id: 'ipv6', color: 'green', icon: Globe,  labelKey: 'cust.buy.t.ipv6',     subKey: 'cust.buy.t.ipv6Sub',     perHour: Number(pricing.value.ipv6?.perHour || 0), backendType: 'ipv6' }
  ]
})

const selectedProduct = computed(() => productTypes.value.find((p) => p.id === form.value.type) || productTypes.value[0] || null)
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const minHours = computed(() => Number(pricing.value?.minHours || 1))
const maxHours = computed(() => Number(pricing.value?.maxHours || 8760))

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
const canAfford = computed(() => balance.value >= total.value)

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
  if (!selectedProduct.value) { err.value = t('cust.buy.errNoPricing'); return }
  // Auto-balance was removed — zone must be a real, loaded zone id.
  if (!form.value.zone || !zones.value.some((z) => z.id === form.value.zone)) {
    err.value = t('cust.buy.errNoZone')
    return
  }
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const safeZone = form.value.zone
    const body = {
      type: selectedProduct.value.backendType,
      quantity: form.value.quantity,
      hours: form.value.hours,
      zone: safeZone,
      rotate: form.value.type === 'ipv6' && form.value.rotate,
      autoRenew: form.value.autoRenew,
      coupon: form.value.coupon
    }
    const r = await apiFetch('/api/v1/user/orders', { method: 'POST', body })
    flash.value = t('cust.buy.success', { id: r.order?.id || '' })
    setTimeout(() => router.push({ name: 'order-detail', params: { orderId: r.order.id } }), 1200)
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}
function goTopup() { router.push({ name: 'billing' }) }
function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') }

onMounted(async () => { await refresh(); applyQuery(); loadByon(); loadHubPlans() })
</script>

<template>
  <h1>{{ t('cust.buy.title') }}</h1>
  <p class="sub">{{ t('cust.buy.subtitle') }}</p>

  <!-- Source switcher: pool (paid) vs own node (free) -->
  <div class="source-tabs">
    <button type="button" :class="{ active: sourceMode === 'pool' }" @click="sourceMode = 'pool'">
      <ShoppingCart :size="14" />
      <span><strong>Mua Proxy</strong><small>IPv4 / IPv6 trả theo giờ</small></span>
    </button>
    <button type="button" :class="{ active: sourceMode === 'hub' }" @click="sourceMode = 'hub'">
      <Cloud :size="14" />
      <span><strong>Mua Hub Proxy <em class="badge-pro">PRO</em></strong><small>Thuê VPS riêng, auto-cài agent</small></span>
    </button>
    <button type="button" :class="{ active: sourceMode === 'byon' }" @click="sourceMode = 'byon'">
      <Cpu :size="14" />
      <span><strong>Từ node của tôi <em class="badge-free">FREE</em></strong><small>VM bạn tự cung cấp</small></span>
    </button>
  </div>

  <p v-if="err" class="error-text">
    {{ err }}
    <button v-if="/balance|insufficient/i.test(err)" class="ghost-button" type="button" style="margin-left:8px" @click="goTopup">{{ t('cust.detail.topupNow') }}</button>
  </p>
  <p v-if="flash" style="color:#4ade80; font-size:13px">{{ flash }}</p>

  <!-- ── HUB branch: rent VPS hub from us (paid hourly, auto-installed) ── -->
  <section v-if="sourceMode === 'hub'" class="hub-layout">
    <div style="display:flex; flex-direction:column; gap:14px">
      <!-- 1. ZONE selector — derived from admin's Virtualizor instances -->
      <section class="surface zone-section">
        <div class="step-head">
          <span class="step-num">1</span>
          <h2><MapPinIcon :size="15" /> Chọn vị trí (zone)</h2>
          <span class="step-help">Mỗi zone = 1 datacenter chứa Virtualizor backend.</span>
        </div>
        <div v-if="!hubZones.length" class="empty-text" style="text-align:left; padding:14px">
          Chưa có hub plan nào — admin cần cấu hình Virtualizor instance + tạo plan trước.
        </div>
        <div v-else class="zone-grid">
          <button v-for="z in hubZones" :key="z.id" type="button" class="zone-card" :class="{ selected: hubForm.zone === z.id }" @click="pickHubZone(z.id)">
            <span class="z-flag"><CountryFlag :code="z.flag" :size="28" /></span>
            <span class="z-text">
              <strong>{{ z.name }}</strong>
              <span class="z-sub">{{ z.planCount }} plan · {{ z.sub }}</span>
            </span>
            <Check v-if="hubForm.zone === z.id" :size="14" class="z-check" />
          </button>
        </div>
      </section>

      <!-- 2. PLAN cards filtered by selected zone -->
      <section class="surface" v-if="hubPlansForZone.length">
        <div class="step-head">
          <span class="step-num">2</span>
          <h2><Cloud :size="15" /> Chọn cấu hình</h2>
          <span class="step-help">Mỗi plan = 1 VPS template ở Virtualizor.</span>
        </div>
        <div class="product-grid" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
          <div v-for="p in hubPlansForZone" :key="p.id" class="product-card" :class="{ selected: hubForm.planId === p.id }" @click="pickHubPlan(p)">
            <div class="head">
              <span class="icon-box" :class="p.family === 'ipv6' ? 'fam-v6' : 'fam-v4'"><Cloud :size="22" /></span>
              <div>
                <h3>{{ p.name }}</h3>
                <p class="desc-sub">
                  <span :class="['fam-tag', p.family]">Proxy Hub {{ p.family.toUpperCase() }}</span>
                  <span style="margin-left:6px; color:var(--muted)">· {{ p.region }}</span>
                </p>
              </div>
            </div>
            <p class="feat" v-if="p.description"><Check :size="13" /> {{ p.description }}</p>
            <ul class="spec-list">
              <li><strong>{{ p.specs.cpu }}</strong> vCPU</li>
              <li><strong>{{ p.specs.ramGB }}</strong> GB RAM</li>
              <li><strong>{{ p.specs.diskGB }}</strong> GB Disk</li>
              <li v-if="p.specs.bandwidthGB"><strong>{{ p.specs.bandwidthGB }}</strong> GB BW/m</li>
              <li v-if="p.specs.ipv4Count"><strong>{{ p.specs.ipv4Count }}</strong> IPv4</li>
              <li v-if="p.specs.ipv6Range"><strong>{{ p.specs.ipv6Range }}</strong> IPv6</li>
            </ul>
            <div class="price">
              {{ t('cust.product.from') }}
              <strong>{{ Number(p.hourlyPrice).toLocaleString() }}</strong>
              <small>{{ p.currency }} / giờ</small>
            </div>
          </div>
        </div>
      </section>
      <section v-else-if="hubForm.zone" class="surface" style="padding:18px">
        <p class="empty-text" style="margin:0; text-align:left">Zone {{ hubForm.zone }} chưa có plan nào — chọn zone khác.</p>
      </section>
    </div>

    <!-- RIGHT: hours + total + buy -->
    <aside class="surface" style="padding:18px">
      <h3 style="margin:0 0 12px; font-size:15px"><Clock :size="14" style="vertical-align:-2px" /> Số giờ thuê</h3>
      <input v-model.number="hubForm.hours" type="number" :min="selectedHubPlan?.minHours || 1" :max="selectedHubPlan?.maxHours || 720"
        class="cell-mono"
        style="width:100%; height:38px; padding:0 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:14px; text-align:right" />
      <div v-if="selectedHubPlan" class="hub-total" style="margin-top:14px; padding:12px; background:var(--bg); border-radius:8px; border:1px solid var(--border)">
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--muted)">
          <span>Plan</span><span>{{ selectedHubPlan.name }}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:4px">
          <span>Giá / giờ</span><span class="cell-mono">{{ Number(selectedHubPlan.hourlyPrice).toLocaleString() }} {{ selectedHubPlan.currency }}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:4px">
          <span>Số giờ</span><span class="cell-mono">{{ hubForm.hours }}</span>
        </div>
        <hr style="border:none; border-top:1px dashed var(--border); margin:8px 0" />
        <div style="display:flex; justify-content:space-between; align-items:baseline">
          <strong>Tổng</strong>
          <strong class="cell-mono" style="font-size:18px; color:var(--green)">{{ Number(hubCost).toLocaleString() }} {{ selectedHubPlan.currency }}</strong>
        </div>
      </div>
      <button class="primary-action" type="button" :disabled="hubBusy || !hubForm.planId" @click="placeHubOrder" style="margin-top:14px; width:100%">
        <Plus :size="13" /> {{ hubBusy ? 'Đang khởi tạo VM…' : (hubForm.planId ? `Thuê Hub (${Number(hubCost).toLocaleString()} ${selectedHubPlan?.currency || 'VND'})` : 'Chọn plan trước') }}
      </button>
      <p class="hub-note" style="margin:12px 0 0; font-size:11px; color:var(--muted); line-height:1.5">
        VM tự khởi tạo qua Virtualizor + ProxyBox agent tự cài qua cloud-init. Mất 1-3 phút.
        Sau đó node xuất hiện ở <strong>ProxyBox</strong> (/my-nodes) → bạn tạo proxy MIỄN PHÍ trên đó (chỉ trừ slot proxy theo plan).
      </p>
    </aside>
  </section>

  <!-- ── BYON branch: free creation on customer's own node ── -->
  <section v-if="sourceMode === 'byon'" class="surface" style="padding:18px">
    <div v-if="!byonNodes.length" class="empty-text" style="text-align:left">
      <p style="margin:0 0 10px"><strong>Chưa có node nào của bạn.</strong></p>
      <p style="margin:0 0 10px; font-size:13px">
        Vào trang <router-link to="/my-nodes" style="color:var(--green)">My Nodes</router-link> để sinh fleet token, paste lệnh cài lên VM của bạn → node tự đăng ký.
      </p>
      <p style="margin:0; font-size:11.5px; color:var(--muted)">
        Proxy tạo trên node của bạn <strong style="color:var(--green)">miễn phí 100%</strong> — chỉ trả theo proxy mua từ hệ thống của chúng tôi.
      </p>
    </div>
    <div v-else>
      <div class="byon-form-grid">
        <label class="field">
          <span>Node</span>
          <select v-model="byonForm.nodeId">
            <option v-for="n in byonNodes" :key="n.id" :value="n.id">
              {{ n.name }} — {{ n.host }} ({{ (n.family || 'dual').toUpperCase() }}) · {{ n.status }}
            </option>
          </select>
        </label>
        <label class="field" v-if="selectedByonNode && selectedByonNode.family === 'dual'">
          <span>Loại</span>
          <select v-model="byonForm.type">
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6 (rotating pool)</option>
          </select>
        </label>
        <label class="field">
          <span>Số lượng</span>
          <input v-model.number="byonForm.quantity" type="number" min="1" max="20" />
        </label>
        <label class="field">
          <span>Thời hạn (ngày)</span>
          <input v-model.number="byonForm.durationDays" type="number" min="1" max="3650" />
        </label>
        <label v-if="byonForm.type === 'ipv6' || selectedByonNode?.family === 'ipv6'" class="field" style="grid-column:span 2">
          <span style="display:flex; gap:6px; align-items:center">
            <input v-model="byonForm.rotate" type="checkbox" /> Rotation pool (mỗi conn 1 IP)
          </span>
        </label>
      </div>
      <button class="primary-action" type="button" :disabled="byonBusy || !byonForm.nodeId" @click="placeFreeOrder" style="margin-top:14px">
        <Plus :size="13" /> {{ byonBusy ? 'Đang tạo…' : `Tạo ${byonForm.quantity} proxy MIỄN PHÍ` }}
      </button>
      <p class="byon-note">
        Proxy chạy trên <strong>node của bạn</strong> — không trừ ví, không phí. Chỉ chiếm slot trong plan ({{ byonForm.quantity }} proxy).
      </p>
    </div>
  </section>

  <div v-if="!pricing && sourceMode === 'pool'" class="empty-text" style="padding:60px">{{ t('common.loading') }}</div>

  <div v-else-if="sourceMode === 'pool'" class="pool-layout">
    <!-- LEFT: zone → product → form -->
    <div class="pool-main">
      <!-- 1. ZONE SELECTOR (flag cards, first step) -->
      <section class="surface zone-section">
        <div class="step-head">
          <span class="step-num">1</span>
          <h2><MapPin :size="15" /> {{ t('cust.buy.stepZone') }}</h2>
          <span class="step-help">{{ t('cust.buy.stepZoneHelp') }}</span>
        </div>
        <div class="zone-grid">
          <button
            v-for="z in zoneCards" :key="z.id || 'auto'"
            type="button"
            class="zone-card"
            :class="{ selected: form.zone === z.id, 'is-soon': z.comingSoon }"
            :disabled="z.comingSoon"
            @click="selectZoneCard(z)"
          >
            <span class="z-flag">
              <CountryFlag :code="z.flag" :size="28" />
            </span>
            <span class="z-text">
              <strong>{{ z.name }}</strong>
              <span class="z-sub" v-if="z.comingSoon">{{ t('cust.side.comingSoon') }}</span>
              <span class="z-sub" v-else>{{ z.online }} node · {{ z.sub }}</span>
            </span>
            <Check v-if="form.zone === z.id" :size="14" class="z-check" />
          </button>
        </div>
      </section>

      <!-- 2. PRODUCT TYPE -->
      <section class="surface">
        <div class="step-head">
          <span class="step-num">2</span>
          <h2><Server :size="15" /> {{ t('cust.buy.stepType') }}</h2>
          <span class="step-help">{{ t('cust.buy.stepTypeHelp') }}</span>
        </div>
        <div class="product-grid pool-types">
          <div
            v-for="p in productTypes" :key="p.id"
            class="product-card"
            :class="{ selected: form.type === p.id }"
            @click="selectType(p.id)"
          >
            <div v-if="form.type === p.id" class="check-mark"><Check :size="14" /></div>
            <div class="head">
              <span class="icon-box" :class="p.color"><component :is="p.icon" :size="22" /></span>
              <div>
                <h3>{{ t(p.labelKey) }}</h3>
                <p class="desc-sub">{{ t(p.subKey) }}</p>
              </div>
            </div>
            <div class="price">
              {{ t('cust.product.from') }}
              <strong>{{ fmtMoney(p.perHour) }}</strong>
              <small>{{ currencyCode }} / {{ t('cust.buy.hour') }}</small>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. CONFIG -->
      <section class="surface">
        <div class="step-head">
          <span class="step-num">3</span>
          <h2><Clock :size="15" /> {{ t('cust.buy.configTitle') }}</h2>
          <span class="step-help">{{ t('cust.buy.stepConfigHelp') }}</span>
        </div>
        <div class="form-grid" style="grid-template-columns: 1fr; gap:14px">
          <label class="input-field" v-if="form.type === 'ipv6'">
            <span>{{ t('cust.buy.method') }} <Info :size="12" style="color:var(--muted); vertical-align:-2px" /></span>
            <select v-model="form.rotate">
              <option :value="false">{{ t('cust.buy.sticky') }}</option>
              <option :value="true">{{ t('cust.buy.rotating') }} — {{ t('cust.buy.rotatingSub') }}</option>
            </select>
          </label>
          <label class="check-line" style="grid-column: 1 / -1; padding: 6px 0">
            <input v-model="form.autoRenew" type="checkbox" />
            <span style="color:var(--text); font-size:13px">{{ t('cust.buy.autoRenew') }}</span>
            <span style="color:var(--muted); font-size:11.5px; margin-left:6px">{{ t('cust.buy.autoRenewDesc') }}</span>
          </label>
        </div>

        <!-- Hours (slider + presets) -->
        <div style="margin-top:8px">
          <label class="input-field" style="margin-bottom:8px">
            <span>{{ t('cust.buy.hours') }} ({{ minHours }} – {{ maxHours }} h)</span>
          </label>
          <div class="slider-row">
            <input
              v-model.number="form.hours" type="range"
              :min="minHours" :max="Math.min(maxHours, 720)" step="1"
              class="slider-range"
            />
            <div class="num-stepper">
              <button type="button" class="row-menu" @click="setHours(form.hours - 1)"><Minus :size="14" /></button>
              <input
                v-model.number="form.hours" type="number" :min="minHours" :max="maxHours"
                class="num-input"
              />
              <span class="num-unit">h</span>
              <button type="button" class="row-menu" @click="setHours(form.hours + 1)"><Plus :size="14" /></button>
            </div>
          </div>
          <div class="chips" style="margin-top:4px">
            <button v-for="h in hourPresets" :key="h.hours" type="button" :class="{ active: form.hours === h.hours }" @click="setHours(h.hours)">{{ t(h.labelKey) }}</button>
          </div>
        </div>

        <!-- Quantity (slider + presets) -->
        <div style="margin-top:18px">
          <label class="input-field" style="margin-bottom:8px">
            <span>{{ t('cust.buy.quantity') }} (1 – 254)</span>
          </label>
          <div class="slider-row">
            <input
              v-model.number="form.quantity" type="range" min="1" max="100" step="1"
              class="slider-range"
            />
            <div class="num-stepper">
              <button type="button" class="row-menu" @click="setQuantity(form.quantity - 1)"><Minus :size="14" /></button>
              <input
                v-model.number="form.quantity" type="number" min="1" max="254"
                class="num-input"
              />
              <span class="num-unit">{{ t('cust.buy.proxyUnit') }}</span>
              <button type="button" class="row-menu" @click="setQuantity(form.quantity + 1)"><Plus :size="14" /></button>
            </div>
          </div>
          <div class="chips" style="margin-top:4px">
            <button v-for="q in quantityPresets" :key="q" type="button" :class="{ active: form.quantity === q }" @click="setQuantity(q)">{{ q }} {{ t('cust.buy.proxyUnit') }}</button>
          </div>
        </div>

        <!-- Coupon -->
        <div style="margin-top:18px; max-width: 320px">
          <label class="input-field">
            <span>{{ t('cust.buy.coupon') }} <small style="color:var(--muted); font-weight:400">({{ t('cust.buy.optional') }})</small></span>
            <input v-model="form.coupon" placeholder="LAUNCH10" />
          </label>
        </div>

        <div style="margin-top:14px; padding:10px 14px; border: 1px dashed var(--pxl-bd); border-radius:10px; display:flex; align-items:center; gap:10px; color:var(--muted); font-size:13px">
          <Sparkles :size="14" style="color: var(--pxl)" />
          {{ form.zone
              ? t('cust.buy.hint', { country: selectedZoneInfo?.name || form.zone })
              : t('cust.buy.hintAuto') }}
        </div>
      </section>

      <!-- Why-choose-us -->
      <section class="surface">
        <h2 style="color:var(--text); font-size:16px; margin-bottom:14px">{{ t('cust.why.title') }}</h2>
        <div class="why-choose" style="padding:0; background:transparent; border:none">
          <div class="feature-card">
            <span class="ico"><ShieldCheck :size="18" /></span>
            <div><div class="lbl">{{ t('cust.why.ipReal') }}</div><div class="desc-sub">{{ t('cust.why.ipRealDesc') }}</div></div>
          </div>
          <div class="feature-card">
            <span class="ico"><CheckCircle2 :size="18" /></span>
            <div><div class="lbl">{{ t('cust.why.success') }}</div><div class="desc-sub">{{ t('cust.why.successDesc') }}</div></div>
          </div>
          <div class="feature-card">
            <span class="ico"><Clock :size="18" /></span>
            <div><div class="lbl">{{ t('cust.why.hourly') }}</div><div class="desc-sub">{{ t('cust.why.hourlyDesc') }}</div></div>
          </div>
          <div class="feature-card">
            <span class="ico"><Zap :size="18" /></span>
            <div><div class="lbl">{{ t('cust.why.support247') }}</div><div class="desc-sub">{{ t('cust.why.support247Desc') }}</div></div>
          </div>
        </div>
      </section>
    </div>

    <!-- RIGHT: order summary -->
    <aside class="pool-aside">
      <div class="px-order-summary">
        <h3 style="margin:0; color:var(--text); font-size:15px; font-weight:600">{{ t('cust.buy.summary') }}</h3>
        <div class="divider"></div>
        <div class="sum-kv"><span class="k">{{ t('cust.col.type') }}</span><span class="v pxl">{{ selectedProduct ? t(selectedProduct.labelKey) : '—' }}</span></div>
        <div class="sum-kv">
          <span class="k">{{ t('cust.col.country') }}</span>
          <span class="v" style="display:inline-flex; gap:6px; align-items:center">
            <CountryFlag v-if="form.zone" :code="selectedCountryCode" :size="16" />
            {{ form.zone ? (selectedZoneInfo?.name || form.zone) : '—' }}
          </span>
        </div>
        <div class="sum-kv" v-if="form.type === 'ipv6'"><span class="k">{{ t('cust.buy.method') }}</span><span class="v">{{ form.rotate ? t('cust.buy.rotating') : t('cust.buy.sticky') }}</span></div>
        <div class="sum-kv"><span class="k">{{ t('cust.buy.hours') }}</span><span class="v">{{ form.hours }} h</span></div>
        <div class="sum-kv"><span class="k">{{ t('cust.buy.quantity') }}</span><span class="v">{{ form.quantity }} {{ t('cust.buy.proxyUnit') }}</span></div>
        <div class="sum-kv"><span class="k">{{ t('cust.buy.unitPrice') }}</span><span class="v cell-mono">{{ fmtMoney(perHour) }} / h</span></div>
        <div class="divider"></div>
        <div class="sum-kv"><span class="k">{{ t('cust.buy.subtotal') }}</span><span class="v cell-mono">{{ fmtMoney(base) }} {{ currencyCode }}</span></div>
        <div class="sum-kv" v-if="tierDiscount > 0">
          <span class="k">{{ t('cust.buy.discount') }} <small style="color: #4ade80">(-{{ (tierDiscount * 100).toFixed(0) }}%)</small></span>
          <span class="v cell-mono" style="color:#4ade80">-{{ fmtMoney(discountAmount) }}</span>
        </div>
        <div class="total">
          <span class="lbl">{{ t('cust.buy.total') }}</span>
          <span class="val cell-mono">{{ fmtMoney(total) }} {{ currencyCode }}</span>
        </div>
        <div class="sum-kv" style="font-size:12px"><span class="k">{{ t('cust.side.balance') }}</span><span class="v" :style="{ color: canAfford ? '#4ade80' : '#f87171' }">{{ fmtMoney(balance) }} {{ currencyCode }}</span></div>

        <button class="detail-action" type="button" :disabled="busy || !canAfford || !form.zone" @click="placeOrder">
          <Lock :size="15" /> {{ busy ? t('common.loading') : t('cust.buy.payNow') }}
        </button>

        <div v-if="!form.zone" style="color:#f87171; font-size:12px; display:flex; align-items:center; gap:6px; margin-top:6px">
          <AlertCircle :size="13" /> {{ t('cust.buy.errNoZone') }}
        </div>
        <div v-if="!canAfford" style="color:#f87171; font-size:12px; display:flex; align-items:center; gap:6px; margin-top:6px">
          <AlertCircle :size="13" /> {{ t('cust.buy.insufficient') }}
          <button class="px-promo-btn" type="button" style="margin-left:auto" @click="goTopup">{{ t('cust.detail.topupNow') }}</button>
        </div>
      </div>

      <div class="px-order-summary">
        <h3 style="margin:0; color:var(--text); font-size:14px; font-weight:600">{{ t('cust.buy.policyTitle') }}</h3>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:13px; color:var(--text); margin-top:6px">
          <span style="display:flex; align-items:center; gap:8px"><Check :size="14" style="color:var(--green)" /> {{ t('cust.buy.policy1') }}</span>
          <span style="display:flex; align-items:center; gap:8px"><Check :size="14" style="color:var(--green)" /> {{ t('cust.buy.policy2') }}</span>
          <span style="display:flex; align-items:center; gap:8px"><Check :size="14" style="color:var(--green)" /> {{ t('cust.buy.policy3') }}</span>
          <span style="display:flex; align-items:center; gap:8px"><Check :size="14" style="color:var(--green)" /> {{ t('cust.buy.policy4') }}</span>
        </div>
      </div>

      <!-- Pricing tiers reveal -->
      <div v-if="pricing.tiers?.length" class="px-order-summary">
        <h3 style="margin:0; color:var(--text); font-size:13px; font-weight:600">{{ t('cust.buy.tiersTitle') }}</h3>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px">
          <span v-for="tier in pricing.tiers" :key="tier.min" class="tag-soft datacenter" style="font-size:10.5px">≥{{ tier.min }} → -{{ ((tier.discount || 0) * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* Step header — numbered circle + title + subtitle */
.step-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 14px; flex-wrap: wrap;
}
.step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--pxl); color:var(--text); font-weight: 700;
  display: grid; place-items: center; font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 0 12px rgba(63, 185, 80, 0.4);
  flex: none;
}
.step-head h2 {
  margin: 0; color:var(--text); font-size: 16px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 7px;
}
.step-head h2 svg { color: var(--pxl); }
.step-help { color: var(--muted); font-size: 12px; margin-left: auto; }

/* Zone cards grid */
.zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.zone-card {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--pxl-card-2);
  border: 1px solid var(--pxl-bd);            /* was 1.5px → renders inconsistently across browsers */
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--text);
  /* Explicit prop list — `transition: 160ms` (shorthand without prop) defaults
     to `all`, which animates layout-affecting props (height, position) every
     time vue re-renders and causes flicker on hover. */
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
  box-sizing: border-box;
}
.zone-card:hover:not(:disabled) {
  border-color: var(--pxl);
  background: rgba(63, 185, 80, 0.06);
  transform: translateY(-1px);
}
.zone-card.selected {
  border-color: var(--pxl);
  background: linear-gradient(135deg, rgba(63, 185, 80, 0.18) 0%, rgba(63, 185, 80, 0.08) 100%);
  box-shadow: 0 4px 18px rgba(63, 185, 80, 0.18);
}
.zone-card.is-soon {
  opacity: 0.45; cursor: not-allowed;
}
.zone-card.is-soon::after {
  content: '';
  position: absolute; inset: 0; border-radius: 12px;
  background: repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.02) 8px 16px);
  pointer-events: none;
}
.z-flag {
  width: 40px; height: 40px; border-radius: 8px;
  background: var(--pxl-bg); display: grid; place-items: center;
  flex: none; color: var(--muted);
  border: 1px solid var(--pxl-bd-soft);
  overflow: hidden;
}
.zone-card.selected .z-flag { background: rgba(255,255,255,0.06); }
.z-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.z-text strong {
  color:var(--text); font-size: 13.5px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.z-sub { color: var(--muted); font-size: 10.5px; font-family: 'JetBrains Mono', monospace; }
.zone-card.is-soon .z-sub { color: #f59e0b; font-weight: 600; }
.z-check {
  position: absolute; top: 8px; right: 8px;
  width: 18px; height: 18px; padding: 2px;
  background: var(--pxl); color:var(--text); border-radius: 50%;
}

@media (max-width: 640px) {
  .zone-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .zone-card { padding: 10px 12px; gap: 10px; }
  .z-flag { width: 32px; height: 32px; }
  .z-text strong { font-size: 12.5px; }
  .step-help { display: none; }
}
@media (max-width: 380px) {
  .zone-grid { grid-template-columns: 1fr; }
}

/* Source mode tabs: 3-col on desktop, 1-col on mobile */
.source-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 12px 0 16px;
}
@media (max-width: 800px) {
  .source-tabs { grid-template-columns: 1fr; }
}
.source-tabs button {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--muted); cursor: pointer;
  font: inherit; text-align: left;
  transition: 150ms;
}
.source-tabs button > span { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.source-tabs button strong { display: block; font-size: 14px; line-height: 1.2; }
.source-tabs button small { display: block; font-size: 11.5px; color: var(--muted); margin-top: 1px; }
.source-tabs button:hover { border-color: var(--muted); color: var(--text); }
.source-tabs button.active {
  background: rgba(34,197,94,0.06);
  border-color: var(--green);
  color: var(--text);
}
.source-tabs button.active strong { color: var(--green); }
.badge-free {
  display: inline-block; margin-left: 6px;
  font-size: 9.5px; font-weight: 700; font-style: normal; letter-spacing: 0.05em;
  background: rgba(34,197,94,0.18); color: var(--green);
  padding: 1px 5px; border-radius: 3px;
}
.badge-pro {
  display: inline-block; margin-left: 6px;
  font-size: 9.5px; font-weight: 700; font-style: normal; letter-spacing: 0.05em;
  background: rgba(34,211,238,0.18); color: #22d3ee;
  padding: 1px 5px; border-radius: 3px;
}

/* Hub spec list */
.spec-list {
  list-style: none; padding: 0; margin: 8px 0 10px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;
  font-size: 12px; color: var(--muted);
}
.spec-list li { display: flex; align-items: baseline; gap: 5px; }
.spec-list strong { color: var(--text); font-family: var(--mono); font-size: 12.5px; }
.product-card.selected { border-color: var(--green); background: rgba(34,197,94,0.04); }

/* Family-coded badges + icons (Proxy Hub IPv4 / IPv6) */
.fam-tag { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 4px; }
.fam-tag.ipv4 { background: rgba(59,130,246,0.16); color: #60a5fa; }
.fam-tag.ipv6 { background: rgba(139,92,246,0.16); color: #a78bfa; }
.icon-box.fam-v4 { background: rgba(59,130,246,0.16); color: #60a5fa; }
.icon-box.fam-v6 { background: rgba(139,92,246,0.16); color: #a78bfa; }

/* Hub flow layout */
.hub-layout { display: grid; grid-template-columns: 1fr 360px; gap: 18px; align-items: start; }
.hub-layout aside.surface { position: sticky; top: 80px; }

@media (max-width: 800px) {
  .hub-layout { grid-template-columns: 1fr; }
  .hub-layout aside.surface { position: static; }
  .byon-form-grid { grid-template-columns: 1fr !important; }
  .spec-list { grid-template-columns: 1fr; }
}

/* BYON form */
.byon-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 600px) { .byon-form-grid { grid-template-columns: 1fr; } }
.byon-form-grid .field { display: flex; flex-direction: column; gap: 4px; }
.byon-form-grid .field > span { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.byon-form-grid input, .byon-form-grid select {
  height: 36px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-family: var(--mono); font-size: 12.5px; outline: none;
}
.byon-form-grid input[type=number] { font-family: var(--mono); }
.byon-form-grid input:focus, .byon-form-grid select:focus { border-color: var(--green); }
.byon-note { margin: 10px 0 0; font-size: 12px; color: var(--muted); }

/* ── Pool branch layout (paid proxy from system pool) ─────────────────── */
.pool-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  align-items: start;
}
.pool-main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.pool-aside {
  position: sticky; top: 80px;
  display: flex; flex-direction: column; gap: 14px;
  min-width: 0;
}
.pool-types { grid-template-columns: 1fr 1fr; }

/* Slider row: range + numeric stepper side-by-side; wraps on phone */
.slider-row {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 10px; flex-wrap: wrap;
}
.slider-range {
  flex: 1 1 200px; min-width: 0;
  accent-color: var(--pxl); height: 4px;
}
.num-stepper {
  display: inline-flex; align-items: center;
  background: var(--pxl-card-2);
  border: 1px solid var(--pxl-bd);
  border-radius: 8px;
  padding: 2px 6px; gap: 6px;
  flex-shrink: 0;
}
.num-input {
  width: 64px; text-align: center;
  background: none; border: none;
  color: var(--text); font-weight: 600;
  font-family: var(--mono); font-size: 14px;
  -moz-appearance: textfield;
}
.num-input::-webkit-outer-spin-button,
.num-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.num-unit { color: var(--muted); font-size: 12px; }

/* ── Mobile / tablet breakpoints ─────────────────────────────────────── */
@media (max-width: 900px) {
  .pool-layout { grid-template-columns: 1fr; }
  .pool-aside { position: static; top: auto; }
  .pool-types { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 640px) {
  .pool-types { grid-template-columns: 1fr; }
  .slider-row { gap: 10px; }
  .num-stepper { flex: 1 1 100%; justify-content: space-between; }
  .num-input { flex: 1; width: auto; min-width: 0; }
  .source-tabs button { padding: 10px 12px; gap: 10px; }
  .source-tabs button strong { font-size: 13px; }
  .source-tabs button small { font-size: 10.5px; }
  /* Order summary aside: shrink padding on phone (referenced via global px-order-summary) */
  :deep(.px-order-summary) { padding: 14px; }
  :deep(.px-order-summary .sum-kv) { font-size: 12.5px; }
  :deep(.px-order-summary .total .val) { font-size: 18px; }
  /* Hours/quantity preset chips wrap nicely */
  :deep(.chips) { flex-wrap: wrap; gap: 6px; }
  :deep(.chips button) { padding: 5px 10px; font-size: 11.5px; }
  /* Section padding scales down */
  :deep(.surface) { padding: 14px 12px; }
  .step-head h2 { font-size: 14.5px; }
  .step-num { width: 22px; height: 22px; font-size: 11px; }
}
@media (max-width: 420px) {
  h1 { font-size: 18px; }
  .source-tabs button strong { font-size: 12.5px; }
  .source-tabs button small { font-size: 10px; }
  .zone-card { padding: 10px 12px; gap: 10px; }
  .z-flag { width: 34px; height: 34px; }
  .z-text strong { font-size: 12.5px; }
  .num-input { font-size: 13px; }
}
</style>
