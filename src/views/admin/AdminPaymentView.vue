<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const billing = ref(null)
const smtp = ref(null)
const testTo = ref('')
const err = ref(''); const flash = ref('')
const webhookUrl = computed(() => `${window.location.origin}/api/webhooks/sepay`)

async function refresh() {
  try { billing.value = await apiFetch('/api/admin/billing/config'); smtp.value = await apiFetch('/api/admin/smtp') }
  catch (e) { err.value = e.message }
}
async function saveBilling() {
  try { await apiFetch('/api/admin/billing/config', { method: 'PATCH', body: billing.value }); flash.value = t('admin.pay.savedBilling'); await refresh() }
  catch (e) { err.value = e.message }
}
async function saveSmtp() {
  try { await apiFetch('/api/admin/smtp', { method: 'PATCH', body: smtp.value }); flash.value = t('admin.pay.savedSmtp'); await refresh() }
  catch (e) { err.value = e.message }
}
async function sendTest() {
  if (!testTo.value) return
  try { const r = await apiFetch('/api/admin/smtp/test', { method: 'POST', body: { to: testTo.value } }); flash.value = r.ok ? t('admin.pay.testEmailSent') : t('admin.pay.testFailed') }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>
<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.pay.eyebrow') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section v-if="billing" class="surface">
      <div class="section-head"><h2>{{ t('admin.pay.stripeTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted)" v-html="t('admin.pay.stripeHelp')"></p>
      <div class="form-grid">
        <label class="check-line" style="grid-column:1/-1"><input v-model="billing.testMode" type="checkbox" /><span>{{ t('admin.pay.testMode') }}</span></label>
        <label class="input-field"><span>{{ t('admin.pay.currency') }}</span><input v-model="billing.currency" maxlength="8" /></label>
        <label class="input-field"><span>{{ t('admin.pay.trialCredits') }}</span><input v-model.number="billing.trialCredits" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('admin.pay.affiliateKickback') }}</span><input v-model.number="billing.affiliateKickback" type="number" min="0" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.stripeSecretKey') }}</span><input v-model="billing.stripeSecretKey" placeholder="sk_test_..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.stripeWebhookSecret') }}</span><input v-model="billing.stripeWebhookSecret" placeholder="whsec_..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.successUrl') }}</span><input v-model="billing.successUrl" placeholder="https://your-domain/vi/customer/billing?paid=1" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.cancelUrl') }}</span><input v-model="billing.cancelUrl" placeholder="https://your-domain/vi/customer/billing?paid=0" /></label>
      </div>
      <button class="primary-action small" type="button" @click="saveBilling">{{ t('admin.pay.saveBilling') }}</button>
    </section>

    <section v-if="billing" class="surface">
      <div class="section-head"><h2>{{ t('admin.pay.paypalTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted)" v-html="t('admin.pay.paypalHelp')"></p>
      <div class="form-grid">
        <label class="check-line" style="grid-column:1/-1"><input v-model="billing.paypalEnabled" type="checkbox" /><span>{{ t('admin.pay.paypalEnable') }}</span></label>
        <label class="input-field"><span>{{ t('admin.pay.mode') }}</span>
          <select v-model="billing.paypalMode">
            <option value="sandbox">{{ t('admin.pay.modeSandbox') }}</option>
            <option value="live">{{ t('admin.pay.modeLive') }}</option>
          </select>
        </label>
        <label class="input-field"><span>{{ t('admin.pay.paypalCurrency') }}</span><input v-model="billing.paypalCurrency" placeholder="USD" maxlength="8" /></label>
        <label class="input-field"><span>{{ t('admin.pay.paypalRate') }}</span><input v-model.number="billing.paypalRate" type="number" min="1" step="100" placeholder="25000" /></label>
        <p style="grid-column:1/-1; font-size:12px; color:var(--muted); margin:-2px 0 4px" v-html="t('admin.pay.paypalRateHelp', { pay: (billing.paypalCurrency || 'USD'), wallet: (billing.currency || 'VND').toUpperCase(), rate: Number(billing.paypalRate || 25000).toLocaleString() })"></p>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.paypalClientId') }}</span><input v-model="billing.paypalClientId" placeholder="A21AAH..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.paypalSecret') }}</span><input v-model="billing.paypalSecret" type="password" placeholder="EL2..." /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.paypalReturnUrl') }}</span><input v-model="billing.paypalReturnUrl" placeholder="https://your-domain/customer/billing?paypal=ok" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.cancelUrl') }}</span><input v-model="billing.paypalCancelUrl" placeholder="https://your-domain/customer/billing?paypal=cancel" /></label>
      </div>
      <button class="primary-action small" type="button" @click="saveBilling">{{ t('admin.pay.savePaypal') }}</button>
    </section>

    <section v-if="billing" class="surface">
      <div class="section-head"><h2>{{ t('admin.pay.sepayTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted)" v-html="t('admin.pay.sepayHelp')"></p>
      <div class="form-grid">
        <label class="check-line" style="grid-column:1/-1"><input v-model="billing.sepayEnabled" type="checkbox" /><span>{{ t('admin.pay.sepayEnable') }}</span></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.sepayApiKey') }}</span><input v-model="billing.sepayApiKey" type="password" placeholder="••••" /></label>
        <label class="input-field"><span>{{ t('admin.pay.sepayBankCode') }}</span><input v-model="billing.sepayBankCode" placeholder="VCB, TCB, MB, ACB, BIDV..." maxlength="16" /></label>
        <label class="input-field"><span>{{ t('admin.pay.sepayAccountNumber') }}</span><input v-model="billing.sepayAccountNumber" placeholder="1017588888" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.sepayAccountHolder') }}</span><input v-model="billing.sepayAccountHolder" placeholder="NGUYEN VAN A" maxlength="64" /></label>
        <label class="input-field"><span>{{ t('admin.pay.sepayPrefix') }}</span><input v-model="billing.sepayPrefix" placeholder="PB" maxlength="8" /></label>
      </div>
      <p style="font-size:12px; color:var(--muted); margin-top:6px">
        <strong>{{ t('admin.pay.sepayWebhookLabel') }}:</strong>
        <code style="font-family:var(--mono); background:var(--surface-2); padding:2px 6px; border-radius:4px; margin-left:4px">{{ webhookUrl }}</code>
      </p>
      <button class="primary-action small" type="button" @click="saveBilling">{{ t('admin.pay.saveSepay') }}</button>
    </section>

    <section v-if="smtp" class="surface">
      <div class="section-head"><h2>{{ t('admin.pay.smtpTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted)">{{ t('admin.pay.smtpHelp') }}</p>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.pay.smtpHost') }}</span><input v-model="smtp.host" placeholder="smtp.sendgrid.net" /></label>
        <label class="input-field"><span>{{ t('admin.pay.smtpPort') }}</span><input v-model.number="smtp.port" type="number" /></label>
        <label class="input-field"><span>{{ t('admin.pay.smtpUser') }}</span><input v-model="smtp.user" placeholder="apikey" /></label>
        <label class="input-field"><span>{{ t('admin.pay.smtpPass') }}</span><input v-model="smtp.pass" type="password" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.pay.smtpFrom') }}</span><input v-model="smtp.from" placeholder="ProxyBox &lt;no-reply@your-domain&gt;" /></label>
      </div>
      <div class="action-row" style="margin-top:8px">
        <button class="primary-action small" type="button" @click="saveSmtp">{{ t('admin.pay.saveSmtp') }}</button>
        <input v-model="testTo" :placeholder="t('admin.pay.testEmailPh')" class="search-input" style="margin-left:8px" />
        <button class="ghost-button" type="button" @click="sendTest">{{ t('admin.pay.sendTest') }}</button>
      </div>
    </section>
  </section>
</template>
