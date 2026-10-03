<script setup>
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Grid } from 'ant-design-vue'
import {
  ApiOutlined, AuditOutlined, BarChartOutlined, BookOutlined, BugOutlined, CloudOutlined,
  CloudServerOutlined, ClusterOutlined, ControlOutlined, CreditCardOutlined, DashboardOutlined, DiffOutlined,
  DollarOutlined, DownloadOutlined, GiftOutlined, GlobalOutlined, HeartOutlined, KeyOutlined, LineChartOutlined,
  LinkOutlined, LogoutOutlined, MailOutlined, NotificationOutlined, SafetyCertificateOutlined, SafetyOutlined,
  SendOutlined, SettingOutlined, TeamOutlined, UserOutlined, WalletOutlined
} from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import { token, logout as apiLogout } from '../api'
import { profile } from '../store/profile'
import { proxyState, loadBackendData } from '../store/proxies'
import BroadcastBanner from '../components/BroadcastBanner.vue'
import NotificationBell from '../components/NotificationBell.vue'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const screens = Grid.useBreakpoint()
const isMobile = computed(() => !screens.value.lg)

// Build-time version (see vite.config.js `define`). Shown in the sidebar
// footer so admin/operator always knows which build is running.
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const COLLAPSE_KEY = 'proxyhub.admin.sideCollapsed'
const collapsed = ref(readCollapsed())
function readCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
watch(collapsed, (v) => { try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* ignore */ } })

const drawerOpen = ref(false)
watch(() => route.fullPath, () => { drawerOpen.value = false })

function toggleNav() {
  if (isMobile.value) drawerOpen.value = !drawerOpen.value
  else collapsed.value = !collapsed.value
}

// Sidebar grouped by domain. Order matters — first group is "Overview".
const navGroups = [
  { id: 'overview', labelKey: 'nav.overview', items: [
    { name: 'admin-dashboard',     labelKey: 'page.dashboard',    icon: DashboardOutlined }
  ] },
  { id: 'infra', labelKey: 'nav.infra', items: [
    { name: 'admin-orders',        labelKey: 'page.proxiesOrders',icon: ClusterOutlined },
    { name: 'admin-connections',   labelKey: 'page.connections',  icon: LinkOutlined },
    { name: 'admin-bandwidth',     labelKey: 'page.bandwidth',    icon: BarChartOutlined },
    { name: 'admin-health',        labelKey: 'page.health',       icon: HeartOutlined },
    { name: 'admin-monitor',       labelKey: 'page.monitor',      icon: LineChartOutlined },
    { name: 'admin-nodes',         labelKey: 'page.nodes',        icon: CloudServerOutlined },
    { name: 'admin-nodes-compare', labelKey: 'page.nodesCompare', icon: DiffOutlined },
    { name: 'admin-hubs',          labelKey: 'page.hubs',         icon: CloudOutlined },
    { name: 'admin-zones',         labelKey: 'page.zones',        icon: GlobalOutlined }
  ] },
  { id: 'users', labelKey: 'nav.users', items: [
    { name: 'admin-users',         labelKey: 'page.users',        icon: TeamOutlined },
    { name: 'admin-oauth',         labelKey: 'page.oauth',        icon: SafetyCertificateOutlined }
  ] },
  { id: 'billing', labelKey: 'nav.billing', items: [
    { name: 'admin-pricing',       labelKey: 'page.pricing',      icon: DollarOutlined },
    { name: 'admin-credit-codes',  labelKey: 'page.credit-codes', icon: GiftOutlined },
    { name: 'admin-revenue',       labelKey: 'page.revenue',      icon: WalletOutlined },
    { name: 'admin-payment',       labelKey: 'page.payment',      icon: CreditCardOutlined }
  ] },
  { id: 'system', labelKey: 'nav.system', items: [
    { name: 'admin-features',      labelKey: 'page.features',     icon: ControlOutlined },
    { name: 'admin-email',         labelKey: 'page.email',        icon: MailOutlined },
    { name: 'admin-smtp',          labelKey: 'page.smtp',         icon: SendOutlined },
    { name: 'admin-announcements', labelKey: 'page.announcements',icon: NotificationOutlined },
    { name: 'admin-docs',          labelKey: 'page.docs',         icon: BookOutlined },
    { name: 'admin-downloads',     labelKey: 'page.downloads',    icon: DownloadOutlined },
    { name: 'admin-audit',         labelKey: 'page.audit',        icon: AuditOutlined },
    { name: 'admin-errors',        labelKey: 'page.errors',       icon: BugOutlined },
    { name: 'admin-webhook',       labelKey: 'page.webhook',      icon: ApiOutlined },
    { name: 'admin-api',           labelKey: 'page.api',          icon: KeyOutlined },
    { name: 'admin-apikey',        labelKey: 'page.apikey',       icon: SafetyOutlined },
    { name: 'admin-settings',      labelKey: 'page.settings',     icon: SettingOutlined },
    { name: 'admin-profile',       labelKey: 'page.profile',      icon: UserOutlined }
  ] }
]
const allItems = navGroups.flatMap((g) => g.items)

