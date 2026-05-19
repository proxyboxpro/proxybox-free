<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity, Book, Box, ChevronLeft, ChevronUp, Cpu, Gift, Globe, HelpCircle, Home, KeyRound,
  LogOut, Menu, Moon, Network, Plus, Receipt, Server, ShieldCheck, ShoppingBag,
  ShoppingCart, Sun, User, Wallet, Wrench
} from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { apiFetch, token, logout as apiLogout } from '../api'
import { theme, toggleTheme } from '../theme'
import CountryFlag from '../components/CountryFlag.vue'
import BroadcastBanner from '../components/BroadcastBanner.vue'
import NotificationBell from '../components/NotificationBell.vue'
import OnboardingTour from '../components/OnboardingTour.vue'

const route = useRoute()
const router = useRouter()
const { t, locale, setLocale } = useI18n()
const account = ref(null)
const zones = ref([])

// App version injected at build time by Vite (vite.config.js → define block).
// Falls back to the env var so dev mode still shows something.
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : (import.meta.env?.VITE_APP_VERSION || '0.0.0'))

const drawerOpen = ref(false)
const userMenuOpen = ref(false)
// Desktop-only collapsed state, persisted across reloads.
const SIDE_COLLAPSE_KEY = 'proxyhub.customer.sideCollapsed'
const sidebarCollapsed = ref(typeof localStorage !== 'undefined' && localStorage.getItem(SIDE_COLLAPSE_KEY) === '1')
function openDrawer() { drawerOpen.value = true }
function closeDrawer() { drawerOpen.value = false }
function toggleUserMenu() { userMenuOpen.value = !userMenuOpen.value }
function closeUserMenu() { userMenuOpen.value = false }
// Single chevron button handles both: close drawer on mobile, toggle collapse on desktop.
function toggleSidebar() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches) {
    drawerOpen.value = false
    return
  }
  sidebarCollapsed.value = !sidebarCollapsed.value
  try { localStorage.setItem(SIDE_COLLAPSE_KEY, sidebarCollapsed.value ? '1' : '0') } catch { /* ignore */ }
}
watch(() => route.fullPath, () => { closeDrawer(); closeUserMenu() })

// Items in the upward-popping menu when clicking the avatar chip.
const userMenuItems = [
  { name: 'account',  labelKey: 'cust.user.profile',  icon: User },
  { name: 'account',  labelKey: 'cust.user.security', icon: ShieldCheck, hash: '#security' },
  { name: 'account',  labelKey: 'cust.user.apikey',   icon: KeyRound,    hash: '#api' },
  { name: 'api-docs', labelKey: 'cust.user.apiDocs',  icon: Book },
  { name: 'faq',      labelKey: 'cust.user.faq',      icon: HelpCircle }
]
function goUserMenu(item) {
  closeUserMenu()
  if (item.hash) router.push({ name: item.name, hash: item.hash })
  else router.push({ name: item.name })
}

// Main mobile bottom-nav (unchanged — sidebar handles desktop nav)
const mobileNav = [
  { name: 'dashboard', labelKey: 'cust.nav.home',    icon: Home },
  { name: 'proxies',   labelKey: 'cust.nav.proxies', icon: Network },
  { name: 'buy',       labelKey: 'cust.nav.buy',     icon: Plus, fab: true },
  { name: 'billing',   labelKey: 'cust.nav.topup',   icon: Wallet },
  { name: 'account',   labelKey: 'cust.nav.account', icon: User }
]

