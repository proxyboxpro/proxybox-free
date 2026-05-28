<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const oauth = ref(null)
const err = ref(''); const flash = ref('')

async function refresh() {
  err.value = ''
  try { oauth.value = await apiFetch('/api/admin/oauth') }
  catch (e) { err.value = e.message }
}
async function save() {
  try { await apiFetch('/api/admin/oauth', { method: 'PATCH', body: oauth.value }); flash.value = t('admin.oauth.saved'); await refresh() }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.oauth.eyebrow') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section v-if="oauth" class="surface">
      <div class="section-head"><h2>{{ t('admin.oauth.providersTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted); margin-bottom:10px">
        <span v-html="t('admin.oauth.googleHelp')"></span><br>
        <span v-html="t('admin.oauth.githubHelp')"></span>
      </p>
      <p style="font-size:12px; color:var(--yellow); margin-bottom:14px" v-html="t('admin.oauth.flagHint')"></p>

      <h3 style="font-size:13px; color:var(--text); margin:14px 0 8px; text-transform:uppercase; letter-spacing:0.06em">Google</h3>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.oauth.clientId') }}</span><input v-model="oauth.google.clientId" placeholder="xxx.apps.googleusercontent.com" /></label>
        <label class="input-field"><span>{{ t('admin.oauth.clientSecret') }}</span><input v-model="oauth.google.clientSecret" type="password" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.oauth.callbackUrl') }}</span><input v-model="oauth.google.callbackUrl" placeholder="https://your-domain/api/auth/oauth/google/callback" /></label>
      </div>

      <h3 style="font-size:13px; color:var(--text); margin:18px 0 8px; text-transform:uppercase; letter-spacing:0.06em">GitHub</h3>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.oauth.clientId') }}</span><input v-model="oauth.github.clientId" placeholder="Iv1.xxx" /></label>
        <label class="input-field"><span>{{ t('admin.oauth.clientSecret') }}</span><input v-model="oauth.github.clientSecret" type="password" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.oauth.callbackUrl') }}</span><input v-model="oauth.github.callbackUrl" placeholder="https://your-domain/api/auth/oauth/github/callback" /></label>
      </div>

      <div class="action-row" style="margin-top:14px">
        <button class="primary-action" type="button" @click="save">{{ t('admin.oauth.save') }}</button>
      </div>
    </section>
  </section>
</template>
