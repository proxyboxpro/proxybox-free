<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Box, Copy, Check, ArrowRight, KeyRound, Globe, ChevronRight } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import PublicTopNav from '../components/PublicTopNav.vue'

const route = useRoute()
const { t, locale, setLocale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const baseUrl = computed(() => typeof location !== 'undefined' ? location.origin : 'https://proxybox.pro')

const copied = ref('')
async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { copied.value = '' }, 1500)
  } catch (e) { /* ignore */ }
}

const groups = computed(() => ([
  {
    id: 'overview',
    title: locale.value === 'vi' ? 'Tổng quan' : 'Overview',
    body: locale.value === 'vi'
      ? 'REST API JSON. Base URL là domain panel của bạn (vd https://proxybox.pro). Auth qua header X-Customer-Key (API key dài hạn) hoặc Bearer token (phiên login).'
      : 'REST + JSON API. Base URL is your panel domain (e.g. https://proxybox.pro). Authenticate with either X-Customer-Key (long-lived API key) or a Bearer token (session).'
  },
  {
    id: 'auth',
    title: locale.value === 'vi' ? 'Xác thực' : 'Authentication',
    endpoints: [
      {
        method: 'POST', path: '/api/auth/login', auth: 'none',
        desc: locale.value === 'vi' ? 'Login bằng email + password, nhận Bearer token (hết hạn sau 7 ngày).' : 'Sign in with email + password to receive a Bearer token (7-day expiry).',
        request: `{
  "email": "you@example.com",
  "password": "your-password",
  "totp": "123456"
}`,
        response: `{
  "token": "eyJhbGc...",
  "user": { "id": "u_abc", "email": "you@example.com", "role": "user" }
}`
      },
      {
        method: 'POST', path: '/api/auth/register', auth: 'none',
        desc: locale.value === 'vi' ? 'Tạo tài khoản mới. Trả về token để gọi API ngay.' : 'Create a new account. Returns a Bearer token so you can call the API immediately.',
        request: `{ "email": "you@example.com", "password": "min-12-chars" }`,
        response: `{ "token": "eyJhbGc...", "user": { "id": "u_abc", "email": "..." } }`
      }
    ]
  },
  {
    id: 'account',
    title: locale.value === 'vi' ? 'Tài khoản' : 'Account',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/user/account', auth: 'key',
        desc: locale.value === 'vi' ? 'Profile + API key + wallet balance.' : 'Profile, API key, and wallet balance.',
        response: `{
  "id": "u_abc",
  "email": "you@example.com",
  "name": "You",
  "apiKey": "pk_live_...",
  "wallet": { "balance": 125000, "currency": "VND" },
  "createdAt": "2026-01-01T00:00:00Z"
}`
      },
      {
        method: 'POST', path: '/api/v1/user/api-key/rotate', auth: 'bearer',
        desc: locale.value === 'vi' ? 'Tạo API key mới (key cũ bị thu hồi ngay).' : 'Rotate the API key (the previous key is revoked immediately).',
        response: `{ "apiKey": "pk_live_..." }`
      }
    ]
  },
  {
    id: 'orders',
    title: locale.value === 'vi' ? 'Đơn hàng' : 'Orders',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/user/orders', auth: 'key',
        desc: locale.value === 'vi' ? 'Liệt kê đơn hàng đã đặt.' : 'List all orders placed by this account.',
        response: `[
  {
    "id": "ord_2026_001",
    "kind": "ipv6",
    "zone": "vn-hcm",
    "quantity": 10,
    "status": "active",
    "expiresAt": "2026-06-01T00:00:00Z"
  }
]`
      },
      {
        method: 'POST', path: '/api/v1/user/orders', auth: 'key',
        desc: locale.value === 'vi' ? 'Đặt đơn proxy mới. Trừ ví ngay nếu đủ số dư.' : 'Place a new proxy order — wallet is debited if balance is sufficient.',
        request: `{
  "kind": "ipv6",
  "zone": "vn-hcm",
  "quantity": 10,
  "durationDays": 30,
  "autoRenew": true
}`,
        response: `{
  "id": "ord_2026_002",
  "status": "active",
  "proxies": [
    { "id": "px_..", "host": "1.2.3.4", "port": 20100, "username": "u_..", "password": ".." }
  ]
}`
      }
    ]
  },
  {
    id: 'proxies',
    title: locale.value === 'vi' ? 'Proxy' : 'Proxies',
    endpoints: [
      {
        method: 'GET', path: '/api/v1/user/proxies', auth: 'key',
        desc: locale.value === 'vi' ? 'Danh sách proxy đang hoạt động. Mật khẩu bị che — gọi /credentials để xem.' : 'List active proxies. Passwords are redacted — call /credentials to reveal them.',
        response: `[
  {
    "id": "px_1234",
    "host": "1.2.3.4",
    "port": 20100,
    "protocol": "http,socks5,trojan",
    "username": "u_1234",
    "status": "active",
    "expiresAt": "2026-06-01T00:00:00Z"
  }
]`
      },
      {
        method: 'GET', path: '/api/v1/user/proxies/:id/credentials', auth: 'key',
        desc: locale.value === 'vi' ? 'Lấy full username + password (sensitive).' : 'Fetch the full username and password (sensitive).',
        response: `{ "username": "u_1234", "password": "x9k..." }`
      },
      {
        method: 'POST', path: '/api/v1/user/proxies/:id/rotate', auth: 'key',
        desc: locale.value === 'vi' ? 'Đổi user + pass + egress IP (đếm vào quota rotation).' : 'Rotate username + password + egress IP (counts against rotation quota).',
        response: `{ "ok": true, "username": "u_new", "password": "..." }`
      }
    ]
  },
  {
    id: 'webhook',
    title: locale.value === 'vi' ? 'Webhook' : 'Webhooks',
    body: locale.value === 'vi'
      ? 'Đăng ký webhook URL trong /account để nhận event: order.created, order.expiring, order.expired, proxy.created, wallet.charge. Payload là JSON, signed với HMAC-SHA256.'
      : 'Register your webhook URL in /account to receive events: order.created, order.expiring, order.expired, proxy.created, wallet.charge. Payload is JSON, signed with HMAC-SHA256.',
    endpoints: [
      {
        method: 'POST', path: '<your-callback-url>', auth: 'signed',
        desc: locale.value === 'vi' ? 'Payload ProxyBox gửi đến callback URL của bạn.' : 'Payload ProxyBox sends to your callback URL.',
        request: `Headers:
  X-ProxyBox-Event: order.expired
  X-ProxyBox-Signature: sha256=<hex>

Body:
{
  "event": "order.expired",
  "orderId": "ord_2026_001",
  "userId": "u_abc",
  "occurredAt": "2026-06-01T00:00:00Z"
}`
      }
    ]
  }
]))

