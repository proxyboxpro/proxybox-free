<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  MapPin, Server, Globe, Clock, Cloud, Cpu, ShoppingCart, ShieldCheck, CheckCircle2,
  Zap, Lock, AlertCircle, Sparkles, Info, Check, Plus, Minus, Copy, Check as CheckIcon,
  ExternalLink, ArrowRight
} from 'lucide-vue-next'
import CountryFlag from '../components/CountryFlag.vue'
import PublicTopNav from '../components/PublicTopNav.vue'
import { apiFetch, token } from '../api'
import { useI18n } from '../i18n'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()

const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const sourceMode = ref('pool') // 'pool' | 'hub' | 'oss'

// ── Pool (Mua Proxy) state ──
const pricing = ref(null)
const zones = ref([])
const hubPlans = ref([])
const err = ref('')
const loading = ref(true)

const form = ref({
  type: 'ipv4',
  zone: '',
  hours: 24,
  quantity: 1,
  rotate: false,
  autoRenew: false
})

const hubForm = ref({ zone: '', planId: null })

async function refresh() {
  loading.value = true
  err.value = ''
  try {
    const [p, z, h] = await Promise.all([
      apiFetch('/api/public/pricing').catch(() => null),
      apiFetch('/api/public/zones').catch(() => []),
      apiFetch('/api/public/hub-plans').catch(() => [])
    ])
    pricing.value = p
    zones.value = Array.isArray(z) ? z : []
    hubPlans.value = Array.isArray(h) ? h : []
    if (pricing.value) {
      form.value.hours = Math.min(Math.max(form.value.hours, pricing.value.minHours || 1), pricing.value.maxHours || 8760)
    }
    if (!form.value.zone) form.value.zone = pickDefaultZone()
  } catch (e) { err.value = e.message } finally { loading.value = false }
}

function pickDefaultZone() {
  const onlineVN = zones.value.find((z) => z.id.startsWith('vn-') && (z.onlineNodes ?? 0) > 0)
  if (onlineVN) return onlineVN.id
  const anyOnline = zones.value.find((z) => (z.onlineNodes ?? 0) > 0)
  if (anyOnline) return anyOnline.id
  return zones.value[0]?.id || ''
}

const productTypes = computed(() => {
  if (!pricing.value) return []
  return [
    { id: 'ipv4', color: 'blue',  icon: Server, labelKey: 'cust.buy.t.ipv4', subKey: 'cust.buy.t.ipv4Sub', perHour: Number(pricing.value.ipv4?.perHour || 0) },
    { id: 'ipv6', color: 'green', icon: Globe,  labelKey: 'cust.buy.t.ipv6', subKey: 'cust.buy.t.ipv6Sub', perHour: Number(pricing.value.ipv6?.perHour || 0) }
  ]
})
const selectedProduct = computed(() => productTypes.value.find((p) => p.id === form.value.type) || productTypes.value[0] || null)
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const minHours = computed(() => Number(pricing.value?.minHours || 1))
const maxHours = computed(() => Number(pricing.value?.maxHours || 8760))

const hourPresets = [
  { hours: 1,   labelKey: 'cust.buy.h.1h' },
  { hours: 6,   labelKey: 'cust.buy.h.6h' },
  { hours: 24,  labelKey: 'cust.buy.h.1d' },
  { hours: 72,  labelKey: 'cust.buy.h.3d' },
  { hours: 168, labelKey: 'cust.buy.h.7d' },
  { hours: 720, labelKey: 'cust.buy.h.30d' }
]
const quantityPresets = [1, 5, 10, 20, 50, 100]

function selectType(id) { form.value.type = id }
function setHours(h) { form.value.hours = Math.max(minHours.value, Math.min(maxHours.value, Number(h) || 1)) }
function setQuantity(n) { form.value.quantity = Math.max(1, Math.min(254, Number(n) || 1)) }

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

const selectedZoneInfo = computed(() => zones.value.find((z) => z.id === form.value.zone) || null)
const selectedCountryCode = computed(() => (form.value.zone || '').slice(0, 2).toUpperCase() || 'GLOBAL')

const zoneCards = computed(() => zones.value.map((z) => ({
  id: z.id, name: z.name, sub: z.timezone || '',
  flag: (z.flag || z.id.slice(0, 2)).toUpperCase(),
  online: z.onlineNodes ?? 0,
  comingSoon: (z.onlineNodes ?? 0) === 0
})))
function selectZoneCard(card) { if (!card.comingSoon) form.value.zone = card.id }

function fmtMoney(n) { return Number(n || 0).toLocaleString(locale.value === 'vi' ? 'vi-VN' : 'en-US') }

// Login-gated checkout. Build query so /buy can resume the same selection.
function buyNow() {
  if (!form.value.zone) { err.value = t('cust.buy.errNoZone'); return }
  const q = {
    source: 'pool',
    type: form.value.type,
    country: form.value.zone,
    hours: String(form.value.hours),
    quantity: String(form.value.quantity)
  }
  if (form.value.autoRenew) q.autoRenew = '1'
  if (form.value.rotate) q.rotate = '1'
  if (token.value) router.push({ name: 'buy', query: q })
  else router.push({ name: 'login', query: { next: '/buy?' + new URLSearchParams(q).toString() } })
}

// ── Hub state ──
const hubZones = computed(() => {
  const byZone = new Map()
  for (const p of hubPlans.value) {
    if (!p.region) continue
    if (!byZone.has(p.region)) byZone.set(p.region, [])
    byZone.get(p.region).push(p)
  }
  return [...byZone.entries()].map(([id, plans]) => {
    const zoneInfo = zones.value.find((z) => z.id === id)
    return {
      id,
      name: zoneInfo?.name || id,
      sub: zoneInfo?.timezone || '',
      flag: zoneInfo?.flag || (id.slice(0, 2)).toUpperCase(),
      planCount: plans.length
    }
  })
})
const hubPlansForZone = computed(() => hubPlans.value.filter((p) => p.region === hubForm.value.zone))
const selectedHubPlan = computed(() => hubPlans.value.find((p) => p.id === hubForm.value.planId) || null)
function pickHubZone(zid) {
  hubForm.value.zone = zid
  if (!hubPlansForZone.value.some((p) => p.id === hubForm.value.planId)) {
    hubForm.value.planId = hubPlansForZone.value[0]?.id || null
  }
}
function pickHubPlan(p) { hubForm.value.planId = p.id }
function buyHub() {
  const p = selectedHubPlan.value
  if (!p) { err.value = locale.value === 'vi' ? 'Chọn 1 plan trước' : 'Pick a plan first'; return }
  const q = { source: 'hub', planId: p.id }
  if (token.value) router.push({ name: 'buy', query: q })
  else router.push({ name: 'login', query: { next: '/buy?' + new URLSearchParams(q).toString() } })
}

