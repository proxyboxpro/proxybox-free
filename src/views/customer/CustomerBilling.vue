<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BankOutlined, CreditCardOutlined, DollarOutlined, WalletOutlined } from '@ant-design/icons-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'
import { isDark } from '../../theme'

const { t } = useI18n()
const router = useRouter()

const billing = ref(null)
const txs = ref([])
const pricing = ref(null)
const orders = ref([])
const topup = ref(100000)
const busy = ref(false)
const err = ref('')
// Action failures: toast + keep the inline a-alert visible.
function fail(msg) { err.value = msg; message.error(msg) }
const txSearch = ref('')
const txFilter = ref('all')
const promoCode = ref('')
const promoInfo = ref(null)   // validate result: { amount, currency, productGroup, validUntil, redeemable, expired, already, full }
const promoBusy = ref(false)
const promoErr = ref('')
const grants = ref([])   // active scoped free-credit grants

async function refresh() {
  err.value = ''
  const firstLoad = !billing.value
  try {
    billing.value = await apiFetch('/api/v1/user/billing')
    const r = await apiFetch('/api/v1/user/billing/transactions?limit=100')
    txs.value = r.items || []
    pricing.value = await apiFetch('/api/v1/user/pricing')
    orders.value = await apiFetch('/api/v1/user/orders')
    grants.value = await apiFetch('/api/v1/user/credit-grants').catch(() => [])
    // Default the top-up field to the highest minimum among enabled gateways
    // so the pre-filled amount is accepted by every pay button as-is.
    if (firstLoad) {
      const pm = billing.value?.paymentMethods || {}
      const mins = []
      if (pm.binanceEnabled && Number(pm.binanceMin) > 0) {
        const rate = Number(pm.binanceRate) > 0 ? Number(pm.binanceRate) : 25000
        mins.push(Math.ceil(Number(pm.binanceMin) * rate))
      }
      if (pm.paypalEnabled && Number(pm.paypalMin) > 0) {
        const payCur = (pm.paypalCurrency || 'USD').toUpperCase()
        const walletCur = (pm.walletCurrency || 'VND').toUpperCase()
        const rate = Number(pm.paypalRate) > 0 ? Number(pm.paypalRate) : 25000
        mins.push(Math.ceil(Number(pm.paypalMin) * (payCur === walletCur ? 1 : rate)))
      }
      if (mins.length) topup.value = Math.max(...mins)
    }
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
    message.success(t('cust.billing.promoRedeemed', { amount: Number(r.amount).toLocaleString(), currency: r.currency }))
    promoCode.value = ''; promoInfo.value = null
    await refresh()
  } catch (e) { promoErr.value = mapPromoErr(e.message) }
  finally { promoBusy.value = false }
}
async function pay() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    const amount = Math.max(10000, Math.floor(Number(topup.value) || 0))
    const pm = billing.value?.paymentMethods || {}
    const min = Number(pm.stripeMin) || 0
    const rate = Number(pm.stripeRate) > 0 ? Number(pm.stripeRate) : 25000
    const walletCur = (pm.walletCurrency || 'VND').toUpperCase()
    if (min > 0) {
      const minWallet = walletCur === 'USD' ? min : min * rate
      if (amount + 1e-9 < minWallet) {
        fail(t('cust.billing.stripeMinErr', { min, wallet: Math.ceil(minWallet).toLocaleString(), walletCur }))
        busy.value = false; return
      }
    }
    const r = await apiFetch('/api/v1/user/billing/checkout', { method: 'POST', body: { amount } })
    if (r.url) window.location.href = r.url
    else message.success(t('cust.billing.sessionCreated'))
  } catch (e) { fail(e.message) } finally { busy.value = false }
}
// ─── SePay (VN bank transfer) ──────────────────────────────────────
const sepayOpen = ref(false)
const sepayData = ref(null)         // { qrUrl, memo, amount, bank }
const sepayPollMs = ref(0)
const sepayCheck = ref(null)        // matched txn from /sepay/latest
let sepayPollTimer = null
async function payWithSepay() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    const amount = Math.max(10000, Math.floor(Number(topup.value) || 0))
    const r = await apiFetch(`/api/v1/user/billing/sepay/qr?amount=${amount}`)
    sepayData.value = r
    sepayOpen.value = true
    sepayPollMs.value = Date.now()
    sepayCheck.value = null
    // Poll every 5s for up to 15 min. On a hit, stop + refresh wallet.
    sepayPollTimer = setInterval(async () => {
      try {
        const r2 = await apiFetch(`/api/v1/user/billing/sepay/latest?sinceMs=${sepayPollMs.value}`)
        const hit = (r2.hits || []).find((h) => Number(h.amount) >= Number(sepayData.value.amount))
        if (hit) {
          sepayCheck.value = hit
          clearInterval(sepayPollTimer); sepayPollTimer = null
          message.success(t('cust.billing.sepayHit', { amount: Number(hit.amount).toLocaleString() }))
          await refresh()
        }
      } catch { /* keep polling */ }
    }, 5000)
    setTimeout(() => { if (sepayPollTimer) { clearInterval(sepayPollTimer); sepayPollTimer = null } }, 15 * 60_000)
  } catch (e) { fail(e.message) } finally { busy.value = false }
}
function closeSepay() {
  sepayOpen.value = false
  if (sepayPollTimer) { clearInterval(sepayPollTimer); sepayPollTimer = null }
}
// ─── USDT via Binance deposit address (BEP20) ──────────────────────
const usdtOpen = ref(false)
const usdtData = ref(null)          // { id, address, coin, network, usdtAmount, creditAmount, expiresAt }
const usdtPaid = ref(null)          // status payload once matched
const usdtLeft = ref('')
let usdtPollTimer = null
let usdtTickTimer = null
// QR tab: 'binance' = plain address (the Binance app scanner prefills the
// address in its Send flow), 'wallet' = EIP-681 URI (on-chain wallets prefill
// contract + chain + exact amount).
const qrTab = ref('binance')
const usdtQrPayload = computed(() => {
  const d2 = usdtData.value
  if (!d2) return ''
  if (qrTab.value === 'wallet' && d2.contract && d2.chainId) {
    const dec = Number(d2.tokenDecimals) >= 4 ? Number(d2.tokenDecimals) : 18
    // usdtAmount has exactly 4 decimals → integer token units without float drift.
    const units = (BigInt(Math.round(Number(d2.usdtAmount) * 10000)) * (10n ** BigInt(dec - 4))).toString()
    return `ethereum:${d2.contract}@${d2.chainId}/transfer?address=${d2.address}&uint256=${units}`
  }
  return d2.address
})
const qrTabOptions = computed(() => [
  { label: t('cust.billing.usdtQrTabBinance'), value: 'binance' },
  ...(usdtData.value?.contract ? [{ label: t('cust.billing.usdtQrTabWallet'), value: 'wallet' }] : [])
])
// a-typography copyable tooltips: "Copy" → "Copied."
const copyTips = computed(() => [t('cust.billing.copy'), t('cust.billing.copied')])
const usdtEstimate = computed(() => {
  const pm = billing.value?.paymentMethods
  if (!pm) return ''
  const rate = Number(pm.binanceRate) > 0 ? Number(pm.binanceRate) : 25000
  return (Math.max(1, Number(topup.value) || 0) / rate).toFixed(2)
})
async function payWithUsdt() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    const amount = Math.floor(Number(topup.value) || 0)
    const pm = billing.value?.paymentMethods || {}
    const min = Number(pm.binanceMin) || 0
    const rate = Number(pm.binanceRate) > 0 ? Number(pm.binanceRate) : 25000
    if (min > 0 && amount / rate + 1e-9 < min) {
      fail(t('cust.billing.usdtMinErr', { min, wallet: Math.ceil(min * rate).toLocaleString(), walletCur: (pm.walletCurrency || 'VND') }))
      busy.value = false
      return
    }
    const r = await apiFetch('/api/v1/user/billing/binance/create', { method: 'POST', body: { amount } })
    usdtData.value = r
    usdtPaid.value = null
    usdtOpen.value = true
    startUsdtTimers()
  } catch (e) { fail(e.message) } finally { busy.value = false }
}
function startUsdtTimers() {
  stopUsdtTimers()
  usdtPollTimer = setInterval(async () => {
    try {
      const s = await apiFetch(`/api/v1/user/billing/binance/status?id=${encodeURIComponent(usdtData.value.id)}`)
      if (s.status === 'paid') {
        usdtPaid.value = s
        stopUsdtTimers()
        message.success(t('cust.billing.usdtHit', { amount: Number(s.creditAmount).toLocaleString() }))
        await refresh()
      } else if (s.status === 'expired' || s.status === 'cancelled') {
        stopUsdtTimers()
      }
    } catch { /* keep polling */ }
  }, 10_000)
  usdtTickTimer = setInterval(() => {
    const end = Date.parse(usdtData.value?.expiresAt || '') || 0
    const left = Math.max(0, end - Date.now())
    const m = Math.floor(left / 60000); const s2 = Math.floor((left % 60000) / 1000)
    usdtLeft.value = `${m}:${String(s2).padStart(2, '0')}`
    if (!left) stopUsdtTimers()
  }, 1000)
}
function stopUsdtTimers() {
  if (usdtPollTimer) { clearInterval(usdtPollTimer); usdtPollTimer = null }
  if (usdtTickTimer) { clearInterval(usdtTickTimer); usdtTickTimer = null }
}
function closeUsdt() { usdtOpen.value = false; stopUsdtTimers() }
async function markUsdtSent() {
  if (!usdtData.value?.id || busy.value) return
  busy.value = true
  try {
    usdtData.value = await apiFetch('/api/v1/user/billing/binance/mark-sent', { method: 'POST', body: { id: usdtData.value.id } })
    message.success(t('cust.billing.usdtSentFlash'))
    await refresh()
  } catch (e) { fail(e.message) } finally { busy.value = false }
}
function reopenUsdt() {
  const pend = billing.value?.binancePending
  if (!pend) return
  usdtData.value = pend
  usdtPaid.value = null
  usdtOpen.value = true
  startUsdtTimers()
}
// Reload-proof: while an open intent exists and the modal is closed, keep a
// slow background poll so the awaiting banner flips to success on its own.
let usdtBgTimer = null
watch([() => billing.value?.binancePending?.id, usdtOpen], ([pid, open]) => {
  if (usdtBgTimer) { clearInterval(usdtBgTimer); usdtBgTimer = null }
  if (!pid || open) return
  usdtBgTimer = setInterval(async () => {
    try {
      const s = await apiFetch(`/api/v1/user/billing/binance/status?id=${encodeURIComponent(pid)}`)
      if (s.status === 'paid') {
        clearInterval(usdtBgTimer); usdtBgTimer = null
        message.success(t('cust.billing.usdtHit', { amount: Number(s.creditAmount).toLocaleString() }))
        await refresh()
      } else if (s.status === 'expired' || s.status === 'cancelled') {
        clearInterval(usdtBgTimer); usdtBgTimer = null
        await refresh()
      }
    } catch { /* keep polling */ }
  }, 30_000)
}, { immediate: true })
async function payWithPaypal() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    const amount = Math.max(1, Number(topup.value) || 0)
    // Client-side mirror of the server's minimum gate so the customer gets a
    // localized message instead of a raw 400.
    const pm = billing.value?.paymentMethods || {}
    const min = Number(pm.paypalMin) || 0
    if (min > 0) {
      const payCur = (pm.paypalCurrency || 'USD').toUpperCase()
      const walletCur = (pm.walletCurrency || 'VND').toUpperCase()
      const rate = Number(pm.paypalRate) > 0 ? Number(pm.paypalRate) : 25000
      const minWallet = payCur === walletCur ? min : min * rate
      if (amount + 1e-9 < minWallet) {
        fail(t('cust.billing.paypalMinErr', { min, cur: payCur, wallet: Math.ceil(minWallet).toLocaleString(), walletCur }))
        busy.value = false
        return
      }
    }
    const r = await apiFetch('/api/v1/user/billing/paypal/create-order', { method: 'POST', body: { amount } })
    if (r.approveUrl) {
      // Remember the order so on return we can finalize via capture.
      try { sessionStorage.setItem('proxybox.paypal.pending', JSON.stringify({ orderId: r.orderId, ts: Date.now() })) } catch {}
      window.location.href = r.approveUrl
    } else {
      fail('PayPal did not return approve URL')
    }
  } catch (e) { fail(e.message) } finally { busy.value = false }
}
// After PayPal redirects back to our return URL (with ?token=ORDER_ID), finalize the capture.
async function maybeFinalizePaypal() {
  const params = new URLSearchParams(location.search)
  const orderId = params.get('token') || params.get('paypal_order_id')
  if (!orderId) return
  busy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/paypal/capture', { method: 'POST', body: { orderId } })
    message.success(r.alreadyCaptured
      ? (t('cust.billing.paypalAlreadyDone') || 'PayPal capture already processed.')
      : (t('cust.billing.paypalSuccess', { amount: Number(r.amount).toLocaleString(), currency: r.currency }) || `PayPal payment received: ${r.amount} ${r.currency}.`))
    try { sessionStorage.removeItem('proxybox.paypal.pending') } catch {}
    history.replaceState(null, '', location.pathname)
    await refresh()
  } catch (e) {
    fail(`PayPal capture failed: ${e.message}`)
  } finally { busy.value = false }
}
// Return from a 3DS redirect for an in-place PaymentIntent / SetupIntent.
async function maybeFinalizePaymentIntent() {
  const params = new URLSearchParams(location.search)
  const pi = params.get('payment_intent')
  const si = params.get('setup_intent')
  try {
    if (pi && pi.startsWith('pi_')) {
      const r = await apiFetch('/api/v1/user/billing/stripe/confirm-intent', { method: 'POST', body: { paymentIntentId: pi } })
      if (r.ok) message.success(r.alreadyCredited ? (t('cust.billing.stripeAlreadyDone')) : t('cust.billing.stripeSuccess', { amount: Number(r.amount).toLocaleString() }))
      history.replaceState(null, '', location.pathname); await refresh()
    } else if (si && si.startsWith('seti_')) {
      const r = await apiFetch('/api/v1/user/billing/stripe/save-card', { method: 'POST', body: { setupIntentId: si } })
      if (r.ok) message.success(t('cust.billing.cardSaved'))
      history.replaceState(null, '', location.pathname); await refresh()
    }
  } catch (e) { fail(e.message) }
}
async function maybeFinalizeStripe() {
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session_id')
  if (!sessionId || !sessionId.startsWith('cs_')) return
  busy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/checkout/confirm', { method: 'POST', body: { sessionId } })
    if (r.ok) message.success(r.alreadyCredited
      ? (t('cust.billing.stripeAlreadyDone') || 'Card payment already processed.')
      : (t('cust.billing.stripeSuccess', { amount: Number(r.amount).toLocaleString() }) || `Card payment received: ${r.amount}.`))
    else if (r.pending) message.info(t('cust.billing.stripePending') || 'Payment is processing.')
    history.replaceState(null, '', location.pathname)
    await refresh()
  } catch (e) { fail(`Card confirm failed: ${e.message}`) } finally { busy.value = false }
}
// ─── Saved card + auto-recharge (Stripe) ───────────────────────────
const ar = computed(() => billing.value?.paymentMethods?.autoRecharge || {})
async function saveCard() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/card/setup', { method: 'POST' })
    if (r.url) window.location.href = r.url
    else fail('Stripe did not return a setup URL')
  } catch (e) { fail(e.message); busy.value = false }
}
async function maybeFinalizeCard() {
  const params = new URLSearchParams(location.search)
  const sid = params.get('setup_session')
  if (!sid || !sid.startsWith('cs_')) return
  busy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/billing/card/confirm', { method: 'POST', body: { sessionId: sid } })
    if (r.ok) message.success(t('cust.billing.cardSaved') || 'Card saved.')
    else if (r.pending) message.info(t('cust.billing.stripePending') || 'Processing…')
    history.replaceState(null, '', location.pathname)
    await refresh()
  } catch (e) { fail(`Card save failed: ${e.message}`) } finally { busy.value = false }
}
async function toggleAutoRecharge(enabled) {
  try { await apiFetch('/api/v1/user/billing/auto-recharge', { method: 'PATCH', body: { enabled } }); await refresh() }
  catch (e) { fail(e.message); await refresh() }
}
async function removeCard() {
  if (busy.value) return
  busy.value = true; err.value = ''
  try { await apiFetch('/api/v1/user/billing/card', { method: 'DELETE' }); message.success(t('cust.billing.cardRemoved') || 'Card removed.'); await refresh() }
  catch (e) { fail(e.message) } finally { busy.value = false }
}
// Key/value rows: label left, value right-aligned.
const kvContent = { justifyContent: 'flex-end', textAlign: 'right' }
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
const TX_PAGE = 12
const txPage = ref(1)
const txRows = computed(() => filteredTx.value.map((tx, i) => ({ ...tx, _k: `${tx.ts || ''}#${i}` })))
const txPagination = computed(() => ({ current: txPage.value, pageSize: TX_PAGE, hideOnSinglePage: true, showSizeChanger: false }))
function onTxChange(p) { txPage.value = p.current }
watch(filteredTx, () => { txPage.value = 1 })
const txColumns = computed(() => [
  { title: t('cust.billing.txTime'), key: 'ts', dataIndex: 'ts', width: 150 },
  { title: t('cust.billing.txType'), key: 'type', dataIndex: 'type', width: 140 },
  { title: t('cust.billing.txNote'), key: 'note', dataIndex: 'note', ellipsis: true },
  { title: t('cust.orders.col.amount'), key: 'amount', dataIndex: 'amount', width: 130, align: 'right' },
  { title: t('cust.billing.txBalance'), key: 'balanceAfter', dataIndex: 'balanceAfter', width: 140, align: 'right' }
])
const txFilterOptions = computed(() => [
  { value: 'all', label: t('cust.billing.txAll') },
  { value: 'topup', label: t('cust.billing.txTopup') },
  { value: 'order', label: t('cust.billing.txOrder') },
  { value: 'refund', label: t('cust.billing.txRefund') },
  { value: 'bonus', label: t('cust.billing.txBonus') }
])
function txTagColor(type) {
  return type === 'topup' ? 'success' : type === 'order' ? 'blue' : type === 'refund' ? 'purple' : 'orange'
}
const grantColumns = computed(() => [
  { title: t('cust.billing.promoGroup'), key: 'group', dataIndex: 'group' },
  { title: t('cust.billing.promoValue'), key: 'remaining', dataIndex: 'remaining', align: 'right' },
  { title: t('cust.billing.promoExpiry'), key: 'expiresAt', dataIndex: 'expiresAt' }
])
const grantRows = computed(() => grants.value.map((g, i) => ({ ...g, _k: i })))

