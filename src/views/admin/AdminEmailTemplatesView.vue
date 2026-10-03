<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch, adminEmailPreview } from '../../api'
import { message } from '../../ui/feedback'

const templates = ref({})
const err = ref('')
const loading = ref(false)
const saving = ref(false)
const previewKey = ref('')
const previewSubject = ref('')
const previewHtml = ref('')
const placeholders = {
  welcome: ['{{name}}', '{{trial}}', '{{email}}'],
  orderCreated: ['{{orderId}}', '{{quantity}}', '{{type}}', '{{hours}}', '{{proxyList}}'],
  expireWarning: ['{{count}}'],
  passwordChange: []
}

async function refresh() {
  loading.value = true
  try { templates.value = await apiFetch('/api/admin/email-templates') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try { templates.value = await apiFetch('/api/admin/email-templates', { method: 'PATCH', body: templates.value }); message.success('Templates saved.') }
  catch (e) { message.error(e.message) }
  finally { saving.value = false }
}
async function preview(key) {
  try {
    const r = await adminEmailPreview(key, null)
    previewKey.value = key
    previewSubject.value = r.subject
    previewHtml.value = r.html
  } catch (e) { message.error(e.message) }
}
function closePreview() { previewKey.value = '' }
onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">Email templates</a-typography-text>
      <a-space wrap>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          Refresh
        </a-button>
        <a-button type="primary" :loading="saving" @click="save">
          <template #icon><SaveOutlined /></template>
          Save all
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card v-if="loading && !Object.keys(templates).length" loading />

    <a-card v-for="(tpl, key) in templates" :key="key">
      <template #title><span class="mono">{{ key }}</span></template>
      <template #extra>
        <a-button size="small" @click="preview(key)">
          <template #icon><EyeOutlined /></template>
          Preview
        </a-button>
      </template>
      <a-typography-paragraph v-if="placeholders[key]?.length" type="secondary">
        Placeholders:
        <a-tag v-for="p in placeholders[key]" :key="p" :bordered="false" class="mono">{{ p }}</a-tag>
      </a-typography-paragraph>
      <a-form :model="tpl" layout="vertical">
        <a-form-item label="Subject" name="subject">
          <a-input v-model:value="tpl.subject" />
        </a-form-item>
        <a-form-item label="HTML body" name="html" class="last-item">
          <a-textarea v-model:value="tpl.html" :auto-size="{ minRows: 8, maxRows: 24 }" class="mono html-input" />
        </a-form-item>
      </a-form>
    </a-card>

    <a-modal
      :open="!!previewKey"
      :title="`Preview: ${previewKey}`"
      :width="720"
      :footer="null"
      destroy-on-close
      @cancel="closePreview"
    >
      <a-typography-paragraph>
        <a-typography-text type="secondary">Subject:</a-typography-text>
        <a-typography-text strong> {{ previewSubject }}</a-typography-text>
      </a-typography-paragraph>
      <!-- Email HTML is designed for a white mail-client canvas, so the frame
           keeps a white background in both themes. -->
      <iframe class="preview-frame" :srcdoc="previewHtml" sandbox="allow-same-origin"></iframe>
      <a-flex justify="flex-end" class="preview-foot">
        <a-button @click="closePreview">Close</a-button>
      </a-flex>
    </a-modal>
  </div>
</template>

<style scoped>
.html-input { font-size: 12px; }
.last-item { margin-bottom: 0; }
.preview-frame { display: block; width: 100%; min-height: 60vh; border: 1px solid var(--pb-border); border-radius: 8px; background: #fff; }
.preview-foot { margin-top: 12px; }
</style>
