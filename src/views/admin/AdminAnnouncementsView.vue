<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Info, Megaphone, Plus, RefreshCw,
  Trash2, Wrench
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const list = ref([])
const err = ref('')
const flash = ref('')
const busy = ref(false)

const form = ref({
  text: '',
  severity: 'info',     // info | warning | error | success
  visibility: 'public', // public | customer | admin
  expiresAt: '',
  dismissible: true
})

async function refresh() {
  err.value = ''
  try { list.value = await apiFetch('/api/admin/announcements') }
  catch (e) { err.value = e.message }
}

async function create() {
  if (!form.value.text.trim() || busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const body = {
      text: form.value.text.trim(),
      severity: form.value.severity,
      visibility: form.value.visibility,
      dismissible: form.value.dismissible,
      expiresAt: form.value.expiresAt ? new Date(form.value.expiresAt).toISOString() : null
    }
    await apiFetch('/api/admin/announcements', { method: 'POST', body })
    flash.value = t('admin.ann.created')
    form.value.text = ''; form.value.expiresAt = ''
    await refresh()
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}

async function remove(id) {
  if (!confirm(t('admin.ann.confirmDel'))) return
  try { await apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' }); await refresh() }
  catch (e) { err.value = e.message }
}

function fmtTs(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—' }
function iconOf(sev) {
  if (sev === 'error') return AlertOctagon
  if (sev === 'warning') return AlertTriangle
  if (sev === 'success') return CheckCircle2
  return Info
}
function colorOf(sev) {
  if (sev === 'error')   return 'var(--red)'
  if (sev === 'warning') return 'var(--yellow)'
  if (sev === 'success') return 'var(--green)'
  return 'var(--blue)'
}
function bgOf(sev) {
  if (sev === 'error')   return 'var(--red-soft)'
  if (sev === 'warning') return 'var(--yellow-soft)'
  if (sev === 'success') return 'var(--green-soft)'
  return 'var(--blue-soft)'
}
function isExpired(a) {
  return a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()
}

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow"><Megaphone :size="13" style="vertical-align:-2px" /> {{ t('admin.ann.title') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /></button>
    </div>
    <p style="color: var(--muted); font-size: 12.5px; margin: 0">{{ t('admin.ann.subtitle') }}</p>

    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color: var(--green); font-size: 13px">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2><Plus :size="14" style="vertical-align:-2px" /> {{ t('admin.ann.createTitle') }}</h2></div>

      <label class="input-field" style="margin-bottom: 12px">
        <span>{{ t('admin.ann.text') }} ({{ form.text.length }}/600)</span>
        <textarea v-model="form.text" rows="3" maxlength="600" :placeholder="t('admin.ann.textPlaceholder')" style="font-family: inherit; resize: vertical"></textarea>
      </label>

      <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 14px">
        <label class="input-field">
          <span>{{ t('admin.ann.severity') }}</span>
          <select v-model="form.severity">
            <option value="info">Info (xanh)</option>
            <option value="success">Success (xanh lá)</option>
            <option value="warning">Warning (vàng)</option>
            <option value="error">Error (đỏ)</option>
          </select>
        </label>
        <label class="input-field">
          <span>{{ t('admin.ann.visibility') }}</span>
          <select v-model="form.visibility">
            <option value="public">Public — mọi visitor</option>
            <option value="customer">Customer only</option>
            <option value="admin">Admin only</option>
          </select>
        </label>
        <label class="input-field">
          <span>{{ t('admin.ann.expiresAt') }} ({{ t('cust.buy.optional') }})</span>
          <input v-model="form.expiresAt" type="datetime-local" />
        </label>
      </div>

      <label class="check-line" style="margin-bottom: 12px">
        <input v-model="form.dismissible" type="checkbox" />
        <span style="color: var(--text); font-size: 13px">{{ t('admin.ann.dismissible') }}</span>
      </label>

      <div style="margin: 8px 0; padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid;" :style="{ background: bgOf(form.severity), borderColor: colorOf(form.severity) }">
        <div style="display: flex; align-items: center; gap: 10px">
          <component :is="iconOf(form.severity)" :size="16" :style="{ color: colorOf(form.severity) }" />
          <span style="color: var(--text); font-size: 13px">{{ form.text || t('admin.ann.previewEmpty') }}</span>
        </div>
      </div>

      <button class="primary-action" type="button" :disabled="!form.text.trim() || busy" @click="create">
        <Plus :size="15" /> {{ busy ? t('common.loading') : t('admin.ann.create') }}
      </button>
    </section>

    <section v-if="list.length" class="surface">
      <div class="section-head"><h2>{{ t('admin.ann.active') }} ({{ list.length }})</h2></div>
      <div style="display: flex; flex-direction: column; gap: 8px">
        <div
          v-for="a in list" :key="a.id"
          :style="{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 14px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor: colorOf(a.severity), background: bgOf(a.severity), opacity: isExpired(a) ? 0.5 : 1 }"
        >
          <component :is="iconOf(a.severity)" :size="16" :style="{ color: colorOf(a.severity) }" />
          <div style="flex: 1; min-width: 0">
            <div style="color: var(--text); font-size: 13px">{{ a.text }}</div>
            <div style="display: flex; gap: 10px; margin-top: 4px; font-size: 11px; color: var(--muted)">
              <span class="cell-mono">{{ a.id }}</span>
              <span><span class="tag">{{ a.visibility }}</span></span>
              <span v-if="a.expiresAt" :style="{ color: isExpired(a) ? 'var(--red)' : 'var(--muted)' }">
                {{ isExpired(a) ? t('admin.ann.expired') : t('admin.ann.expiresOn') }}: {{ fmtTs(a.expiresAt) }}
              </span>
              <span v-else>{{ t('admin.ann.noExpiry') }}</span>
              <span v-if="!a.dismissible" style="color: var(--yellow)">{{ t('admin.ann.notDismissible') }}</span>
              <span class="cell-mono">{{ t('admin.ann.created') }}: {{ fmtTs(a.createdAt) }}</span>
            </div>
          </div>
          <button class="ghost-button" type="button" @click="remove(a.id)"><Trash2 :size="13" /></button>
        </div>
      </div>
    </section>
    <p v-else class="empty-text">{{ t('admin.ann.empty') }}</p>
  </section>
</template>
