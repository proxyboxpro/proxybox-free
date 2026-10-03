<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const billing = ref(null)
const smtp = ref(null)
const testTo = ref('')
const err = ref('')
const loading = ref(false)
const saving = ref('') // which section is saving: stripe | paypal | binance | sepay | smtp
const testing = ref(false)
const webhookUrl = computed(() => `${window.location.origin}/api/webhooks/sepay`)

async function refresh() {
  loading.value = true
  try { billing.value = await apiFetch('/api/admin/billing/config'); smtp.value = await apiFetch('/api/admin/smtp'); err.value = '' }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function saveBilling(section) {
  saving.value = section
  try { await apiFetch('/api/admin/billing/config', { method: 'PATCH', body: billing.value }); message.success(t('admin.pay.savedBilling')); await refresh() }
  catch (e) { message.error(e.message) }
  finally { saving.value = '' }
}
async function saveSmtp() {
  saving.value = 'smtp'
  try { await apiFetch('/api/admin/smtp', { method: 'PATCH', body: smtp.value }); message.success(t('admin.pay.savedSmtp')); await refresh() }
  catch (e) { message.error(e.message) }
  finally { saving.value = '' }
}
async function sendTest() {
  if (!testTo.value) return
  testing.value = true
  try {
    const r = await apiFetch('/api/admin/smtp/test', { method: 'POST', body: { to: testTo.value } })
    if (r.ok) message.success(t('admin.pay.testEmailSent'))
    else message.error(t('admin.pay.testFailed'))
  } catch (e) { message.error(e.message) }
  finally { testing.value = false }
}
onMounted(refresh)
</script>

<template>
  <div class="page">
    <!-- eslint-disable vue/no-v-html -- help strings are trusted i18n dictionary HTML -->
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.pay.eyebrow') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />
    <a-card v-if="!billing && !smtp && loading" loading />

    <!-- ── Stripe ── -->
    <a-card v-if="billing" :title="t('admin.pay.stripeTitle')">
      <template #extra><CreditCardOutlined /></template>
      <a-typography-paragraph type="secondary"><span v-html="t('admin.pay.stripeHelp')"></span></a-typography-paragraph>
      <a-form layout="vertical" :model="billing" @finish="saveBilling('stripe')">
        <a-form-item>
          <a-checkbox v-model:checked="billing.testMode">{{ t('admin.pay.testMode') }}</a-checkbox>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.currency')">
              <a-input v-model:value="billing.currency" :maxlength="8" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.trialCredits')">
              <a-input-number v-model:value="billing.trialCredits" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.affiliateKickback')">
              <a-input-number v-model:value="billing.affiliateKickback" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.stripeSecretKey')">
              <a-input v-model:value="billing.stripeSecretKey" placeholder="sk_test_..." class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.stripeWebhookSecret')">
              <a-input v-model:value="billing.stripeWebhookSecret" placeholder="whsec_..." class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.stripePublishableKey')">
              <a-input v-model:value="billing.stripePublishableKey" placeholder="pk_live_..." class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.pay.stripeMin')">
              <a-input-number v-model:value="billing.stripeMin" :min="0" :step="1" placeholder="5" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.pay.stripeRate')">
              <a-input-number v-model:value="billing.stripeRate" :min="1" :step="100" placeholder="25000" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.pay.stripeFeePct')">
              <a-input-number v-model:value="billing.stripeFeePct" :min="0" :max="99" :step="0.1" placeholder="3.9" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.pay.stripeFeeFixed')">
              <a-input-number v-model:value="billing.stripeFeeFixed" :min="0" :step="0.05" placeholder="0.30" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-typography-paragraph type="secondary" class="help"><span v-html="t('admin.pay.stripeFeeHelp')"></span></a-typography-paragraph>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.autoRechargeThreshold')">
              <a-input-number v-model:value="billing.autoRechargeThreshold" :min="0" :step="10000" placeholder="50000" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.autoRechargeAmount')">
              <a-input-number v-model:value="billing.autoRechargeAmount" :min="0" :step="10000" placeholder="200000" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.autoRechargeMaxPerDay')">
              <a-input-number v-model:value="billing.autoRechargeMaxPerDay" :min="1" :step="1" placeholder="5" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.successUrl')">
              <a-input v-model:value="billing.successUrl" placeholder="https://your-domain/vi/customer/billing?paid=1" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.cancelUrl')">
              <a-input v-model:value="billing.cancelUrl" placeholder="https://your-domain/vi/customer/billing?paid=0" class="mono" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="saving === 'stripe'">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pay.saveBilling') }}
        </a-button>
      </a-form>
    </a-card>

    <!-- ── PayPal ── -->
    <a-card v-if="billing" :title="t('admin.pay.paypalTitle')">
      <a-typography-paragraph type="secondary"><span v-html="t('admin.pay.paypalHelp')"></span></a-typography-paragraph>
      <a-form layout="vertical" :model="billing" @finish="saveBilling('paypal')">
        <a-form-item>
          <a-checkbox v-model:checked="billing.paypalEnabled">{{ t('admin.pay.paypalEnable') }}</a-checkbox>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.mode')">
              <a-select v-model:value="billing.paypalMode">
                <a-select-option value="sandbox">{{ t('admin.pay.modeSandbox') }}</a-select-option>
                <a-select-option value="live">{{ t('admin.pay.modeLive') }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.paypalCurrency')">
              <a-input v-model:value="billing.paypalCurrency" placeholder="USD" :maxlength="8" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.paypalRate', { pay: (billing.paypalCurrency || 'USD'), wallet: (billing.currency || 'VND').toUpperCase() })">
              <a-input-number v-model:value="billing.paypalRate" :min="1" :step="100" placeholder="25000" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-typography-paragraph type="secondary" class="help">
              <span v-html="t('admin.pay.paypalRateHelp', { pay: (billing.paypalCurrency || 'USD'), wallet: (billing.currency || 'VND').toUpperCase(), rate: Number(billing.paypalRate || 25000).toLocaleString() })"></span>
            </a-typography-paragraph>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.paypalMin')">
              <a-input-number v-model:value="billing.paypalMin" :min="0" :step="1" placeholder="5" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.paypalFeePct')">
              <a-input-number v-model:value="billing.paypalFeePct" :min="0" :max="99" :step="0.1" placeholder="4.4" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.paypalFeeFixed')">
              <a-input-number v-model:value="billing.paypalFeeFixed" :min="0" :step="0.05" placeholder="0.30" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-typography-paragraph type="secondary" class="help">
              <span v-html="t('admin.pay.paypalFeeHelp', { pay: (billing.paypalCurrency || 'USD') })"></span>
            </a-typography-paragraph>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.paypalClientId')">
              <a-input v-model:value="billing.paypalClientId" placeholder="A21AAH..." class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.paypalSecret')">
              <a-input-password v-model:value="billing.paypalSecret" placeholder="EL2..." class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.paypalReturnUrl')">
              <a-input v-model:value="billing.paypalReturnUrl" placeholder="https://your-domain/customer/billing?paypal=ok" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.cancelUrl')">
              <a-input v-model:value="billing.paypalCancelUrl" placeholder="https://your-domain/customer/billing?paypal=cancel" class="mono" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="saving === 'paypal'">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pay.savePaypal') }}
        </a-button>
      </a-form>
    </a-card>

    <!-- ── USDT / Binance ── -->
    <a-card v-if="billing" :title="t('admin.pay.binanceTitle')">
      <a-typography-paragraph type="secondary"><span v-html="t('admin.pay.binanceHelp')"></span></a-typography-paragraph>
      <a-form layout="vertical" :model="billing" @finish="saveBilling('binance')">
        <a-form-item>
          <a-checkbox v-model:checked="billing.binanceEnabled">{{ t('admin.pay.binanceEnable') }}</a-checkbox>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.binanceApiKey')">
              <a-input-password v-model:value="billing.binanceApiKey" placeholder="••••" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.binanceApiSecret')">
              <a-input-password v-model:value="billing.binanceApiSecret" placeholder="••••" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="16">
            <a-form-item :label="t('admin.pay.binanceDepositAddress')">
              <a-input v-model:value="billing.binanceDepositAddress" placeholder="0x…" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.pay.binanceNetwork')">
              <a-input v-model:value="billing.binanceNetwork" placeholder="BSC" :maxlength="16" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.binanceContract')">
              <a-input v-model:value="billing.binanceContract" placeholder="0x55d398326f99059ff775485246999027b3197955" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.pay.binanceRate')">
              <a-input-number v-model:value="billing.binanceRate" :min="1" :step="100" placeholder="25000" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.pay.binanceMin')">
              <a-input-number v-model:value="billing.binanceMin" :min="0" :step="1" placeholder="5" class="full-width" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="saving === 'binance'">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pay.saveBinance') }}
        </a-button>
      </a-form>
    </a-card>

    <!-- ── SePay ── -->
    <a-card v-if="billing" :title="t('admin.pay.sepayTitle')">
      <a-typography-paragraph type="secondary"><span v-html="t('admin.pay.sepayHelp')"></span></a-typography-paragraph>
      <a-form layout="vertical" :model="billing" @finish="saveBilling('sepay')">
        <a-form-item>
          <a-checkbox v-model:checked="billing.sepayEnabled">{{ t('admin.pay.sepayEnable') }}</a-checkbox>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.sepayApiKey')">
              <a-input-password v-model:value="billing.sepayApiKey" placeholder="••••" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.pay.sepayBankCode')">
              <a-input v-model:value="billing.sepayBankCode" placeholder="VCB, TCB, MB, ACB, BIDV..." :maxlength="16" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.pay.sepayAccountNumber')">
              <a-input v-model:value="billing.sepayAccountNumber" placeholder="1017588888" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="16">
            <a-form-item :label="t('admin.pay.sepayAccountHolder')">
              <a-input v-model:value="billing.sepayAccountHolder" placeholder="NGUYEN VAN A" :maxlength="64" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.pay.sepayPrefix')">
              <a-input v-model:value="billing.sepayPrefix" placeholder="PB" :maxlength="8" class="mono" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item :label="t('admin.pay.sepayWebhookLabel')">
          <a-typography-text :copyable="{ text: webhookUrl }" code class="mono">{{ webhookUrl }}</a-typography-text>
        </a-form-item>
        <a-button type="primary" html-type="submit" :loading="saving === 'sepay'">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pay.saveSepay') }}
        </a-button>
      </a-form>
    </a-card>

    <!-- ── SMTP ── -->
    <a-card v-if="smtp" :title="t('admin.pay.smtpTitle')">
      <template #extra><MailOutlined /></template>
      <a-typography-paragraph type="secondary">{{ t('admin.pay.smtpHelp') }}</a-typography-paragraph>
      <a-form layout="vertical" :model="smtp" @finish="saveSmtp">
        <a-row :gutter="16">
          <a-col :xs="24" :sm="16" :lg="12">
            <a-form-item :label="t('admin.pay.smtpHost')">
              <a-input v-model:value="smtp.host" placeholder="smtp.sendgrid.net" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8" :lg="4">
            <a-form-item :label="t('admin.pay.smtpPort')">
              <a-input-number v-model:value="smtp.port" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="4">
            <a-form-item :label="t('admin.pay.smtpUser')">
              <a-input v-model:value="smtp.user" placeholder="apikey" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="4">
            <a-form-item :label="t('admin.pay.smtpPass')">
              <a-input-password v-model:value="smtp.pass" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.pay.smtpFrom')">
              <a-input v-model:value="smtp.from" placeholder="ProxyBox <no-reply@your-domain>" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="saving === 'smtp'">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pay.saveSmtp') }}
        </a-button>
      </a-form>
      <a-divider />
      <a-space-compact class="test-mail">
        <a-input v-model:value="testTo" :placeholder="t('admin.pay.testEmailPh')" class="mono" @press-enter="sendTest" />
        <a-button :loading="testing" @click="sendTest">
          <template #icon><SendOutlined /></template>
          {{ t('admin.pay.sendTest') }}
        </a-button>
      </a-space-compact>
    </a-card>
  </div>
</template>

<style scoped>
.help { margin-top: -8px; font-size: 12px; }
.test-mail { width: 420px; max-width: 100%; }
</style>
