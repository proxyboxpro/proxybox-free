<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowRight, Book, ChevronRight, Copy, Check, Gauge, KeyRound, Lock,
  Play, Send, ShoppingCart, Terminal, Wrench, Zap, Bell, ExternalLink
} from 'lucide-vue-next'
import PublicTopNav from '../components/PublicTopNav.vue'
import { useI18n } from '../i18n'
import { token } from '../api'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

const baseUrl = computed(() => typeof location !== 'undefined' ? location.origin : 'https://proxybox.pro')
const apiKey = '••••••••••••••••••••••••••••••••'
const reveal = ref(false)

const flash = ref('')
function copy(text) {
  navigator.clipboard?.writeText(text)
  flash.value = locale.value === 'vi' ? 'Đã copy!' : 'Copied!'
  setTimeout(() => { flash.value = '' }, 1500)
}
function signInToReveal() {
  router.push({ name: 'login', query: { next: '/api-docs' } })
}

// Endpoint groups — mirror customer API docs structure.
const groups = computed(() => ([
  {
    id: 'flow', title: 'Quick start', icon: Zap,
    intro: locale.value === 'vi'
      ? 'Luồng end-to-end để mua, dùng, và quản lý proxy qua API. Tất cả request đều cần header `X-Customer-Key: <api-key>` (lấy ở thẻ phía trên).'
      : 'End-to-end flow to buy, use and manage proxies via API. Every request needs an `X-Customer-Key: <api-key>` header (get yours in the card above).',
    flow: [
      { step: 1,
        title: locale.value === 'vi' ? 'Nạp tiền + check số dư' : 'Top up wallet + check balance',
        detail: locale.value === 'vi'
          ? 'GET /api/v1/user/billing — kiểm tra wallet trước khi tạo đơn.'
          : 'GET /api/v1/user/billing — check the wallet balance before placing an order.' },
      { step: 2,
        title: locale.value === 'vi' ? 'Tạo đơn (mua proxy)' : 'Place an order (buy proxies)',
        detail: locale.value === 'vi'
          ? 'POST /api/v1/user/orders với `type`, `quantity`, `hours`, `zone`. Server tự cấp N proxy + trả về danh sách credentials.'
          : 'POST /api/v1/user/orders with `type`, `quantity`, `hours`, `zone`. The server provisions N proxies and returns the credentials.' },
      { step: 3,
        title: locale.value === 'vi' ? 'Lấy danh sách proxy' : 'List proxies',
        detail: locale.value === 'vi'
          ? 'GET /api/v1/user/proxies — trả về tất cả proxy bạn sở hữu, mỗi cái có `orderId` để gom nhóm.'
          : 'GET /api/v1/user/proxies — returns every proxy you own; each one has an `orderId` for grouping.' },
      { step: 4,
        title: locale.value === 'vi' ? 'Sử dụng proxy' : 'Use the proxy',
        detail: locale.value === 'vi'
          ? 'Connect tới `bindIp:port` với `username:password` (HTTP CONNECT hoặc SOCKS5). Hoặc thêm IP của bạn vào whitelist để bỏ qua auth.'
          : 'Connect to `bindIp:port` with `username:password` (HTTP CONNECT or SOCKS5). Or whitelist your IP to skip auth.' },
      { step: 5,
        title: locale.value === 'vi' ? 'Quản lý proxy' : 'Manage proxies',
        detail: locale.value === 'vi'
          ? 'Check live (bulk), gia hạn (extend), xoá (DELETE), whitelist IP, xoay IPv6, xem SLA + lịch sử băng thông.'
          : 'Bulk health check, extend, DELETE, whitelist IP, rotate IPv6, view SLA and bandwidth history.' }
    ],
    endpoints: []
  },
  {
    id: 'auth', title: 'Authentication', icon: Lock,
    intro: locale.value === 'vi'
      ? 'API key (header `X-Customer-Key`) hoặc Bearer token sau khi login. API key dùng cho automation. Bearer token dùng cho session đăng nhập tương tác.'
      : 'API key (`X-Customer-Key` header) or a Bearer token after sign-in. API key for automation; Bearer for interactive sessions.',
    endpoints: [
      { method: 'POST', path: '/api/v1/user/auth/login',
        desc: locale.value === 'vi' ? 'Đăng nhập, trả về Bearer token (TTL 7 ngày).' : 'Sign in; returns a Bearer token (7-day TTL).',
        request: '{\n  "email": "you@example.com",\n  "password": "secret"\n}',
        response: '{\n  "token": "abc123...",\n  "user": { "email": "you@example.com", "role": "customer" }\n}' },
      { method: 'GET', path: '/api/v1/user/auth/me',
        desc: locale.value === 'vi' ? 'Thông tin user hiện tại.' : 'Current user info.',
        response: '{ "id": "u-...", "email": "...", "role": "customer", "emailVerified": true }' },
      { method: 'GET', path: '/api/v1/user/account',
        desc: locale.value === 'vi' ? 'Profile + balance + API key.' : 'Profile + balance + API key.',
        response: '{ "id": "u-...", "name": "...", "balance": 150000, "apiKey": "abc..." }' }
    ]
  },
  {
    id: 'orders', title: locale.value === 'vi' ? 'Mua proxy (Orders)' : 'Buy proxies (Orders)', icon: ShoppingCart,
    intro: locale.value === 'vi'
      ? 'Tạo đơn, xem đơn đã đặt, hủy đơn. Mỗi đơn cấp N proxy. Credentials trả ngay trong response.'
      : 'Place orders, list past orders, cancel. Each order issues N proxies; credentials are returned in the response.',
    endpoints: [
      { method: 'POST', path: '/api/v1/user/orders',
        desc: locale.value === 'vi' ? 'Tạo đơn mua proxy.' : 'Place a new proxy order.',
        request: '{\n  "type": "ipv6",\n  "quantity": 5,\n  "hours": 24,\n  "zone": "vn-hcm",\n  "autoRenew": true\n}',
        response: '{\n  "order": { "id": "ord_...", "status": "active" },\n  "proxies": [{ "id": "px_..", "host": "1.2.3.4", "port": 20100, "username": "u_..", "password": ".." }]\n}' },
      { method: 'GET', path: '/api/v1/user/orders',
        desc: locale.value === 'vi' ? 'Liệt kê đơn hàng.' : 'List orders.',
        response: '[{ "id": "ord_...", "kind": "ipv6", "status": "active", "expiresAt": "..." }]' },
      { method: 'DELETE', path: '/api/v1/user/orders/:id',
        desc: locale.value === 'vi' ? 'Hủy đơn (refund phần chưa dùng nếu còn).' : 'Cancel an order (refund unused portion when applicable).',
        response: '{ "ok": true, "refund": 5000 }' }
    ]
  },
  {
    id: 'proxies', title: locale.value === 'vi' ? 'Quản lý proxy' : 'Manage proxies', icon: Wrench,
    intro: locale.value === 'vi'
      ? 'Listing, credentials, rotate, extend, whitelist IP, bulk live-check.'
      : 'Listing, credentials, rotation, extension, IP whitelist, bulk live-check.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/proxies',
        desc: locale.value === 'vi' ? 'Liệt kê tất cả proxy. Password che — gọi /credentials để lộ.' : 'List every proxy. Passwords are redacted — call /credentials to reveal.',
        response: '[{ "id": "px_1234", "host": "1.2.3.4", "port": 20100, "username": "u_..", "status": "active" }]' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/credentials',
        desc: locale.value === 'vi' ? 'Lộ full user + pass (sensitive).' : 'Reveal the full username + password (sensitive).',
        response: '{ "username": "u_1234", "password": "x9k..." }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/rotate',
        desc: locale.value === 'vi' ? 'Đổi user + pass + egress IP (đếm vào quota).' : 'Rotate user + pass + egress IP (counted against quota).',
        response: '{ "ok": true, "username": "u_new", "password": "..." }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/extend',
        desc: locale.value === 'vi' ? 'Gia hạn thêm N giờ.' : 'Extend by N hours.',
        request: '{ "hours": 24 }',
        response: '{ "ok": true, "expiresAt": "2026-06-01T00:00:00Z" }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/whitelist',
        desc: locale.value === 'vi' ? 'Thêm IP vào whitelist (bỏ qua user-pass auth).' : 'Add an IP to the whitelist (bypass user-pass auth).',
        request: '{ "ips": ["203.0.113.7"] }',
        response: '{ "ok": true, "whitelist": ["203.0.113.7"] }' },
      { method: 'DELETE', path: '/api/v1/user/proxies/:id',
        desc: locale.value === 'vi' ? 'Xoá proxy (refund nếu còn hạn).' : 'Delete a proxy (refund when applicable).',
        response: '{ "ok": true }' }
    ]
  },
  {
    id: 'billing', title: 'Billing', icon: Gauge,
    intro: locale.value === 'vi'
      ? 'Wallet balance, transactions, topup qua Stripe / PayPal.'
      : 'Wallet balance, transactions, top-up via Stripe / PayPal.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/billing',
        desc: locale.value === 'vi' ? 'Wallet hiện tại + payment methods active.' : 'Current wallet + active payment methods.',
        response: '{ "wallet": { "balance": 150000, "currency": "VND" }, "paymentMethods": { "stripeEnabled": true, "paypalEnabled": true } }' },
      { method: 'POST', path: '/api/v1/user/billing/checkout',
        desc: locale.value === 'vi' ? 'Tạo Stripe Checkout Session, trả URL.' : 'Create a Stripe Checkout Session; returns the URL.',
        request: '{ "amount": 100000 }',
        response: '{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }' },
      { method: 'POST', path: '/api/v1/user/billing/paypal/create-order',
        desc: locale.value === 'vi' ? 'Tạo PayPal order, redirect tới approveUrl.' : 'Create a PayPal order; redirect to approveUrl.',
        request: '{ "amount": 10 }',
        response: '{ "orderId": "...", "approveUrl": "https://paypal.com/..." }' }
    ]
  },
  {
    id: 'notifications', title: 'Notifications', icon: Bell,
    intro: locale.value === 'vi'
      ? 'In-app notifications cho event: đơn cấp xong, sắp hết hạn, ví thấp.'
      : 'In-app notifications for events: order ready, expiring, low balance.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/notifications',
        desc: locale.value === 'vi' ? 'Danh sách notification.' : 'Notifications list.',
        response: '{ "items": [...], "unread": 3 }' },
      { method: 'POST', path: '/api/v1/user/notifications/:id/read',
        desc: locale.value === 'vi' ? 'Đánh dấu đã đọc.' : 'Mark as read.',
        response: '{ "ok": true }' }
    ]
  }
]))

