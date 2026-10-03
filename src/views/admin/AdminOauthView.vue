<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const oauth = ref(null)
const err = ref('')
const loading = ref(false)
const saving = ref(false)

const PROVIDERS = [
  { id: 'google', label: 'Google', clientIdPh: 'xxx.apps.googleusercontent.com', callbackPh: 'https://your-domain/api/auth/oauth/google/callback' },
  { id: 'github', label: 'GitHub', clientIdPh: 'Iv1.xxx', callbackPh: 'https://your-domain/api/auth/oauth/github/callback' }
]

async function refresh() {
  err.value = ''
  loading.value = true
  try { oauth.value = await apiFetch('/api/admin/oauth') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try { await apiFetch('/api/admin/oauth', { method: 'PATCH', body: oauth.value }); message.success(t('admin.oauth.saved')); await refresh() }
  catch (e) { message.error(e.message) }
  finally { saving.value = false }
}
onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.oauth.eyebrow') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card v-if="oauth" :title="t('admin.oauth.providersTitle')">
      <!-- The help strings are trusted i18n HTML whose links use var(--blue);
           .oauth-help maps that variable onto the theme's link colour. -->
      <div class="oauth-help">
        <!-- eslint-disable vue/no-v-html -->
        <a-typography-paragraph type="secondary">
          <span v-html="t('admin.oauth.googleHelp')"></span><br>
          <span v-html="t('admin.oauth.githubHelp')"></span>
        </a-typography-paragraph>
        <a-alert type="warning" show-icon class="flag-hint">
          <template #message><span v-html="t('admin.oauth.flagHint')"></span></template>
        </a-alert>
        <!-- eslint-enable vue/no-v-html -->
      </div>

      <a-form :model="oauth" layout="vertical" @finish="save">
        <a-row :gutter="[16, 16]">
          <a-col v-for="p in PROVIDERS" :key="p.id" :xs="24" :lg="12">
            <a-card size="small" type="inner" :title="p.label">
              <a-form-item :label="t('admin.oauth.clientId')" :name="[p.id, 'clientId']">
                <a-input v-model:value="oauth[p.id].clientId" :placeholder="p.clientIdPh" />
              </a-form-item>
              <a-form-item :label="t('admin.oauth.clientSecret')" :name="[p.id, 'clientSecret']">
                <a-input-password v-model:value="oauth[p.id].clientSecret" autocomplete="new-password" />
              </a-form-item>
              <a-form-item :label="t('admin.oauth.callbackUrl')" :name="[p.id, 'callbackUrl']" class="last-item">
                <a-input v-model:value="oauth[p.id].callbackUrl" :placeholder="p.callbackPh" />
              </a-form-item>
            </a-card>
          </a-col>
        </a-row>

        <a-button type="primary" html-type="submit" :loading="saving" class="save-btn">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.oauth.save') }}
        </a-button>
      </a-form>
    </a-card>
    <a-card v-else-if="loading" loading />
  </div>
</template>

<style scoped>
.oauth-help { --blue: var(--pb-info); }
.flag-hint { margin-bottom: 16px; }
.last-item { margin-bottom: 0; }
.save-btn { margin-top: 16px; }
</style>
