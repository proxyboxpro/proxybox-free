<script setup>
import { computed, ref } from 'vue'
import { AlertTriangle, CheckCircle2, Loader2, Play, ShieldAlert, ShieldCheck, XCircle } from 'lucide-vue-next'
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

const summaryClass = computed(() => {
  if (!result.value) return ''
  if (result.value.listed > 0) return 'sum-bad'
  if (result.value.errors === result.value.total) return 'sum-warn'
  return 'sum-good'
})
</script>

<template>
  <h1>{{ t('cust.tools.blacklist.title') }}</h1>
  <p class="sub">{{ t('cust.tools.blacklist.subtitle') }}</p>

  <section class="surface" style="padding:18px; margin-bottom:14px">
    <div class="section-head">
      <h2><ShieldAlert :size="14" /> {{ t('cust.tools.blacklist.inputHead') }}</h2>
    </div>

    <div class="bl-input-row">
      <div class="bl-input-wrap">
        <input
          v-model="input"
          type="text"
          class="bl-input"
          :placeholder="t('cust.tools.blacklist.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="runCheck"
        />
        <span v-if="isIpv4" class="family-badge ok">IPv4</span>
        <span v-else-if="trimmed" class="family-badge bad">{{ t('cust.tools.blacklist.v4only') }}</span>
      </div>
      <button type="button" class="btn-paste" @click="pasteFromClipboard">{{ t('cust.tools.blacklist.paste') }}</button>
      <button type="button" class="btn-run" :disabled="busy || !isIpv4" @click="runCheck">
        <Loader2 v-if="busy" :size="14" class="spin" />
        <Play v-else :size="14" />
        {{ busy ? t('cust.tools.blacklist.running') : t('cust.tools.blacklist.run') }}
      </button>
    </div>

    <p v-if="err" class="error-text" style="margin-top:12px">{{ err }}</p>
    <p v-else class="hint-text">{{ t('cust.tools.blacklist.hint') }}</p>
  </section>

  <section v-if="result && !result.error" class="surface" style="padding:18px">
    <div class="section-head">
      <h2>
        <ShieldCheck v-if="result.listed === 0" :size="14" style="color:var(--green)" />
        <AlertTriangle v-else :size="14" style="color:var(--red)" />
        {{ t('cust.tools.blacklist.resultHead') }}
      </h2>
      <span class="cell-mono">{{ result.ip }}</span>
    </div>

    <div :class="['bl-summary', summaryClass]">
      <div class="sum-stat">
        <span class="num">{{ result.total }}</span>
        <span class="lbl">{{ t('cust.tools.blacklist.checked') }}</span>
      </div>
      <div class="sum-stat clean">
        <span class="num">{{ result.clean }}</span>
        <span class="lbl">{{ t('cust.tools.blacklist.clean') }}</span>
      </div>
      <div class="sum-stat listed">
        <span class="num">{{ result.listed }}</span>
        <span class="lbl">{{ t('cust.tools.blacklist.listed') }}</span>
      </div>
      <div class="sum-stat errored">
        <span class="num">{{ result.errors }}</span>
        <span class="lbl">{{ t('cust.tools.blacklist.errors') }}</span>
      </div>
    </div>

    <div class="bl-list">
      <div v-for="r in result.results" :key="r.host" class="bl-row" :class="r.listed === true ? 'is-listed' : r.listed === false ? 'is-clean' : 'is-error'">
        <span class="bl-status">
          <XCircle v-if="r.listed === true" :size="16" />
          <CheckCircle2 v-else-if="r.listed === false" :size="16" />
          <AlertTriangle v-else :size="16" />
        </span>
        <div class="bl-meta">
          <strong>{{ r.name }}</strong>
          <span class="cell-mono">{{ r.host }}</span>
        </div>
        <span class="bl-tag">
          <template v-if="r.listed === true">{{ t('cust.tools.blacklist.tagListed') }}</template>
          <template v-else-if="r.listed === false">{{ t('cust.tools.blacklist.tagClean') }}</template>
          <template v-else>{{ t('cust.tools.blacklist.tagError') }}</template>
        </span>
        <span class="bl-detail cell-mono">
          {{ r.response || r.error || '' }} <em>{{ r.latencyMs }}ms</em>
        </span>
      </div>
    </div>
  </section>

  <section v-else-if="result?.error" class="surface" style="padding:18px">
    <p class="error-text">{{ result.error }}</p>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }

.bl-input-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.bl-input-wrap { position: relative; flex: 1; min-width: 260px; }
.bl-input {
  width: 100%; height: 38px; padding: 0 80px 0 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: var(--mono); font-size: 13px; outline: none;
}
.bl-input:focus { border-color: var(--green); }
.family-badge {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  height: 22px; padding: 0 8px; border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 600; font-family: var(--mono); display: inline-flex; align-items: center;
}
.family-badge.ok { background: var(--green-soft); color: var(--green); }
.family-badge.bad { background: var(--red-soft); color: var(--red); }

.btn-paste, .btn-run {
  height: 38px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg); color: var(--text); font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-paste:hover { border-color: var(--muted); }
.btn-run { background: var(--green); border-color: var(--green); color: #0a0e14; font-weight: 600; }
.btn-run:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-run:not(:disabled):hover { filter: brightness(1.08); }

.spin { animation: bl-spin 0.9s linear infinite; }
@keyframes bl-spin { to { transform: rotate(360deg); } }

.hint-text { color: var(--muted); font-size: 12px; margin-top: 10px; }

.bl-summary {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 16px;
  padding: 14px; border-radius: var(--radius);
  background: var(--bg); border: 1px solid var(--border);
}
.bl-summary.sum-bad { border-color: var(--red); background: var(--red-soft); }
.bl-summary.sum-good { border-color: var(--green); background: var(--green-soft); }
.bl-summary.sum-warn { border-color: var(--yellow); background: var(--yellow-soft); }
.sum-stat { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.sum-stat .num { font-size: 24px; font-weight: 700; color: var(--text); font-family: var(--mono); }
.sum-stat .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.sum-stat.clean .num { color: var(--green); }
.sum-stat.listed .num { color: var(--red); }
.sum-stat.errored .num { color: var(--yellow); }

.bl-list { display: flex; flex-direction: column; gap: 6px; }
.bl-row {
  display: grid;
  grid-template-columns: 20px 1fr 90px 1fr;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 12px;
}
.bl-row.is-listed { border-color: var(--red); }
.bl-row.is-listed .bl-status { color: var(--red); }
.bl-row.is-clean .bl-status { color: var(--green); }
.bl-row.is-error  { border-color: var(--yellow); }
.bl-row.is-error  .bl-status { color: var(--yellow); }
.bl-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bl-meta strong { font-size: 13px; color: var(--text); }
.bl-meta .cell-mono { font-size: 11px; color: var(--muted); }
.bl-tag {
  font-family: var(--mono); font-size: 11px; font-weight: 600;
  padding: 3px 8px; border-radius: var(--radius-sm); text-align: center;
}
.bl-row.is-listed .bl-tag { background: var(--red); color: #fff; }
.bl-row.is-clean .bl-tag  { background: var(--green-soft); color: var(--green); }
.bl-row.is-error .bl-tag  { background: var(--yellow-soft); color: var(--yellow); }
.bl-detail { color: var(--muted); font-size: 11px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bl-detail em { font-style: normal; color: var(--muted); }

@media (max-width: 720px) {
  .bl-summary { grid-template-columns: repeat(2, 1fr); }
  .bl-row { grid-template-columns: 18px 1fr 70px; }
  .bl-detail { display: none; }
}
</style>