// ── OSS install command ──
const installCmd = 'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash'
const copied = ref(false)
async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCmd)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch (e) { /* ignore */ }
}

watch(() => route.query, () => {
  const src = String(route.query.source || '').toLowerCase()
  if (src === 'hub')  sourceMode.value = 'hub'
  if (src === 'oss')  sourceMode.value = 'oss'
  if (src === 'pool') sourceMode.value = 'pool'
}, { immediate: true })

onMounted(refresh)
</script>

<template>
  <div class="pricing-page">
    <PublicTopNav :sub-label="locale === 'vi' ? 'Giá' : 'Pricing'" />

    <main class="pricing-shell">
      <div class="pricing-hero">
        <span class="hero-pill">
          <span class="hero-dot"></span>
          {{ locale === 'vi' ? 'Bảng giá công khai · trả theo giờ · không phí ẩn' : 'Public pricing · pay by the hour · no hidden fees' }}
        </span>
        <h1>
          {{ locale === 'vi' ? 'Bảng giá' : 'Pricing' }}
          <span class="hero-accent">{{ locale === 'vi' ? 'minh bạch' : 'made simple' }}</span>
        </h1>
        <p class="sub">{{ locale === 'vi'
            ? 'Chọn loại proxy phù hợp — IPv4 / IPv6 trả theo giờ, Hub VPS thuê theo nhu cầu, hoặc panel mã nguồn mở miễn phí để tự host. Đăng nhập khi đặt mua.'
            : 'Pick the proxy type that fits — hourly IPv4 / IPv6, on-demand Hub VPS, or the free open-source panel for self-hosting. Sign in when you check out.' }}</p>
      </div>

      <!-- Source tabs — visual cards with price hints -->
      <div class="source-tabs">
        <button type="button" :class="{ active: sourceMode === 'pool' }" @click="sourceMode = 'pool'">
          <div class="st-icon st-icon-blue"><ShoppingCart :size="18" /></div>
          <div class="st-body">
            <div class="st-title">{{ locale === 'vi' ? 'Mua Proxy' : 'Buy Proxy' }}</div>
            <div class="st-sub">{{ locale === 'vi' ? 'IPv4 / IPv6 · từ' : 'IPv4 / IPv6 · from' }} <strong>{{ pricing ? fmtMoney(pricing.ipv6?.perHour || 291) : '—' }} {{ currencyCode }}</strong>/{{ locale === 'vi' ? 'giờ' : 'hr' }}</div>
          </div>
          <span class="st-check"><Check :size="14" /></span>
        </button>
        <button type="button" :class="{ active: sourceMode === 'hub' }" @click="sourceMode = 'hub'">
          <div class="st-icon st-icon-amber"><Cloud :size="18" /></div>
          <div class="st-body">
            <div class="st-title">{{ locale === 'vi' ? 'Hub Proxy' : 'Hub Proxy' }} <em class="badge-pro">PRO</em></div>
            <div class="st-sub">{{ locale === 'vi' ? 'Thuê VPS riêng · agent tự cài' : 'Rent a VPS · agent auto-installs' }}</div>
          </div>
          <span class="st-check"><Check :size="14" /></span>
        </button>
        <button type="button" :class="{ active: sourceMode === 'oss' }" @click="sourceMode = 'oss'">
          <div class="st-icon st-icon-green"><Cpu :size="18" /></div>
          <div class="st-body">
            <div class="st-title">Box Proxy <em class="badge-free">FREE</em></div>
            <div class="st-sub">{{ locale === 'vi' ? 'Mã nguồn mở · tự host VPS riêng' : 'Open source · self-host your own panel' }}</div>
          </div>
          <span class="st-check"><Check :size="14" /></span>
        </button>
      </div>

      <p v-if="err" class="error-text">{{ err }}</p>

      <!-- ── POOL: paid proxies (mirrors /customer/buy pool layout) ── -->
      <section v-if="sourceMode === 'pool'" class="pool-layout">
        <div class="pool-main">
          <!-- Step 1: zone -->
          <section class="surface">
            <div class="step-head">
              <span class="step-num">1</span>
              <h2><MapPin :size="15" /> {{ locale === 'vi' ? 'Chọn vị trí' : 'Pick location' }}</h2>
              <span class="step-help">{{ locale === 'vi' ? 'Phải chọn 1 quốc gia / zone cho proxy.' : 'You must pick a country/zone for the proxy.' }}</span>
            </div>
            <div v-if="loading" class="empty-text">{{ t('common.loading') || 'Loading…' }}</div>
            <div v-else class="zone-grid">
              <button v-for="z in zoneCards" :key="z.id" type="button"
                class="zone-card" :class="{ selected: form.zone === z.id, 'coming-soon': z.comingSoon }"
                :disabled="z.comingSoon" @click="selectZoneCard(z)">
                <span class="z-flag"><CountryFlag :code="z.flag" :size="28" /></span>
                <span class="z-text">
                  <strong>{{ z.name }}</strong>
                  <span class="z-sub" v-if="z.comingSoon">{{ locale === 'vi' ? 'Coming soon' : 'Coming soon' }}</span>
                  <span class="z-sub" v-else>{{ z.online }} node · {{ z.sub }}</span>
                </span>
                <Check v-if="form.zone === z.id" :size="14" class="z-check" />
              </button>
            </div>
          </section>

          <!-- Step 2: proxy type -->
          <section class="surface">
            <div class="step-head">
              <span class="step-num">2</span>
              <h2><Server :size="15" /> {{ locale === 'vi' ? 'Chọn loại proxy' : 'Pick proxy type' }}</h2>
              <span class="step-help">{{ locale === 'vi' ? 'IPv4 dùng khắp nơi; IPv6 phù hợp scraping / rotation.' : 'IPv4 works everywhere; IPv6 is great for scraping/rotation.' }}</span>
            </div>
            <div class="product-grid pool-types">
              <div v-for="p in productTypes" :key="p.id"
                class="product-card" :class="{ selected: form.type === p.id }"
                @click="selectType(p.id)">
                <div v-if="form.type === p.id" class="check-mark"><Check :size="14" /></div>
                <div class="head">
                  <span class="icon-box" :class="p.color"><component :is="p.icon" :size="22" /></span>
                  <div>
                    <h3>{{ p.id === 'ipv4' ? 'IPv4 proxy' : 'IPv6 proxy' }}</h3>
                    <p class="desc-sub">{{ p.id === 'ipv4'
                        ? (locale === 'vi' ? 'IPv4 datacenter · dedicated IP + port' : 'IPv4 datacenter · dedicated IP + port')
                        : (locale === 'vi' ? 'IPv6 /48 pool — sticky or rotating' : 'IPv6 /48 pool — sticky or rotating') }}</p>
                  </div>
                </div>
                <div class="price">
                  {{ locale === 'vi' ? 'Từ' : 'From' }}
                  <strong>{{ fmtMoney(p.perHour) }}</strong>
                  <small>{{ currencyCode }} / {{ locale === 'vi' ? 'giờ' : 'hour' }}</small>
                </div>
              </div>
            </div>
          </section>

          <!-- Step 3: config -->
          <section class="surface">
            <div class="step-head">
              <span class="step-num">3</span>
              <h2><Clock :size="15" /> {{ locale === 'vi' ? 'Cấu hình proxy' : 'Proxy configuration' }}</h2>
              <span class="step-help">{{ locale === 'vi' ? 'Thời lượng, số lượng.' : 'Duration, quantity.' }}</span>
            </div>
            <div class="form-grid" style="grid-template-columns: 1fr; gap: 14px">
              <label class="input-field" v-if="form.type === 'ipv6'">
                <span>{{ locale === 'vi' ? 'Phương thức' : 'Method' }} <Info :size="12" style="color: var(--muted); vertical-align: -2px" /></span>
                <select v-model="form.rotate">
                  <option :value="false">{{ locale === 'vi' ? 'Sticky' : 'Sticky' }}</option>
                  <option :value="true">{{ locale === 'vi' ? 'Rotating — đổi IP mỗi request' : 'Rotating — new IP per request' }}</option>
                </select>
              </label>
              <label class="check-line" style="padding: 6px 0">
                <input v-model="form.autoRenew" type="checkbox" />
                <span style="color: var(--text); font-size: 13px">{{ locale === 'vi' ? 'Auto-renew' : 'Auto-renew' }}</span>
                <span style="color: var(--muted); font-size: 11.5px; margin-left: 6px">{{ locale === 'vi' ? 'Trừ ví khi proxy sắp hết hạn' : 'Charge wallet when proxy nears expiry' }}</span>
              </label>
            </div>

            <!-- Hours -->
            <div style="margin-top: 8px">
              <label class="input-field" style="margin-bottom: 8px">
                <span>{{ locale === 'vi' ? 'Số giờ' : 'Hours' }} ({{ minHours }} – {{ maxHours }} h)</span>
              </label>
              <div class="slider-row">
                <input v-model.number="form.hours" type="range" :min="minHours" :max="Math.min(maxHours, 720)" step="1" class="slider-range" />
                <div class="num-stepper">
                  <button type="button" class="row-menu" @click="setHours(form.hours - 1)"><Minus :size="14" /></button>
                  <input v-model.number="form.hours" type="number" :min="minHours" :max="maxHours" class="num-input" />
                  <span class="num-unit">h</span>
                  <button type="button" class="row-menu" @click="setHours(form.hours + 1)"><Plus :size="14" /></button>
                </div>
              </div>
              <div class="chips" style="margin-top: 4px">
                <button v-for="h in hourPresets" :key="h.hours" type="button"
                  :class="{ active: form.hours === h.hours }" @click="setHours(h.hours)">
                  {{ h.hours === 1 ? (locale === 'vi' ? '1 giờ' : '1 hour') :
                     h.hours === 6 ? (locale === 'vi' ? '6 giờ' : '6 hours') :
                     h.hours === 24 ? (locale === 'vi' ? '1 ngày' : '24 hours') :
                     h.hours === 72 ? (locale === 'vi' ? '3 ngày' : '3 days') :
                     h.hours === 168 ? (locale === 'vi' ? '7 ngày' : '7 days') :
                     h.hours === 720 ? (locale === 'vi' ? '30 ngày' : '30 days') : (h.hours + 'h') }}
                </button>
              </div>
            </div>

            <!-- Quantity -->
            <div style="margin-top: 18px">
              <label class="input-field" style="margin-bottom: 8px">
                <span>{{ locale === 'vi' ? 'Số lượng / Volume' : 'Quantity / Volume' }} (1 – 254)</span>
              </label>
              <div class="slider-row">
                <input v-model.number="form.quantity" type="range" min="1" max="100" step="1" class="slider-range" />
                <div class="num-stepper">
                  <button type="button" class="row-menu" @click="setQuantity(form.quantity - 1)"><Minus :size="14" /></button>
                  <input v-model.number="form.quantity" type="number" min="1" max="254" class="num-input" />
                  <span class="num-unit">proxy</span>
                  <button type="button" class="row-menu" @click="setQuantity(form.quantity + 1)"><Plus :size="14" /></button>
                </div>
              </div>
              <div class="chips" style="margin-top: 4px">
                <button v-for="q in quantityPresets" :key="q" type="button"
                  :class="{ active: form.quantity === q }" @click="setQuantity(q)">{{ q }} proxy</button>
              </div>
            </div>

            <div style="margin-top: 14px; padding: 10px 14px; border: 1px dashed var(--border); border-radius: 10px; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px">
              <Sparkles :size="14" style="color: var(--blue)" />
              {{ form.zone
                  ? (locale === 'vi'
                      ? `Bạn sẽ nhận IP ngẫu nhiên từ ${selectedZoneInfo?.name || form.zone}. IP đổi theo phương thức đã chọn.`
                      : `You will receive random IPs from ${selectedZoneInfo?.name || form.zone}. IPs change according to the chosen method.`)
                  : (locale === 'vi' ? 'Chọn zone ở Step 1 trước.' : 'Pick a zone in Step 1 first.') }}
            </div>
          </section>

          <!-- Why-choose-us -->
          <section class="surface">
            <h2 style="color: var(--text); font-size: 16px; margin-bottom: 14px">{{ locale === 'vi' ? 'Tại sao chọn ProxyBox?' : 'Why choose ProxyBox?' }}</h2>
            <div class="why-choose" style="padding: 0; background: transparent; border: none">
              <div class="feature-card">
                <span class="ico"><ShieldCheck :size="18" /></span>
                <div>
                  <div class="lbl">{{ locale === 'vi' ? 'IP datacenter riêng' : 'Private datacenter IPs' }}</div>
                  <div class="desc-sub">{{ locale === 'vi' ? 'Datacenter riêng từng cổng, không dùng chung' : 'Dedicated datacenter IP per port, not shared' }}</div>
                </div>
              </div>
              <div class="feature-card">
                <span class="ico"><CheckCircle2 :size="18" /></span>
                <div>
                  <div class="lbl">{{ locale === 'vi' ? 'Tỷ lệ thành công cao' : 'High success rate' }}</div>
                  <div class="desc-sub">{{ locale === 'vi' ? 'Hoạt động ổn định, được đảm bảo' : 'Stable operation guaranteed' }}</div>
                </div>
              </div>
              <div class="feature-card">
                <span class="ico"><Clock :size="18" /></span>
                <div>
                  <div class="lbl">{{ locale === 'vi' ? 'Giá theo giờ minh bạch' : 'Transparent hourly pricing' }}</div>
                  <div class="desc-sub">{{ locale === 'vi' ? 'Trả đúng số giờ sử dụng, từ 1h' : 'Pay only for hours used, from 1h' }}</div>
                </div>
              </div>
              <div class="feature-card">
                <span class="ico"><Zap :size="18" /></span>
                <div>
                  <div class="lbl">{{ locale === 'vi' ? 'Hỗ trợ 24/7' : '24/7 support' }}</div>
                  <div class="desc-sub">{{ locale === 'vi' ? 'Đội ngũ hỗ trợ nhanh' : 'Fast support team' }}</div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- RIGHT: order summary -->
        <aside class="pool-aside">
          <div class="px-order-summary">
            <h3 style="margin: 0; color: var(--text); font-size: 15px; font-weight: 600">{{ locale === 'vi' ? 'Tóm tắt đơn hàng' : 'Order summary' }}</h3>
            <div class="divider"></div>
            <div class="sum-kv">
              <span class="k">{{ locale === 'vi' ? 'Loại' : 'Type' }}</span>
              <span class="v pxl">{{ selectedProduct ? (selectedProduct.id === 'ipv4' ? 'IPv4 proxy' : 'IPv6 proxy') : '—' }}</span>
            </div>
            <div class="sum-kv">
              <span class="k">{{ locale === 'vi' ? 'Quốc gia' : 'Country' }}</span>
              <span class="v" style="display: inline-flex; gap: 6px; align-items: center">
                <CountryFlag v-if="form.zone" :code="selectedCountryCode" :size="16" />
                {{ form.zone ? (selectedZoneInfo?.name || form.zone) : '—' }}
              </span>
            </div>
            <div class="sum-kv" v-if="form.type === 'ipv6'">
              <span class="k">{{ locale === 'vi' ? 'Phương thức' : 'Method' }}</span>
              <span class="v">{{ form.rotate ? (locale === 'vi' ? 'Rotating' : 'Rotating') : (locale === 'vi' ? 'Sticky' : 'Sticky') }}</span>
            </div>
            <div class="sum-kv"><span class="k">{{ locale === 'vi' ? 'Số giờ' : 'Hours' }}</span><span class="v">{{ form.hours }} h</span></div>
            <div class="sum-kv"><span class="k">{{ locale === 'vi' ? 'Số lượng / Volume' : 'Quantity / Volume' }}</span><span class="v">{{ form.quantity }} proxy</span></div>
            <div class="sum-kv">
              <span class="k">{{ locale === 'vi' ? 'Đơn giá' : 'Unit price' }}</span>
              <span class="v cell-mono">{{ fmtMoney(perHour) }} / h</span>
            </div>
            <div class="divider"></div>
            <div class="sum-kv">
              <span class="k">{{ locale === 'vi' ? 'Tạm tính' : 'Subtotal' }}</span>
              <span class="v cell-mono">{{ fmtMoney(base) }} {{ currencyCode }}</span>
            </div>
            <div class="sum-kv" v-if="tierDiscount > 0">
              <span class="k">{{ locale === 'vi' ? 'Giảm giá' : 'Discount' }} <small style="color: #4ade80">(-{{ (tierDiscount * 100).toFixed(0) }}%)</small></span>
              <span class="v cell-mono" style="color: #4ade80">-{{ fmtMoney(discountAmount) }}</span>
            </div>
            <div class="total">
              <span class="lbl">{{ locale === 'vi' ? 'Tổng' : 'Total' }}</span>
              <span class="val cell-mono">{{ fmtMoney(total) }} {{ currencyCode }}</span>
            </div>

            <button class="detail-action" type="button" :disabled="!form.zone" @click="buyNow">
              <Lock :size="15" /> {{ token ? (locale === 'vi' ? 'Thanh toán ngay' : 'Pay now') : (locale === 'vi' ? 'Đăng nhập để mua' : 'Sign in to buy') }}
            </button>

            <div v-if="!form.zone" style="color: #f87171; font-size: 12px; display: flex; align-items: center; gap: 6px; margin-top: 6px">
              <AlertCircle :size="13" /> {{ locale === 'vi' ? 'Bạn phải chọn quốc gia / zone trước.' : 'You must pick a country/zone first.' }}
            </div>
          </div>

          <div class="px-order-summary" style="margin-top: 12px">
            <h3 style="margin: 0; color: var(--text); font-size: 14px; font-weight: 600">{{ locale === 'vi' ? 'Chính sách' : 'Purchase policy' }}</h3>
            <ul class="policy-list">
              <li><Check :size="13" /> {{ locale === 'vi' ? 'Hoàn tiền 24h nếu không hài lòng' : '24h refund if not satisfied' }}</li>
              <li><Check :size="13" /> {{ locale === 'vi' ? 'IP chất lượng, hoạt động ổn định' : 'High-quality IPs, stable operation' }}</li>
              <li><Check :size="13" /> {{ locale === 'vi' ? 'Không giới hạn băng thông' : 'Unlimited bandwidth' }}</li>
              <li><Check :size="13" /> {{ locale === 'vi' ? 'Hỗ trợ đổi IP khi cần' : 'IP replacement support if needed' }}</li>
            </ul>
          </div>
        </aside>
      </section>

      <!-- ── HUB branch ── -->
      <section v-if="sourceMode === 'hub'" class="hub-layout">
        <div class="pool-main">
          <section class="surface">
            <div class="step-head">
              <span class="step-num">1</span>
              <h2><MapPin :size="15" /> {{ locale === 'vi' ? 'Chọn vị trí (zone)' : 'Pick zone' }}</h2>
              <span class="step-help">{{ locale === 'vi' ? 'Mỗi zone = 1 datacenter chạy Virtualizor backend.' : 'Each zone = a datacenter running a Virtualizor backend.' }}</span>
            </div>
            <div v-if="loading" class="empty-text">{{ t('common.loading') || 'Loading…' }}</div>
            <div v-else-if="!hubZones.length" class="empty-text" style="text-align: left; padding: 14px">
              {{ locale === 'vi'
                  ? 'Chưa có Hub plan công khai. Admin cần cấu hình Virtualizor + tạo plan trước.'
                  : 'No public Hub plans yet. Admin needs to wire up Virtualizor and create plans first.' }}
            </div>
            <div v-else class="zone-grid">
              <button v-for="z in hubZones" :key="z.id" type="button"
                class="zone-card" :class="{ selected: hubForm.zone === z.id }"
                @click="pickHubZone(z.id)">
                <span class="z-flag"><CountryFlag :code="z.flag" :size="28" /></span>
                <span class="z-text">
                  <strong>{{ z.name }}</strong>
                  <span class="z-sub">{{ z.planCount }} plan · {{ z.sub }}</span>
                </span>
                <Check v-if="hubForm.zone === z.id" :size="14" class="z-check" />
              </button>
            </div>
          </section>

          <section class="surface" v-if="hubPlansForZone.length">
            <div class="step-head">
              <span class="step-num">2</span>
              <h2><Cloud :size="15" /> {{ locale === 'vi' ? 'Chọn cấu hình' : 'Pick config' }}</h2>
              <span class="step-help">{{ locale === 'vi' ? 'Mỗi plan = 1 VPS template ở Virtualizor.' : 'Each plan = a VPS template in Virtualizor.' }}</span>
            </div>
            <div class="product-grid" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
              <div v-for="p in hubPlansForZone" :key="p.id"
                class="product-card" :class="{ selected: hubForm.planId === p.id }"
                @click="pickHubPlan(p)">
                <div v-if="hubForm.planId === p.id" class="check-mark"><Check :size="14" /></div>
                <div class="head">
                  <span class="icon-box" :class="p.family === 'ipv6' ? 'green' : 'blue'"><Cloud :size="22" /></span>
                  <div>
                    <h3>{{ p.name }}</h3>
                    <p class="desc-sub">Hub {{ (p.family || 'ipv4').toUpperCase() }} · {{ p.region }}</p>
                  </div>
                </div>
                <p v-if="p.description" class="feat"><Check :size="13" /> {{ p.description }}</p>
                <ul class="spec-list">
                  <li><strong>{{ p.specs?.cpu }}</strong> vCPU</li>
                  <li><strong>{{ p.specs?.ramGB }}</strong> GB RAM</li>
                  <li><strong>{{ p.specs?.diskGB }}</strong> GB Disk</li>
                  <li v-if="p.specs?.bandwidthGB"><strong>{{ p.specs.bandwidthGB }}</strong> GB BW/m</li>
                  <li v-if="p.specs?.ipv4Count"><strong>{{ p.specs.ipv4Count }}</strong> IPv4</li>
                  <li v-if="p.specs?.ipv6Range"><strong>{{ p.specs.ipv6Range }}</strong> IPv6</li>
                </ul>
                <div class="price">
                  {{ locale === 'vi' ? 'Từ' : 'From' }}
                  <strong>{{ fmtMoney(p.hourlyPrice) }}</strong>
                  <small>{{ p.currency }} / {{ locale === 'vi' ? 'giờ' : 'hour' }}</small>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside class="pool-aside" v-if="selectedHubPlan">
          <div class="px-order-summary">
            <h3 style="margin: 0; color: var(--text); font-size: 15px; font-weight: 600">{{ locale === 'vi' ? 'Tóm tắt Hub' : 'Hub summary' }}</h3>
            <div class="divider"></div>
            <div class="sum-kv"><span class="k">Plan</span><span class="v">{{ selectedHubPlan.name }}</span></div>
            <div class="sum-kv"><span class="k">{{ locale === 'vi' ? 'Quốc gia' : 'Region' }}</span><span class="v">{{ selectedHubPlan.region }}</span></div>
            <div class="sum-kv"><span class="k">vCPU</span><span class="v">{{ selectedHubPlan.specs?.cpu }}</span></div>
            <div class="sum-kv"><span class="k">RAM</span><span class="v">{{ selectedHubPlan.specs?.ramGB }} GB</span></div>
            <div class="sum-kv"><span class="k">Disk</span><span class="v">{{ selectedHubPlan.specs?.diskGB }} GB</span></div>
            <div class="divider"></div>
            <div class="total">
              <span class="lbl">{{ locale === 'vi' ? 'Giá theo giờ' : 'Hourly rate' }}</span>
              <span class="val cell-mono">{{ fmtMoney(selectedHubPlan.hourlyPrice) }} {{ selectedHubPlan.currency }}</span>
            </div>
            <button class="detail-action" type="button" @click="buyHub">
              <Cloud :size="15" /> {{ token ? (locale === 'vi' ? 'Thuê Hub' : 'Rent Hub') : (locale === 'vi' ? 'Đăng nhập để thuê' : 'Sign in to rent') }}
            </button>
          </div>
        </aside>
      </section>

      <!-- ── OSS branch ── -->
      <section v-if="sourceMode === 'oss'" class="oss-section">
        <section class="surface oss-card">
          <div class="oss-head">
            <span class="oss-tag">FREE FOREVER · MIT</span>
            <h2>Box Proxy</h2>
            <p>{{ locale === 'vi'
                ? 'Toàn bộ panel ProxyBox — đóng gói thành mã nguồn mở miễn phí để bạn tự host trên VPS của bạn. Customer của BẠN enroll thẳng về panel của BẠN.'
                : 'The full ProxyBox panel — packaged as a free open-source distribution you self-host on your own VPS. YOUR customers enrol directly into YOUR panel.' }}</p>
          </div>
          <div class="oss-price-row">
            <div class="oss-price"><strong>$0</strong><small>/ {{ locale === 'vi' ? 'mãi mãi' : 'forever' }}</small></div>
            <div class="oss-install">
              <div class="oss-install-head">
                <span class="hero-card-dots">
                  <span class="hero-card-dot red"></span>
                  <span class="hero-card-dot yellow"></span>
                  <span class="hero-card-dot green"></span>
                </span>
                <span class="oss-install-title">install.sh — Ubuntu / Debian</span>
                <button class="copy-btn" type="button" @click="copyInstall">
                  <component :is="copied ? CheckIcon : Copy" :size="13" />
                  <span class="copy-label">{{ copied ? (locale === 'vi' ? 'Đã copy' : 'Copied') : 'Copy' }}</span>
                </button>
              </div>
              <pre class="oss-code"><code><span class="prompt">$</span> {{ installCmd }}</code></pre>
            </div>
          </div>
          <div class="oss-actions">
            <RouterLink class="detail-action" to="/faq#self-host-panel">
              {{ locale === 'vi' ? 'Hướng dẫn cài A→Z' : 'Full install guide' }} <ArrowRight :size="14" />
            </RouterLink>
            <RouterLink class="ghost-button" to="/faq#self-host-trust">
              <ShieldCheck :size="14" /> {{ locale === 'vi' ? 'Bảo mật installer' : 'Installer security' }}
            </RouterLink>
            <RouterLink class="ghost-button" to="/changelog">
              <ExternalLink :size="14" /> {{ locale === 'vi' ? 'Lịch sử phát hành' : 'Changelog' }}
            </RouterLink>
          </div>
        </section>

        <section class="surface">
          <h2 style="color: var(--text); font-size: 16px; margin-bottom: 14px">{{ locale === 'vi' ? 'Bao gồm trong Box Proxy' : 'Included in Box Proxy' }}</h2>
          <div class="why-choose" style="padding: 0; background: transparent; border: none">
            <div class="feature-card">
              <span class="ico"><ShieldCheck :size="18" /></span>
              <div>
                <div class="lbl">MIT licence</div>
                <div class="desc-sub">{{ locale === 'vi' ? 'Source 100% public — audit mọi dòng' : '100% open source — audit every line' }}</div>
              </div>
            </div>
            <div class="feature-card">
              <span class="ico"><Server :size="18" /></span>
              <div>
                <div class="lbl">BYON + Hub Proxy</div>
                <div class="desc-sub">{{ locale === 'vi' ? 'Customer cài 1 lệnh hoặc thuê VPS theo giờ' : 'Customer pastes one command or rents hourly VPS' }}</div>
              </div>
            </div>
            <div class="feature-card">
              <span class="ico"><Globe :size="18" /></span>
              <div>
                <div class="lbl">IPv4 + IPv6 /48</div>
                <div class="desc-sub">{{ locale === 'vi' ? 'Strict family egress — không leak A/AAAA' : 'Strict family egress — no A/AAAA leaks' }}</div>
              </div>
            </div>
            <div class="feature-card">
              <span class="ico"><Zap :size="18" /></span>
              <div>
                <div class="lbl">{{ locale === 'vi' ? 'Tự upgrade 1-click' : 'One-click self-upgrade' }}</div>
                <div class="desc-sub">{{ locale === 'vi' ? '/admin/settings → Upgrade pull git + restart' : '/admin/settings → Upgrade pulls git + restarts' }}</div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>

    <footer class="pricing-foot">
      <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
      <span class="foot-onie">
        {{ t('landing.foot.publishedBy') }}
        <a href="https://proxybox.pro" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
        · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
      </span>
      <span>
        <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
        <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink> ·
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.pricing-page {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}
.pricing-page * { box-sizing: border-box; }