const activeGroup = ref('flow')

function methodClass(m) {
  return { GET: 'm-get', POST: 'm-post', PATCH: 'm-patch', PUT: 'm-patch', DELETE: 'm-delete' }[m] || 'm-get'
}
function curlSample(method, path, body) {
  const url = `${baseUrl.value}${path}`
  const headers = [`-H "X-Customer-Key: YOUR_API_KEY"`]
  if (body) headers.push('-H "Content-Type: application/json"')
  const dataFlag = body ? ` \\\n  -d '${body.replace(/\n/g, '').replace(/\s+/g, ' ')}'` : ''
  return `curl -X ${method} ${url} \\\n  ${headers.join(' \\\n  ')}${dataFlag}`
}

onMounted(() => {
  if (route.hash) {
    const id = route.hash.slice(1)
    if (groups.value.some((g) => g.id === id)) activeGroup.value = id
  }
})
</script>

<template>
  <div class="apidocs-page">
    <PublicTopNav sub-label="API" />

    <section class="apidocs">
      <header class="apidocs-head">
        <p class="eyebrow"><Book :size="12" /> {{ locale === 'vi' ? 'Developer' : 'Developer' }}</p>
        <h1>API Documentation</h1>
        <p class="sub">{{ locale === 'vi'
            ? 'Endpoint reference cho customer API. Dùng header `X-Customer-Key` hoặc Bearer token.'
            : 'Endpoint reference for the customer API. Use the `X-Customer-Key` header or Bearer token.' }}</p>
      </header>

      <p v-if="flash" class="flash">{{ flash }}</p>

      <!-- Token card (public version: show locked state with sign-in CTA) -->
      <section class="key-card">
        <div class="key-left">
          <span class="ico"><KeyRound :size="18" /></span>
          <div>
            <strong>
              {{ locale === 'vi' ? 'Token cá nhân' : 'Personal token' }}
              <small class="badge">{{ locale === 'vi' ? 'duy nhất · tất cả trong một' : 'one token · all uses' }}</small>
            </strong>
            <p class="muted">
              {{ locale === 'vi' ? 'Dùng' : 'Use the' }}
              <strong style="color: var(--green)">{{ locale === 'vi' ? 'cùng 1 giá trị' : 'same value' }}</strong>
              {{ locale === 'vi' ? 'cho REST API' : 'across the REST API' }}
              (<code>X-Customer-Key</code>),
              SDK (<code>Authorization: Bearer</code>)
              {{ locale === 'vi' ? 'và cài agent BYON. Tự tạo khi đăng ký, rotate bất cứ lúc nào.' : 'and BYON agent installs. Auto-minted on signup, rotate any time.' }}
            </p>
          </div>
        </div>
        <div class="key-right">
          <code class="key-val blurred">{{ apiKey }}</code>
          <button type="button" class="ghost-button" @click="signInToReveal">
            {{ locale === 'vi' ? 'Đăng nhập để hiện' : 'Sign in to reveal' }}
          </button>
        </div>
      </section>

      <!-- Endpoint groups -->
      <div class="docs-layout">
        <nav class="docs-nav">
          <h4>{{ locale === 'vi' ? 'Endpoints' : 'Endpoints' }}</h4>
          <button v-for="g in groups" :key="g.id"
            type="button"
            :class="{ active: activeGroup === g.id }"
            @click="activeGroup = g.id">
            <component :is="g.icon" :size="14" />
            <span>{{ g.title }}</span>
            <span v-if="g.endpoints?.length" class="count">{{ g.endpoints.length }}</span>
            <span v-else-if="g.flow?.length" class="count count-green">{{ g.flow.length }}</span>
          </button>
        </nav>

        <div class="docs-body">
          <template v-for="g in groups" :key="g.id">
            <article v-if="activeGroup === g.id">
              <h2>{{ g.title }}</h2>
              <p class="muted">{{ g.intro }}</p>

              <!-- Quick-start flow -->
              <ol v-if="g.flow?.length" class="flow-steps">
                <li v-for="f in g.flow" :key="f.step" class="flow-step">
                  <span class="flow-num">{{ f.step }}</span>
                  <div>
                    <strong>{{ f.title }}</strong>
                    <p class="muted" style="margin: 2px 0 0">{{ f.detail }}</p>
                  </div>
                </li>
              </ol>

              <div v-for="(e, i) in g.endpoints" :key="i" class="endpoint">
                <div class="ep-head">
                  <span :class="['method', methodClass(e.method)]">{{ e.method }}</span>
                  <code class="path">{{ e.path }}</code>
                  <button type="button" class="ghost-button mini" @click="copy(`${baseUrl}${e.path}`)" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'">
                    <Copy :size="11" />
                  </button>
                  <button type="button" class="ghost-button mini try-btn" @click="signInToReveal">
                    <Play :size="11" /> {{ locale === 'vi' ? 'Đăng nhập để Try it' : 'Sign in to Try it' }}
                  </button>
                </div>
                <p class="ep-desc">{{ e.desc }}</p>

                <div class="ep-blocks" v-if="e.request || e.response">
                  <div v-if="e.request" class="code-block">
                    <header><Terminal :size="12" /> Request body</header>
                    <pre>{{ e.request }}</pre>
                  </div>
                  <div v-if="e.response" class="code-block">
                    <header><ArrowRight :size="12" /> Response</header>
                    <pre>{{ e.response }}</pre>
                  </div>
                </div>

                <div class="code-block curl">
                  <header>
                    <Terminal :size="12" /> cURL
                    <button type="button" class="ghost-button mini" style="margin-left: auto" @click="copy(curlSample(e.method, e.path, e.request))" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'">
                      <Copy :size="11" />
                    </button>
                  </header>
                  <pre>{{ curlSample(e.method, e.path, e.request) }}</pre>
                </div>
              </div>

              <!-- CTA at end of group -->
              <div class="docs-cta">
                <span><Zap :size="14" /> {{ locale === 'vi' ? 'Sẵn sàng tích hợp? Đăng nhập để mở console Try it ngay trong trình duyệt.' : 'Ready to integrate? Sign in to open the in-browser Try it console.' }}</span>
                <div class="cta-actions">
                  <RouterLink class="btn primary" to="/register">
                    {{ locale === 'vi' ? 'Đăng ký' : 'Get started' }} <ArrowRight :size="14" />
                  </RouterLink>
                  <RouterLink class="btn ghost" to="/login">
                    {{ locale === 'vi' ? 'Đăng nhập' : 'Sign in' }}
                  </RouterLink>
                </div>
              </div>
            </article>
          </template>
        </div>
      </div>

      <footer class="apidocs-foot">
        <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
        <span class="foot-onie">
          {{ t('landing.foot.publishedBy') }}
          <a href="https://proxybox.pro" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
        </span>
        <span>
          <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
          <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink> ·
          <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
        </span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.apidocs-page {
  min-height: 100vh;
  background:
    radial-gradient(900px 500px at 90% -10%, rgba(88,166,255,0.06), transparent 65%),
    radial-gradient(700px 400px at -5% 30%, rgba(63,185,80,0.05), transparent 65%),
    var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.apidocs-page * { box-sizing: border-box; }
.apidocs-page a { color: inherit; text-decoration: none; }

.apidocs {
  max-width: 1280px; margin: 0 auto;
  padding: 28px 28px 60px;
  display: flex; flex-direction: column; gap: 22px;
}

.apidocs-head .eyebrow {
  color: var(--green); font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 5px;
  margin: 0 0 4px;
}
.apidocs-head h1 {
  margin: 0; font-size: 30px; font-weight: 800;
  letter-spacing: -0.4px;
}
.apidocs-head .sub {
  margin: 6px 0 0; color: var(--dim); font-size: 14px;
  max-width: 720px; line-height: 1.55;
}

.flash { color: var(--green); font-size: 13px; margin: 0; }

/* Token card */
.key-card {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 14px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--green-soft) 50%, transparent) 0%, transparent 60%), var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 20px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent) inset;
}
.key-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 280px; }
.key-left .ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: var(--green-soft); color: var(--green);
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
  flex-shrink: 0;
}
.key-left strong { color: var(--text); font-size: 14px; }
.key-left .muted { font-size: 12px; color: var(--dim); margin: 4px 0 0; line-height: 1.5; }
.key-left code {
  font-family: var(--mono); font-size: 11.5px;
  background: var(--surface-2); padding: 1px 6px; border-radius: 4px;
  color: var(--text);
}
.key-card .badge {
  display: inline-block; margin-left: 6px;
  font-family: var(--mono); font-size: 9.5px;
  padding: 2px 7px; border-radius: 5px;
  background: var(--surface-2); color: var(--dim);
  text-transform: none; letter-spacing: 0;
  border: 1px solid var(--border-soft);
}
.key-right { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.key-val {
  font-family: var(--mono); font-size: 13px;
  color: var(--green); background: var(--bg);
  padding: 8px 12px; border-radius: 7px;
  border: 1px solid var(--border-soft);
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.key-val.blurred { filter: blur(5px); user-select: none; }
.ghost-button {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text); border-radius: 7px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: 0.15s;
}
.ghost-button:hover { border-color: var(--green); color: var(--green); }
.ghost-button:disabled { opacity: 0.5; cursor: not-allowed; }
.ghost-button.mini { padding: 3px 7px; font-size: 10.5px; }

/* 2-col layout */
.docs-layout {
  display: grid; grid-template-columns: 240px minmax(0, 1fr);
  gap: 20px; align-items: start;
}
.docs-nav {
  position: sticky; top: 80px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px;
  display: flex; flex-direction: column; gap: 3px;
  max-height: calc(100vh - 100px); overflow-y: auto;
}
.docs-nav h4 {
  margin: 0 4px 10px; font-size: 10px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;
}
.docs-nav button {
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; color: var(--dim);
  padding: 9px 12px; border-radius: 8px;
  text-align: left; font: inherit; font-size: 13px; cursor: pointer;
  transition: 0.15s;
}
.docs-nav button:hover { background: var(--surface-2); color: var(--text); }
.docs-nav button.active {
  background: color-mix(in srgb, var(--green-soft) 80%, transparent);
  color: var(--text); font-weight: 600;
}
.docs-nav button.active svg { color: var(--green); }
.docs-nav button .count {
  margin-left: auto;
  font-family: var(--mono); font-size: 10.5px; color: var(--dim);
  background: var(--surface-2); padding: 2px 7px; border-radius: 5px;
}
.docs-nav button.active .count {
  background: var(--green); color: #0a0e14; font-weight: 700;
}
.docs-nav button .count.count-green {
  background: var(--green-soft); color: var(--green);
}

.docs-body article { display: flex; flex-direction: column; gap: 18px; }
.docs-body h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
.docs-body .muted { color: var(--dim); font-size: 13.5px; margin: 0; line-height: 1.6; }

/* Quick-start flow steps */
.flow-steps {
  list-style: none; padding: 0;
  margin: 8px 0 0;
  display: flex; flex-direction: column; gap: 10px;
}
.flow-step {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 14px 16px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px;
  transition: 0.15s;
}
.flow-step:hover { border-color: color-mix(in srgb, var(--green) 35%, var(--border)); transform: translateX(2px); }
.flow-num {
  flex: none;
  width: 30px; height: 30px;
  border-radius: 8px;
  background: var(--green-soft);
  color: var(--green);
  font-family: var(--mono); font-weight: 800; font-size: 14px;
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--green) 30%, var(--border));
}
.flow-step strong { font-size: 14px; color: var(--text); font-weight: 700; }
.flow-step p { font-size: 12.5px; line-height: 1.55; }

