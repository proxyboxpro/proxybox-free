<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowDownLeft, ArrowUpRight, ChevronRight, CircleDollarSign, CreditCard,
  FileText, Gift, Plus, RefreshCw, Search, Tag, Wallet
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()

const billing = ref(null)
const txs = ref([])
const pricing = ref(null)
const orders = ref([])
const topup = ref(100000)
const busy = ref(false)
const err = ref('')
const flash = ref('')
const txSearch = ref('')
const txFilter = ref('all')
const promoCode = ref('')
const promoInfo = ref(null)   // validate result: { amount, currency, productGroup, validUntil, redeemable, expired, already, full }
const promoBusy = ref(false)
const promoErr = ref('')
const grants = ref([])   // active scoped free-credit grants

async function refresh() {
  err.value = ''
  try {
    billing.value = await apiFetch('/api/v1/user/billing')
    const r = await apiFetch('/api/v1/user/billing/transactions?limit=100')
    txs.value = r.items || []
    pricing.value = await apiFetch('/api/v1/user/pricing')
    orders.value = await apiFetch('/api/v1/user/orders')
    grants.value = await apiFetch('/api/v1/user/credit-grants').catch(() => [])
  } catch (e) { err.value = e.message }
}
function promoGroupLabel(g) {
  if (!g || g === 'all') return t('cust.billing.promoAllProducts')
  return ({ ipv4: 'IPv4', ipv6: 'IPv6', hub: 'Hub' })[g] || g
}
function mapPromoErr(m) {
  return m === 'already redeemed' ? t('cust.billing.promoAlready')
    : m === 'code expired' ? t('cust.billing.promoExpired')
    : m === 'code fully redeemed' ? t('cust.billing.promoFull')
    : (m === 'invalid code' || m === 'code required') ? t('cust.billing.promoInvalid')
    : m
}
async function checkPromo() {
  if (promoBusy.value) return
  promoErr.value = ''; promoInfo.value = null
  const code = promoCode.value.trim().toUpperCase()
  if (!code) return
  promoBusy.value = true
  try { promoInfo.value = await apiFetch(`/api/v1/user/credit-codes/${encodeURIComponent(code)}`) }
  catch (e) { promoErr.value = mapPromoErr(e.message) }
  finally { promoBusy.value = false }
}
async function redeemPromo() {
  if (promoBusy.value) return
  promoErr.value = ''
  const code = promoCode.value.trim().toUpperCase()
  if (!code) return
  promoBusy.value = true
  try {
    const r = await apiFetch('/api/v1/user/credit-codes/redeem', { method: 'POST', body: { code } })
    flash.value = t('cust.billing.promoRedeemed', { amount: Number(r.amount).toLocaleString(), currency: r.currency })
    promoCode.value = ''; promoInfo.value = null
    await refresh()
  } catch (e) { promoErr.value = mapPromoErr(e.message) }
  finally { promoBusy.value = false }
}
async function pay() {
  if (busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/checkout', { method: 'POST', body: { amount: Math.max(10000, Number(topup.value) || 0) } })
    if (r.url) window.location.href = r.url
    else flash.value = t('cust.billing.sessionCreated')
  } catch (e) { err.value = e.message } finally { busy.value = false }
}
async function payWithPaypal() {
  if (busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const amount = Math.max(1, Number(topup.value) || 0)
    const r = await apiFetch('/api/v1/user/billing/paypal/create-order', { method: 'POST', body: { amount } })
    if (r.approveUrl) {
      // Remember the order so on return we can finalize via capture.
      try { sessionStorage.setItem('proxybox.paypal.pending', JSON.stringify({ orderId: r.orderId, ts: Date.now() })) } catch {}
      window.location.href = r.approveUrl
    } else {
      err.value = 'PayPal did not return approve URL'
    }
  } catch (e) { err.value = e.message } finally { busy.value = false }
}
// After PayPal redirects back to our return URL (with ?token=ORDER_ID), finalize the capture.
async function maybeFinalizePaypal() {
  const params = new URLSearchParams(location.search)
  const orderId = params.get('token') || params.get('paypal_order_id')
  if (!orderId) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/paypal/capture', { method: 'POST', body: { orderId } })
    flash.value = r.alreadyCaptured
      ? (t('cust.billing.paypalAlreadyDone') || 'PayPal capture already processed.')
      : (t('cust.billing.paypalSuccess', { amount: Number(r.amount).toLocaleString(), currency: r.currency }) || `PayPal payment received: ${r.amount} ${r.currency}.`)
    try { sessionStorage.removeItem('proxybox.paypal.pending') } catch {}
    history.replaceState(null, '', location.pathname)
    await refresh()
  } catch (e) {
    err.value = `PayPal capture failed: ${e.message}`
  } finally { busy.value = false }
}
function fmtTs(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—' }
function viewOrder(id) { router.push({ name: 'proxies', query: { order: id } }) }
function invoiceUrl(id) { return `/api/v1/user/orders/${id}/invoice` }

// Sign-based filter — backend may use multiple tx.type strings (topup/stripe-deposit/
// bonus/refund/order/cancel-refund/manual-credit). Treat positive amounts as money
// flowing in (deposit/refund/bonus/credit), negative as money flowing out (order/charge).
const currentMonth = computed(() => new Date().toISOString().slice(0, 7))
const monthDeposit = computed(() =>
  txs.value
    .filter((tx) => Number(tx.amount) > 0 && String(tx.ts || '').startsWith(currentMonth.value))
    .reduce((a, tx) => a + Number(tx.amount), 0)
)
const monthSpent = computed(() =>
  txs.value
    .filter((tx) => Number(tx.amount) < 0 && String(tx.ts || '').startsWith(currentMonth.value))
    .reduce((a, tx) => a + Math.abs(Number(tx.amount)), 0)
)

const filteredTx = computed(() => txs.value.filter((tx) => {
  if (txFilter.value !== 'all' && tx.type !== txFilter.value) return false
  if (txSearch.value) {
    const q = txSearch.value.toLowerCase()
    return `${tx.note || ''} ${tx.ts || ''} ${tx.type || ''}`.toLowerCase().includes(q)
  }
  return true
}))

const presets = [50000, 100000, 200000, 500000, 1000000, 2000000]

onMounted(async () => {
  await refresh()
  await maybeFinalizePaypal()
})
</script>

<template>
  <h1>{{ t('cust.nav.topup') }}</h1>
  <p class="sub">{{ t('cust.billing.subtitle') }}</p>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" style="color:#4ade80; font-size:13px">{{ flash }}</p>

  <!-- KPI -->
  <div v-if="billing" class="kpi-row">
    <div class="kpi-card-v2">
      <span class="ico purple"><Wallet :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.side.balance') }}</span>
        <span class="val">{{ Number(billing.wallet.balance).toLocaleString() }}</span>
        <span class="foot"><span class="dot"></span> {{ (pricing?.currency || 'VND').toUpperCase() }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico green"><ArrowDownLeft :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.billing.kpiDeposit') }}</span>
        <span class="val">{{ monthDeposit.toLocaleString() }}</span>
        <span class="foot"><span class="dot"></span> {{ t('cust.billing.thisMonth') }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico amber"><ArrowUpRight :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.billing.kpiSpent') }}</span>
        <span class="val">{{ monthSpent.toLocaleString() }}</span>
        <span class="foot warn"><span class="dot"></span> {{ t('cust.billing.thisMonth') }}</span>
      </div>
    </div>
  </div>

  <div style="display:grid; grid-template-columns: 1fr 360px; gap:18px; align-items:start">
    <!-- LEFT column -->
    <div style="display:flex; flex-direction:column; gap:14px; min-width:0">
      <!-- Topup card -->
      <section class="surface" style="padding:18px">
        <h2 style="margin:0 0 6px; color:var(--text); font-size:16px"><Plus :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.billing.topupTitle') }}</h2>
        <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px">{{ t('cust.billing.topupDesc') }}</p>

        <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap:14px; max-width:560px; margin-bottom:8px">
          <label class="input-field">
            <span>{{ t('cust.billing.amount') }} ({{ (pricing?.currency || 'VND').toUpperCase() }})</span>
            <input v-model.number="topup" type="number" min="10000" step="10000" />
          </label>
          <div class="input-field">
            <span>{{ t('cust.billing.method') }}</span>
            <div style="display:flex; flex-direction:column; gap:6px; padding:6px 11px; background:var(--pxl-card-2); border:1px solid var(--pxl-bd); border-radius:var(--radius-sm); color:var(--text); font-size:13px">
              <span v-if="billing?.paymentMethods?.stripeEnabled" style="display:inline-flex; align-items:center; gap:6px"><CreditCard :size="14" style="color:var(--pxl)" /> Stripe (Card / Apple / Google Pay)</span>
              <span v-if="billing?.paymentMethods?.paypalEnabled" style="display:inline-flex; align-items:center; gap:6px"><CircleDollarSign :size="14" style="color:#1546a0" /> PayPal ({{ billing.paymentMethods.paypalCurrency || 'USD' }})</span>
              <span v-if="!billing?.paymentMethods?.stripeEnabled && !billing?.paymentMethods?.paypalEnabled" style="font-size:11.5px; color:var(--muted)">No payment method enabled — contact admin.</span>
            </div>
          </div>
        </div>

        <div class="chips" style="margin-bottom:14px">
          <button v-for="a in presets" :key="a" type="button" :class="{ active: topup === a }" @click="topup = a">{{ a.toLocaleString() }} VND</button>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:10px">
          <button v-if="billing?.paymentMethods?.stripeEnabled" class="primary-action" type="button" :disabled="busy" @click="pay">
            <CreditCard :size="15" /> {{ busy ? t('common.loading') : t('cust.billing.payVia', { amount: Number(topup).toLocaleString() }) }}
          </button>
          <button v-if="billing?.paymentMethods?.paypalEnabled" class="primary-action" type="button" :disabled="busy" @click="payWithPaypal" style="background:#0070ba; border-color:#0070ba">
            <CircleDollarSign :size="15" /> {{ busy ? t('common.loading') : 'Pay with PayPal' }}
          </button>
        </div>
      </section>

      <!-- Redeem free-credit promo code -->
      <section class="surface" style="padding:18px">
        <h2 style="margin:0 0 6px; color:var(--text); font-size:16px"><Gift :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.billing.promoTitle') }}</h2>
        <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px">{{ t('cust.billing.promoDesc') }}</p>
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; max-width:560px">
          <label class="input-field" style="flex:1 1 200px; margin:0">
            <span>{{ t('cust.billing.promoCode') }}</span>
            <input v-model="promoCode" :placeholder="t('cust.billing.promoPlaceholder')" style="text-transform:uppercase" @keyup.enter="checkPromo" />
          </label>
          <button class="ghost-button" type="button" :disabled="promoBusy || !promoCode.trim()" @click="checkPromo">{{ t('cust.billing.promoCheck') }}</button>
        </div>
        <p v-if="promoErr" class="error-text" style="margin:8px 0 0">{{ promoErr }}</p>
        <div v-if="promoInfo" style="margin-top:12px; padding:12px 14px; background:var(--pxl-card-2); border:1px solid var(--pxl-bd); border-radius:10px; max-width:560px">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-bottom:6px"><span style="color:var(--muted)">{{ t('cust.billing.promoValue') }}</span><strong class="cell-mono" style="color:var(--green); font-size:15px">+{{ Number(promoInfo.amount).toLocaleString() }} {{ promoInfo.currency }}</strong></div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-bottom:6px"><span style="color:var(--muted)">{{ t('cust.billing.promoGroup') }}</span><span class="tag-soft">{{ promoGroupLabel(promoInfo.productGroup) }}</span></div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px"><span style="color:var(--muted)">{{ t('cust.billing.promoExpiry') }}</span><span class="cell-mono">{{ promoInfo.validUntil || t('cust.billing.promoNoExpiry') }}</span></div>
          <button class="primary-action" type="button" :disabled="promoBusy || !promoInfo.redeemable" @click="redeemPromo" style="margin-top:12px; width:100%">
            <Gift :size="15" /> {{ promoInfo.expired ? t('cust.billing.promoExpired') : promoInfo.already ? t('cust.billing.promoAlready') : promoInfo.full ? t('cust.billing.promoFull') : t('cust.billing.promoRedeem') }}
          </button>
        </div>
      </section>

      <!-- Active scoped free credit -->
      <section class="surface" v-if="grants.length" style="padding:18px">
        <h2 style="margin:0 0 10px; color:var(--text); font-size:15px"><Gift :size="13" style="vertical-align:-2px; color:var(--green)" /> {{ t('cust.billing.grantsTitle') }}</h2>
        <div class="data-table">
          <div class="table-head" style="grid-template-columns: 1fr 1fr 1fr">
            <span>{{ t('cust.billing.promoGroup') }}</span><span>{{ t('cust.billing.promoValue') }}</span><span>{{ t('cust.billing.promoExpiry') }}</span>
          </div>
          <div v-for="(g, i) in grants" :key="i" class="table-row" style="grid-template-columns: 1fr 1fr 1fr">
            <span><span class="tag-soft">{{ promoGroupLabel(g.group) }}</span></span>
            <span class="cell-mono" style="color:var(--green)">{{ Number(g.remaining).toLocaleString() }} {{ g.currency }}</span>
            <span class="cell-mono">{{ g.expiresAt || t('cust.billing.promoNoExpiry') }}</span>
          </div>
        </div>
      </section>

      <!-- Transactions -->
      <section class="dt2">
        <div class="dt2-toolbar">
          <h2 style="margin:0; color:var(--text); font-size:15px">{{ t('cust.billing.txTitle') }} ({{ txs.length }})</h2>
          <div class="spacer"></div>
          <div class="search-box">
            <Search :size="14" />
            <input v-model="txSearch" type="search" :placeholder="t('cust.billing.txSearch')" />
          </div>
          <select v-model="txFilter">
            <option value="all">{{ t('cust.billing.txAll') }}</option>
            <option value="topup">{{ t('cust.billing.txTopup') }}</option>
            <option value="order">{{ t('cust.billing.txOrder') }}</option>
            <option value="refund">{{ t('cust.billing.txRefund') }}</option>
            <option value="bonus">{{ t('cust.billing.txBonus') }}</option>
          </select>
          <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /></button>
        </div>

        <div class="dt2-head" style="grid-template-columns: 1.2fr 0.8fr 1.5fr 0.9fr 0.9fr">
          <span>{{ t('cust.billing.txTime') }}</span>
          <span>{{ t('cust.billing.txType') }}</span>
          <span>{{ t('cust.billing.txNote') }}</span>
          <span>{{ t('cust.orders.col.amount') }}</span>
          <span>{{ t('cust.billing.txBalance') }}</span>
        </div>
        <div v-for="(tx, i) in filteredTx" :key="i" class="dt2-row" style="grid-template-columns: 1.2fr 0.8fr 1.5fr 0.9fr 0.9fr">
          <span class="cell-mono">{{ fmtTs(tx.ts) }}</span>
          <span><span :class="['tag-soft', tx.type === 'topup' ? 'active' : (tx.type === 'order' ? 'datacenter' : (tx.type === 'refund' ? 'mobile' : 'isp'))]">{{ tx.type }}</span></span>
          <span style="color:var(--text); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ tx.note || '—' }}</span>
          <span class="cell-mono" :style="{ color: Number(tx.amount) > 0 ? '#4ade80' : '#f87171' }">{{ Number(tx.amount) > 0 ? '+' : '' }}{{ Number(tx.amount).toLocaleString() }}</span>
          <span class="cell-mono">{{ Number(tx.balanceAfter).toLocaleString() }}</span>
        </div>
        <p v-if="!filteredTx.length" class="empty-text" style="padding:30px">{{ t('cust.billing.txEmpty') }}</p>
      </section>
    </div>

    <!-- RIGHT column -->
    <aside style="display:flex; flex-direction:column; gap:14px; position:sticky; top:80px">
      <!-- Pricing snapshot -->
      <div v-if="pricing" class="px-detail">
        <h3>{{ t('cust.billing.pricingTitle') }}</h3>
        <div class="kv"><span class="k">{{ t('cust.buy.t.ipv4') }}</span><span class="v pxl" style="font-family:var(--mono)">{{ Number(pricing.ipv4.perHour).toLocaleString() }} {{ pricing.currency.toUpperCase() }}/h</span></div>
        <div class="kv"><span class="k">{{ t('cust.buy.t.ipv6') }}</span><span class="v pxl" style="font-family:var(--mono)">{{ Number(pricing.ipv6.perHour).toLocaleString() }} {{ pricing.currency.toUpperCase() }}/h</span></div>
        <div class="kv"><span class="k">{{ t('cust.billing.duration') }}</span><span class="v">{{ pricing.minHours }}h – {{ pricing.maxHours }}h</span></div>
        <div v-if="pricing.tiers?.length" style="margin-top:8px">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px">{{ t('cust.billing.tierDiscount') }}</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px">
            <span v-for="t in pricing.tiers" :key="t.min" class="tag-soft datacenter" style="font-size:10.5px">≥{{ t.min }} → -{{ (Number(t.discount) * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>

      <!-- Recent orders -->
      <div v-if="orders.length" class="px-detail">
        <div class="title-row">
          <h3>{{ t('cust.billing.recentOrders') }}</h3>
          <button class="text-mini" style="color:var(--pxl)" @click="router.push({ name: 'proxies' })">{{ t('cust.viewAll') }} <ChevronRight :size="11" style="vertical-align:-1px" /></button>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px">
          <div v-for="o in orders.slice(0, 5)" :key="o.id" style="display:grid; grid-template-columns: 1fr auto auto; gap:8px; align-items:center; padding:8px 10px; background:var(--pxl-card-2); border-radius:8px; cursor:pointer" @click="viewOrder(o.id)">
            <div style="min-width:0; overflow:hidden">
              <div class="cell-mono" style="font-size:11.5px; color:var(--text)">{{ o.id }}</div>
              <div style="font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ o.item }}</div>
            </div>
            <a class="row-menu" :href="invoiceUrl(o.id)" target="_blank" @click.stop><FileText :size="14" /></a>
            <ChevronRight :size="14" style="color:var(--muted)" />
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>
