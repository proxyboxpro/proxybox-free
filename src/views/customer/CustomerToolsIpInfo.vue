<script setup>
import { computed, ref } from 'vue'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'

const { t } = useI18n()
const input = ref('')
const busy = ref(false)
const err = ref('')
const result = ref(null)

const trimmed = computed(() => input.value.trim())
const detectedFamily = computed(() => {
  const v = trimmed.value
  if (!v) return null
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    const parts = v.split('.').map(Number)
    return parts.every((n) => n >= 0 && n <= 255) ? 4 : null
  }
  if (v.includes(':') && /^[0-9a-fA-F:]+$/.test(v.replace(/%.+$/, ''))) return 6
  return null
})

async function runLookup() {
  if (busy.value) return
  err.value = ''
  result.value = null
  if (!detectedFamily.value) {
    err.value = t('cust.tools.ipInfo.errInvalid')
    return
  }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/ip-info', { method: 'POST', body: { ip: trimmed.value } })
  } catch (e) {
    err.value = e instanceof ApiError ? (e.data?.error || e.message) : e.message
  } finally {
    busy.value = false
  }
}

function pasteFromClipboard() {
  if (!navigator.clipboard) return
  navigator.clipboard.readText().then((v) => { input.value = String(v || '').trim() }).catch(() => {})
}
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.ipInfo.subtitle') }}</a-typography-text>

    <a-card size="small">
      <template #title><ApiOutlined /> {{ t('cust.tools.ipInfo.inputHead') }}</template>
      <a-form @submit="runLookup">
        <a-flex wrap="wrap" gap="small" align="center">
          <a-input
            v-model:value="input"
            size="large"
            class="ip-input mono-field"
            :placeholder="t('cust.tools.ipInfo.placeholder')"
            autocomplete="off"
            spellcheck="false"
            allow-clear
          >
            <template #suffix>
              <a-tag v-if="detectedFamily === 4" color="green" :bordered="false" class="mono fam-tag">IPv4</a-tag>
              <a-tag v-else-if="detectedFamily === 6" color="blue" :bordered="false" class="mono fam-tag">IPv6</a-tag>
            </template>
          </a-input>
          <a-space :size="8">
            <a-button size="large" @click="pasteFromClipboard">
              <template #icon><SnippetsOutlined /></template>
              {{ t('cust.tools.ipInfo.paste') }}
            </a-button>
            <a-button type="primary" size="large" html-type="submit" :loading="busy" :disabled="!detectedFamily">
              <template #icon><SearchOutlined /></template>
              {{ busy ? t('cust.tools.ipInfo.running') : t('cust.tools.ipInfo.run') }}
            </a-button>
          </a-space>
        </a-flex>
      </a-form>

      <a-alert v-if="err" type="error" show-icon :message="err" class="below" />
      <a-typography-paragraph v-else type="secondary" class="below hint">
        <InfoCircleOutlined /> {{ t('cust.tools.ipInfo.hint') }}
      </a-typography-paragraph>
    </a-card>

    <a-card v-if="result && !result.error" size="small">
      <template #title><GlobalOutlined /> {{ t('cust.tools.ipInfo.resultHead') }}</template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">
        <a-descriptions-item>
          <template #label><ApiOutlined /> {{ t('cust.tools.ipInfo.ip') }}</template>
          <a-typography-text class="mono" :copyable="{ text: result.ip }">{{ result.ip }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ipInfo.family')">
          <span class="mono">{{ result.family.toUpperCase() }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><NumberOutlined /> {{ t('cust.tools.ipInfo.asn') }}</template>
          <span class="mono">{{ result.asn || '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><ClusterOutlined /> {{ t('cust.tools.ipInfo.cidr') }}</template>
          <span class="mono">{{ result.cidr || '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><EnvironmentOutlined /> {{ t('cust.tools.ipInfo.country') }}</template>
          <a-space :size="8">
            <CountryFlag v-if="result.country && result.country.length === 2" :code="result.country" :size="16" />
            <span class="mono">{{ result.country || '—' }}</span>
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ipInfo.registry')">
          <span class="mono">{{ (result.registry || '—').toUpperCase() }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><CalendarOutlined /> {{ t('cust.tools.ipInfo.allocDate') }}</template>
          <span class="mono">{{ result.allocDate || '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><BankOutlined /> {{ t('cust.tools.ipInfo.org') }}</template>
          <span class="mono org">{{ result.org || '—' }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-alert v-else-if="result?.error" type="error" show-icon :message="result.error" />
  </div>
</template>

<style scoped>
.ip-input { flex: 1 1 260px; min-width: 0; }
.fam-tag { margin-inline-end: 0; }
.below { margin-top: 12px; }
.hint { margin-bottom: 0; font-size: 12px; }
.org { word-break: break-word; }
.mono-field :deep(input), .mono-field :deep(.ant-select-selection-item) { font-family: var(--pb-mono); }
</style>