// Detail routes highlight their parent list entry in the menu.
const PARENT_OF = {
  'admin-node-detail': 'admin-nodes',
  'admin-connection-detail': 'admin-connections',
  'admin-user-detail': 'admin-users',
  'admin-order-detail': 'admin-orders'
}
const currentName = computed(() => route.name || 'admin-dashboard')
const selectedKeys = computed(() => [PARENT_OF[currentName.value] || currentName.value])

const menuItems = computed(() => navGroups.map((g) => ({
  type: 'group',
  key: g.id,
  label: t(g.labelKey),
  children: g.items.map((item) => ({ key: item.name, icon: () => h(item.icon), label: t(item.labelKey), title: t(item.labelKey) }))
})))
// Collapsed rail: groups render as dividers so icons stay aligned.
const railItems = computed(() => navGroups.flatMap((g, i) => [
  ...(i ? [{ type: 'divider', key: `d-${g.id}` }] : []),
  ...g.items.map((item) => ({ key: item.name, icon: () => h(item.icon), label: t(item.labelKey), title: t(item.labelKey) }))
]))

function onMenuClick({ key }) { router.push({ name: key }) }

// t() echoes the key back when a string is missing, so we treat key===translation as
// "absent" and fall through. Resolve the header title from the sidebar labelKey first
// (always defined, matches the nav), then the page.* key forms.
function tt(key) {
  if (!key) return ''
  const s = t(key)
  return s && s !== key ? s : ''
}
const pageTitle = computed(() => {
  const n = currentName.value
  const navItem = allItems.find((i) => i.name === n)
  return tt(navItem?.labelKey) || tt(`page.${String(n).replace(/^admin-/, '')}`) || tt(`page.${n}`) || ''
})
const groupLabel = computed(() => {
  const key = PARENT_OF[currentName.value] || currentName.value
  const g = navGroups.find((grp) => grp.items.some((i) => i.name === key))
  return g ? t(g.labelKey) : ''
})

const userMenu = computed(() => [
  { key: 'admin-profile', icon: () => h(UserOutlined), label: t('page.profile') },
  { key: 'admin-settings', icon: () => h(SettingOutlined), label: t('page.settings') },
  { type: 'divider' },
  { key: 'logout', icon: () => h(LogoutOutlined), label: t('app.logout'), danger: true }
])
function onUserMenu({ key }) {
  if (key === 'logout') logout()
  else router.push({ name: key })
}
const initial = computed(() => (profile.name || 'U').slice(0, 1).toUpperCase())

async function logout() { await apiLogout(); router.push({ name: 'login' }) }

watch(token, (value) => { if (!value) router.push({ name: 'login' }) })
onMounted(() => { loadBackendData() })
</script>

