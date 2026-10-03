<script setup>
import { computed, h, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Grid } from 'ant-design-vue'
import {
  BellOutlined, DashboardOutlined, LockOutlined, ShoppingCartOutlined, ThunderboltOutlined, ToolOutlined
} from '@ant-design/icons-vue'
import PublicTopNav from '../components/PublicTopNav.vue'
import { useI18n } from '../i18n'
import { message } from '../ui/feedback'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const screens = Grid.useBreakpoint()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const year = new Date().getFullYear()

const baseUrl = computed(() => typeof location !== 'undefined' ? location.origin : 'https://proxybox.pro')
const apiKey = '••••••••••••••••••••••••••••••••'

function copy(text) {
  navigator.clipboard?.writeText(text)
  message.success(locale.value === 'vi' ? 'Đã copy!' : 'Copied!')
}
function signInToReveal() {
  router.push({ name: 'login', query: { next: '/api-docs' } })
}

// Renders `inline code` spans of a plain string as <code> (used for intros / flow details).
function RichText(props) {
  return String(props.text || '').split(/(`[^`]+`)/g).filter(Boolean)
    .map((s) => (s.length > 2 && s.startsWith('`') && s.endsWith('`') ? h('code', s.slice(1, -1)) : s))
}
RichText.props = ['text']

// Endpoint groups — mirror customer API docs structure.
const groups = computed(() => ([
  {
    id: 'flow', title: 'Quick start', icon: ThunderboltOutlined,
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
    id: 'auth', title: 'Authentication', icon: LockOutlined,
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
    id: 'orders', title: locale.value === 'vi' ? 'Mua proxy (Orders)' : 'Buy proxies (Orders)', icon: ShoppingCartOutlined,
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
    id: 'proxies', title: locale.value === 'vi' ? 'Quản lý proxy' : 'Manage proxies', icon: ToolOutlined,
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
    id: 'billing', title: 'Billing', icon: DashboardOutlined,
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
    id: 'notifications', title: 'Notifications', icon: BellOutlined,
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

const METHOD_COLORS = { GET: 'success', POST: 'processing', PATCH: 'warning', PUT: 'warning', DELETE: 'error' }
function methodColor(m) { return METHOD_COLORS[m] || 'success' }
function flowItems(flow) {
  return flow.map((f) => ({ title: f.title, description: h(RichText, { text: f.detail }), status: 'process' }))
}
function curlSample(method, path, body) {
  const url = `${baseUrl.value}${path}`
  const headers = [`-H "X-Customer-Key: YOUR_API_KEY"`]
  if (body) headers.push('-H "Content-Type: application/json"')
  const dataFlag = body ? ` \\\n  -d '${body.replace(/\n/g, '').replace(/\s+/g, ' ')}'` : ''
  return `curl -X ${method} ${url} \\\n  ${headers.join(' \\\n  ')}${dataFlag}`
}

function applyHash() {
  if (route.hash) {
    const id = route.hash.slice(1)
    if (groups.value.some((g) => g.id === id)) activeGroup.value = id
  }
}
onMounted(applyHash)
// Same-page links such as /api-docs#orders reuse this component instance.
watch(() => route.hash, applyHash)
</script>

<template>
  <a-layout class="pub-page">
    <PublicTopNav sub-label="API" />

    <a-layout-content class="pub-shell">
      <header class="pub-head">
        <a-typography-text type="success" strong class="kicker">
          <ReadOutlined /> Developer
        </a-typography-text>
        <a-typography-title :level="1" class="page-title">API Documentation</a-typography-title>
        <a-typography-paragraph type="secondary" class="page-sub rich">
          <RichText
            :text="locale === 'vi'
              ? 'Endpoint reference cho customer API. Dùng header `X-Customer-Key` hoặc Bearer token.'
              : 'Endpoint reference for the customer API. Use the `X-Customer-Key` header or Bearer token.'"
          />
        </a-typography-paragraph>
      </header>

      <!-- Token card (public version: locked state with sign-in CTA) -->
      <a-card class="key-card" :body-style="{ padding: '16px 20px' }">
        <a-row :gutter="[20, 14]" align="middle">
          <a-col :xs="24" :xl="14">
            <a-flex gap="middle" align="flex-start">
              <span class="icon-tile"><KeyOutlined /></span>
              <div class="key-text">
                <a-space wrap :size="6">
                  <a-typography-text strong>{{ locale === 'vi' ? 'Token cá nhân' : 'Personal token' }}</a-typography-text>
                  <a-tag :bordered="false" class="mono">{{ locale === 'vi' ? 'duy nhất · tất cả trong một' : 'one token · all uses' }}</a-tag>
                </a-space>
                <a-typography-paragraph type="secondary" class="key-desc rich">
                  {{ locale === 'vi' ? 'Dùng' : 'Use the' }}
                  <a-typography-text type="success" strong>{{ locale === 'vi' ? 'cùng 1 giá trị' : 'same value' }}</a-typography-text>
                  {{ locale === 'vi' ? 'cho REST API' : 'across the REST API' }}
                  (<code>X-Customer-Key</code>),
                  SDK (<code>Authorization: Bearer</code>)
                  {{ locale === 'vi' ? 'và cài agent BYON. Tự tạo khi đăng ký, rotate bất cứ lúc nào.' : 'and BYON agent installs. Auto-minted on signup, rotate any time.' }}
                </a-typography-paragraph>
              </div>
            </a-flex>
          </a-col>
          <a-col :xs="24" :xl="10">
            <a-flex gap="small" align="center">
              <code class="key-val mono" aria-hidden="true">{{ apiKey }}</code>
              <a-button type="primary" @click="signInToReveal">
                <template #icon><EyeOutlined /></template>
                {{ locale === 'vi' ? 'Đăng nhập để hiện' : 'Sign in to reveal' }}
              </a-button>
            </a-flex>
          </a-col>
        </a-row>
      </a-card>

      <!-- Endpoint groups -->
      <a-tabs v-model:active-key="activeGroup" :tab-position="screens.lg ? 'left' : 'top'" class="docs-tabs">
        <a-tab-pane v-for="g in groups" :key="g.id">
          <template #tab>
            <span class="tab-label">
              <component :is="g.icon" />
              <span>{{ g.title }}</span>
              <a-tag v-if="g.endpoints?.length" :bordered="false" class="mono tab-count">{{ g.endpoints.length }}</a-tag>
              <a-tag v-else-if="g.flow?.length" :bordered="false" color="success" class="mono tab-count">{{ g.flow.length }}</a-tag>
            </span>
          </template>

          <a-flex vertical gap="middle">
            <div>
              <a-typography-title :level="2" class="section-title">{{ g.title }}</a-typography-title>
              <a-typography-paragraph type="secondary" class="section-intro rich"><RichText :text="g.intro" /></a-typography-paragraph>
            </div>

            <!-- Quick-start flow -->
            <a-card v-if="g.flow?.length" size="small" class="rich">
              <a-steps direction="vertical" size="small" :items="flowItems(g.flow)" />
            </a-card>

            <a-card v-for="(e, i) in g.endpoints" :key="i" size="small" class="endpoint">
              <a-flex align="center" gap="small" wrap="wrap">
                <a-tag :color="methodColor(e.method)" class="mono method">{{ e.method }}</a-tag>
                <a-typography-text strong class="mono ep-path">{{ e.path }}</a-typography-text>
                <a-tooltip :title="locale === 'vi' ? 'Sao chép' : 'Copy'">
                  <a-button type="text" size="small" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'" @click="copy(`${baseUrl}${e.path}`)">
                    <template #icon><CopyOutlined /></template>
                  </a-button>
                </a-tooltip>
                <a-button size="small" class="try-btn" @click="signInToReveal">
                  <template #icon><PlayCircleOutlined /></template>
                  {{ locale === 'vi' ? 'Đăng nhập để Try it' : 'Sign in to Try it' }}
                </a-button>
              </a-flex>
              <a-typography-paragraph type="secondary" class="ep-desc">{{ e.desc }}</a-typography-paragraph>

              <a-row v-if="e.request || e.response" :gutter="[10, 10]" class="ep-blocks">
                <a-col v-if="e.request" :xs="24" :md="e.response ? 12 : 24">
                  <div class="code-block">
                    <div class="code-head">
                      <CodeOutlined /> Request body
                      <a-button type="text" size="small" class="code-copy" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'" @click="copy(e.request)">
                        <template #icon><CopyOutlined /></template>
                      </a-button>
                    </div>
                    <pre class="mono">{{ e.request }}</pre>
                  </div>
                </a-col>
                <a-col v-if="e.response" :xs="24" :md="e.request ? 12 : 24">
                  <div class="code-block">
                    <div class="code-head">
                      <ArrowRightOutlined /> Response
                      <a-button type="text" size="small" class="code-copy" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'" @click="copy(e.response)">
                        <template #icon><CopyOutlined /></template>
                      </a-button>
                    </div>
                    <pre class="mono">{{ e.response }}</pre>
                  </div>
                </a-col>
              </a-row>

              <div class="code-block">
                <div class="code-head">
                  <CodeOutlined /> cURL
                  <a-button type="text" size="small" class="code-copy" :aria-label="locale === 'vi' ? 'Sao chép' : 'Copy'" @click="copy(curlSample(e.method, e.path, e.request))">
                    <template #icon><CopyOutlined /></template>
                  </a-button>
                </div>
                <pre class="mono">{{ curlSample(e.method, e.path, e.request) }}</pre>
              </div>
            </a-card>

            <!-- CTA at end of group -->
            <a-card class="cta-card" :body-style="{ padding: '14px 18px' }">
              <a-flex justify="space-between" align="center" wrap="wrap" gap="middle">
                <a-flex align="center" gap="small" class="cta-text">
                  <ThunderboltOutlined class="cta-icon" />
                  <a-typography-text>
                    {{ locale === 'vi' ? 'Sẵn sàng tích hợp? Đăng nhập để mở console Try it ngay trong trình duyệt.' : 'Ready to integrate? Sign in to open the in-browser Try it console.' }}
                  </a-typography-text>
                </a-flex>
                <a-space wrap>
                  <RouterLink v-slot="{ href, navigate }" to="/register" custom>
                    <a-button type="primary" :href="href" @click="navigate">
                      {{ locale === 'vi' ? 'Đăng ký' : 'Get started' }} <ArrowRightOutlined />
                    </a-button>
                  </RouterLink>
                  <RouterLink v-slot="{ href, navigate }" to="/login" custom>
                    <a-button :href="href" @click="navigate">
                      {{ locale === 'vi' ? 'Đăng nhập' : 'Sign in' }}
                    </a-button>
                  </RouterLink>
                </a-space>
              </a-flex>
            </a-card>
          </a-flex>
        </a-tab-pane>
      </a-tabs>
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
          <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
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
/* `inline code` spans rendered by RichText */
.rich :deep(code) { font-family: var(--pb-mono); overflow-wrap: anywhere; }

/* Header */
.kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.page-title { margin: 4px 0 6px !important; font-size: 32px !important; letter-spacing: -0.4px; }
.page-sub { margin: 0 !important; max-width: 760px; font-size: 15px; }

/* Token card */
.key-card {
  background: linear-gradient(135deg, var(--pb-primary-soft) 0%, transparent 55%), var(--pb-surface);
}
.icon-tile {
  flex: none; display: inline-grid; place-items: center;
  width: 40px; height: 40px; border-radius: 10px;
  font-size: 18px; color: var(--pb-primary); background: var(--pb-primary-soft);
}
.key-text { min-width: 0; }
.key-desc { margin: 4px 0 0 !important; font-size: 13px; }
.key-val {
  flex: 1; min-width: 0;
  padding: 7px 12px; border-radius: 8px;
  background: var(--pb-bg); border: 1px solid var(--pb-border-soft);
  filter: blur(4px); user-select: none;
  white-space: nowrap; overflow: hidden; word-break: normal;
}

/* Groups */
.tab-label { display: inline-flex; align-items: center; gap: 8px; }
.tab-label :deep(.anticon) { margin-inline-end: 0; }
.tab-count { margin-inline-end: 0; }
.docs-tabs :deep(.ant-tabs-tab) { padding-inline-end: 16px !important; }
.section-title { margin: 0 0 4px !important; font-size: 22px !important; }
.section-intro { margin: 0 !important; }

/* Endpoints */
.method { margin-inline-end: 0; font-weight: 700; }
.ep-path { font-size: 13.5px; }
.try-btn { margin-inline-start: auto; }
.ep-desc { margin: 8px 0 12px !important; }
.ep-blocks { margin-bottom: 10px; }
.code-block {
  border: 1px solid var(--pb-border-soft); border-radius: 8px; overflow: hidden;
  background: var(--pb-bg);
}
.code-head {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px 4px 12px; min-height: 32px;
  font-size: 12px; font-weight: 500; color: var(--pb-text-3);
  background: var(--pb-surface-2); border-bottom: 1px solid var(--pb-border-soft);
}
.code-copy { margin-inline-start: auto; color: var(--pb-text-3); }
.code-block pre {
  margin: 0; padding: 10px 14px; overflow-x: auto;
  font-size: 12px; line-height: 1.6; white-space: pre; word-break: normal;
  color: var(--pb-text);
}

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
  .try-btn { margin-inline-start: 0; }
  .pub-foot { padding: 18px 16px; }
  .pub-foot-inner { flex-direction: column; align-items: flex-start !important; }
}
</style>