const presets = [50000, 100000, 200000, 500000, 1000000, 2000000]

// PayPal charges in a foreign currency (e.g. USD) while the wallet is VND. Show the
// customer what they'll actually be charged: wallet amount converted via the
// admin-set rate, then grossed-up with the PayPal fee the payer bears
// (mirrors the server's (net + fixed) / (1 - pct) formula).
const paypalEstimate = computed(() => {
  const pm = billing.value?.paymentMethods
  if (!pm) return ''
  const payCur = (pm.paypalCurrency || 'USD').toUpperCase()
  const walletCur = (pm.walletCurrency || pricing.value?.currency || 'VND').toUpperCase()
  const rate = Number(pm.paypalRate) > 0 ? Number(pm.paypalRate) : 25000
  const amount = Math.max(1, Number(topup.value) || 0)
  const feePct = (Number(pm.paypalFeePct) || 0) / 100
  const feeFixed = Number(pm.paypalFeeFixed) || 0
  const net = payCur === walletCur ? amount : amount / rate
  const gross = feePct < 1 ? (net + feeFixed) / (1 - feePct) : net + feeFixed
  const zeroDecimal = new Set(['VND', 'JPY', 'KRW', 'HUF'])
  const shown = zeroDecimal.has(payCur) ? Math.round(gross).toLocaleString() : (Math.round(gross * 100) / 100).toFixed(2)
  return `${shown} ${payCur}`
})
// "Min $5 · fee borne by payer" note under the PayPal button.
const paypalTermsNote = computed(() => {
  const pm = billing.value?.paymentMethods
  if (!pm) return ''
  const payCur = (pm.paypalCurrency || 'USD').toUpperCase()
  return t('cust.billing.paypalFeeNote', {
    min: Number(pm.paypalMin) || 0,
    cur: payCur,
    pct: Number(pm.paypalFeePct) || 0,
    fixed: Number(pm.paypalFeeFixed) || 0
  })
})
// Stripe charges in the wallet currency; show the grossed-up amount incl. fee.
const stripeEstimate = computed(() => {
  const pm = billing.value?.paymentMethods
  if (!pm) return ''
  const walletCur = (pm.walletCurrency || pricing.value?.currency || 'VND').toUpperCase()
  const rate = Number(pm.stripeRate) > 0 ? Number(pm.stripeRate) : 25000
  const amount = Math.max(1, Number(topup.value) || 0)
  const feePct = (Number(pm.stripeFeePct) || 0) / 100
  const feeFixed = (Number(pm.stripeFeeFixed) || 0) * (walletCur === 'USD' ? 1 : rate)
  const gross = feePct < 1 ? (amount + feeFixed) / (1 - feePct) : amount + feeFixed
  const zeroDecimal = new Set(['VND', 'JPY', 'KRW', 'HUF'])
  const shown = zeroDecimal.has(walletCur) ? Math.round(gross).toLocaleString() : (Math.round(gross * 100) / 100).toFixed(2)
  return `${shown} ${walletCur}`
})
const stripeTermsNote = computed(() => {
  const pm = billing.value?.paymentMethods
  if (!pm) return ''
  return t('cust.billing.stripeFeeNote', {
    min: Number(pm.stripeMin) || 0,
    pct: Number(pm.stripeFeePct) || 0,
    fixed: Number(pm.stripeFeeFixed) || 0
  })
})

