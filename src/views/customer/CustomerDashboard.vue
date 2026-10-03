<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  CloudOutlined, CloudServerOutlined, FieldTimeOutlined, GlobalOutlined, SafetyCertificateOutlined,
  SwapOutlined, ToolOutlined
} from '@ant-design/icons-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'
import StatusTag from '../../components/ui/StatusTag.vue'

// BYON-related state for the dashboard row: token + install commands.
const fleetToken = ref(null)
const tokenReveal = ref(false)
const copiedCmd = ref('')
async function loadFleetToken() {
  try { fleetToken.value = await apiFetch('/api/v1/user/nodes/fleet-token') }
  catch (e) { if (e.status !== 404) console.warn(e.message) }
}
async function generateFleetToken() {
  try { fleetToken.value = await apiFetch('/api/v1/user/nodes/fleet-token', { method: 'POST' }) }
  catch (e) { console.warn(e.message) }
}
function copyCmd(text, key) {
  navigator.clipboard?.writeText(text)
  copiedCmd.value = key
  setTimeout(() => copiedCmd.value = '', 1500)
}

const { t } = useI18n()
const router = useRouter()
const account = ref(null)
const proxies = ref([])
const pricing = ref(null)
const zones = ref([])
const search = ref('')
const filterTab = ref('all')
const loading = ref(false)
// Reactive "now" — ticks every second so countdown timers refresh live.
const nowMs = ref(Date.now())
let tickInterval = null

