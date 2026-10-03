<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Empty, Grid } from 'ant-design-vue'
import { CloudServerOutlined, GlobalOutlined } from '@ant-design/icons-vue'
import CountryFlag from '../components/CountryFlag.vue'
import PublicTopNav from '../components/PublicTopNav.vue'
import { apiFetch, token } from '../api'
import { useI18n } from '../i18n'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const screens = Grid.useBreakpoint()
const simpleEmpty = Empty.PRESENTED_IMAGE_SIMPLE

const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const sourceMode = ref('pool') // 'pool' | 'hub' | 'oss'
const sourceOptions = [{ value: 'pool' }, { value: 'hub' }, { value: 'oss' }]

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
    { id: 'ipv4', color: 'blue',  icon: CloudServerOutlined, labelKey: 'cust.buy.t.ipv4', subKey: 'cust.buy.t.ipv4Sub', perHour: Number(pricing.value.ipv4?.perHour || 0) },
    { id: 'ipv6', color: 'green', icon: GlobalOutlined,      labelKey: 'cust.buy.t.ipv6', subKey: 'cust.buy.t.ipv6Sub', perHour: Number(pricing.value.ipv6?.perHour || 0) }
  ]
})
const selectedProduct = computed(() => productTypes.value.find((p) => p.id === form.value.type) || productTypes.value[0] || null)
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const minHours = computed(() => Number(pricing.value?.minHours || 1))
const maxHours = computed(() => Number(pricing.value?.maxHours || 8760))

