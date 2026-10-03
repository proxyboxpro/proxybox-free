<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Grid } from 'ant-design-vue'
import {
  ApiOutlined, CloudServerOutlined, CreditCardOutlined, ReadOutlined,
  RocketOutlined, TeamOutlined, ThunderboltOutlined
} from '@ant-design/icons-vue'
import PublicTopNav from '../components/PublicTopNav.vue'
import { apiFetch } from '../api'
import { useI18n } from '../i18n'

const { t, locale } = useI18n()
const screens = Grid.useBreakpoint()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const year = new Date().getFullYear()

const docs = ref([])
const loading = ref(true)
const search = ref('')
const activeCategory = ref('')
const activeDocId = ref('')
// Expanded collapse panels (doc ids).
const openKeys = ref([])

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
  // Pick the first topic when none is chosen (or the old one vanished after a language switch).
  if (!grouped.value.some((g) => g.id === activeCategory.value)) {
    const firstCat = grouped.value[0]
    if (firstCat) activeCategory.value = firstCat.id
  }
}
watch(locale, () => { refresh() })

// Category meta — pick an icon per VI/EN category name.
function iconFor(cat) {
  const c = String(cat || '').toLowerCase()
  if (c.includes('start') || c.includes('bắt đầu')) return RocketOutlined
  if (c.includes('using') || c.includes('cách sử')) return ThunderboltOutlined
  if (c.includes('billing') || c.includes('thanh')) return CreditCardOutlined
  if (c.includes('api')) return ApiOutlined
  if (c.includes('self-host')) return CloudServerOutlined
  if (c.includes('community') || c.includes('cộng đồng')) return TeamOutlined
  return ReadOutlined
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

// Keep one panel open: the deep-linked doc, else the first doc of the topic / search results.
function openFirst(list) {
  if (list?.length && !list.some((d) => openKeys.value.includes(d.id))) openKeys.value = [list[0].id]
}
watch(activeGroup, (g) => { if (!searchResults.value) openFirst(g?.items) })
watch(searchResults, (list) => openFirst(list))

function selectCategory(id) { activeCategory.value = id }

// Hash-based deep link: /faq#<slug> jumps to that doc (switches category + expands it).
function slugFromHash() { return (location.hash || '').replace(/^#/, '') }
function applyHash(initial = false) {
  const slug = slugFromHash()
  if (!slug || !docs.value.length) return
  const found = docs.value.find((d) => d.slug === slug || d.id === slug)
  if (found) {
    activeCategory.value = found.category
    activeDocId.value = found.id
    if (!openKeys.value.includes(found.id)) openKeys.value = [...openKeys.value, found.id]
    // Wait for the topic to render and the panel's expand animation to finish,
    // otherwise the page is not tall enough yet and the scroll stops short.
    setTimeout(() => {
      const el = document.getElementById(`doc-${found.id}`)
      if (el) el.scrollIntoView({ behavior: initial ? 'auto' : 'smooth', block: 'start' })
    }, 350)
  }
}
function onHashChange() { applyHash(false) }

// Minimal markdown renderer (same as before).
function renderBody(text) {
  if (!text) return ''
  let out = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  out = out.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`)
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
  <a-layout class="pub-page">
    <PublicTopNav sub-label="Docs" />

    <a-layout-content class="pub-shell">
      <header class="pub-head">
        <a-typography-text type="success" strong class="kicker">
          <ReadOutlined /> {{ locale === 'vi' ? 'Tài liệu' : 'Documentation' }}
        </a-typography-text>
        <a-typography-title :level="1" class="page-title">{{ locale === 'vi' ? 'FAQ & Tài liệu' : 'FAQ & Docs' }}</a-typography-title>
        <a-typography-paragraph type="secondary" class="page-sub">
          {{ locale === 'vi'
            ? 'Câu hỏi thường gặp, hướng dẫn cài đặt self-host, mẹo vận hành panel và bảo mật.'
            : 'Frequently asked questions, self-host install guides, operations tips and security notes.' }}
        </a-typography-paragraph>
      </header>

      <!-- Install card -->
      <a-card class="install-card" :body-style="{ padding: '16px 20px' }">
        <a-row :gutter="[20, 14]" align="middle">
          <a-col :xs="24" :xl="12">
            <a-flex gap="middle" align="flex-start">
              <span class="icon-tile"><CodeOutlined /></span>
              <div class="install-text">
                <a-space wrap :size="6">
                  <a-typography-text strong>{{ locale === 'vi' ? 'Cài Panel ProxyBox của bạn' : 'Install your own ProxyBox panel' }}</a-typography-text>
                  <a-tag :bordered="false" class="mono">{{ locale === 'vi' ? '1 lệnh · MIT · self-host' : 'one command · MIT · self-host' }}</a-tag>
                </a-space>
                <a-typography-paragraph type="secondary" class="install-desc">
                  {{ locale === 'vi'
                    ? 'Chạy lệnh dưới trên VPS Ubuntu / Debian. Sau 3-5 phút bạn có panel của riêng mình — customer enroll thẳng về domain của BẠN.'
                    : 'Run the command below on any Ubuntu / Debian VPS. Within 3-5 minutes you get your own panel — customers enrol directly into YOUR domain.' }}
                </a-typography-paragraph>
              </div>
            </a-flex>
          </a-col>
          <a-col :xs="24" :xl="12">
            <a-flex gap="small" align="center">
              <code class="cmd mono">{{ installCmd }}</code>
              <a-button @click="copy(installCmd, 'cmd')">
                <template #icon><CheckOutlined v-if="copied === 'cmd'" /><CopyOutlined v-else /></template>
                {{ copied === 'cmd' ? (locale === 'vi' ? 'Đã copy' : 'Copied') : 'Copy' }}
              </a-button>
            </a-flex>
          </a-col>
        </a-row>
      </a-card>

      <!-- Search -->
      <a-input
        v-model:value="search"
        size="large"
        allow-clear
        :placeholder="locale === 'vi' ? 'Tìm trong docs (vd: ipv6, install, billing)...' : 'Search docs (e.g. ipv6, install, billing)...'"
      >
        <template #prefix><SearchOutlined /></template>
      </a-input>

      <!-- 2-col layout: topics + content -->
      <a-row :gutter="[20, 16]">
        <a-col :xs="24" :lg="7" :xl="6">
          <a-card v-if="screens.lg" size="small" :title="locale === 'vi' ? 'Chủ đề' : 'Topics'" class="topic-card" :body-style="{ padding: '4px' }">
            <a-menu
              mode="inline"
              class="topic-menu"
              :selected-keys="search ? [] : [activeGroup?.id]"
              @click="({ key }) => selectCategory(key)"
            >
              <a-menu-item v-for="g in grouped" :key="g.id">
                <template #icon><component :is="g.icon" /></template>
                <span class="topic-row">
                  <span class="topic-name">{{ g.title }}</span>
                  <a-tag :bordered="false" :color="activeGroup?.id === g.id && !search ? 'success' : undefined" class="topic-count mono">{{ g.count }}</a-tag>
                </span>
              </a-menu-item>
            </a-menu>
          </a-card>
          <a-flex v-else wrap="wrap" gap="small">
            <a-button
              v-for="g in grouped"
              :key="g.id"
              :type="activeGroup?.id === g.id && !search ? 'primary' : 'default'"
              @click="selectCategory(g.id)"
            >
              <template #icon><component :is="g.icon" /></template>
              {{ g.title }} <span class="mono btn-count">{{ g.count }}</span>
            </a-button>
          </a-flex>
        </a-col>

        <a-col :xs="24" :lg="17" :xl="18">
          <a-flex vertical gap="middle">
            <!-- Search results take priority -->
            <template v-if="search && searchResults">
              <a-typography-title :level="2" class="section-title">
                {{ locale === 'vi' ? `Kết quả: ${searchResults.length}` : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` }}
              </a-typography-title>
              <a-card v-if="!searchResults.length">
                <a-empty :description="locale === 'vi' ? 'Không khớp doc nào.' : 'No matching docs.'" />
              </a-card>
              <a-collapse v-else v-model:active-key="openKeys" class="doc-collapse">
                <a-collapse-panel v-for="d in searchResults" :id="`doc-${d.id}`" :key="d.id" force-render class="doc-panel">
                  <template #header>
                    <a-flex align="center" gap="small" wrap="wrap">
                      <a-tag color="success" :bordered="false">{{ d.category }}</a-tag>
                      <a-typography-title :level="3" class="doc-title">{{ d.title }}</a-typography-title>
                    </a-flex>
                  </template>
                  <template #extra>
                    <a-tooltip :title="copied === d.id ? (locale === 'vi' ? 'Đã copy' : 'Copied') : (locale === 'vi' ? 'Sao chép link' : 'Copy link')">
                      <a-button type="text" size="small" :aria-label="locale === 'vi' ? 'Sao chép link' : 'Copy link'" @click.stop="copyLink(d)">
                        <template #icon><CheckOutlined v-if="copied === d.id" /><LinkOutlined v-else /></template>
                      </a-button>
                    </a-tooltip>
                  </template>
                  <a-typography class="doc-md"><div v-html="renderBody(d.body)"></div></a-typography>
                </a-collapse-panel>
              </a-collapse>
            </template>

            <!-- Default: docs of the active topic -->
            <template v-else-if="activeGroup">
              <div>
                <a-flex align="center" gap="small" wrap="wrap">
                  <component :is="activeGroup.icon" class="section-icon" />
                  <a-typography-title :level="2" class="section-title">{{ activeGroup.title }}</a-typography-title>
                  <a-tag color="success" class="mono">{{ activeGroup.count }}</a-tag>
                </a-flex>
                <a-typography-text type="secondary">
                  {{ locale === 'vi' ? `Toàn bộ ${activeGroup.count} doc thuộc chủ đề này.` : `All ${activeGroup.count} docs in this topic.` }}
                </a-typography-text>
              </div>

              <a-card v-if="loading"><a-skeleton active /></a-card>
              <a-collapse v-else v-model:active-key="openKeys" class="doc-collapse">
                <a-collapse-panel v-for="(d, i) in activeGroup.items" :id="`doc-${d.id}`" :key="d.id" force-render class="doc-panel">
                  <template #header>
                    <a-flex align="center" gap="small">
                      <span class="doc-num mono">{{ i + 1 }}</span>
                      <a-typography-title :level="3" class="doc-title">{{ d.title }}</a-typography-title>
                    </a-flex>
                  </template>
                  <template #extra>
                    <a-tooltip :title="copied === d.id ? (locale === 'vi' ? 'Đã copy' : 'Copied') : (locale === 'vi' ? 'Sao chép link' : 'Copy link')">
                      <a-button type="text" size="small" :aria-label="locale === 'vi' ? 'Sao chép link' : 'Copy link'" @click.stop="copyLink(d)">
                        <template #icon><CheckOutlined v-if="copied === d.id" /><LinkOutlined v-else /></template>
                      </a-button>
                    </a-tooltip>
                  </template>
                  <a-typography class="doc-md"><div v-html="renderBody(d.body)"></div></a-typography>
                  <template v-if="d.updatedAt">
                    <a-divider class="doc-divider" />
                    <a-typography-text type="secondary" class="mono doc-foot">
                      {{ locale === 'vi' ? 'Cập nhật' : 'Updated' }}: {{ String(d.updatedAt).slice(0, 10) }}
                    </a-typography-text>
                  </template>
                </a-collapse-panel>
              </a-collapse>
            </template>

            <a-card v-else-if="loading"><a-skeleton active /></a-card>

            <!-- CTA at end -->
            <a-card class="cta-card" :body-style="{ padding: '14px 18px' }">
              <a-flex justify="space-between" align="center" wrap="wrap" gap="middle">
                <a-flex align="center" gap="small" class="cta-text">
                  <ThunderboltOutlined class="cta-icon" />
                  <a-typography-text>
                    {{ locale === 'vi'
                      ? 'Cần hỗ trợ thêm? Đăng nhập để mở ticket hoặc xem API docs interactive.'
                      : 'Need more help? Sign in to open a ticket or explore the interactive API docs.' }}
                  </a-typography-text>
                </a-flex>
                <a-space wrap>
                  <RouterLink v-slot="{ href, navigate }" to="/api-docs" custom>
                    <a-button type="primary" :href="href" @click="navigate">
                      API docs <ArrowRightOutlined />
                    </a-button>
                  </RouterLink>
                  <RouterLink v-slot="{ href, navigate }" to="/login" custom>
                    <a-button :href="href" @click="navigate">
                      <template #icon><LockOutlined /></template>
                      {{ locale === 'vi' ? 'Đăng nhập' : 'Sign in' }}
                    </a-button>
                  </RouterLink>
                </a-space>
              </a-flex>
            </a-card>
          </a-flex>
        </a-col>
      </a-row>
    </a-layout-content>

    <a-layout-footer class="pub-foot">
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="pub-foot-inner">
        <span>{{ t('landing.foot.copyright', { year, ver: appVersion }) }}</span>
        <span>
          {{ t('landing.foot.publishedBy') }}
          <a href="https://proxybox.pro" target="_blank" rel="noopener" class="foot-strong">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
        </span>
        <span>
          <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink> ·
          <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
        </span>
      </a-flex>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped>
.pub-page { min-height: 100vh; }
.pub-shell {
  width: 100%; max-width: 1280px; margin: 0 auto;
  padding: 28px 24px 48px;
  display: flex; flex-direction: column; gap: 20px;
}

/* Header */
.kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.page-title { margin: 4px 0 6px !important; font-size: 32px !important; letter-spacing: -0.4px; }
.page-sub { margin: 0 !important; max-width: 720px; font-size: 15px; }

/* Install card */
.install-card {
  background: linear-gradient(135deg, var(--pb-primary-soft) 0%, transparent 55%), var(--pb-surface);
}
.icon-tile {
  flex: none; display: inline-grid; place-items: center;
  width: 40px; height: 40px; border-radius: 10px;
  font-size: 18px; color: var(--pb-primary); background: var(--pb-primary-soft);
}
.install-text { min-width: 0; }
.install-desc { margin: 4px 0 0 !important; font-size: 13px; }
.cmd {
  flex: 1; min-width: 0;
  padding: 7px 12px; border-radius: 8px;
  background: var(--pb-bg); border: 1px solid var(--pb-border-soft);
  color: var(--pb-primary); white-space: nowrap; overflow-x: auto; word-break: normal;
}

/* Topics */
.topic-card { position: sticky; top: 80px; }
.topic-menu { border-inline-end: none !important; }
.topic-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.topic-name { overflow: hidden; text-overflow: ellipsis; }
.topic-count { margin-inline-end: 0; }
.btn-count { opacity: 0.65; margin-inline-start: 4px; }

/* Content */
.section-icon { font-size: 20px; color: var(--pb-primary); }
.section-title { margin: 0 !important; font-size: 22px !important; }
.doc-panel { scroll-margin-top: 80px; }
.doc-title { margin: 0 !important; font-size: 16px !important; line-height: 1.4 !important; }
.doc-num {
  flex: none; display: inline-grid; place-items: center;
  width: 28px; height: 28px; border-radius: 8px;
  font-weight: 700; color: var(--pb-primary); background: var(--pb-primary-soft);
}
.doc-md { font-size: 14px; line-height: 1.75; }
.doc-md :deep(h2) { font-size: 19px; margin: 20px 0 10px; }
.doc-md :deep(h3) { font-size: 16px; margin: 18px 0 8px; }
.doc-md :deep(h4) { font-size: 14px; margin: 16px 0 6px; }
.doc-md :deep(h5) { font-size: 13px; margin: 14px 0 6px; }
.doc-md :deep(p:last-child) { margin-bottom: 0; }
.doc-md :deep(code) { font-family: var(--pb-mono); overflow-wrap: anywhere; }
.doc-md :deep(pre) { font-family: var(--pb-mono); font-size: 12.5px; line-height: 1.6; padding: 10px 14px; border-radius: 8px; overflow-x: auto; }
.doc-divider { margin: 14px 0 10px; }
.doc-foot { font-size: 12px; }

/* CTA */
.cta-card {
  border-color: color-mix(in srgb, var(--pb-primary) 35%, var(--pb-border));
  background: linear-gradient(135deg, var(--pb-primary-soft) 0%, transparent 100%), var(--pb-surface);
}
.cta-text { flex: 1; min-width: 240px; }
.cta-icon { color: var(--pb-primary); font-size: 16px; }

/* Footer */
.pub-foot { padding: 20px 24px; border-top: 1px solid var(--pb-border-soft); }
.pub-foot-inner { max-width: 1232px; margin: 0 auto; font-size: 12.5px; color: var(--pb-text-3); }
.pub-foot a { color: var(--pb-text-2); }
.pub-foot a:hover { color: var(--pb-primary); }
.pub-foot .foot-strong { font-weight: 600; color: var(--pb-text); }

@media (max-width: 767px) {
  .pub-shell { padding: 20px 16px 40px; gap: 16px; }
  .page-title { font-size: 24px !important; }
  .page-sub { font-size: 13.5px; }
  .pub-foot { padding: 18px 16px; }
  .pub-foot-inner { flex-direction: column; align-items: flex-start !important; }
}
</style>
