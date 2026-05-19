<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'

const billing = ref(null)
const smtp = ref(null)
const testTo = ref('')
const err = ref(''); const flash = ref('')

async function refresh() {
  try { billing.value = await apiFetch('/api/admin/billing/config'); smtp.value = await apiFetch('/api/admin/smtp') }
  catch (e) { err.value = e.message }
}
async function saveBilling() {
  try { await apiFetch('/api/admin/billing/config', { method: 'PATCH', body: billing.value }); flash.value = 'Billing config saved.'; await refresh() }
  catch (e) { err.value = e.message }
}
async function saveSmtp() {
  try { await apiFetch('/api/admin/smtp', { method: 'PATCH', body: smtp.value }); flash.value = 'SMTP saved.'; await refresh() }
  catch (e) { err.value = e.message }
}
async function sendTest() {
  if (!testTo.value) return
  try { const r = await apiFetch('/api/admin/smtp/test', { method: 'POST', body: { to: testTo.value } }); flash.value = r.ok ? 'Test email sent.' : 'Test failed — see /api/nodes/local/logs' }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>
<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Payment & email</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section v-if="billing" class="surface">
      <div class="section-head"><h2>Billing &amp; Stripe</h2></div>
      <p style="font-size:13px; color:var(--muted)">Stripe Checkout integration. Khi enable production phải set <code>testMode=false</code>, đặt thật <code>stripeSecretKey</code> + <code>stripeWebhookSecret</code> (lấy từ Stripe Dashboard), và 2 URL redirect.</p>
      <div class="form-grid">
        <label class="check-line" style="grid-column:1/-1"><input v-model="billing.testMode" type="checkbox" /><span>Test mode (cho phép topup không cần Stripe — dev/staging only)</span></label>
        <label class="input-field"><span>Currency</span><input v-model="billing.currency" maxlength="8" /></label>
        <label class="input-field"><span>Trial credits (new user signup)</span><input v-model.number="billing.trialCredits" type="number" min="0" /></label>
        <label class="input-field"><span>Affiliate kickback (per signup via referral)</span><input v-model.number="billing.affiliateKickback" type="number" min="0" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Stripe secret key (sk_live_… or sk_test_…)</span><input v-model="billing.stripeSecretKey" placeholder="sk_test_..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Stripe webhook secret (whsec_…)</span><input v-model="billing.stripeWebhookSecret" placeholder="whsec_..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Success URL (after payment)</span><input v-model="billing.successUrl" placeholder="https://your-domain/vi/customer/billing?paid=1" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Cancel URL</span><input v-model="billing.cancelUrl" placeholder="https://your-domain/vi/customer/billing?paid=0" /></label>
      </div>
      <button class="primary-action small" type="button" @click="saveBilling">Save billing</button>
    </section>

    <section v-if="billing" class="surface">
      <div class="section-head"><h2>PayPal</h2></div>
      <p style="font-size:13px; color:var(--muted)">PayPal Checkout — customer top-up wallet bằng PayPal (redirect flow). Lấy <code>Client ID</code> + <code>Secret</code> tại <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener">developer.paypal.com</a>. Sandbox dùng để test, Live cho production.</p>
      <div class="form-grid">
        <label class="check-line" style="grid-column:1/-1"><input v-model="billing.paypalEnabled" type="checkbox" /><span>Enable PayPal payment cho customer</span></label>
        <label class="input-field"><span>Mode</span>
          <select v-model="billing.paypalMode">
            <option value="sandbox">Sandbox (test)</option>
            <option value="live">Live (production)</option>
          </select>
        </label>
        <label class="input-field"><span>PayPal currency (default cho topup)</span><input v-model="billing.paypalCurrency" placeholder="USD" maxlength="8" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Client ID</span><input v-model="billing.paypalClientId" placeholder="A21AAH..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Secret</span><input v-model="billing.paypalSecret" type="password" placeholder="EL2..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Return URL (after PayPal approve)</span><input v-model="billing.paypalReturnUrl" placeholder="https://your-domain/customer/billing?paypal=ok" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>Cancel URL</span><input v-model="billing.paypalCancelUrl" placeholder="https://your-domain/customer/billing?paypal=cancel" /></label>
      </div>
      <button class="primary-action small" type="button" @click="saveBilling">Save PayPal</button>
    </section>

    <section v-if="smtp" class="surface">
      <div class="section-head"><h2>SMTP (email transactional)</h2></div>
      <p style="font-size:13px; color:var(--muted)">SendGrid / Resend / Mailgun / Postmark — bất kỳ provider nào hỗ trợ SMTP+STARTTLS. Port 465 = implicit TLS, 587 = STARTTLS.</p>
      <div class="form-grid">
        <label class="input-field"><span>Host</span><input v-model="smtp.host" placeholder="smtp.sendgrid.net" /></label>
        <label class="input-field"><span>Port</span><input v-model.number="smtp.port" type="number" /></label>
        <label class="input-field"><span>User</span><input v-model="smtp.user" placeholder="apikey" /></label>
        <label class="input-field"><span>Pass / API key</span><input v-model="smtp.pass" type="password" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>From address</span><input v-model="smtp.from" placeholder="ProxyBox &lt;no-reply@your-domain&gt;" /></label>
      </div>
      <div class="action-row" style="margin-top:8px">
        <button class="primary-action small" type="button" @click="saveSmtp">Save SMTP</button>
        <input v-model="testTo" placeholder="recipient@email" class="search-input" style="margin-left:8px" />
        <button class="ghost-button" type="button" @click="sendTest">Send test email</button>
      </div>
    </section>
  </section>
</template>
