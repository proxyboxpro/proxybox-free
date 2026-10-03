<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Grid } from 'ant-design-vue'
import {
  BellOutlined, CloudServerOutlined, LockOutlined, ShoppingCartOutlined, ThunderboltOutlined, ToolOutlined,
  WalletOutlined
} from '@ant-design/icons-vue'
import { apiFetch, token as bearerToken } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const screens = Grid.useBreakpoint()
const account = ref(null)

async function refresh() {
  try { account.value = await apiFetch('/api/v1/user/account') } catch { /* not logged in */ }
}
function copy(text) {
  navigator.clipboard?.writeText(text)
  message.success(t('cust.detail.copied') || 'Copied!')
}

// Customer API key (X-Customer-Key header) — masked unless revealed.
const apiKey = computed(() => account.value?.apiKey || '••••••••••••••••')
const reveal = ref(false)
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
function tryOf(gid, i) { return tryState[tryKeyOf(gid, i)] }
function toggleTry(gid, i, e) {
  const s = ensureTry(gid, i, e)
  s.open = !s.open
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
function statusColor(code) { return code < 300 ? 'success' : code < 400 ? 'warning' : 'error' }
const METHOD_COLOR = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'orange', DELETE: 'red' }

// Endpoint groups. Each endpoint: method + path + description + sample request/response.
const groups = computed(() => [
  {
    id: 'flow', title: 'Quick start', icon: ThunderboltOutlined,
    intro: t('cust.apidocs.g.flowIntro'),
    flow: [
      { step: 1, title: t('cust.apidocs.g.s1t'), detail: t('cust.apidocs.g.s1d') },
      { step: 2, title: t('cust.apidocs.g.s2t'), detail: t('cust.apidocs.g.s2d') },
      { step: 3, title: t('cust.apidocs.g.s3t'), detail: t('cust.apidocs.g.s3d') },
      { step: 4, title: t('cust.apidocs.g.s4t'), detail: t('cust.apidocs.g.s4d') },
      { step: 5, title: t('cust.apidocs.g.s5t'), detail: t('cust.apidocs.g.s5d') }
    ],
    endpoints: []
  },
  {
    id: 'auth', title: 'Authentication', icon: LockOutlined,
    intro: t('cust.apidocs.g.authIntro'),
    endpoints: [
      { method: 'POST', path: '/api/v1/user/auth/login', desc: t('cust.apidocs.g.authLogin'),
        request: '{\n  "email": "you@example.com",\n  "password": "secret"\n}',
        response: '{\n  "token": "abc123...",\n  "user": { "email": "you@example.com", "role": "customer" }\n}' },
      { method: 'GET',  path: '/api/v1/user/auth/me',   desc: t('cust.apidocs.g.authMe'), response: '{ "id": "u-...", "email": "...", "role": "customer", "emailVerified": true }' },
      { method: 'GET',  path: '/api/v1/user/account',   desc: t('cust.apidocs.g.authAccount'), response: '{ "id": "u-...", "name": "...", "balance": 150000, "apiKey": "abc..." }' }
    ]
  },
  {
    id: 'orders', title: t('cust.apidocs.g.ordersTitle'), icon: ShoppingCartOutlined,
    intro: t('cust.apidocs.g.ordersIntro'),
    endpoints: [
      { method: 'POST', path: '/api/v1/user/orders', desc: t('cust.apidocs.g.ordCreate'),
        request: '{\n  "type": "ipv4",\n  "quantity": 5,\n  "hours": 24,\n  "zone": "vn-hcm",\n  "autoRenew": false\n}',
        response: '{\n  "order": {\n    "id": "ORD-170747",\n    "proxyIds": ["px-20005","px-20006","px-20007","px-20008","px-20009"],\n    "totalCost": 49920,\n    "expiresAt": "2026-05-16T03:19:30Z"\n  },\n  "proxies": [\n    {\n      "id": "px-20005",\n      "orderId": "ORD-170747",\n      "bindIp": "103.189.73.2",\n      "port": 20005,\n      "username": "user_20005",\n      "password": "c0549d8275c5",\n      "http": "http://user_20005:c0549d8275c5@103.189.73.2:20005"\n    }, ...\n  ],\n  "balance": 100080\n}' },
      { method: 'GET',  path: '/api/v1/user/zones', desc: t('cust.apidocs.g.ordZones'), response: '[ { "id": "vn-hcm", "name": "Vietnam — HCM", "onlineNodes": 1 } ]' },
      { method: 'GET',  path: '/api/v1/user/pricing', desc: t('cust.apidocs.g.ordPricing'), response: '{ "currency": "VND", "ipv4": { "perHour": 416 }, "ipv6": { "perHour": 291 }, "tiers": [...] }' }
    ]
  },
  {
    id: 'proxies', title: t('cust.apidocs.g.pxTitle'), icon: CloudServerOutlined,
    intro: t('cust.apidocs.g.pxIntro'),
    endpoints: [
      { method: 'GET', path: '/api/v1/user/proxies', desc: t('cust.apidocs.g.pxList'),
        response: '[\n  {\n    "id": "px-20005",\n    "orderId": "ORD-170747",\n    "type": "IPv4",\n    "bindIp": "103.189.73.2",\n    "port": 20005,\n    "username": "user_20005",\n    "password": "...",\n    "http": "http://u:p@host:port",\n    "socks5": "socks5://u:p@host:port",\n    "status": "active",\n    "expiresAt": "2026-05-16T03:19:30Z",\n    "zone": "vn-hcm",\n    "allowedSrcIps": []\n  }\n]' },
      { method: 'GET', path: '/api/v1/user/proxies/export?format=txt', desc: t('cust.apidocs.g.pxExport'),
        response: '103.189.73.2:20005:user_20005:c054...\n103.189.73.3:20006:user_20006:959a...' },
      { method: 'POST', path: '/api/v1/user/proxies/check-bulk', desc: t('cust.apidocs.g.pxCheckBulk'),
        request: '{ "ids": ["px-20005","px-20006","px-20007"] }',
        response: '{\n  "total": 3,\n  "ok": 3,\n  "results": [\n    { "id": "px-20005", "ok": true, "latencyMs": 290 },\n    { "id": "px-20006", "ok": true, "latencyMs": 313 },\n    { "id": "px-20007", "ok": true, "latencyMs": 303 }\n  ]\n}' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/check', desc: t('cust.apidocs.g.pxCheck'), response: '{ "ok": true, "latencyMs": 42, "proxy": { ... } }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/rotate', desc: t('cust.apidocs.g.pxRotate'), response: '{ "id": "px-...", "bindIp": "2602:f9ca:...", ... }' },
      { method: 'POST', path: '/api/v1/user/proxies/:id/extend', desc: t('cust.apidocs.g.pxExtend'),
        request: '{ "hours": 24 }',
        response: '{ "proxy": { "expiresAt": "..." }, "balance": 100080 }' },
      { method: 'DELETE', path: '/api/v1/user/proxies/:id', desc: t('cust.apidocs.g.pxDelete'), response: '{ "ok": true, "id": "px-..." }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/whitelist', desc: t('cust.apidocs.g.pxWlGet'), response: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }' },
      { method: 'PUT', path: '/api/v1/user/proxies/:id/whitelist', desc: t('cust.apidocs.g.pxWlPut'),
        request: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }',
        response: '{ "allowedSrcIps": ["1.2.3.4", "5.6.7.8"] }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/sla?days=30', desc: t('cust.apidocs.g.pxSla'), response: '{ "pct": 99.87, "samples": 720 }' },
      { method: 'GET', path: '/api/v1/user/proxies/:id/history?hours=24', desc: t('cust.apidocs.g.pxHistory'), response: '{ "samples": [ { "hour": "2026-05-15T03", "uploadBytes": 12345, "downloadBytes": 67890, "bpsIn": 1024, "bpsOut": 2048 } ] }' }
    ]
  },
  {
    id: 'tools', title: 'Tools (diagnostics)', icon: ToolOutlined,
    intro: t('cust.apidocs.g.toolsIntro'),
    endpoints: [
      { method: 'POST', path: '/api/v1/user/tools/ping', desc: t('cust.apidocs.g.tPing'),
        request: '{ "ip": "8.8.8.8", "count": 4 }',
        response: '{ "target": "8.8.8.8", "family": "ipv4", "ok": true, "transmitted": 4, "received": 4, "loss": 0, "rtt": { "min": 44.6, "avg": 44.7, "max": 44.9 } }' },
      { method: 'POST', path: '/api/v1/user/tools/ip-info', desc: t('cust.apidocs.g.tIpInfo'),
        request: '{ "ip": "8.8.8.8" }',
        response: '{ "ip": "8.8.8.8", "asn": "AS15169", "cidr": "8.8.8.0/24", "country": "US", "org": "GOOGLE - Google LLC, US" }' },
      { method: 'POST', path: '/api/v1/user/tools/blacklist', desc: t('cust.apidocs.g.tBlacklist'),
        request: '{ "ip": "127.0.0.2" }',
        response: '{ "ip": "127.0.0.2", "total": 10, "listed": 7, "clean": 2, "errors": 1, "results": [ { "name": "Spamhaus ZEN", "listed": true } ] }' },
      { method: 'POST', path: '/api/v1/user/tools/bulk-check', desc: t('cust.apidocs.g.tBulk'),
        request: '{ "lines": "1.2.3.4:8080:user:pass\\nuser:pass@5.6.7.8:1080\\nsocks5://1.2.3.4:1080" }',
        response: '{ "total": 3, "ok": 1, "fail": 2, "results": [ { "idx": 0, "ok": true, "latencyMs": 234, "exitIp": "1.2.3.4" } ] }' },
      { method: 'GET', path: '/api/v1/user/tools/speedtest-isps?country=VN', desc: t('cust.apidocs.g.tSpeedIsps'),
        response: '{ "country": "VN", "countryName": "Vietnam", "totalServers": 20, "isps": [ { "sponsor": "Viettel IDC", "serverCount": 4 } ] }' },
      { method: 'POST', path: '/api/v1/user/tools/speed-test', desc: t('cust.apidocs.g.tSpeed'),
        request: '{ "proxyId": "px-20005", "country": "VN", "isp": "viettel" }',
        response: '{ "ok": true, "mbps": 1470.95, "totalBytes": 31625365, "durationMs": 172, "ttfbMs": 81, "server": { "sponsor": "Viettel Network", "name": "Da Nang", "host": "speedtestkv2a.viettel.vn..." } }' }
    ]
  },
  {
    id: 'billing', title: 'Billing', icon: WalletOutlined,
    intro: t('cust.apidocs.g.billIntro'),
    endpoints: [
      { method: 'GET', path: '/api/v1/user/billing', desc: t('cust.apidocs.g.bGet'), response: '{ "wallet": { "balance": 150000 }, "plan": { "name": "free" }, "recentTx": [ ... ] }' },
      { method: 'GET', path: '/api/v1/user/billing/transactions', desc: t('cust.apidocs.g.bTx'), response: '{ "items": [ { "ts": "...", "type": "topup", "amount": 100000 } ], "total": 42 }' },
      { method: 'POST', path: '/api/v1/user/billing/checkout', desc: t('cust.apidocs.g.bCheckout'), request: '{ "amount": 100000 }', response: '{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }' }
    ]
  },
  {
    id: 'notifs', title: 'Notifications', icon: BellOutlined,
    intro: t('cust.apidocs.g.notifIntro'),
    endpoints: [
      { method: 'GET', path: '/api/v1/user/notifications', desc: t('cust.apidocs.g.nList'), response: '{ "items": [...], "unread": 3 }' },
      { method: 'POST', path: '/api/v1/user/notifications/:id/read', desc: t('cust.apidocs.g.nRead'), response: '{ "ok": true }' },
      { method: 'POST', path: '/api/v1/user/notifications/read-all', desc: t('cust.apidocs.g.nReadAll'), response: '{ "ok": true }' },
      { method: 'DELETE', path: '/api/v1/user/notifications', desc: t('cust.apidocs.g.nDelete'), response: '{ "ok": true }' }
    ]
  }
])

