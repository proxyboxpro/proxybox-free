<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const cfg = ref({ host: '', port: 587, user: '', pass: '', from: '', secure: false, starttls: true })
const testTo = ref('')
const busy = ref(false)
const loading = ref(false)
const testing = ref(false)
const err = ref('')
const testResult = ref(null)

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    const r = await apiFetch('/api/admin/smtp')
    if (r) Object.assign(cfg.value, r)
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function save() {
  if (busy.value) return
  busy.value = true
  try {
    await apiFetch('/api/admin/smtp', { method: 'PATCH', body: cfg.value })
    message.success(t('admin.smtp.saved'))
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}

async function sendTest() {
  if (!testTo.value || testing.value) return
  testing.value = true; testResult.value = null
  try {
    const r = await apiFetch('/api/admin/smtp/test', { method: 'POST', body: { to: testTo.value } })
    testResult.value = { ok: r.ok !== false, message: r.message || r.error || t('admin.smtp.testSentOk') }
  } catch (e) { testResult.value = { ok: false, message: e.message } }
  finally { testing.value = false }
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary"><MailOutlined /> {{ t('admin.smtp.title') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card>
      <template #title><SettingOutlined /> {{ t('admin.smtp.serverConfig') }}</template>
      <a-typography-paragraph type="secondary">{{ t('admin.smtp.serverDesc') }}</a-typography-paragraph>

      <a-form :model="cfg" layout="vertical" @finish="save">
        <a-row :gutter="16">
          <a-col :xs="24" :md="16">
            <a-form-item :label="t('admin.smtp.host')" name="host">
              <a-input v-model:value="cfg.host" placeholder="smtp.gmail.com" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.smtp.port')" name="port">
              <a-input-number v-model:value="cfg.port" :min="1" :max="65535" placeholder="587" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('admin.smtp.user')" name="user">
              <a-input v-model:value="cfg.user" autocomplete="off" placeholder="noreply@proxyhub.vn" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('admin.smtp.pass')" name="pass">
              <a-input-password v-model:value="cfg.pass" autocomplete="new-password" placeholder="••••••••" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('admin.smtp.from')" name="from">
              <a-input v-model:value="cfg.from" placeholder="ProxyBox <noreply@proxyhub.vn>" />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item>
          <a-flex vertical gap="small">
            <a-checkbox v-model:checked="cfg.secure">
              <a-typography-text strong>SMTPS (port 465)</a-typography-text>
              <a-typography-text type="secondary"> &mdash; {{ t('admin.smtp.secureDesc') }}</a-typography-text>
            </a-checkbox>
            <a-checkbox v-model:checked="cfg.starttls">
              <a-typography-text strong>STARTTLS</a-typography-text>
              <a-typography-text type="secondary"> &mdash; {{ t('admin.smtp.starttlsDesc') }}</a-typography-text>
            </a-checkbox>
          </a-flex>
        </a-form-item>

        <a-button type="primary" html-type="submit" :loading="busy">
          <template #icon><CheckCircleOutlined /></template>
          {{ t('admin.smtp.save') }}
        </a-button>
      </a-form>
    </a-card>

    <a-card>
      <template #title><SendOutlined /> {{ t('admin.smtp.testTitle') }}</template>
      <a-typography-paragraph type="secondary">{{ t('admin.smtp.testDesc') }}</a-typography-paragraph>
      <a-form layout="vertical" class="test-form" @finish="sendTest">
        <a-form-item :label="t('admin.smtp.testTo')">
          <a-space-compact block>
            <a-input v-model:value="testTo" type="email" placeholder="you@example.com" />
            <a-button html-type="submit" :loading="testing" :disabled="!testTo">
              <template #icon><SendOutlined /></template>
              {{ t('admin.smtp.sendTest') }}
            </a-button>
          </a-space-compact>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="testResult"
        :type="testResult.ok ? 'success' : 'error'"
        show-icon
        :message="testResult.message"
        class="mono"
      />
    </a-card>
  </div>
</template>

<style scoped>
.test-form { max-width: 560px; }
</style>
