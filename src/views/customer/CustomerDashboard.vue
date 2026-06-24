<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Check, ChevronLeft, ChevronRight, Clock, Cloud, Copy, Cpu, Globe, KeyRound, Plus, RefreshCw,
  Search, Server, ShieldCheck, Terminal, Wrench
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'

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
function fmtExpiresAt(expiresAt) {
  if (!expiresAt) return '—'
  const d = new Date(expiresAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function refresh() {
  try {
    [account.value, proxies.value, pricing.value, zones.value] = await Promise.all([
      apiFetch('/api/v1/user/account'),
      apiFetch('/api/v1/user/proxies').catch(() => []),
      apiFetch('/api/v1/user/pricing').catch(() => null),
      apiFetch('/api/v1/user/zones').catch(() => [])
    ])
  } catch { /* not logged in as customer */ }
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
const currencyCode = computed(() => String(pricing.value?.currency || 'VND').toUpperCase())
const products = computed(() => {
  if (!pricing.value) return []
  return [
    { kind: 'proxy', type: 'ipv4', color: 'blue',  icon: Server, labelKey: 'cust.buy.t.ipv4', subKey: 'cust.buy.t.ipv4Sub', descKey: 'cust.buy.t.ipv4Desc', perHour: Number(pricing.value.ipv4?.perHour || 0) },
    { kind: 'proxy', type: 'ipv6', color: 'green', icon: Globe,  labelKey: 'cust.buy.t.ipv6', subKey: 'cust.buy.t.ipv6Sub', descKey: 'cust.buy.t.ipv6Desc', perHour: Number(pricing.value.ipv6?.perHour || 0) },
    { kind: 'hub',   type: 'hub',  color: 'cyan',  icon: Cloud,  labelKey: 'cust.dash.hubLabel',  subKey: 'cust.dash.hubSub',  descKey: 'cust.dash.hubDesc',  ctaKey: 'cust.dash.hubCta' },
    { kind: 'tool',  type: 'byon', color: 'amber', icon: Wrench, labelKey: 'cust.dash.byonLabel', subKey: 'cust.dash.byonSub', descKey: 'cust.dash.byonDesc', ctaKey: 'cust.dash.byonCta' }
  ]
})

// Real stats from user's own proxies — replaces generic "99.9% uptime" marketing copy.
const myStats = computed(() => {
  const list = proxies.value
  const active = list.filter((p) => p.status === 'active').length
  const expiring = list.filter((p) => p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 86_400_000 * 3 && p.status === 'active').length
  const totalBytes = list.reduce((s, p) => s + Number(p.stats?.uploadBytes || 0) + Number(p.stats?.downloadBytes || 0), 0)
  const uniqueZones = new Set(list.map((p) => p.zone).filter(Boolean)).size
  return { total: list.length, active, expiring, totalBytes, uniqueZones }
})
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

const filteredGroups = computed(() => {
  const list = proxyGroups.value
  if (filterTab.value === 'all') return list
  return list.filter((g) => groupStatus(g) === filterTab.value)
})

const PAGE_SIZE = 10
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredGroups.value.length / PAGE_SIZE)))
const pagedGroups = computed(() => filteredGroups.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
watch([filterTab, filteredGroups], () => { if (page.value > totalPages.value) page.value = 1 })

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
function fmtExpires(at) {
  if (!at) return '—'
  return String(at).slice(0, 16).replace('T', ' ')
}

onMounted(() => {
  refresh()
  loadFleetToken()
  tickInterval = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => { if (tickInterval) clearInterval(tickInterval) })
</script>

<template>
  <!-- ── Hero ──────────────────────────────────────────────── -->
  <section class="px-hero">
    <div>
      <h2>{{ t('cust.hero.title1') }}<br>{{ t('cust.hero.title2') }}</h2>
      <p class="sub-text">{{ t('cust.hero.tagline') }}</p>
      <form class="px-hero-search" @submit.prevent="searchProxies">
        <Search :size="16" style="color:var(--muted)" />
        <input v-model="search" type="search" :placeholder="t('cust.hero.searchPlaceholder')" />
        <button class="btn" type="submit">{{ t('cust.hero.search') }}</button>
      </form>
      <div v-if="popularZones.length" class="px-hero-tags">
        <span class="lbl">{{ t('cust.hero.popular') }}:</span>
        <button v-for="z in popularZones" :key="z.id" class="px-hero-tag" type="button" @click="router.push({ name: 'buy', query: { country: z.id } })">
          <CountryFlag :code="(z.flag || z.id.slice(0,2)).toUpperCase()" :size="14" /> {{ z.name }}
        </button>
      </div>
    </div>
    <div class="px-hero-illust" aria-hidden="true">
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
  </section>

  <!-- ── Real KPIs from user's account ─────────────────────── -->
  <div class="px-quickstats">
    <div><div class="ico"><Server :size="18" /></div><div><div class="lbl">{{ t('cust.dash.kpiOwned') }}</div><div class="val">{{ myStats.total }}</div></div></div>
    <div><div class="ico"><ShieldCheck :size="18" /></div><div><div class="lbl">{{ t('cust.dash.kpiActive') }}</div><div class="val">{{ myStats.active }}</div></div></div>
    <div><div class="ico"><Clock :size="18" /></div><div><div class="lbl">{{ t('cust.dash.kpiExpiring') }}</div><div class="val">{{ myStats.expiring }}</div></div></div>
    <div><div class="ico"><Globe :size="18" /></div><div><div class="lbl">{{ t('cust.dash.kpiTraffic') }}</div><div class="val">{{ fmtBytes(myStats.totalBytes) }}</div></div></div>
  </div>

  <!-- ── 4-card product grid: pool v4 · pool v6 · hub · tools ── -->
  <div class="product-grid quad" style="margin-bottom:14px">
    <div
      v-for="p in products"
      :key="p.type"
      class="product-card"
      :class="{ 'is-hub': p.kind === 'hub', 'is-tool': p.kind === 'tool' }"
      @click="goBuy(p)"
    >
      <div class="head">
        <span class="icon-box" :class="p.color"><component :is="p.icon" :size="22" /></span>
        <div>
          <h3>{{ p.labelKey ? t(p.labelKey) : p.label }}</h3>
          <p class="desc-sub">{{ p.subKey ? t(p.subKey) : p.sub }}</p>
        </div>
      </div>
      <p class="feat"><Check :size="13" /> {{ p.descKey ? t(p.descKey) : p.desc }}</p>
      <div class="price">
        <template v-if="p.kind === 'proxy'">
          {{ t('cust.product.from') }}
          <strong>{{ fmtMoney(p.perHour) }}</strong>
          <small>{{ currencyCode }} / {{ t('cust.buy.hour') }}</small>
        </template>
        <template v-else-if="p.kind === 'hub'">
          <strong style="color: #22d3ee">{{ t('cust.dash.vpsOwn') }}</strong>
          <small>{{ t('cust.dash.billedHourly') }}</small>
        </template>
        <template v-else>
          <strong style="color: #fbbf24">FREE</strong>
          <small>{{ t('cust.dash.nodeYours') }}</small>
        </template>
      </div>
      <button class="buy-btn" type="button" @click.stop="goBuy(p)">
        {{ p.ctaKey ? t(p.ctaKey) : (p.cta || t('cust.product.buy')) }}
      </button>
    </div>
    <p v-if="!products.length" class="empty-text" style="grid-column: 1 / -1; color: var(--muted)">{{ t('common.loading') }}</p>
  </div>

  <!-- ── BYON: token + install commands row (compact, persistent) ── -->
  <section class="byon-row surface">
    <header>
      <span><Cpu :size="14" style="vertical-align:-2px; color: var(--green)" /> <strong>ProxyBox</strong> <small>{{ t('cust.dash.agentFree') }}</small></span>
      <router-link to="/my-nodes" class="ghost-button" style="margin-left:auto"><Server :size="13" /> {{ t('cust.dash.manageNodes') }}</router-link>
    </header>
    <div v-if="!fleetToken" class="byon-empty">
      <p>{{ t('cust.dash.tokenReady') }}</p>
      <button class="primary-action small" type="button" @click="generateFleetToken"><Plus :size="13" /> {{ t('cust.dash.showToken') }}</button>
    </div>
    <template v-else>
      <div class="tok-line">
        <KeyRound :size="13" style="color: var(--muted)" />
        <code class="tok-val" :class="{ blurred: !tokenReveal }">{{ fleetToken.token }}</code>
        <button class="ghost-button mini" type="button" @click="tokenReveal = !tokenReveal">{{ tokenReveal ? t('cust.dash.hide') : t('cust.dash.show') }}</button>
        <button class="ghost-button mini" type="button" :disabled="!tokenReveal" @click="copyCmd(fleetToken.token, 'tok')"><Copy :size="11" /> {{ copiedCmd === 'tok' ? '✓' : 'Copy' }}</button>
      </div>
      <div class="cmd-grid">
        <div class="cmd-card">
          <header><strong>🌐 Linux IPv4</strong>
            <button class="ghost-button mini" type="button" @click="copyCmd(fleetToken.installLinuxV4, 'v4')"><Copy :size="11" /> {{ copiedCmd === 'v4' ? '✓' : 'Copy' }}</button>
          </header>
          <code>{{ fleetToken.installLinuxV4 }}</code>
        </div>
        <div class="cmd-card">
          <header><strong>🛰 Linux IPv6</strong>
            <button class="ghost-button mini" type="button" @click="copyCmd(fleetToken.installLinuxV6, 'v6')"><Copy :size="11" /> {{ copiedCmd === 'v6' ? '✓' : 'Copy' }}</button>
          </header>
          <code>{{ fleetToken.installLinuxV6 }}</code>
        </div>
        <div class="cmd-card">
          <header><strong>🪟 Windows (Admin)</strong>
            <button class="ghost-button mini" type="button" @click="copyCmd(fleetToken.installWindows, 'win')"><Copy :size="11" /> {{ copiedCmd === 'win' ? '✓' : 'Copy' }}</button>
          </header>
          <code>{{ fleetToken.installWindows }}</code>
        </div>
        <div class="cmd-card danger">
          <header><strong>🗑 {{ t('cust.dash.uninstall') }}</strong>
            <button class="ghost-button mini" type="button" @click="copyCmd(fleetToken.uninstall, 'un')"><Copy :size="11" /> {{ copiedCmd === 'un' ? '✓' : 'Copy' }}</button>
          </header>
          <code>{{ fleetToken.uninstall }}</code>
        </div>
      </div>
      <p class="byon-hint" v-html="t('cust.dash.tokenHint')"></p>
    </template>
  </section>

  <!-- ── My proxies snippet ───────────────────────────────── -->
  <section class="dt2">
    <div class="dt2-toolbar" style="border-bottom:1px solid var(--pxl-bd-soft)">
      <div>
        <h2 style="margin:0; font-size:16px; color:var(--text)">{{ t('cust.proxies.title') }}</h2>
      </div>
      <div class="segment-tabs" style="background:transparent; border:none; padding:0">
        <button :class="{ active: filterTab === 'all' }" type="button" @click="filterTab = 'all'">{{ t('cust.filter.all') }}</button>
        <button :class="{ active: filterTab === 'active' }" type="button" @click="filterTab = 'active'">{{ t('cust.filter.active') }}</button>
        <button :class="{ active: filterTab === 'expiring' }" type="button" @click="filterTab = 'expiring'">{{ t('cust.filter.expiring') }}</button>
        <button :class="{ active: filterTab === 'expired' }" type="button" @click="filterTab = 'expired'">{{ t('cust.filter.expired') }}</button>
      </div>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /> {{ t('cust.refresh') }}</button>
      <button class="primary-action small" type="button" @click="router.push({ name: 'buy' })"><Plus :size="13" /> {{ t('cust.product.buy') }}</button>
    </div>

    <div class="dt2-head" style="grid-template-columns: 1.2fr 0.9fr 1.2fr 1.2fr 0.6fr 1.1fr 1fr 0.6fr">
      <span>{{ t('cust.col.name') }}</span>
      <span>{{ t('cust.col.type') }}</span>
      <span>{{ t('cust.col.endpoint') }}</span>
      <span>{{ t('cust.col.country') }}</span>
      <span>{{ t('cust.col.qty') }}</span>
      <span>{{ t('cust.col.expires') }}</span>
      <span>{{ t('cust.col.status') }}</span>
      <span>{{ t('cust.col.action') }}</span>
    </div>

    <template v-if="pagedGroups.length">
      <div v-for="g in pagedGroups" :key="g.id" class="dt2-row" style="grid-template-columns: 1.2fr 0.9fr 1.2fr 1.2fr 0.6fr 1.1fr 1fr 0.6fr">
        <span class="name">{{ g.name }}</span>
        <span><span :class="['tag-soft', String(g.type || 'ipv4').toLowerCase()]">{{ String(g.type || 'IPv4').toUpperCase() }}</span></span>
        <span class="cell-mono">{{ g.ip || g.bindIp }}:{{ g.port }}<span v-if="g.proxies.length > 1" style="color:var(--muted); margin-left:4px">(+{{ g.proxies.length - 1 }})</span></span>
        <span class="country"><CountryFlag :code="countryForProxy(g)" :size="18" /> {{ countryName(g) }}</span>
        <span>{{ g.proxies.length }}</span>
        <span class="cell-mono expires-cell">
          <strong>{{ fmtExpiresAt(g.expiresAt) }}</strong>
          <small :class="['countdown', fmtCountdown(g.expiresAt).tier]">
            ⏱ {{ fmtCountdown(g.expiresAt).text }}
          </small>
        </span>
        <span><span :class="['tag-soft', groupStatus(g)]">{{ ({ active: 'active', expiring: t('cust.dash.stExpiring'), expired: t('cust.dash.stExpired'), mixed: t('cust.dash.stMixed') })[groupStatus(g)] || groupStatus(g) }}</span></span>
        <button class="row-action" type="button" @click="g.orderId ? router.push({ name: 'proxies', query: { order: g.orderId } }) : router.push({ name: 'proxies' })">{{ t('cust.col.detail') }}</button>
      </div>
    </template>
    <div v-else class="dt2-row" style="grid-template-columns: 1fr; color: var(--muted); justify-content: center; text-align:center; padding: 30px">
      <span>{{ t('cust.proxies.empty') }} <button class="px-promo-btn" type="button" style="margin-left:8px" @click="router.push({ name: 'buy' })">{{ t('cust.product.buy') }}</button></span>
    </div>

    <div v-if="totalPages > 1" class="dt2-pager">
      <span style="color:var(--muted); font-size:12px">{{ filteredGroups.length }} {{ t('cust.col.groups') }} · {{ t('cust.pager.page') }} {{ page }}/{{ totalPages }}</span>
      <span class="spacer"></span>
      <button type="button" :disabled="page <= 1" @click="page--"><ChevronLeft :size="13" /> {{ t('cust.pager.prev') }}</button>
      <button type="button" :disabled="page >= totalPages" @click="page++">{{ t('cust.pager.next') }} <ChevronRight :size="13" /></button>
      <button type="button" @click="router.push({ name: 'proxies' })">{{ t('cust.viewAll') }} →</button>
    </div>
  </section>
</template>

<style scoped>
/* 4-card product grid (pool v4 · pool v6 · hub · tools).
   Desktop: 4 columns. Tablet ≤960px: 2 columns. Phone ≤520px: 1 column. */
.product-grid.quad { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 960px) { .product-grid.quad { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 520px) { .product-grid.quad { grid-template-columns: 1fr; gap: 10px; } }

/* Hub + Tool tile color accents (override default .product-card border on hover). */
.product-card.is-hub  { border-color: rgba(34, 211, 238, 0.25); }
.product-card.is-hub:hover  { border-color: rgba(34, 211, 238, 0.55); }
.product-card.is-tool { border-color: rgba(251, 191, 36, 0.25); }
.product-card.is-tool:hover { border-color: rgba(251, 191, 36, 0.55); }
.product-card.is-hub  .icon-box.cyan  { background: rgba(34, 211, 238, 0.14); color: #22d3ee; border: 1px solid rgba(34, 211, 238, 0.4); }
.product-card.is-tool .icon-box.amber { background: rgba(251, 191, 36, 0.14); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); }
.product-card.is-hub  .buy-btn { background: rgba(34, 211, 238, 0.16); color: #22d3ee; border: 1px solid rgba(34, 211, 238, 0.35); }
.product-card.is-tool .buy-btn { background: rgba(251, 191, 36, 0.16); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.35); }

/* BYON row (token + install) */
.byon-row { padding: 14px 16px; margin-bottom: 18px; }
.byon-row > header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-bottom: 10px; margin-bottom: 10px;
  border-bottom: 1px dashed var(--border);
}
.byon-row > header strong { font-size: 14px; color: var(--text); }
.byon-row > header small { font-size: 11.5px; color: var(--muted); }
.byon-empty { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
.byon-empty p { margin: 0; font-size: 12.5px; color: var(--muted); }

.tok-line { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tok-val {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: 11.5px;
  color: var(--green); padding: 5px 10px;
  background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: 5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  filter: none; transition: filter 120ms;
}
.tok-val.blurred { filter: blur(4px); user-select: none; }

.cmd-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
@media (max-width: 700px) { .cmd-grid { grid-template-columns: 1fr; } }
.cmd-card {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 5px;
}
.cmd-card.danger { border-color: rgba(239,68,68,0.25); }
.cmd-card.danger strong { color: #f87171; }
.cmd-card header { display: flex; align-items: center; justify-content: space-between; }
.cmd-card strong { font-size: 12px; color: var(--text); }
.cmd-card code {
  font-family: var(--mono); font-size: 10.5px;
  background: rgba(0,0,0,0.35); border-radius: 4px;
  padding: 6px 8px; color: #9bb8b1;
  overflow-x: auto; white-space: nowrap;
}
.ghost-button.mini { padding: 2px 7px; font-size: 10.5px; }
.byon-hint { margin: 10px 0 0; font-size: 11px; color: var(--muted); line-height: 1.5; }
.byon-hint code { font-family: var(--mono); background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; font-size: 10.5px; color: #d6c060; }

@media (max-width: 640px) {
  .byon-row { padding: 12px 11px; }
  .byon-row > header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .byon-row > header .ghost-button { margin-left: 0 !important; align-self: stretch; justify-content: center; }
  .byon-row > header > span { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; }
  .byon-row > header > span small { display: block; font-size: 11px; line-height: 1.4; }
  .tok-line { flex-wrap: wrap; gap: 6px; }
  .tok-val { flex: 1 1 100%; order: -1; font-size: 10.5px; padding: 6px 8px; }
  .tok-line .ghost-button.mini { flex: 1; justify-content: center; padding: 5px 8px; font-size: 11px; }
  .cmd-grid { gap: 6px; }
  .cmd-card { padding: 7px 8px; }
  .cmd-card header { gap: 6px; }
  .cmd-card code { font-size: 9.5px; padding: 5px 6px; white-space: pre-wrap; word-break: break-all; }
  .byon-empty { flex-direction: column; align-items: stretch; gap: 8px; }
  .byon-empty .primary-action { width: 100%; justify-content: center; }
  .byon-hint { font-size: 10.5px; line-height: 1.5; }
}
@media (max-width: 380px) {
  .cmd-card strong { font-size: 11px; }
  .cmd-card code { font-size: 9px; }
  .tok-val { font-size: 9.5px; letter-spacing: -0.2px; }
}
</style>
