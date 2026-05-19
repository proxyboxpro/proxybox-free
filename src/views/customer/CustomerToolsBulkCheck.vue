<script setup>
import { computed, ref } from 'vue'
import { CheckCircle2, Download, Filter, Layers, Loader2, Play, XCircle } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'

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
  const lines = result.value.results.filter((r) => r.ok).map((r) => r.line).join('\n')
  navigator.clipboard.writeText(lines)
}
</script>

<template>
  <h1>{{ t('cust.tools.bulk.title') }}</h1>
  <p class="sub">{{ t('cust.tools.bulk.subtitle') }}</p>

  <section class="surface" style="padding:18px; margin-bottom:14px">
    <div class="section-head">
      <h2><Layers :size="14" /> {{ t('cust.tools.bulk.inputHead') }}</h2>
      <span class="line-count" :class="{ over: tooMany }">{{ lineCount }} / 50</span>
    </div>

    <textarea
      v-model="inputText"
      class="bulk-textarea"
      :placeholder="t('cust.tools.bulk.placeholder')"
      spellcheck="false"
      rows="10"
    />

    <div class="bulk-actions">
      <button type="button" class="btn-paste" @click="pasteFromClipboard">{{ t('cust.tools.bulk.paste') }}</button>
      <button type="button" class="btn-paste" @click="clearAll">{{ t('cust.tools.bulk.clear') }}</button>
      <div style="flex:1"></div>
      <button type="button" class="btn-run" :disabled="busy || lineCount === 0 || tooMany" @click="runCheck">
        <Loader2 v-if="busy" :size="14" class="spin" />
        <Play v-else :size="14" />
        {{ busy ? t('cust.tools.bulk.running') : t('cust.tools.bulk.run') }}
      </button>
    </div>

    <p v-if="err" class="error-text" style="margin-top:12px">{{ err }}</p>
    <p v-else class="hint-text">{{ t('cust.tools.bulk.hint') }}</p>
  </section>

  <section v-if="result" class="surface" style="padding:18px">
    <div class="section-head">
      <h2>{{ t('cust.tools.bulk.resultHead') }}</h2>
      <div class="bulk-export-row">
        <button type="button" class="btn-export" @click="copyWorkingLines">
          {{ t('cust.tools.bulk.copyWorking') }}
        </button>
        <button type="button" class="btn-export" @click="exportCsv(true)">
          <Download :size="12" /> {{ t('cust.tools.bulk.exportWorking') }}
        </button>
        <button type="button" class="btn-export" @click="exportCsv(false)">
          <Download :size="12" /> {{ t('cust.tools.bulk.exportAll') }}
        </button>
      </div>
    </div>

    <div class="bulk-kpi">
      <div class="kpi total">
        <span class="num">{{ result.total }}</span>
        <span class="lbl">{{ t('cust.tools.bulk.kpiTotal') }}</span>
      </div>
      <div class="kpi ok">
        <span class="num">{{ result.ok }}</span>
        <span class="lbl">{{ t('cust.tools.bulk.kpiOk') }}</span>
      </div>
      <div class="kpi fail">
        <span class="num">{{ result.fail }}</span>
        <span class="lbl">{{ t('cust.tools.bulk.kpiFail') }}</span>
      </div>
      <div class="kpi rate">
        <span class="num">{{ result.total ? Math.round(result.ok / result.total * 100) : 0 }}%</span>
        <span class="lbl">{{ t('cust.tools.bulk.kpiRate') }}</span>
      </div>
    </div>

    <div class="bulk-filter-row">
      <select v-model="filterStatus" class="bulk-select">
        <option value="all">{{ t('cust.tools.bulk.filterAll') }}</option>
        <option value="ok">{{ t('cust.tools.bulk.filterOk') }}</option>
        <option value="fail">{{ t('cust.tools.bulk.filterFail') }}</option>
      </select>
      <input v-model="search" type="text" class="bulk-search" :placeholder="t('cust.tools.bulk.searchPh')" />
    </div>

    <div class="bulk-table">
      <div class="bulk-th">
        <span>#</span>
        <span>{{ t('cust.tools.bulk.colLine') }}</span>
        <span>{{ t('cust.tools.bulk.colStatus') }}</span>
        <span>{{ t('cust.tools.bulk.colLatency') }}</span>
        <span>{{ t('cust.tools.bulk.colExit') }}</span>
        <span>{{ t('cust.tools.bulk.colError') }}</span>
      </div>
      <div v-for="r in filtered" :key="r.idx" class="bulk-tr" :class="{ ok: r.ok }">
        <span class="cell-mono idx">{{ r.idx + 1 }}</span>
        <span class="cell-mono line">{{ r.line }}</span>
        <span class="status">
          <CheckCircle2 v-if="r.ok" :size="14" />
          <XCircle v-else :size="14" />
          {{ r.ok ? t('cust.tools.bulk.tagOk') : t('cust.tools.bulk.tagFail') }}
        </span>
        <span class="cell-mono">{{ r.latencyMs ?? '—' }} ms</span>
        <span class="cell-mono">{{ r.exitIp || '—' }}</span>
        <span class="cell-mono err">{{ r.error || '' }}</span>
      </div>
      <p v-if="!filtered.length" class="empty">{{ t('cust.tools.bulk.noMatch') }}</p>
    </div>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }
