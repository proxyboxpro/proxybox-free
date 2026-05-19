<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch, adminEmailPreview } from '../../api'

const templates = ref({})
const err = ref(''); const flash = ref('')
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
  try { templates.value = await apiFetch('/api/admin/email-templates') }
  catch (e) { err.value = e.message }
}
async function save() {
  try { templates.value = await apiFetch('/api/admin/email-templates', { method: 'PATCH', body: templates.value }); flash.value = 'Templates saved.' }
  catch (e) { err.value = e.message }
}
async function preview(key) {
  try {
    const r = await adminEmailPreview(key, null)
    previewKey.value = key
    previewSubject.value = r.subject
    previewHtml.value = r.html
  } catch (e) { err.value = e.message }
}
function closePreview() { previewKey.value = '' }
onMounted(refresh)
</script>
<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Email templates</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
      <button class="primary-action small" type="button" @click="save">Save all</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section v-for="(t, key) in templates" :key="key" class="surface" style="margin-bottom:14px">
      <div class="section-head">
        <h2>{{ key }}</h2>
        <button class="ghost-button" type="button" @click="preview(key)">Preview</button>
      </div>
      <p v-if="placeholders[key]?.length" style="font-size:12.5px; color:var(--muted)">
        Placeholders: <code v-for="p in placeholders[key]" :key="p" style="margin-right:6px">{{ p }}</code>
      </p>
      <div class="form-grid">
        <label class="input-field" style="grid-column:1/-1"><span>Subject</span><input v-model="t.subject" /></label>
        <label class="input-field" style="grid-column:1/-1"><span>HTML body</span>
          <textarea v-model="t.html" rows="8" style="font-family:monospace; font-size:12px; padding:8px; border:1px solid var(--bd); border-radius:6px; resize:vertical"></textarea>
        </label>
      </div>
    </section>

    <div v-if="previewKey" class="modal-backdrop" @click="closePreview"></div>
    <div v-if="previewKey" class="modal-card" @click.stop>
      <header><strong>Preview: {{ previewKey }}</strong><button type="button" class="ghost-button" @click="closePreview">Close</button></header>
      <div class="preview-subject"><span style="color:var(--muted)">Subject:</span> <strong>{{ previewSubject }}</strong></div>
      <iframe class="preview-frame" :srcdoc="previewHtml" sandbox="allow-same-origin"></iframe>
    </div>
  </section>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; }
.modal-card { position: fixed; top: 5%; left: 50%; transform: translateX(-50%); width: min(720px, 95vw); max-height: 90vh; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; z-index: 91; display: flex; flex-direction: column; }
.modal-card header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.preview-subject { padding: 12px 18px; border-bottom: 1px solid var(--border); }
.preview-frame { flex: 1; border: none; min-height: 480px; width: 100%; background: #fff; }
</style>
