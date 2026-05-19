<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Box, ChevronRight, Copy, Check, ArrowRight, Search, Menu as MenuIcon, X as CloseIcon, Globe } from 'lucide-vue-next'
import { apiFetch } from '../api'
import { useI18n } from '../i18n'
import PublicTopNav from '../components/PublicTopNav.vue'

const route = useRoute()
const { t, locale, setLocale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const docs = ref([])
const loading = ref(true)
const search = ref('')
const activeId = ref('')
const copiedSlug = ref('')
const drawerOpen = ref(false)

function slugFromHash() {
  return (location.hash || '').replace(/^#/, '')
}
function applyHash(initial = false) {
  const slug = slugFromHash()
  if (!slug || !docs.value.length) return
  const found = docs.value.find((d) => d.slug === slug || d.id === slug)
  if (found) {
    activeId.value = found.id
    if (initial) requestAnimationFrame(() => {
      document.querySelector('.faq-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

async function refresh() {
  loading.value = true
  try { docs.value = await apiFetch(`/api/public/docs?lang=${locale.value}`) }
  catch { docs.value = [] }
  finally { loading.value = false }
  applyHash(true)
  if (!activeId.value && docs.value.length) activeId.value = docs.value[0].id
}

// Re-fetch docs when locale changes (server returns localized title/body/category).
watch(locale, () => { refresh() })

watch(activeId, (id) => {
  const d = docs.value.find((x) => x.id === id)
  if (!d) return
  const nextHash = `#${d.slug || d.id}`
  if (location.hash !== nextHash) history.replaceState(null, '', location.pathname + location.search + nextHash)
  drawerOpen.value = false
})

function onHashChange() { applyHash(false) }

async function copyLink(d) {
  const url = `${location.origin}/faq#${d.slug || d.id}`
  try {
    await navigator.clipboard?.writeText(url)
    copiedSlug.value = d.id
    setTimeout(() => { if (copiedSlug.value === d.id) copiedSlug.value = '' }, 1500)
  } catch { /* ignore */ }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return docs.value
  return docs.value.filter((d) =>
    (d.title || '').toLowerCase().includes(q) ||
    (d.body || '').toLowerCase().includes(q) ||
    (d.category || '').toLowerCase().includes(q)
  )
})

const grouped = computed(() => {
  const map = new Map()
  for (const d of filtered.value) {
    const cat = d.category || (locale.value === 'vi' ? 'Khác' : 'Other')
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(d)
  }
  return [...map.entries()].map(([cat, items]) => ({
    category: cat,
    items: items.sort((a, b) => (a.order || 0) - (b.order || 0))
  }))
})

const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) || filtered.value[0])

// Minimal markdown.
function renderBody(text) {
  if (!text) return ''
  let out = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  out = out.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/^#### (.+)$/gm, '<h5>$1</h5>')
  out = out.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  out = out.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  out = out.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  out = out.split(/\n{2,}/).map((p) => p.startsWith('<h') || p.startsWith('<pre') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n')
  return out
}

onMounted(() => {
  refresh()
  window.addEventListener('hashchange', onHashChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<template>
  <div class="faq-page">
    <PublicTopNav sub-label="Docs" />

    <!-- Mobile drawer toggle -->
    <button class="drawer-toggle mobile-only" type="button" @click="drawerOpen = !drawerOpen">
      <component :is="drawerOpen ? CloseIcon : MenuIcon" :size="16" />
      {{ locale === 'vi' ? 'Mục lục' : 'Contents' }}
    </button>

    <!-- Drawer backdrop (mobile only) -->
    <div v-if="drawerOpen" class="faq-backdrop mobile-only" @click="drawerOpen = false"></div>

    <main class="faq-shell">
      <!-- Sidebar (Gitbook-style) -->
      <aside :class="['faq-sidebar', { open: drawerOpen }]">
        <div class="faq-sidebar-inner">
          <div class="faq-search">
            <Search :size="14" />
            <input v-model="search" type="search" :placeholder="locale === 'vi' ? 'Tìm trong docs...' : 'Search docs...'" />
          </div>
          <div v-if="loading" class="empty-text">{{ t('common.loading') }}</div>
          <div v-else-if="!grouped.length" class="empty-text">{{ locale === 'vi' ? 'Chưa có docs.' : 'No docs yet.' }}</div>
          <div v-for="g in grouped" :key="g.category" class="faq-group">
            <h4>{{ g.category }}</h4>
            <div v-for="d in g.items" :key="d.id" class="faq-nav-row" :class="{ active: activeId === d.id }">
              <button type="button" class="faq-nav-pick" @click="activeId = d.id">
                <ChevronRight :size="12" /> <span>{{ d.title }}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <!-- Content -->
      <article v-if="activeDoc" class="faq-content">
        <div class="content-head">
          <span class="cat-pill">{{ activeDoc.category }}</span>
          <h1>{{ activeDoc.title }}</h1>
          <div class="content-meta">
            <button class="meta-copy" type="button" @click="copyLink(activeDoc)">
              <component :is="copiedSlug === activeDoc.id ? Check : Copy" :size="13" />
              {{ copiedSlug === activeDoc.id ? (locale === 'vi' ? 'Đã copy' : 'Copied') : (locale === 'vi' ? 'Copy link' : 'Copy link') }}
            </button>
            <span v-if="activeDoc.updatedAt" class="meta-updated">
              {{ locale === 'vi' ? 'Cập nhật' : 'Updated' }}: {{ String(activeDoc.updatedAt).slice(0, 10) }}
            </span>
          </div>
        </div>

        <div class="doc-body" v-html="renderBody(activeDoc.body)"></div>

      </article>
    </main>

    <!-- Footer (full landing footer for consistency) -->
    <footer class="faq-foot">
      <div class="foot-col">
        <div class="landing-brand">
          <span class="logo-mark"><Box :size="18" /></span>
          <strong>ProxyBox</strong>
        </div>
        <p class="foot-tag">{{ t('landing.foot.tag') }}</p>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.product') }}</h5>
        <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink>
        <RouterLink to="/api-docs">{{ t('landing.foot.apiDocs') }}</RouterLink>
        <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
        <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.host') }}</h5>
        <a href="/faq#self-host-panel">{{ t('landing.foot.docsInstall') }}</a>
        <a href="/faq#self-host-troubleshoot">{{ t('landing.foot.docsTrouble') }}</a>
        <a href="/faq#self-host-trust">{{ t('landing.foot.docsTrust') }}</a>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.community') }}</h5>
        <RouterLink to="/login">{{ t('landing.nav.login') }}</RouterLink>
        <RouterLink to="/register">{{ t('landing.nav.register') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
      </div>
      <div class="foot-bottom">
        <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
        <span class="foot-onie">
          {{ t('landing.foot.publishedBy') }}
          <a href="https://onie.net" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://onie.net" target="_blank" rel="noopener">onie.net</a>
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.faq-page {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.faq-page * { box-sizing: border-box; }
.faq-page a { color: inherit; text-decoration: none; }

/* ── Top nav (mirror landing) ── */
.landing-nav {
  display: flex; align-items: center; gap: 24px;
  padding: 14px 32px;
  border-bottom: 1px solid var(--border-soft);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 50;
}
.landing-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 16px; flex-shrink: 0; }
.landing-brand .logo-mark {
  width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #58a6ff, #3fb950); color: #0a0e14;
}
.landing-brand .brand-sub {
  font-size: 11px; color: var(--dim); padding: 2px 6px;
  border: 1px solid var(--border); border-radius: 4px;
  margin-left: 2px; font-weight: 500; letter-spacing: 0.4px;
}
.landing-nav-links { display: flex; gap: 22px; margin-left: 18px; flex: 1; min-width: 0; }
.landing-nav-links a { color: var(--dim); font-size: 14px; white-space: nowrap; }
.landing-nav-links a:hover { color: var(--text); }
.landing-nav-actions { display: flex; gap: 8px; align-items: center; }
.lang-toggle, .theme-btn {
  display: inline-flex; align-items: center;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  overflow: hidden;
}
.lang-toggle button {
  border: 0; background: transparent; color: var(--dim);
  padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.lang-toggle button.active { background: var(--surface); color: var(--text); }
.theme-btn { border: 1px solid var(--border); padding: 6px 10px; color: var(--dim); cursor: pointer; }
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--surface); border-color: var(--blue); }
.btn.primary { background: linear-gradient(135deg, #58a6ff, #2f81f7); border-color: transparent; color: #0a0e14; }
.btn.ghost { background: transparent; }

/* ── Mobile drawer toggle ── */
.drawer-toggle {
  display: none;
  position: sticky; top: 64px; z-index: 40;
  width: 100%;
  align-items: center; gap: 8px;
  padding: 10px 16px;
  background: var(--surface);
  border: 0; border-bottom: 1px solid var(--border-soft);
  color: var(--text); font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.mobile-only { display: none; }

/* ── Gitbook 2-col shell ── */
.faq-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  max-width: 1280px;
  margin: 0 auto;
}
.faq-sidebar {
  position: sticky; top: 64px;
  align-self: start;
  height: calc(100vh - 64px); overflow-y: auto;
  border-right: 1px solid var(--border-soft);
}
.faq-sidebar-inner { padding: 24px 14px 24px 24px; }
.faq-search {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 12px;
  color: var(--dim); margin-bottom: 16px;
}
.faq-search input {
  background: transparent; border: none; padding: 0; flex: 1;
  color: var(--text); font-size: 13px; outline: none;
}
.faq-group h4 {
  font-size: 10.5px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 0.1em;
  font-weight: 700; margin: 16px 4px 8px;
}
.faq-group:first-of-type h4 { margin-top: 0; }
.faq-nav-row {
  display: flex; align-items: center;
  border-radius: 6px;
  transition: background 100ms;
  margin-bottom: 2px;
}
.faq-nav-row:hover { background: var(--surface-2); }
.faq-nav-row.active { background: var(--blue-soft); }
.faq-nav-row.active .faq-nav-pick { color: var(--blue); font-weight: 500; }
.faq-nav-pick {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none;
  padding: 8px 10px; border-radius: 6px;
  color: var(--dim); font-size: 13px; cursor: pointer; text-align: left;
}
.faq-nav-pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.faq-nav-pick:hover { color: var(--text); }
.empty-text { color: var(--dim); font-size: 13px; padding: 12px; }

/* ── Content ── */
.faq-content {
  padding: 36px 40px 60px;
  max-width: 880px;
  min-width: 0;
}
.content-head { margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--border-soft); }
.cat-pill {
  display: inline-block;
  font-size: 10.5px; font-weight: 600;
  background: var(--green-soft); color: var(--green);
  padding: 3px 9px; border-radius: 999px;
  margin-bottom: 12px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.content-head h1 {
  margin: 0 0 12px;
  font-size: 32px; font-weight: 700; letter-spacing: -0.4px;
}
.content-meta {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  font-size: 12px; color: var(--dim);
}
.meta-copy {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--dim); padding: 4px 10px; border-radius: 6px;
  font-size: 12px; cursor: pointer;
}
.meta-copy:hover { color: var(--text); border-color: var(--blue); }
.meta-updated { font-family: var(--mono); font-size: 11px; }

.lang-notice {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; margin-bottom: 18px;
  background: var(--yellow-soft); border: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent);
  border-radius: 8px;
  color: var(--yellow); font-size: 12.5px; line-height: 1.5;
}

.doc-body { color: var(--text); line-height: 1.75; font-size: 14.5px; }
.doc-body :deep(p) { margin: 0 0 16px; }
.doc-body :deep(h2) { font-size: 22px; margin: 28px 0 12px; font-weight: 700; letter-spacing: -0.2px; }
.doc-body :deep(h3) { font-size: 17px; margin: 22px 0 10px; font-weight: 600; }
.doc-body :deep(h4) { font-size: 14.5px; margin: 18px 0 8px; font-weight: 600; }
.doc-body :deep(h5) { font-size: 13px; margin: 16px 0 6px; font-weight: 600; color: var(--dim); }
.doc-body :deep(code) {
  background: var(--surface-2); padding: 2px 6px; border-radius: 4px;
  font-family: var(--mono); font-size: 12px; color: var(--green);
  overflow-wrap: anywhere; word-break: break-word;
}
.doc-body :deep(pre) {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 14px 16px; overflow-x: auto;
  margin: 16px 0;
}
.doc-body :deep(pre code) {
  background: transparent; padding: 0; color: var(--text); font-size: 12.5px; line-height: 1.6;
}
.doc-body :deep(strong) { color: var(--text); font-weight: 600; }
.doc-body :deep(a) { color: var(--blue); text-decoration: underline; }
.doc-body :deep(ul), .doc-body :deep(ol) { padding-left: 22px; margin: 0 0 16px; }
.doc-body :deep(li) { margin-bottom: 6px; }

/* Footer */
.faq-foot {
  display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 32px; padding: 48px 32px 24px;
  max-width: 1240px; margin: 0 auto;
  border-top: 1px solid var(--border-soft);
}
.foot-col h5 { margin: 0 0 12px; font-size: 13px; color: var(--text); letter-spacing: 0.3px; }
.foot-col a { display: block; color: var(--dim); font-size: 13px; padding: 4px 0; }
.foot-col a:hover { color: var(--text); }
.foot-tag { color: var(--dim); font-size: 13px; margin: 12px 0 0; max-width: 280px; line-height: 1.5; }
.foot-bottom {
  grid-column: 1 / -1;
  border-top: 1px solid var(--border-soft);
  padding-top: 18px; margin-top: 8px;
  color: var(--dim); font-size: 12px;
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.foot-onie a { color: var(--text); text-decoration: none; font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* ── Tablet ── */
@media (max-width: 980px) {
  .mobile-only { display: inline-flex; }
  .drawer-toggle { display: inline-flex; }
  .landing-nav { padding: 12px 16px; gap: 12px; }
  .landing-nav-links { display: none; }
  .desktop-only { display: none; }

  .faq-shell { grid-template-columns: 1fr; }
  .faq-sidebar {
    position: fixed; top: 0; left: 0;
    height: 100vh; width: 280px;
    background: var(--bg);
    border-right: 1px solid var(--border-soft);
    z-index: 60;
    transform: translateX(-100%);
    transition: transform 200ms ease-out;
    box-shadow: 4px 0 24px rgba(0,0,0,0.3);
  }
  .faq-sidebar.open { transform: translateX(0); }
  .faq-sidebar-inner { padding: 64px 14px 24px 18px; }
  .faq-backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 55;
  }
  .faq-content { padding: 28px 20px 50px; }
  .content-head h1 { font-size: 26px; }
  .faq-foot { grid-template-columns: 1fr 1fr; padding: 32px 20px 20px; }
  .foot-bottom { flex-direction: column; gap: 8px; }
}
/* ── Phone ── */
@media (max-width: 640px) {
  .landing-nav { padding: 10px 14px; gap: 8px; }
  .landing-brand strong { font-size: 15px; }
  .landing-brand .brand-sub { display: none; }
  .theme-btn { display: none; }
  .lang-toggle button { padding: 5px 8px; font-size: 11px; }
  .btn { padding: 7px 12px; font-size: 12px; }

  .faq-content { padding: 20px 16px 40px; }
  .content-head h1 { font-size: 22px; }
  .doc-body { font-size: 14px; }
  .doc-body :deep(h2) { font-size: 19px; }
  .doc-body :deep(h3) { font-size: 15px; }
  .faq-foot { grid-template-columns: 1fr; padding: 32px 16px 20px; gap: 22px; }
}
</style>