.pricing-shell {
  max-width: 1240px;
  margin: 0 auto;
  padding: 56px 32px 72px;
}

/* Hero */
.pricing-hero { text-align: center; margin-bottom: 36px; }
.hero-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  background: color-mix(in srgb, var(--green-soft) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
  border-radius: 999px;
  font-size: 12px; font-weight: 600; color: var(--green);
  letter-spacing: 0.2px;
  margin-bottom: 18px;
}
.hero-dot {
  width: 7px; height: 7px; border-radius: 999px;
  background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.6; transform: scale(0.85); }
}
.pricing-hero h1 {
  margin: 0 0 14px;
  font-size: clamp(36px, 5vw, 56px); font-weight: 800;
  letter-spacing: -1.2px; line-height: 1.05;
}
.hero-accent {
  background: linear-gradient(120deg, #58a6ff 0%, #3fb950 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.pricing-shell .sub {
  color: var(--dim); font-size: 16px;
  margin: 0 auto 32px; max-width: 640px; line-height: 1.6;
}

/* Source tabs — modern card switcher */
.source-tabs {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px; margin-bottom: 26px;
}
.source-tabs button {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text); cursor: pointer;
  text-align: left; transition: 0.2s;
  position: relative; overflow: hidden;
}
.source-tabs button::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--green) 6%, transparent) 100%);
  opacity: 0; transition: opacity 0.2s;
}
.source-tabs button:hover { border-color: color-mix(in srgb, var(--green) 35%, var(--border)); transform: translateY(-1px); }
.source-tabs button.active {
  border-color: var(--green);
  background: color-mix(in srgb, var(--surface) 90%, var(--green-soft) 10%);
  box-shadow: 0 0 0 1px var(--green), 0 8px 24px rgba(63, 185, 80, 0.12);
}
.source-tabs button.active::before { opacity: 1; }
.st-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: inline-grid; place-items: center;
  flex-shrink: 0;
}
.st-icon-blue  { background: var(--blue-soft);  color: var(--blue);   border: 1px solid color-mix(in srgb, var(--blue) 30%, var(--border)); }
.st-icon-amber { background: var(--yellow-soft); color: var(--yellow); border: 1px solid color-mix(in srgb, var(--yellow) 30%, var(--border)); }
.st-icon-green { background: var(--green-soft); color: var(--green);  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border)); }
.st-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; position: relative; }
.st-title { font-size: 15px; font-weight: 700; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.st-sub { font-size: 12.5px; color: var(--dim); }
.st-sub strong { color: var(--text); font-family: var(--mono); font-weight: 600; }
.st-check {
  position: absolute; top: 12px; right: 14px;
  width: 22px; height: 22px; border-radius: 999px;
  background: var(--green); color: #0a0e14;
  display: inline-grid; place-items: center;
  opacity: 0; transform: scale(0.6);
  transition: 0.2s;
}
.source-tabs button.active .st-check { opacity: 1; transform: scale(1); }
.badge-pro, .badge-free {
  font-style: normal; font-size: 9.5px; font-weight: 700;
  padding: 1px 5px; border-radius: 3px; letter-spacing: 0.3px;
  margin-left: 4px; vertical-align: 1px;
}
.badge-pro { background: var(--yellow-soft); color: var(--yellow); }
.badge-free { background: var(--green-soft); color: var(--green); }

/* Pool layout */
.pool-layout, .hub-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 22px;
  align-items: start;
}
.pool-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pool-aside { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 86px; }

