<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity, AlertCircle, BarChart3, Book, Box, Cloud, CreditCard, DollarSign, Download, FileText, Globe, Heart, KeyRound, LayoutDashboard, LogOut,
  Mail, Megaphone, Menu, Moon, Network, Server, Settings, ShieldCheck, ShoppingCart, Sun,
  Tag, Ticket, User, Users, Wallet, Webhook, ChevronRight, MoreHorizontal, Gift
} from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { token, logout as apiLogout } from '../api'
import { profile } from '../store/profile'
import { proxyState, loadBackendData } from '../store/proxies'
import { theme, toggleTheme } from '../theme'
import BroadcastBanner from '../components/BroadcastBanner.vue'
import NotificationBell from '../components/NotificationBell.vue'

const route = useRoute()
const router = useRouter()
const { t, locale, setLocale } = useI18n()

// Build-time version (see vite.config.js `define`). Shown in the sidebar
// chip so admin/operator always knows which build is running.
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const drawerOpen = ref(false)
function openDrawer() { drawerOpen.value = true }
function closeDrawer() { drawerOpen.value = false }
watch(() => route.fullPath, closeDrawer)

// Sidebar grouped by domain. Order matters — first group is "Overview".
const navGroups = [
  { id: 'overview', labelKey: 'nav.overview', items: [
    { name: 'admin-dashboard',     labelKey: 'page.dashboard',    icon: LayoutDashboard }
  ] },
  { id: 'infra', labelKey: 'nav.infra', items: [
    { name: 'admin-orders',        labelKey: 'page.proxiesOrders',icon: Network },
    { name: 'admin-connections',   labelKey: 'page.connections',  icon: Activity },
    { name: 'admin-bandwidth',     labelKey: 'page.bandwidth',    icon: BarChart3 },
    { name: 'admin-health',        labelKey: 'page.health',       icon: Heart },
    { name: 'admin-nodes',         labelKey: 'page.nodes',        icon: Server },
    { name: 'admin-hubs',          labelKey: 'page.hubs',         icon: Cloud },
    { name: 'admin-zones',         labelKey: 'page.zones',        icon: Globe }
  ] },
  { id: 'users', labelKey: 'nav.users', items: [
    { name: 'admin-users',         labelKey: 'page.users',        icon: Users },
    { name: 'admin-oauth',         labelKey: 'page.oauth',        icon: ShieldCheck }
  ] },
  { id: 'billing', labelKey: 'nav.billing', items: [
    { name: 'admin-pricing',       labelKey: 'page.pricing',      icon: DollarSign },
    { name: 'admin-credit-codes',  labelKey: 'page.credit-codes', icon: Gift },
    { name: 'admin-revenue',       labelKey: 'page.revenue',      icon: Wallet },
    { name: 'admin-payment',       labelKey: 'page.payment',      icon: CreditCard }
  ] },
  { id: 'system', labelKey: 'nav.system', items: [
    { name: 'admin-features',      labelKey: 'page.features',     icon: Settings },
    { name: 'admin-email',         labelKey: 'page.email',        icon: Mail },
    { name: 'admin-smtp',          labelKey: 'page.smtp',         icon: Mail },
    { name: 'admin-announcements', labelKey: 'page.announcements',icon: Megaphone },
    { name: 'admin-docs',          labelKey: 'page.docs',         icon: Book },
    { name: 'admin-downloads',     labelKey: 'page.downloads',    icon: Download },
    { name: 'admin-audit',         labelKey: 'page.audit',        icon: FileText },
    { name: 'admin-errors',        labelKey: 'page.errors',       icon: AlertCircle },
    { name: 'admin-webhook',       labelKey: 'page.webhook',      icon: Webhook },
    { name: 'admin-api',           labelKey: 'page.api',          icon: KeyRound },
    { name: 'admin-apikey',        labelKey: 'page.apikey',       icon: ShieldCheck },
    { name: 'admin-settings',      labelKey: 'page.settings',     icon: Settings },
    { name: 'admin-profile',       labelKey: 'page.profile',      icon: User }
  ] }
]

// Bottom-nav: 4 primary tabs + More opens drawer with everything.
const bottomTabs = [
  { name: 'admin-dashboard',    labelKey: 'page.dashboard',     icon: LayoutDashboard },
  { name: 'admin-nodes',        labelKey: 'page.nodes',         icon: Server },
  { name: 'admin-users',        labelKey: 'page.users',         icon: Users },
  { name: 'admin-orders',       labelKey: 'page.orders',        icon: ShoppingCart }
]

const currentName = computed(() => route.name || 'admin-dashboard')
const pageTitle = computed(() => t(`page.${stripPrefix(currentName.value)}`) || t(`page.${currentName.value}`) || '')
function stripPrefix(n) {
  if (!n) return ''
  return String(n).replace(/^admin-/, '')
}