// All sidebar items now live in 3 grouped sections (Vinaproxy-style).
// PROXY section = buy/manage/orders. ACCOUNT section = wallet/usage/etc.
// VỊ TRÍ section = real zones from API (rendered separately below).
const sectionProxy = [
  { name: 'buy',         labelKey: 'cust.side.itemBuy',        icon: ShoppingCart, badge: 'HOT' },
  { name: 'proxies',     labelKey: 'cust.cat.myIpv4',          icon: Server,       query: { type: 'ipv4' } },
  { name: 'proxies',     labelKey: 'cust.cat.myIpv6',          icon: Globe,        query: { type: 'ipv6' } },
  { name: 'my-nodes',    labelKey: 'cust.side.itemMyNodes',    icon: Cpu,          badge: 'FREE' },
  { name: 'connections', labelKey: 'cust.side.itemConnections', icon: Activity }
]
const sectionAccount = [
  { name: 'billing',   labelKey: 'cust.side.itemTopup',    icon: Wallet },
  { name: 'usage',     labelKey: 'cust.side.itemBandwidth',icon: Activity },
  { name: 'affiliate', labelKey: 'cust.side.itemAffiliate',icon: Gift, badge: 'NEW' },
  { name: 'account',   labelKey: 'cust.side.itemAccount',  icon: User },
  { name: 'faq',       labelKey: 'cust.side.itemSupport',  icon: HelpCircle }
]

function isItemActive(item) {
  if (route.name !== item.name) return false
  if (!item.query) return !route.query.type
  return Object.entries(item.query).every(([k, v]) => String(route.query[k]) === String(v))
}

const filteredProxy = computed(() => sectionProxy)
const filteredAccount = computed(() => sectionAccount)

// Top bar page title — resolves the current route to a friendly label.
const pageTitle = computed(() => {
  const map = {
    dashboard: 'cust.nav.home',
    buy: 'cust.nav.buy',
    proxies: 'cust.nav.proxies',
    billing: 'cust.nav.topup',
    usage: 'cust.nav.bandwidth',
    affiliate: 'cust.nav.support',
    account: 'cust.nav.account',
    'api-docs': 'cust.user.apiDocs',
    tools: 'cust.tools.hub.title',
    'tools-ping': 'cust.tools.ping.title',
    'tools-bulk-check': 'cust.tools.bulk.title',
    'tools-ip-info': 'cust.tools.ipInfo.title',
    'tools-blacklist': 'cust.tools.blacklist.title',
    'tools-speed-test': 'cust.tools.speed.title'
  }
  const key = map[route.name]
  return key ? t(key) : ''
})

// Locations: show ALL admin-configured zones. Zones with 0 online nodes get a
// "Sắp ra mắt" (Coming soon) badge and are disabled.
const locations = computed(() => {
  const out = [{ code: 'GLOBAL', name: t('cust.loc.all'), flag: null, online: 1, comingSoon: false }]
  for (const z of zones.value) {
    const online = z.onlineNodes ?? 0
    out.push({
      code: z.id,
      name: z.name,
      flag: z.flag,
      online,
      comingSoon: online === 0
    })
  }
  return out
})

function selectLocation(loc) {
  if (loc.comingSoon) return
  router.push({ name: 'buy', query: loc.code === 'GLOBAL' ? {} : { country: loc.code } })
}

const currentName = computed(() => route.name || 'dashboard')
function isActive(name) { return currentName.value === name }
// Location buttons: active when ?country matches.
function isLocActive(loc) {
  if (route.name !== 'buy') return false
  return (route.query?.country || 'GLOBAL') === loc.code
}
function flagFor(loc) {
  if (loc.flag) return loc.flag
  // Backend may store zone.flag as a 2-letter country code (e.g. "VN"); fall back to slug prefix.
  return loc.code.slice(0, 2).toUpperCase()
}

function switchLanguage(next) { setLocale(next) }
async function logout() { await apiLogout(); router.push({ name: 'login' }) }

const balanceVnd = computed(() => Number(account.value?.balance || 0))
const userInitial = computed(() => {
  const s = account.value?.name || account.value?.email || 'U'
  return s.slice(0, 1).toUpperCase()
})

watch(token, (value) => { if (!value) router.push({ name: 'login' }) })
onMounted(async () => {
  try { account.value = await apiFetch('/api/v1/user/account') } catch { /* not customer or no api */ }
  try { zones.value = await apiFetch('/api/v1/user/zones') } catch { zones.value = [] }
})
</script>

