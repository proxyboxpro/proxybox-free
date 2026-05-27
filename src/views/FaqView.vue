<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ArrowRight, Book, ChevronRight, Copy, Check, Search,
  Terminal, Sparkles, Lock, Zap, Server, ShieldCheck, BookOpen,
  CreditCard, Cloud, Cpu, Users, FileText
} from 'lucide-vue-next'
import PublicTopNav from '../components/PublicTopNav.vue'
import { apiFetch } from '../api'
import { useI18n } from '../i18n'

const route = useRoute()
const { t, locale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const docs = ref([])
const loading = ref(true)
const search = ref('')
const activeCategory = ref('')
const activeDocId = ref('')

const installCmd = 'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash'
const copied = ref('')
function copy(text, key = 'cmd') {
  navigator.clipboard?.writeText(text)
  copied.value = key
  setTimeout(() => { copied.value = '' }, 1500)
}

async function refresh() {
  loading.value = true
  try { docs.value = await apiFetch(`/api/public/docs?lang=${locale.value}`) }
  catch { docs.value = [] }
  finally { loading.value = false }
  applyHash(true)
  if (!activeCategory.value) {
    const firstCat = grouped.value[0]
    if (firstCat) activeCategory.value = firstCat.id
  }
}
watch(locale, () => { refresh() })

// Category meta — pick an icon per VI/EN category name.
function iconFor(cat) {
  const c = String(cat || '').toLowerCase()
  if (c.includes('start') || c.includes('bắt đầu')) return Sparkles
  if (c.includes('using') || c.includes('cách sử')) return Zap
  if (c.includes('billing') || c.includes('thanh')) return CreditCard
  if (c.includes('api')) return Terminal
  if (c.includes('self-host')) return Server
  if (c.includes('community') || c.includes('cộng đồng')) return Users
  return BookOpen
}

// Group docs by category. Each group: { id, title, icon, count, items[] }.
const grouped = computed(() => {
  const m = new Map()
  for (const d of docs.value.filter((x) => x.published !== false)) {
    const cat = d.category || (locale.value === 'vi' ? 'Khác' : 'Other')
    if (!m.has(cat)) m.set(cat, [])
    m.get(cat).push(d)
  }
  return [...m.entries()].map(([cat, items]) => ({
    id: cat,
    title: cat,
    icon: iconFor(cat),
    count: items.length,
    items: items.sort((a, b) => (a.order || 0) - (b.order || 0))
  }))
})

const activeGroup = computed(() => grouped.value.find((g) => g.id === activeCategory.value) || grouped.value[0])

// Search across ALL docs.
const searchResults = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return null
  return docs.value.filter((d) =>
    (d.title || '').toLowerCase().includes(q) ||
    (d.body || '').toLowerCase().includes(q) ||
    (d.category || '').toLowerCase().includes(q)
  )
})