function methodClass(m) {
  return { GET: 'm-get', POST: 'm-post', PUT: 'm-put', PATCH: 'm-patch', DELETE: 'm-del' }[m] || 'm-get'
}
function authBadge(a) {
  return {
    none:   { label: locale.value === 'vi' ? 'Public' : 'Public',          cls: 'b-none' },
    key:    { label: locale.value === 'vi' ? 'API key' : 'API key',         cls: 'b-key'  },
    bearer: { label: 'Bearer',                                              cls: 'b-bearer'},
    signed: { label: 'HMAC',                                                cls: 'b-bearer'}
  }[a] || { label: 'Auth', cls: 'b-key' }
}

onMounted(() => {
  if (route.hash) {
    setTimeout(() => {
      const el = document.querySelector(route.hash)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }
})
</script>

<template>
  <div class="apidocs">
    <PublicTopNav sub-label="API" />

    <div class="apidocs-shell">
      <aside class="apidocs-sidebar">
        <h4>{{ locale === 'vi' ? 'Tài liệu API' : 'API reference' }}</h4>
        <a v-for="g in groups" :key="g.id" :href="'#' + g.id" :class="{ active: route.hash === '#' + g.id }">
          {{ g.title }}
          <ChevronRight :size="12" />
        </a>
        <div class="apidocs-sidebar-foot">
          <RouterLink to="/faq#self-host-panel" class="side-cta">
            <span>{{ locale === 'vi' ? 'Tự host trên VPS của bạn' : 'Self-host on your own VPS' }}</span>
            <ArrowRight :size="14" />
          </RouterLink>
        </div>
      </aside>

      <main class="apidocs-content">
        <div class="apidocs-hero">
          <span class="hero-eyebrow">{{ locale === 'vi' ? 'API công khai · phiên bản v1' : 'Public API · v1' }}</span>
          <h1>{{ locale === 'vi' ? 'ProxyBox REST API' : 'ProxyBox REST API' }}</h1>
          <p>{{ locale === 'vi'
              ? 'Mọi thao tác trên ProxyBox (đặt đơn, lấy credentials, rotate proxy, đăng ký webhook) đều có sẵn API. Tự động hóa quy trình từ pipeline của bạn.'
              : 'Every action in ProxyBox — placing orders, fetching credentials, rotating proxies, subscribing to webhooks — is exposed via REST. Wire it straight into your own pipelines.' }}</p>

          <div class="apidocs-meta">
            <div class="meta-row">
              <span class="meta-label">Base URL</span>
              <code class="meta-code">{{ baseUrl }}</code>
              <button class="copy-mini" @click="copy(baseUrl, 'base')">
                <component :is="copied === 'base' ? Check : Copy" :size="13" />
              </button>
            </div>
            <div class="meta-row">
              <span class="meta-label"><KeyRound :size="13" /> X-Customer-Key</span>
              <code class="meta-code">{{ locale === 'vi' ? 'Lấy ở /account sau khi đăng nhập' : 'Find it on /account after sign-in' }}</code>
            </div>
            <div class="meta-row">
              <span class="meta-label"><Globe :size="13" /> Content-Type</span>
              <code class="meta-code">application/json</code>
            </div>
          </div>

          <pre class="curl-example"><code><span class="prompt">$</span> curl -H "X-Customer-Key: $PROXYBOX_KEY" \
    {{ baseUrl }}/api/v1/user/account</code></pre>
        </div>

        <section v-for="g in groups" :key="g.id" :id="g.id" class="apidocs-section">
          <h2>{{ g.title }}</h2>
          <p v-if="g.body" class="section-body">{{ g.body }}</p>
          <div v-for="(e, i) in g.endpoints || []" :key="i" class="endpoint">
            <div class="endpoint-head">
              <span :class="['method', methodClass(e.method)]">{{ e.method }}</span>
              <code class="endpoint-path">{{ e.path }}</code>
              <span :class="['auth-badge', authBadge(e.auth).cls]">{{ authBadge(e.auth).label }}</span>
            </div>
            <p class="endpoint-desc">{{ e.desc }}</p>
            <div v-if="e.request" class="codepanel">
              <div class="codepanel-head">
                <span>{{ locale === 'vi' ? 'Request' : 'Request' }}</span>
                <button class="copy-mini" @click="copy(e.request, g.id + i + 'r')">
                  <component :is="copied === g.id + i + 'r' ? Check : Copy" :size="13" />
                </button>
              </div>
              <pre><code>{{ e.request }}</code></pre>
            </div>
            <div v-if="e.response" class="codepanel">
              <div class="codepanel-head">
                <span>{{ locale === 'vi' ? 'Response' : 'Response' }} · 200 OK</span>
                <button class="copy-mini" @click="copy(e.response, g.id + i + 'res')">
                  <component :is="copied === g.id + i + 'res' ? Check : Copy" :size="13" />
                </button>
              </div>
              <pre><code>{{ e.response }}</code></pre>
            </div>
          </div>
        </section>

        <section class="apidocs-cta">
          <h3>{{ locale === 'vi' ? 'Sẵn sàng tích hợp?' : 'Ready to integrate?' }}</h3>
          <p>{{ locale === 'vi'
              ? 'Đăng ký tài khoản để lấy API key + interactive playground. Đã có tài khoản? Login để mở console "Try it" ngay trong trình duyệt.'
              : 'Register to receive an API key + the interactive playground. Already have an account? Sign in to open the in-browser "Try it" console.' }}</p>
          <div class="cta-row">
            <RouterLink class="btn primary" to="/register">{{ t('landing.nav.register') }} <ArrowRight :size="14" /></RouterLink>
            <RouterLink class="btn ghost" to="/login">{{ t('landing.nav.login') }}</RouterLink>
          </div>
        </section>

        <footer class="apidocs-foot">
          <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
          <span class="foot-onie">
            {{ t('landing.foot.publishedBy') }}
            <a href="https://onie.net" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
            · <a href="https://onie.net" target="_blank" rel="noopener">onie.net</a>
          </span>
          <span>
            <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
            ·
            <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
            ·
            <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
          </span>
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.apidocs {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.apidocs * { box-sizing: border-box; }
.apidocs a { color: inherit; text-decoration: none; }

/* ── Top nav (mirror landing) ── */
.landing-nav {
  display: flex;
  align-items: center;
  gap: 24px;
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
  color: var(--text); cursor: pointer; transition: 0.15s; white-space: nowrap;
}
.btn:hover { background: var(--surface); border-color: var(--blue); }
.btn.primary { background: linear-gradient(135deg, #58a6ff, #2f81f7); border-color: transparent; color: #0a0e14; }
.btn.ghost { background: transparent; }

/* ── Gitbook-style 2-column shell ── */
.apidocs-shell {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  max-width: 1280px;
  margin: 0 auto;
}
.apidocs-sidebar {
  position: sticky; top: 64px;
  align-self: start;
  height: calc(100vh - 64px); overflow-y: auto;
  padding: 28px 18px 28px 24px;
  border-right: 1px solid var(--border-soft);
}
.apidocs-sidebar h4 {
  margin: 0 0 14px;
  font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
  color: var(--dim);
}
.apidocs-sidebar a {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 6px;
  color: var(--text); font-size: 14px; margin-bottom: 2px;
}
.apidocs-sidebar a:hover { background: var(--surface-2); }
.apidocs-sidebar a.active { background: var(--blue-soft); color: var(--blue); }
.apidocs-sidebar-foot { margin-top: 24px; border-top: 1px solid var(--border-soft); padding-top: 16px; }
.side-cta {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface);
  font-size: 13px; color: var(--text) !important;
}
.side-cta:hover { border-color: var(--blue); }

.apidocs-content { padding: 32px 32px 80px; min-width: 0; }

/* Hero */
.apidocs-hero { margin-bottom: 40px; }
.hero-eyebrow {
  display: inline-block; padding: 4px 10px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  border: 1px solid var(--border); border-radius: 999px;
  color: var(--green); background: var(--green-soft);
  margin-bottom: 16px;
}
.apidocs-hero h1 { margin: 0 0 12px; font-size: 36px; font-weight: 700; letter-spacing: -0.5px; }
.apidocs-hero p { margin: 0 0 24px; color: var(--dim); font-size: 15px; line-height: 1.6; max-width: 680px; }
.apidocs-meta {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 6px 14px; margin-bottom: 18px;
}
.meta-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 0; border-bottom: 1px solid var(--border-soft);
  font-size: 13px;
}
.meta-row:last-child { border-bottom: 0; }
.meta-label {
  color: var(--dim); display: inline-flex; align-items: center; gap: 4px;
  min-width: 130px; font-weight: 500;
}
.meta-code {
  flex: 1; min-width: 0;
  background: var(--surface-2); border: 1px solid var(--border-soft);
  padding: 4px 8px; border-radius: 4px;
  font-family: var(--mono); font-size: 12px; color: var(--text);
  overflow-x: auto; white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}
.copy-mini {
  border: 1px solid var(--border); background: var(--surface);
  color: var(--dim); padding: 4px 6px; border-radius: 4px;
  cursor: pointer; display: inline-flex; align-items: center;
}
.copy-mini:hover { color: var(--text); }
.curl-example {
  margin: 0; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; overflow-x: auto;
  font-family: var(--mono); font-size: 13px; line-height: 1.55;
  color: var(--text);
}
.curl-example .prompt { color: var(--green); margin-right: 6px; }

/* Sections */
.apidocs-section { margin-bottom: 48px; }
.apidocs-section h2 {
  margin: 0 0 12px; font-size: 22px; font-weight: 700;
  border-bottom: 1px solid var(--border-soft); padding-bottom: 8px;
}
.section-body { margin: 0 0 18px; color: var(--dim); font-size: 14px; line-height: 1.6; }

/* Endpoint card */
.endpoint {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; margin-bottom: 14px;
}
.endpoint-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.method {
  font-family: var(--mono); font-size: 11px; font-weight: 700;
  padding: 3px 8px; border-radius: 4px;
  letter-spacing: 0.5px;
}
.m-get  { background: var(--blue-soft);  color: var(--blue); }
.m-post { background: var(--green-soft); color: var(--green); }
.m-put,
.m-patch { background: var(--yellow-soft); color: var(--yellow); }
.m-del  { background: var(--red-soft);   color: var(--red); }
.endpoint-path {
  font-family: var(--mono); font-size: 13px; color: var(--text);
  background: var(--surface-2); border: 1px solid var(--border-soft);
  padding: 3px 8px; border-radius: 4px;
  min-width: 0; max-width: 100%;
  overflow-wrap: anywhere; word-break: break-word;
}
.auth-badge {
  font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px;
}
.b-none   { background: transparent; color: var(--dim); border: 1px solid var(--border); }
.b-key    { background: var(--blue-soft);   color: var(--blue); }
.b-bearer { background: var(--yellow-soft); color: var(--yellow); }
.endpoint-desc { margin: 0 0 12px; color: var(--dim); font-size: 13px; line-height: 1.6; }

.codepanel {
  background: var(--bg); border: 1px solid var(--border-soft);
  border-radius: 8px; overflow: hidden; margin-bottom: 8px;
}
.codepanel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; background: var(--surface-2);
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px; color: var(--dim); letter-spacing: 0.4px;
  text-transform: uppercase; font-weight: 600;
}
.codepanel pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.codepanel code {
  font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
  color: var(--text); white-space: pre;
}

.apidocs-cta {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 24px; margin: 32px 0;
}
.apidocs-cta h3 { margin: 0 0 8px; font-size: 18px; }
.apidocs-cta p { margin: 0 0 16px; color: var(--dim); font-size: 14px; line-height: 1.55; max-width: 540px; }
.cta-row { display: flex; gap: 10px; flex-wrap: wrap; }

.apidocs-foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24px 0 0; border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 12px; gap: 12px; flex-wrap: wrap;
}
.foot-onie a { color: var(--text); text-decoration: none; font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* ── Tablet ── */
@media (max-width: 980px) {
  .apidocs-shell { grid-template-columns: 1fr; }
  .apidocs-sidebar {
    position: relative; top: 0;
    height: auto; max-height: 280px;
    border-right: 0; border-bottom: 1px solid var(--border-soft);
    padding: 16px 20px;
  }
  .apidocs-sidebar h4 { margin-bottom: 8px; }
  .apidocs-content { padding: 28px 20px 60px; }
  .landing-nav { padding: 12px 16px; gap: 12px; }
  .landing-nav-links { display: none; }
  .desktop-only { display: none; }
}
/* ── Phone ── */
@media (max-width: 640px) {
  .landing-nav { padding: 10px 14px; gap: 8px; }
  .landing-brand strong { font-size: 15px; }
  .landing-brand .brand-sub { display: none; }
  .theme-btn { display: none; }
  .lang-toggle button { padding: 5px 8px; font-size: 11px; }
  .btn { padding: 7px 12px; font-size: 12px; }

  .apidocs-sidebar { max-height: 200px; padding: 12px 14px; }
  .apidocs-sidebar a { padding: 6px 8px; font-size: 13px; }
  .apidocs-content { padding: 22px 14px 50px; }
  .apidocs-hero h1 { font-size: 24px; }
  .apidocs-hero p { font-size: 14px; }
  .apidocs-meta { padding: 4px 12px; }
  .meta-row { gap: 8px; padding: 8px 0; flex-wrap: wrap; }
  .meta-label { min-width: auto; flex-basis: 100%; margin-bottom: 2px; font-size: 12px; }
  .meta-code { width: 100%; flex: none; font-size: 11.5px; }
  .copy-mini { padding: 3px 6px; }
  .curl-example { padding: 12px; font-size: 11.5px; }
  .endpoint { padding: 14px; }
  .endpoint-head { gap: 8px; }
  .endpoint-path { font-size: 12px; max-width: 100%; }
  .codepanel pre { padding: 12px; }
  .codepanel code { font-size: 11px; }
  .codepanel-head { padding: 5px 10px; font-size: 10.5px; }
  .apidocs-cta { padding: 18px; }
  .apidocs-cta h3 { font-size: 16px; }
  .codepanel code { font-size: 11.5px; }
  .apidocs-foot { flex-direction: column; align-items: flex-start; }
}
</style>
