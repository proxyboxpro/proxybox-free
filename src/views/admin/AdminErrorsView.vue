<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronUp, Filter, Info, RefreshCw, Trash2 } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const data = ref({ errors: [], counters: { unresolved: 0, bySource: {}, byLevel: {} } })
const err = ref('')
const loading = ref(false)
const filterSource = ref('')
const filterLevel = ref('')
const filterResolved = ref('0')
const autoRefresh = ref(true)
const expanded = ref(new Set())
let timer = null

async function refresh() {
  loading.value = true; err.value = ''
  try {
    const qs = new URLSearchParams()
    if (filterSource.value) qs.set('source', filterSource.value)
    if (filterLevel.value) qs.set('level', filterLevel.value)
    if (filterResolved.value !== '') qs.set('resolved', filterResolved.value)
    qs.set('limit', '300')
    data.value = await apiFetch(`/api/admin/errors?${qs}`)
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function resolveOne(id) {
  try { await apiFetch(`/api/admin/errors/${id}/resolve`, { method: 'POST' }); refresh() }
  catch (e) { err.value = e.message }
}
async function resolveAll() {
  if (!confirm(t('admin.errors.confirmResAll'))) return
  try { await apiFetch('/api/admin/errors/resolve-all', { method: 'POST' }); refresh() }
  catch (e) { err.value = e.message }
}

function fmtAgo(ms) {
  if (!ms) return '—'
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
function levelIcon(l) { return l === 'error' ? AlertCircle : l === 'warn' ? AlertTriangle : Info }
function toggleRow(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
}

const counters = computed(() => data.value?.counters || {})
const errors = computed(() => data.value?.errors || [])
const SOURCES = ['', 'panel', 'agent', 'sweep', 'watchdog', 'auto-heal', 'mtls', 'client']
const LEVELS = ['', 'error', 'warn', 'info']

onMounted(() => {
  refresh()
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 20_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">
        <AlertCircle :size="14" style="vertical-align:-2px" />
        {{ t('admin.errors.eyebrowSuffix') }} · {{ formatNumber(counters.unresolved || 0) }} {{ t('admin.errors.openCount') }}
      </span>
      <div class="spacer"></div>
      <label class="filter-field" style="width:auto; margin-right:8px">
        <input v-model="autoRefresh" type="checkbox" /> {{ t('admin.errors.autoRefresh') }}
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="12" :class="{ spin: loading }" /> {{ t('admin.errors.refresh') }}
      </button>
      <button class="ghost-button" type="button" style="margin-left:6px" :disabled="!counters.unresolved" @click="resolveAll">
        <Check :size="12" /> {{ t('admin.errors.resolveAll') }}
      </button>
    </div>

    <p class="hint-text">
      {{ t('admin.errors.intro') }}
    </p>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- KPI strip -->
    <div class="metric-cards">
      <article>
        <AlertCircle :size="20" />
        <span>{{ t('admin.errors.kpiTotal') }}</span>
        <strong :style="{ color: counters.unresolved > 0 ? 'var(--red)' : 'var(--muted)' }">{{ formatNumber(counters.unresolved || 0) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.errors.kpiTotalSub') }}</small>
      </article>
      <article v-for="src in ['agent','sweep','watchdog','auto-heal','panel']" :key="src">
        <Info :size="20" />
        <span>{{ src }}</span>
        <strong>{{ formatNumber(counters.bySource?.[src] || 0) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.errors.kpiSourceSub') }}</small>
      </article>
    </div>

    <!-- Filter bar -->
    <section class="surface">
      <div class="ord-filters">
        <div class="filter-row">
          <label class="filter-field">
            <span>{{ t('admin.errors.filterSource') }}</span>
            <select v-model="filterSource" @change="refresh">
              <option v-for="s in SOURCES" :key="s" :value="s">{{ s || t('admin.errors.filterAll') }}</option>
            </select>
          </label>
          <label class="filter-field">
            <span>{{ t('admin.errors.filterLevel') }}</span>
            <select v-model="filterLevel" @change="refresh">
              <option v-for="l in LEVELS" :key="l" :value="l">{{ l || t('admin.errors.filterAll') }}</option>
            </select>
          </label>
          <label class="filter-field">
            <span>{{ t('admin.errors.filterStatus') }}</span>
            <select v-model="filterResolved" @change="refresh">
              <option value="0">{{ t('admin.errors.statusOpen') }}</option>
              <option value="1">{{ t('admin.errors.statusResolved') }}</option>
              <option value="">{{ t('admin.errors.statusAll') }}</option>
            </select>
          </label>
        </div>
      </div>
    </section>

    <!-- Errors table -->
    <section class="surface">
      <div class="section-head">
        <h2>{{ t('admin.errors.tableTitle', { n: errors.length }) }}</h2>
        <span style="color:var(--muted); font-size:12px">{{ t('admin.errors.tableNote') }}</span>
      </div>
      <p v-if="!errors.length" class="empty-text">{{ t('admin.errors.empty') }}</p>
      <div v-if="errors.length" class="data-table err-table">
        <div class="table-head">
          <span style="text-align:right">#</span>
          <span>{{ t('admin.errors.colWhen') }}</span>
          <span>{{ t('admin.errors.colSource') }}</span>
          <span>{{ t('admin.errors.colMessage') }}</span>
          <span style="text-align:right">{{ t('admin.errors.colRepeat') }}</span>
          <span style="text-align:right">{{ t('admin.errors.colAction') }}</span>
        </div>
        <template v-for="(e, i) in errors" :key="e.id">
          <div class="table-row" :class="['row-' + e.level, { open: expanded.has(e.id) }]" @click="toggleRow(e.id)">
            <span style="text-align:right; color:var(--muted); font-family:var(--mono); font-size:11px">{{ i + 1 }}</span>
            <span>
              <span style="font-family:var(--mono); font-size:12px">{{ fmtAgo(e.last_ts) }}</span>
              <small v-if="e.count > 1" style="display:block; color:var(--muted); font-size:10.5px">{{ t('admin.errors.firstSeen', { ago: fmtAgo(e.first_ts) }) }}</small>
            </span>
            <span>
              <span :class="['status-pill', e.level === 'error' ? 'error' : e.level === 'warn' ? 'pending' : 'active']">{{ e.level }}</span>
              <small style="display:block; color:var(--muted); font-size:11px">{{ e.source }}<template v-if="e.code"> · <span class="cell-mono">{{ e.code }}</span></template></small>
            </span>
            <span style="overflow:hidden; min-width:0">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block">{{ e.message || '—' }}</span>
              <small v-if="e.nodeId || e.proxyId" class="cell-mono" style="display:block; color:var(--muted); font-size:10.5px">
                <template v-if="e.nodeId">node={{ e.nodeId }}</template>
                <template v-if="e.proxyId"> · proxy={{ e.proxyId }}</template>
              </small>
            </span>
            <span style="text-align:right">
              <strong v-if="e.count > 1" style="color: var(--yellow); font-family:var(--mono)">×{{ e.count }}</strong>
              <span v-else style="color: var(--muted)">1</span>
            </span>
            <span style="text-align:right">
              <button v-if="!e.resolved" class="ghost-button" type="button" style="padding:3px 8px; font-size:11.5px" @click.stop="resolveOne(e.id)">
                <Check :size="11" /> {{ t('admin.errors.btnResolve') }}
              </button>
              <span v-else class="status-pill active">{{ t('admin.errors.resolvedTag') }}</span>
              <component :is="expanded.has(e.id) ? ChevronUp : ChevronDown" :size="12" style="vertical-align:-2px; margin-left:6px; color:var(--muted)" />
            </span>
          </div>
          <div v-if="expanded.has(e.id)" class="err-detail" @click.stop>
            <div class="err-detail-grid">
              <span class="lbl">id</span><span class="cell-mono">{{ e.id }}</span>
              <span class="lbl">first_ts</span><span class="cell-mono">{{ new Date(e.first_ts).toISOString() }}</span>
              <span class="lbl">last_ts</span><span class="cell-mono">{{ new Date(e.last_ts).toISOString() }}</span>
              <template v-if="e.resolvedAt">
                <span class="lbl">resolved_at</span><span class="cell-mono">{{ t('admin.errors.resolvedBy', { ts: new Date(e.resolvedAt).toISOString(), who: e.resolvedBy }) }}</span>
              </template>
            </div>
            <pre v-if="e.context" class="err-context">{{ typeof e.context === 'string' ? e.context : JSON.stringify(e.context, null, 2) }}</pre>
          </div>
        </template>
      </div>
    </section>
  </section>
</template>

<style scoped>
.hint-text { font-size: 12.5px; color: var(--muted); margin: -2px 0 4px; line-height: 1.5; max-width: 900px; }
.spin { animation: espin 0.9s linear infinite; }
@keyframes espin { to { transform: rotate(360deg); } }
.err-table .table-head, .err-table .table-row { grid-template-columns: 36px 0.7fr 1fr 1.8fr 0.5fr 0.9fr; }
.err-table .table-row { cursor: pointer; }
.err-table .table-row.row-error { background: rgba(248, 81, 73, 0.04); }
.err-table .table-row.row-warn { background: rgba(245, 158, 11, 0.03); }
.err-table .table-row.open { background: rgba(255,255,255,0.025); }
.err-detail { padding: 12px 16px 14px 50px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.015); }
.err-detail-grid { display: grid; grid-template-columns: 100px 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 10px; }
.err-detail-grid .lbl { color: var(--muted); font-size: 11px; }
.err-context { font-family: var(--mono); font-size: 11.5px; background: rgba(0,0,0,0.4); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border); overflow-x: auto; max-height: 240px; margin: 0; color: var(--text); white-space: pre-wrap; word-break: break-all; }
@media (max-width: 900px) {
  .err-table .table-head, .err-table .table-row { grid-template-columns: 28px 0.8fr 1fr 1.5fr 0.5fr 0.8fr; gap: 8px; padding: 8px 10px; }
  .err-detail { padding: 12px; }
}
</style>
