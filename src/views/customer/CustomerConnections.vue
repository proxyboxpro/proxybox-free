<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, ArrowDown, ArrowUp, BarChart3, RefreshCw, Search } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
}
function fmtDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false })
}

const proxies = ref([])
const EMPTY_WIN = { up: 0, down: 0 }
const summary = ref({ proxies: 0, active: 0, total: 0, uploadBytes: 0, downloadBytes: 0, monthBytes: 0, topTargets: [], windows: { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN } })
const windows = computed(() => summary.value?.windows || { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN })
const windowCards = computed(() => {
  const w = windows.value
  return [
    { key: 'h1',  label: t('cust.usage.win1h'),  up: w.h1?.up || 0,  down: w.h1?.down || 0 },
    { key: 'h24', label: t('cust.usage.win24h'), up: w.h24?.up || 0, down: w.h24?.down || 0 },
    { key: 'd30', label: t('cust.usage.win30d'), up: w.d30?.up || 0, down: w.d30?.down || 0 }
  ]
})
const sessions = ref([])
const sessionsHours = ref(1)
const sessionFilters = ref({ host: '', proxyId: '', kind: '' })
const sessionsTotal = ref(0)
const sessionsPage = ref(0)
const sessionsPageSize = ref(50)
const err = ref('')
const loading = ref(false)
let timer = null

async function loadSummary() {
  try { summary.value = await apiFetch('/api/v1/user/proxies/connections/summary') }
  catch (e) { err.value = e.message }
}
async function loadProxies() {
  try {
    const list = await apiFetch('/api/v1/user/proxies')
    proxies.value = (Array.isArray(list) ? list : list?.items || []).filter((p) => p.status !== 'expired')
  } catch (e) { err.value = e.message }
}
async function loadSessions() {
  loading.value = true
  try {
    const f = sessionFilters.value
    const qs = [`hours=${sessionsHours.value}`, `limit=${sessionsPageSize.value}`, `offset=${sessionsPage.value * sessionsPageSize.value}`]
    if (f.host)    qs.push(`host=${encodeURIComponent(f.host)}`)
    if (f.proxyId) qs.push(`proxyId=${encodeURIComponent(f.proxyId)}`)
    if (f.kind)    qs.push(`kind=${encodeURIComponent(f.kind)}`)
    const data = await apiFetch(`/api/v1/user/proxies/sessions?${qs.join('&')}`)
    sessions.value = data?.sessions || []
    sessionsTotal.value = data?.total || 0
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadProxies(), loadSessions()])
}