.line-count { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.line-count.over { color: var(--red); }

.bulk-textarea {
  width: 100%;
  min-height: 200px;
  margin-top: 12px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.bulk-textarea:focus { border-color: var(--green); }

.bulk-actions { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.btn-paste, .btn-run, .btn-export {
  height: 36px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg); color: var(--text); font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-paste:hover, .btn-export:hover { border-color: var(--muted); }
.btn-run { background: var(--green); border-color: var(--green); color: #0a0e14; font-weight: 600; }
.btn-run:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-run:not(:disabled):hover { filter: brightness(1.08); }
.btn-export { height: 30px; padding: 0 10px; font-size: 12px; }

.spin { animation: bulk-spin 0.9s linear infinite; }
@keyframes bulk-spin { to { transform: rotate(360deg); } }

.hint-text { color: var(--muted); font-size: 12px; margin-top: 10px; }

.bulk-export-row { display: flex; gap: 8px; }

.bulk-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
.kpi {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; display: flex; flex-direction: column; gap: 4px;
}
.kpi .num { font-size: 22px; font-weight: 700; color: var(--text); font-family: var(--mono); }
.kpi .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kpi.ok .num { color: var(--green); }
.kpi.fail .num { color: var(--red); }
.kpi.rate .num { color: var(--blue); }

.bulk-filter-row { display: flex; gap: 10px; margin-bottom: 10px; }
.bulk-select, .bulk-search {
  height: 34px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 13px; outline: none;
}
.bulk-search { flex: 1; font-family: var(--mono); }
.bulk-select:focus, .bulk-search:focus { border-color: var(--green); }

.bulk-table { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.bulk-th, .bulk-tr {
  display: grid;
  grid-template-columns: 50px 2fr 110px 90px 140px 1.5fr;
  gap: 12px;
  padding: 10px 12px;
  align-items: center;
  font-size: 12px;
}
.bulk-th {
  background: var(--border-soft); color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; font-weight: 600;
}
.bulk-tr { border-top: 1px solid var(--border-soft); }
.bulk-tr.ok { background: rgba(63,185,80,0.04); }
.bulk-tr .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bulk-tr .status { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--red); }
.bulk-tr.ok .status { color: var(--green); }
.bulk-tr .err { color: var(--red); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bulk-table .empty { text-align: center; color: var(--muted); padding: 24px; font-size: 13px; margin: 0; }

@media (max-width: 900px) {
  .bulk-th, .bulk-tr { grid-template-columns: 30px 2fr 80px 70px; }
  .bulk-th > span:nth-child(n+5), .bulk-tr > span:nth-child(n+5) { display: none; }
}
</style>