function to(name) { return { name } }
function go(name) { router.push(to(name)); closeDrawer() }
function switchLanguage(next) { setLocale(next) }
async function logout() { await apiLogout(); router.push({ name: 'login' }) }

watch(token, (value) => { if (!value) router.push({ name: 'login' }) })
onMounted(() => { loadBackendData() })
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo-mark"><Box :size="18" /></span>
        ProxyBox
      </div>
      <nav>
        <template v-for="g in navGroups" :key="g.id">
          <div class="nav-group-label">{{ t(g.labelKey) }}</div>
          <RouterLink v-for="item in g.items" :key="item.name" :to="to(item.name)" :class="{ active: currentName === item.name }">
            <component :is="item.icon" :size="17" />
            {{ t(item.labelKey) }}
          </RouterLink>
        </template>
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <span class="avatar">{{ (profile.name || 'U').slice(0, 1).toUpperCase() }}</span>
          <span class="meta"><strong>{{ profile.name }}</strong><span>{{ profile.email }}</span></span>
        </div>
        <button class="ghost-button" type="button" @click="logout"><LogOut :size="16" /> {{ t('app.logout') }}</button>
        <a class="px-version-chip" href="/faq#self-host-panel" :title="`ProxyBox v${appVersion}`">
          <span class="chip-dot"></span>
          <span class="chip-text">ProxyBox</span>
          <span class="chip-ver">v{{ appVersion }}</span>
        </a>
      </div>
    </aside>

    <div class="content">
      <header class="topbar">
        <button class="menu-btn" type="button" :aria-label="t('app.menu')" @click="openDrawer"><Menu :size="18" /></button>
        <div class="crumb">
          <span class="eyebrow">ProxyBox · {{ t('app.admin') }}</span>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="topbar-actions">
          <NotificationBell />
          <div class="theme-toggle">
            <button :class="{ active: theme === 'dark' }" type="button" :aria-label="t('app.themeDark')" @click="theme === 'light' && toggleTheme()"><Moon /></button>
            <button :class="{ active: theme === 'light' }" type="button" :aria-label="t('app.themeLight')" @click="theme === 'dark' && toggleTheme()"><Sun /></button>
          </div>
          <div class="lang-toggle">
            <button :class="{ active: locale === 'vi' }" type="button" @click="switchLanguage('vi')">VI</button>
            <button :class="{ active: locale === 'en' }" type="button" @click="switchLanguage('en')">EN</button>
          </div>
        </div>
      </header>
      <BroadcastBanner />
      <main class="page">
        <p v-if="proxyState.apiError" class="error-text">{{ proxyState.apiError }}</p>
        <RouterView />
      </main>

      <!-- Mobile bottom navigation: 4 primary tabs + More opens drawer -->
      <nav class="bottom-nav">
        <RouterLink v-for="b in bottomTabs" :key="b.name" :to="to(b.name)" :class="{ active: currentName === b.name }">
          <component :is="b.icon" />
          <span class="label">{{ t(b.labelKey) }}</span>
        </RouterLink>
        <button type="button" @click="openDrawer"><MoreHorizontal /><span class="label">{{ t('app.more') }}</span></button>
      </nav>
    </div>

    <!-- Mobile drawer: full sidebar accessible via menu button or More -->
    <div :class="['drawer-backdrop', { open: drawerOpen }]" @click="closeDrawer"></div>
    <aside :class="['drawer', { open: drawerOpen }]" :aria-hidden="!drawerOpen">
      <div class="brand">
        <span class="logo-mark"><Box :size="18" /></span>
        ProxyBox
      </div>
      <nav>
        <template v-for="g in navGroups" :key="g.id">
          <div class="nav-group-label">{{ t(g.labelKey) }}</div>
          <RouterLink v-for="item in g.items" :key="item.name" :to="to(item.name)" :class="{ active: currentName === item.name }" @click="closeDrawer">
            <component :is="item.icon" :size="17" />
            {{ t(item.labelKey) }}
            <ChevronRight :size="14" style="margin-left:auto; color:var(--dim)" />
          </RouterLink>
        </template>
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <span class="avatar">{{ (profile.name || 'U').slice(0, 1).toUpperCase() }}</span>
          <span class="meta"><strong>{{ profile.name }}</strong><span>{{ profile.email }}</span></span>
        </div>
        <button class="ghost-button" type="button" @click="logout"><LogOut :size="16" /> {{ t('app.logout') }}</button>
        <a class="px-version-chip" href="/faq#self-host-panel" :title="`ProxyBox v${appVersion}`">
          <span class="chip-dot"></span>
          <span class="chip-text">ProxyBox</span>
          <span class="chip-ver">v{{ appVersion }}</span>
        </a>
      </div>
    </aside>
  </div>
</template>
