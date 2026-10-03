<script setup>
import { computed, ref } from 'vue'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()

const inputText = ref('')
const busy = ref(false)
const err = ref('')
const result = ref(null)
const filterStatus = ref('all')
const search = ref('')

const lineCount = computed(() =>
  inputText.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length
)
const tooMany = computed(() => lineCount.value > 50)

async function runCheck() {
  if (busy.value) return
  err.value = ''
  result.value = null
  if (lineCount.value === 0) {
    err.value = t('cust.tools.bulk.errEmpty')
    return
  }
  if (tooMany.value) {
    err.value = t('cust.tools.bulk.errTooMany')
    return
  }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/bulk-check', {
      method: 'POST',
      body: { lines: inputText.value }
    })
  } catch (e) {
    err.value = e instanceof ApiError ? (e.data?.error || e.message) : e.message
  } finally {
    busy.value = false
  }
}

function pasteFromClipboard() {
  if (!navigator.clipboard) return
  navigator.clipboard.readText().then((v) => { inputText.value = String(v || '').trim() }).catch(() => {})
}
function clearAll() {
  inputText.value = ''
  result.value = null
  err.value = ''
}

const filtered = computed(() => {
  if (!result.value) return []
  const q = search.value.trim().toLowerCase()
  return result.value.results.filter((r) => {
    if (filterStatus.value === 'ok' && !r.ok) return false
    if (filterStatus.value === 'fail' && r.ok) return false
    if (!q) return true
    return `${r.line} ${r.host || ''} ${r.exitIp || ''} ${r.error || ''}`.toLowerCase().includes(q)
  })
})

const filterOptions = computed(() => [
  { label: t('cust.tools.bulk.filterAll'), value: 'all' },
  { label: t('cust.tools.bulk.filterOk'), value: 'ok' },
  { label: t('cust.tools.bulk.filterFail'), value: 'fail' }
])

const columns = computed(() => [
  { title: '#', key: 'idx', dataIndex: 'idx', width: 56 },
  { title: t('cust.tools.bulk.colLine'), key: 'line', dataIndex: 'line', ellipsis: true },
  { title: t('cust.tools.bulk.colStatus'), key: 'status', width: 110 },
  { title: t('cust.tools.bulk.colLatency'), key: 'latency', dataIndex: 'latencyMs', width: 100, align: 'right' },
  { title: t('cust.tools.bulk.colExit'), key: 'exit', dataIndex: 'exitIp', width: 150, responsive: ['lg'] },
  { title: t('cust.tools.bulk.colError'), key: 'error', dataIndex: 'error', ellipsis: true, responsive: ['lg'] }
])

const okRate = computed(() => (result.value?.total ? Math.round(result.value.ok / result.value.total * 100) : 0))

