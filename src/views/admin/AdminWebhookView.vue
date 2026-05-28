<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const url = ref('')
const err = ref(''); const flash = ref('')

async function refresh() {
  err.value = ''
  try { const r = await apiFetch('/api/admin/alerts/webhook'); url.value = r.url || '' }
  catch (e) { err.value = e.message }
}
async function save() {
  try {
    if (url.value.trim()) await apiFetch('/api/admin/alerts/webhook', { method: 'POST', body: { url: url.value } })
    else await apiFetch('/api/admin/alerts/webhook', { method: 'DELETE' })
    flash.value = t('admin.webhook.saved')
  } catch (e) { err.value = e.message }
}
async function clear() {
  if (!confirm(t('admin.webhook.confirmDel'))) return
  try { await apiFetch('/api/admin/alerts/webhook', { method: 'DELETE' }); url.value = ''; flash.value = t('admin.webhook.deleted') }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.webhook.eyebrow') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.webhook.sectionTitle') }}</h2></div>
      <p style="font-size:13px; color:var(--muted); margin:0 0 12px">{{ t('admin.webhook.help') }}</p>
      <div class="form-grid">
        <label class="input-field" style="grid-column:1/-1"><span>{{ t('admin.webhook.urlLabel') }}</span><input v-model="url" placeholder="https://hooks.slack.com/services/T00/B00/xxx" /></label>
      </div>
      <div class="action-row" style="margin-top:10px">
        <button class="primary-action" type="button" @click="save">{{ t('admin.common.save') }}</button>
        <button v-if="url" class="ghost-button" type="button" @click="clear">{{ t('admin.common.delete') }}</button>
      </div>
    </section>
  </section>
</template>
