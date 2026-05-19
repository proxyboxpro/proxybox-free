<script setup>
import { onMounted, ref, computed } from 'vue'
import { apiFetch } from '../api'

const account = ref(null)
const proxies = ref([])
const billing = ref(null)
const txList = ref([])
const pricing = ref(null)
const ordersList = ref([])
const topupAmount = ref(100000)
const buy = ref({ type: 'ipv4', quantity: 1, duration: 30, rotate: false, autoRenew: false, coupon: '' })
const totp = ref({ secret: '', otpauthUri: '', code: '' })
const password = ref({ old: '', neu: '' })
const webhook = ref({ url: '' })
const busy = ref(false)
const err = ref('')
const flash = ref('')

async function refresh() {
  try {
    account.value = await apiFetch('/api/v1/user/account')
    webhook.value.url = account.value.webhookUrl || ''
    proxies.value = await apiFetch('/api/v1/user/proxies')
    billing.value = await apiFetch('/api/v1/user/billing')
    const tx = await apiFetch('/api/v1/user/billing/transactions?limit=20')
    txList.value = tx.items || []
    pricing.value = await apiFetch('/api/v1/user/pricing')
    ordersList.value = await apiFetch('/api/v1/user/orders')
  } catch (e) { err.value = e.message }
}

async function topup() {
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const session = await apiFetch('/api/v1/user/billing/checkout', { method: 'POST', body: { amount: Math.max(10000, Number(topupAmount.value) || 0) } })
    if (session.url) window.location.href = session.url
    else flash.value = 'Checkout session created.'
  } catch (e) { err.value = e.message } finally { busy.value = false }
}
async function placeOrder() {
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch('/api/v1/user/orders', { method: 'POST', body: buy.value })
    flash.value = `Order ${r.order.id} provisioned. ${r.proxies.length} proxies. Balance: ${r.balance.toLocaleString()}`
    buy.value.coupon = ''
    await refresh()
  } catch (e) { err.value = e.message } finally { busy.value = false }
}
async function toggleAutoRenew(order) {
  await apiFetch(`/api/v1/user/orders/${order.id}`, { method: 'PATCH', body: { autoRenew: !order.autoRenew } })
  await refresh()
}
async function cancelOrder(order) {
  if (!confirm(`Cancel order ${order.id}? Remaining days will be refunded to wallet.`)) return
  try { const r = await apiFetch(`/api/v1/user/orders/${order.id}/cancel`, { method: 'POST' }); flash.value = `Refunded ${r.refund.toLocaleString()} → balance ${r.balance.toLocaleString()}`; await refresh() }
  catch (e) { err.value = e.message }
}
async function enrollTotp() {
  busy.value = true; err.value = ''
  try { const r = await apiFetch('/api/v1/user/auth/totp/enroll', { method: 'POST' }); totp.value.secret = r.secret; totp.value.otpauthUri = r.otpauthUri }
  catch (e) { err.value = e.message } finally { busy.value = false }
}
async function confirmTotp() {
  busy.value = true; err.value = ''
  try { await apiFetch('/api/v1/user/auth/totp/confirm', { method: 'POST', body: { code: totp.value.code } }); flash.value = '2FA enabled.'; totp.value = { secret: '', otpauthUri: '', code: '' }; await refresh() }
  catch (e) { err.value = e.message } finally { busy.value = false }
}
async function disableTotp() {
  const code = prompt('Enter current TOTP code to disable 2FA:')
  if (!code) return
  try { await apiFetch('/api/v1/user/auth/totp/disable', { method: 'POST', body: { code } }); flash.value = '2FA disabled.'; await refresh() }
  catch (e) { err.value = e.message }
}
async function regenerateApiKey() {
  if (!confirm('Regenerate API key? Existing scripts using the old key will stop working.')) return
  try { const r = await apiFetch('/api/v1/user/account/regenerate-api-key', { method: 'POST' }); account.value.apiKey = r.apiKey; flash.value = 'API key rotated.' }
  catch (e) { err.value = e.message }
}
async function saveWebhook() {
  try { await apiFetch('/api/v1/user/account/webhook', { method: 'PATCH', body: { url: webhook.value.url } }); flash.value = 'Webhook saved.' }
  catch (e) { err.value = e.message }
}
async function changePassword() {
  try { await apiFetch('/api/v1/user/account/change-password', { method: 'POST', body: { oldPassword: password.value.old, newPassword: password.value.neu } }); flash.value = 'Password changed — please log in again.'; setTimeout(() => location.href = '/vi/login', 1500) }
  catch (e) { err.value = e.message }
}
function gdprExport() { window.open('/api/v1/user/gdpr/export', '_blank') }
function exportTxt() { window.open('/api/v1/user/proxies/export?format=txt', '_blank') }
function exportCsv() { window.open('/api/v1/user/proxies/export?format=csv', '_blank') }
function invoiceLink(id) { return `/api/v1/user/orders/${id}/invoice` }
function copy(t) { navigator.clipboard?.writeText(t) }

