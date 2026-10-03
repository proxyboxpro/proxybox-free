<script setup>
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Grid } from 'ant-design-vue'
import {
  ApiOutlined, BookOutlined, CloudServerOutlined, DeploymentUnitOutlined, GiftOutlined, GlobalOutlined,
  KeyOutlined, LineChartOutlined, LinkOutlined, LogoutOutlined, QuestionCircleOutlined, SafetyOutlined,
  ShoppingCartOutlined, ToolOutlined, UserOutlined, WalletOutlined
} from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import { apiFetch, token, logout as apiLogout } from '../api'
import CountryFlag from '../components/CountryFlag.vue'
import BroadcastBanner from '../components/BroadcastBanner.vue'
import NotificationBell from '../components/NotificationBell.vue'
import OnboardingTour from '../components/OnboardingTour.vue'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const screens = Grid.useBreakpoint()
const isMobile = computed(() => !screens.value.lg)
const account = ref(null)
const zones = ref([])

// App version injected at build time by Vite (vite.config.js → define block).
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : (import.meta.env?.VITE_APP_VERSION || '0.0.0'))

// Desktop-only collapsed state, persisted across reloads.
const SIDE_COLLAPSE_KEY = 'proxyhub.customer.sideCollapsed'
const collapsed = ref(readCollapsed())
function readCollapsed() { try { return localStorage.getItem(SIDE_COLLAPSE_KEY) === '1' } catch { return false } }
watch(collapsed, (v) => { try { localStorage.setItem(SIDE_COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ } })

const drawerOpen = ref(false)
watch(() => route.fullPath, () => { drawerOpen.value = false })
function toggleNav() {
  if (isMobile.value) drawerOpen.value = !drawerOpen.value
  else collapsed.value = !collapsed.value
}

// Sidebar sections. Keys are unique menu keys; `to` is the router location.
const sectionProxy = [
  { key: 'buy',          to: { name: 'buy' },                              labelKey: 'cust.side.itemBuy',         icon: ShoppingCartOutlined, badge: 'HOT' },
  { key: 'proxies:ipv4', to: { name: 'proxies', query: { type: 'ipv4' } }, labelKey: 'cust.cat.myIpv4',           icon: CloudServerOutlined },
  { key: 'proxies:ipv6', to: { name: 'proxies', query: { type: 'ipv6' } }, labelKey: 'cust.cat.myIpv6',           icon: GlobalOutlined },
  { key: 'my-nodes',     to: { name: 'my-nodes' },                         labelKey: 'cust.side.itemMyNodes',     icon: DeploymentUnitOutlined, badge: 'FREE' },
  { key: 'connections',  to: { name: 'connections' },                      labelKey: 'cust.side.itemConnections', icon: LinkOutlined }
]
const sectionAccount = [
  { key: 'billing',   to: { name: 'billing' },   labelKey: 'cust.side.itemTopup',     icon: WalletOutlined },
  { key: 'usage',     to: { name: 'usage' },     labelKey: 'cust.side.itemBandwidth', icon: LineChartOutlined },
  { key: 'affiliate', to: { name: 'affiliate' }, labelKey: 'cust.side.itemAffiliate', icon: GiftOutlined, badge: 'NEW' },
  { key: 'account',   to: { name: 'account' },   labelKey: 'cust.side.itemAccount',   icon: UserOutlined },
  { key: 'faq',       to: { name: 'faq' },       labelKey: 'cust.side.itemSupport',   icon: QuestionCircleOutlined },
  { key: 'tools',     to: { name: 'tools' },     labelKey: 'cust.side.itemToolsHub',  icon: ToolOutlined }
]
const BADGE_COLOR = { HOT: 'red', NEW: 'blue', FREE: 'green' }

// Locations: show ALL admin-configured zones. Zones with 0 online nodes get a
// "Coming soon" badge and are disabled.
const locations = computed(() => {
  const out = [{ code: 'GLOBAL', name: t('cust.loc.all'), flag: null, comingSoon: false }]
  for (const z of zones.value) {
    out.push({ code: z.id, name: z.name, flag: z.flag, comingSoon: (z.onlineNodes ?? 0) === 0 })
  }
  return out
})
function flagFor(loc) {
  if (loc.flag) return loc.flag
  // Backend may store zone.flag as a 2-letter country code (e.g. "VN"); fall back to slug prefix.
  return String(loc.code).slice(0, 2).toUpperCase()
}

function navLabel(item) {
  const text = t(item.labelKey)
  if (!item.badge) return text
  return h('span', { class: 'menu-label' }, [
    h('span', { class: 'menu-label-text' }, text),
    h('span', { class: `menu-badge badge-${item.badge.toLowerCase()}`, 'data-color': BADGE_COLOR[item.badge] }, item.badge)
  ])
}
function toMenuItem(item) {
  return { key: item.key, icon: () => h(item.icon), label: navLabel(item), title: t(item.labelKey) }
}
const menuItems = computed(() => {
  const items = [
    { type: 'group', key: 'g-proxy', label: t('cust.side.sectionProxy'), children: sectionProxy.map(toMenuItem) },
    { type: 'group', key: 'g-account', label: t('cust.side.sectionAccount'), children: sectionAccount.map(toMenuItem) }
  ]
  if (locations.value.length > 1) {
    items.push({
      type: 'group',
      key: 'g-loc',
      label: t('cust.side.locations'),
      children: locations.value.map((loc) => ({
        key: `loc:${loc.code}`,
        disabled: loc.comingSoon,
        title: loc.name,
        icon: () => (loc.code === 'GLOBAL' ? h(GlobalOutlined) : h('span', { class: 'flag-icon' }, [h(CountryFlag, { code: flagFor(loc), size: 18 })])),
        label: loc.comingSoon
          ? h('span', { class: 'menu-label' }, [h('span', { class: 'menu-label-text' }, loc.name), h('span', { class: 'menu-badge badge-soon' }, t('cust.side.comingSoon'))])
          : loc.name
      }))
    })
  }
  return items
})
// Collapsed rail: flatten groups (group titles are hidden anyway).
const railItems = computed(() => menuItems.value.flatMap((g, i) => [
  ...(i ? [{ type: 'divider', key: `d-${g.key}` }] : []),
  ...g.children
]))

const ITEM_BY_KEY = Object.fromEntries([...sectionProxy, ...sectionAccount].map((i) => [i.key, i]))
function onMenuClick({ key }) {
  if (String(key).startsWith('loc:')) {
    const code = key.slice(4)
    router.push({ name: 'buy', query: code === 'GLOBAL' ? {} : { country: code } })
    return
  }
  const item = ITEM_BY_KEY[key]
  if (item) router.push(item.to)
}

const selectedKeys = computed(() => {
  const name = String(route.name || '')
  const keys = []
  if (name === 'proxies' || name === 'proxy-order') {
    if (route.query.type) keys.push(`proxies:${route.query.type}`)
  } else if (name === 'my-node-detail') keys.push('my-nodes')
  else if (name.startsWith('tools')) keys.push('tools')
  else if (ITEM_BY_KEY[name]) keys.push(name)
  if (name === 'buy') keys.push(`loc:${route.query?.country || 'GLOBAL'}`)
  return keys
})

// Top bar page title — resolves the current route to a friendly label.
const TITLE_KEYS = {
  dashboard: 'cust.nav.home',
  buy: 'cust.nav.buy',
  proxies: 'cust.nav.proxies',
  'proxy-order': 'cust.nav.proxies',
  billing: 'cust.nav.topup',
  usage: 'cust.nav.bandwidth',
  affiliate: 'cust.side.itemAffiliate',
  account: 'cust.nav.account',
  'my-nodes': 'cust.side.itemMyNodes',
  'my-node-detail': 'cust.side.itemMyNodes',
  connections: 'cust.side.itemConnections',
  'api-docs': 'cust.user.apiDocs',
  tools: 'cust.tools.hub.title',
  'tools-ping': 'cust.tools.ping.title',
  'tools-bulk-check': 'cust.tools.bulk.title',
  'tools-ip-info': 'cust.tools.ipInfo.title',
  'tools-blacklist': 'cust.tools.blacklist.title',
  'tools-speed-test': 'cust.tools.speed.title'
}
const pageTitle = computed(() => {
  const key = TITLE_KEYS[route.name]
  return key ? t(key) : ''
})

// User dropdown (avatar chip in the sidebar footer / header on mobile).
const userMenu = computed(() => [
  { key: 'profile',  icon: () => h(UserOutlined),           label: t('cust.user.profile') },
  { key: 'security', icon: () => h(SafetyOutlined),         label: t('cust.user.security') },
  { key: 'apikey',   icon: () => h(KeyOutlined),            label: t('cust.user.apikey') },
  { key: 'api-docs', icon: () => h(ApiOutlined),            label: t('cust.user.apiDocs') },
  { key: 'faq',      icon: () => h(BookOutlined),           label: t('cust.user.faq') },
  { type: 'divider' },
  { key: 'logout',   icon: () => h(LogoutOutlined),         label: t('app.logout'), danger: true }
])
function onUserMenu({ key }) {
  if (key === 'logout') return logout()
  if (key === 'profile') return router.push({ name: 'account' })
  if (key === 'security') return router.push({ name: 'account', hash: '#security' })
  if (key === 'apikey') return router.push({ name: 'account', hash: '#api' })
  router.push({ name: key })
}

async function logout() { await apiLogout(); router.push({ name: 'login' }) }

const balanceVnd = computed(() => Number(account.value?.balance || 0))
const displayName = computed(() => account.value?.name || account.value?.email || 'user')
const userInitial = computed(() => displayName.value.slice(0, 1).toUpperCase())

watch(token, (value) => { if (!value) router.push({ name: 'login' }) })
onMounted(async () => {
  try { account.value = await apiFetch('/api/v1/user/account') } catch { /* not customer or no api */ }
  try { zones.value = await apiFetch('/api/v1/user/zones') } catch { zones.value = [] }
})
</script>

<template>
  <a-layout class="cust-shell" has-sider data-portal="customer">
    <a-layout-sider
      v-if="!isMobile"
      v-model:collapsed="collapsed"
      class="cust-sider"
      :width="248"
      :collapsed-width="64"
      :trigger="null"
      collapsible
    >
      <div class="sider-inner">
        <RouterLink :to="{ name: 'dashboard' }" class="sider-brand" :title="t('cust.nav.home')">
          <BrandLogo :collapsed="collapsed" :sub="t('cust.side.premium')">
            <template #tag><a-tag color="green" :bordered="false" class="pro-tag">Pro</a-tag></template>
          </BrandLogo>
        </RouterLink>

        <div class="sider-menu">
          <a-menu
            mode="inline"
            :inline-collapsed="collapsed"
            :items="collapsed ? railItems : menuItems"
            :selected-keys="selectedKeys"
            @click="onMenuClick"
          />
        </div>

        <div class="sider-foot">
          <a-tooltip :title="collapsed ? `${t('cust.side.balance')}: ${balanceVnd.toLocaleString()}đ` : t('cust.side.clickTopup')" placement="right">
            <a-card size="small" hoverable class="balance-card" @click="router.push({ name: 'billing' })">
              <a-flex align="center" gap="small" :justify="collapsed ? 'center' : 'start'">
                <a-avatar shape="square" class="balance-ico"><template #icon><WalletOutlined /></template></a-avatar>
                <div v-if="!collapsed" class="balance-info">
                  <a-typography-text type="secondary" class="balance-lbl">{{ t('cust.side.balance') }}</a-typography-text>
                  <strong class="balance-val">{{ balanceVnd.toLocaleString() }}<small>đ</small></strong>
                </div>
              </a-flex>
            </a-card>
          </a-tooltip>

          <a-dropdown :trigger="['click']" placement="topLeft">
            <a-button type="text" block class="user-chip">
              <a-badge dot status="success" :offset="[-2, 22]">
                <a-avatar size="small" class="user-avatar">{{ userInitial }}</a-avatar>
              </a-badge>
              <span v-if="!collapsed" class="user-name">{{ displayName }}</span>
              <UpOutlined v-if="!collapsed" class="user-caret" />
            </a-button>
            <template #overlay>
              <a-menu :items="userMenu" @click="onUserMenu" />
            </template>
          </a-dropdown>

          <a-tooltip :title="`ProxyBox Free v${appVersion}`" placement="right">
            <a href="/faq#self-host-panel" class="version-link">
              <a-tag color="green" :bordered="false" class="mono">{{ collapsed ? `v${appVersion.split('.').slice(0, 2).join('.')}` : `ProxyBox Free v${appVersion}` }}</a-tag>
            </a>
          </a-tooltip>
        </div>
      </div>
    </a-layout-sider>

    <a-layout class="cust-main">
      <a-layout-header class="cust-header">
        <a-button type="text" :aria-label="t('app.menu')" @click="toggleNav">
          <template #icon>
            <MenuUnfoldOutlined v-if="isMobile || collapsed" />
            <MenuFoldOutlined v-else />
          </template>
        </a-button>
        <a-typography-title v-if="pageTitle" :level="5" class="header-h1">{{ pageTitle }}</a-typography-title>
        <div class="spacer"></div>
        <a-space :size="8">
          <a-button v-if="isMobile" type="text" class="mobile-balance" @click="router.push({ name: 'billing' })">
            <WalletOutlined /> <span class="mono">{{ balanceVnd.toLocaleString() }}đ</span>
          </a-button>
          <NotificationBell />
          <ThemeLangSwitch :show-lang="!screens.xs" />
        </a-space>
      </a-layout-header>

      <BroadcastBanner />

      <a-layout-content class="cust-content">
        <RouterView />
      </a-layout-content>
    </a-layout>

    <a-drawer
      v-model:open="drawerOpen"
      placement="left"
      :width="290"
      :closable="false"
      :body-style="{ padding: 0, display: 'flex', flexDirection: 'column' }"
      root-class-name="cust-drawer"
    >
      <template #title>
        <BrandLogo :sub="t('cust.side.premium')" />
      </template>
      <a-card size="small" hoverable class="balance-card drawer-balance" @click="router.push({ name: 'billing' })">
        <a-flex align="center" gap="small">
          <a-avatar shape="square" class="balance-ico"><template #icon><WalletOutlined /></template></a-avatar>
          <div class="balance-info">
            <a-typography-text type="secondary" class="balance-lbl">{{ t('cust.side.balance') }}</a-typography-text>
            <strong class="balance-val">{{ balanceVnd.toLocaleString() }}<small>đ</small></strong>
          </div>
        </a-flex>
      </a-card>
      <a-menu mode="inline" :items="menuItems" :selected-keys="selectedKeys" @click="onMenuClick" />
      <a-divider style="margin: 8px 0" />
      <a-menu mode="inline" :items="userMenu" :selectable="false" @click="onUserMenu" />
    </a-drawer>

    <a-float-button
      v-if="isMobile && route.name !== 'buy'"
      type="primary"
      :tooltip="t('cust.nav.buy')"
      :style="{ right: '20px', bottom: '24px' }"
      @click="router.push({ name: 'buy' })"
    >
      <template #icon><ShoppingCartOutlined /></template>
    </a-float-button>

    <OnboardingTour />
  </a-layout>
</template>

<style scoped>
.cust-shell { min-height: 100vh; }
.cust-sider {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  border-inline-end: 1px solid var(--pb-border-soft);
}
.sider-inner { display: flex; flex-direction: column; height: 100%; }
.sider-brand { display: flex; align-items: center; height: 64px; padding: 0 18px; flex-shrink: 0; }
.cust-sider.ant-layout-sider-collapsed .sider-brand { padding: 0; justify-content: center; }
.pro-tag { margin-inline-start: 6px; font-size: 10px; line-height: 16px; padding: 0 5px; vertical-align: 2px; }
.sider-menu { flex: 1; overflow-y: auto; overflow-x: hidden; }
.sider-menu :deep(.ant-menu) { border-inline-end: none !important; }
.sider-menu :deep(.ant-menu-item-group-title) { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }

.sider-foot { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--pb-border-soft); flex-shrink: 0; }
.balance-card { cursor: pointer; }
.balance-card :deep(.ant-card-body) { padding: 8px 10px; }
.balance-ico { background: var(--pb-primary-soft); color: var(--pb-primary); flex-shrink: 0; }
.balance-info { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.balance-lbl { font-size: 11px; }
.balance-val { font-size: 16px; font-weight: 700; color: var(--pb-primary); font-family: var(--pb-mono); }
.balance-val small { font-size: 11px; margin-inline-start: 2px; }

.user-chip { display: flex; align-items: center; gap: 10px; height: 40px; padding-inline: 8px; }
.cust-sider.ant-layout-sider-collapsed .user-chip { justify-content: center; }
.user-avatar { background: var(--pb-primary); }
.user-name { flex: 1; min-width: 0; text-align: start; overflow: hidden; text-overflow: ellipsis; }
.user-caret { font-size: 10px; opacity: 0.6; }
.version-link { text-align: center; }
.version-link :deep(.ant-tag) { margin: 0; }

.cust-main { min-width: 0; }
.cust-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--pb-border-soft);
  line-height: normal;
}
.header-h1 { margin: 0 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.spacer { flex: 1; }
.mobile-balance { color: var(--pb-primary); font-weight: 600; }
.cust-content { padding: 20px; min-width: 0; }

@media (max-width: 575px) {
  .cust-content { padding: 12px 12px 88px; }
  .cust-header { padding: 0 8px; gap: 6px; }
}
</style>

<style>
/* Unscoped: menu labels are rendered via h() and the drawer is teleported. */
.cust-drawer .ant-menu { border-inline-end: none !important; }
.cust-drawer .ant-menu-item-group-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.cust-drawer .drawer-balance { margin: 12px; cursor: pointer; }
.cust-drawer .drawer-balance .ant-card-body { padding: 8px 10px; }
[data-portal="customer"] .menu-label,
.cust-drawer .menu-label { display: inline-flex; align-items: center; gap: 8px; width: 100%; }
.menu-label-text { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.menu-badge {
  font-size: 9.5px;
  font-weight: 700;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}
.menu-badge.badge-hot  { color: #ef4444; background: rgba(239, 68, 68, 0.14); }
.menu-badge.badge-new  { color: #3b82f6; background: rgba(59, 130, 246, 0.14); }
.menu-badge.badge-free { color: #16a34a; background: rgba(22, 163, 74, 0.14); }
.menu-badge.badge-soon { color: var(--pb-text-3); background: var(--pb-surface-2); font-weight: 500; }
.flag-icon { display: inline-flex; width: 18px; justify-content: center; }
</style>
