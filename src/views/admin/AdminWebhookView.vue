<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { confirmAsync, message } from '../../ui/feedback'

const { t } = useI18n()
const url = ref('')
const err = ref('')
const loading = ref(false)
const saving = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try { const r = await apiFetch('/api/admin/alerts/webhook'); url.value = r.url || '' }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try {
    if (url.value.trim()) await apiFetch('/api/admin/alerts/webhook', { method: 'POST', body: { url: url.value } })
    else await apiFetch('/api/admin/alerts/webhook', { method: 'DELETE' })
    message.success(t('admin.webhook.saved'))
  } catch (e) { message.error(e.message) }
  finally { saving.value = false }
}
async function clear() {
  if (!(await confirmAsync({ title: t('admin.webhook.confirmDel'), danger: true }))) return
  try { await apiFetch('/api/admin/alerts/webhook', { method: 'DELETE' }); url.value = ''; message.success(t('admin.webhook.deleted')) }
  catch (e) { message.error(e.message) }
}
onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.webhook.eyebrow') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card :title="t('admin.webhook.sectionTitle')">
      <a-typography-paragraph type="secondary">{{ t('admin.webhook.help') }}</a-typography-paragraph>
      <a-form layout="vertical" @finish="save">
        <a-form-item :label="t('admin.webhook.urlLabel')">
          <a-input v-model:value="url" allow-clear placeholder="https://hooks.slack.com/services/T00/B00/xxx">
            <template #prefix><ApiOutlined /></template>
          </a-input>
        </a-form-item>
        <a-space wrap>
          <a-button type="primary" html-type="submit" :loading="saving">
            <template #icon><SaveOutlined /></template>
            {{ t('admin.common.save') }}
          </a-button>
          <a-button v-if="url" danger @click="clear">
            <template #icon><DeleteOutlined /></template>
            {{ t('admin.common.delete') }}
          </a-button>
        </a-space>
      </a-form>
    </a-card>
  </div>
</template>
