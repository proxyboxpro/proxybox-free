<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const cfg = ref(null)       // { apiKey } from /api/config
const newKey = ref('')      // freshly rotated, shown once
const busy = ref(false)
const loading = ref(false)
const err = ref('')
const confirmText = ref('')

async function refresh() {
  err.value = ''
  loading.value = true
  try { cfg.value = await apiFetch('/api/config') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

const masked = computed(() => {
  const k = cfg.value?.api?.apiKey || ''
  if (!k) return '—'
  return k.slice(0, 6) + '••••••••••••' + k.slice(-4)
})
const canConfirm = computed(() => confirmText.value.trim().toUpperCase() === 'ROTATE')

async function rotate() {
  if (!canConfirm.value || busy.value) return
  busy.value = true
  try {
    const r = await apiFetch('/api/admin/rotate-api-key', { method: 'POST' })
    newKey.value = r.apiKey || r.key || ''
    confirmText.value = ''
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary"><SafetyOutlined /> {{ t('admin.apikey.title') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-alert type="error" show-icon :message="t('admin.apikey.warnTitle')">
      <template #description>
        <a-typography-paragraph class="warn-p">{{ t('admin.apikey.warn1') }}</a-typography-paragraph>
        <a-typography-paragraph class="warn-p">{{ t('admin.apikey.warn2') }}</a-typography-paragraph>
        <ul class="impacts">
          <li><a-typography-text type="secondary">{{ t('admin.apikey.impact1') }}</a-typography-text></li>
          <li><a-typography-text type="secondary">{{ t('admin.apikey.impact2') }}</a-typography-text></li>
          <li><a-typography-text type="secondary">{{ t('admin.apikey.impact3') }}</a-typography-text></li>
        </ul>
      </template>
    </a-alert>

    <a-card :loading="loading && !cfg">
      <template #title><KeyOutlined /> {{ t('admin.apikey.current') }}</template>
      <a-typography-text code class="mono key-text">{{ masked }}</a-typography-text>
      <div v-if="cfg?.api" class="host-line">
        <a-typography-text type="secondary">{{ t('admin.apikey.host') }}: </a-typography-text>
        <a-typography-text class="mono">{{ cfg.api.host }}:{{ cfg.api.port }}</a-typography-text>
      </div>
    </a-card>

    <a-card>
      <template #title><SyncOutlined /> {{ t('admin.apikey.rotateAction') }}</template>
      <a-typography-paragraph type="secondary">{{ t('admin.apikey.rotateDesc') }}</a-typography-paragraph>
      <a-form layout="vertical" class="rotate-form" @finish="rotate">
        <a-form-item :label="t('admin.apikey.confirmType')">
          <a-input v-model:value="confirmText" placeholder="ROTATE" autocomplete="off" />
        </a-form-item>
        <a-button type="primary" danger html-type="submit" :disabled="!canConfirm" :loading="busy">
          <template #icon><SafetyOutlined /></template>
          {{ t('admin.apikey.doRotate') }}
        </a-button>
      </a-form>
    </a-card>

    <a-alert v-if="newKey" type="success" show-icon :message="t('admin.apikey.newKey')">
      <template #description>
        <a-typography-paragraph>{{ t('admin.apikey.newKeyDesc') }}</a-typography-paragraph>
        <a-typography-paragraph
          :copyable="{ text: newKey, tooltips: [t('common.copy'), t('admin.common.copied')] }"
          class="mono new-key"
        >
          <a-typography-text type="success" strong>{{ newKey }}</a-typography-text>
        </a-typography-paragraph>
        <a-typography-text type="warning" class="mono hint">{{ t('admin.apikey.persistHint') }}</a-typography-text>
      </template>
    </a-alert>
  </div>
</template>

<style scoped>
.warn-p { margin-bottom: 6px; }
.impacts { margin: 6px 0 0; padding-left: 20px; }
.key-text { font-size: 14px; letter-spacing: 0.04em; }
.host-line { margin-top: 10px; font-size: 12.5px; }
.rotate-form { max-width: 360px; }
.new-key { font-size: 14px; }
.hint { font-size: 12px; }
</style>
