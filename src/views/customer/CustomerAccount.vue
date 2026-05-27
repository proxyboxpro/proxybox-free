<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Clipboard, Download, KeyRound, Lock, Mail, RefreshCw, ShieldCheck, ShieldOff,
  User, Wallet, Webhook
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const account = ref(null)
const totp = ref({ secret: '', otpauthUri: '', code: '' })
const pwd = ref({ old: '', neu: '' })
const wh = ref({ url: '', events: [] })
const WH_EVENTS = ['proxy.expired', 'proxy.expiringSoon', 'proxy.checkFailed', 'proxy.ipRotated']
const err = ref('')
const flash = ref('')
const members = ref([])
const inviteEmail = ref('')

async function refresh() {
  err.value = ''
  try {
    account.value = await apiFetch('/api/v1/user/account')
    wh.value.url = account.value.webhookUrl || ''
    wh.value.events = Array.isArray(account.value.webhookEvents) && account.value.webhookEvents.length
      ? account.value.webhookEvents
      : WH_EVENTS.slice()
    members.value = await apiFetch('/api/v1/user/members').catch(() => [])
  } catch (e) { err.value = e.message }
}
async function addMember() {
  err.value = ''; flash.value = ''
  const email = inviteEmail.value.trim()
  if (!email) return
  try {
    const m = await apiFetch('/api/v1/user/members', { method: 'POST', body: { email } })
    if (!members.value.find((x) => x.id === m.id)) members.value.push(m)
    inviteEmail.value = ''
    flash.value = t('cust.account.shareDone', { email: m.email })
  } catch (e) { err.value = e.message }
}
async function removeMember(id) {
  try { await apiFetch(`/api/v1/user/members/${id}`, { method: 'DELETE' }); members.value = members.value.filter((m) => m.id !== id) }
  catch (e) { err.value = e.message }
}
async function enrollTotp() {
  err.value = ''
  try {
    const r = await apiFetch('/api/v1/user/auth/totp/enroll', { method: 'POST' })
    totp.value.secret = r.secret; totp.value.otpauthUri = r.otpauthUri
  } catch (e) { err.value = e.message }
}
async function confirmTotp() {
  try {
    await apiFetch('/api/v1/user/auth/totp/confirm', { method: 'POST', body: { code: totp.value.code } })
    flash.value = t('cust.account.totpEnabled'); totp.value = { secret: '', otpauthUri: '', code: '' }; await refresh()
  } catch (e) { err.value = e.message }
}
async function disableTotp() {
  const code = prompt(t('cust.account.disableTotpPrompt')); if (!code) return
  try { await apiFetch('/api/v1/user/auth/totp/disable', { method: 'POST', body: { code } }); flash.value = t('cust.account.totpDisabled'); await refresh() }
  catch (e) { err.value = e.message }
}
async function regenKey() {
  if (!confirm(t('cust.account.regenKeyConfirm'))) return
  try {
    const r = await apiFetch('/api/v1/user/account/regenerate-api-key', { method: 'POST' })
    account.value.apiKey = r.apiKey; flash.value = t('cust.account.keyRotated')
  } catch (e) { err.value = e.message }
}
async function saveWebhook() {
  try {
    await apiFetch('/api/v1/user/account/webhook', { method: 'PATCH', body: { url: wh.value.url, events: wh.value.events } })
    flash.value = t('cust.account.webhookSaved')
  }
  catch (e) { err.value = e.message }
}
async function testWebhook() {
  try {
    await apiFetch('/api/v1/user/account/webhook/test', { method: 'POST' })
    flash.value = t('cust.account.webhookTested')
  } catch (e) { err.value = e.data?.error || e.message }
}
function toggleWhEvent(ev) {
  const cur = wh.value.events || []
  wh.value.events = cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]
}
async function changePwd() {
  try {
    await apiFetch('/api/v1/user/account/change-password', { method: 'POST', body: { oldPassword: pwd.value.old, newPassword: pwd.value.neu } })
    flash.value = t('cust.account.pwdChanged')
    setTimeout(() => location.href = '/login', 1500)
  } catch (e) { err.value = e.message }
}
function copy(text, label) {
  navigator.clipboard?.writeText(text); flash.value = label || t('cust.detail.copied'); setTimeout(() => flash.value = '', 1200)
}
function gdpr() { window.open('/api/v1/user/gdpr/export', '_blank') }