/* Endpoint cards */
.endpoint {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
}
.ep-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.method {
  font-family: var(--mono); font-size: 10.5px; font-weight: 800;
  padding: 4px 9px; border-radius: 5px;
  letter-spacing: 0.05em;
  border: 1px solid;
}
.method.m-get    { background: var(--green-soft); color: var(--green); border-color: color-mix(in srgb, var(--green) 30%, transparent); }
.method.m-post   { background: var(--blue-soft);  color: var(--blue);  border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
.method.m-patch  { background: var(--yellow-soft);color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 30%, transparent); }
.method.m-delete { background: var(--red-soft);   color: var(--red);   border-color: color-mix(in srgb, var(--red) 30%, transparent); }
.path { font-family: var(--mono); font-size: 13.5px; color: var(--text); font-weight: 600; }
.ep-desc { color: var(--dim); font-size: 13px; margin: 0; line-height: 1.6; }
.try-btn { color: var(--green); border-color: color-mix(in srgb, var(--green) 35%, var(--border)) !important; }

.ep-blocks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.code-block {
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 8px; overflow: hidden;
}
.code-block header {
  display: flex; align-items: center; gap: 6px;
  background: var(--surface-2);
  padding: 7px 12px;
  font-size: 10.5px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
  border-bottom: 1px solid var(--border-soft);
}
.code-block pre {
  margin: 0; padding: 12px 14px; overflow-x: auto;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.6;
  color: var(--text); background: transparent;
  white-space: pre;
}
.code-block.curl pre { color: var(--green); }

