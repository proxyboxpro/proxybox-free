<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Clipboard, KeyRound, RefreshCw, ShieldAlert } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const cfg = ref(null)       // { apiKey } from /api/config
const newKey = ref('')      // freshly rotated, shown once
const busy = ref(false)
const err = ref('')
const confirmText = ref('')

async function refresh() {
  err.value = ''
  try { cfg.value = await apiFetch('/api/config') }
  catch (e) { err.value = e.message }
}

const masked = computed(() => {
  const k = cfg.value?.api?.apiKey || ''
  if (!k) return '—'
  return k.slice(0, 6) + '••••••••••••' + k.slice(-4)
})
const canConfirm = computed(() => confirmText.value.trim().toUpperCase() === 'ROTATE')

async function rotate() {
  if (!canConfirm.value || busy.value) return
  busy.value = true; err.value = ''
  try {
    const r = await apiFetch('/api/admin/rotate-api-key', { method: 'POST' })
    newKey.value = r.apiKey || r.key || ''
    confirmText.value = ''
    await refresh()
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}
function copyKey() { if (newKey.value) navigator.clipboard?.writeText(newKey.value) }

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow"><ShieldAlert :size="13" style="vertical-align:-2px" /> {{ t('admin.apikey.title') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="14" /></button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <section class="surface" style="border-color: var(--red); background: linear-gradient(180deg, var(--red-soft) 0%, var(--surface) 100%)">
      <div class="section-head">
        <h2><AlertTriangle :size="15" style="vertical-align:-3px; color: var(--red)" /> {{ t('admin.apikey.warnTitle') }}</h2>
      </div>
      <p style="font-size:13px; color:var(--text); line-height:1.6">{{ t('admin.apikey.warn1') }}</p>
      <p style="font-size:13px; color:var(--text); line-height:1.6; margin-top:6px">{{ t('admin.apikey.warn2') }}</p>
      <ul style="margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 12.5px; line-height: 1.7">
        <li>{{ t('admin.apikey.impact1') }}</li>
        <li>{{ t('admin.apikey.impact2') }}</li>
        <li>{{ t('admin.apikey.impact3') }}</li>
      </ul>
    </section>

    <section class="surface">
      <div class="section-head"><h2><KeyRound :size="14" style="vertical-align:-2px" /> {{ t('admin.apikey.current') }}</h2></div>
      <div class="credential-box" style="display:flex; align-items:center; gap:10px">
        <code style="flex:1; font-size: 13px; letter-spacing: 0.04em">{{ masked }}</code>
      </div>
      <p v-if="cfg?.api" style="font-size: 11.5px; color: var(--muted); margin-top: 8px">
        {{ t('admin.apikey.host') }}: <span class="cell-mono" style="color: var(--text)">{{ cfg.api.host }}:{{ cfg.api.port }}</span>
      </p>
    </section>

    <section class="surface">
      <div class="section-head"><h2><RefreshCw :size="14" style="vertical-align:-2px" /> {{ t('admin.apikey.rotateAction') }}</h2></div>
      <p style="font-size: 12.5px; color: var(--muted); margin-bottom: 12px">{{ t('admin.apikey.rotateDesc') }}</p>
      <label class="input-field" style="max-width: 320px; margin-bottom: 12px">
        <span>{{ t('admin.apikey.confirmType') }}</span>
        <input v-model="confirmText" type="text" placeholder="ROTATE" autocomplete="off" />
      </label>
      <button class="primary-action" type="button" :disabled="!canConfirm || busy" @click="rotate" style="background: var(--red); border-color: var(--red); box-shadow: 0 0 12px rgba(248,81,73,.3)">
        <ShieldAlert :size="15" /> {{ busy ? t('common.loading') : t('admin.apikey.doRotate') }}
      </button>
    </section>

    <section v-if="newKey" class="surface" style="border-color: var(--green); background: linear-gradient(180deg, var(--green-soft) 0%, var(--surface) 100%)">
      <div class="section-head">
        <h2 style="color: var(--green)">{{ t('admin.apikey.newKey') }}</h2>
      </div>
      <p style="font-size: 12.5px; color: var(--text); margin-bottom: 10px">{{ t('admin.apikey.newKeyDesc') }}</p>
      <div class="credential-box" style="display:flex; align-items:center; gap:10px">
        <code style="flex:1; font-size: 13px; word-break: break-all; color: var(--green)">{{ newKey }}</code>
        <button class="ghost-button" type="button" @click="copyKey"><Clipboard :size="14" /> {{ t('common.copy') }}</button>
      </div>
      <p style="font-size: 11.5px; color: var(--yellow); margin-top: 10px; font-family: var(--mono)">
        {{ t('admin.apikey.persistHint') }}
      </p>
    </section>
  </section>
</template>