// Format remaining ms as "Xd Yh Zm Ws", with live colour tier:
//   > 7d   → green "active"
//   1-7d   → green
//   1h-24h → yellow "expiring"
//   < 1h   → red "critical"
//   <= 0   → "expired"
function fmtCountdown(expiresAt) {
  if (!expiresAt) return { text: '—', tier: 'muted' }
  const target = new Date(expiresAt).getTime()
  const diff = target - nowMs.value
  if (diff <= 0) return { text: t('cust.dash.expired'), tier: 'expired' }
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  let text
  if (d > 0)       text = `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  else             text = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  let tier = 'active'
  if (diff < 3600_000) tier = 'critical'
  else if (diff < 86400_000) tier = 'expiring'
  else if (diff < 7 * 86400_000) tier = 'soon'
  return { text, tier }
}
// Countdown tier → antd Typography `type`.
const TIER_TYPE = { active: 'success', soon: 'success', expiring: 'warning', critical: 'danger', expired: 'secondary', muted: 'secondary' }
function fmtExpiresAt(expiresAt) {
  if (!expiresAt) return '—'
  const d = new Date(expiresAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function refresh() {
  loading.value = true
  try {
    [account.value, proxies.value, pricing.value, zones.value] = await Promise.all([
      apiFetch('/api/v1/user/account'),
      apiFetch('/api/v1/user/proxies').catch(() => []),
      apiFetch('/api/v1/user/pricing').catch(() => null),
      apiFetch('/api/v1/user/zones').catch(() => [])
    ])
  } catch { /* not logged in as customer */ }
  finally { loading.value = false }
}

// Top 5 zones with online nodes — sourced from backend, not hardcoded.
const popularZones = computed(() =>
  zones.value
    .filter((z) => (z.onlineNodes ?? 0) > 0)
    .sort((a, b) => (b.onlineNodes || 0) - (a.onlineNodes || 0))
    .slice(0, 5)
)

// 4 product tiles on the dashboard: proxy IPv4 / IPv6 (pool, billed per hour),
// Hub Proxy (rent a VPS — single tile covers v4 and v6 via the /buy?source=hub
// flow which then asks the customer to pick family), and Tools (free utility:
// create proxy on the customer's own node).
const ACCENT = { blue: '#3b82f6', green: '#16a34a', cyan: '#06b6d4', amber: '#f59e0b' }
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const products = computed(() => {
  if (!pricing.value) return []
  return [
    { kind: 'proxy', type: 'ipv4', color: 'blue',  icon: CloudServerOutlined, labelKey: 'cust.buy.t.ipv4', subKey: 'cust.buy.t.ipv4Sub', descKey: 'cust.buy.t.ipv4Desc', perHour: Number(pricing.value.ipv4?.perHour || 0) },
    { kind: 'proxy', type: 'ipv6', color: 'green', icon: GlobalOutlined,      labelKey: 'cust.buy.t.ipv6', subKey: 'cust.buy.t.ipv6Sub', descKey: 'cust.buy.t.ipv6Desc', perHour: Number(pricing.value.ipv6?.perHour || 0) },
    { kind: 'hub',   type: 'hub',  color: 'cyan',  icon: CloudOutlined,       labelKey: 'cust.dash.hubLabel',  subKey: 'cust.dash.hubSub',  descKey: 'cust.dash.hubDesc',  ctaKey: 'cust.dash.hubCta' },
    { kind: 'tool',  type: 'byon', color: 'amber', icon: ToolOutlined,        labelKey: 'cust.dash.byonLabel', subKey: 'cust.dash.byonSub', descKey: 'cust.dash.byonDesc', ctaKey: 'cust.dash.byonCta' }
  ]
})
function avatarStyle(color) {
  const c = ACCENT[color] || ACCENT.green
  return { color: c, background: `${c}24`, border: `1px solid ${c}66` }
}

// Real stats from user's own proxies — replaces generic "99.9% uptime" marketing copy.
const myStats = computed(() => {
  const list = proxies.value
  const active = list.filter((p) => p.status === 'active').length
  const expiring = list.filter((p) => p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 86_400_000 * 3 && p.status === 'active').length
  const totalBytes = list.reduce((s, p) => s + Number(p.stats?.uploadBytes || 0) + Number(p.stats?.downloadBytes || 0), 0)
  const uniqueZones = new Set(list.map((p) => p.zone).filter(Boolean)).size
  return { total: list.length, active, expiring, totalBytes, uniqueZones }
})
const kpis = computed(() => [
  { key: 'owned',    label: t('cust.dash.kpiOwned'),    value: myStats.value.total,                icon: CloudServerOutlined },
  { key: 'active',   label: t('cust.dash.kpiActive'),   value: myStats.value.active,               icon: SafetyCertificateOutlined },
  { key: 'expiring', label: t('cust.dash.kpiExpiring'), value: myStats.value.expiring,             icon: FieldTimeOutlined, warn: myStats.value.expiring > 0 },
  { key: 'traffic',  label: t('cust.dash.kpiTraffic'),  value: fmtBytes(myStats.value.totalBytes), icon: SwapOutlined }
])
function fmtBytes(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = Number(b || 0)
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1 }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}
function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') }

function goBuy(p) {
  if (typeof p === 'string') return router.push({ name: 'buy', query: { type: p } })
  if (p.kind === 'hub')  return router.push({ name: 'buy', query: { source: 'hub' } })
  if (p.kind === 'tool') return router.push('/my-nodes')
  return router.push({ name: 'buy', query: { type: p.type } })
}
function searchProxies() {
  if (!search.value.trim()) router.push({ name: 'buy' })
  else router.push({ name: 'buy', query: { q: search.value } })
}

const installCmds = computed(() => {
  const f = fleetToken.value
  if (!f) return []
  return [
    { key: 'v4',  label: '🌐 Linux IPv4',       cmd: f.installLinuxV4 },
    { key: 'v6',  label: '🛰 Linux IPv6',       cmd: f.installLinuxV6 },
    { key: 'win', label: '🪟 Windows (Admin)',  cmd: f.installWindows },
    { key: 'un',  label: `🗑 ${t('cust.dash.uninstall')}`, cmd: f.uninstall, danger: true }
  ]
})

// Group proxies by orderId — each row in the dashboard table is one order group
// (matches the /proxies page convention). Proxies without orderId fall into a
// synthetic single-proxy group so nothing disappears.
const proxyGroups = computed(() => {
  const map = new Map()
  for (const p of proxies.value) {
    const gid = p.orderId || `single-${p.id}`
    if (!map.has(gid)) {
      map.set(gid, {
        id: gid,
        orderId: p.orderId || null,
        name: p.orderId ? `#${String(p.orderId).slice(-8)}` : (p.name || p.id),
        type: p.type || 'IPv4',
        zone: p.zone || '',
        ip: p.ip || p.bindIp,     // customer-facing host (v4 for IPv6 proxies)
        bindIp: p.bindIp,           // egress (kept for tools/check)
        port: p.port,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        proxies: []
      })
    }
    const g = map.get(gid)
    g.proxies.push(p)
    if (p.createdAt && (!g.createdAt || new Date(p.createdAt) < new Date(g.createdAt))) g.createdAt = p.createdAt
    if (p.expiresAt && (!g.expiresAt || new Date(p.expiresAt) < new Date(g.expiresAt))) g.expiresAt = p.expiresAt
  }
  return [...map.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
})

