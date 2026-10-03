<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { verifyEmail } from '../api'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const state = ref('loading') // loading | ok | error
const message = ref('')

onMounted(async () => {
  const q = new URLSearchParams(location.search)
  const token = q.get('token') || String(route.query?.token || '')
  if (!token) { state.value = 'error'; message.value = t('auth.verify.missing'); return }
  try {
    const r = await verifyEmail(token)
    state.value = 'ok'
    message.value = r.email || ''
  } catch (e) {
    state.value = 'error'
    message.value = e.message
  }
})
</script>

<template>
  <a-layout class="auth-shell">
    <a-flex class="auth-top" justify="space-between" align="center" gap="small">
      <RouterLink to="/" class="auth-brand"><BrandLogo :size="30" /></RouterLink>
      <ThemeLangSwitch />
    </a-flex>

    <a-layout-content class="auth-main">
      <a-card class="auth-card">
        <a-result v-if="state === 'loading'" :title="t('auth.verify.loading')">
          <template #icon><a-spin size="large" /></template>
          <template #extra>
            <a-button @click="router.push({ name: 'login' })">
              <template #icon><ArrowLeftOutlined /></template>
              {{ t('auth.recover.backToLogin') }}
            </a-button>
          </template>
        </a-result>
        <a-result v-else-if="state === 'ok'" status="success" :title="t('auth.verify.ok')">
          <template v-if="message" #subTitle><span class="mono">{{ message }}</span></template>
          <template #extra>
            <a-button type="primary" @click="router.push({ name: 'login' })">
              <template #icon><ArrowLeftOutlined /></template>
              {{ t('auth.recover.backToLogin') }}
            </a-button>
          </template>
        </a-result>
        <a-result v-else status="error" :title="t('auth.verify.error')" :sub-title="message">
          <template #extra>
            <a-button type="primary" @click="router.push({ name: 'login' })">
              <template #icon><ArrowLeftOutlined /></template>
              {{ t('auth.recover.backToLogin') }}
            </a-button>
          </template>
        </a-result>
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
.auth-card { width: 100%; max-width: 480px; }

@media (max-width: 575px) {
  .auth-top { padding: 12px 16px; }
  .auth-main { padding: 4px 12px 32px; }
}
</style>
