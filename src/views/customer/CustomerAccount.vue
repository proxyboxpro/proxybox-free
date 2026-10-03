<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync, promptAsync } from '../../ui/feedback'

const { t } = useI18n()
const route = useRoute()
const account = ref(null)
const totp = ref({ secret: '', otpauthUri: '', code: '' })
const pwd = ref({ old: '', neu: '' })
const wh = ref({ url: '', events: [] })
const WH_EVENTS = ['proxy.expired', 'proxy.expiringSoon', 'proxy.checkFailed', 'proxy.ipRotated']
const err = ref('')
const members = ref([])
const inviteEmail = ref('')
const busy = ref('') // key of the action currently in flight (button loading state)

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
  const email = inviteEmail.value.trim()
  if (!email) return
  busy.value = 'member'
  try {
    const m = await apiFetch('/api/v1/user/members', { method: 'POST', body: { email } })
    if (!members.value.find((x) => x.id === m.id)) members.value.push(m)
    inviteEmail.value = ''
    message.success(t('cust.account.shareDone', { email: m.email }))
  } catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
async function removeMember(id) {
  try { await apiFetch(`/api/v1/user/members/${id}`, { method: 'DELETE' }); members.value = members.value.filter((m) => m.id !== id) }
  catch (e) { message.error(e.message) }
}
async function enrollTotp() {
  busy.value = 'enroll'
  try {
    const r = await apiFetch('/api/v1/user/auth/totp/enroll', { method: 'POST' })
    totp.value.secret = r.secret; totp.value.otpauthUri = r.otpauthUri
  } catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
async function confirmTotp() {
  busy.value = 'totp'
  try {
    await apiFetch('/api/v1/user/auth/totp/confirm', { method: 'POST', body: { code: totp.value.code } })
    message.success(t('cust.account.totpEnabled')); totp.value = { secret: '', otpauthUri: '', code: '' }; await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
async function disableTotp() {
  const code = await promptAsync({ title: t('cust.account.disableTotpPrompt'), placeholder: '123456', danger: true })
  if (!code) return
  try { await apiFetch('/api/v1/user/auth/totp/disable', { method: 'POST', body: { code } }); message.success(t('cust.account.totpDisabled')); await refresh() }
  catch (e) { message.error(e.message) }
}
async function regenKey() {
  if (!(await confirmAsync({ title: t('cust.account.regenKeyConfirm'), danger: true }))) return
  try {
    const r = await apiFetch('/api/v1/user/account/regenerate-api-key', { method: 'POST' })
    account.value.apiKey = r.apiKey; message.success(t('cust.account.keyRotated'))
  } catch (e) { message.error(e.message) }
}
async function saveWebhook() {
  busy.value = 'webhook'
  try {
    await apiFetch('/api/v1/user/account/webhook', { method: 'PATCH', body: { url: wh.value.url, events: wh.value.events } })
    message.success(t('cust.account.webhookSaved'))
  }
  catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
async function testWebhook() {
  busy.value = 'whtest'
  try {
    await apiFetch('/api/v1/user/account/webhook/test', { method: 'POST' })
    message.success(t('cust.account.webhookTested'))
  } catch (e) { message.error(e.data?.error || e.message) }
  finally { busy.value = '' }
}
async function changePwd() {
  busy.value = 'pwd'
  try {
    await apiFetch('/api/v1/user/account/change-password', { method: 'POST', body: { oldPassword: pwd.value.old, newPassword: pwd.value.neu } })
    message.success(t('cust.account.pwdChanged'))
    setTimeout(() => location.href = '/login', 1500)
  } catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
function copy(text, label) {
  navigator.clipboard?.writeText(text); message.success(label || t('cust.detail.copied'))
}
function gdpr() { window.open('/api/v1/user/gdpr/export', '_blank') }

const totpOn = computed(() => Boolean(account.value?.totpEnabled))

// The sections only render once the account has loaded, so the router's
// hash scroll (/account#security, /account#api) can miss them on first entry.
function scrollToHash() {
  if (!route.hash) return
  nextTick(() => {
    try { document.querySelector(route.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* invalid selector */ }
  })
}

onMounted(async () => {
  await refresh()
  scrollToHash()
})
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.account.subtitle') }}</a-typography-text>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card v-if="!account && !err"><a-skeleton active /></a-card>

    <template v-if="account">
      <!-- KPI row -->
      <a-row :gutter="[12, 12]">
        <a-col :xs="24" :sm="8">
          <a-card size="small" class="fill">
            <a-statistic :title="t('cust.account.kpiUser')" :value="account.name || account.email" :value-style="{ fontSize: '16px', fontWeight: 600 }">
              <template #prefix><UserOutlined class="kpi-ico" /></template>
            </a-statistic>
            <a-typography-text type="secondary" class="foot mono">{{ account.email }}</a-typography-text>
          </a-card>
        </a-col>
        <a-col :xs="12" :sm="8">
          <a-card size="small" class="fill">
            <a-statistic :title="t('cust.side.balance')" :value="Number(account.balance || 0)" :value-style="{ fontFamily: 'var(--pb-mono)' }">
              <template #prefix><WalletOutlined class="kpi-ico" /></template>
            </a-statistic>
            <a-typography-text type="secondary" class="foot">VND</a-typography-text>
          </a-card>
        </a-col>
        <a-col :xs="12" :sm="8">
          <a-card size="small" class="fill">
            <a-statistic
              :title="t('cust.account.kpi2fa')"
              :value="totpOn ? t('cust.detail.on') : t('cust.detail.off')"
              :value-style="{ color: totpOn ? 'var(--pb-success)' : 'var(--pb-warning)' }"
            >
              <template #prefix>
                <SafetyCertificateOutlined v-if="totpOn" />
                <WarningOutlined v-else />
              </template>
            </a-statistic>
            <a-typography-text :type="totpOn ? 'secondary' : 'warning'" class="foot">{{ totpOn ? t('cust.account.kpi2faOn') : t('cust.account.kpi2faOff') }}</a-typography-text>
          </a-card>
        </a-col>
      </a-row>

      <!-- 2 columns -->
      <a-row :gutter="[16, 16]">
        <!-- Profile -->
        <a-col :xs="24" :lg="12">
          <a-card class="fill">
            <template #title><UserOutlined class="title-ico" /> {{ t('cust.account.profile') }}</template>
            <a-descriptions :column="1" size="small" bordered>
              <a-descriptions-item :label="t('field.fullName')">{{ account.name || '—' }}</a-descriptions-item>
              <a-descriptions-item label="Email"><span class="mono">{{ account.email }}</span></a-descriptions-item>
              <a-descriptions-item :label="t('cust.account.refCode')">
                <a-space :size="6">
                  <span class="mono">{{ account.referralCode }}</span>
                  <a-button v-if="account.referralCode" size="small" type="text" @click="copy(account.referralCode, t('cust.account.refCopied'))">
                    <template #icon><CopyOutlined /></template>
                  </a-button>
                </a-space>
              </a-descriptions-item>
              <a-descriptions-item :label="t('cust.account.joinedAt')">{{ account.tosAcceptedAt || '—' }}</a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-col>

        <!-- 2FA -->
        <a-col :xs="24" :lg="12">
          <a-card id="security" class="fill anchor">
            <template #title><SafetyCertificateOutlined class="title-ico" /> {{ t('cust.account.security') }}</template>
            <template v-if="totpOn">
              <a-alert type="success" show-icon :message="t('cust.account.totpActive')" :description="t('cust.account.totpActiveDesc')" class="block-gap" />
              <a-button danger @click="disableTotp">
                <template #icon><StopOutlined /></template>
                {{ t('cust.account.disable2fa') }}
              </a-button>
            </template>
            <template v-else-if="!totp.secret">
              <a-alert type="warning" show-icon :message="t('cust.account.totpOff')" :description="t('cust.account.totpOffDesc')" class="block-gap" />
              <a-button type="primary" :loading="busy === 'enroll'" @click="enrollTotp">
                <template #icon><SafetyCertificateOutlined /></template>
                {{ t('cust.account.enable2fa') }}
              </a-button>
            </template>
            <a-form v-else :model="totp" layout="vertical" @finish="confirmTotp">
              <a-flex gap="middle" wrap="wrap" align="flex-start">
                <!-- Scannable form of the otpauth URI (dark-on-white so every authenticator app reads it). -->
                <a-qrcode :value="totp.otpauthUri" :size="148" color="#000000" bg-color="#ffffff" class="qr" />
                <a-flex vertical class="totp-fields">
                  <a-form-item :label="t('cust.account.totpSecret')">
                    <a-typography-text code copyable class="mono">{{ totp.secret }}</a-typography-text>
                  </a-form-item>
                  <a-form-item label="otpauth URI">
                    <a-typography-paragraph :copyable="{ text: totp.otpauthUri }" class="mono uri">{{ totp.otpauthUri }}</a-typography-paragraph>
                  </a-form-item>
                </a-flex>
              </a-flex>
              <a-form-item :label="t('cust.account.totpEnter')" name="code">
                <a-input v-model:value="totp.code" :maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" class="mono code-input" />
              </a-form-item>
              <a-button type="primary" html-type="submit" :loading="busy === 'totp'">{{ t('cust.account.totpConfirm') }}</a-button>
            </a-form>
          </a-card>
        </a-col>

        <!-- Change password -->
        <a-col :xs="24" :lg="12">
          <a-card class="fill">
            <template #title><LockOutlined class="title-ico" /> {{ t('cust.account.pwd') }}</template>
            <a-typography-paragraph type="secondary" class="hint">{{ t('cust.account.pwdHint') }}</a-typography-paragraph>
            <a-form :model="pwd" layout="vertical" @finish="changePwd">
              <a-row :gutter="12">
                <a-col :xs="24" :sm="12">
                  <a-form-item :label="t('cust.account.pwdCurrent')" name="old">
                    <a-input-password v-model:value="pwd.old" autocomplete="current-password" />
                  </a-form-item>
                </a-col>
                <a-col :xs="24" :sm="12">
                  <a-form-item :label="t('cust.account.pwdNew')" name="neu">
                    <a-input-password v-model:value="pwd.neu" autocomplete="new-password" />
                  </a-form-item>
                </a-col>
              </a-row>
              <a-button type="primary" html-type="submit" :loading="busy === 'pwd'">
                <template #icon><LockOutlined /></template>
                {{ t('cust.account.pwdChange') }}
              </a-button>
            </a-form>
          </a-card>
        </a-col>

        <!-- API key + Webhook -->
        <a-col :xs="24" :lg="12">
          <a-card id="api" class="fill anchor">
            <template #title><KeyOutlined class="title-ico" /> {{ t('cust.account.apiTitle') }}</template>
            <a-typography-paragraph type="secondary" class="hint">
              {{ t('cust.account.apiHint') }} <a-typography-text code>X-Customer-Key</a-typography-text>
            </a-typography-paragraph>
            <a-flex gap="small">
              <a-input :value="account.apiKey" readonly class="mono" />
              <a-button @click="copy(account.apiKey, t('cust.account.keyCopied'))">
                <template #icon><CopyOutlined /></template>
              </a-button>
            </a-flex>
            <a-button class="rotate-btn" @click="regenKey">
              <template #icon><ReloadOutlined /></template>
              {{ t('cust.account.rotateKey') }}
            </a-button>

            <a-divider orientation="left" orientation-margin="0" class="wh-divider">
              <ApiOutlined class="title-ico" /> {{ t('cust.account.webhook') }}
            </a-divider>
            <a-typography-paragraph type="secondary" class="hint">{{ t('cust.account.webhookHint') }}</a-typography-paragraph>
            <a-form :model="wh" layout="vertical" @finish="saveWebhook">
              <a-form-item label="URL" name="url">
                <a-input v-model:value="wh.url" placeholder="https://your-server/hook" class="mono" />
              </a-form-item>
              <a-form-item :label="t('cust.account.webhookEvents')" name="events">
                <a-checkbox-group v-model:value="wh.events">
                  <a-flex wrap="wrap" gap="small">
                    <a-checkbox v-for="ev in WH_EVENTS" :key="ev" :value="ev"><span class="mono small">{{ ev }}</span></a-checkbox>
                  </a-flex>
                </a-checkbox-group>
              </a-form-item>
              <a-space wrap>
                <a-button type="primary" html-type="submit" :loading="busy === 'webhook'">{{ t('cust.account.saveWebhook') }}</a-button>
                <a-button :disabled="!wh.url" :loading="busy === 'whtest'" @click="testWebhook">{{ t('cust.account.testWebhook') }}</a-button>
              </a-space>
            </a-form>
          </a-card>
        </a-col>
      </a-row>

      <!-- GDPR -->
      <a-card size="small">
        <a-flex align="center" gap="middle" wrap="wrap">
          <a-avatar shape="square" :size="44" class="gdpr-ico">
            <template #icon><DownloadOutlined /></template>
          </a-avatar>
          <a-flex vertical class="grow">
            <a-typography-text strong>{{ t('cust.account.gdprTitle') }}</a-typography-text>
            <a-typography-text type="secondary" class="small">{{ t('cust.account.gdprDesc') }}</a-typography-text>
          </a-flex>
          <a-button @click="gdpr">
            <template #icon><DownloadOutlined /></template>
            {{ t('cust.account.gdprBtn') }}
          </a-button>
        </a-flex>
      </a-card>

      <!-- Read-only proxy sharing -->
      <a-card>
        <template #title><TeamOutlined class="title-ico" /> {{ t('cust.account.shareTitle') }}</template>
        <a-typography-paragraph type="secondary" class="hint">{{ t('cust.account.shareDesc') }}</a-typography-paragraph>
        <a-space-compact class="invite">
          <a-input v-model:value="inviteEmail" type="email" :placeholder="t('cust.account.sharePlaceholder')" @press-enter="addMember" />
          <a-button type="primary" :loading="busy === 'member'" @click="addMember">
            <template #icon><UserAddOutlined /></template>
            {{ t('cust.account.shareBtn') }}
          </a-button>
        </a-space-compact>
        <a-list v-if="members.length" size="small" bordered :data-source="members" class="members">
          <template #renderItem="{ item: m }">
            <a-list-item>
              <span class="mono">{{ m.email }}</span>
              <template #actions>
                <a-button size="small" danger @click="removeMember(m.id)">{{ t('cust.account.shareRemove') }}</a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-card>
    </template>
  </div>
</template>

<style scoped>
.fill { height: 100%; }
.anchor { scroll-margin-top: 80px; }
.kpi-ico { color: var(--pb-primary); margin-inline-end: 4px; }
.foot { font-size: 12px; }
.title-ico { color: var(--pb-primary); }
.hint { font-size: 12.5px; margin-bottom: 12px !important; }
.small { font-size: 12px; }
.grow { flex: 1 1 220px; min-width: 0; }
.block-gap { margin-bottom: 12px; }
.qr { flex: none; padding: 6px; }
.totp-fields { flex: 1 1 220px; min-width: 0; }
.totp-fields :deep(.ant-form-item) { margin-bottom: 12px; }
.uri { font-size: 11px; margin: 0 !important; }
.code-input { max-width: 200px; letter-spacing: 0.15em; }
.rotate-btn { margin-top: 10px; }
.wh-divider { margin: 18px 0 8px; font-size: 13px; }
.gdpr-ico { color: var(--pb-warning); background: rgba(245, 158, 11, 0.14); flex: none; }
.invite { width: 100%; max-width: 480px; }
.members { margin-top: 12px; max-width: 640px; }
</style>