const hourPresets = [1, 6, 24, 72, 168, 720]
const quantityPresets = [1, 5, 10, 20, 50, 100]
function hourLabel(h) {
  const vi = locale.value === 'vi'
  if (h === 1) return vi ? '1 giờ' : '1 hour'
  if (h === 6) return vi ? '6 giờ' : '6 hours'
  if (h === 24) return vi ? '1 ngày' : '24 hours'
  if (h === 72) return vi ? '3 ngày' : '3 days'
  if (h === 168) return vi ? '7 ngày' : '7 days'
  if (h === 720) return vi ? '30 ngày' : '30 days'
  return h + 'h'
}
const hourOptions = computed(() => hourPresets.map((h) => ({ value: h, label: hourLabel(h) })))
const quantityOptions = quantityPresets.map((q) => ({ value: q, label: `${q} proxy` }))
const rotateOptions = computed(() => [
  { value: false, label: 'Sticky' },
  { value: true, label: locale.value === 'vi' ? 'Rotating — đổi IP mỗi request' : 'Rotating — new IP per request' }
])

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
  <a-layout class="pricing-page">
    <PublicTopNav :sub-label="locale === 'vi' ? 'Giá' : 'Pricing'" />

    <a-layout-content>
      <main class="container pricing-shell">
        <!-- Hero -->
        <div class="pricing-hero">
          <a-tag color="success" class="hero-pill">
            <a-badge status="processing" color="green" />
            {{ locale === 'vi' ? 'Bảng giá công khai · trả theo giờ · không phí ẩn' : 'Public pricing · pay by the hour · no hidden fees' }}
          </a-tag>
          <a-typography-title class="hero-title">
            {{ locale === 'vi' ? 'Bảng giá' : 'Pricing' }}
            <span class="accent">{{ locale === 'vi' ? 'minh bạch' : 'made simple' }}</span>
          </a-typography-title>
          <a-typography-paragraph type="secondary" class="hero-sub">
            {{ locale === 'vi'
              ? 'Chọn loại proxy phù hợp — IPv4 / IPv6 trả theo giờ, Hub VPS thuê theo nhu cầu, hoặc panel mã nguồn mở miễn phí để tự host. Đăng nhập khi đặt mua.'
              : 'Pick the proxy type that fits — hourly IPv4 / IPv6, on-demand Hub VPS, or the free open-source panel for self-hosting. Sign in when you check out.' }}
          </a-typography-paragraph>
        </div>

        <!-- Source switcher -->
        <a-segmented v-model:value="sourceMode" :options="sourceOptions" block size="large" class="source-tabs">
          <template #label="{ value }">
            <a-flex :vertical="!screens.sm" align="center" :gap="screens.sm ? 12 : 6" class="st">
              <a-avatar shape="square" :size="screens.sm ? 40 : 32" class="ico" :class="value === 'pool' ? 'ico-blue' : value === 'hub' ? 'ico-amber' : 'ico-green'">
                <template #icon>
                  <ShoppingCartOutlined v-if="value === 'pool'" />
                  <CloudOutlined v-else-if="value === 'hub'" />
                  <CodeOutlined v-else />
                </template>
              </a-avatar>
              <div class="st-body">
                <div class="st-title">
                  <template v-if="value === 'pool'">{{ locale === 'vi' ? 'Mua Proxy' : 'Buy Proxy' }}</template>
                  <template v-else-if="value === 'hub'">Hub Proxy <a-tag color="warning" :bordered="false" class="st-badge">PRO</a-tag></template>
                  <template v-else>Box Proxy <a-tag color="success" :bordered="false" class="st-badge">FREE</a-tag></template>
                </div>
                <div v-if="screens.sm" class="st-sub">
                  <template v-if="value === 'pool'">
                    {{ locale === 'vi' ? 'IPv4 / IPv6 · từ' : 'IPv4 / IPv6 · from' }}
                    <strong class="mono">{{ pricing ? fmtMoney(pricing.ipv6?.perHour || 291) : '—' }} {{ currencyCode }}</strong>/{{ locale === 'vi' ? 'giờ' : 'hr' }}
                  </template>
                  <template v-else-if="value === 'hub'">{{ locale === 'vi' ? 'Thuê VPS riêng · agent tự cài' : 'Rent a VPS · agent auto-installs' }}</template>
                  <template v-else>{{ locale === 'vi' ? 'Mã nguồn mở · tự host VPS riêng' : 'Open source · self-host your own panel' }}</template>
                </div>
              </div>
            </a-flex>
          </template>
        </a-segmented>

        <a-alert v-if="err" type="error" show-icon closable :message="err" class="err-alert" @close="err = ''" />

        <!-- ── POOL: paid proxies (mirrors /customer/buy pool layout) ── -->
        <a-row v-if="sourceMode === 'pool'" :gutter="[24, 24]">
          <a-col :xs="24" :lg="16">
            <a-flex vertical gap="middle">
              <!-- Step 1: zone -->
              <a-card>
                <template #title>
                  <a-flex align="center" gap="small">
                    <a-avatar :size="26" class="step-num">1</a-avatar>
                    <a-typography-title :level="2" class="card-h"><EnvironmentOutlined /> {{ locale === 'vi' ? 'Chọn vị trí' : 'Pick location' }}</a-typography-title>
                  </a-flex>
                </template>
                <a-typography-paragraph type="secondary" class="step-help">{{ locale === 'vi' ? 'Phải chọn 1 quốc gia / zone cho proxy.' : 'You must pick a country/zone for the proxy.' }}</a-typography-paragraph>
                <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 2 }" />
                <a-empty v-else-if="!zoneCards.length" :image="simpleEmpty" />
                <a-row v-else :gutter="[12, 12]">
                  <a-col v-for="z in zoneCards" :key="z.id" :xs="24" :sm="12">
                    <a-card
                      size="small"
                      :hoverable="!z.comingSoon"
                      class="pick"
                      :class="{ 'is-selected': form.zone === z.id, 'is-disabled': z.comingSoon }"
                      role="button"
                      :tabindex="z.comingSoon ? -1 : 0"
                      :aria-pressed="form.zone === z.id"
                      :aria-disabled="z.comingSoon"
                      @click="selectZoneCard(z)"
                      @keydown.enter.prevent="selectZoneCard(z)"
                    >
                      <a-flex align="center" gap="middle">
                        <CountryFlag :code="z.flag" :size="28" />
                        <div class="pick-text">
                          <a-typography-text strong>{{ z.name }}</a-typography-text>
                          <a-tag v-if="z.comingSoon" :bordered="false" class="pick-tag">Coming soon</a-tag>
                          <a-typography-text v-else type="secondary" class="pick-sub">{{ z.online }} node · {{ z.sub }}</a-typography-text>
                        </div>
                        <CheckCircleFilled v-if="form.zone === z.id" class="pick-check" />
                      </a-flex>
                    </a-card>
                  </a-col>
                </a-row>
              </a-card>

              <!-- Step 2: proxy type -->
              <a-card>
                <template #title>
                  <a-flex align="center" gap="small">
                    <a-avatar :size="26" class="step-num">2</a-avatar>
                    <a-typography-title :level="2" class="card-h"><CloudServerOutlined /> {{ locale === 'vi' ? 'Chọn loại proxy' : 'Pick proxy type' }}</a-typography-title>
                  </a-flex>
                </template>
                <a-typography-paragraph type="secondary" class="step-help">{{ locale === 'vi' ? 'IPv4 dùng khắp nơi; IPv6 phù hợp scraping / rotation.' : 'IPv4 works everywhere; IPv6 is great for scraping/rotation.' }}</a-typography-paragraph>
                <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 3 }" />
                <a-row v-else :gutter="[12, 12]">
                  <a-col v-for="p in productTypes" :key="p.id" :xs="24" :sm="12">
                    <a-card
                      hoverable
                      class="pick"
                      :class="{ 'is-selected': form.type === p.id }"
                      role="button"
                      tabindex="0"
                      :aria-pressed="form.type === p.id"
                      @click="selectType(p.id)"
                      @keydown.enter.prevent="selectType(p.id)"
                    >
                      <a-flex align="center" gap="middle">
                        <a-avatar shape="square" :size="44" class="ico" :class="`ico-${p.color}`"><template #icon><component :is="p.icon" /></template></a-avatar>
                        <div class="pick-text">
                          <a-typography-title :level="3" class="card-h3">{{ p.id === 'ipv4' ? 'IPv4 proxy' : 'IPv6 proxy' }}</a-typography-title>
                          <a-typography-text type="secondary" class="pick-sub">{{ p.id === 'ipv4' ? 'IPv4 datacenter · dedicated IP + port' : 'IPv6 /48 pool — sticky or rotating' }}</a-typography-text>
                        </div>
                        <CheckCircleFilled v-if="form.type === p.id" class="pick-check" />
                      </a-flex>
                      <a-divider class="pick-divider" />
                      <a-statistic :value="p.perHour" class="price">
                        <template #prefix><a-typography-text type="secondary" class="price-from">{{ locale === 'vi' ? 'Từ' : 'From' }}</a-typography-text></template>
                        <template #formatter="{ value }">{{ fmtMoney(value) }}</template>
                        <template #suffix>{{ currencyCode }} / {{ locale === 'vi' ? 'giờ' : 'hour' }}</template>
                      </a-statistic>
                    </a-card>
                  </a-col>
                </a-row>
              </a-card>

              <!-- Step 3: config -->
              <a-card>
                <template #title>
                  <a-flex align="center" gap="small">
                    <a-avatar :size="26" class="step-num">3</a-avatar>
                    <a-typography-title :level="2" class="card-h"><ClockCircleOutlined /> {{ locale === 'vi' ? 'Cấu hình proxy' : 'Proxy configuration' }}</a-typography-title>
                  </a-flex>
                </template>
                <a-typography-paragraph type="secondary" class="step-help">{{ locale === 'vi' ? 'Thời lượng, số lượng.' : 'Duration, quantity.' }}</a-typography-paragraph>
                <a-form layout="vertical" :model="form">
                  <a-form-item v-if="form.type === 'ipv6'">
                    <template #label>{{ locale === 'vi' ? 'Phương thức' : 'Method' }}&nbsp;<InfoCircleOutlined class="muted-ico" /></template>
                    <a-select v-model:value="form.rotate" :options="rotateOptions" />
                  </a-form-item>
                  <a-form-item>
                    <a-checkbox v-model:checked="form.autoRenew">Auto-renew</a-checkbox>
                    <a-typography-text type="secondary" class="hint">{{ locale === 'vi' ? 'Trừ ví khi proxy sắp hết hạn' : 'Charge wallet when proxy nears expiry' }}</a-typography-text>
                  </a-form-item>

                  <!-- Hours -->
                  <a-form-item :label="`${locale === 'vi' ? 'Số giờ' : 'Hours'} (${minHours} – ${maxHours} h)`">
                    <a-row :gutter="[16, 8]" align="middle" :wrap="false">
                      <a-col flex="auto"><a-slider v-model:value="form.hours" :min="minHours" :max="Math.min(maxHours, 720)" :step="1" /></a-col>
                      <a-col flex="none">
                        <a-input-number v-model:value="form.hours" :min="minHours" :max="maxHours" :precision="0" addon-after="h" class="num-input" @blur="setHours(form.hours)" />
                      </a-col>
                    </a-row>
                    <a-radio-group :value="form.hours" :options="hourOptions" option-type="button" button-style="solid" size="small" class="presets" @change="(e) => setHours(e.target.value)" />
                  </a-form-item>

                  <!-- Quantity -->
                  <a-form-item :label="`${locale === 'vi' ? 'Số lượng / Volume' : 'Quantity / Volume'} (1 – 254)`">
                    <a-row :gutter="[16, 8]" align="middle" :wrap="false">
                      <a-col flex="auto"><a-slider v-model:value="form.quantity" :min="1" :max="100" :step="1" /></a-col>
                      <a-col flex="none">
                        <a-input-number v-model:value="form.quantity" :min="1" :max="254" :precision="0" addon-after="proxy" class="num-input" @blur="setQuantity(form.quantity)" />
                      </a-col>
                    </a-row>
                    <a-radio-group :value="form.quantity" :options="quantityOptions" option-type="button" button-style="solid" size="small" class="presets" @change="(e) => setQuantity(e.target.value)" />
                  </a-form-item>
                </a-form>

                <a-alert type="info" show-icon>
                  <template #icon><ThunderboltOutlined /></template>
                  <template #message>
                    {{ form.zone
                      ? (locale === 'vi'
                        ? `Bạn sẽ nhận IP ngẫu nhiên từ ${selectedZoneInfo?.name || form.zone}. IP đổi theo phương thức đã chọn.`
                        : `You will receive random IPs from ${selectedZoneInfo?.name || form.zone}. IPs change according to the chosen method.`)
                      : (locale === 'vi' ? 'Chọn zone ở Step 1 trước.' : 'Pick a zone in Step 1 first.') }}
                  </template>
                </a-alert>
              </a-card>

              <!-- Why-choose-us -->
              <a-card>
                <template #title>
                  <a-typography-title :level="2" class="card-h">{{ locale === 'vi' ? 'Tại sao chọn ProxyBox?' : 'Why choose ProxyBox?' }}</a-typography-title>
                </template>
                <a-row :gutter="[16, 20]">
                  <a-col :xs="24" :sm="12">
                    <a-card-meta :title="locale === 'vi' ? 'IP datacenter riêng' : 'Private datacenter IPs'" :description="locale === 'vi' ? 'Datacenter riêng từng cổng, không dùng chung' : 'Dedicated datacenter IP per port, not shared'">
                      <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><SafetyCertificateOutlined /></template></a-avatar></template>
                    </a-card-meta>
                  </a-col>
                  <a-col :xs="24" :sm="12">
                    <a-card-meta :title="locale === 'vi' ? 'Tỷ lệ thành công cao' : 'High success rate'" :description="locale === 'vi' ? 'Hoạt động ổn định, được đảm bảo' : 'Stable operation guaranteed'">
                      <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><CheckCircleOutlined /></template></a-avatar></template>
                    </a-card-meta>
                  </a-col>
                  <a-col :xs="24" :sm="12">
                    <a-card-meta :title="locale === 'vi' ? 'Giá theo giờ minh bạch' : 'Transparent hourly pricing'" :description="locale === 'vi' ? 'Trả đúng số giờ sử dụng, từ 1h' : 'Pay only for hours used, from 1h'">
                      <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><ClockCircleOutlined /></template></a-avatar></template>
                    </a-card-meta>
                  </a-col>
                  <a-col :xs="24" :sm="12">
                    <a-card-meta :title="locale === 'vi' ? 'Hỗ trợ 24/7' : '24/7 support'" :description="locale === 'vi' ? 'Đội ngũ hỗ trợ nhanh' : 'Fast support team'">
                      <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><ThunderboltOutlined /></template></a-avatar></template>
                    </a-card-meta>
                  </a-col>
                </a-row>
              </a-card>
            </a-flex>
          </a-col>

          <!-- RIGHT: order summary -->
          <a-col :xs="24" :lg="8">
            <a-flex vertical gap="middle" class="aside">
              <a-card>
                <template #title>
                  <a-typography-title :level="3" class="card-h">{{ locale === 'vi' ? 'Tóm tắt đơn hàng' : 'Order summary' }}</a-typography-title>
                </template>
                <a-descriptions :column="1" size="small" class="sum">
                  <a-descriptions-item :label="locale === 'vi' ? 'Loại' : 'Type'">
                    <a-typography-text strong>{{ selectedProduct ? (selectedProduct.id === 'ipv4' ? 'IPv4 proxy' : 'IPv6 proxy') : '—' }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item :label="locale === 'vi' ? 'Quốc gia' : 'Country'">
                    <a-space :size="6">
                      <CountryFlag v-if="form.zone" :code="selectedCountryCode" :size="16" />
                      {{ form.zone ? (selectedZoneInfo?.name || form.zone) : '—' }}
                    </a-space>
                  </a-descriptions-item>
                  <a-descriptions-item v-if="form.type === 'ipv6'" :label="locale === 'vi' ? 'Phương thức' : 'Method'">
                    {{ form.rotate ? 'Rotating' : 'Sticky' }}
                  </a-descriptions-item>
                  <a-descriptions-item :label="locale === 'vi' ? 'Số giờ' : 'Hours'">{{ form.hours }} h</a-descriptions-item>
                  <a-descriptions-item :label="locale === 'vi' ? 'Số lượng / Volume' : 'Quantity / Volume'">{{ form.quantity }} proxy</a-descriptions-item>
                  <a-descriptions-item :label="locale === 'vi' ? 'Đơn giá' : 'Unit price'">
                    <span class="mono">{{ fmtMoney(perHour) }} / h</span>
                  </a-descriptions-item>
                </a-descriptions>
                <a-divider class="sum-divider" />
                <a-descriptions :column="1" size="small" class="sum">
                  <a-descriptions-item :label="locale === 'vi' ? 'Tạm tính' : 'Subtotal'">
                    <span class="mono">{{ fmtMoney(base) }} {{ currencyCode }}</span>
                  </a-descriptions-item>
                  <a-descriptions-item v-if="tierDiscount > 0">
                    <template #label>
                      {{ locale === 'vi' ? 'Giảm giá' : 'Discount' }}&nbsp;<a-typography-text type="success">(-{{ (tierDiscount * 100).toFixed(0) }}%)</a-typography-text>
                    </template>
                    <a-typography-text type="success" class="mono">-{{ fmtMoney(discountAmount) }}</a-typography-text>
                  </a-descriptions-item>
                </a-descriptions>
                <a-flex justify="space-between" align="center" gap="small" class="total">
                  <a-typography-text strong>{{ locale === 'vi' ? 'Tổng' : 'Total' }}</a-typography-text>
                  <a-statistic :value="total" class="total-stat" :value-style="{ color: 'var(--pb-primary)' }">
                    <template #formatter="{ value }"><span class="mono">{{ fmtMoney(value) }}</span></template>
                    <template #suffix><span class="mono total-cur">{{ currencyCode }}</span></template>
                  </a-statistic>
                </a-flex>

                <a-button type="primary" size="large" block :disabled="!form.zone" @click="buyNow">
                  <template #icon><LockOutlined /></template>
                  {{ token ? (locale === 'vi' ? 'Thanh toán ngay' : 'Pay now') : (locale === 'vi' ? 'Đăng nhập để mua' : 'Sign in to buy') }}
                </a-button>
                <a-typography-text v-if="!form.zone" type="danger" class="zone-warn">
                  <ExclamationCircleOutlined /> {{ locale === 'vi' ? 'Bạn phải chọn quốc gia / zone trước.' : 'You must pick a country/zone first.' }}
                </a-typography-text>
              </a-card>

              <a-card size="small">
                <template #title>
                  <a-typography-title :level="3" class="card-h">{{ locale === 'vi' ? 'Chính sách' : 'Purchase policy' }}</a-typography-title>
                </template>
                <a-flex vertical gap="small">
                  <a-typography-text><CheckOutlined class="ok-ico" /> {{ locale === 'vi' ? 'Hoàn tiền 24h nếu không hài lòng' : '24h refund if not satisfied' }}</a-typography-text>
                  <a-typography-text><CheckOutlined class="ok-ico" /> {{ locale === 'vi' ? 'IP chất lượng, hoạt động ổn định' : 'High-quality IPs, stable operation' }}</a-typography-text>
                  <a-typography-text><CheckOutlined class="ok-ico" /> {{ locale === 'vi' ? 'Không giới hạn băng thông' : 'Unlimited bandwidth' }}</a-typography-text>
                  <a-typography-text><CheckOutlined class="ok-ico" /> {{ locale === 'vi' ? 'Hỗ trợ đổi IP khi cần' : 'IP replacement support if needed' }}</a-typography-text>
                </a-flex>
              </a-card>
            </a-flex>
          </a-col>
        </a-row>

        <!-- ── HUB branch ── -->
        <a-row v-if="sourceMode === 'hub'" :gutter="[24, 24]">
          <a-col :xs="24" :lg="selectedHubPlan ? 16 : 24">
            <a-flex vertical gap="middle">
              <a-card>
                <template #title>
                  <a-flex align="center" gap="small">
                    <a-avatar :size="26" class="step-num">1</a-avatar>
                    <a-typography-title :level="2" class="card-h"><EnvironmentOutlined /> {{ locale === 'vi' ? 'Chọn vị trí (zone)' : 'Pick zone' }}</a-typography-title>
                  </a-flex>
                </template>
                <a-typography-paragraph type="secondary" class="step-help">{{ locale === 'vi' ? 'Mỗi zone = 1 datacenter chạy Virtualizor backend.' : 'Each zone = a datacenter running a Virtualizor backend.' }}</a-typography-paragraph>
                <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 2 }" />
                <a-empty
                  v-else-if="!hubZones.length"
                  :image="simpleEmpty"
                  :description="locale === 'vi'
                    ? 'Chưa có Hub plan công khai. Admin cần cấu hình Virtualizor + tạo plan trước.'
                    : 'No public Hub plans yet. Admin needs to wire up Virtualizor and create plans first.'"
                />
                <a-row v-else :gutter="[12, 12]">
                  <a-col v-for="z in hubZones" :key="z.id" :xs="24" :sm="12">
                    <a-card
                      size="small"
                      hoverable
                      class="pick"
                      :class="{ 'is-selected': hubForm.zone === z.id }"
                      role="button"
                      tabindex="0"
                      :aria-pressed="hubForm.zone === z.id"
                      @click="pickHubZone(z.id)"
                      @keydown.enter.prevent="pickHubZone(z.id)"
                    >
                      <a-flex align="center" gap="middle">
                        <CountryFlag :code="z.flag" :size="28" />
                        <div class="pick-text">
                          <a-typography-text strong>{{ z.name }}</a-typography-text>
                          <a-typography-text type="secondary" class="pick-sub">{{ z.planCount }} plan · {{ z.sub }}</a-typography-text>
                        </div>
                        <CheckCircleFilled v-if="hubForm.zone === z.id" class="pick-check" />
                      </a-flex>
                    </a-card>
                  </a-col>
                </a-row>
              </a-card>

              <a-card v-if="hubPlansForZone.length">
                <template #title>
                  <a-flex align="center" gap="small">
                    <a-avatar :size="26" class="step-num">2</a-avatar>
                    <a-typography-title :level="2" class="card-h"><CloudOutlined /> {{ locale === 'vi' ? 'Chọn cấu hình' : 'Pick config' }}</a-typography-title>
                  </a-flex>
                </template>
                <a-typography-paragraph type="secondary" class="step-help">{{ locale === 'vi' ? 'Mỗi plan = 1 VPS template ở Virtualizor.' : 'Each plan = a VPS template in Virtualizor.' }}</a-typography-paragraph>
                <a-row :gutter="[12, 12]">
                  <a-col v-for="p in hubPlansForZone" :key="p.id" :xs="24" :sm="12" :xl="8">
                    <a-card
                      hoverable
                      class="pick"
                      :class="{ 'is-selected': hubForm.planId === p.id }"
                      role="button"
                      tabindex="0"
                      :aria-pressed="hubForm.planId === p.id"
                      @click="pickHubPlan(p)"
                      @keydown.enter.prevent="pickHubPlan(p)"
                    >
                      <a-flex align="center" gap="middle">
                        <a-avatar shape="square" :size="44" class="ico" :class="p.family === 'ipv6' ? 'ico-green' : 'ico-blue'"><template #icon><CloudOutlined /></template></a-avatar>
                        <div class="pick-text">
                          <a-typography-title :level="3" class="card-h3">{{ p.name }}</a-typography-title>
                          <a-typography-text type="secondary" class="pick-sub">Hub {{ (p.family || 'ipv4').toUpperCase() }} · {{ p.region }}</a-typography-text>
                        </div>
                        <CheckCircleFilled v-if="hubForm.planId === p.id" class="pick-check" />
                      </a-flex>
                      <a-typography-paragraph v-if="p.description" type="secondary" class="plan-desc">
                        <CheckOutlined class="ok-ico" /> {{ p.description }}
                      </a-typography-paragraph>
                      <a-space wrap :size="[6, 6]" class="specs">
                        <a-tag :bordered="false"><strong>{{ p.specs?.cpu }}</strong> vCPU</a-tag>
                        <a-tag :bordered="false"><strong>{{ p.specs?.ramGB }}</strong> GB RAM</a-tag>
                        <a-tag :bordered="false"><strong>{{ p.specs?.diskGB }}</strong> GB Disk</a-tag>
                        <a-tag v-if="p.specs?.bandwidthGB" :bordered="false"><strong>{{ p.specs.bandwidthGB }}</strong> GB BW/m</a-tag>
                        <a-tag v-if="p.specs?.ipv4Count" :bordered="false"><strong>{{ p.specs.ipv4Count }}</strong> IPv4</a-tag>
                        <a-tag v-if="p.specs?.ipv6Range" :bordered="false"><strong class="mono">{{ p.specs.ipv6Range }}</strong> IPv6</a-tag>
                      </a-space>
                      <a-divider class="pick-divider" />
                      <a-statistic :value="p.hourlyPrice" class="price">
                        <template #prefix><a-typography-text type="secondary" class="price-from">{{ locale === 'vi' ? 'Từ' : 'From' }}</a-typography-text></template>
                        <template #formatter="{ value }">{{ fmtMoney(value) }}</template>
                        <template #suffix>{{ p.currency }} / {{ locale === 'vi' ? 'giờ' : 'hour' }}</template>
                      </a-statistic>
                    </a-card>
                  </a-col>
                </a-row>
              </a-card>
            </a-flex>
          </a-col>

          <a-col v-if="selectedHubPlan" :xs="24" :lg="8">
            <a-card class="aside">
              <template #title>
                <a-typography-title :level="3" class="card-h">{{ locale === 'vi' ? 'Tóm tắt Hub' : 'Hub summary' }}</a-typography-title>
              </template>
              <a-descriptions :column="1" size="small" class="sum">
                <a-descriptions-item label="Plan"><a-typography-text strong>{{ selectedHubPlan.name }}</a-typography-text></a-descriptions-item>
                <a-descriptions-item :label="locale === 'vi' ? 'Quốc gia' : 'Region'"><span class="mono">{{ selectedHubPlan.region }}</span></a-descriptions-item>
                <a-descriptions-item label="vCPU">{{ selectedHubPlan.specs?.cpu }}</a-descriptions-item>
                <a-descriptions-item label="RAM">{{ selectedHubPlan.specs?.ramGB }} GB</a-descriptions-item>
                <a-descriptions-item label="Disk">{{ selectedHubPlan.specs?.diskGB }} GB</a-descriptions-item>
              </a-descriptions>
              <a-divider class="sum-divider" />
              <a-flex justify="space-between" align="center" gap="small" class="total">
                <a-typography-text strong>{{ locale === 'vi' ? 'Giá theo giờ' : 'Hourly rate' }}</a-typography-text>
                <a-statistic :value="selectedHubPlan.hourlyPrice" class="total-stat" :value-style="{ color: 'var(--pb-primary)' }">
                  <template #formatter="{ value }"><span class="mono">{{ fmtMoney(value) }}</span></template>
                  <template #suffix><span class="mono total-cur">{{ selectedHubPlan.currency }}</span></template>
                </a-statistic>
              </a-flex>
              <a-button type="primary" size="large" block @click="buyHub">
                <template #icon><CloudOutlined /></template>
                {{ token ? (locale === 'vi' ? 'Thuê Hub' : 'Rent Hub') : (locale === 'vi' ? 'Đăng nhập để thuê' : 'Sign in to rent') }}
              </a-button>
            </a-card>
          </a-col>
        </a-row>

        <!-- ── OSS branch ── -->
        <a-flex v-if="sourceMode === 'oss'" vertical gap="middle">
          <a-card class="oss-card">
            <a-tag color="success" class="mono oss-tag">FREE FOREVER · MIT</a-tag>
            <a-typography-title :level="2" class="oss-h">Box Proxy</a-typography-title>
            <a-typography-paragraph type="secondary" class="oss-p">
              {{ locale === 'vi'
                ? 'Toàn bộ panel ProxyBox — đóng gói thành mã nguồn mở miễn phí để bạn tự host trên VPS của bạn. Customer của BẠN enroll thẳng về panel của BẠN.'
                : 'The full ProxyBox panel — packaged as a free open-source distribution you self-host on your own VPS. YOUR customers enrol directly into YOUR panel.' }}
            </a-typography-paragraph>
            <a-row :gutter="[24, 16]" align="middle" class="oss-row">
              <a-col :xs="24" :md="7">
                <a-statistic :value="0" prefix="$" :value-style="{ fontSize: '44px', fontWeight: 800 }">
                  <template #suffix><a-typography-text type="secondary" class="oss-forever">/ {{ locale === 'vi' ? 'mãi mãi' : 'forever' }}</a-typography-text></template>
                </a-statistic>
              </a-col>
              <a-col :xs="24" :md="17">
                <a-card size="small" class="term-card">
                  <template #title>
                    <a-flex align="center" gap="small">
                      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
                      <a-typography-text type="secondary" class="mono term-title">install.sh — Ubuntu / Debian</a-typography-text>
                    </a-flex>
                  </template>
                  <template #extra>
                    <a-button size="small" @click="copyInstall">
                      <template #icon><CheckOutlined v-if="copied" /><CopyOutlined v-else /></template>
                      <span v-if="screens.sm">{{ copied ? (locale === 'vi' ? 'Đã copy' : 'Copied') : 'Copy' }}</span>
                    </a-button>
                  </template>
                  <pre class="mono term-code"><span class="prompt">$</span> {{ installCmd }}</pre>
                </a-card>
              </a-col>
            </a-row>
            <a-flex wrap="wrap" gap="small">
              <RouterLink v-slot="{ href, navigate }" to="/faq#self-host-panel" custom>
                <a-button type="primary" :href="href" @click="navigate">
                  {{ locale === 'vi' ? 'Hướng dẫn cài A→Z' : 'Full install guide' }} <ArrowRightOutlined />
                </a-button>
              </RouterLink>
              <RouterLink v-slot="{ href, navigate }" to="/faq#self-host-trust" custom>
                <a-button :href="href" @click="navigate">
                  <template #icon><SafetyCertificateOutlined /></template>
                  {{ locale === 'vi' ? 'Bảo mật installer' : 'Installer security' }}
                </a-button>
              </RouterLink>
              <RouterLink v-slot="{ href, navigate }" to="/changelog" custom>
                <a-button :href="href" @click="navigate">
                  <template #icon><ExportOutlined /></template>
                  {{ locale === 'vi' ? 'Lịch sử phát hành' : 'Changelog' }}
                </a-button>
              </RouterLink>
            </a-flex>
          </a-card>

          <a-card>
            <template #title>
              <a-typography-title :level="2" class="card-h">{{ locale === 'vi' ? 'Bao gồm trong Box Proxy' : 'Included in Box Proxy' }}</a-typography-title>
            </template>
            <a-row :gutter="[16, 20]">
              <a-col :xs="24" :sm="12">
                <a-card-meta title="MIT licence" :description="locale === 'vi' ? 'Source 100% public — audit mọi dòng' : '100% open source — audit every line'">
                  <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><SafetyCertificateOutlined /></template></a-avatar></template>
                </a-card-meta>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-card-meta title="BYON + Hub Proxy" :description="locale === 'vi' ? 'Customer cài 1 lệnh hoặc thuê VPS theo giờ' : 'Customer pastes one command or rents hourly VPS'">
                  <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><CloudServerOutlined /></template></a-avatar></template>
                </a-card-meta>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-card-meta title="IPv4 + IPv6 /48" :description="locale === 'vi' ? 'Strict family egress — không leak A/AAAA' : 'Strict family egress — no A/AAAA leaks'">
                  <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><GlobalOutlined /></template></a-avatar></template>
                </a-card-meta>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-card-meta :title="locale === 'vi' ? 'Tự upgrade 1-click' : 'One-click self-upgrade'" :description="locale === 'vi' ? '/admin/settings → Upgrade pull git + restart' : '/admin/settings → Upgrade pulls git + restarts'">
                  <template #avatar><a-avatar shape="square" class="ico ico-green"><template #icon><ThunderboltOutlined /></template></a-avatar></template>
                </a-card-meta>
              </a-col>
            </a-row>
          </a-card>
        </a-flex>
      </main>
    </a-layout-content>

    <a-layout-footer class="pricing-foot">
      <a-flex class="container" justify="space-between" align="center" wrap="wrap" gap="small">
        <a-typography-text type="secondary">{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</a-typography-text>
        <a-typography-text type="secondary">
          {{ t('landing.foot.publishedBy') }}
          <a-typography-link href="https://proxybox.pro" target="_blank" rel="noopener" strong>{{ t('landing.foot.onieName') }}</a-typography-link>
          · <a-typography-link href="https://proxybox.pro" target="_blank" rel="noopener" strong>proxybox.pro</a-typography-link>
        </a-typography-text>
        <a-space :size="6">
          <template #split><a-typography-text type="secondary">·</a-typography-text></template>
          <RouterLink class="foot-link" to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
          <RouterLink class="foot-link" to="/api-docs">{{ t('landing.nav.api') }}</RouterLink>
          <RouterLink class="foot-link" to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
        </a-space>
      </a-flex>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped>
.pricing-page.ant-layout {
  min-height: 100vh;
  background:
    radial-gradient(1000px 420px at 50% -8%, color-mix(in srgb, var(--pb-primary) 10%, transparent), transparent 70%),
    var(--pb-bg);
}
.container { width: 100%; max-width: 1240px; margin: 0 auto; padding-inline: 32px; }
.pricing-shell { padding-block: 56px 72px; }

/* Hero */
.pricing-hero { text-align: center; margin-bottom: 32px; }
.hero-pill { margin-bottom: 18px; padding: 4px 12px; border-radius: 999px; font-weight: 600; white-space: normal; }
.hero-pill :deep(.ant-badge-status-dot) { vertical-align: 1px; }
.hero-title.ant-typography {
  margin: 0 0 14px;
  font-size: clamp(34px, 5vw, 54px);
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1.08;
}
.accent {
  background: linear-gradient(120deg, var(--pb-info), var(--pb-success));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-sub.ant-typography { font-size: 16px; line-height: 1.6; max-width: 640px; margin: 0 auto; }

/* Source switcher (rich segmented labels) */
.source-tabs { margin-bottom: 24px; padding: 4px; }
.source-tabs :deep(.ant-segmented-item-label) {
  min-height: 0;
  padding: 12px 14px;
  line-height: 1.35;
  white-space: normal;
  text-align: start;
}
.st { min-width: 0; }
.st-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.st-title { font-size: 15px; font-weight: 700; white-space: nowrap; }
.st-sub { font-size: 12.5px; color: var(--pb-text-2); }
.st-sub strong { color: var(--pb-text); font-weight: 600; }
.st-badge { margin-inline: 4px 0; font-size: 10px; line-height: 16px; padding: 0 5px; font-weight: 700; vertical-align: 2px; }

.err-alert { margin-bottom: 16px; }

/* Icon tiles */
.ico { flex-shrink: 0; font-size: 18px; }
.ico-blue  { background: color-mix(in srgb, var(--pb-info) 15%, transparent);    color: var(--pb-info); }
.ico-amber { background: color-mix(in srgb, var(--pb-warning) 15%, transparent); color: var(--pb-warning); }
.ico-green { background: var(--pb-primary-soft); color: var(--pb-primary); }

/* Card headings */
.step-num { background: var(--pb-primary); flex-shrink: 0; font-weight: 700; }
.card-h.ant-typography { font-size: 16px; margin: 0; }
.card-h3.ant-typography { font-size: 16px; margin: 0 0 2px; }
.step-help.ant-typography { margin-bottom: 14px; font-size: 13px; }

/* Selectable cards (zone / product / plan) */
.pick { height: 100%; cursor: pointer; transition: border-color 0.2s, background-color 0.2s; }
.pick.is-selected { border-color: var(--pb-primary); background: var(--pb-primary-soft); }
.pick.is-disabled { cursor: not-allowed; opacity: 0.55; }
.pick:focus-visible { outline: 2px solid var(--pb-primary); outline-offset: 2px; }
.pick-text { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.pick-text > .ant-typography { max-width: 100%; }
.pick-sub { font-size: 12px; }
.pick-tag { margin: 0; font-size: 11px; }
.pick-check { color: var(--pb-primary); font-size: 18px; flex-shrink: 0; }
.pick-divider { margin: 14px 0 10px; }
.price :deep(.ant-statistic-content) { font-size: 22px; font-weight: 700; display: flex; align-items: baseline; flex-wrap: wrap; }
.price :deep(.ant-statistic-content-suffix) { font-size: 12px; font-weight: 400; color: var(--pb-text-3); }
.price-from { font-size: 13px; font-weight: 400; }
.plan-desc.ant-typography { margin: 12px 0 0; font-size: 13px; }
.specs { margin-top: 12px; }
.ok-ico { color: var(--pb-success); }
.muted-ico { color: var(--pb-text-3); font-size: 12px; }

/* Config form */
.hint { margin-inline-start: 6px; font-size: 12px; }
.num-input { width: 130px; }
.presets { margin-top: 8px; }

/* Order summary */
.aside { position: sticky; top: 88px; }
.sum :deep(.ant-descriptions-item) { padding-bottom: 8px; }
.sum :deep(.ant-descriptions-item-label) { color: var(--pb-text-3); }
.sum :deep(.ant-descriptions-item-content) { justify-content: flex-end; text-align: end; }
.sum-divider { margin: 8px 0 14px; }
.total { margin: 6px 0 16px; padding-top: 12px; border-top: 1px dashed var(--pb-border); }
.total-stat :deep(.ant-statistic-content) { font-size: 22px; font-weight: 700; }
.total-cur { font-size: 13px; }
.zone-warn { display: block; margin-top: 8px; font-size: 12px; }

/* OSS */
.oss-tag { margin-bottom: 12px; font-weight: 700; letter-spacing: 0.3px; }
.oss-h.ant-typography { margin: 0 0 6px; font-size: 28px; }
.oss-p.ant-typography { max-width: 720px; font-size: 14.5px; line-height: 1.6; }
.oss-row { margin-bottom: 20px; }
.oss-forever { font-size: 14px; }
.term-card :deep(.ant-card-body) { padding: 0; }
.term-title { font-size: 12px; }
.dots { display: inline-flex; gap: 6px; flex-shrink: 0; }
.dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--pb-error); }
.dots i:nth-child(2) { background: var(--pb-warning); }
.dots i:nth-child(3) { background: var(--pb-success); }
.term-code { margin: 0; padding: 16px; font-size: 12.5px; line-height: 1.6; overflow-x: auto; white-space: pre; word-break: normal; }
.prompt { color: var(--pb-success); margin-right: 8px; user-select: none; }

/* Footer */
.pricing-foot.ant-layout-footer { background: transparent; border-top: 1px solid var(--pb-border-soft); padding: 22px 0; font-size: 12px; }
.pricing-foot :deep(.ant-typography) { font-size: 12px; }
.foot-link { color: var(--pb-text-2); font-size: 12px; }
.foot-link:hover { color: var(--pb-text); }

@media (max-width: 991px) {
  .container { padding-inline: 20px; }
  .pricing-shell { padding-block: 36px 56px; }
  .aside { position: static; }
}
@media (max-width: 575px) {
  .container { padding-inline: 16px; }
  .pricing-shell { padding-block: 24px 40px; }
  .hero-sub.ant-typography { font-size: 14.5px; }
  .source-tabs :deep(.ant-segmented-item-label) { padding: 10px 4px; text-align: center; }
  .st-title { font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .st-badge { margin: 0; }
  .num-input { width: 112px; }
  .term-code { font-size: 11.5px; padding: 14px; }
}
</style>