// ─── Stripe Payment Element (in-place, no redirect) ────────────────
let _stripeJs = null
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe)
  if (_stripeJs) return _stripeJs
  _stripeJs = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://js.stripe.com/v3/'
    el.onload = () => resolve(window.Stripe)
    el.onerror = () => reject(new Error('Không tải được Stripe.js'))
    document.head.appendChild(el)
  })
  return _stripeJs
}
const stripeModal = ref(false)      // false | 'pay' | 'setup'
const stripeSubmitting = ref(false)
const stripeSaveCard = ref(false)
const stripeErr = ref('')
let _stripe = null, _elements = null
const appearance = computed(() => (isDark.value
  ? { theme: 'night', variables: { colorPrimary: '#22c55e', colorBackground: '#0f1720', borderRadius: '8px' } }
  : { theme: 'stripe', variables: { colorPrimary: '#16a34a', borderRadius: '8px' } }))
// The a-modal body is portalled a frame or two after `open` flips, so wait
// (bounded) for the #stripe-pe container before mounting into it.
function waitForEl(selector, frames = 120) {
  return new Promise((resolve) => {
    const check = (left) => {
      if (document.querySelector(selector) || left <= 0) resolve()
      else requestAnimationFrame(() => check(left - 1))
    }
    check(frames)
  })
}
async function mountElement(clientSecret) {
  const Stripe = await loadStripeJs()
  _stripe = Stripe(billing.value?.paymentMethods?.stripePublishableKey || '')
  await nextTick()
  await waitForEl('#stripe-pe')
  _elements = _stripe.elements({ clientSecret, appearance: appearance.value })
  _elements.create('payment', { layout: 'tabs' }).mount('#stripe-pe')
}
const selectedMethod = ref('')
const enabledMethods = computed(() => {
  const pm = billing.value?.paymentMethods || {}
  const list = []
  if (pm.stripeEnabled) list.push('card')
  if (pm.paypalEnabled) list.push('paypal')
  if (pm.sepayEnabled) list.push('sepay')
  if (pm.binanceEnabled) list.push('usdt')
  return list
})
watch(enabledMethods, (m) => { if (!selectedMethod.value || !m.includes(selectedMethod.value)) selectedMethod.value = m[0] || '' }, { immediate: true })
const METHOD_ICON = { card: CreditCardOutlined, paypal: DollarOutlined, sepay: BankOutlined, usdt: WalletOutlined }
const methodTiles = computed(() => {
  const pm = billing.value?.paymentMethods || {}
  const out = []
  if (pm.stripeEnabled) out.push({ id: 'card', tone: 'ico-green', label: t('cust.billing.cardMethodLabel'), sub: `≈ ${stripeEstimate.value}` })
  if (pm.paypalEnabled) out.push({ id: 'paypal', tone: 'ico-blue', label: 'PayPal', sub: `≈ ${paypalEstimate.value}` })
  if (pm.sepayEnabled) out.push({ id: 'sepay', tone: 'ico-green', label: t('cust.billing.sepayMethodLabel'), sub: `${Number(topup.value || 0).toLocaleString()} VND` })
  if (pm.binanceEnabled) out.push({ id: 'usdt', tone: 'ico-teal', label: 'USDT · BEP20', sub: `≈ ${usdtEstimate.value} USDT` })
  return out.map((m) => ({ ...m, icon: METHOD_ICON[m.id] }))
})
const methodIcon = computed(() => METHOD_ICON[selectedMethod.value] || WalletOutlined)
const methodEstimate = computed(() => {
  const cur = (billing.value?.paymentMethods?.walletCurrency || 'VND')
  switch (selectedMethod.value) {
    case 'card': return stripeEstimate.value
    case 'paypal': return paypalEstimate.value
    case 'usdt': return `${usdtEstimate.value} USDT`
    case 'sepay': return `${Number(topup.value || 0).toLocaleString()} ${cur}`
    default: return ''
  }
})
const selectedNote = computed(() => {
  switch (selectedMethod.value) {
    case 'card': return stripeTermsNote.value
    case 'paypal': return paypalTermsNote.value
    case 'usdt': return t('cust.billing.usdtHint')
    case 'sepay': return t('cust.billing.sepayMethodLabel')
    default: return ''
  }
})
function payNow() {
  if (selectedMethod.value === 'card') return payWithCardInline()
  if (selectedMethod.value === 'paypal') return payWithPaypal()
  if (selectedMethod.value === 'sepay') return payWithSepay()
  if (selectedMethod.value === 'usdt') return payWithUsdt()
}
function stripeMinWallet() {
  const pm = billing.value?.paymentMethods || {}
  const min = Number(pm.stripeMin) || 0
  const rate = Number(pm.stripeRate) > 0 ? Number(pm.stripeRate) : 25000
  const walletCur = (pm.walletCurrency || 'VND').toUpperCase()
  return { min, walletCur, minWallet: walletCur === 'USD' ? min : min * rate }
}
async function payWithCardInline() {
  if (busy.value) return
  err.value = ''; stripeErr.value = ''
  const amount = Math.max(10000, Math.floor(Number(topup.value) || 0))
  const { min, walletCur, minWallet } = stripeMinWallet()
  if (min > 0 && amount + 1e-9 < minWallet) {
    fail(t('cust.billing.stripeMinErr', { min, wallet: Math.ceil(minWallet).toLocaleString(), walletCur })); return
  }
  busy.value = true
  try {
    const r = await apiFetch('/api/v1/user/billing/stripe/intent', { method: 'POST', body: { amount, saveCard: stripeSaveCard.value } })
    stripeModal.value = 'pay'
    await mountElement(r.clientSecret)
  } catch (e) { fail(e.message); stripeModal.value = false } finally { busy.value = false }
}
async function submitStripePay() {
  if (stripeSubmitting.value || !_stripe || !_elements) return
  stripeSubmitting.value = true; stripeErr.value = ''
  try {
    const { error, paymentIntent } = await _stripe.confirmPayment({ elements: _elements, redirect: 'if_required', confirmParams: { return_url: location.origin + location.pathname } })
    if (error) { stripeErr.value = error.message; return }
    const r = await apiFetch('/api/v1/user/billing/stripe/confirm-intent', { method: 'POST', body: { paymentIntentId: paymentIntent.id } })
    closeStripeModal()
    message.success(r.alreadyCredited ? (t('cust.billing.stripeAlreadyDone') || 'Đã xử lý.') : (t('cust.billing.stripeSuccess', { amount: Number(r.amount).toLocaleString() })))
    await refresh()
  } catch (e) { stripeErr.value = e.message } finally { stripeSubmitting.value = false }
}
async function addCardInline() {
  if (busy.value) return
  err.value = ''; stripeErr.value = ''
  busy.value = true
  try {
    const r = await apiFetch('/api/v1/user/billing/stripe/setup-intent', { method: 'POST' })
    stripeModal.value = 'setup'
    await mountElement(r.clientSecret)
  } catch (e) { fail(e.message); stripeModal.value = false } finally { busy.value = false }
}
async function submitStripeSetup() {
  if (stripeSubmitting.value || !_stripe || !_elements) return
  stripeSubmitting.value = true; stripeErr.value = ''
  try {
    const { error, setupIntent } = await _stripe.confirmSetup({ elements: _elements, redirect: 'if_required', confirmParams: { return_url: location.origin + location.pathname } })
    if (error) { stripeErr.value = error.message; return }
    await apiFetch('/api/v1/user/billing/stripe/save-card', { method: 'POST', body: { setupIntentId: setupIntent.id } })
    closeStripeModal()
    message.success(t('cust.billing.cardSaved') || 'Đã lưu thẻ.')
    await refresh()
  } catch (e) { stripeErr.value = e.message } finally { stripeSubmitting.value = false }
}
function closeStripeModal() { stripeModal.value = false; _elements = null; _stripe = null; stripeSubmitting.value = false }