function groupStatus(g) {
  if (g.proxies.every((p) => p.status === 'expired')) return 'expired'
  if (g.proxies.some((p) => p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 86_400_000 * 3) && g.proxies.some((p) => p.status === 'active')) return 'expiring'
  if (g.proxies.every((p) => p.status === 'active')) return 'active'
  return 'mixed'
}
function groupStatusLabel(s) {
  return ({ active: 'active', expiring: t('cust.dash.stExpiring'), expired: t('cust.dash.stExpired'), mixed: t('cust.dash.stMixed') })[s] || s
}

const filterOptions = computed(() => [
  { label: t('cust.filter.all'), value: 'all' },
  { label: t('cust.filter.active'), value: 'active' },
  { label: t('cust.filter.expiring'), value: 'expiring' },
  { label: t('cust.filter.expired'), value: 'expired' }
])
const filteredGroups = computed(() => {
  const list = proxyGroups.value
  if (filterTab.value === 'all') return list
  return list.filter((g) => groupStatus(g) === filterTab.value)
})

const PAGE_SIZE = 10
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredGroups.value.length / PAGE_SIZE)))
watch([filterTab, filteredGroups], () => { if (page.value > totalPages.value) page.value = 1 })
const pagination = computed(() => ({
  current: page.value,
  pageSize: PAGE_SIZE,
  hideOnSinglePage: true,
  showSizeChanger: false,
  size: 'small',
  showTotal: (total) => `${total} ${t('cust.col.groups')} · ${t('cust.pager.page')} ${page.value}/${totalPages.value}`
}))
function onTableChange(p) { page.value = p.current }

const columns = computed(() => [
  { title: t('cust.col.name'),     key: 'name',     width: 130 },
  { title: t('cust.col.type'),     key: 'type',     width: 90 },
  { title: t('cust.col.endpoint'), key: 'endpoint', width: 210 },
  { title: t('cust.col.country'),  key: 'country',  width: 150 },
  { title: t('cust.col.qty'),      key: 'qty',      width: 100, align: 'right' },
  { title: t('cust.col.expires'),  key: 'expires',  width: 190 },
  { title: t('cust.col.status'),   key: 'status',   width: 120 },
  { title: t('cust.col.action'),   key: 'action',   width: 100, fixed: 'right' }
])

function countryForProxy(p) {
  const z = (p.zone || '').toLowerCase()
  if (z.startsWith('vn')) return 'VN'
  if (z.startsWith('us')) return 'US'
  if (z.startsWith('uk') || z.startsWith('gb')) return 'GB'
  if (z.startsWith('de')) return 'DE'
  if (z.startsWith('jp')) return 'JP'
  if (z.startsWith('sg')) return 'SG'
  if (z.startsWith('hk')) return 'HK'
  return 'GLOBAL'
}
function countryName(p) {
  const c = countryForProxy(p)
  return { VN: 'Vietnam', US: 'United States', GB: 'United Kingdom', DE: 'Germany', JP: 'Japan', SG: 'Singapore', HK: 'Hong Kong', GLOBAL: 'Global' }[c] || c
}
function openGroup(g) {
  if (g.orderId) router.push({ name: 'proxies', query: { order: g.orderId } })
  else router.push({ name: 'proxies' })
}

