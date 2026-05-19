<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, MailCheck, AlertTriangle, ArrowLeft } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { verifyEmail } from '../api'

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
  <main class="auth-shell">
    <section class="auth-card auth-card-narrow">
      <div class="auth-form">
        <div class="logo-block">
          <span class="logo-mark"><Box :size="22" /></span>
          <strong>ProxyBox</strong>
        </div>

        <div v-if="state === 'loading'" class="success-block">
          <p style="color:var(--muted)">{{ t('auth.verify.loading') }}</p>
        </div>
        <div v-else-if="state === 'ok'" class="success-block">
          <MailCheck :size="32" style="color:var(--green)" />
          <h3>{{ t('auth.verify.ok') }}</h3>
          <p v-if="message">{{ message }}</p>
        </div>
        <div v-else class="success-block">
          <AlertTriangle :size="32" style="color:var(--red)" />
          <h3>{{ t('auth.verify.error') }}</h3>
          <p>{{ message }}</p>
        </div>

        <button class="text-action" type="button" @click="router.push({ name: 'login' })">
          <ArrowLeft :size="14" /> {{ t('auth.recover.backToLogin') }}
        </button>
      </div>
    </section>
  </main>
</template>
