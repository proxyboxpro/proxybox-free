<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { forgotPassword } from '../api'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const router = useRouter()
const { t } = useI18n()
const form = reactive({ email: '' })
const submitting = ref(false)
const done = ref(false)
const errorText = ref('')

async function submit() {
  if (submitting.value || !form.email) return
  submitting.value = true
  errorText.value = ''
  try {
    await forgotPassword(form.email.trim().toLowerCase())
    done.value = true
  } catch (e) {
    errorText.value = e.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <a-layout class="auth-shell">
    <a-flex class="auth-top" justify="space-between" align="center" gap="small">
      <RouterLink to="/" class="auth-brand"><BrandLogo :size="30" /></RouterLink>
      <ThemeLangSwitch />
    </a-flex>

    <a-layout-content class="auth-main">
      <a-card class="auth-card">
        <a-result v-if="done" status="success" :title="t('auth.recover.sent')" :sub-title="t('auth.recover.sentHelp')">
          <template #extra>
            <a-button type="primary" @click="router.push({ name: 'login' })">
              <template #icon><ArrowLeftOutlined /></template>
              {{ t('auth.recover.backToLogin') }}
            </a-button>
          </template>
        </a-result>

        <a-flex v-else vertical gap="large">
          <div class="form-heading">
            <a-typography-text type="secondary">{{ t('auth.recover.eyebrow') }}</a-typography-text>
            <a-typography-title :level="3" class="form-title">{{ t('auth.recover.title') }}</a-typography-title>
            <a-typography-paragraph type="secondary" class="form-help">{{ t('auth.recover.help') }}</a-typography-paragraph>
          </div>

          <a-form :model="form" layout="vertical" :required-mark="false" @finish="submit">
            <a-form-item label="Email" name="email" :rules="[{ required: true, type: 'email' }]">
              <a-input v-model:value="form.email" size="large" type="email" placeholder="you@domain.com" autocomplete="email" autofocus>
                <template #prefix><MailOutlined /></template>
              </a-input>
            </a-form-item>
            <a-alert v-if="errorText" type="error" show-icon :message="errorText" class="form-alert" />
            <a-button type="primary" html-type="submit" size="large" block :loading="submitting">
              <template #icon><SendOutlined /></template>
              {{ submitting ? t('auth.processing') : t('auth.recover.send') }}
            </a-button>
          </a-form>

          <a-button type="link" class="back-link" @click="router.push({ name: 'login' })">
            <template #icon><ArrowLeftOutlined /></template>
            {{ t('auth.recover.backToLogin') }}
          </a-button>
        </a-flex>
      </a-card>
    </a-layout-content>
  </a-layout>
</template>

<style scoped>
.auth-shell { min-height: 100vh; }
.auth-top { padding: 16px 24px; }
.auth-brand { display: inline-flex; }
.auth-main {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 16px 64px;
}
.auth-card { width: 100%; max-width: 440px; }
.form-heading { display: flex; flex-direction: column; gap: 2px; }
.form-title { margin: 0 !important; }
.form-help { margin: 6px 0 0 !important; }
.form-alert { margin-bottom: 16px; }
.back-link { align-self: center; }

@media (max-width: 575px) {
  .auth-top { padding: 12px 16px; }
  .auth-main { padding: 4px 12px 32px; }
}
</style>
