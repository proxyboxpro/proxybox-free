<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowRight, Book, ChevronRight, Copy, Gauge, KeyRound, Lock, Play, Send, ShoppingCart, Terminal, Wrench, Zap } from 'lucide-vue-next'
import { apiFetch, token as bearerToken } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const account = ref(null)
const flash = ref('')

async function refresh() {
  try { account.value = await apiFetch('/api/v1/user/account') } catch { /* not logged in */ }
}
function copy(text) {
  navigator.clipboard?.writeText(text)
  flash.value = t('cust.detail.copied') || 'Copied!'
  setTimeout(() => flash.value = '', 1500)
}

// Customer API key (X-Customer-Key header) — masked unless revealed.
const apiKey = computed(() => account.value?.apiKey || '••••••••••••••••')
const reveal = ref(false)
const revealToken = ref(false)
const sessionToken = computed(() => bearerToken.value || '')
const baseUrl = computed(() => typeof location !== 'undefined' ? location.origin : 'https://proxyhub.local')

// Per-endpoint interactive "Try it" state. Keyed by `${groupId}:${index}`.
const tryState = reactive({})
const tryAuthMode = ref('apiKey') // 'apiKey' | 'bearer'
function tryKeyOf(gid, i) { return `${gid}:${i}` }
function ensureTry(gid, i, e) {
  const k = tryKeyOf(gid, i)
  if (!tryState[k]) {
    tryState[k] = {
      open: false,
      path: e.path,
      body: e.request || '',
      response: null,
      status: null,
      durationMs: null,
      busy: false,
      error: null
    }
  }
  return tryState[k]
}
async function runTry(gid, i, e) {
  const s = ensureTry(gid, i, e)
  s.busy = true; s.error = null; s.response = null; s.status = null; s.durationMs = null
  const t0 = performance.now()
  try {
    const headers = { 'Accept': 'application/json' }
    if (tryAuthMode.value === 'bearer' && sessionToken.value) {
      headers['Authorization'] = `Bearer ${sessionToken.value}`
    } else if (tryAuthMode.value === 'apiKey' && account.value?.apiKey) {
      headers['X-Customer-Key'] = account.value.apiKey
    }
    if (s.body && e.method !== 'GET' && e.method !== 'DELETE') {
      headers['Content-Type'] = 'application/json'
    }
    const opts = { method: e.method, headers }
    if (s.body && e.method !== 'GET' && e.method !== 'DELETE') opts.body = s.body
    const res = await fetch(`${baseUrl.value}${s.path}`, opts)
    s.status = res.status
    s.durationMs = Math.round(performance.now() - t0)
    const text = await res.text()
    try { s.response = JSON.stringify(JSON.parse(text), null, 2) }
    catch { s.response = text }
  } catch (err) {
    s.error = err.message || String(err)
    s.durationMs = Math.round(performance.now() - t0)
  } finally { s.busy = false }
}

