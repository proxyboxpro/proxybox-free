<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Grid } from 'ant-design-vue'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'
import SpeedGauge from '../../components/SpeedGauge.vue'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const screens = Grid.useBreakpoint()
// The gauge is a fixed-size SVG: shrink it on phones so it fits a 390px viewport.
const gaugeSize = computed(() => (screens.value.sm ? 320 : 260))

const proxies = ref([])
const proxyId = ref('')
const country = ref('VN')
const isp = ref('auto')
const isps = ref([])         // [{ sponsor, serverCount }]
const ispsLoading = ref(false)
const busy = ref(false)
const err = ref('')
const result = ref(null)

const SUPPORTED_COUNTRIES = [
  { code: 'VN', name: 'Vietnam' },
  { code: 'US', name: 'United States' },
  { code: 'SG', name: 'Singapore' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TH', name: 'Thailand' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'AU', name: 'Australia' },
  { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' }
]
const countryOptions = SUPPORTED_COUNTRIES.map((c) => ({ label: c.name, value: c.code }))

const proxyOptions = computed(() => proxies.value.map((p) => ({
  value: p.id,
  label: `${p.type} — ${p.ip || p.bindIp}:${p.port} (${p.username})`
})))
const ispOptions = computed(() => [
  { value: 'auto', label: t('cust.tools.speed.ispAuto') },
  ...isps.value.map((i) => ({
    value: i.sponsor.toLowerCase(),
    label: `${i.sponsor} (${i.serverCount} server${i.serverCount > 1 ? 's' : ''})`
  }))
])

async function loadProxies() {
  try {
    const list = await apiFetch('/api/v1/user/proxies')
    proxies.value = (list || []).filter((p) => p.status !== 'expired')
    if (proxies.value.length && !proxyId.value) proxyId.value = proxies.value[0].id
  } catch (e) { err.value = e.message }
}

async function loadIsps() {
  ispsLoading.value = true
  isps.value = []
  try {
    const r = await apiFetch(`/api/v1/user/tools/speedtest-isps?country=${country.value}`)
    isps.value = r.isps || []
  } catch { /* keep silent — ISP picker just won't have options */ }
  finally { ispsLoading.value = false }
}

watch(country, () => { isp.value = 'auto'; loadIsps() })

async function runTest() {
  if (busy.value) return
  err.value = ''
  result.value = null
  if (!proxyId.value) { err.value = t('cust.tools.speed.errNoProxy'); return }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/speed-test', {
      method: 'POST',
      body: { proxyId: proxyId.value, country: country.value, isp: isp.value }
    })
  } catch (e) {
    err.value = e instanceof ApiError ? (e.data?.error || e.message) : e.message
  } finally {
    busy.value = false
  }
}

function fmtBytes(b) {
  if (!b) return '0 B'
  const u = ['B','KB','MB','GB']
  let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`
}

onMounted(async () => {
  await loadProxies()
  loadIsps()
})
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.speed.subtitle') }}</a-typography-text>

    <a-card size="small">
      <template #title><DashboardOutlined /> {{ t('cust.tools.speed.inputHead') }}</template>

      <a-alert v-if="!proxies.length" type="info" show-icon :message="t('cust.tools.speed.noProxy')" />

      <a-form v-else layout="vertical" @submit="runTest">
        <a-row :gutter="12">
          <a-col :xs="24" :lg="12">
            <a-form-item :label="t('cust.tools.speed.proxy')">
              <a-select
                v-model:value="proxyId"
                :options="proxyOptions"
                show-search
                option-filter-prop="label"
                class="mono-field"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('cust.tools.speed.country')">
              <a-select v-model:value="country" :options="countryOptions" show-search option-filter-prop="label">
                <template #option="{ value, label }">
                  <a-space :size="8"><CountryFlag :code="value" :size="14" />{{ label }}</a-space>
                </template>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item>
              <template #label>
                {{ t('cust.tools.speed.isp') }}
                <a-typography-text v-if="ispsLoading" type="secondary" class="loading-isps">({{ t('cust.tools.speed.loadingIsps') }})</a-typography-text>
              </template>
              <a-select v-model:value="isp" :options="ispOptions" :loading="ispsLoading" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="busy" :disabled="!proxyId">
          <template #icon><CaretRightOutlined /></template>
          {{ busy ? t('cust.tools.speed.running') : t('cust.tools.speed.run') }}
        </a-button>
      </a-form>

      <a-alert v-if="err" type="error" show-icon :message="err" class="below" />
      <a-typography-paragraph v-else type="secondary" class="below hint">
        <InfoCircleOutlined /> {{ t('cust.tools.speed.hint') }}
      </a-typography-paragraph>
    </a-card>

    <!-- Live gauge — visible during run + after result. Idle when neither. -->
    <a-card v-if="busy || result" size="small">
      <a-flex vertical align="center" gap="small" class="gauge-wrap">
        <SpeedGauge
          :value="busy ? 0 : (result?.mbps || 0)"
          :max="null"
          :status="busy ? 'running' : (result?.ok ? 'done' : result ? 'error' : 'idle')"
          :label="busy ? t('cust.tools.speed.runningHint') : ''"
          :size="gaugeSize"
        />
        <a-typography-text v-if="busy" type="secondary">{{ t('cust.tools.speed.runningHint') }}</a-typography-text>
      </a-flex>
    </a-card>

    <a-card v-if="result && !busy" size="small">
      <template #title><LineChartOutlined /> {{ t('cust.tools.speed.resultHead') }}</template>
      <template #extra>
        <StatusTag
          :status="result.ok ? 'success' : 'failed'"
          :label="result.ok ? t('cust.tools.speed.success') : t('cust.tools.speed.failed')"
        />
      </template>

      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">
        <a-descriptions-item>
          <template #label><CloudServerOutlined /> {{ t('cust.tools.speed.server') }}</template>
          <a-space :size="6"><BankOutlined />{{ result.server?.sponsor || '—' }}</a-space>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><EnvironmentOutlined /> {{ t('cust.tools.speed.location') }}</template>
          {{ result.server?.name || '—' }}, {{ result.server?.country || '—' }}
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.speed.endpoint')">
          <span class="mono">{{ result.server?.host }}:{{ result.server?.port }}</span>
        </a-descriptions-item>
        <a-descriptions-item>
          <template #label><DownloadOutlined /> {{ t('cust.tools.speed.totalBytes') }}</template>
          <span class="mono">{{ fmtBytes(result.totalBytes) }}</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.speed.duration')">
          <span class="mono">{{ (result.durationMs / 1000).toFixed(2) }} s</span>
        </a-descriptions-item>
        <a-descriptions-item :label="t('cust.tools.speed.ttfb')">
          <span class="mono">{{ result.ttfbMs ? `${result.ttfbMs} ms` : '—' }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <a-alert v-if="result.error" type="error" show-icon :message="result.error" class="below" />
    </a-card>
  </div>
</template>

<style scoped>
.below { margin-top: 12px; }
.hint { margin-bottom: 0; font-size: 12px; }
.loading-isps { font-size: 11px; margin-inline-start: 4px; }
.gauge-wrap { padding: 12px 0; }
.mono-field :deep(input), .mono-field :deep(.ant-select-selection-item) { font-family: var(--pb-mono); }
</style>