onMounted(async () => {
  await refresh()
  await maybeFinalizePaypal()
  await maybeFinalizeStripe()
  await maybeFinalizeCard()
  await maybeFinalizePaymentIntent()
})
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.billing.subtitle') }}</a-typography-text>

    <a-alert v-if="err" type="error" show-icon closable :message="err" @close="err = ''" />

    <!-- KPI -->
    <a-row v-if="billing" :gutter="[12, 12]">
      <a-col :xs="24" :sm="8">
        <a-card size="small">
          <a-statistic :title="t('cust.side.balance')" :value="Number(billing.wallet.balance)" :value-style="{ color: 'var(--pb-primary)' }">
            <template #prefix><WalletOutlined /></template>
            <template #formatter="{ value }"><span class="mono">{{ Number(value).toLocaleString() }}</span></template>
          </a-statistic>
          <a-typography-text type="secondary" class="small-text">{{ (pricing?.currency || 'VND').toUpperCase() }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8">
        <a-card size="small">
          <a-statistic :title="t('cust.billing.kpiDeposit')" :value="monthDeposit">
            <template #prefix><ArrowDownOutlined class="kpi-in" /></template>
            <template #formatter="{ value }"><span class="mono">{{ Number(value).toLocaleString() }}</span></template>
          </a-statistic>
          <a-typography-text type="secondary" class="small-text">{{ t('cust.billing.thisMonth') }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8">
        <a-card size="small">
          <a-statistic :title="t('cust.billing.kpiSpent')" :value="monthSpent">
            <template #prefix><ArrowUpOutlined class="kpi-out" /></template>
            <template #formatter="{ value }"><span class="mono">{{ Number(value).toLocaleString() }}</span></template>
          </a-statistic>
          <a-typography-text type="warning" class="small-text">{{ t('cust.billing.thisMonth') }}</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="[16, 16]">
      <!-- LEFT column -->
      <a-col :xs="24" :lg="15" :xl="16">
        <a-flex vertical gap="middle">
          <!-- Topup card -->
          <a-card>
            <template #title><PlusCircleOutlined class="title-ico" /> {{ t('cust.billing.topupTitle') }}</template>
            <a-flex vertical gap="middle" class="narrow">
              <a-typography-text type="secondary">{{ t('cust.billing.topupDesc') }}</a-typography-text>

              <a-alert v-if="billing?.binancePending" type="info" show-icon :message="t('cust.billing.usdtPendingTitle')">
                <template #icon><SyncOutlined spin /></template>
                <template #description>
                  <a-flex vertical gap="small" align="flex-start">
                    <span>
                      <span class="mono">{{ billing.binancePending.usdtAmount }} USDT</span>
                      → +{{ Number(billing.binancePending.creditAmount).toLocaleString() }} {{ billing.paymentMethods?.walletCurrency || 'VND' }}
                      · {{ billing.binancePending.status === 'sent' ? t('cust.billing.usdtPendingSent') : t('cust.billing.usdtPendingWaiting') }}
                    </span>
                    <a-button size="small" @click="reopenUsdt">{{ t('cust.billing.usdtPendingView') }}</a-button>
                  </a-flex>
                </template>
              </a-alert>

              <div>
                <a-typography-text strong>{{ t('cust.billing.amount') }} ({{ (pricing?.currency || 'VND').toUpperCase() }})</a-typography-text>
                <a-input-number
                  v-model:value="topup"
                  :min="0"
                  :step="10000"
                  size="large"
                  class="mono amount-input"
                  :formatter="(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
                  :parser="(v) => `${v ?? ''}`.replace(/[^\d.]/g, '')"
                />
                <a-flex wrap="wrap" gap="small" class="presets">
                  <a-button
                    v-for="a in presets"
                    :key="a"
                    size="small"
                    class="mono"
                    :type="topup === a ? 'primary' : 'default'"
                    :ghost="topup === a"
                    @click="topup = a"
                  >
                    {{ a.toLocaleString() }}
                  </a-button>
                </a-flex>
              </div>

              <a-row v-if="enabledMethods.length" :gutter="[10, 10]" role="radiogroup">
                <a-col v-for="m in methodTiles" :key="m.id" :xs="24" :sm="12">
                  <a-card
                    size="small"
                    hoverable
                    class="choice"
                    :class="{ 'is-selected': selectedMethod === m.id }"
                    role="radio"
                    tabindex="0"
                    :aria-checked="selectedMethod === m.id"
                    @click="selectedMethod = m.id"
                    @keydown.enter.space.prevent="selectedMethod = m.id"
                  >
                    <a-flex align="center" gap="middle">
                      <a-avatar shape="square" :size="36" :class="['ico', m.tone]">
                        <template #icon><component :is="m.icon" /></template>
                      </a-avatar>
                      <div class="choice-text">
                        <a-typography-text strong>{{ m.label }}</a-typography-text>
                        <a-typography-text type="secondary" class="choice-sub mono">{{ m.sub }}</a-typography-text>
                      </div>
                    </a-flex>
                    <CheckCircleFilled v-if="selectedMethod === m.id" class="choice-check" />
                  </a-card>
                </a-col>
              </a-row>
              <a-alert v-else type="warning" show-icon :message="t('cust.billing.noPayment')" />

              <template v-if="enabledMethods.length">
                <a-button type="primary" size="large" block :loading="busy && stripeModal === false" :disabled="busy" @click="payNow">
                  <template #icon><component :is="methodIcon" /></template>
                  {{ busy && stripeModal === false ? t('common.loading') : t('cust.billing.payNowBtn', { amount: methodEstimate }) }}
                </a-button>
              </template>
              <a-typography-text v-if="selectedNote" type="secondary" class="small-text">{{ selectedNote }}</a-typography-text>
            </a-flex>
          </a-card>

          <!-- Saved card + auto-recharge (Stripe) -->
          <a-card v-if="billing?.paymentMethods?.stripeEnabled && ar.adminEnabled">
            <template #title><CreditCardOutlined class="title-ico" /> {{ t('cust.billing.autoRechargeTitle') }}</template>
            <a-flex vertical gap="middle" align="flex-start" class="narrow">
              <a-typography-text type="secondary">
                {{ t('cust.billing.autoRechargeDesc', { threshold: Number(ar.threshold).toLocaleString(), amount: Number(ar.amount).toLocaleString(), cur: (billing.paymentMethods.walletCurrency || 'VND') }) }}
              </a-typography-text>
              <a-card v-if="ar.hasCard" size="small" class="full-width">
                <a-flex align="center" gap="middle" wrap="wrap">
                  <CreditCardOutlined class="title-ico card-ico" />
                  <span class="mono card-num">{{ (ar.cardBrand || 'card').toUpperCase() }} ····{{ ar.cardLast4 }}</span>
                  <a-typography-text type="secondary" class="small-text">exp {{ ar.cardExp }}</a-typography-text>
                  <span class="spacer"></span>
                  <a-button size="small" danger :disabled="busy" @click="removeCard">{{ t('cust.billing.cardRemove') }}</a-button>
                </a-flex>
              </a-card>
              <a-button v-else type="primary" :loading="busy" @click="addCardInline">
                <template #icon><CreditCardOutlined /></template>
                {{ busy ? t('common.loading') : t('cust.billing.cardSave') }}
              </a-button>
              <label v-if="ar.hasCard" class="switch-line">
                <a-switch :checked="!!ar.enabled" @change="toggleAutoRecharge" />
                <span>{{ t('cust.billing.autoRechargeToggle') }}</span>
              </label>
            </a-flex>
          </a-card>

          <!-- Redeem free-credit promo code -->
          <a-card>
            <template #title><GiftOutlined class="title-ico" /> {{ t('cust.billing.promoTitle') }}</template>
            <a-flex vertical gap="middle" class="narrow">
              <a-typography-text type="secondary">{{ t('cust.billing.promoDesc') }}</a-typography-text>
              <div>
                <a-typography-text strong>{{ t('cust.billing.promoCode') }}</a-typography-text>
                <a-space-compact block class="promo-row">
                  <a-input v-model:value="promoCode" :placeholder="t('cust.billing.promoPlaceholder')" class="mono promo-input" @press-enter="checkPromo" />
                  <a-button :loading="promoBusy && !promoInfo" :disabled="promoBusy || !promoCode.trim()" @click="checkPromo">{{ t('cust.billing.promoCheck') }}</a-button>
                </a-space-compact>
              </div>
              <a-alert v-if="promoErr" type="error" show-icon :message="promoErr" />
              <a-card v-if="promoInfo" size="small">
                <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent">
                  <a-descriptions-item :label="t('cust.billing.promoValue')">
                    <a-typography-text type="success" strong class="mono">+{{ Number(promoInfo.amount).toLocaleString() }} {{ promoInfo.currency }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item :label="t('cust.billing.promoGroup')">
                    <a-tag :bordered="false" color="blue">{{ promoGroupLabel(promoInfo.productGroup) }}</a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item :label="t('cust.billing.promoExpiry')">
                    <span class="mono">{{ promoInfo.validUntil || t('cust.billing.promoNoExpiry') }}</span>
                  </a-descriptions-item>
                </a-descriptions>
                <a-button type="primary" block :loading="promoBusy" :disabled="!promoInfo.redeemable" @click="redeemPromo">
                  <template #icon><GiftOutlined /></template>
                  {{ promoInfo.expired ? t('cust.billing.promoExpired') : promoInfo.already ? t('cust.billing.promoAlready') : promoInfo.full ? t('cust.billing.promoFull') : t('cust.billing.promoRedeem') }}
                </a-button>
              </a-card>
            </a-flex>
          </a-card>

          <!-- Active scoped free credit -->
          <a-card v-if="grants.length" :body-style="{ padding: 0 }">
            <template #title><GiftOutlined class="title-ico" /> {{ t('cust.billing.grantsTitle') }}</template>
            <a-table :columns="grantColumns" :data-source="grantRows" row-key="_k" size="small" :pagination="false" :scroll="{ x: 420 }">
              <template #bodyCell="{ column, record: g }">
                <template v-if="column.key === 'group'">
                  <a-tag :bordered="false" color="blue">{{ promoGroupLabel(g.group) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'remaining'">
                  <a-typography-text type="success" class="mono">{{ Number(g.remaining).toLocaleString() }} {{ g.currency }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'expiresAt'">
                  <span class="mono">{{ g.expiresAt || t('cust.billing.promoNoExpiry') }}</span>
                </template>
              </template>
            </a-table>
          </a-card>

          <!-- Transactions -->
          <a-card :body-style="{ padding: 0 }">
            <template #title>{{ t('cust.billing.txTitle') }} ({{ txs.length }})</template>
            <template #extra>
              <a-button shape="circle" @click="refresh"><template #icon><ReloadOutlined /></template></a-button>
            </template>
            <a-flex wrap="wrap" gap="small" class="tx-filters">
              <a-input v-model:value="txSearch" allow-clear :placeholder="t('cust.billing.txSearch')" class="tx-search">
                <template #prefix><SearchOutlined /></template>
              </a-input>
              <a-select v-model:value="txFilter" :options="txFilterOptions" class="tx-type" />
            </a-flex>
            <a-table
              :columns="txColumns"
              :data-source="txRows"
              row-key="_k"
              size="middle"
              :pagination="txPagination"
              :scroll="{ x: 720 }"
              :locale="{ emptyText: t('cust.billing.txEmpty') }"
              @change="onTxChange"
            >
              <template #bodyCell="{ column, record: tx }">
                <template v-if="column.key === 'ts'">
                  <span class="mono">{{ fmtTs(tx.ts) }}</span>
                </template>
                <template v-else-if="column.key === 'type'">
                  <a-tag :color="txTagColor(tx.type)" :bordered="false">{{ tx.type }}</a-tag>
                </template>
                <template v-else-if="column.key === 'note'">
                  {{ tx.note || '—' }}
                </template>
                <template v-else-if="column.key === 'amount'">
                  <a-typography-text :type="Number(tx.amount) > 0 ? 'success' : 'danger'" class="mono">
                    {{ Number(tx.amount) > 0 ? '+' : '' }}{{ Number(tx.amount).toLocaleString() }}
                  </a-typography-text>
                </template>
                <template v-else-if="column.key === 'balanceAfter'">
                  <span class="mono">{{ Number(tx.balanceAfter).toLocaleString() }}</span>
                </template>
              </template>
            </a-table>
          </a-card>
        </a-flex>
      </a-col>

      <!-- RIGHT column -->
      <a-col :xs="24" :lg="9" :xl="8">
        <a-flex vertical gap="middle" class="aside">
          <!-- Pricing snapshot -->
          <a-card v-if="pricing" size="small" :title="t('cust.billing.pricingTitle')">
            <a-descriptions :column="1" size="small" :colon="false" :content-style="kvContent">
              <a-descriptions-item :label="t('cust.buy.t.ipv4')">
                <a-typography-text type="success" class="mono">{{ Number(pricing.ipv4.perHour).toLocaleString() }} {{ pricing.currency.toUpperCase() }}/h</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.buy.t.ipv6')">
                <a-typography-text type="success" class="mono">{{ Number(pricing.ipv6.perHour).toLocaleString() }} {{ pricing.currency.toUpperCase() }}/h</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.duration')">{{ pricing.minHours }}h – {{ pricing.maxHours }}h</a-descriptions-item>
            </a-descriptions>
            <template v-if="pricing.tiers?.length">
              <a-typography-text type="secondary" class="eyebrow-text">{{ t('cust.billing.tierDiscount') }}</a-typography-text>
              <a-flex wrap="wrap" gap="small" class="tiers">
                <a-tag v-for="tier in pricing.tiers" :key="tier.min" color="blue" :bordered="false" class="mono">≥{{ tier.min }} → -{{ (Number(tier.discount) * 100).toFixed(0) }}%</a-tag>
              </a-flex>
            </template>
          </a-card>

          <!-- Recent orders -->
          <a-card v-if="orders.length" size="small" :title="t('cust.billing.recentOrders')" :body-style="{ padding: '0 12px' }">
            <template #extra>
              <a-button type="link" size="small" @click="router.push({ name: 'proxies' })">
                {{ t('cust.viewAll') }} <RightOutlined />
              </a-button>
            </template>
            <a-list size="small" :data-source="orders.slice(0, 5)" :row-key="(o) => o.id">
              <template #renderItem="{ item: o }">
                <a-list-item class="order-item" @click="viewOrder(o.id)">
                  <a-list-item-meta>
                    <template #title><span class="mono small-text">{{ o.id }}</span></template>
                    <template #description><span class="one-line small-text">{{ o.item }}</span></template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button type="text" size="small" :href="invoiceUrl(o.id)" target="_blank" @click.stop>
                      <template #icon><FileTextOutlined /></template>
                    </a-button>
                    <RightOutlined class="muted" />
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-flex>
      </a-col>
    </a-row>

    <!-- SePay QR modal — shown after clicking Pay via VN bank transfer -->
    <a-modal :open="sepayOpen" :footer="null" :width="640" @cancel="closeSepay">
      <template #title><QrcodeOutlined /> {{ t('cust.billing.sepayQrTitle') }}</template>
      <a-result
        v-if="sepayCheck"
        status="success"
        :title="t('cust.billing.sepayPaid')"
        :sub-title="t('cust.billing.sepayPaidDesc', { amount: Number(sepayCheck.amount).toLocaleString() })"
      >
        <template #extra><a-button type="primary" @click="closeSepay">{{ t('common.close') }}</a-button></template>
      </a-result>
      <a-row v-else-if="sepayData" :gutter="[20, 16]">
        <a-col :xs="24" :sm="10" class="qr-col">
          <div class="qr-box"><img :src="sepayData.qrUrl" alt="VietQR" class="qr-img" /></div>
        </a-col>
        <a-col :xs="24" :sm="14">
          <a-flex vertical gap="small">
            <a-descriptions :column="1" size="small" bordered>
              <a-descriptions-item :label="t('cust.billing.sepayBank')"><span class="mono">{{ sepayData.bank.code }}</span></a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.sepayAccount')">
                <a-typography-text strong class="mono" :copyable="{ text: String(sepayData.bank.accountNumber || ''), tooltips: copyTips }">{{ sepayData.bank.accountNumber }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.sepayHolder')"><strong>{{ sepayData.bank.accountHolder }}</strong></a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.sepayAmount')">
                <a-typography-text type="success" strong class="mono">{{ Number(sepayData.amount).toLocaleString() }} VND</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.sepayMemo')">
                <a-typography-text type="warning" strong class="mono" :copyable="{ text: String(sepayData.memo || ''), tooltips: copyTips }">{{ sepayData.memo }}</a-typography-text>
              </a-descriptions-item>
            </a-descriptions>
            <a-typography-text v-if="sepayData.instructions" type="secondary" class="small-text">{{ sepayData.instructions }}</a-typography-text>
            <a-typography-text type="success" class="small-text"><SyncOutlined spin /> {{ t('cust.billing.sepayPolling') }}</a-typography-text>
          </a-flex>
        </a-col>
      </a-row>
    </a-modal>

    <!-- Stripe Payment Element modal (in-place card entry, no redirect) -->
    <a-modal :open="!!stripeModal" :footer="null" :width="460" destroy-on-close @cancel="closeStripeModal">
      <template #title><CreditCardOutlined /> {{ stripeModal === 'setup' ? t('cust.billing.cardSave') : t('cust.billing.cardModalTitle') }}</template>
      <a-flex vertical gap="middle" class="stripe-body">
        <a-card v-if="stripeModal === 'pay'" size="small">
          <a-flex justify="space-between" align="center" gap="small">
            <a-typography-text type="secondary">{{ t('cust.billing.cardChargeLabel') }}</a-typography-text>
            <a-typography-text type="success" strong class="mono charge">≈ {{ stripeEstimate }}</a-typography-text>
          </a-flex>
        </a-card>
        <!-- Stripe mounts its Payment Element into this container (see mountElement) -->
        <div id="stripe-pe"><div class="pe-loading"><SyncOutlined spin /> {{ t('common.loading') }}</div></div>
        <a-alert v-if="stripeErr" type="error" show-icon :message="stripeErr" />
        <a-button v-if="stripeModal === 'pay'" type="primary" size="large" block :loading="stripeSubmitting" @click="submitStripePay">
          <template #icon><CreditCardOutlined /></template>
          {{ stripeSubmitting ? t('common.loading') : t('cust.billing.cardPayNow', { amount: stripeEstimate }) }}
        </a-button>
        <a-button v-else type="primary" size="large" block :loading="stripeSubmitting" @click="submitStripeSetup">
          <template #icon><CreditCardOutlined /></template>
          {{ stripeSubmitting ? t('common.loading') : t('cust.billing.cardSaveNow') }}
        </a-button>
        <a-typography-text type="secondary" class="small-text secure-note"><LockOutlined /> {{ t('cust.billing.cardSecure') }}</a-typography-text>
      </a-flex>
    </a-modal>

    <!-- USDT (BEP20) deposit modal — company Binance deposit address -->
    <a-modal :open="usdtOpen" :footer="null" :width="680" @cancel="closeUsdt">
      <template #title><WalletOutlined /> {{ t('cust.billing.usdtTitle') }}</template>
      <a-result
        v-if="usdtPaid"
        status="success"
        :title="t('cust.billing.usdtPaid')"
        :sub-title="t('cust.billing.usdtPaidDesc', { amount: Number(usdtPaid.creditAmount).toLocaleString() })"
      >
        <template #extra><a-button type="primary" @click="closeUsdt">{{ t('common.close') }}</a-button></template>
      </a-result>
      <a-row v-else-if="usdtData" :gutter="[20, 16]">
        <a-col :xs="24" :sm="10">
          <a-flex vertical align="center" gap="small">
            <div class="qr-box">
              <a-qrcode :value="usdtQrPayload || ' '" :size="208" color="#000000" bg-color="#ffffff" :bordered="false" error-level="M" />
            </div>
            <a-segmented v-model:value="qrTab" size="small" :options="qrTabOptions" />
            <a-typography-text type="secondary" class="small-text qr-hint">
              {{ qrTab === 'binance' ? t('cust.billing.usdtQrHintBinance') : t('cust.billing.usdtQrHintWallet') }}
            </a-typography-text>
          </a-flex>
        </a-col>
        <a-col :xs="24" :sm="14">
          <a-flex vertical gap="small">
            <a-descriptions :column="1" size="small" bordered>
              <a-descriptions-item :label="t('cust.billing.usdtNetwork')">
                <a-tag color="gold" :bordered="false" class="mono">{{ usdtData.coin }} · {{ usdtData.network }}</a-tag>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.usdtAddress')">
                <a-typography-text class="mono" :copyable="{ text: String(usdtData.address || ''), tooltips: copyTips }">{{ usdtData.address }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.usdtAmount')">
                <a-typography-text type="success" strong class="mono usdt-amount" :copyable="{ text: String(usdtData.usdtAmount || ''), tooltips: copyTips }">{{ usdtData.usdtAmount }} USDT</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.billing.usdtCredit')">
                <span class="mono">{{ Number(usdtData.creditAmount).toLocaleString() }} {{ billing?.paymentMethods?.walletCurrency || 'VND' }}</span>
              </a-descriptions-item>
              <a-descriptions-item v-if="usdtLeft" :label="t('cust.billing.usdtExpires')"><span class="mono">{{ usdtLeft }}</span></a-descriptions-item>
            </a-descriptions>
            <a-typography-text type="secondary" class="small-text">{{ t('cust.billing.usdtHint') }}</a-typography-text>
            <a-typography-text type="success" class="small-text"><SyncOutlined spin /> {{ t('cust.billing.usdtPolling') }}</a-typography-text>
            <a-button v-if="usdtData.status === 'pending'" type="primary" block :loading="busy" @click="markUsdtSent">
              <template #icon><CheckOutlined /></template>
              {{ busy ? t('common.loading') : t('cust.billing.usdtSentBtn') }}
            </a-button>
            <a-alert v-else-if="usdtData.status === 'sent'" type="warning" show-icon :message="t('cust.billing.usdtSentNote')" />
          </a-flex>
        </a-col>
      </a-row>
    </a-modal>
  </div>
</template>

<style scoped>
.small-text { font-size: 12px; }
.title-ico { color: var(--pb-primary); }
.kpi-in { color: var(--pb-success); }
.kpi-out { color: var(--pb-warning); }
.narrow { max-width: 600px; }
.full-width { width: 100%; }
.spacer { flex: 1; }
.muted { color: var(--pb-text-3); }
.one-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.amount-input { width: 100%; margin-top: 6px; font-size: 18px; }
.presets { margin-top: 10px; }

/* Selectable payment-method tile */
.choice { position: relative; height: 100%; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s; }
.choice:focus-visible { outline: 2px solid var(--pb-primary); outline-offset: 2px; }
.choice.is-selected { border-color: var(--pb-primary); box-shadow: 0 0 0 1px var(--pb-primary); background: var(--pb-primary-soft); }
.choice-check { position: absolute; top: 8px; right: 8px; color: var(--pb-primary); font-size: 16px; }
.choice-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; padding-right: 18px; line-height: 1.3; }
.choice-sub { font-size: 12px; }
.ico { flex: none; background: color-mix(in srgb, var(--ico) 16%, transparent); color: var(--ico); }
.ico-green { --ico: var(--pb-primary); }
.ico-blue { --ico: var(--pb-info); }
.ico-teal { --ico: #26a17b; }

.card-ico { font-size: 18px; }
.card-num { font-size: 14px; }
.switch-line { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }

.promo-row { margin-top: 6px; }
.promo-input { text-transform: uppercase; }

.tx-filters { padding: 12px 16px; }
.tx-search { width: 260px; max-width: 100%; }
.tx-type { width: 180px; }

.eyebrow-text { display: block; margin-top: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.tiers { margin-top: 6px; }
.order-item { cursor: pointer; }

/* QR codes stay black-on-white in both themes so scanners can read them */
.qr-col { display: flex; justify-content: center; }
.qr-box { display: inline-flex; padding: 8px; background: #fff; border-radius: 8px; line-height: 0; }
.qr-img { width: 220px; height: 220px; display: block; }
.qr-hint { max-width: 236px; text-align: center; line-height: 1.45; }
.usdt-amount { font-size: 15px; }
.charge { font-size: 15px; }
.pe-loading { padding: 20px; text-align: center; font-size: 12px; color: var(--pb-text-3); }
.secure-note { text-align: center; }
.stripe-body { padding-top: 4px; }

@media (min-width: 992px) {
  .aside { position: sticky; top: 84px; }
}
@media (max-width: 575px) {
  .tx-search, .tx-type { width: 100%; }
}
</style>