// Endpoint groups. Each endpoint: method + path + description + sample request/response.
const groups = [
  {
    id: 'flow', title: 'Quick start', icon: Zap,
    intro: 'Luồng end-to-end để mua, dùng, và quản lý proxy qua API. Tất cả request đều cần header `X-Customer-Key: <api-key>` (lấy ở thẻ phía trên).',
    flow: [
      { step: 1, title: 'Nạp tiền + check số dư', detail: 'GET /api/v1/user/billing — kiểm tra wallet trước khi tạo đơn.' },
      { step: 2, title: 'Tạo đơn (mua proxy)', detail: 'POST /api/v1/user/orders với `type`, `quantity`, `hours`, `zone`. Server tự cấp N proxy + trả về danh sách credentials.' },
      { step: 3, title: 'Lấy danh sách proxy', detail: 'GET /api/v1/user/proxies — trả về tất cả proxy bạn sở hữu, mỗi cái có `orderId` để gom nhóm.' },
      { step: 4, title: 'Sử dụng proxy', detail: 'Connect tới `bindIp:port` với `username:password` (HTTP CONNECT hoặc SOCKS5). Hoặc thêm IP của bạn vào whitelist để bỏ qua auth.' },
      { step: 5, title: 'Quản lý proxy', detail: 'Check live (bulk), gia hạn (extend), xoá (DELETE), whitelist IP, xoay IPv6, xem SLA + lịch sử băng thông.' }
    ],
    endpoints: []
  },
  {
    id: 'auth', title: 'Authentication', icon: Lock,
    intro: 'API key (header `X-Customer-Key`) hoặc Bearer token sau khi login. API key có ở thẻ trên — dùng cho automation. Bearer token dùng cho session đăng nhập tương tác.',
    endpoints: [
      { method: 'POST', path: '/api/v1/user/auth/login', desc: 'Đăng nhập, trả về Bearer token (TTL 7 ngày).',
        request: '{\n  "email": "you@example.com",\n  "password": "secret"\n}',
        response: '{\n  "token": "abc123...",\n  "user": { "email": "you@example.com", "role": "customer" }\n}' },
      { method: 'GET',  path: '/api/v1/user/auth/me',   desc: 'Thông tin user hiện tại.', response: '{ "id": "u-...", "email": "...", "role": "customer", "emailVerified": true }' },
      { method: 'GET',  path: '/api/v1/user/account',   desc: 'Profile + balance + API key.', response: '{ "id": "u-...", "name": "...", "balance": 150000, "apiKey": "abc..." }' }
    ]
  },
  {
    id: 'orders', title: 'Mua proxy (Orders)', icon: ShoppingCart,
    intro: 'Tạo đơn = đặt mua N proxy cùng zone + cùng số giờ. Server tự cấp ngay và trả về full credentials.',
    endpoints: [
      { method: 'POST', path: '/api/v1/user/orders', desc: 'Mua N proxy cùng lúc theo giờ. Cần `type` ∈ {ipv4, ipv6}, `quantity` ≥ 1, `hours` ≥ 1, `zone` (bắt buộc — danh sách zone lấy từ /zones).',
        request: '{\n  "type": "ipv4",\n  "quantity": 5,\n  "hours": 24,\n  "zone": "vn-hcm",\n  "autoRenew": false,\n  "coupon": "LAUNCH10"\n}',
        response: '{\n  "order": {\n    "id": "ORD-170747",\n    "proxyIds": ["px-20005","px-20006","px-20007","px-20008","px-20009"],\n    "totalCost": 49920,\n    "expiresAt": "2026-05-16T03:19:30Z"\n  },\n  "proxies": [\n    {\n      "id": "px-20005",\n      "orderId": "ORD-170747",\n      "bindIp": "192.0.2.2",\n      "port": 20005,\n      "username": "user_20005",\n      "password": "c0549d8275c5",\n      "http": "http://user_20005:c0549d8275c5@192.0.2.2:20005"\n    }, ...\n  ],\n  "balance": 100080\n}' },
      { method: 'GET',  path: '/api/v1/user/zones', desc: 'List zone hợp lệ + số node online theo từng zone.', response: '[ { "id": "vn-hcm", "name": "Vietnam — HCM", "onlineNodes": 1 } ]' },
      { method: 'GET',  path: '/api/v1/user/pricing', desc: 'Đơn giá / giờ + volume tier discount.', response: '{ "currency": "VND", "ipv4": { "perHour": 416 }, "ipv6": { "perHour": 291 }, "tiers": [...] }' }
    ]
  },
  {
    id: 'proxies', title: 'Quản lý proxy', icon: ArrowRight,
    intro: 'List + control mọi proxy bạn sở hữu. Group theo `orderId` để xử lý theo nhóm. Mọi endpoint per-proxy check ownership trước.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/proxies', desc: 'List toàn bộ proxy (kèm `orderId` để gom nhóm, `expiresAt`, `allowedSrcIps`).',
        response: '[\n  {\n    "id": "px-20005",\n    "orderId": "ORD-170747",\n    "type": "IPv4",\n    "bindIp": "192.0.2.2",\n    "port": 20005,\n    "username": "user_20005",\n    "password": "...",\n    "http": "http://u:p@host:port",\n    "socks5": "socks5://u:p@host:port",\n    "status": "active",\n    "expiresAt": "2026-05-16T03:19:30Z",\n    "zone": "vn-hcm",\n    "allowedSrcIps": []\n  }\n]' },
      { method: 'GET', path: '/api/v1/user/proxies/export?format=txt', desc: 'Export tất cả proxy ra file (format: txt | csv | json).',
        response: '192.0.2.2:20005:user_20005:c054...\n192.0.2.3:20006:user_20006:959a...' },
      { method: 'POST', path: '/api/v1/user/proxies/check-bulk', desc: 'Check live N proxy song song. Limit 100 ids/lượt.',
        request: '{ "ids": ["px-20005","px-20006","px-20007"] }',
        response: '{\n  "total": 3,\n  "ok": 3,\n  "results": [\n    { "id": "px-20005", "ok": true, "latencyMs": 290 },\n    { "id": "px-20006", "ok": true, "latencyMs": 313 },\n    { "id": "px-20007", "ok": true, "latencyMs": 303 }\n  ]\n}' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/check', desc: 'Check 1 proxy còn live không.', response: '{ "ok": true, "latencyMs": 42, "proxy": { ... } }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/rotate', desc: 'Đổi IP cho proxy IPv6 (random IP mới trong pool /48 của node).', response: '{ "id": "px-...", "bindIp": "2602:f9ca:...", ... }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/extend', desc: 'Gia hạn thêm giờ. Trừ phí vào ví (= perHour × hours). Status `expired`/`grace` → tự về `active`.',
        request: '{ "hours": 24 }',
        response: '{ "proxy": { "expiresAt": "..." }, "balance": 100080 }' },
      { method: 'DELETE', path: '/api/v1/user/proxies/:id', desc: 'Xoá hẳn 1 proxy (release). Stop listener + remove khỏi config. Không hoàn tiền số giờ còn lại.', response: '{ "ok": true, "id": "px-..." }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/whitelist', desc: 'Lấy danh sách IP whitelist hiện tại (IP auth — bỏ qua user/pass khi connect từ IP này).', response: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }' },
      { method: 'PUT', path: '/api/v1/user/proxies/:id/whitelist', desc: 'Set whitelist (overwrite). Tối đa 20 IP. IPv4 + IPv6 đều OK.',
        request: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }',
        response: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/sla?days=30', desc: 'Uptime % trong N ngày qua (1-365).', response: '{ "pct": 99.87, "samples": 720 }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/history?hours=24', desc: 'Lịch sử băng thông từng giờ (1-720h).', response: '{ "samples": [ { "hour": "2026-05-15T03", "uploadBytes": 12345, "downloadBytes": 67890, "bpsIn": 1024, "bpsOut": 2048 } ] }' }
    ]
  },
  {
    id: 'tools', title: 'Tools (diagnostics)', icon: Wrench,
    intro: 'Network + proxy diagnostics. Mỗi tool có rate limit riêng (xem hint trong response 429).',
    endpoints: [
      { method: 'POST', path: '/api/v1/user/tools/ping', desc: 'Ping 1 IP (auto-detect v4/v6). Limit 30/giờ.',
        request: '{ "ip": "8.8.8.8", "count": 4 }',
        response: '{ "target": "8.8.8.8", "family": "ipv4", "ok": true, "transmitted": 4, "received": 4, "loss": 0, "rtt": { "min": 44.6, "avg": 44.7, "max": 44.9 } }' },
      { method: 'POST', path: '/api/v1/user/tools/ip-info', desc: 'ASN + CIDR + country + org của 1 IP. Data từ Team Cymru DNS. Limit 100/giờ.',
        request: '{ "ip": "8.8.8.8" }',
        response: '{ "ip": "8.8.8.8", "asn": "AS15169", "cidr": "8.8.8.0/24", "country": "US", "org": "GOOGLE - Google LLC, US" }' },
      { method: 'POST', path: '/api/v1/user/tools/blacklist', desc: 'Kiểm tra IPv4 có trong 10 DNSBL phổ biến không. Limit 100/giờ.',
        request: '{ "ip": "127.0.0.2" }',
        response: '{ "ip": "127.0.0.2", "total": 10, "listed": 7, "clean": 2, "errors": 1, "results": [ { "name": "Spamhaus ZEN", "listed": true } ] }' },
      { method: 'POST', path: '/api/v1/user/tools/bulk-check', desc: 'Check N proxy bất kỳ song song (HTTP + SOCKS5, IPv4 + IPv6). Max 50 dòng/batch. Limit 5 batches/giờ.',
        request: '{ "lines": "1.2.3.4:8080:user:pass\\nuser:pass@5.6.7.8:1080\\nsocks5://1.2.3.4:1080" }',
        response: '{ "total": 3, "ok": 1, "fail": 2, "results": [ { "idx": 0, "ok": true, "latencyMs": 234, "exitIp": "1.2.3.4" } ] }' },
      { method: 'GET', path: '/api/v1/user/tools/speedtest-isps?country=VN', desc: 'List ISP/sponsor có server speedtest.net theo quốc gia. Dùng để filter trong speed-test.',
        response: '{ "country": "VN", "countryName": "Vietnam", "totalServers": 20, "isps": [ { "sponsor": "Viettel IDC", "serverCount": 4 } ] }' },
      { method: 'POST', path: '/api/v1/user/tools/speed-test', desc: 'Đo tốc độ download thực qua proxy của bạn (Ookla server). Test ~15s / max 80MB. Limit 5/giờ.',
        request: '{ "proxyId": "px-20005", "country": "VN", "isp": "viettel" }',
        response: '{ "ok": true, "mbps": 1470.95, "totalBytes": 31625365, "durationMs": 172, "ttfbMs": 81, "server": { "sponsor": "Viettel Network", "name": "Da Nang", "host": "speedtestkv2a.viettel.vn..." } }' }
    ]
  },
  {
    id: 'billing', title: 'Billing', icon: ArrowRight,
    intro: 'Số dư ví, transaction history, Stripe checkout.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/billing', desc: 'Wallet + plan + 10 tx gần nhất.', response: '{ "wallet": { "balance": 150000 }, "plan": { "name": "free" }, "recentTx": [ ... ] }' },
      { method: 'GET', path: '/api/v1/user/billing/transactions', desc: 'Lịch sử giao dịch (pagination).', response: '{ "items": [ { "ts": "...", "type": "topup", "amount": 100000 } ], "total": 42 }' },
      { method: 'POST', path: '/api/v1/user/billing/checkout', desc: 'Tạo Stripe Checkout session để nạp tiền.', request: '{ "amount": 100000 }', response: '{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }' }
    ]
  },
  {
    id: 'notifs', title: 'Notifications', icon: ArrowRight,
    intro: 'In-app notifications cho events: đơn cấp xong, sắp hết hạn, ví thấp.',
    endpoints: [
      { method: 'GET', path: '/api/v1/user/notifications', desc: 'Danh sách notification.', response: '{ "items": [...], "unread": 3 }' },
      { method: 'POST', path: '/api/v1/user/notifications/:id/read', desc: 'Đánh dấu đã đọc.', response: '{ "ok": true }' },
      { method: 'POST', path: '/api/v1/user/notifications/read-all', desc: 'Đánh dấu tất cả đã đọc.', response: '{ "ok": true }' },
      { method: 'DELETE', path: '/api/v1/user/notifications', desc: 'Xoá hết notifications.', response: '{ "ok": true }' }
    ]
  }
]

