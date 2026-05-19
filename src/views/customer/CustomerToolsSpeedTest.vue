<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, Building2, Download, Gauge, Loader2, MapPin, Play, Server } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'
import CountryFlag from '../../components/CountryFlag.vue'
import SpeedGauge from '../../components/SpeedGauge.vue'

const { t } = useI18n()

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

const selectedProxy = computed(() => proxies.value.find((p) => p.id === proxyId.value) || null)

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
  } catch (e) { /* keep silent — ISP picker just won't have options */ }
  finally { ispsLoading.value = false }
}

watch(country, () => { isp.value = 'auto'; loadIsps() })

async function runTest() {
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

const speedColor = computed(() => {
  if (!result.value?.mbps) return 'var(--muted)'
  const m = result.value.mbps
  if (m >= 50) return 'var(--green)'
  if (m >= 10) return 'var(--yellow)'
  return 'var(--red)'
})

onMounted(async () => {
  await loadProxies()
  loadIsps()
})
</script>

<template>
  <h1>{{ t('cust.tools.speed.title') }}</h1>
  <p class="sub">{{ t('cust.tools.speed.subtitle') }}</p>

  <section class="surface" style="padding:18px; margin-bottom:14px">
    <div class="section-head">
      <h2><Gauge :size="14" /> {{ t('cust.tools.speed.inputHead') }}</h2>
    </div>

    <div v-if="!proxies.length" class="empty-text" style="text-align:left">
      {{ t('cust.tools.speed.noProxy') }}
    </div>

    <div v-else class="speed-form">
      <label class="field">
        <span>{{ t('cust.tools.speed.proxy') }}</span>
        <select v-model="proxyId">
          <option v-for="p in proxies" :key="p.id" :value="p.id">
            {{ p.type }} — {{ p.ip || p.bindIp }}:{{ p.port }} ({{ p.username }})
          </option>
        </select>
      </label>

      <label class="field">
        <span>{{ t('cust.tools.speed.country') }}</span>
        <select v-model="country">
          <option v-for="c in SUPPORTED_COUNTRIES" :key="c.code" :value="c.code">{{ c.name }}</option>
        </select>
      </label>

      <label class="field">
        <span>
          {{ t('cust.tools.speed.isp') }}
          <em v-if="ispsLoading" style="color:var(--muted); font-style:normal; font-size:11px">
            ({{ t('cust.tools.speed.loadingIsps') }})
          </em>
        </span>
        <select v-model="isp">
          <option value="auto">{{ t('cust.tools.speed.ispAuto') }}</option>
          <option v-for="i in isps" :key="i.sponsor" :value="i.sponsor.toLowerCase()">
            {{ i.sponsor }} ({{ i.serverCount }} server{{ i.serverCount > 1 ? 's' : '' }})
          </option>
        </select>
      </label>

      <button
        type="button"
        class="btn-run"
        :disabled="busy || !proxyId"
        @click="runTest"
      >
        <Loader2 v-if="busy" :size="14" class="spin" />
        <Play v-else :size="14" />
        {{ busy ? t('cust.tools.speed.running') : t('cust.tools.speed.run') }}
      </button>
    </div>

    <p v-if="err" class="error-text" style="margin-top:12px">{{ err }}</p>
    <p v-else class="hint-text">{{ t('cust.tools.speed.hint') }}</p>
  </section>

  <!-- Live gauge — visible during run + after result. Idle when neither. -->
  <section v-if="busy || result" class="surface" style="padding:24px; display:flex; flex-direction:column; align-items:center; gap:10px">
    <SpeedGauge
      :value="busy ? 0 : (result?.mbps || 0)"
      :max="null"
      :status="busy ? 'running' : (result?.ok ? 'done' : result ? 'error' : 'idle')"
      :label="busy ? t('cust.tools.speed.runningHint') : ''"
      :size="320"
    />
    <p v-if="busy" style="color:var(--muted); font-size:12.5px; margin:0">
      {{ t('cust.tools.speed.runningHint') }}
    </p>
  </section>

  <section v-if="result && !busy" class="surface" style="padding:18px">
    <div class="section-head">
      <h2><Activity :size="14" /> {{ t('cust.tools.speed.resultHead') }}</h2>
      <span :class="['status-pill', result.ok ? 'active' : 'expired']">
        {{ result.ok ? t('cust.tools.speed.success') : t('cust.tools.speed.failed') }}
      </span>
    </div>

    <div class="speed-stats-grid">
      <div class="stat-cell">
        <span class="lbl"><Server :size="12" /> {{ t('cust.tools.speed.server') }}</span>
        <span class="val">
          <Building2 :size="13" style="vertical-align:-2px; color:var(--blue)" />
          {{ result.server?.sponsor || '—' }}
        </span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><MapPin :size="12" /> {{ t('cust.tools.speed.location') }}</span>
        <span class="val">{{ result.server?.name || '—' }}, {{ result.server?.country || '—' }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.speed.endpoint') }}</span>
        <span class="cell-mono val">{{ result.server?.host }}:{{ result.server?.port }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><Download :size="12" /> {{ t('cust.tools.speed.totalBytes') }}</span>
        <span class="cell-mono val">{{ fmtBytes(result.totalBytes) }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.speed.duration') }}</span>
        <span class="cell-mono val">{{ (result.durationMs / 1000).toFixed(2) }} s</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.speed.ttfb') }}</span>
        <span class="cell-mono val">{{ result.ttfbMs ? `${result.ttfbMs} ms` : '—' }}</span>
      </div>
    </div>

    <div v-if="result.error" class="error-text" style="margin-top:12px">{{ result.error }}</div>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }

.speed-form {
  display: grid;
  grid-template-columns: 1fr 200px 200px auto;
  gap: 12px;
  align-items: end;
  margin-top: 12px;
}
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.field select {
  height: 38px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: var(--mono); font-size: 13px; outline: none;
}
.field select:focus { border-color: var(--green); }

.btn-run {
  height: 38px; padding: 0 18px;
  background: var(--green); color: #0a0e14;
  border: 1px solid var(--green); border-radius: var(--radius);
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  transition: filter 120ms, transform 80ms;
}
.btn-run:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.btn-run:active:not(:disabled) { transform: translateY(0); }
.btn-run:disabled { opacity: 0.55; cursor: not-allowed; }

.spin { animation: speed-spin 0.9s linear infinite; }
@keyframes speed-spin { to { transform: rotate(360deg); } }

.hint-text { color: var(--muted); font-size: 12px; margin-top: 10px; }

.speed-hero {
  text-align: center;
  padding: 30px 20px;
  margin: 14px 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.speed-main { display: inline-flex; align-items: baseline; gap: 8px; }
.speed-value {
  font-size: 64px;
  font-weight: 700;
  font-family: var(--mono);
  line-height: 1;
  letter-spacing: -0.03em;
}
.speed-unit { font-size: 20px; color: var(--muted); font-weight: 500; }
.speed-label {
  display: block;
  font-size: 11.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 8px;
}

.speed-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat-cell {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
}
.stat-cell .lbl {
  font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em;
  display: inline-flex; align-items: center; gap: 4px;
}
.stat-cell .val { font-size: 13px; color: var(--text); }

@media (max-width: 900px) {
  .speed-form { grid-template-columns: 1fr 1fr; }
  .speed-stats-grid { grid-template-columns: repeat(2, 1fr); }
  .speed-value { font-size: 48px; }
}
</style>
