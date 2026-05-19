<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Box, ArrowRight, Menu as MenuIcon, X as CloseIcon } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { theme, toggleTheme } from '../theme'

defineProps({
  // Small badge shown next to the brand mark (e.g. "Pricing", "Docs", "API").
  // Defaults to "Box Proxy" — the colloquial Vietnamese name.
  subLabel: { type: String, default: 'Box Proxy' },
  // Anchor links to show only on the landing page (e.g. #features, #self-host).
  // Each item: { href, key } — `key` looked up via i18n.
  anchorLinks: { type: Array, default: () => [] }
})

const { t, locale, setLocale } = useI18n()
const route = useRoute()

const menuOpen = ref(false)
function toggleMenu() { menuOpen.value = !menuOpen.value }
function closeMenu() { menuOpen.value = false }

// Close drawer when route changes (e.g. clicking a RouterLink).
watch(() => route.fullPath, closeMenu)

// Close on Escape for keyboard users.
function onKey(e) { if (e.key === 'Escape') closeMenu() }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <header class="ptn">
    <RouterLink to="/" class="ptn-brand">
      <span class="ptn-logo"><Box :size="20" /></span>
      <strong>ProxyBox</strong>
      <span class="ptn-sub">{{ subLabel }}</span>
    </RouterLink>

    <!-- Desktop nav links -->
    <nav class="ptn-links desktop">
      <a v-for="a in anchorLinks" :key="a.href" :href="a.href" @click="closeMenu">
        {{ t(a.key) }}
      </a>
      <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink>
      <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink>
      <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
      <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
      <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
    </nav>

    <div class="ptn-actions">
      <div class="ptn-lang">
        <button :class="{ active: locale === 'en' }" type="button" @click="setLocale('en')">EN</button>
        <button :class="{ active: locale === 'vi' }" type="button" @click="setLocale('vi')">VI</button>
      </div>
      <button class="ptn-theme" type="button" @click="toggleTheme" aria-label="Toggle theme">
        {{ theme === 'dark' ? '☾' : '☼' }}
      </button>
      <RouterLink class="ptn-btn ghost desktop-only" to="/login">{{ t('landing.nav.login') }}</RouterLink>
      <RouterLink class="ptn-btn primary desktop-only" to="/register">
        {{ t('landing.nav.register') }} <ArrowRight :size="14" />
      </RouterLink>
      <button class="ptn-burger mobile-only" type="button" @click="toggleMenu" :aria-expanded="menuOpen" aria-label="Menu">
        <component :is="menuOpen ? CloseIcon : MenuIcon" :size="20" />
      </button>
    </div>

    <!-- Mobile drawer -->
    <Transition name="ptn-fade">
      <div v-if="menuOpen" class="ptn-backdrop mobile-only" @click="closeMenu"></div>
    </Transition>
    <Transition name="ptn-slide">
      <nav v-if="menuOpen" class="ptn-drawer mobile-only">
        <a v-for="a in anchorLinks" :key="a.href" :href="a.href" @click="closeMenu">
          {{ t(a.key) }}
        </a>
        <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink>
        <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink>
        <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
        <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
        <div class="ptn-drawer-foot">
          <RouterLink class="ptn-btn ghost" to="/login">{{ t('landing.nav.login') }}</RouterLink>
          <RouterLink class="ptn-btn primary" to="/register">
            {{ t('landing.nav.register') }} <ArrowRight :size="14" />
          </RouterLink>
        </div>
      </nav>
    </Transition>
  </header>
</template>

<style scoped>
.ptn {
  display: flex; align-items: center; gap: 24px;
  padding: 14px 32px;
  border-bottom: 1px solid var(--border-soft);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 50;
}
.ptn * { box-sizing: border-box; }
.ptn a { color: inherit; text-decoration: none; }