<template>
  <div class="px-shell" data-portal="customer" :class="{ 'is-collapsed': sidebarCollapsed }">
    <aside :class="['px-side', { 'drawer-open': drawerOpen, 'is-collapsed': sidebarCollapsed }]">
      <!-- Brand block (top) -->
      <div class="px-brand-block">
        <RouterLink :to="{ name: 'dashboard' }" class="px-brand-left" :title="t('cust.nav.home')">
          <span class="px-brand-mark"><Box :size="18" /></span>
          <div class="px-brand-text">
            <strong>ProxyBox<span class="pro-tag">Pro</span></strong>
            <span class="brand-sub">{{ t('cust.side.premium') }}</span>
          </div>
        </RouterLink>
        <button class="brand-collapse" type="button" :aria-label="t('app.menu')" :title="sidebarCollapsed ? t('cust.side.expand') : t('cust.side.collapse')" @click="toggleSidebar"><ChevronLeft :size="14" /></button>
      </div>

      <!-- Section: PROXY -->
      <div class="px-side-section"><span class="dot"></span>{{ t('cust.side.sectionProxy') }}</div>
      <div class="px-side-list">
        <RouterLink
          v-for="item in filteredProxy" :key="item.labelKey + (item.query?.type || '')"
          :to="{ name: item.name, query: item.query || {} }"
          class="px-side-item"
          :class="{ active: isItemActive(item) }"
          active-class="" exact-active-class=""
          :title="sidebarCollapsed ? t(item.labelKey) : null"
        >
          <component :is="item.icon" />
          <span class="loc-name">{{ t(item.labelKey) }}</span>
          <span v-if="item.badge" class="badge-pill" :class="`b-${item.badge.toLowerCase()}`">{{ item.badge }}</span>
        </RouterLink>
      </div>

      <!-- Section: TÀI KHOẢN -->
      <div class="px-side-section"><span class="dot"></span>{{ t('cust.side.sectionAccount') }}</div>
      <div class="px-side-list">
        <RouterLink
          v-for="item in filteredAccount" :key="item.labelKey"
          :to="{ name: item.name }"
          class="px-side-item"
          :class="{ active: isItemActive(item) }"
          active-class="" exact-active-class=""
          :title="sidebarCollapsed ? t(item.labelKey) : null"
        >
          <component :is="item.icon" />
          <span class="loc-name">{{ t(item.labelKey) }}</span>
          <span v-if="item.badge" class="badge-pill" :class="`b-${item.badge.toLowerCase()}`">{{ item.badge }}</span>
        </RouterLink>
      </div>

      <!-- Tools: single entry, the hub page lists all sub-tools as cards -->
      <RouterLink
        :to="{ name: 'tools' }"
        class="px-side-item"
        :class="{ active: route.name === 'tools' || String(route.name || '').startsWith('tools-') }"
        active-class="" exact-active-class=""
        :title="sidebarCollapsed ? t('cust.side.itemToolsHub') : null"
      >
        <Wrench />
        <span class="loc-name">{{ t('cust.side.itemToolsHub') }}</span>
      </RouterLink>

      <!-- Section: VỊ TRÍ (real zones) -->
      <div v-if="locations.length > 1" class="px-side-section"><span class="dot"></span>{{ t('cust.side.locations') }}</div>
      <div v-if="locations.length > 1" class="px-side-list">
        <button
          v-for="loc in locations" :key="loc.code"
          type="button" class="px-side-item"
          :class="{ active: isLocActive(loc), 'is-soon': loc.comingSoon }"
          :disabled="loc.comingSoon"
          @click="selectLocation(loc)"
        >
          <span class="flag-wrap">
            <CountryFlag v-if="loc.code !== 'GLOBAL'" :code="flagFor(loc)" :size="22" />
            <Globe v-else :size="16" />
          </span>
          <span class="loc-name">{{ loc.name }}</span>
          <span v-if="loc.comingSoon" class="badge-soon">{{ t('cust.side.comingSoon') }}</span>
        </button>
      </div>

      <!-- Bottom: balance card + user chip pinned -->
      <div class="px-side-foot">
        <button class="px-balance-foot" type="button" :title="sidebarCollapsed ? `${t('cust.side.balance')}: ${balanceVnd.toLocaleString()}đ` : null" @click="router.push({ name: 'billing' })">
          <span class="ico"><Wallet :size="14" /></span>
          <div class="info">
            <span class="lbl">{{ t('cust.side.balance') }}</span>
            <strong>{{ balanceVnd.toLocaleString() }}<small>đ</small></strong>
            <span class="hint">{{ t('cust.side.clickTopup') }}</span>
          </div>
        </button>

        <div class="px-side-user-wrap">
          <div v-if="userMenuOpen" class="user-menu-backdrop" @click="closeUserMenu"></div>
          <div v-if="userMenuOpen" class="user-menu-pop" @click.stop>
            <header>
              <span class="avatar-lg">{{ userInitial }}</span>
              <div class="hdr-meta">
                <strong>{{ account?.name || account?.email }}</strong>
                <span>{{ account?.email }}</span>
              </div>
            </header>
            <div class="menu-list">
              <button v-for="item in userMenuItems" :key="item.labelKey" type="button" @click="goUserMenu(item)">
                <component :is="item.icon" :size="15" />
                {{ t(item.labelKey) }}
              </button>
            </div>
            <div class="menu-sep"></div>
            <button type="button" class="logout-btn" @click="logout">
              <LogOut :size="15" /> {{ t('app.logout') }}
            </button>
          </div>
          <button class="px-side-user" type="button" :class="{ open: userMenuOpen }" :title="sidebarCollapsed ? (account?.name || account?.email || 'user') : null" @click="toggleUserMenu">
            <span class="avatar">{{ userInitial }}<span class="online-dot"></span></span>
            <span class="name">{{ account?.name || account?.email || 'user' }}</span>
            <ChevronUp :size="14" class="chevron" />
          </button>
        </div>

        <!-- ProxyBox Free version chip — visible on every customer page so
             operators always know which build is live. Clicking opens the
             FAQ self-host doc which doubles as a changelog entry point. -->
        <a class="px-version-chip" :href="`/faq#self-host-panel`" :title="`ProxyBox Free v${appVersion} — Click xem docs`">
          <span class="chip-dot"></span>
          <span class="chip-text">ProxyBox Free</span>
          <span class="chip-ver">v{{ appVersion }}</span>
        </a>
      </div>
    </aside>

    <!-- Top utility bar (page-level actions only — main nav lives in sidebar) -->
    <header class="px-top">
      <button class="menu-btn" type="button" :aria-label="t('app.menu')" @click="openDrawer"><Menu :size="18" /></button>
      <h1 v-if="pageTitle" class="page-title">{{ pageTitle }}</h1>
      <div class="spacer"></div>
      <div class="px-top-right">
        <NotificationBell />
        <button type="button" class="theme-btn" :aria-label="t('app.themeDark')" @click="toggleTheme">
          <Sun v-if="theme === 'dark'" :size="16" />
          <Moon v-else :size="16" />
        </button>
        <div class="lang-toggle">
          <button :class="{ active: locale === 'vi' }" type="button" @click="switchLanguage('vi')">VI</button>
          <button :class="{ active: locale === 'en' }" type="button" @click="switchLanguage('en')">EN</button>
        </div>
      </div>
    </header>

    <BroadcastBanner />
    <main class="px-main">
      <RouterView />
    </main>

    <div v-if="drawerOpen" class="drawer-backdrop open" @click="closeDrawer"></div>

    <nav class="px-mobile-nav">
      <RouterLink
        v-for="item in mobileNav" :key="item.name"
        :to="{ name: item.name }"
        :class="{ active: isActive(item.name) }"
      >
        <span v-if="item.fab" class="px-mobile-fab">
          <component :is="item.icon" />
        </span>
        <template v-else>
          <component :is="item.icon" />
          <span class="label">{{ t(item.labelKey) }}</span>
        </template>
      </RouterLink>
    </nav>
    <OnboardingTour />
  </div>
</template>