.docs-cta {
  margin-top: 14px;
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
.apidocs-foot {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px;
  padding: 22px 0 0;
  margin-top: 14px;
  border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 12px;
}
.apidocs-foot a { color: var(--dim); text-decoration: none; }
.apidocs-foot a:hover { color: var(--text); }
.foot-onie a { color: var(--text); font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* Mobile */
@media (max-width: 980px) {
  .apidocs { padding: 22px 18px 50px; gap: 18px; }
  .apidocs-head h1 { font-size: 26px; }
  .docs-layout { grid-template-columns: 1fr; gap: 14px; }
  .docs-nav {
    position: static;
    max-height: 280px;
    flex-direction: row; flex-wrap: wrap;
    padding: 10px;
  }
  .docs-nav h4 { display: none; }
  .docs-nav button { flex: 1 1 auto; }
  .ep-blocks { grid-template-columns: 1fr; }
  .key-card { padding: 14px 16px; }
  .key-val { max-width: 100%; }
}
@media (max-width: 640px) {
  .apidocs { padding: 18px 14px 40px; }
  .apidocs-head h1 { font-size: 22px; }
  .apidocs-head .sub { font-size: 13px; }
  .key-card { gap: 10px; }
  .key-right { width: 100%; }
  .key-val { flex: 1; }
  .docs-body h2 { font-size: 19px; }
  .flow-step { padding: 12px 14px; }
  .endpoint { padding: 14px; }
  .docs-cta { flex-direction: column; align-items: flex-start; }
  .cta-actions { width: 100%; }
  .cta-actions .btn { flex: 1; justify-content: center; }
  .apidocs-foot { flex-direction: column; align-items: flex-start; }
}
</style>