.ptn-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 16px; flex-shrink: 0;
  color: var(--text) !important;
}
.ptn-logo {
  width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #58a6ff, #3fb950); color: #0a0e14;
}
.ptn-sub {
  font-size: 11px; color: var(--dim); padding: 2px 6px;
  border: 1px solid var(--border); border-radius: 4px;
  margin-left: 2px; font-weight: 500; letter-spacing: 0.4px;
}

.ptn-links {
  display: flex; gap: 22px; margin-left: 18px;
  flex: 1; min-width: 0;
}
.ptn-links a {
  color: var(--dim); font-size: 14px; white-space: nowrap;
  padding: 4px 0; transition: color 0.15s;
}
.ptn-links a:hover { color: var(--text); }
.ptn-links a.router-link-active { color: var(--text); }

.ptn-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
.ptn-lang, .ptn-theme {
  display: inline-flex; align-items: center;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  overflow: hidden;
}
.ptn-lang button {
  border: 0; background: transparent; color: var(--dim);
  padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.ptn-lang button.active { background: var(--surface); color: var(--text); }
.ptn-theme { padding: 6px 10px; color: var(--dim); cursor: pointer; line-height: 1; }
.ptn-theme:hover { color: var(--text); }

.ptn-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); cursor: pointer; white-space: nowrap;
}
.ptn-btn:hover { background: var(--surface); border-color: var(--blue); }
.ptn-btn.primary {
  background: linear-gradient(135deg, #58a6ff, #2f81f7);
  border-color: transparent; color: #0a0e14;
}
.ptn-btn.ghost { background: transparent; }

.ptn-burger {
  display: none;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px;
  color: var(--text); cursor: pointer; line-height: 0;
}
.ptn-burger:hover { border-color: var(--blue); color: var(--blue); }

.mobile-only { display: none; }
.desktop, .desktop-only { display: inline-flex; }

/* Drawer (mobile) */
.ptn-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 45;
}
.ptn-drawer {
  position: fixed;
  top: 60px; left: 0; right: 0; bottom: 0;
  background: var(--bg);
  border-top: 1px solid var(--border-soft);
  z-index: 46;
  padding: 18px 18px 24px;
  display: flex; flex-direction: column; gap: 4px;
  overflow-y: auto;
}
.ptn-drawer a {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 8px;
  font-size: 15px; color: var(--text); font-weight: 500;
}
.ptn-drawer a:hover { background: var(--surface-2); }
.ptn-drawer a.router-link-active {
  background: var(--blue-soft); color: var(--blue);
}
.ptn-drawer-foot {
  margin-top: 14px; padding-top: 14px;
  border-top: 1px solid var(--border-soft);
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.ptn-drawer-foot .ptn-btn { width: 100%; justify-content: center; padding: 12px; font-size: 14px; }

/* Drawer animations */
.ptn-fade-enter-active, .ptn-fade-leave-active { transition: opacity 180ms ease-out; }
.ptn-fade-enter-from, .ptn-fade-leave-to { opacity: 0; }
.ptn-slide-enter-active, .ptn-slide-leave-active { transition: transform 220ms ease-out, opacity 180ms ease-out; }
.ptn-slide-enter-from, .ptn-slide-leave-to { transform: translateY(-8px); opacity: 0; }

/* ── Tablet ── */
@media (max-width: 980px) {
  .ptn { padding: 12px 16px; gap: 12px; }
  .ptn-links.desktop { display: none; }
  .ptn-burger { display: inline-flex; }
  .mobile-only { display: inline-flex; }
  .desktop-only { display: none; }
}

/* ── Phone ── */
@media (max-width: 640px) {
  .ptn { padding: 10px 14px; gap: 8px; }
  .ptn-brand strong { font-size: 15px; }
  .ptn-sub { display: none; }
  .ptn-actions { gap: 6px; }
  .ptn-theme { display: none; }
  .ptn-lang button { padding: 5px 8px; font-size: 11px; }
  .ptn-drawer { top: 56px; padding: 14px 14px 20px; }
  .ptn-drawer a { font-size: 14.5px; padding: 11px 12px; }
}
</style>