const activeGroup = ref(groups[0].id)
function curlSample(method, path, body) {
  const url = `${baseUrl.value}${path}`
  const headers = [`-H "X-Customer-Key: ${reveal.value ? apiKey.value : 'YOUR_API_KEY'}"`]
  if (body) headers.push('-H "Content-Type: application/json"')
  const dataFlag = body ? ` \\\n  -d '${body.replace(/\n/g, '').replace(/\s+/g, ' ')}'` : ''
  return `curl -X ${method} ${url} \\\n  ${headers.join(' \\\n  ')}${dataFlag}`
}

onMounted(refresh)
</script>

<template>
  <section class="apidocs">
    <header class="apidocs-head">
      <div>
        <p class="eyebrow"><Book :size="12" /> {{ t('cust.apidocs.eyebrow') }}</p>
        <h1>{{ t('cust.apidocs.title') }}</h1>
        <p class="sub">{{ t('cust.apidocs.sub') }}</p>
      </div>
    </header>

    <p v-if="flash" style="color:#4ade80; font-size:13px">{{ flash }}</p>

    <!-- Single unified token. Same value works as:
           1) X-Customer-Key header for REST API automation
           2) Authorization Bearer for SDK / session
           3) Fleet enroll token to claim BYON nodes (curl-pipe-bash installer)
         Auto-minted on register. Format: usr_<userId>_<hex>. Rotation rotates
         ALL three uses at once — there's only one key to track. -->
    <section class="key-card">
      <div class="key-left">
        <span class="ico"><KeyRound :size="18" /></span>
        <div>
          <strong>Token cá nhân <small class="badge">duy nhất · tất cả trong một</small></strong>
          <p class="muted">Dùng <strong style="color:var(--green)">cùng 1 giá trị</strong> cho REST API (<code>X-Customer-Key</code>), SDK (<code>Authorization: Bearer</code>) và cài agent BYON. Tự tạo khi đăng ký, rotate bất cứ lúc nào.</p>
        </div>
      </div>
      <div class="key-right">
        <code class="key-val" :class="{ blurred: !reveal }">{{ apiKey }}</code>
        <button type="button" class="ghost-button" @click="reveal = !reveal">{{ reveal ? 'Ẩn' : 'Hiện' }}</button>
        <button type="button" class="ghost-button" :disabled="!reveal" @click="copy(apiKey)"><Copy :size="13" /></button>
      </div>
    </section>

    <!-- Groups nav + content -->
    <div class="docs-layout">
      <nav class="docs-nav">
        <h4>{{ t('cust.apidocs.endpoints') }}</h4>
        <button
          v-for="g in groups" :key="g.id"
          type="button"
          :class="{ active: activeGroup === g.id }"
          @click="activeGroup = g.id"
        >
          <component :is="g.icon" :size="14" />
          <span>{{ g.title }}</span>
          <span v-if="g.endpoints?.length" class="count">{{ g.endpoints.length }}</span>
          <span v-else-if="g.flow?.length" class="count" style="background:rgba(63,185,80,0.18); color:var(--pxl)">{{ g.flow.length }}</span>
        </button>
      </nav>

      <div class="docs-body">
        <template v-for="g in groups" :key="g.id">
          <article v-if="activeGroup === g.id">
            <h2>{{ g.title }}</h2>
            <p class="muted">{{ g.intro }}</p>

            <!-- Quick-start flow steps (only present on the first group) -->
            <ol v-if="g.flow?.length" class="flow-steps">
              <li v-for="f in g.flow" :key="f.step" class="flow-step">
                <span class="flow-num">{{ f.step }}</span>
                <div>
                  <strong>{{ f.title }}</strong>
                  <p class="muted" style="margin:2px 0 0">{{ f.detail }}</p>
                </div>
              </li>
            </ol>

            <div v-for="(e, i) in g.endpoints" :key="i" class="endpoint">
              <div class="ep-head">
                <span :class="['method', `m-${e.method.toLowerCase()}`]">{{ e.method }}</span>
                <code class="path">{{ e.path }}</code>
                <button type="button" class="ghost-button mini" @click="copy(`${baseUrl}${e.path}`)"><Copy :size="11" /></button>
                <button type="button" class="ghost-button mini try-btn" @click="ensureTry(g.id, i, e).open = !tryState[tryKeyOf(g.id, i)].open">
                  <Play :size="11" /> {{ tryState[tryKeyOf(g.id, i)]?.open ? 'Đóng' : 'Try it' }}
                </button>
              </div>
              <p class="ep-desc">{{ e.desc }}</p>

              <div class="ep-blocks">
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
                  <button type="button" class="ghost-button mini" style="margin-left:auto" @click="copy(curlSample(e.method, e.path, e.request))"><Copy :size="11" /></button>
                </header>
                <pre>{{ curlSample(e.method, e.path, e.request) }}</pre>
              </div>

              <!-- Interactive try-it panel -->
              <div v-if="tryState[tryKeyOf(g.id, i)]?.open" class="try-panel">
                <div class="try-head">
                  <Send :size="13" /> <strong>Test API tại chỗ</strong>
                  <span class="muted" style="margin-left:auto; font-size:11px">Edit path để fill <code>:id</code> hoặc query, sau đó Run.</span>
                </div>
                <div class="try-row">
                  <label>Auth</label>
                  <span class="muted-sm">Sẽ gửi <code>X-Customer-Key</code> với token cá nhân của bạn ở trên.</span>
                </div>
                <div class="try-row">
                  <label>URL</label>
                  <div class="url-line">
                    <span class="url-base">{{ baseUrl }}</span>
                    <input v-model="tryState[tryKeyOf(g.id, i)].path" class="url-input" />
                  </div>
                </div>
                <div v-if="e.method !== 'GET' && e.method !== 'DELETE'" class="try-row">
                  <label>Body (JSON)</label>
                  <textarea v-model="tryState[tryKeyOf(g.id, i)].body" class="body-input" rows="5" :placeholder="e.request || '{}'"></textarea>
                </div>
                <div class="try-actions">
                  <button class="primary-action" type="button" :disabled="tryState[tryKeyOf(g.id, i)].busy" @click="runTry(g.id, i, e)">
                    <Play :size="12" /> {{ tryState[tryKeyOf(g.id, i)].busy ? 'Đang gọi…' : `Run ${e.method}` }}
                  </button>
                  <span v-if="tryState[tryKeyOf(g.id, i)].status != null" class="resp-meta">
                    <span :class="['status-chip', tryState[tryKeyOf(g.id, i)].status < 300 ? 'ok' : tryState[tryKeyOf(g.id, i)].status < 400 ? 'warn' : 'err']">{{ tryState[tryKeyOf(g.id, i)].status }}</span>
                    <span class="muted">{{ tryState[tryKeyOf(g.id, i)].durationMs }}ms</span>
                  </span>
                </div>
                <div v-if="tryState[tryKeyOf(g.id, i)].error" class="error-text">{{ tryState[tryKeyOf(g.id, i)].error }}</div>
                <div v-if="tryState[tryKeyOf(g.id, i)].response" class="code-block">
                  <header>
                    <ArrowRight :size="12" /> Response body
                    <button type="button" class="ghost-button mini" style="margin-left:auto" @click="copy(tryState[tryKeyOf(g.id, i)].response)"><Copy :size="11" /></button>
                  </header>
                  <pre>{{ tryState[tryKeyOf(g.id, i)].response }}</pre>
                </div>
              </div>
            </div>
          </article>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Quick-start flow steps */