onMounted(() => {
  refreshAll()
  timer = setInterval(() => { loadSummary(); loadSessions() }, 10_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow"><Activity :size="14" style="vertical-align:-2px" /> {{ t('cust.conn.live') }} · {{ proxies.length }} proxy</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" :disabled="loading" @click="refreshAll">
        <RefreshCw :size="12" /> refresh
      </button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- Aggregate KPI strip -->
    <div class="metric-cards">
      <article>
        <Activity :size="20" />
        <span>{{ t('cust.conn.openConns') }}</span>
        <strong style="color:var(--green)">{{ formatNumber(summary.active || 0) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ formatNumber(summary.total || 0) }} all-time</small>
      </article>
      <article>
        <span>{{ t('cust.conn.bw24h') }}</span>
        <strong style="font-size:18px">{{ formatBytes((windows.h24.up || 0) + (windows.h24.down || 0)) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">↑ {{ formatBytes(windows.h24.up || 0) }} · ↓ {{ formatBytes(windows.h24.down || 0) }}</small>
      </article>
      <article>
        <span>{{ t('cust.conn.bwMonth') }}</span>
        <strong style="font-size:18px">{{ formatBytes((windows.d30.up || 0) + (windows.d30.down || 0)) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">↑ {{ formatBytes(windows.d30.up || 0) }} · ↓ {{ formatBytes(windows.d30.down || 0) }}</small>
      </article>
      <article>
        <span>{{ t('cust.conn.topDest') }}</span>
        <strong>{{ summary.topTargets?.length || 0 }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('cust.conn.uniqueHosts') }}</small>
      </article>
    </div>

    <!-- Accurate cumulative transferred volume over 1h / 24h / 30d -->
    <section class="surface cc-windows-wrap">
      <div class="cc-windows-head">
        <span class="cc-section-title"><BarChart3 :size="14" /> {{ t('cust.usage.windowsTitle') }}</span>
        <span class="cc-windows-hint">{{ t('cust.usage.windowsHint') }}</span>
      </div>
      <div class="cc-windows">
        <article v-for="w in windowCards" :key="w.key" class="cc-win-card">
          <span class="cc-win-label">{{ w.label }}</span>
          <strong class="cc-win-total mono">{{ formatBytes(w.up + w.down) }}</strong>
          <div class="cc-win-split">
            <span class="mono" style="color:#4ade80"><ArrowUp :size="12" style="vertical-align:-2px" /> {{ formatBytes(w.up) }}</span>
            <span class="mono" style="color:#60a5fa"><ArrowDown :size="12" style="vertical-align:-2px" /> {{ formatBytes(w.down) }}</span>
          </div>
        </article>
      </div>
    </section>

    <!-- Sessions table -->
    <section class="surface cc-sessions">
      <!-- Toolbar: time range + filters in one row -->
      <div class="cc-toolbar">
        <div class="cc-toolbar-left">
          <span class="cc-section-title"><Activity :size="14" /> {{ t('cust.conn.live') }}</span>
          <span class="cc-count-chip">{{ sessions.length }} {{ t('cust.conn.shown') }} · {{ sessionsTotal.toLocaleString() }} {{ t('cust.conn.total') }}</span>
        </div>
        <div class="cc-toolbar-right">
          <div class="cc-range-pills">
            <button v-for="r in [{l:'1h',v:1},{l:'6h',v:6},{l:'24h',v:24},{l:'7d',v:168},{l:'30d',v:720}]"
                    :key="r.v" type="button" :class="{ active: sessionsHours === r.v }"
                    @click="sessionsHours = r.v; sessionsPage = 0; loadSessions()">{{ r.l }}</button>
          </div>
        </div>
      </div>

      <div class="cc-filter-bar">
        <div class="cc-filter-search">
          <Search :size="14" />
          <input v-model="sessionFilters.host" type="search" :placeholder="t('cust.conn.filterHost')" @input="loadSessions" />
        </div>
        <select v-model="sessionFilters.proxyId" class="cc-select" @change="loadSessions">
          <option value="">{{ t('cust.conn.allProxies') }}</option>
          <option v-for="p in proxies" :key="p.id" :value="p.id">{{ p.ip || p.bindIp }}:{{ p.port }}</option>
        </select>
        <select v-model="sessionFilters.kind" class="cc-select" @change="loadSessions">
          <option value="">{{ t('cust.conn.allProtocols') }}</option>
          <option value="http">HTTP</option>
          <option value="connect">HTTPS (CONNECT)</option>
          <option value="socks5">SOCKS5</option>
        </select>
      </div>

      <p v-if="!sessions.length && !loading" class="cc-empty">
        <Activity :size="20" style="opacity:0.4" />
        <span>{{ t('cust.conn.empty') }}</span>
      </p>

      <div v-if="sessions.length" class="cc-table">
        <div class="cc-table-head">
          <span>{{ t('cust.conn.colProxy') }}</span>
          <span>{{ t('cust.conn.colDest') }}</span>
          <span>{{ t('cust.conn.colProtocol') }}</span>
          <span class="right">{{ t('cust.conn.colPort') }}</span>
          <span class="right">{{ t('cust.conn.colBytes') }}</span>
          <span class="right">{{ t('cust.conn.colDuration') }}</span>
          <span class="right">{{ t('cust.conn.colTime') }}</span>
        </div>
        <div v-for="s in sessions" :key="s.id" class="cc-table-row">
          <span class="mono">{{ s.proxyBindIp }}:{{ s.proxyPort }}</span>
          <span>
            <span class="dst-line">
              <span v-if="s.hostGeo?.cc" :title="s.hostGeo.country" class="flag">{{ ccToFlag(s.hostGeo.cc) }}</span>
              <span class="mono dst-host">{{ s.host }}</span>
            </span>
            <span v-if="s.hostIp" class="mono dst-ip">{{ s.hostIp }}</span>
          </span>
          <span><span :class="['kind-pill', s.kind]">{{ s.kind }}</span></span>
          <span class="right mono">{{ s.port }}</span>
          <span class="right mono bytes">{{ formatBytes((s.up || 0) + (s.down || 0)) }}</span>
          <span class="right mono muted">{{ fmtDuration(s.ms) }}</span>
          <span class="right time-cell">{{ fmtTime(s.ts) }}</span>
        </div>
      </div>

      <div v-if="sessionsTotal > 0" class="cc-pager">
        <span class="cc-pager-info">{{ t('cust.conn.page') }} <strong>{{ sessionsPage + 1 }}</strong> / {{ Math.max(1, Math.ceil(sessionsTotal / sessionsPageSize)) }}</span>
        <div class="cc-pager-spacer"></div>
        <span class="cc-pager-info" style="margin-right:6px">{{ t('cust.conn.perPage') }}</span>
        <select v-model.number="sessionsPageSize" class="cc-select cc-select-sm" @change="sessionsPage = 0; loadSessions()">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
        </select>
        <button class="cc-pager-btn" :disabled="sessionsPage === 0" @click="sessionsPage = 0; loadSessions()">«</button>
        <button class="cc-pager-btn" :disabled="sessionsPage === 0" @click="sessionsPage = Math.max(0, sessionsPage - 1); loadSessions()">‹</button>
        <button class="cc-pager-btn" :disabled="(sessionsPage + 1) * sessionsPageSize >= sessionsTotal" @click="sessionsPage = sessionsPage + 1; loadSessions()">›</button>
        <button class="cc-pager-btn" :disabled="(sessionsPage + 1) * sessionsPageSize >= sessionsTotal" @click="sessionsPage = Math.max(0, Math.ceil(sessionsTotal / sessionsPageSize) - 1); loadSessions()">»</button>
      </div>
    </section>

  </section>
</template>

<style scoped>
/* KPI strip — denser, with subtle accent line on top */
.cc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.cc-kpis .kpi {
  position: relative; padding: 14px 16px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--surface);
  display: flex; flex-direction: column; gap: 4px; overflow: hidden;
}
.cc-kpis .kpi::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--green); opacity: 0.6;
}
.cc-kpis .kpi.kpi-blue::before  { background: #3b82f6; }
.cc-kpis .kpi.kpi-purple::before { background: #8b5cf6; }
.cc-kpis .kpi.kpi-amber::before { background: #f59e0b; }
.cc-kpis .kpi .kpi-label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; display: flex; align-items: center; gap: 5px; }
.cc-kpis .kpi .kpi-value { font-size: 22px; font-weight: 600; line-height: 1.2; font-family: var(--mono); font-feature-settings: 'tnum'; }
.cc-kpis .kpi .kpi-foot { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.cc-kpis .kpi.kpi-green .kpi-value { color: var(--green); }

/* Window totals strip (1h / 24h / 30d) */
.cc-windows-wrap { padding: 14px 16px; }
.cc-windows-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.cc-windows-hint { font-size: 11.5px; color: var(--muted); }
.cc-windows { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.cc-win-card {
  display: flex; flex-direction: column; gap: 5px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.025); border: 1px solid var(--border);
}
.cc-win-label { font-size: 12px; color: var(--muted); }
.cc-win-total { font-size: 20px; font-weight: 700; color: var(--text); line-height: 1.1; }
.cc-win-split { display: flex; gap: 14px; font-size: 11.5px; margin-top: 1px; }
@media (max-width: 700px) { .cc-windows { grid-template-columns: 1fr; } }

/* Toolbar */
.cc-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 2px 0 14px; }
.cc-toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cc-toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.cc-section-title { font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.cc-count-chip { font-size: 11.5px; color: var(--muted); font-family: var(--mono); padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.04); }

/* Range pills (1h/24h/7d/...) */
.cc-range-pills { display: inline-flex; padding: 3px; background: rgba(255,255,255,0.04); border-radius: 8px; gap: 2px; }
.cc-range-pills button {
  padding: 5px 12px; font-size: 12px; font-family: var(--mono);
  background: transparent; color: var(--muted); border: none; cursor: pointer;
  border-radius: 6px; transition: background 0.1s, color 0.1s;
}
.cc-range-pills button:hover { color: var(--text); }
.cc-range-pills button.active { background: var(--surface); color: var(--green); font-weight: 600; box-shadow: 0 0 0 1px var(--border); }

/* Filter bar */
.cc-filter-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.cc-filter-search { flex: 1; min-width: 240px; display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius); }
.cc-filter-search:focus-within { border-color: var(--green); background: rgba(34,197,94,0.04); }
.cc-filter-search input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); font-size: 12.5px; padding: 0; }
.cc-filter-search input::placeholder { color: var(--muted); }
.cc-filter-search :deep(svg) { color: var(--muted); flex-shrink: 0; }
.cc-select {
  padding: 7px 30px 7px 12px; font-size: 12.5px; background: rgba(255,255,255,0.03);
  border: 1px solid var(--border); border-radius: var(--radius); color: var(--text);
  appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
}
.cc-select:hover { border-color: var(--green-soft, var(--border-soft)); }
.cc-select-sm { padding: 4px 24px 4px 10px; font-size: 11.5px; }

/* Empty state */
.cc-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 50px 20px; color: var(--muted); font-size: 13px; }

/* Session table */
.cc-table { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: rgba(0,0,0,0.15); }
.cc-table-head, .cc-table-row {
  display: grid;
  grid-template-columns: 1.3fr 2.1fr 0.9fr 0.6fr 0.9fr 0.9fr 0.7fr;
  gap: 12px;
  padding: 9px 14px;
  align-items: center;
}
.cc-table-head { background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
.cc-table-row { border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12.5px; transition: background 0.08s; }
.cc-table-row:last-child { border-bottom: none; }
.cc-table-row:hover { background: rgba(34,197,94,0.025); }
.cc-table .mono { font-family: var(--mono); font-size: 12px; }
.cc-table .right { text-align: right; }
.cc-table .muted { color: var(--muted); }
.cc-table .bytes { font-weight: 600; color: var(--text); }
.cc-table .time-cell { color: var(--muted); font-family: var(--mono); font-size: 11.5px; }

/* Destination cell — host on top, IP underneath */
.dst-line { display: flex; align-items: center; gap: 5px; }
.dst-line .flag { font-size: 13px; line-height: 1; }
.dst-host { color: var(--text); }
.dst-ip { display: block; font-size: 10.5px; color: var(--muted); margin-top: 1px; }

/* Protocol pill (http / connect / socks5) */
.kind-pill {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 10.5px; font-family: var(--mono); text-transform: uppercase;
  font-weight: 600; letter-spacing: 0.04em;
}
.kind-pill.http    { background: rgba(59,130,246,0.15);  color: #93c5fd; }
.kind-pill.connect { background: rgba(168,85,247,0.15);  color: #c4b5fd; }
.kind-pill.socks5  { background: rgba(245,158,11,0.15);  color: #fcd34d; }

/* Pager */
.cc-pager { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: rgba(255,255,255,0.015); border-top: 1px solid var(--border); margin: 0 -14px -14px; }
.cc-pager-info { font-size: 12px; color: var(--muted); }
.cc-pager-info strong { color: var(--text); font-family: var(--mono); }
.cc-pager-spacer { flex: 1; }
.cc-pager-btn {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-family: var(--mono); cursor: pointer; padding: 0;
}
.cc-pager-btn:not(:disabled):hover { background: rgba(34,197,94,0.12); color: var(--green); border-color: var(--green); }
.cc-pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.cc-sessions { padding: 14px; }

/* Mobile */
@media (max-width: 700px) {
  .cc-table-head, .cc-table-row { grid-template-columns: 1fr 1fr 0.6fr 0.7fr; gap: 8px; padding: 8px 10px; }
  .cc-table-head span:nth-child(4),
  .cc-table-row span:nth-child(4),
  .cc-table-head span:nth-child(6),
  .cc-table-row span:nth-child(6) { display: none; }
}
</style>
