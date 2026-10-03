<script setup>
import { computed, ref } from 'vue'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()

const input = ref('')
const count = ref(4)
const busy = ref(false)
const err = ref('')
const result = ref(null)

const COUNT_OPTIONS = [1, 4, 8, 10].map((n) => ({ label: String(n), value: n }))

const trimmed = computed(() => input.value.trim())

// Pure client-side detection, mirrors server net.isIP() semantics so the badge
// updates as the user types. Server re-validates before any ping runs.
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

async function runPing() {
  if (busy.value) return
  err.value = ''
  result.value = null
  if (!detectedFamily.value) {
    err.value = t('cust.tools.ping.errInvalid')
    return
  }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/ping', {
      method: 'POST',
      body: { ip: trimmed.value, count: count.value }
    })
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

// Latency thresholds shared by the sample table text colour + bar colour.
function latencyType(ms) { return ms < 50 ? 'success' : ms < 150 ? 'warning' : 'danger' }
const BAR_COLOR = { success: 'var(--pb-success)', warning: 'var(--pb-warning)', danger: 'var(--pb-error)' }
const lossType = computed(() => {
  const l = result.value?.loss
  return l === 0 ? 'success' : l < 100 ? 'warning' : 'danger'
})

const sampleColumns = [
  { key: 'seq', dataIndex: 'seq', width: 90 },
  { key: 'ttl', dataIndex: 'ttl', width: 90 },
  { key: 'time', dataIndex: 'time', width: 100, align: 'right' },
  { key: 'bar' }
]
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.ping.subtitle') }}</a-typography-text>

    <a-card size="small">
      <template #title><ApiOutlined /> {{ t('cust.tools.ping.inputHead') }}</template>
      <a-form @submit="runPing">
        <a-flex wrap="wrap" gap="small" align="center">
          <a-input
            v-model:value="input"
            size="large"
            class="mono ip-input"
            :placeholder="t('cust.tools.ping.placeholder')"
            :status="trimmed && !detectedFamily ? 'error' : undefined"
            autocomplete="off"
            spellcheck="false"
            allow-clear
          >
            <template #suffix>
              <a-tag v-if="detectedFamily === 4" color="green" :bordered="false" class="mono fam-tag">
                <template #icon><CloudServerOutlined /></template>IPv4
              </a-tag>
              <a-tag v-else-if="detectedFamily === 6" color="blue" :bordered="false" class="mono fam-tag">
                <template #icon><GlobalOutlined /></template>IPv6
              </a-tag>
              <a-tag v-else-if="trimmed" color="error" :bordered="false" class="fam-tag">
                {{ t('cust.tools.ping.notIp') }}
              </a-tag>
            </template>
          </a-input>

          <a-space :size="8">
            <a-typography-text type="secondary">{{ t('cust.tools.ping.count') }}</a-typography-text>
            <a-select v-model:value="count" size="large" :options="COUNT_OPTIONS" class="mono" style="width: 80px" />
          </a-space>

          <a-space :size="8">
            <a-button size="large" @click="pasteFromClipboard">
              <template #icon><SnippetsOutlined /></template>
              {{ t('cust.tools.ping.paste') }}
            </a-button>
            <a-button type="primary" size="large" html-type="submit" :loading="busy" :disabled="!detectedFamily">
              <template #icon><CaretRightOutlined /></template>
              {{ busy ? t('cust.tools.ping.running') : t('cust.tools.ping.run') }}
            </a-button>
          </a-space>
        </a-flex>
      </a-form>

      <a-alert v-if="err" type="error" show-icon :message="err" class="below" />
      <a-typography-paragraph v-else type="secondary" class="below hint">
        <InfoCircleOutlined /> {{ t('cust.tools.ping.hint') }}
      </a-typography-paragraph>
    </a-card>

    <a-card v-if="result" size="small">
      <template #title><LineChartOutlined /> {{ t('cust.tools.ping.resultHead') }}</template>
      <template #extra>
        <StatusTag
          :status="result.ok ? 'ok' : 'error'"
          :label="result.ok ? t('cust.tools.ping.reachable') : t('cust.tools.ping.unreachable')"
        />
      </template>

      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 4 }">
        <a-descriptions-item :label="t('cust.tools.ping.target')">
          <a-typography-text class="mono" :copyable="{ text: result.target }">{{ result.target }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.family')">
          <span class="mono">{{ result.family.toUpperCase() }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.transmitted')">
          <span class="mono">{{ result.transmitted }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.received')">
          <span class="mono">{{ result.received }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.loss')">
          <a-typography-text :type="lossType" strong class="mono">{{ result.loss }}%</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.rttAvg')">
          <span class="mono">{{ result.rtt ? `${result.rtt.avg.toFixed(1)} ms` : '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.rttMin')">
          <span class="mono">{{ result.rtt ? `${result.rtt.min.toFixed(1)} ms` : '—' }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.ping.rttMax')">
          <span class="mono">{{ result.rtt ? `${result.rtt.max.toFixed(1)} ms` : '—' }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <a-table
        v-if="result.samples?.length"
        class="below"
        :columns="sampleColumns"
        :data-source="result.samples"
        row-key="seq"
        size="small"
        :show-header="false"
        :pagination="false"
        :scroll="{ x: 420 }"
      >
        <template #bodyCell="{ column, record: s }">
          <template v-if="column.key === 'seq' || column.key === 'ttl'">
            <span class="mono">{{ column.key }}={{ s[column.key] }}</span>
          </template>
          <template v-else-if="column.key === 'time'">
            <a-typography-text :type="latencyType(s.time)" class="mono">{{ s.time.toFixed(1) }} ms</a-typography-text>
          </template>
          <template v-else-if="column.key === 'bar'">
            <a-progress
              :percent="Math.min(100, s.time / 3)"
              :show-info="false"
              :stroke-color="BAR_COLOR[latencyType(s.time)]"
              size="small"
            />
          </template>
        </template>
      </a-table>

      <a-collapse ghost class="below">
        <a-collapse-panel key="raw" :header="t('cust.tools.ping.rawOutput')">
          <a-typography-paragraph class="raw"><pre class="mono">{{ result.raw }}</pre></a-typography-paragraph>
        </a-collapse-panel>
      </a-collapse>
    </a-card>
  </div>
</template>

<style scoped>
.ip-input { flex: 1 1 260px; min-width: 0; }
.fam-tag { margin-inline-end: 0; }
.below { margin-top: 12px; }
.hint { margin-bottom: 0; font-size: 12px; }
.raw { margin-bottom: 0; }
.raw pre { white-space: pre-wrap; word-break: break-all; max-height: 320px; overflow: auto; margin: 0; }
</style>