.flow-steps {
  list-style: none;
  padding: 0;
  margin: 14px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.flow-step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.flow-num {
  flex: none;
  width: 28px; height: 28px;
  border-radius: 8px;
  background: var(--green-soft);
  color: var(--green);
  font-family: var(--mono); font-weight: 700; font-size: 13px;
  display: grid; place-items: center;
}
.flow-step strong { font-size: 13.5px; color: var(--text); }


.apidocs { display: flex; flex-direction: column; gap: 20px; padding-bottom: 40px; }
.apidocs-head .eyebrow { color: var(--pxl); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 4px; }
.apidocs-head h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
.apidocs-head .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }

.key-card {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  background: linear-gradient(135deg, rgba(63, 185, 80, 0.08) 0%, transparent 60%), var(--pxl-card);
  border: 1px solid var(--pxl-bd);
  border-radius: 14px;
  padding: 16px 20px;
}
.key-left { display: flex; align-items: center; gap: 12px; }
.key-left .ico {
  width: 36px; height: 36px; border-radius: 9px;
  background: rgba(63, 185, 80, 0.16); color: var(--pxl);
  display: grid; place-items: center;
}
.key-left strong { color:var(--text); font-size: 14px; }
.key-left .muted { font-size: 11.5px; color: var(--muted); margin: 2px 0 0; }
.key-right { display: inline-flex; align-items: center; gap: 8px; }
.key-val {
  font-family: 'JetBrains Mono', monospace; font-size: 13px;
  color: var(--pxl); background: var(--pxl-card-2);
  padding: 7px 12px; border-radius: 7px;
  border: 1px solid var(--pxl-bd-soft);
}
.key-val.blurred { filter: blur(5px); user-select: none; }