/* Override global surface for a richer card look */
.pool-main :deep(.surface) {
  padding: 22px 24px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent) inset;
}
.pool-main :deep(.step-head) {
  margin-bottom: 18px;
  align-items: center;
  gap: 12px;
}
.pool-main :deep(.step-num) {
  width: 30px; height: 30px;
  border-radius: 999px;
  font-size: 13px; font-weight: 700;
  background: linear-gradient(135deg, #58a6ff, #3fb950);
  color: #0a0e14;
  box-shadow: 0 4px 12px rgba(63, 185, 80, 0.25);
  display: inline-grid; place-items: center;
}
.pool-main :deep(.step-head h2) {
  font-size: 16px; font-weight: 700;
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0;
}
.pool-main :deep(.step-help) {
  margin-left: auto; font-size: 11.5px; color: var(--dim);
}

.error-text { color: var(--red); font-size: 13px; padding: 12px 16px; background: var(--red-soft); border-radius: 8px; margin-bottom: 14px; border: 1px solid color-mix(in srgb, var(--red) 25%, transparent); }
.empty-text { color: var(--dim); font-size: 13px; padding: 28px 0; text-align: center; }

/* Zone grid — modern */
.zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.zone-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; color: var(--text); cursor: pointer;
  text-align: left; transition: 0.18s ease;
  position: relative;
  min-height: 64px;
}
.zone-card:hover:not(.coming-soon) {
  border-color: var(--green);
  background: color-mix(in srgb, var(--surface-2) 70%, var(--green-soft) 30%);
  transform: translateY(-1px);
}
.zone-card.selected {
  border-color: var(--green);
  background: linear-gradient(135deg, var(--green-soft) 0%, color-mix(in srgb, var(--green-soft) 60%, transparent) 100%);
  box-shadow: 0 0 0 1px var(--green), 0 4px 12px rgba(63, 185, 80, 0.15);
}
.zone-card.coming-soon {
  opacity: 0.55; cursor: not-allowed;
  background: var(--surface);
  border-style: dashed;
}
.zone-card.coming-soon .z-text strong { color: var(--dim); font-weight: 500; }
.zone-card .z-flag {
  width: 36px; height: 36px;
  display: inline-grid; place-items: center;
  background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: 8px; flex-shrink: 0;
}
.zone-card .z-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.zone-card .z-text strong { font-size: 13px; font-weight: 600; line-height: 1.25; }
.zone-card .z-sub { font-size: 11px; color: var(--dim); }
.zone-card .z-check {
  position: absolute; top: 10px; right: 10px;
  width: 20px; height: 20px; border-radius: 999px;
  background: var(--green); color: #0a0e14;
  display: inline-grid; place-items: center;
}