function escapeCsv(v) {
  const s = String(v ?? '')
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
function exportCsv(onlyOk = false) {
  if (!result.value) return
  const rows = result.value.results.filter((r) => (onlyOk ? r.ok : true))
  const head = ['line', 'type', 'host', 'port', 'ok', 'latencyMs', 'exitIp', 'error']
  const out = [head.join(',')]
  for (const r of rows) {
    out.push(head.map((k) => escapeCsv(r[k])).join(','))
  }
  const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `proxy-check-${Date.now()}.${onlyOk ? 'working' : 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
function copyWorkingLines() {
  if (!result.value || !navigator.clipboard) return
  const working = result.value.results.filter((r) => r.ok).map((r) => r.line)
  navigator.clipboard.writeText(working.join('\n'))
    .then(() => message.success(t('cust.proxies.copied', { n: working.length })))
    .catch((e) => message.error(e.message))
}
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.bulk.subtitle') }}</a-typography-text>

    <a-card size="small">
      <template #title><AppstoreOutlined /> {{ t('cust.tools.bulk.inputHead') }}</template>
      <template #extra>
        <a-typography-text :type="tooMany ? 'danger' : 'secondary'" class="mono">{{ lineCount }} / 50</a-typography-text>
      </template>

      <a-form @submit="runCheck">
        <a-textarea
          v-model:value="inputText"
          class="mono"
          :placeholder="t('cust.tools.bulk.placeholder')"
          :status="tooMany ? 'error' : undefined"
          :auto-size="{ minRows: 8, maxRows: 20 }"
          spellcheck="false"
        />

        <a-flex wrap="wrap" gap="small" justify="space-between" class="below">
          <a-space wrap :size="8">
            <a-button @click="pasteFromClipboard">
              <template #icon><SnippetsOutlined /></template>
              {{ t('cust.tools.bulk.paste') }}
            </a-button>
            <a-button @click="clearAll">
              <template #icon><ClearOutlined /></template>
              {{ t('cust.tools.bulk.clear') }}
            </a-button>
          </a-space>
          <a-button type="primary" html-type="submit" :loading="busy" :disabled="lineCount === 0 || tooMany">
            <template #icon><CaretRightOutlined /></template>
            {{ busy ? t('cust.tools.bulk.running') : t('cust.tools.bulk.run') }}
          </a-button>
        </a-flex>
      </a-form>

      <a-alert v-if="err" type="error" show-icon :message="err" class="below" />
      <a-typography-paragraph v-else type="secondary" class="below hint">
        <InfoCircleOutlined /> {{ t('cust.tools.bulk.hint') }}
      </a-typography-paragraph>
    </a-card>

    <a-card v-if="result" size="small" :title="t('cust.tools.bulk.resultHead')">
      <template #extra>
        <a-space wrap :size="6">
          <a-button size="small" @click="copyWorkingLines">
            <template #icon><CopyOutlined /></template>
            {{ t('cust.tools.bulk.copyWorking') }}
          </a-button>
          <a-button size="small" @click="exportCsv(true)">
            <template #icon><DownloadOutlined /></template>
            {{ t('cust.tools.bulk.exportWorking') }}
          </a-button>
          <a-button size="small" @click="exportCsv(false)">
            <template #icon><DownloadOutlined /></template>
            {{ t('cust.tools.bulk.exportAll') }}
          </a-button>
        </a-space>
      </template>

      <a-row :gutter="[12, 12]">
        <a-col :xs="12" :md="6">
          <a-card size="small"><a-statistic :title="t('cust.tools.bulk.kpiTotal')" :value="result.total" /></a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small"><a-statistic :title="t('cust.tools.bulk.kpiOk')" :value="result.ok" :value-style="{ color: 'var(--pb-success)' }" /></a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small"><a-statistic :title="t('cust.tools.bulk.kpiFail')" :value="result.fail" :value-style="{ color: 'var(--pb-error)' }" /></a-card>
        </a-col>
        <a-col :xs="12" :md="6">
          <a-card size="small"><a-statistic :title="t('cust.tools.bulk.kpiRate')" :value="okRate" suffix="%" :value-style="{ color: 'var(--pb-info)' }" /></a-card>
        </a-col>
      </a-row>

      <a-flex wrap="wrap" gap="small" class="below">
        <a-select v-model:value="filterStatus" :options="filterOptions" style="width: 180px" />
        <a-input v-model:value="search" allow-clear class="search mono-field" :placeholder="t('cust.tools.bulk.searchPh')">
          <template #prefix><SearchOutlined /></template>
        </a-input>
      </a-flex>

      <a-table
        class="below"
        :columns="columns"
        :data-source="filtered"
        row-key="idx"
        size="small"
        :pagination="false"
        :scroll="{ x: 560 }"
        :locale="{ emptyText: t('cust.tools.bulk.noMatch') }"
      >
        <template #bodyCell="{ column, record: r }">
          <template v-if="column.key === 'idx'">
            <span class="mono">{{ r.idx + 1 }}</span>
          </template>
          <template v-else-if="column.key === 'line'">
            <a-tooltip :title="r.line"><span class="mono">{{ r.line }}</span></a-tooltip>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="r.ok ? 'success' : 'error'" :bordered="false">
              <template #icon><CheckCircleOutlined v-if="r.ok" /><CloseCircleOutlined v-else /></template>
              {{ r.ok ? t('cust.tools.bulk.tagOk') : t('cust.tools.bulk.tagFail') }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'latency'">
            <span class="mono">{{ r.latencyMs ?? '—' }} ms</span>
          </template>
          <template v-else-if="column.key === 'exit'">
            <a-typography-text v-if="r.exitIp" class="mono" :copyable="{ text: r.exitIp }">{{ r.exitIp }}</a-typography-text>
            <span v-else class="mono">—</span>
          </template>
          <template v-else-if="column.key === 'error'">
            <a-tooltip v-if="r.error" :title="r.error"><a-typography-text type="danger" class="mono">{{ r.error }}</a-typography-text></a-tooltip>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.below { margin-top: 12px; }
.hint { margin-bottom: 0; font-size: 12px; }
.search { flex: 1 1 220px; min-width: 0; }
.mono-field :deep(input), .mono-field :deep(.ant-select-selection-item) { font-family: var(--pb-mono); }
</style>