.docs-layout { display: grid; grid-template-columns: 220px 1fr; gap: 18px; align-items: start; }
.docs-nav {
  position: sticky; top: 80px;
  background: var(--pxl-card); border: 1px solid var(--pxl-bd);
  border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 2px;
}
.docs-nav h4 { margin: 0 4px 8px; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
.docs-nav button {
  display: flex; align-items: center; gap: 9px;
  background: transparent; border: none; color: var(--muted);
  padding: 8px 10px; border-radius: 7px;
  text-align: left; font: inherit; font-size: 13px; cursor: pointer;
  transition: 120ms;
}
.docs-nav button:hover { background: var(--pxl-card-2); color:var(--text); }
.docs-nav button.active { background: var(--pxl-soft); color:var(--text); font-weight: 600; }
.docs-nav button.active svg { color: var(--pxl); }
.docs-nav button .count { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--muted); background: var(--pxl-card-2); padding: 1px 6px; border-radius: 5px; }

.docs-body article { display: flex; flex-direction: column; gap: 18px; }
.docs-body h2 { margin: 0; font-size: 22px; font-weight: 700; }
.docs-body .muted { color: var(--muted); font-size: 13px; margin: 0; }

.endpoint {
  background: var(--pxl-card); border: 1px solid var(--pxl-bd);
  border-radius: 12px; padding: 16px 18px;
  display: flex; flex-direction: column; gap: 12px;
}
.ep-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.method {
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
  padding: 3px 8px; border-radius: 5px; letter-spacing: 0.04em;
}
.method.m-get    { background: rgba(34, 197, 94, 0.16);  color: #22c55e; }
.method.m-post   { background: rgba(59, 130, 246, 0.16); color: #60a5fa; }
.method.m-patch  { background: rgba(245, 158, 11, 0.16); color: #f59e0b; }
.method.m-delete { background: rgba(239, 68, 68, 0.16);  color: #ef4444; }
.path { font-family: 'JetBrains Mono', monospace; font-size: 13px; color:var(--text); }
.ep-desc { color: var(--muted); font-size: 12.5px; margin: 0; }

.ep-blocks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 800px) { .ep-blocks { grid-template-columns: 1fr; } .docs-layout { grid-template-columns: 1fr; } .docs-nav { position: static; } }

.code-block { background: #0a0e14; border: 1px solid var(--pxl-bd-soft); border-radius: 8px; overflow: hidden; }
.code-block header {
  display: flex; align-items: center; gap: 6px;
  background: var(--pxl-card-2); padding: 6px 12px;
  font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
  border-bottom: 1px solid var(--pxl-bd-soft);
}
.code-block pre {
  margin: 0; padding: 12px 14px; overflow-x: auto;
  font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.55;
  color: #d1d5db; background: transparent;
}
.code-block.curl pre { color: #4ade80; }

.ghost-button.mini { padding: 3px 7px; font-size: 10.5px; }
.try-btn { color: var(--green); border-color: rgba(34,197,94,0.35) !important; }

/* Two-column credentials grid: API key + Bearer token side by side */
.creds-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 900px) { .creds-grid { grid-template-columns: 1fr; } }
.key-card .badge {
  display: inline-block; margin-left: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
  padding: 1px 6px; border-radius: 4px;
  background: rgba(255,255,255,0.08); color: var(--muted);
  text-transform: none; letter-spacing: 0;
  vertical-align: 1px;
}
.key-val { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* "Try it" panel — appears inline under each endpoint when opened */
.try-panel {
  margin-top: 4px;
  background: rgba(34,197,94,0.04);
  border: 1px solid rgba(34,197,94,0.22);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.try-head { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.try-head .muted { color: var(--muted); font-weight: 400; }
.try-head code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; }
.try-row { display: grid; grid-template-columns: 70px 1fr; gap: 10px; align-items: start; }
.try-row > label { font-size: 11.5px; color: var(--muted); padding-top: 6px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.auth-toggle { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 4px; }
.auth-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.auth-opt input[disabled] + * { color: var(--muted); }
.url-line {
  display: flex; align-items: stretch;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg); overflow: hidden;
}
.url-base { padding: 6px 10px; color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 12px; border-right: 1px solid var(--border); white-space: nowrap; }
.url-input { flex: 1; min-width: 0; border: none; background: transparent; color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; padding: 6px 10px; outline: none; }
.body-input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px;
  color: var(--text);
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  padding: 8px 10px;
  resize: vertical;
}
.body-input:focus, .url-input:focus { outline: none; }
.try-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.resp-meta { display: inline-flex; align-items: center; gap: 8px; }
.status-chip {
  font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 700;
  padding: 2px 8px; border-radius: 5px;
}
.status-chip.ok   { background: rgba(34,197,94,0.18);  color: #22c55e; }
.status-chip.warn { background: rgba(245,158,11,0.18); color: #f59e0b; }
.status-chip.err  { background: rgba(239,68,68,0.18);  color: #ef4444; }
.error-text { color: #ef4444; font-size: 12px; }
</style>
