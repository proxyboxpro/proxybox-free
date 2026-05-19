<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { resetPassword } from '../api'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const token = ref('')
const password = ref('')
const password2 = ref('')
const showPw = ref(false)
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
  if (!token.value) { errorText.value = t('auth.recover.tokenMissing'); return }
  if (password.value.length < 8) { errorText.value = t('auth.recover.tooShort'); return }
  if (password.value !== password2.value) { errorText.value = t('auth.recover.mismatch'); return }
  if (!/[A-Z]/.test(password.value) || !/[a-z]/.test(password.value) || !/\d/.test(password.value)) {
    errorText.value = t('auth.recover.weak'); return
  }
  submitting.value = true
  try {
    await resetPassword(token.value, password.value)
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
  <main class="auth-shell">
    <section class="auth-card auth-card-narrow">
      <form class="auth-form" @submit.prevent="submit">
        <div class="logo-block">
          <span class="logo-mark"><Box :size="22" /></span>
          <strong>ProxyBox</strong>
        </div>
        <div>
          <p class="eyebrow">{{ t('auth.recover.eyebrow') }}</p>
          <h2>{{ t('auth.recover.setNew') }}</h2>
        </div>

        <template v-if="!done">
          <label class="input-field">
            <span>{{ t('auth.recover.newPassword') }}</span>
            <div class="password-wrap">
              <input v-model="password" :type="showPw ? 'text' : 'password'" required minlength="8" />
              <button type="button" @click="showPw = !showPw">
                <Eye v-if="!showPw" :size="16" />
                <EyeOff v-else :size="16" />
              </button>
            </div>
          </label>
          <label class="input-field">
            <span>{{ t('auth.recover.confirm') }}</span>
            <input v-model="password2" :type="showPw ? 'text' : 'password'" required minlength="8" />
          </label>
          <p v-if="errorText" class="error-text">{{ errorText }}</p>
          <button class="primary-action" type="submit" :disabled="submitting">
            <ShieldCheck :size="16" /> {{ submitting ? t('auth.processing') : t('auth.recover.update') }}
          </button>
        </template>
        <template v-else>
          <div class="success-block">
            <ShieldCheck :size="32" style="color:var(--green)" />
            <h3>{{ t('auth.recover.updated') }}</h3>
            <p>{{ t('auth.recover.redirecting') }}</p>
          </div>
        </template>

        <button class="text-action" type="button" @click="router.push({ name: 'login' })">
          <ArrowLeft :size="14" /> {{ t('auth.recover.backToLogin') }}
        </button>
      </form>
    </section>
  </main>
</template>