.check-mark {
  position: absolute; top: 14px; right: 14px;
  width: 24px; height: 24px; border-radius: 999px;
  background: var(--green); color: #0a0e14;
  display: inline-grid; place-items: center;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 20%, transparent);
}

/* Proxy type cards — richer */
.pool-main :deep(.product-grid) {
  gap: 14px;
}
.pool-main :deep(.product-card) {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  transition: 0.18s ease;
  cursor: pointer;
  position: relative;
}
.pool-main :deep(.product-card:hover) {
  border-color: color-mix(in srgb, var(--green) 35%, var(--border));
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
}
.pool-main :deep(.product-card.selected) {
  border-color: var(--green);
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-2) 80%, var(--green-soft) 20%) 0%, var(--surface-2) 100%);
  box-shadow: 0 0 0 1px var(--green), 0 8px 24px rgba(63, 185, 80, 0.12);
}
.pool-main :deep(.product-card .icon-box) {
  width: 44px; height: 44px;
  border-radius: 10px;
  border: 1px solid;
}
.pool-main :deep(.product-card .icon-box.blue) {
  background: var(--blue-soft); color: var(--blue); border-color: color-mix(in srgb, var(--blue) 30%, var(--border));
}
.pool-main :deep(.product-card .icon-box.green) {
  background: var(--green-soft); color: var(--green); border-color: color-mix(in srgb, var(--green) 30%, var(--border));
}
.pool-main :deep(.product-card h3) { margin: 0 0 4px; font-size: 16px; font-weight: 700; }
.pool-main :deep(.product-card .desc-sub) { font-size: 12.5px; color: var(--dim); margin: 0; }
.pool-main :deep(.product-card .price) {
  margin-top: 14px; padding-top: 14px;
  border-top: 1px dashed var(--border-soft);
  display: flex; align-items: baseline; gap: 6px;
  font-size: 11.5px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.5px;
}
.pool-main :deep(.product-card .price strong) {
  font-size: 22px; color: var(--text); font-family: var(--mono); font-weight: 700;
  letter-spacing: -0.5px;
}
.pool-main :deep(.product-card .price small) {
  font-size: 11px; color: var(--dim); text-transform: none; letter-spacing: 0;
}

