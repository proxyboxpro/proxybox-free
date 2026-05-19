<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Eye, EyeOff, LogIn, ShieldCheck, UserPlus } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { ApiError, apiFetch, login, register, setToken } from '../api'

const route = useRoute()
const router = useRouter()
const { t, locale, setLocale } = useI18n()

const showPassword = ref(false)
const submitting = ref(false)
const errorText = ref('')
const oauthProviders = ref([])

const form = reactive({
  email: '',
  password: '',
  name: '',
  agree: false,
  totpCode: ''
})
const totpRequired = ref(false)

const authMode = computed(() => (route.meta.mode === 'register' ? 'register' : 'login'))

function switchLanguage(nextLocale) {
  setLocale(nextLocale)
}

function goMode(mode) {
  errorText.value = ''
  router.push({ name: mode })
}

function startOauth(provider) {
  // Server-side redirect handles the rest.
  window.location.href = `/api/auth/oauth/${provider}/start`
}

// OAuth callback lands on /login?oauth_token=...&dest=... Save token + redirect.
onMounted(async () => {
  const q = new URLSearchParams(location.search)
  const oauthToken = q.get('oauth_token')
  const dest = q.get('dest')
  if (oauthToken) {
    setToken(oauthToken)
    router.replace({ name: dest || 'dashboard' })
    return
  }
  // Else: load list of configured providers so we know which buttons to render.
  try { const r = await apiFetch('/api/auth/oauth/providers'); oauthProviders.value = r.providers || [] }
  catch { /* feature disabled / not configured */ }
})

async function submit() {
  if (submitting.value) return
  errorText.value = ''
  submitting.value = true
  try {
    let user
    if (authMode.value === 'register') {
      if (!form.agree) throw new Error(t('auth.agree'))
      user = await register(form.name, form.email, form.password, true)
    } else {
      user = await login(form.email, form.password, form.totpCode || undefined)
    }
    // Force-reset detour: admin flagged this user — go to reset flow.
    if (user?.forcePasswordChange) {
      errorText.value = t('auth.recover.forcedHelp')
      return
    }
    // Customers land in their own portal; admins on the admin dashboard.
    const dest = (user?.role === 'customer') ? 'dashboard' : 'admin-dashboard'
    router.push({ name: dest })
  } catch (error) {
    if (error instanceof ApiError && error.data?.totpRequired) {
      totpRequired.value = true
      errorText.value = form.totpCode ? t('auth.totpInvalid') : t('auth.totpRequired')
      form.totpCode = ''
    } else if (error instanceof ApiError && error.data?.enroll2FA) {
      errorText.value = error.message
    } else {
      errorText.value = error.message
    }
  } finally {
    submitting.value = false
  }
}
function gotoForgot() { router.push({ name: 'forgot-password' }) }
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-visual">
        <div class="logo-block">
          <span class="logo-mark"><Box :size="26" /></span>
          <strong>ProxyBox</strong>
        </div>
        <div class="auth-copy">
          <p class="eyebrow">{{ t('auth.platform') }}</p>
          <h1>{{ t('auth.heroTitle') }}</h1>
          <p>{{ t('auth.heroDescription') }}</p>
        </div>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <div class="language-switch">
          <button :class="{ active: locale === 'vi' }" type="button" @click="switchLanguage('vi')">VI</button>
          <button :class="{ active: locale === 'en' }" type="button" @click="switchLanguage('en')">EN</button>
        </div>

        <div class="auth-tabs">
          <button :class="{ active: authMode === 'login' }" type="button" @click="goMode('login')">
            <LogIn :size="16" /> {{ t('auth.login') }}
          </button>
          <button :class="{ active: authMode === 'register' }" type="button" @click="goMode('register')">
            <UserPlus :size="16" /> {{ t('auth.register') }}
          </button>
        </div>

        <div>
          <p class="eyebrow">{{ authMode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount') }}</p>
          <h2>{{ authMode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle') }}</h2>
        </div>

        <label v-if="authMode === 'register'" class="input-field">
          <span>{{ t('field.fullName') }}</span>
          <input v-model="form.name" type="text" :placeholder="t('placeholder.name')" />
        </label>
        <label class="input-field">
          <span>Email</span>
          <input v-model="form.email" type="email" placeholder="admin@domain.com" required />
        </label>
        <label class="input-field">
          <span>{{ t('field.password') }}</span>
          <div class="password-wrap">
            <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="t('placeholder.password')" required />
            <button type="button" @click="showPassword = !showPassword">
              <Eye v-if="!showPassword" :size="17" />
              <EyeOff v-else :size="17" />
            </button>
          </div>
        </label>

        <label v-if="authMode === 'login' && totpRequired" class="input-field">
          <span>{{ t('auth.totpCode') }}</span>
          <input v-model="form.totpCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" required autofocus />
        </label>

        <label v-if="authMode === 'register'" class="check-line">
          <input v-model="form.agree" type="checkbox" />
          {{ t('auth.agree') }}
        </label>

        <p v-if="errorText" class="error-text">{{ errorText }}</p>

        <button class="primary-action" type="submit" :disabled="submitting">
          <ShieldCheck :size="18" />
          {{ submitting ? t('auth.processing') : (authMode === 'login' ? t('auth.loginButton') : t('auth.registerButton')) }}
        </button>

        <div v-if="oauthProviders.length" style="display:flex; flex-direction:column; gap:6px; margin-top:8px">
          <div style="text-align:center; color:var(--muted); font-size:12px; margin:6px 0">{{ t('auth.or') }}</div>
          <button v-for="p in oauthProviders" :key="p.id" class="ghost-button" type="button" style="justify-content:center" @click="startOauth(p.id)">
            {{ t('auth.oauthWith', { provider: p.label }) }}
          </button>
        </div>

        <button class="text-action" type="button" @click="goMode(authMode === 'login' ? 'register' : 'login')">
          {{ authMode === 'login' ? t('auth.toRegister') : t('auth.toLogin') }}
        </button>
        <button v-if="authMode === 'login'" class="text-action" type="button" style="font-size:12px; color:var(--muted)" @click="gotoForgot">
          {{ t('auth.recover.forgotLink') }}
        </button>
      </form>
    </section>
  </main>
</template>