const balance = computed(() => billing.value?.wallet?.balance ?? 0)
const orderTotal = computed(() => {
  if (!pricing.value) return 0
  const perDay = buy.value.type === 'ipv6' ? pricing.value.ipv6.perDay : pricing.value.ipv4.perDay
  const base = perDay * Math.max(1, Number(buy.value.duration) || 1) * Math.max(1, Number(buy.value.quantity) || 1)
  // Volume tier preview (client-side hint only; server is authoritative)
  const tiers = (pricing.value.tiers || []).filter((t) => buy.value.quantity >= (t.min || 0)).sort((a, b) => b.min - a.min)
  const td = tiers[0]?.discount || 0
  return Math.round(base * (1 - td))
})

onMounted(refresh)
</script>

<template>
  <section class="page-stack" style="padding:18px; max-width:980px; margin:0 auto">
    <div class="toolbar">
      <span class="eyebrow">Customer portal</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section v-if="account" class="surface">
      <div class="section-head"><h2>Account</h2></div>
      <div class="detail-grid">
        <div><span>Name</span><strong>{{ account.name }}</strong></div>
        <div><span>Email</span><strong class="cell-mono">{{ account.email }}</strong></div>
        <div><span>2FA</span><strong>{{ account.totpEnabled ? 'enabled' : 'disabled' }}</strong></div>
        <div><span>Referral code</span><strong class="cell-mono">{{ account.referralCode }} <button class="ghost-button" type="button" style="padding:0 6px" @click="copy(account.referralCode)">copy</button></strong></div>
        <div><span>ToS accepted</span><strong>{{ account.tosAcceptedAt || '—' }}</strong></div>
      </div>
    </section>

    <section class="surface">
      <div class="section-head"><h2>Wallet</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Balance</div><div class="metric-value">{{ balance.toLocaleString() }} {{ pricing?.currency?.toUpperCase() || 'VND' }}</div></div>
        <div class="metric-card"><div class="metric-label">Active proxies</div><div class="metric-value">{{ proxies.length }}</div></div>
        <div class="metric-card"><div class="metric-label">Orders</div><div class="metric-value">{{ ordersList.length }}</div></div>
      </div>
      <div class="form-grid" style="margin-top:14px; max-width:380px">
        <label class="input-field"><span>Top up (VND)</span><input v-model.number="topupAmount" type="number" min="10000" step="10000" /></label>
      </div>
      <button class="primary-action small" type="button" :disabled="busy" @click="topup">{{ busy ? '...' : 'Pay with Stripe →' }}</button>
    </section>

    <section v-if="pricing" class="surface">
      <div class="section-head"><h2>Buy proxies</h2></div>
      <p class="empty-text" style="text-align:left; margin-bottom:10px">
        IPv4 <strong>{{ pricing.ipv4.perDay.toLocaleString() }}</strong> /day · IPv6 <strong>{{ pricing.ipv6.perDay.toLocaleString() }}</strong> /day · {{ pricing.currency.toUpperCase() }}
        <span v-if="pricing.tiers?.length"><br>Volume: <span v-for="t in pricing.tiers" :key="t.min">{{ t.min }}+: -{{ (t.discount*100).toFixed(0) }}% · </span></span>
      </p>
      <div class="form-grid">
        <label class="input-field"><span>Type</span>
          <select v-model="buy.type"><option value="ipv4">IPv4</option><option value="ipv6">IPv6</option></select>
        </label>
        <label class="input-field"><span>Quantity</span><input v-model.number="buy.quantity" type="number" min="1" max="50" /></label>
        <label class="input-field"><span>Days</span><input v-model.number="buy.duration" type="number" :min="pricing.minDays" :max="pricing.maxDays" /></label>
        <label class="input-field"><span>Coupon (optional)</span><input v-model="buy.coupon" placeholder="LAUNCH10" /></label>
      </div>
      <label v-if="buy.type === 'ipv6'" class="check-line" style="margin-top:8px"><input v-model="buy.rotate" type="checkbox" /><span>Rotating exit IP</span></label>
      <label class="check-line" style="margin-top:6px"><input v-model="buy.autoRenew" type="checkbox" /><span>Auto-renew</span></label>
      <p style="margin-top:10px; font-size:13px">Estimated total: <strong>{{ orderTotal.toLocaleString() }}</strong> {{ pricing.currency.toUpperCase() }}</p>
      <button class="primary-action small" type="button" :disabled="busy" @click="placeOrder">Place order</button>
    </section>

    <section v-if="ordersList.length" class="surface">
      <div class="section-head"><h2>My orders</h2></div>
      <div class="data-table">
        <div v-for="o in ordersList" :key="o.id" class="table-row" style="grid-template-columns: 1fr 1.5fr 1fr 1.2fr auto">
          <span class="cell-mono">{{ o.id }}</span>
          <span>{{ o.item }}</span>
          <span class="cell-mono">{{ Number(o.amount).toLocaleString() }}</span>
          <span><span class="tag">{{ o.status }}</span><span v-if="o.autoRenew" class="tag" style="margin-left:6px; background:#dcfce7;color:#166534">auto-renew</span></span>
          <span class="action-row">
            <a class="ghost-button" :href="invoiceLink(o.id)" target="_blank">Invoice</a>
            <button class="ghost-button" type="button" @click="toggleAutoRenew(o)">{{ o.autoRenew ? 'Disable AR' : 'Enable AR' }}</button>
            <button v-if="o.status === 'paid'" class="ghost-button" type="button" @click="cancelOrder(o)">Cancel</button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="account" class="surface">
      <div class="section-head"><h2>Security</h2></div>
      <div class="split-2">
        <div>
          <h3 style="font-size:14px; margin:0 0 8px">Two-factor authentication</h3>
          <p v-if="account.totpEnabled" class="empty-text" style="text-align:left">2FA is enabled. <button class="ghost-button" type="button" @click="disableTotp">Disable</button></p>
          <template v-else>
            <button v-if="!totp.secret" class="primary-action small" type="button" :disabled="busy" @click="enrollTotp">Enable 2FA</button>
            <template v-else>
              <p style="font-size:12.5px; word-break:break-all">Secret: <code>{{ totp.secret }}</code></p>
              <p style="font-size:12.5px; word-break:break-all">URI: <code>{{ totp.otpauthUri }}</code></p>
              <p class="empty-text" style="text-align:left">Add to authenticator (Google Authenticator/Authy/1Password). Then enter the 6-digit code:</p>
              <div class="form-grid" style="max-width:200px">
                <label class="input-field"><span>Code</span><input v-model="totp.code" maxlength="6" inputmode="numeric" /></label>
              </div>
              <button class="primary-action small" type="button" :disabled="busy" @click="confirmTotp">Confirm</button>
            </template>
          </template>
        </div>
        <div>
          <h3 style="font-size:14px; margin:0 0 8px">Change password</h3>
          <div class="form-grid">
            <label class="input-field"><span>Current</span><input v-model="password.old" type="password" /></label>
            <label class="input-field"><span>New (8+ chars, upper/lower/digit)</span><input v-model="password.neu" type="password" /></label>
          </div>
          <button class="ghost-button" type="button" @click="changePassword">Change password</button>
        </div>
      </div>
    </section>

    <section v-if="account" class="surface">
      <div class="section-head"><h2>API access</h2></div>
      <p style="font-size:13px; margin:0 0 6px">Use header <code>X-Customer-Key: &lt;key&gt;</code> with any <code>/api/v1/user/*</code> endpoint for programmatic access.</p>
      <div class="credential-box"><code>{{ account.apiKey }}</code> <button class="ghost-button" type="button" @click="copy(account.apiKey)">Copy</button> <button class="ghost-button" type="button" @click="regenerateApiKey">Rotate</button></div>
      <h3 style="font-size:14px; margin:16px 0 6px">Notification webhook (HTTP POST on events)</h3>
      <div class="form-grid" style="max-width:520px">
        <label class="input-field"><span>URL</span><input v-model="webhook.url" placeholder="https://your-server/proxyhub-events" /></label>
      </div>
      <button class="ghost-button" type="button" @click="saveWebhook">Save webhook</button>
    </section>

    <section v-if="txList.length" class="surface">
      <div class="section-head"><h2>Transactions</h2></div>
      <div class="data-table">
        <div v-for="(t, i) in txList" :key="i" class="table-row" style="grid-template-columns: 1.4fr .8fr 1fr 1fr 2fr">
          <span class="cell-mono">{{ t.ts.slice(0, 19).replace('T', ' ') }}</span>
          <span><span class="tag">{{ t.type }}</span></span>
          <span class="cell-mono" :style="{color: t.amount > 0 ? '#15803d' : '#b91c1c'}">{{ Number(t.amount).toLocaleString() }}</span>
          <span class="cell-mono">{{ Number(t.balanceAfter).toLocaleString() }}</span>
          <span style="color:var(--muted)">{{ t.note }}</span>
        </div>
      </div>
    </section>

    <section class="surface">
      <div class="section-head">
        <h2>My proxies ({{ proxies.length }})</h2>
        <div class="action-row">
          <button class="ghost-button" type="button" :disabled="!proxies.length" @click="exportTxt">Export .txt</button>
          <button class="ghost-button" type="button" :disabled="!proxies.length" @click="exportCsv">Export .csv</button>
        </div>
      </div>
      <p v-if="!proxies.length" class="empty-text">No proxies yet — top up + place an order above.</p>
      <div v-else class="data-table">
        <div v-for="p in proxies" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.5fr 1.4fr auto">
          <span>{{ p.name }}<span v-if="p.country" class="tag" style="margin-left:6px">{{ p.country.toUpperCase() }}</span></span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
          <span class="cell-mono">{{ p.username }}:{{ p.password }}</span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
      </div>
    </section>

    <section class="surface">
      <div class="section-head"><h2>Privacy</h2></div>
      <p class="empty-text" style="text-align:left">Download all data we have about you (account, orders, transactions, audit log):</p>
      <button class="ghost-button" type="button" @click="gdprExport">Export my data (JSON)</button>
    </section>
  </section>
</template>
