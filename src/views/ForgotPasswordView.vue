<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Box, Mail, ShieldCheck, ArrowLeft } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { forgotPassword } from '../api'

const router = useRouter()
const { t } = useI18n()
const email = ref('')
const submitting = ref(false)
const done = ref(false)
const errorText = ref('')

async function submit() {
  if (submitting.value || !email.value) return
  submitting.value = true
  errorText.value = ''
  try {
    await forgotPassword(email.value.trim().toLowerCase())
    done.value = true
  } catch (e) {
    errorText.value = e.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card auth-card-narrow">
      <form class="auth-form" @submit.prevent="submit">
        <div class="logo-block">
          <span class="logo-mark"><Box :size="22" /></span>
          <strong>ProxyBox</strong>
        </div>
        <div>
          <p class="eyebrow">{{ t('auth.recover.eyebrow') }}</p>
          <h2>{{ t('auth.recover.title') }}</h2>
          <p style="color:var(--muted); font-size:13px; margin-top:6px">{{ t('auth.recover.help') }}</p>
        </div>

        <template v-if="!done">
          <label class="input-field">
            <span>Email</span>
            <input v-model="email" type="email" placeholder="you@domain.com" required autofocus />
          </label>
          <p v-if="errorText" class="error-text">{{ errorText }}</p>
          <button class="primary-action" type="submit" :disabled="submitting">
            <Mail :size="16" /> {{ submitting ? t('auth.processing') : t('auth.recover.send') }}
          </button>
        </template>
        <template v-else>
          <div class="success-block">
            <ShieldCheck :size="32" style="color:var(--green)" />
            <h3>{{ t('auth.recover.sent') }}</h3>
            <p>{{ t('auth.recover.sentHelp') }}</p>
          </div>
        </template>

        <button class="text-action" type="button" @click="router.push({ name: 'login' })">
          <ArrowLeft :size="14" /> {{ t('auth.recover.backToLogin') }}
        </button>
      </form>
    </section>
  </main>
</template>