// Hash-based deep link: /faq#<slug> jumps to that doc (and switches category if needed).
function slugFromHash() { return (location.hash || '').replace(/^#/, '') }
function applyHash(initial = false) {
  const slug = slugFromHash()
  if (!slug || !docs.value.length) return
  const found = docs.value.find((d) => d.slug === slug || d.id === slug)
  if (found) {
    activeCategory.value = found.category
    activeDocId.value = found.id
    if (initial) requestAnimationFrame(() => {
      const el = document.getElementById(`doc-${found.id}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}
function onHashChange() { applyHash(false) }

// Minimal markdown renderer (same as before).
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

async function copyLink(d) {
  const url = `${location.origin}/faq#${d.slug || d.id}`
  await navigator.clipboard?.writeText(url).catch(() => {})
  copied.value = d.id
  setTimeout(() => { if (copied.value === d.id) copied.value = '' }, 1500)
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

    <section class="faq-shell">
      <header class="faq-head">
        <p class="eyebrow"><Book :size="12" /> {{ locale === 'vi' ? 'Tài liệu' : 'Documentation' }}</p>
        <h1>{{ locale === 'vi' ? 'FAQ & Tài liệu' : 'FAQ & Docs' }}</h1>
        <p class="sub">{{ locale === 'vi'
            ? 'Câu hỏi thường gặp, hướng dẫn cài đặt self-host, mẹo vận hành panel và bảo mật.'
            : 'Frequently asked questions, self-host install guides, operations tips and security notes.' }}</p>
      </header>

      <!-- Install card (analogue of api-docs key card) -->
      <section class="install-card">
        <div class="install-left">
          <span class="ico"><Terminal :size="18" /></span>
          <div>
            <strong>
              {{ locale === 'vi' ? 'Cài Panel ProxyBox của bạn' : 'Install your own ProxyBox panel' }}
              <small class="badge">{{ locale === 'vi' ? '1 lệnh · MIT · self-host' : 'one command · MIT · self-host' }}</small>
            </strong>
            <p class="muted">{{ locale === 'vi'
                ? 'Chạy lệnh dưới trên VPS Ubuntu / Debian. Sau 3-5 phút bạn có panel của riêng mình — customer enroll thẳng về domain của BẠN.'
                : 'Run the command below on any Ubuntu / Debian VPS. Within 3-5 minutes you get your own panel — customers enrol directly into YOUR domain.' }}</p>
          </div>
        </div>
        <div class="install-right">
          <code class="install-cmd">{{ installCmd }}</code>
          <button type="button" class="ghost-button" @click="copy(installCmd, 'cmd')">
            <component :is="copied === 'cmd' ? Check : Copy" :size="13" />
            {{ copied === 'cmd' ? (locale === 'vi' ? 'Đã copy' : 'Copied') : 'Copy' }}
          </button>
        </div>
      </section>

      <!-- Search -->
      <div class="faq-search">
        <Search :size="14" />
        <input v-model="search" type="search" :placeholder="locale === 'vi' ? 'Tìm trong docs (vd: ipv6, install, billing)...' : 'Search docs (e.g. ipv6, install, billing)...'" />
        <span v-if="search" class="search-clear" @click="search = ''">×</span>
      </div>

      <!-- 2-col layout: sidebar groups + content -->
      <div class="faq-layout">
        <nav class="faq-nav">
          <h4>{{ locale === 'vi' ? 'Chủ đề' : 'Topics' }}</h4>
          <button v-for="g in grouped" :key="g.id"
            type="button"
            :class="{ active: activeCategory === g.id && !search }"
            @click="activeCategory = g.id">
            <component :is="g.icon" :size="14" />
            <span>{{ g.title }}</span>
            <span class="count">{{ g.count }}</span>
          </button>
        </nav>

        <div class="faq-body">
          <!-- Search results take priority -->
          <article v-if="search && searchResults" class="search-article">
            <h2>{{ locale === 'vi' ? `Kết quả: ${searchResults.length}` : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` }}</h2>
            <p class="muted" v-if="!searchResults.length">{{ locale === 'vi' ? 'Không khớp doc nào.' : 'No matching docs.' }}</p>
            <div v-for="d in searchResults" :id="`doc-${d.id}`" :key="d.id" class="doc-card">
              <div class="doc-head">
                <span class="cat-pill">{{ d.category }}</span>
                <h3>{{ d.title }}</h3>
                <button type="button" class="ghost-button mini" @click="copyLink(d)" :aria-label="'Copy link'">
                  <component :is="copied === d.id ? Check : Copy" :size="11" />
                </button>
              </div>
              <div class="doc-body-md" v-html="renderBody(d.body)"></div>
            </div>
          </article>

          <!-- Default: render docs of active category -->
          <article v-else-if="activeGroup">
            <h2>
              <component :is="activeGroup.icon" :size="18" />
              {{ activeGroup.title }}
              <span class="cat-count">{{ activeGroup.count }}</span>
            </h2>
            <p class="muted">{{ locale === 'vi'
                ? `Toàn bộ ${activeGroup.count} doc thuộc chủ đề này.`
                : `All ${activeGroup.count} docs in this topic.` }}</p>

            <div v-if="loading" class="empty-text">{{ t('common.loading') || 'Loading…' }}</div>
            <div v-else v-for="(d, i) in activeGroup.items" :id="`doc-${d.id}`" :key="d.id" class="doc-card">
              <div class="doc-head">
                <span class="doc-num">{{ i + 1 }}</span>
                <h3>{{ d.title }}</h3>
                <button type="button" class="ghost-button mini" @click="copyLink(d)" :aria-label="locale === 'vi' ? 'Sao chép link' : 'Copy link'">
                  <component :is="copied === d.id ? Check : Copy" :size="11" />
                </button>
              </div>
              <div class="doc-body-md" v-html="renderBody(d.body)"></div>
              <footer v-if="d.updatedAt" class="doc-foot">
                {{ locale === 'vi' ? 'Cập nhật' : 'Updated' }}: {{ String(d.updatedAt).slice(0, 10) }}
              </footer>
            </div>
          </article>

          <!-- CTA at end -->
          <div class="docs-cta">
            <span><Zap :size="14" />
              {{ locale === 'vi'
                  ? 'Cần hỗ trợ thêm? Đăng nhập để mở ticket hoặc xem API docs interactive.'
                  : 'Need more help? Sign in to open a ticket or explore the interactive API docs.' }}
            </span>
            <div class="cta-actions">
              <RouterLink class="btn primary" to="/api-docs">
                {{ locale === 'vi' ? 'API docs' : 'API docs' }} <ArrowRight :size="14" />
              </RouterLink>
              <RouterLink class="btn ghost" to="/login">
                <Lock :size="14" /> {{ locale === 'vi' ? 'Đăng nhập' : 'Sign in' }}
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <footer class="faq-foot">
        <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
        <span class="foot-onie">
          {{ t('landing.foot.publishedBy') }}
          <a href="https://onie.net" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://onie.net" target="_blank" rel="noopener">onie.net</a>
        </span>
        <span>
          <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink> ·
          <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink> ·
          <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
        </span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.faq-page {
  min-height: 100vh;
  background:
    radial-gradient(900px 500px at 90% -10%, rgba(88,166,255,0.06), transparent 65%),
    radial-gradient(700px 400px at -5% 30%, rgba(63,185,80,0.05), transparent 65%),
    var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.faq-page * { box-sizing: border-box; }
.faq-page a { color: inherit; text-decoration: none; }

.faq-shell {
  max-width: 1280px; margin: 0 auto;
  padding: 28px 28px 60px;
  display: flex; flex-direction: column; gap: 22px;
}

/* Header */
.faq-head .eyebrow {
  color: var(--green); font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 5px;
  margin: 0 0 4px;
}
.faq-head h1 {
  margin: 0; font-size: 30px; font-weight: 800;
  letter-spacing: -0.4px;
}
.faq-head .sub {
  margin: 6px 0 0; color: var(--dim); font-size: 14px;
  max-width: 720px; line-height: 1.55;
}

/* Install card */
.install-card {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 14px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--green-soft) 50%, transparent) 0%, transparent 60%), var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 20px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent) inset;
}
.install-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 280px; }
.install-left .ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: var(--green-soft); color: var(--green);
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
  flex-shrink: 0;
}
.install-left strong { color: var(--text); font-size: 14px; }
.install-left .muted { font-size: 12px; color: var(--dim); margin: 4px 0 0; line-height: 1.5; }
.install-card .badge {
  display: inline-block; margin-left: 6px;
  font-family: var(--mono); font-size: 9.5px;
  padding: 2px 7px; border-radius: 5px;
  background: var(--surface-2); color: var(--dim);
  text-transform: none; letter-spacing: 0;
  border: 1px solid var(--border-soft);
}
.install-right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.install-cmd {
  font-family: var(--mono); font-size: 12.5px;
  color: var(--green); background: var(--bg);
  padding: 8px 12px; border-radius: 7px;
  border: 1px solid var(--border-soft);
  max-width: 460px;
  overflow-x: auto; white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}

.ghost-button {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text); border-radius: 7px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: 0.15s;
}
.ghost-button:hover { border-color: var(--green); color: var(--green); }
.ghost-button.mini { padding: 3px 7px; font-size: 10.5px; }

/* Search */
.faq-search {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 14px;
  color: var(--dim);
  transition: 0.15s;
}
.faq-search:focus-within {
  border-color: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 15%, transparent);
}
.faq-search input {
  background: transparent; border: none; padding: 0;
  flex: 1; min-width: 0;
  color: var(--text); font-size: 13.5px; outline: none;
}
.search-clear {
  cursor: pointer; padding: 0 6px; color: var(--dim);
  font-size: 18px; line-height: 1;
}
.search-clear:hover { color: var(--text); }

/* 2-col layout */
.faq-layout {
  display: grid; grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px; align-items: start;
}
.faq-nav {
  position: sticky; top: 80px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px;
  display: flex; flex-direction: column; gap: 3px;
  max-height: calc(100vh - 100px); overflow-y: auto;
}
.faq-nav h4 {
  margin: 0 4px 10px; font-size: 10px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;
}
.faq-nav button {
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; color: var(--dim);
  padding: 9px 12px; border-radius: 8px;
  text-align: left; font: inherit; font-size: 13px; cursor: pointer;
  transition: 0.15s;
}
.faq-nav button:hover { background: var(--surface-2); color: var(--text); }
.faq-nav button.active {
  background: color-mix(in srgb, var(--green-soft) 80%, transparent);
  color: var(--text); font-weight: 600;
}
.faq-nav button.active svg { color: var(--green); }
.faq-nav button .count {
  margin-left: auto;
  font-family: var(--mono); font-size: 10.5px; color: var(--dim);
  background: var(--surface-2); padding: 2px 7px; border-radius: 5px;
}
.faq-nav button.active .count {
  background: var(--green); color: #0a0e14; font-weight: 700;
}

/* Body */
.faq-body article { display: flex; flex-direction: column; gap: 18px; }
.faq-body h2 {
  margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;
  display: inline-flex; align-items: center; gap: 8px;
}
.faq-body h2 svg { color: var(--green); }
.cat-count {
  font-family: var(--mono); font-size: 12px;
  background: var(--green-soft); color: var(--green);
  padding: 2px 9px; border-radius: 6px;
  margin-left: 4px;
  border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
}
.faq-body .muted { color: var(--dim); font-size: 13.5px; margin: 0; line-height: 1.6; }
.empty-text { color: var(--dim); font-size: 13px; padding: 28px 0; text-align: center; }

/* Doc card */
.doc-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 22px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-margin-top: 80px;
}
.doc-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.doc-num {
  flex: none;
  width: 30px; height: 30px;
  border-radius: 8px;
  background: var(--green-soft); color: var(--green);
  font-family: var(--mono); font-weight: 800; font-size: 14px;
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
}
.doc-head h3 {
  margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.2px;
  flex: 1; min-width: 0;
}
.cat-pill {
  display: inline-block;
  font-size: 10.5px; font-weight: 700;
  background: var(--green-soft); color: var(--green);
  padding: 3px 9px; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.04em;
  border: 1px solid color-mix(in srgb, var(--green) 25%, transparent);
}
.doc-body-md { color: var(--text); line-height: 1.75; font-size: 14px; }
.doc-body-md :deep(p) { margin: 0 0 14px; }
.doc-body-md :deep(h2) { font-size: 19px; margin: 22px 0 10px; font-weight: 700; }
.doc-body-md :deep(h3) { font-size: 16px; margin: 18px 0 8px; font-weight: 600; }
.doc-body-md :deep(h4) { font-size: 14px; margin: 16px 0 6px; font-weight: 600; }
.doc-body-md :deep(h5) { font-size: 12.5px; margin: 14px 0 6px; font-weight: 600; color: var(--dim); }
.doc-body-md :deep(code) {
  background: var(--surface-2); padding: 2px 6px; border-radius: 4px;
  font-family: var(--mono); font-size: 12px; color: var(--green);
  border: 1px solid var(--border-soft);
  overflow-wrap: anywhere; word-break: break-word;
}
.doc-body-md :deep(pre) {
  background: var(--bg); border: 1px solid var(--border-soft);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto;
  margin: 14px 0;
}
.doc-body-md :deep(pre code) {
  background: transparent; padding: 0; color: var(--text);
  font-size: 12px; line-height: 1.6; border: none;
}
.doc-body-md :deep(strong) { color: var(--text); font-weight: 600; }
.doc-body-md :deep(a) { color: var(--blue); text-decoration: underline; }
.doc-body-md :deep(ul), .doc-body-md :deep(ol) { padding-left: 22px; margin: 0 0 14px; }
.doc-body-md :deep(li) { margin-bottom: 5px; }
.doc-foot {
  margin: 0; padding: 10px 0 0;
  border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 11.5px;
  font-family: var(--mono);
}

/* CTA */
.docs-cta {
  margin-top: 6px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
  background: linear-gradient(135deg, var(--green-soft) 0%, color-mix(in srgb, var(--green-soft) 40%, transparent) 100%);
  font-size: 13px; color: var(--text);
}
.docs-cta > span {
  display: inline-flex; align-items: center; gap: 8px;
  flex: 1; min-width: 240px;
}
.docs-cta svg { color: var(--green); flex-shrink: 0; }
.cta-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border-radius: 7px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); cursor: pointer;
  font-size: 13px; font-weight: 600; white-space: nowrap;
  transition: 0.15s;
}
.btn:hover { border-color: var(--blue); }
.btn.primary {
  background: linear-gradient(135deg, #3fb950 0%, #2e9c40 100%);
  border-color: transparent;
  color: #0a0e14; font-weight: 700;
  box-shadow: 0 4px 14px rgba(63, 185, 80, 0.25);
}
.btn.primary:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(63, 185, 80, 0.35); }
.btn.ghost { background: transparent; }

/* Footer */
.faq-foot {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px;
  padding: 22px 0 0;
  margin-top: 14px;
  border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 12px;
}
.faq-foot a { color: var(--dim); text-decoration: none; }
.faq-foot a:hover { color: var(--text); }
.foot-onie a { color: var(--text); font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* Mobile */
@media (max-width: 980px) {
  .faq-shell { padding: 22px 18px 50px; gap: 18px; }
  .faq-head h1 { font-size: 26px; }
  .faq-layout { grid-template-columns: 1fr; gap: 14px; }
  .faq-nav {
    position: static;
    max-height: 300px;
    flex-direction: row; flex-wrap: wrap;
    padding: 10px;
  }
  .faq-nav h4 { display: none; }
  .faq-nav button { flex: 1 1 auto; }
  .install-cmd { max-width: 100%; }
  .install-card { padding: 14px 16px; }
}
@media (max-width: 640px) {
  .faq-shell { padding: 18px 14px 40px; }
  .faq-head h1 { font-size: 22px; }
  .faq-head .sub { font-size: 13px; }
  .install-card { gap: 10px; }
  .install-right { width: 100%; }
  .install-cmd { flex: 1; font-size: 11.5px; }
  .doc-card { padding: 14px 16px; }
  .doc-head h3 { font-size: 15.5px; }
  .doc-body-md { font-size: 13.5px; }
  .docs-cta { flex-direction: column; align-items: flex-start; }
  .cta-actions { width: 100%; }
  .cta-actions .btn { flex: 1; justify-content: center; }
  .faq-foot { flex-direction: column; align-items: flex-start; }
}
</style>