const totpOn = computed(() => Boolean(account.value?.totpEnabled))

onMounted(refresh)
</script>

<template>
  <h1>{{ t('cust.account.title') }}</h1>
  <p class="sub">{{ t('cust.account.subtitle') }}</p>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" style="color:#4ade80; font-size:13px">{{ flash }}</p>

  <div v-if="account">
    <!-- KPI row -->
    <div class="kpi-row">
      <div class="kpi-card-v2">
        <span class="ico purple"><User :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.account.kpiUser') }}</span>
          <span class="val" style="font-size:16px">{{ account.name || account.email }}</span>
          <span class="foot"><span class="dot"></span> {{ account.email }}</span>
        </div>
      </div>
      <div class="kpi-card-v2">
        <span class="ico green"><Wallet :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.side.balance') }}</span>
          <span class="val">{{ Number(account.balance || 0).toLocaleString() }}</span>
          <span class="foot"><span class="dot"></span> VND</span>
        </div>
      </div>
      <div class="kpi-card-v2">
        <span :class="['ico', totpOn ? 'green' : 'amber']">
          <ShieldCheck v-if="totpOn" :size="22" />
          <ShieldOff v-else :size="22" />
        </span>
        <div class="body">
          <span class="lbl">{{ t('cust.account.kpi2fa') }}</span>
          <span class="val" style="font-size:18px">{{ totpOn ? t('cust.detail.on') : t('cust.detail.off') }}</span>
          <span :class="['foot', totpOn ? '' : 'warn']"><span class="dot"></span> {{ totpOn ? t('cust.account.kpi2faOn') : t('cust.account.kpi2faOff') }}</span>
        </div>
      </div>
    </div>

    <!-- 2 columns -->
    <div class="acct-2col">
      <!-- Profile -->
      <section class="surface">
        <h2 style="margin:0 0 10px; color:var(--text); font-size:15px"><User :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.profile') }}</h2>
        <div style="display:flex; flex-direction:column; gap:0">
          <div class="kv" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--pxl-bd-soft)"><span style="color:var(--muted); font-size:12.5px">{{ t('field.fullName') }}</span><span style="color:var(--text); font-size:13px">{{ account.name || '—' }}</span></div>
          <div class="kv" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--pxl-bd-soft)"><span style="color:var(--muted); font-size:12.5px">Email</span><span class="cell-mono" style="color:var(--text)">{{ account.email }}</span></div>
          <div class="kv" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--pxl-bd-soft); align-items:center">
            <span style="color:var(--muted); font-size:12.5px">{{ t('cust.account.refCode') }}</span>
            <span class="cell-mono" style="color:var(--text); display:inline-flex; align-items:center; gap:6px">
              {{ account.referralCode }}
              <button class="row-menu" type="button" style="width:24px; height:24px" @click="copy(account.referralCode, t('cust.account.refCopied'))"><Clipboard :size="12" /></button>
            </span>
          </div>
          <div class="kv" style="display:flex; justify-content:space-between; padding:8px 0"><span style="color:var(--muted); font-size:12.5px">{{ t('cust.account.joinedAt') }}</span><span style="color:var(--text); font-size:13px">{{ account.tosAcceptedAt || '—' }}</span></div>
        </div>
      </section>

      <!-- 2FA -->
      <section id="security" class="surface">
        <h2 style="margin:0 0 10px; color:var(--text); font-size:15px">
          <ShieldCheck :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.security') }}
        </h2>
        <template v-if="totpOn">
          <div style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--pxl-card-2); border-radius:10px; margin-bottom:10px">
            <ShieldCheck :size="20" style="color:#4ade80" />
            <div>
              <div style="color:var(--text); font-size:13px; font-weight:600">{{ t('cust.account.totpActive') }}</div>
              <div style="color:var(--muted); font-size:11.5px">{{ t('cust.account.totpActiveDesc') }}</div>
            </div>
          </div>
          <button class="ghost-button" type="button" @click="disableTotp"><ShieldOff :size="14" /> {{ t('cust.account.disable2fa') }}</button>
        </template>
        <template v-else>
          <div v-if="!totp.secret" style="display:flex; align-items:center; gap:10px; padding:12px; background:var(--pxl-card-2); border-radius:10px; margin-bottom:10px">
            <ShieldOff :size="20" style="color:#fbbf24" />
            <div>
              <div style="color:var(--text); font-size:13px; font-weight:600">{{ t('cust.account.totpOff') }}</div>
              <div style="color:var(--muted); font-size:11.5px">{{ t('cust.account.totpOffDesc') }}</div>
            </div>
          </div>
          <button v-if="!totp.secret" class="primary-action" type="button" @click="enrollTotp"><ShieldCheck :size="14" /> {{ t('cust.account.enable2fa') }}</button>
          <template v-else>
            <span class="eyebrow">{{ t('cust.account.totpSecret') }}</span>
            <div class="credential-box" style="margin: 6px 0 8px; background: var(--pxl-card-2); border-color: var(--pxl-bd)"><code style="color:var(--text)">{{ totp.secret }}</code></div>
            <span class="eyebrow">otpauth URI</span>
            <div class="credential-box" style="margin: 6px 0 10px; background: var(--pxl-card-2); border-color: var(--pxl-bd)"><code style="word-break:break-all; color:var(--text); font-size:11px">{{ totp.otpauthUri }}</code></div>
            <label class="input-field" style="max-width:200px">
              <span>{{ t('cust.account.totpEnter') }}</span>
              <input v-model="totp.code" maxlength="6" inputmode="numeric" placeholder="123456" />
            </label>
            <button class="primary-action small" type="button" @click="confirmTotp">{{ t('cust.account.totpConfirm') }}</button>
          </template>
        </template>
      </section>

      <!-- Change password -->
      <section class="surface">
        <h2 style="margin:0 0 10px; color:var(--text); font-size:15px"><Lock :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.pwd') }}</h2>
        <p style="font-size:12px; color:var(--muted); margin-bottom:10px">{{ t('cust.account.pwdHint') }}</p>
        <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px">
          <label class="input-field"><span>{{ t('cust.account.pwdCurrent') }}</span><input v-model="pwd.old" type="password" /></label>
          <label class="input-field"><span>{{ t('cust.account.pwdNew') }}</span><input v-model="pwd.neu" type="password" /></label>
        </div>
        <button class="primary-action small" type="button" @click="changePwd"><Lock :size="13" /> {{ t('cust.account.pwdChange') }}</button>
      </section>

      <!-- API key + Webhook -->
      <section id="api" class="surface">
        <h2 style="margin:0 0 10px; color:var(--text); font-size:15px"><KeyRound :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.apiTitle') }}</h2>
        <p style="font-size:12px; color:var(--muted); margin-bottom:6px">{{ t('cust.account.apiHint') }} <code style="color:var(--pxl); background: var(--pxl-card-2); padding:1px 4px; border-radius:3px">X-Customer-Key</code></p>
        <div class="credential-box" style="display:flex; align-items:center; gap:8px; background: var(--pxl-card-2); border-color: var(--pxl-bd)">
          <code style="flex:1; word-break:break-all; color:var(--text); font-size:11.5px">{{ account.apiKey }}</code>
          <button class="row-menu" type="button" @click="copy(account.apiKey, t('cust.account.keyCopied'))"><Clipboard :size="14" /></button>
        </div>
        <div class="action-row" style="margin-top:10px">
          <button class="ghost-button" type="button" @click="regenKey"><RefreshCw :size="13" /> {{ t('cust.account.rotateKey') }}</button>
        </div>

        <h3 style="font-size:13px; color:var(--text); margin: 14px 0 8px; font-weight:600"><Webhook :size="12" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.webhook') }}</h3>
        <p style="font-size:11.5px; color:var(--muted); margin-bottom:8px">{{ t('cust.account.webhookHint') }}</p>
        <label class="input-field" style="margin-bottom:8px">
          <span>URL</span>
          <input v-model="wh.url" placeholder="https://your-server/hook" />
        </label>
        <div style="margin: 8px 0 12px">
          <span style="font-size:11.5px; color:var(--muted); display:block; margin-bottom:6px">{{ t('cust.account.webhookEvents') }}</span>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <label v-for="ev in WH_EVENTS" :key="ev" class="wh-event-chip" :class="{ active: wh.events.includes(ev) }">
              <input type="checkbox" :checked="wh.events.includes(ev)" @change="toggleWhEvent(ev)" style="display:none" />
              {{ ev }}
            </label>
          </div>
        </div>
        <div class="action-row">
          <button class="primary-action small" type="button" @click="saveWebhook">{{ t('cust.account.saveWebhook') }}</button>
          <button class="ghost-button" type="button" :disabled="!wh.url" @click="testWebhook">{{ t('cust.account.testWebhook') }}</button>
        </div>
      </section>
    </div>

    <!-- GDPR -->
    <section class="surface" style="margin-bottom:14px">
      <div style="display:flex; align-items:center; gap:14px">
        <span class="kpi-card-v2" style="padding:0; background:transparent; border:none">
          <span class="ico amber" style="width:48px; height:48px; border-radius:12px"><Download :size="22" /></span>
        </span>
        <div style="flex:1">
          <h3 style="margin:0; color:var(--text); font-size:14px; font-weight:600">{{ t('cust.account.gdprTitle') }}</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0">{{ t('cust.account.gdprDesc') }}</p>
        </div>
        <button class="ghost-button" type="button" @click="gdpr"><Download :size="14" /> {{ t('cust.account.gdprBtn') }}</button>
      </div>
    </section>

    <!-- Read-only proxy sharing -->
    <section class="surface" style="margin-bottom:14px">
      <h2 style="margin:0 0 10px; color:var(--text); font-size:15px">
        <User :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.account.shareTitle') }}
      </h2>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 12px">{{ t('cust.account.shareDesc') }}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; max-width:480px">
        <input v-model="inviteEmail" type="email" :placeholder="t('cust.account.sharePlaceholder')" style="flex:1 1 200px; min-width:0; height:38px; padding:0 11px; background:var(--pxl-card-2); border:1px solid var(--pxl-bd); border-radius:8px; color:var(--text); font-size:13px" @keyup.enter="addMember" />
        <button class="primary-action small" type="button" @click="addMember"><User :size="13" /> {{ t('cust.account.shareBtn') }}</button>
      </div>
      <div v-if="members.length" style="margin-top:12px; display:flex; flex-direction:column; gap:6px">
        <div v-for="m in members" :key="m.id" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; background:var(--pxl-card-2); border:1px solid var(--pxl-bd); border-radius:8px">
          <span class="cell-mono" style="font-size:12.5px; color:var(--text); word-break:break-all">{{ m.email }}</span>
          <button class="ghost-button" type="button" @click="removeMember(m.id)">{{ t('cust.account.shareRemove') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wh-event-chip {
  display: inline-flex; align-items: center;
  padding: 4px 10px; font-size: 11px; font-family: var(--mono);
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--muted); cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.wh-event-chip:hover { color: var(--text); border-color: var(--muted); }
.wh-event-chip.active { background: var(--green-soft); border-color: var(--green); color: var(--green); }
/* Account cards: 2-col on desktop, stack on tablet/phone */
.acct-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
@media (max-width: 900px) { .acct-2col { grid-template-columns: 1fr; } }
</style>
