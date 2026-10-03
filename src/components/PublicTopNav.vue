<script setup>
// Shared header for the public marketing pages (landing, pricing, FAQ,
// changelog, API docs, AUP). Desktop: horizontal menu; below `lg` the links
// move into a right-hand drawer.
import { computed, h, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Grid } from 'ant-design-vue'
import { useI18n } from '../i18n'
import BrandLogo from './ui/BrandLogo.vue'
import ThemeLangSwitch from './ui/ThemeLangSwitch.vue'

const props = defineProps({
  // Small badge shown next to the brand mark (e.g. "Pricing", "Docs", "API").
  // Defaults to "Box Proxy" — the colloquial Vietnamese name.
  subLabel: { type: String, default: 'Box Proxy' },
  // Anchor links to show only on the landing page (e.g. #features, #self-host).
  // Each item: { href, key } — `key` looked up via i18n.
  anchorLinks: { type: Array, default: () => [] }
})

const { t } = useI18n()
const route = useRoute()
const screens = Grid.useBreakpoint()
const isDesktop = computed(() => !!screens.value.lg)

const menuOpen = ref(false)
function closeMenu() { menuOpen.value = false }
// Close drawer when route (path or #hash) changes, e.g. after clicking a link.
watch(() => route.fullPath, closeMenu)

const PAGES = [
  { to: '/pricing', key: 'landing.nav.pricing' },
  { to: '/api-docs', key: 'landing.nav.api' },
  { to: '/faq', key: 'landing.nav.faq' },
  { to: '/changelog', key: 'landing.nav.changelog' }
]

// Menu labels are real links (crawlable hrefs); antd stretches `a` over the item.
const menuItems = computed(() => [
  ...props.anchorLinks.map((a) => ({
    key: a.href,
    label: h(RouterLink, { to: { hash: a.href } }, () => t(a.key))
  })),
  ...PAGES.map((p) => ({
    key: p.to,
    label: h(RouterLink, { to: p.to }, () => t(p.key))
  }))
])
const selectedKeys = computed(() => [route.path])
</script>

<template>
  <a-layout class="ptn">
    <a-layout-header class="ptn-bar">
      <RouterLink to="/" class="ptn-brand" aria-label="ProxyBox">
        <BrandLogo :size="30">
          <template v-if="screens.sm" #tag>
            <a-tag :bordered="false" class="ptn-sub">{{ subLabel }}</a-tag>
          </template>
        </BrandLogo>
      </RouterLink>

      <a-menu
        v-if="isDesktop"
        class="ptn-menu"
        mode="horizontal"
        :items="menuItems"
        :selected-keys="selectedKeys"
      />
      <div v-else class="ptn-spacer"></div>

      <a-space :size="8" class="ptn-actions">
        <ThemeLangSwitch />
        <template v-if="isDesktop">
          <RouterLink v-slot="{ href, navigate }" to="/login" custom>
            <a-button :href="href" @click="navigate">{{ t('landing.nav.login') }}</a-button>
          </RouterLink>
          <RouterLink v-slot="{ href, navigate }" to="/register" custom>
            <a-button type="primary" :href="href" @click="navigate">
              {{ t('landing.nav.register') }} <ArrowRightOutlined />
            </a-button>
          </RouterLink>
        </template>
        <a-button v-else :aria-expanded="menuOpen" aria-label="Menu" @click="menuOpen = !menuOpen">
          <template #icon><MenuOutlined /></template>
        </a-button>
      </a-space>
    </a-layout-header>

    <a-drawer
      v-model:open="menuOpen"
      placement="right"
      :width="300"
      :body-style="{ padding: '8px 0', display: 'flex', flexDirection: 'column' }"
      root-class-name="ptn-drawer"
    >
      <template #title>
        <BrandLogo :size="26" :sub="subLabel" />
      </template>
      <a-menu mode="inline" :items="menuItems" :selected-keys="selectedKeys" @click="closeMenu" />
      <a-flex vertical gap="small" class="ptn-drawer-foot">
        <RouterLink v-slot="{ href, navigate }" to="/login" custom>
          <a-button block size="large" :href="href" @click="navigate">{{ t('landing.nav.login') }}</a-button>
        </RouterLink>
        <RouterLink v-slot="{ href, navigate }" to="/register" custom>
          <a-button block size="large" type="primary" :href="href" @click="navigate">
            {{ t('landing.nav.register') }} <ArrowRightOutlined />
          </a-button>
        </RouterLink>
      </a-flex>
    </a-drawer>
  </a-layout>
</template>

<style scoped>
/* Own a-layout wrapper so the header gets antd's Layout styles on any page,
   and so the whole bar can stick to the top. */
.ptn {
  position: sticky;
  top: 0;
  z-index: 100;
  flex: none;
  min-height: 0;
}
.ptn-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding-inline: 32px;
  border-bottom: 1px solid var(--pb-border-soft);
  line-height: normal;
}
.ptn-brand { display: inline-flex; align-items: center; flex-shrink: 0; color: inherit; }
.ptn-sub { margin-inline: 8px 0; font-size: 11px; font-weight: 500; vertical-align: 2px; }
.ptn-menu { flex: 1; min-width: 0; line-height: 62px; }
.ptn-menu.ant-menu-horizontal { border-bottom: none; }
.ptn-spacer { flex: 1; }
.ptn-actions { flex-shrink: 0; }

@media (max-width: 991px) {
  .ptn-bar { padding-inline: 16px; gap: 12px; }
}
@media (max-width: 575px) {
  .ptn-bar { padding-inline: 12px; gap: 8px; }
}
</style>

<style>
/* Unscoped: the drawer is teleported to <body>. */
.ptn-drawer .ant-menu { border-inline-end: none !important; }
.ptn-drawer .ptn-drawer-foot { margin-top: auto; padding: 16px; border-top: 1px solid var(--pb-border-soft); }
</style>