const activeGroup = ref(groups.value[0].id)
function curlSample(method, path, body) {
  const url = `${baseUrl.value}${path}`
  const headers = [`-H "X-Customer-Key: ${reveal.value ? apiKey.value : 'YOUR_API_KEY'}"`]
  if (body) headers.push('-H "Content-Type: application/json"')
  const dataFlag = body ? ` \\\n  -d '${body.replace(/\n/g, '').replace(/\s+/g, ' ')}'` : ''
  return `curl -X ${method} ${url} \\\n  ${headers.join(' \\\n  ')}${dataFlag}`
}
// Code blocks shown under each endpoint: request sample, response sample, cURL.
function blocksFor(e) {
  const out = []
  if (e.request) out.push({ key: 'req', label: 'Request body', text: e.request, xl: 12 })
  if (e.response) out.push({ key: 'res', label: 'Response', text: e.response, xl: e.request ? 12 : 24 })
  out.push({ key: 'curl', label: 'cURL', text: curlSample(e.method, e.path, e.request), xl: 24, curl: true })
  return out
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex align="center" gap="small" wrap="wrap">
      <a-tag color="green" :bordered="false"><BookOutlined /> {{ t('cust.apidocs.eyebrow') }}</a-tag>
      <a-typography-text type="secondary">{{ t('cust.apidocs.sub') }}</a-typography-text>
    </a-flex>

    <!-- Single unified token. Same value works as:
           1) X-Customer-Key header for REST API automation
           2) Authorization Bearer for SDK / session
           3) Fleet enroll token to claim BYON nodes (curl-pipe-bash installer)
         Auto-minted on register. Format: usr_<userId>_<hex>. Rotation rotates
         ALL three uses at once — there's only one key to track. -->
    <a-card class="key-card">
      <a-flex justify="space-between" align="center" wrap="wrap" gap="middle">
        <a-flex align="center" gap="middle" class="key-left">
          <a-avatar shape="square" :size="40" class="key-ico">
            <template #icon><KeyOutlined /></template>
          </a-avatar>
          <div class="min0">
            <a-space :size="6" wrap>
              <a-typography-text strong>{{ t('cust.apidocs.tokenTitle') }}</a-typography-text>
              <a-tag :bordered="false" class="mono badge">{{ t('cust.apidocs.tokenBadge') }}</a-tag>
            </a-space>
            <a-typography-paragraph type="secondary" class="key-desc">
              <span v-html="t('cust.apidocs.tokenDesc')"></span>
            </a-typography-paragraph>
          </div>
        </a-flex>
        <a-flex align="center" gap="small" class="key-right">
          <a-typography-text code class="mono key-val" :class="{ blurred: !reveal }">{{ apiKey }}</a-typography-text>
          <a-button @click="reveal = !reveal">
            <template #icon><EyeInvisibleOutlined v-if="reveal" /><EyeOutlined v-else /></template>
            {{ reveal ? t('cust.dash.hide') : t('cust.dash.show') }}
          </a-button>
          <a-button :disabled="!reveal" @click="copy(apiKey)">
            <template #icon><CopyOutlined /></template>
          </a-button>
        </a-flex>
      </a-flex>
    </a-card>

    <!-- Groups nav + content -->
    <a-card :body-style="{ padding: screens.md ? '16px 20px 20px 0' : '4px 12px 16px' }">
      <a-tabs v-model:active-key="activeGroup" :tab-position="screens.md ? 'left' : 'top'" class="docs-tabs">
        <template v-if="screens.md" #leftExtra>
          <a-typography-text type="secondary" class="nav-title">{{ t('cust.apidocs.endpoints') }}</a-typography-text>
        </template>
        <a-tab-pane v-for="g in groups" :key="g.id">
          <template #tab>
            <span class="tab-label">
              <component :is="g.icon" />
              <span>{{ g.title }}</span>
              <a-tag v-if="g.endpoints?.length" :bordered="false" class="count mono">{{ g.endpoints.length }}</a-tag>
              <a-tag v-else-if="g.flow?.length" color="green" :bordered="false" class="count mono">{{ g.flow.length }}</a-tag>
            </span>
          </template>

          <a-flex vertical gap="middle">
            <div>
              <a-typography-title :level="4" class="group-title">{{ g.title }}</a-typography-title>
              <a-typography-paragraph type="secondary" class="group-intro">{{ g.intro }}</a-typography-paragraph>
            </div>

            <!-- Quick-start flow steps (only present on the first group) -->
            <a-steps
              v-if="g.flow?.length"
              direction="vertical"
              size="small"
              :items="g.flow.map((f) => ({ title: f.title, description: f.detail, status: 'process' }))"
            />

            <a-card v-for="(e, i) in g.endpoints" :key="i" size="small" class="endpoint">
              <a-flex align="center" gap="small" wrap="wrap">
                <a-tag :color="METHOD_COLOR[e.method] || 'default'" class="mono method">{{ e.method }}</a-tag>
                <a-typography-text strong class="mono path">{{ e.path }}</a-typography-text>
                <a-space :size="4" class="ep-actions">
                  <a-button size="small" type="text" @click="copy(`${baseUrl}${e.path}`)">
                    <template #icon><CopyOutlined /></template>
                  </a-button>
                  <a-button size="small" :type="tryOf(g.id, i)?.open ? 'default' : 'primary'" :ghost="!tryOf(g.id, i)?.open" @click="toggleTry(g.id, i, e)">
                    <template #icon><CloseOutlined v-if="tryOf(g.id, i)?.open" /><PlayCircleOutlined v-else /></template>
                    {{ tryOf(g.id, i)?.open ? t('cust.apidocs.close') : 'Try it' }}
                  </a-button>
                </a-space>
              </a-flex>
              <a-typography-paragraph type="secondary" class="ep-desc">{{ e.desc }}</a-typography-paragraph>

              <a-row :gutter="[10, 10]">
                <a-col v-for="b in blocksFor(e)" :key="b.key" :xs="24" :xl="b.xl">
                  <a-card size="small" type="inner" class="code-card" :body-style="{ padding: 0 }">
                    <template #title>
                      <span class="code-label"><CodeOutlined v-if="b.key !== 'res'" /><ArrowRightOutlined v-else /> {{ b.label }}</span>
                    </template>
                    <template #extra>
                      <a-button size="small" type="text" @click="copy(b.text)"><template #icon><CopyOutlined /></template></a-button>
                    </template>
                    <pre class="mono code" :class="{ curl: b.curl }">{{ b.text }}</pre>
                  </a-card>
                </a-col>
              </a-row>

              <!-- Interactive try-it panel -->
              <a-card v-if="tryOf(g.id, i)?.open" size="small" class="try-panel">
                <template #title><SendOutlined class="title-ico" /> {{ t('cust.apidocs.tryTitle') }}</template>
                <a-typography-paragraph type="secondary" class="small">
                  <span v-html="t('cust.apidocs.tryHint')"></span>
                </a-typography-paragraph>
                <a-form layout="vertical" :model="tryOf(g.id, i)" @finish="runTry(g.id, i, e)">
                  <a-form-item label="Auth" class="compact-item">
                    <a-typography-text type="secondary" class="small"><span v-html="t('cust.apidocs.willSend')"></span></a-typography-text>
                  </a-form-item>
                  <a-form-item label="URL" class="compact-item">
                    <a-input v-model:value="tryOf(g.id, i).path" class="mono">
                      <template #addonBefore><span class="mono url-base">{{ baseUrl }}</span></template>
                    </a-input>
                  </a-form-item>
                  <a-form-item v-if="e.method !== 'GET' && e.method !== 'DELETE'" label="Body (JSON)" class="compact-item">
                    <a-textarea v-model:value="tryOf(g.id, i).body" :rows="5" class="mono" :placeholder="e.request || '{}'" />
                  </a-form-item>
                  <a-space wrap>
                    <a-button type="primary" html-type="submit" :loading="tryOf(g.id, i).busy">
                      <template #icon><PlayCircleOutlined /></template>
                      {{ tryOf(g.id, i).busy ? t('cust.apidocs.calling') : `Run ${e.method}` }}
                    </a-button>
                    <template v-if="tryOf(g.id, i).status != null">
                      <a-tag :color="statusColor(tryOf(g.id, i).status)" class="mono">{{ tryOf(g.id, i).status }}</a-tag>
                      <a-typography-text type="secondary" class="mono small">{{ tryOf(g.id, i).durationMs }}ms</a-typography-text>
                    </template>
                  </a-space>
                </a-form>
                <a-alert v-if="tryOf(g.id, i).error" type="error" show-icon :message="tryOf(g.id, i).error" class="try-gap" />
                <a-card v-if="tryOf(g.id, i).response" size="small" type="inner" class="code-card try-gap" :body-style="{ padding: 0 }">
                  <template #title><span class="code-label"><ArrowRightOutlined /> Response body</span></template>
                  <template #extra>
                    <a-button size="small" type="text" @click="copy(tryOf(g.id, i).response)"><template #icon><CopyOutlined /></template></a-button>
                  </template>
                  <pre class="mono code">{{ tryOf(g.id, i).response }}</pre>
                </a-card>
              </a-card>
            </a-card>
          </a-flex>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<style scoped>
