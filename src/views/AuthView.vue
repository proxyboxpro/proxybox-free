<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GithubOutlined, GoogleOutlined, LoginOutlined } from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import { ApiError, apiFetch, login, register, setToken } from '../api'
import BrandLogo from '../components/ui/BrandLogo.vue'
import ThemeLangSwitch from '../components/ui/ThemeLangSwitch.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const year = new Date().getFullYear()

const formRef = ref()
const submitting = ref(false)
const errorText = ref('')
const oauthProviders = ref([])

const form = reactive({
  email: '',
  password: '',
  name: '',
  agree: false,
  agreeAge: false,
  totpCode: ''
})
const totpRequired = ref(false)

const authMode = computed(() => (route.meta.mode === 'register' ? 'register' : 'login'))
const modeOptions = [{ value: 'login' }, { value: 'register' }]
// "— or —" → "or": the divider already draws the lines.
const orText = computed(() => t('auth.or').replace(/[—–-]/g, '').trim())
const oauthIcons = { google: GoogleOutlined, github: GithubOutlined }

// Register-only checkboxes must be ticked (same messages as before).
function mustCheck(key) {
  return (_rule, value) => (value ? Promise.resolve() : Promise.reject(t(key)))
}

function goMode(mode) {
  errorText.value = ''
  formRef.value?.clearValidate()
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
      if (!form.agree) throw new Error(t('auth.agreeRequired'))
      if (!form.agreeAge) throw new Error(t('auth.ageRequired'))
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
  <a-layout class="auth-shell">
    <a-flex class="auth-top" justify="space-between" align="center" gap="small">
      <RouterLink to="/" class="auth-brand"><BrandLogo :size="30" /></RouterLink>
      <ThemeLangSwitch />
    </a-flex>

    <a-layout-content class="auth-main">
      <a-card class="auth-card" :body-style="{ padding: 0 }">
        <a-row>
          <a-col :xs="0" :lg="11" class="auth-hero">
            <a-flex vertical justify="space-between" gap="large" class="auth-hero-inner">
              <div>
                <a-tag color="success" :bordered="false">{{ t('auth.platform') }}</a-tag>
                <a-typography-title :level="1" class="hero-title">{{ t('auth.heroTitle') }}</a-typography-title>
                <a-typography-paragraph type="secondary" class="hero-desc">{{ t('auth.heroDescription') }}</a-typography-paragraph>
              </div>
              <a-flex class="hero-icons" gap="middle" aria-hidden="true">
                <span><CloudServerOutlined /></span>
                <span><GlobalOutlined /></span>
                <span><ApiOutlined /></span>
                <span><SafetyCertificateOutlined /></span>
              </a-flex>
              <a-typography-text type="secondary" class="hero-foot">
                {{ t('landing.foot.copyright', { year, ver: appVersion }) }}
              </a-typography-text>
            </a-flex>
          </a-col>

          <a-col :xs="24" :lg="13">
            <div class="auth-form-wrap">
              <a-segmented :value="authMode" :options="modeOptions" block size="large" @change="goMode">
                <template #label="{ value: mode }">
                  <span class="seg-label">
                    <LoginOutlined v-if="mode === 'login'" />
                    <UserAddOutlined v-else />
                    {{ mode === 'login' ? t('auth.login') : t('auth.register') }}
                  </span>
                </template>
              </a-segmented>

              <div class="form-heading">
                <a-typography-text type="secondary">{{ authMode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount') }}</a-typography-text>
                <a-typography-title :level="3" class="form-title">
                  {{ authMode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle') }}
                </a-typography-title>
              </div>

              <a-form ref="formRef" :model="form" layout="vertical" :required-mark="false" @finish="submit">
                <a-form-item v-if="authMode === 'register'" :label="t('field.fullName')" name="name">
                  <a-input v-model:value="form.name" size="large" :placeholder="t('placeholder.name')" autocomplete="name">
                    <template #prefix><UserOutlined /></template>
                  </a-input>
                </a-form-item>

                <a-form-item label="Email" name="email" :rules="[{ required: true, type: 'email' }]">
                  <a-input v-model:value="form.email" size="large" type="email" placeholder="admin@domain.com" autocomplete="email">
                    <template #prefix><MailOutlined /></template>
                  </a-input>
                </a-form-item>

                <a-form-item :label="t('field.password')" name="password" :rules="[{ required: true }]">
                  <a-input-password
                    v-model:value="form.password"
                    size="large"
                    :placeholder="t('placeholder.password')"
                    :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
                  >
                    <template #prefix><LockOutlined /></template>
                  </a-input-password>
                </a-form-item>

                <a-form-item
                  v-if="authMode === 'login' && totpRequired"
                  :label="t('auth.totpCode')"
                  name="totpCode"
                  :rules="[{ required: true }]"
                >
                  <a-input
                    v-model:value="form.totpCode"
                    size="large"
                    class="mono"
                    inputmode="numeric"
                    :maxlength="6"
                    autocomplete="one-time-code"
                    placeholder="123456"
                    autofocus
                  >
                    <template #prefix><SafetyOutlined /></template>
                  </a-input>
                </a-form-item>

                <template v-if="authMode === 'register'">
                  <a-form-item name="agree" :rules="[{ validator: mustCheck('auth.agreeRequired') }]" class="check-item">
                    <a-checkbox v-model:checked="form.agree">
                      {{ t('auth.agreePrefix') }}
                      <a href="/acceptable-use" target="_blank" rel="noopener" @click.stop>{{ t('auth.agreeLink') }}</a>.
                    </a-checkbox>
                  </a-form-item>
                  <a-form-item name="agreeAge" :rules="[{ validator: mustCheck('auth.ageRequired') }]" class="check-item">
                    <a-checkbox v-model:checked="form.agreeAge">{{ t('auth.agreeAge') }}</a-checkbox>
                  </a-form-item>
                </template>

                <a-alert v-if="errorText" type="error" show-icon :message="errorText" class="form-alert" />

                <a-button type="primary" html-type="submit" size="large" block :loading="submitting">
                  <template #icon><SafetyCertificateOutlined /></template>
                  {{ submitting ? t('auth.processing') : (authMode === 'login' ? t('auth.loginButton') : t('auth.registerButton')) }}
                </a-button>
              </a-form>

              <template v-if="oauthProviders.length">
                <a-divider plain class="or-divider">{{ orText }}</a-divider>
                <a-flex vertical gap="small">
                  <a-button v-for="p in oauthProviders" :key="p.id" size="large" block @click="startOauth(p.id)">
                    <template #icon><component :is="oauthIcons[p.id] || LoginOutlined" /></template>
                    {{ t('auth.oauthWith', { provider: p.label }) }}
                  </a-button>
                </a-flex>
              </template>

              <a-flex vertical align="center" gap="small" class="form-links">
                <a-button type="link" @click="goMode(authMode === 'login' ? 'register' : 'login')">
                  {{ authMode === 'login' ? t('auth.toRegister') : t('auth.toLogin') }}
                </a-button>
                <a-button v-if="authMode === 'login'" type="link" size="small" class="forgot-link" @click="gotoForgot">
                  {{ t('auth.recover.forgotLink') }}
                </a-button>
              </a-flex>
            </div>
          </a-col>
        </a-row>
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
  padding: 8px 16px 48px;
}
.auth-card { width: 100%; max-width: 980px; overflow: hidden; }

/* Hero panel (desktop only) */
.auth-hero {
  border-inline-end: 1px solid var(--pb-border-soft);
  background:
    radial-gradient(520px 320px at 0% 0%, var(--pb-primary-soft), transparent 70%),
    radial-gradient(420px 280px at 100% 100%, var(--pb-primary-soft), transparent 70%),
    var(--pb-surface-2);
}
.auth-hero-inner { height: 100%; min-height: 560px; padding: 40px; }
.hero-title { margin: 18px 0 12px !important; font-size: 30px !important; line-height: 1.25 !important; }
.hero-desc { font-size: 15px; line-height: 1.65; margin-bottom: 0; }
.hero-icons span {
  display: inline-grid; place-items: center;
  width: 48px; height: 48px; border-radius: 12px;
  font-size: 22px; color: var(--pb-primary);
  background: var(--pb-primary-soft);
  border: 1px solid var(--pb-border-soft);
}
.hero-foot { font-size: 12px; }

/* Form column */
.auth-form-wrap {
  display: flex; flex-direction: column; gap: 20px;
  padding: 40px; max-width: 480px; margin: 0 auto;
}
.seg-label { display: inline-flex; align-items: center; gap: 8px; }
.form-heading { display: flex; flex-direction: column; gap: 2px; }
.form-title { margin: 0 !important; }
.check-item { margin-bottom: 8px; }
.check-item :deep(.ant-checkbox-wrapper) { align-items: flex-start; }
.check-item :deep(.ant-checkbox) { margin-top: 3px; }
.form-alert { margin-bottom: 16px; }
.or-divider { margin: 0; }
.form-links { margin-top: -4px; }
.forgot-link { color: var(--pb-text-3); }

@media (max-width: 575px) {
  .auth-top { padding: 12px 16px; }
  .auth-main { padding: 4px 12px 32px; }
  .auth-form-wrap { padding: 24px 18px; gap: 16px; }
}
</style>
