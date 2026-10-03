<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { resetPassword } from '../api'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const token = ref('')
const form = reactive({ password: '', password2: '' })
const submitting = ref(false)
const done = ref(false)
const errorText = ref('')

onMounted(() => {
  const q = new URLSearchParams(location.search)
  token.value = q.get('token') || String(route.query?.token || '')
})

async function submit() {
  if (submitting.value) return
  errorText.value = ''
  const { password, password2 } = form
  if (!token.value) { errorText.value = t('auth.recover.tokenMissing'); return }
  if (password.length < 8) { errorText.value = t('auth.recover.tooShort'); return }
  if (password !== password2) { errorText.value = t('auth.recover.mismatch'); return }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    errorText.value = t('auth.recover.weak'); return
  }
  submitting.value = true
  try {
    await resetPassword(token.value, password)
    done.value = true
    setTimeout(() => router.push({ name: 'login' }), 1500)
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
        <a-result v-if="done" status="success" :title="t('auth.recover.updated')" :sub-title="t('auth.recover.redirecting')">
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
            <a-typography-title :level="3" class="form-title">{{ t('auth.recover.setNew') }}</a-typography-title>
          </div>

          <a-form :model="form" layout="vertical" :required-mark="false" @finish="submit">
            <a-form-item
              :label="t('auth.recover.newPassword')"
              name="password"
              :rules="[{ required: true }, { min: 8, message: t('auth.recover.tooShort') }]"
            >
              <a-input-password v-model:value="form.password" size="large" autocomplete="new-password" autofocus>
                <template #prefix><LockOutlined /></template>
              </a-input-password>
            </a-form-item>
            <a-form-item
              :label="t('auth.recover.confirm')"
              name="password2"
              :rules="[{ required: true }, { min: 8, message: t('auth.recover.tooShort') }]"
            >
              <a-input-password v-model:value="form.password2" size="large" autocomplete="new-password">
                <template #prefix><LockOutlined /></template>
              </a-input-password>
            </a-form-item>
            <a-alert v-if="errorText" type="error" show-icon :message="errorText" class="form-alert" />
            <a-button type="primary" html-type="submit" size="large" block :loading="submitting">
              <template #icon><SafetyCertificateOutlined /></template>
              {{ submitting ? t('auth.processing') : t('auth.recover.update') }}
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
.form-alert { margin-bottom: 16px; }
.back-link { align-self: center; }

@media (max-width: 575px) {
  .auth-top { padding: 12px 16px; }
  .auth-main { padding: 4px 12px 32px; }
}
</style>
