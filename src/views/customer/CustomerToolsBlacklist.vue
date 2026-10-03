<script setup>
import { computed, ref } from 'vue'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const input = ref('')
const busy = ref(false)
const err = ref('')
const result = ref(null)

const trimmed = computed(() => input.value.trim())
const isIpv4 = computed(() => {
  const v = trimmed.value
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return false
  return v.split('.').map(Number).every((n) => n >= 0 && n <= 255)
})

async function runCheck() {
  if (busy.value) return
  err.value = ''
  result.value = null
  if (!isIpv4.value) {
    err.value = t('cust.tools.blacklist.errInvalid')
    return
  }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/blacklist', { method: 'POST', body: { ip: trimmed.value } })
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

// Summary banner tone: any listing → error, every DNSBL errored → warning, else clean.
const summaryType = computed(() => {
  if (!result.value) return 'info'
  if (result.value.listed > 0) return 'error'
  if (result.value.errors === result.value.total) return 'warning'
  return 'success'
})

// r.listed: true = listed, false = clean, anything else = lookup error.
function rowState(r) { return r.listed === true ? 'listed' : r.listed === false ? 'clean' : 'error' }
const TAG_COLOR = { listed: 'error', clean: 'success', error: 'warning' }
const TAG_KEY = { listed: 'cust.tools.blacklist.tagListed', clean: 'cust.tools.blacklist.tagClean', error: 'cust.tools.blacklist.tagError' }

const columns = [
  { key: 'state', width: 44, align: 'center' },
  { key: 'meta' },
  { key: 'tag', width: 130 },
  { key: 'detail', align: 'right', ellipsis: true, responsive: ['md'] }
]
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.blacklist.subtitle') }}</a-typography-text>

    <a-card size="small">
      <template #title><SafetyOutlined /> {{ t('cust.tools.blacklist.inputHead') }}</template>
      <a-form @submit="runCheck">
        <a-flex wrap="wrap" gap="small" align="center">
          <a-input
            v-model:value="input"
            size="large"
            class="ip-input mono-field"
            :placeholder="t('cust.tools.blacklist.placeholder')"
            :status="trimmed && !isIpv4 ? 'error' : undefined"
            autocomplete="off"
            spellcheck="false"
            allow-clear
          >
            <template #suffix>
              <a-tag v-if="isIpv4" color="green" :bordered="false" class="mono fam-tag">IPv4</a-tag>
              <a-tag v-else-if="trimmed" color="error" :bordered="false" class="fam-tag">{{ t('cust.tools.blacklist.v4only') }}</a-tag>
            </template>
          </a-input>
          <a-space :size="8">
            <a-button size="large" @click="pasteFromClipboard">
              <template #icon><SnippetsOutlined /></template>
              {{ t('cust.tools.blacklist.paste') }}
            </a-button>
            <a-button type="primary" size="large" html-type="submit" :loading="busy" :disabled="!isIpv4">
              <template #icon><CaretRightOutlined /></template>
              {{ busy ? t('cust.tools.blacklist.running') : t('cust.tools.blacklist.run') }}
            </a-button>
          </a-space>
        </a-flex>
      </a-form>

      <a-alert v-if="err" type="error" show-icon :message="err" class="below" />
      <a-typography-paragraph v-else type="secondary" class="below hint">
        <InfoCircleOutlined /> {{ t('cust.tools.blacklist.hint') }}
      </a-typography-paragraph>
    </a-card>

    <a-card v-if="result && !result.error" size="small">
      <template #title>
        <a-space :size="6">
          <a-typography-text v-if="result.listed === 0" type="success"><SafetyCertificateOutlined /></a-typography-text>
          <a-typography-text v-else type="danger"><WarningOutlined /></a-typography-text>
          {{ t('cust.tools.blacklist.resultHead') }}
        </a-space>
      </template>
      <template #extra>
        <a-typography-text class="mono" :copyable="{ text: result.ip }">{{ result.ip }}</a-typography-text>
      </template>

      <a-alert :type="summaryType" class="summary">
        <template #message>
          <a-row :gutter="[12, 12]">
            <a-col :xs="12" :md="6">
              <a-statistic :title="t('cust.tools.blacklist.checked')" :value="result.total" />
            </a-col>
            <a-col :xs="12" :md="6">
              <a-statistic :title="t('cust.tools.blacklist.clean')" :value="result.clean" :value-style="{ color: 'var(--pb-success)' }" />
            </a-col>
            <a-col :xs="12" :md="6">
              <a-statistic :title="t('cust.tools.blacklist.listed')" :value="result.listed" :value-style="{ color: 'var(--pb-error)' }" />
            </a-col>
            <a-col :xs="12" :md="6">
              <a-statistic :title="t('cust.tools.blacklist.errors')" :value="result.errors" :value-style="{ color: 'var(--pb-warning)' }" />
            </a-col>
          </a-row>
        </template>
      </a-alert>

      <a-table
        class="below"
        :columns="columns"
        :data-source="result.results"
        row-key="host"
        size="small"
        :show-header="false"
        :pagination="false"
      >
        <template #bodyCell="{ column, record: r }">
          <template v-if="column.key === 'state'">
            <a-typography-text v-if="rowState(r) === 'listed'" type="danger"><CloseCircleOutlined /></a-typography-text>
            <a-typography-text v-else-if="rowState(r) === 'clean'" type="success"><CheckCircleOutlined /></a-typography-text>
            <a-typography-text v-else type="warning"><ExclamationCircleOutlined /></a-typography-text>
          </template>
          <template v-else-if="column.key === 'meta'">
            <a-flex vertical :gap="2">
              <a-typography-text strong>{{ r.name }}</a-typography-text>
              <a-typography-text type="secondary" class="mono small">{{ r.host }}</a-typography-text>
            </a-flex>
          </template>
          <template v-else-if="column.key === 'tag'">
            <a-tag :color="TAG_COLOR[rowState(r)]" :bordered="false" class="mono">{{ t(TAG_KEY[rowState(r)]) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'detail'">
            <a-typography-text type="secondary" class="mono small">
              {{ r.response || r.error || '' }} {{ r.latencyMs }}ms
            </a-typography-text>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-alert v-else-if="result?.error" type="error" show-icon :message="result.error" />
  </div>
</template>

<style scoped>
.ip-input { flex: 1 1 260px; min-width: 0; }
.fam-tag { margin-inline-end: 0; }
.below { margin-top: 12px; }
.hint { margin-bottom: 0; font-size: 12px; }
.small { font-size: 12px; }
.summary :deep(.ant-alert-message) { width: 100%; }
.mono-field :deep(input), .mono-field :deep(.ant-select-selection-item) { font-family: var(--pb-mono); }
</style>