/* Custom check-line (auto-renew) */
.pool-main :deep(.check-line) {
  display: inline-flex; align-items: center; gap: 10px;
  cursor: pointer;
  padding: 10px 14px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px;
  transition: 0.15s;
  width: 100%;
}
.pool-main :deep(.check-line:hover) { border-color: var(--green); }
.pool-main :deep(.check-line input[type="checkbox"]) {
  appearance: none;
  width: 18px; height: 18px;
  border: 1.5px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  cursor: pointer;
  position: relative;
  transition: 0.15s;
  flex-shrink: 0;
}
.pool-main :deep(.check-line input[type="checkbox"]:checked) {
  background: var(--green); border-color: var(--green);
}
.pool-main :deep(.check-line input[type="checkbox"]:checked::after) {
  content: '';
  position: absolute; left: 5px; top: 1px;
  width: 4px; height: 9px;
  border: solid #0a0e14;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* Sliders */
.pool-main :deep(.slider-row) {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 10px;
}
.pool-main :deep(.slider-range) {
  flex: 1; min-width: 0;
  -webkit-appearance: none; appearance: none;
  height: 6px;
  background: var(--surface-2);
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.pool-main :deep(.slider-range::-webkit-slider-thumb) {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px;
  border-radius: 999px;
  background: linear-gradient(135deg, #58a6ff, #3fb950);
  cursor: grab;
  border: 2px solid var(--bg);
  box-shadow: 0 2px 8px rgba(63, 185, 80, 0.35);
  transition: 0.15s;
}
.pool-main :deep(.slider-range::-webkit-slider-thumb:hover) { transform: scale(1.15); }
.pool-main :deep(.slider-range::-webkit-slider-thumb:active) { cursor: grabbing; }
.pool-main :deep(.slider-range::-moz-range-thumb) {
  width: 18px; height: 18px; border-radius: 999px;
  background: linear-gradient(135deg, #58a6ff, #3fb950);
  border: 2px solid var(--bg);
  cursor: grab;
}
.pool-main :deep(.num-stepper) {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 2px;
}
.pool-main :deep(.num-stepper .row-menu) {
  width: 26px; height: 26px; border-radius: 5px;
  background: transparent; border: none;
  color: var(--dim); cursor: pointer;
  display: inline-grid; place-items: center;
}
.pool-main :deep(.num-stepper .row-menu:hover) { background: var(--surface); color: var(--text); }
.pool-main :deep(.num-input) {
  background: transparent; border: none; outline: none;
  width: 50px; text-align: center;
  color: var(--text); font-family: var(--mono); font-size: 13px; font-weight: 600;
}
.pool-main :deep(.num-unit) {
  font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.5px;
  margin-right: 4px;
}

/* Chip presets */
.pool-main :deep(.chips) {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.pool-main :deep(.chips button) {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--dim);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px; font-weight: 500;
  cursor: pointer; transition: 0.15s;
}
.pool-main :deep(.chips button:hover) {
  color: var(--text); border-color: var(--green);
}
.pool-main :deep(.chips button.active) {
  background: var(--green-soft);
  border-color: var(--green);
  color: var(--green);
  font-weight: 600;
}

/* Input field labels */
.pool-main :deep(.input-field span) {
  font-size: 10.5px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
}
.pool-main :deep(.input-field input),
.pool-main :deep(.input-field select) {
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 9px 12px; border-radius: 8px;
  color: var(--text); font-size: 13px;
  outline: none; transition: 0.15s;
}
.pool-main :deep(.input-field input:focus),
.pool-main :deep(.input-field select:focus) {
  border-color: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 15%, transparent);
}

/* OSS section */
.oss-section { display: flex; flex-direction: column; gap: 14px; }
.oss-card.surface {
  border-color: var(--green);
  background: linear-gradient(160deg, var(--surface) 0%, color-mix(in srgb, var(--green-soft) 60%, transparent) 100%);
}
.oss-tag {
  display: inline-block; padding: 3px 10px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
  background: var(--green-soft); color: var(--green);
  border-radius: 999px; margin-bottom: 12px;
}
.oss-card h2 { margin: 0 0 8px; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
.oss-card p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
.oss-price-row {
  display: grid; grid-template-columns: auto 1fr;
  gap: 20px; margin: 18px 0;
  align-items: center;
}
.oss-price { display: flex; align-items: baseline; gap: 6px; }
.oss-price strong { font-size: 48px; font-weight: 800; line-height: 1; color: var(--green); }
.oss-price small { font-size: 13px; color: var(--muted); }
.oss-install {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden;
}
.oss-install-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.hero-card-dots { display: inline-flex; gap: 5px; flex-shrink: 0; }
.hero-card-dot { width: 8px; height: 8px; border-radius: 999px; }
.hero-card-dot.red { background: var(--red); }
.hero-card-dot.yellow { background: var(--yellow); }
.hero-card-dot.green { background: var(--green); }
.oss-install-title { flex: 1; min-width: 0; font-size: 11.5px; color: var(--muted); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-btn {
  flex-shrink: 0;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--muted); padding: 4px 9px; border-radius: 5px;
  font-size: 10.5px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.copy-btn:hover { color: var(--text); border-color: var(--blue); }
.oss-code {
  margin: 0; padding: 14px 14px;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.55;
  color: var(--text); overflow-x: auto; white-space: pre;
  -webkit-overflow-scrolling: touch;
}
.oss-code .prompt { color: var(--green); margin-right: 8px; }
.oss-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.oss-actions .detail-action, .oss-actions .ghost-button {
  padding: 9px 14px; font-size: 13px;
}

/* Order summary aside polish */
.pool-aside :deep(.px-order-summary) {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px;
  position: relative; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.pool-aside :deep(.px-order-summary)::before {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, #58a6ff 0%, #3fb950 100%);
}
.pool-aside :deep(.px-order-summary h3) {
  margin: 0 0 14px;
  font-size: 13px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 1px; font-weight: 700;
}
.pool-aside :deep(.divider) {
  height: 1px; background: var(--border-soft);
  margin: 14px 0;
}
.pool-aside :deep(.sum-kv) {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0; font-size: 13px;
}
.pool-aside :deep(.sum-kv .k) { color: var(--dim); }
.pool-aside :deep(.sum-kv .v) {
  color: var(--text); font-weight: 600;
  text-align: right;
}
.pool-aside :deep(.sum-kv .v.pxl) { color: var(--green); }
.pool-aside :deep(.total) {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 14px 16px; margin: 8px -4px 14px;
  background: linear-gradient(135deg, var(--green-soft) 0%, color-mix(in srgb, var(--green-soft) 60%, transparent) 100%);
  border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
  border-radius: 10px;
}
.pool-aside :deep(.total .lbl) {
  font-size: 12px; color: var(--green); font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px;
}
.pool-aside :deep(.total .val) {
  font-size: 24px; font-weight: 800; color: var(--text);
  font-family: var(--mono); letter-spacing: -0.5px;
}
.pool-aside :deep(.detail-action) {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #3fb950 0%, #2e9c40 100%);
  color: #0a0e14;
  border: none; border-radius: 10px;
  font-size: 14px; font-weight: 700;
  cursor: pointer;
  transition: 0.18s;
  box-shadow: 0 4px 16px rgba(63, 185, 80, 0.3);
  letter-spacing: 0.2px;
}
.pool-aside :deep(.detail-action:hover:not(:disabled)) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(63, 185, 80, 0.45);
  filter: brightness(1.05);
}
.pool-aside :deep(.detail-action:disabled) {
  opacity: 0.5; cursor: not-allowed; box-shadow: none;
}

/* Policy list */
.policy-list { list-style: none; padding: 0; margin: 10px 0 0; }
.policy-list li {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 0; font-size: 12.5px; color: var(--text); line-height: 1.5;
}
.policy-list li svg {
  color: var(--green); flex-shrink: 0; margin-top: 3px;
  background: var(--green-soft); border-radius: 999px;
  padding: 2px; width: 18px; height: 18px;
}

/* Hub spec list */
.spec-list { list-style: none; padding: 0; margin: 6px 0 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
.spec-list li { display: inline-block; }
.spec-list li strong { color: var(--text); font-family: var(--mono); margin-right: 3px; }
.feat { margin: 0 0 8px; font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
.feat svg { color: var(--green); }

/* Pricing-page footer */
.pricing-foot {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px;
  padding: 24px 28px;
  max-width: 1240px; margin: 0 auto;
  border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 12px;
}
.pricing-foot a {
  color: var(--dim); text-decoration: none;
}
.pricing-foot a:hover { color: var(--text); }
.foot-onie a { color: var(--text); text-decoration: none; font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* ── Tablet ── */
@media (max-width: 980px) {
  .pricing-shell { padding: 24px 18px 60px; }
  .pricing-shell h1 { font-size: 26px; }
  .source-tabs { grid-template-columns: 1fr; gap: 6px; padding: 5px; }
  .source-tabs button { padding: 10px 12px; }
  .pool-layout, .hub-layout { grid-template-columns: 1fr; gap: 14px; }
  .pool-aside { position: static; order: 2; }
  .pool-main { order: 1; }
  .zone-grid { grid-template-columns: 1fr 1fr; }
  .oss-price-row { grid-template-columns: 1fr; gap: 14px; }
  .oss-price strong { font-size: 40px; }
  .pricing-foot { flex-direction: column; align-items: flex-start; padding: 20px 18px; }
}
/* ── Phone ── */
@media (max-width: 640px) {
  .pricing-shell { padding: 20px 14px 50px; }
  .pricing-shell h1 { font-size: 22px; }
  .pricing-shell .sub { font-size: 13.5px; }
  .source-tabs button strong { font-size: 13px; }
  .source-tabs button small { font-size: 10.5px; }
  .zone-grid { grid-template-columns: 1fr; }
  .zone-card { padding: 9px 11px; min-height: 50px; }
  .zone-card .z-flag { width: 28px; height: 28px; }
  .pool-main :deep(.surface) { padding: 14px 14px; }
  .oss-card h2 { font-size: 20px; }
  .copy-btn .copy-label { display: none; }
  .oss-actions { flex-direction: column; align-items: stretch; }
  .pricing-foot { padding: 18px 14px; font-size: 11.5px; }
}
</style>