onMounted(() => {
  refresh()
  loadFleetToken()
  tickInterval = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => { if (tickInterval) clearInterval(tickInterval) })
</script>

<template>
  <div class="page">
    <!-- ── Hero ──────────────────────────────────────────────── -->
    <a-card class="hero" :bordered="true">
      <a-row :gutter="[24, 16]" align="middle">
        <a-col :xs="24" :md="16" :lg="17">
          <a-typography-title :level="3" class="hero-title">{{ t('cust.hero.title1') }}<br>{{ t('cust.hero.title2') }}</a-typography-title>
          <a-typography-paragraph type="secondary">{{ t('cust.hero.tagline') }}</a-typography-paragraph>
          <a-input-search
            v-model:value="search"
            class="hero-search"
            size="large"
            allow-clear
            :placeholder="t('cust.hero.searchPlaceholder')"
            :enter-button="t('cust.hero.search')"
            @search="searchProxies"
          />
          <a-flex v-if="popularZones.length" wrap="wrap" align="center" gap="small" class="hero-tags">
            <a-typography-text type="secondary">{{ t('cust.hero.popular') }}:</a-typography-text>
            <a-button v-for="z in popularZones" :key="z.id" size="small" @click="router.push({ name: 'buy', query: { country: z.id } })">
              <CountryFlag :code="(z.flag || z.id.slice(0,2)).toUpperCase()" :size="14" class="flag-gap" /> {{ z.name }}
            </a-button>
          </a-flex>
        </a-col>
        <a-col :xs="0" :md="8" :lg="7">
          <div class="hero-illust" aria-hidden="true">
            <!-- Original geometric SVG illustration -->
            <svg viewBox="0 0 220 180" width="100%" height="100%">
              <defs>
                <linearGradient id="hg1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#3fb950" stop-opacity="0.9" />
                  <stop offset="100%" stop-color="#39d0d8" stop-opacity="0.7" />
                </linearGradient>
                <linearGradient id="hg2" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#3fb950" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="#0e2e1a" stop-opacity="0.05" />
                </linearGradient>
              </defs>
              <circle cx="110" cy="90" r="78" fill="url(#hg2)" />
              <g transform="translate(110,90)">
                <polygon points="-40,-30 0,-50 40,-30 0,-10" fill="url(#hg1)" opacity="0.95" />
                <polygon points="-40,-30 0,-10 0,40 -40,20" fill="#1a4a26" opacity="0.85" />
                <polygon points="40,-30 0,-10 0,40 40,20" fill="#3fb950" opacity="0.95" />
                <circle cx="0" cy="-30" r="6" fill="#d29922" />
                <circle cx="-32" cy="0" r="4" fill="#39d0d8" />
                <circle cx="32" cy="0" r="4" fill="#58a6ff" />
                <circle cx="0" cy="36" r="5" fill="#3fb950" />
              </g>
              <g stroke="#3fb950" stroke-width="0.6" stroke-dasharray="3,3" fill="none" opacity="0.4">
                <path d="M30,150 Q110,170 190,150" />
                <path d="M30,30 Q110,10 190,30" />
              </g>
            </svg>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- ── Real KPIs from user's account ─────────────────────── -->
    <a-row :gutter="[12, 12]">
      <a-col v-for="k in kpis" :key="k.key" :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="k.label" :value="k.value" :value-style="k.warn ? { color: 'var(--pb-warning)' } : undefined">
            <template #prefix><component :is="k.icon" class="kpi-ico" /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- ── 4-card product grid: pool v4 · pool v6 · hub · tools ── -->
    <a-row :gutter="[12, 12]">
      <a-col v-for="p in products" :key="p.type" :xs="24" :sm="12" :xl="6">
        <a-card hoverable class="product" @click="goBuy(p)">
          <a-flex align="center" gap="middle">
            <a-avatar shape="square" :size="46" :style="avatarStyle(p.color)">
              <template #icon><component :is="p.icon" /></template>
            </a-avatar>
            <a-flex vertical class="min0">
              <a-typography-text strong class="product-title">{{ t(p.labelKey) }}</a-typography-text>
              <a-typography-text type="secondary" class="small">{{ t(p.subKey) }}</a-typography-text>
            </a-flex>
          </a-flex>
          <a-typography-text type="secondary" class="small"><CheckOutlined class="feat-ico" /> {{ t(p.descKey) }}</a-typography-text>
          <a-flex wrap="wrap" align="baseline" :gap="6" class="product-price">
            <template v-if="p.kind === 'proxy'">
              <a-typography-text type="secondary">{{ t('cust.product.from') }}</a-typography-text>
              <strong class="mono price-val">{{ fmtMoney(p.perHour) }}</strong>
              <a-typography-text type="secondary" class="small">{{ currencyCode }} / {{ t('cust.buy.hour') }}</a-typography-text>
            </template>
            <template v-else-if="p.kind === 'hub'">
              <strong class="price-val" :style="{ color: ACCENT.cyan }">{{ t('cust.dash.vpsOwn') }}</strong>
              <a-typography-text type="secondary" class="small">{{ t('cust.dash.billedHourly') }}</a-typography-text>
            </template>
            <template v-else>
              <strong class="price-val" :style="{ color: ACCENT.amber }">FREE</strong>
              <a-typography-text type="secondary" class="small">{{ t('cust.dash.nodeYours') }}</a-typography-text>
            </template>
          </a-flex>
          <a-button block :type="p.kind === 'proxy' ? 'primary' : 'default'" @click.stop="goBuy(p)">
            {{ p.ctaKey ? t(p.ctaKey) : t('cust.product.buy') }}
          </a-button>
        </a-card>
      </a-col>
      <a-col v-for="n in (products.length ? 0 : 4)" :key="`sk-${n}`" :xs="24" :sm="12" :xl="6">
        <a-card><a-skeleton active :title="false" :paragraph="{ rows: 4 }" /></a-card>
      </a-col>
    </a-row>

    <!-- ── BYON: token + install commands row (compact, persistent) ── -->
    <a-card size="small">
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
        <a-space :size="6" wrap>
          <DeploymentUnitOutlined class="accent" />
          <a-typography-text strong>ProxyBox</a-typography-text>
          <a-typography-text type="secondary" class="small">{{ t('cust.dash.agentFree') }}</a-typography-text>
        </a-space>
        <a-button size="small" @click="router.push('/my-nodes')">
          <template #icon><CloudServerOutlined /></template>
          {{ t('cust.dash.manageNodes') }}
        </a-button>
      </a-flex>
      <a-divider dashed class="byon-divider" />

      <a-flex v-if="!fleetToken" justify="space-between" align="center" wrap="wrap" gap="small">
        <a-typography-text type="secondary">{{ t('cust.dash.tokenReady') }}</a-typography-text>
        <a-button type="primary" size="small" @click="generateFleetToken">
          <template #icon><PlusOutlined /></template>
          {{ t('cust.dash.showToken') }}
        </a-button>
      </a-flex>
      <template v-else>
        <a-flex align="center" gap="small" wrap="wrap" class="tok-line">
          <KeyOutlined class="muted-ico" />
          <a-typography-text code class="mono tok-val" :class="{ blurred: !tokenReveal }">{{ fleetToken.token }}</a-typography-text>
          <a-space :size="6">
            <a-button size="small" @click="tokenReveal = !tokenReveal">
              <template #icon><EyeInvisibleOutlined v-if="tokenReveal" /><EyeOutlined v-else /></template>
              {{ tokenReveal ? t('cust.dash.hide') : t('cust.dash.show') }}
            </a-button>
            <a-button size="small" :disabled="!tokenReveal" @click="copyCmd(fleetToken.token, 'tok')">
              <template #icon><CopyOutlined /></template>
              {{ copiedCmd === 'tok' ? '✓' : 'Copy' }}
            </a-button>
          </a-space>
        </a-flex>
        <a-row :gutter="[8, 8]">
          <a-col v-for="c in installCmds" :key="c.key" :xs="24" :md="12">
            <a-card size="small" class="cmd-card" :body-style="{ padding: '8px 12px' }">
              <template #title>
                <a-typography-text strong :type="c.danger ? 'danger' : undefined" class="small">{{ c.label }}</a-typography-text>
              </template>
              <template #extra>
                <a-button size="small" type="text" @click="copyCmd(c.cmd, c.key)">
                  <template #icon><CopyOutlined /></template>
                  {{ copiedCmd === c.key ? '✓' : 'Copy' }}
                </a-button>
              </template>
              <pre class="mono cmd">{{ c.cmd }}</pre>
            </a-card>
          </a-col>
        </a-row>
        <a-typography-paragraph type="secondary" class="byon-hint">
          <span v-html="t('cust.dash.tokenHint')"></span>
        </a-typography-paragraph>
      </template>
    </a-card>

    <!-- ── My proxies snippet ───────────────────────────────── -->
    <a-card :title="t('cust.proxies.title')" :body-style="{ paddingTop: '12px' }">
      <template #extra>
        <a-button type="link" size="small" @click="router.push({ name: 'proxies' })">{{ t('cust.viewAll') }} →</a-button>
      </template>
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="proxies-filter">
        <div class="seg-scroll"><a-segmented v-model:value="filterTab" :options="filterOptions" /></div>
        <a-space wrap>
          <a-button :loading="loading" @click="refresh">
            <template #icon><ReloadOutlined /></template>
            {{ t('cust.refresh') }}
          </a-button>
          <a-button type="primary" @click="router.push({ name: 'buy' })">
            <template #icon><PlusOutlined /></template>
            {{ t('cust.product.buy') }}
          </a-button>
        </a-space>
      </a-flex>

      <a-table
        :columns="columns"
        :data-source="filteredGroups"
        :pagination="pagination"
        row-key="id"
        size="middle"
        :scroll="{ x: 1000 }"
        @change="onTableChange"
      >
        <template #emptyText>
          <a-empty :description="t('cust.proxies.empty')">
            <a-button type="primary" @click="router.push({ name: 'buy' })">{{ t('cust.product.buy') }}</a-button>
          </a-empty>
        </template>
        <template #bodyCell="{ column, record: g }">
          <template v-if="column.key === 'name'">
            <a-typography-text strong class="mono">{{ g.name }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="String(g.type || 'ipv4').toLowerCase() === 'ipv6' ? 'green' : 'blue'" :bordered="false">{{ String(g.type || 'IPv4').toUpperCase() }}</a-tag>
          </template>
          <template v-else-if="column.key === 'endpoint'">
            <a-typography-text class="mono" :copyable="{ text: `${g.ip || g.bindIp}:${g.port}` }">{{ g.ip || g.bindIp }}:{{ g.port }}</a-typography-text>
            <a-typography-text v-if="g.proxies.length > 1" type="secondary" class="small"> (+{{ g.proxies.length - 1 }})</a-typography-text>
          </template>
          <template v-else-if="column.key === 'country'">
            <a-space :size="6"><CountryFlag :code="countryForProxy(g)" :size="18" /> {{ countryName(g) }}</a-space>
          </template>
          <template v-else-if="column.key === 'qty'">
            <span class="mono">{{ g.proxies.length }}</span>
          </template>
          <template v-else-if="column.key === 'expires'">
            <a-flex vertical>
              <span class="mono">{{ fmtExpiresAt(g.expiresAt) }}</span>
              <a-typography-text :type="TIER_TYPE[fmtCountdown(g.expiresAt).tier]" class="mono small">
                <ClockCircleOutlined /> {{ fmtCountdown(g.expiresAt).text }}
              </a-typography-text>
            </a-flex>
          </template>
          <template v-else-if="column.key === 'status'">
            <StatusTag :status="groupStatus(g)" :label="groupStatusLabel(groupStatus(g))" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button size="small" @click="openGroup(g)">{{ t('cust.col.detail') }}</a-button>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.hero { background-image: linear-gradient(135deg, var(--pb-primary-soft) 0%, transparent 55%); }
.hero :deep(.ant-card-body) { padding: 28px; }
.hero-title { margin-bottom: 8px !important; line-height: 1.25 !important; }
.hero-search { max-width: 520px; }
.hero-tags { margin-top: 16px; }
.hero-illust { height: 180px; display: grid; place-items: center; }
.flag-gap { margin-inline-end: 6px; }

.kpi-ico { color: var(--pb-primary); margin-inline-end: 4px; }

.product { height: 100%; }
.product :deep(.ant-card-body) { height: 100%; display: flex; flex-direction: column; gap: 12px; }
.product-title { font-size: 15px; }
.product-price { margin-top: auto; }
.price-val { font-size: 22px; font-weight: 700; color: var(--pb-primary); }
.feat-ico { color: var(--pb-primary); margin-inline-end: 4px; }
.min0 { min-width: 0; }
.small { font-size: 12px; }
.accent { color: var(--pb-primary); }
.muted-ico { color: var(--pb-text-3); }

.byon-divider { margin: 10px 0 12px; }
.tok-line { margin-bottom: 10px; }
.tok-val { flex: 1 1 260px; min-width: 0; margin: 0; transition: filter 120ms; }
.tok-val.blurred { filter: blur(4px); user-select: none; }
.cmd { margin: 0; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.cmd-card { height: 100%; }
.byon-hint { margin: 12px 0 0 !important; font-size: 12px; }

.proxies-filter { margin-bottom: 12px; }
.seg-scroll { max-width: 100%; min-width: 0; overflow-x: auto; }

@media (max-width: 575px) {
  .hero :deep(.ant-card-body) { padding: 18px; }
  .cmd { font-size: 10.5px; }
}
</style>