<template>
  <a-layout class="admin-shell" has-sider>
    <a-layout-sider
      v-if="!isMobile"
      v-model:collapsed="collapsed"
      class="admin-sider"
      :width="236"
      :collapsed-width="64"
      :trigger="null"
      collapsible
    >
      <div class="sider-inner">
        <RouterLink :to="{ name: 'admin-dashboard' }" class="sider-brand">
          <BrandLogo :collapsed="collapsed" :sub="t('app.admin')" />
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
          <a-tooltip :title="`ProxyBox v${appVersion}`" placement="right">
            <a href="/faq#self-host-panel">
              <a-tag color="green" :bordered="false" class="mono">{{ collapsed ? `v${appVersion.split('.').slice(0, 2).join('.')}` : `ProxyBox v${appVersion}` }}</a-tag>
            </a>
          </a-tooltip>
        </div>
      </div>
    </a-layout-sider>

    <a-layout class="admin-main">
      <a-layout-header class="admin-header">
        <a-button type="text" :aria-label="t('app.menu')" @click="toggleNav">
          <template #icon>
            <MenuUnfoldOutlined v-if="isMobile || collapsed" />
            <MenuFoldOutlined v-else />
          </template>
        </a-button>
        <div class="header-title">
          <a-breadcrumb v-if="!isMobile" class="header-crumb">
            <a-breadcrumb-item>{{ t('app.admin') }}</a-breadcrumb-item>
            <a-breadcrumb-item v-if="groupLabel">{{ groupLabel }}</a-breadcrumb-item>
          </a-breadcrumb>
          <a-typography-title :level="5" class="header-h1">{{ pageTitle }}</a-typography-title>
        </div>
        <a-space :size="8" class="header-actions">
          <NotificationBell />
          <ThemeLangSwitch :show-lang="!screens.xs" />
          <a-dropdown :trigger="['click']" placement="bottomRight">
            <a-button type="text" class="user-btn">
              <a-avatar size="small" class="user-avatar">{{ initial }}</a-avatar>
              <span v-if="screens.md" class="user-name">{{ profile.name }}</span>
              <DownOutlined v-if="screens.md" />
            </a-button>
            <template #overlay>
              <a-menu :items="userMenu" @click="onUserMenu" />
            </template>
          </a-dropdown>
        </a-space>
      </a-layout-header>

      <BroadcastBanner />

      <a-layout-content class="admin-content">
        <a-alert v-if="proxyState.apiError" type="error" show-icon :message="proxyState.apiError" style="margin-bottom: 16px" />
        <RouterView />
      </a-layout-content>

      <a-layout-footer class="admin-footer">
        <a-typography-text type="secondary">ProxyBox v{{ appVersion }} · {{ profile.email }}</a-typography-text>
      </a-layout-footer>
    </a-layout>

    <a-drawer
      v-model:open="drawerOpen"
      placement="left"
      :width="280"
      :closable="false"
      :body-style="{ padding: 0 }"
      root-class-name="admin-drawer"
    >
      <template #title>
        <BrandLogo :sub="t('app.admin')" />
      </template>
      <a-menu mode="inline" :items="menuItems" :selected-keys="selectedKeys" @click="onMenuClick" />
      <div class="drawer-foot">
        <a-button block danger @click="logout">
          <template #icon><LogoutOutlined /></template>
          {{ t('app.logout') }}
        </a-button>
      </div>
    </a-drawer>
  </a-layout>
</template>

<style scoped>
.admin-shell { min-height: 100vh; }
.admin-sider {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  border-inline-end: 1px solid var(--pb-border-soft);
}
.sider-inner { display: flex; flex-direction: column; height: 100%; }
.sider-brand { display: flex; align-items: center; height: 64px; padding: 0 18px; flex-shrink: 0; }
.admin-sider.ant-layout-sider-collapsed .sider-brand { padding: 0; justify-content: center; }
.sider-menu { flex: 1; overflow-y: auto; overflow-x: hidden; }
.sider-menu :deep(.ant-menu) { border-inline-end: none !important; }
.sider-menu :deep(.ant-menu-item-group-title) { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.sider-foot { padding: 12px; text-align: center; border-top: 1px solid var(--pb-border-soft); flex-shrink: 0; }
.sider-foot :deep(.ant-tag) { margin: 0; }

.admin-main { min-width: 0; }
.admin-header {
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
.header-title { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1; }
.header-crumb { font-size: 12px; line-height: 1.2; }
.header-h1 { margin: 0 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header-actions { flex-shrink: 0; }
.user-btn { display: inline-flex; align-items: center; gap: 8px; padding-inline: 6px; }
.user-avatar { background: var(--pb-primary); }
.user-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

.admin-content { padding: 20px; min-width: 0; }
.admin-footer { text-align: center; padding: 14px 20px; }


@media (max-width: 575px) {
  .admin-content { padding: 12px; }
  .admin-header { padding: 0 8px; gap: 6px; }
}
</style>

<style>
/* Unscoped: the drawer is teleported to <body>. */
.admin-drawer .ant-menu { border-inline-end: none !important; }
.admin-drawer .ant-menu-item-group-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.admin-drawer .drawer-foot { padding: 16px; }
</style>
