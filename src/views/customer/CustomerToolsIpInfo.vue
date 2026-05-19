<script setup>
import { computed, ref } from 'vue'
import { Building2, Calendar, Globe, Hash, Layers, Loader2, MapPin, Network, Play } from 'lucide-vue-next'
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
  <h1>{{ t('cust.tools.ipInfo.title') }}</h1>
  <p class="sub">{{ t('cust.tools.ipInfo.subtitle') }}</p>

  <section class="surface" style="padding:18px; margin-bottom:14px">
    <div class="section-head">
      <h2><Network :size="14" /> {{ t('cust.tools.ipInfo.inputHead') }}</h2>
    </div>

    <div class="ii-input-row">
      <div class="ii-input-wrap">
        <input
          v-model="input"
          type="text"
          class="ii-input"
          :placeholder="t('cust.tools.ipInfo.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="runLookup"
        />
        <span v-if="detectedFamily === 4" class="family-badge fv4">IPv4</span>
        <span v-else-if="detectedFamily === 6" class="family-badge fv6">IPv6</span>
      </div>

      <button type="button" class="btn-paste" @click="pasteFromClipboard">{{ t('cust.tools.ipInfo.paste') }}</button>
      <button type="button" class="btn-run" :disabled="busy || !detectedFamily" @click="runLookup">
        <Loader2 v-if="busy" :size="14" class="spin" />
        <Play v-else :size="14" />
        {{ busy ? t('cust.tools.ipInfo.running') : t('cust.tools.ipInfo.run') }}
      </button>
    </div>

    <p v-if="err" class="error-text" style="margin-top:12px">{{ err }}</p>
    <p v-else class="hint-text">{{ t('cust.tools.ipInfo.hint') }}</p>
  </section>

  <section v-if="result && !result.error" class="surface" style="padding:18px">
    <div class="section-head">
      <h2><Globe :size="14" /> {{ t('cust.tools.ipInfo.resultHead') }}</h2>
    </div>

    <div class="ii-stats-grid">
      <div class="stat-cell">
        <span class="lbl"><Network :size="12" /> {{ t('cust.tools.ipInfo.ip') }}</span>
        <span class="cell-mono val">{{ result.ip }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ipInfo.family') }}</span>
        <span class="cell-mono val">{{ result.family.toUpperCase() }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><Hash :size="12" /> {{ t('cust.tools.ipInfo.asn') }}</span>
        <span class="cell-mono val">{{ result.asn || '—' }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><Layers :size="12" /> {{ t('cust.tools.ipInfo.cidr') }}</span>
        <span class="cell-mono val">{{ result.cidr || '—' }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><MapPin :size="12" /> {{ t('cust.tools.ipInfo.country') }}</span>
        <span class="val country-cell">
          <CountryFlag v-if="result.country && result.country.length === 2" :code="result.country" :size="16" />
          <span class="cell-mono">{{ result.country || '—' }}</span>
        </span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ipInfo.registry') }}</span>
        <span class="cell-mono val">{{ (result.registry || '—').toUpperCase() }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl"><Calendar :size="12" /> {{ t('cust.tools.ipInfo.allocDate') }}</span>
        <span class="cell-mono val">{{ result.allocDate || '—' }}</span>
      </div>
      <div class="stat-cell" style="grid-column: span 3">
        <span class="lbl"><Building2 :size="12" /> {{ t('cust.tools.ipInfo.org') }}</span>
        <span class="cell-mono val org-val">{{ result.org || '—' }}</span>
      </div>
    </div>
  </section>

  <section v-else-if="result?.error" class="surface" style="padding:18px">
    <p class="error-text">{{ result.error }}</p>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }

.ii-input-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.ii-input-wrap { position: relative; flex: 1; min-width: 260px; }
.ii-input {
  width: 100%; height: 38px; padding: 0 60px 0 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: var(--mono); font-size: 13px; outline: none;
}
.ii-input:focus { border-color: var(--green); }
.family-badge {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  height: 22px; padding: 0 8px; border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 600; font-family: var(--mono); display: inline-flex; align-items: center;
}
.family-badge.fv4 { background: var(--green-soft); color: var(--green); }
.family-badge.fv6 { background: var(--blue-soft); color: var(--blue); }

.btn-paste, .btn-run {
  height: 38px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg); color: var(--text); font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-paste:hover { border-color: var(--muted); }
.btn-run { background: var(--green); border-color: var(--green); color: #0a0e14; font-weight: 600; }
.btn-run:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-run:not(:disabled):hover { filter: brightness(1.08); }

.spin { animation: ii-spin 0.9s linear infinite; }
@keyframes ii-spin { to { transform: rotate(360deg); } }

.hint-text { color: var(--muted); font-size: 12px; margin-top: 10px; }

.ii-stats-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px;
}
.stat-cell {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
}
.stat-cell .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 4px; }
.stat-cell .val { font-size: 14px; color: var(--text); }
.country-cell { display: inline-flex; align-items: center; gap: 8px; }
.org-val { font-size: 13px; word-break: break-word; }

@media (max-width: 720px) { .ii-stats-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