.min0 { min-width: 0; }
.small { font-size: 12px; }
.title-ico { color: var(--pb-primary); }

.key-card { background-image: linear-gradient(135deg, var(--pb-primary-soft) 0%, transparent 60%); }
.key-left { flex: 1 1 360px; min-width: 0; }
.key-ico { background: var(--pb-primary-soft); color: var(--pb-primary); flex: none; }
.key-desc { margin: 4px 0 0 !important; font-size: 12px; }
.badge { font-size: 10.5px; margin: 0; }
.key-right { flex: 0 1 auto; min-width: 0; max-width: 100%; }
.key-val { max-width: 260px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; transition: filter 120ms; }
.key-val.blurred { filter: blur(5px); user-select: none; }

.docs-tabs :deep(.ant-tabs-nav) { min-width: 0; }
.nav-title { display: block; padding: 0 24px 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.tab-label { display: inline-flex; align-items: center; gap: 8px; }
.count { margin: 0; font-size: 10.5px; line-height: 16px; padding: 0 6px; }
.group-title { margin: 0 0 4px !important; }
.group-intro { margin: 0 !important; }

.method { font-weight: 700; margin: 0; }
.path { word-break: break-all; }
.ep-actions { margin-inline-start: auto; }
.ep-desc { margin: 8px 0 12px !important; font-size: 12.5px; }

.code-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--pb-text-3); }
.code { margin: 0; padding: 10px 12px; max-height: 360px; overflow: auto; font-size: 11.5px; line-height: 1.55; white-space: pre; word-break: normal; background: var(--pb-bg); border-radius: 0 0 8px 8px; }
.code.curl { color: var(--pb-success); }

.try-panel { margin-top: 12px; border-color: var(--pb-primary); }
.compact-item { margin-bottom: 12px; }
.url-base { font-size: 12px; }
.try-gap { margin-top: 12px; }

@media (max-width: 575px) {
  .key-val { max-width: none; flex: 1 1 auto; }
  .ep-actions { margin-inline-start: 0; }
}
</style>
