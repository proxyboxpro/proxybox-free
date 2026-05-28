<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, RefreshCw, Globe, Cpu, Ban, Users, Radio } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber, formatRate } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
}

const router = useRouter()
const rows = ref([])
const err = ref('')
const loading = ref(false)
const nodeFilter = ref('')
const search = ref('')
const expanded = ref(new Set())
const autoRefresh = ref(true)
const tab = ref('sessions') // 'sessions' | 'proxies' | 'sources'
const sources = ref([])
const sourcesHours = ref(24)
const sessions = ref([])
const sessionsHours = ref(1)
const sessionFilters = ref({ host: '', src: '', kind: '', proxyId: '' })
const sessionsTotal = ref(0)
const sessionsPage = ref(0)
const sessionsPageSize = ref(50)
const sseConnected = ref(false)
const liveDelta = ref(0) // count of live events received since last refresh
let timer = null
let sse = null

async function refresh() {
  loading.value = true; err.value = ''
  try {
    if (tab.value === 'proxies') rows.value = await apiFetch('/api/admin/connections')
    else if (tab.value === 'sources') {
      const data = await apiFetch(`/api/admin/connections/by-source?hours=${sourcesHours.value}`)
      sources.value = data?.sources || []
    } else {
      const f = sessionFilters.value
      const qs = [`hours=${sessionsHours.value}`, `limit=${sessionsPageSize.value}`, `offset=${sessionsPage.value * sessionsPageSize.value}`]
      if (f.host) qs.push(`host=${encodeURIComponent(f.host)}`)
      if (f.src)  qs.push(`src=${encodeURIComponent(f.src)}`)
      if (f.kind) qs.push(`kind=${encodeURIComponent(f.kind)}`)
      if (f.proxyId) qs.push(`proxyId=${encodeURIComponent(f.proxyId)}`)
      const data = await apiFetch(`/api/admin/sessions?${qs.join('&')}`)
      sessions.value = data?.sessions || []
      sessionsTotal.value = data?.total || 0
      // Also fetch the proxy summary for KPI computation if not loaded yet
      if (!rows.value.length) rows.value = await apiFetch('/api/admin/connections')
    }
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

function fmtDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`
}
function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('vi-VN', { hour12: false })
}
function kindToApp(kind, port) {
  if (kind === 'connect') return `tcp/${port}`
  if (kind === 'http') return `tcp/${port}`
  if (kind === 'socks5') return `socks5/${port}`
  return `${kind}/${port}`
}

async function blockHost(host) {
  if (!confirm(t('admin.conn.confirmBlock', { host }))) return
  try {
    await apiFetch('/api/admin/deny-hosts', { method: 'POST', body: { host } })
    alert(t('admin.conn.blocked', { host }))
  } catch (e) { alert(t('admin.conn.blockErr', { msg: e.message })) }
}
function goDrillDown(proxyId) { router.push({ name: 'admin-connection-detail', params: { proxyId } }) }

const nodes = computed(() => {
  const set = new Map()
  for (const r of rows.value) set.set(r.nodeId, r.nodeName || r.nodeId)
  return [...set.entries()].map(([id, name]) => ({ id, name }))
})

const filtered = computed(() => {
  let list = rows.value
  if (nodeFilter.value) list = list.filter((r) => r.nodeId === nodeFilter.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter((r) => `${r.proxyId} ${r.ownerEmail} ${r.bindIp} ${r.zone} ${r.nodeName}`.toLowerCase().includes(q))
  }
  return list
})

const summary = computed(() => {
  const total = filtered.value.length
  const live = filtered.value.reduce((a, r) => a + (r.active || 0), 0)
  const conns = filtered.value.reduce((a, r) => a + (r.total || 0), 0)
  const up = filtered.value.reduce((a, r) => a + (r.uploadBytes || 0), 0)
  const down = filtered.value.reduce((a, r) => a + (r.downloadBytes || 0), 0)
  const bpsIn = filtered.value.reduce((a, r) => a + (r.bpsIn || 0), 0)
  const bpsOut = filtered.value.reduce((a, r) => a + (r.bpsOut || 0), 0)
  return { total, live, conns, up, down, bpsIn, bpsOut }
})

function toggle(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
}

function fmtAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function openSse() {
  try {
    sse = new EventSource('/api/admin/connections/stream', { withCredentials: true })
    sse.addEventListener('hello', () => { sseConnected.value = true })
    sse.addEventListener('connection', (ev) => {
      try {
        const c = JSON.parse(ev.data)
        liveDelta.value += 1
        // Sessions tab: prepend new session row (synthetic id) so the table
        // updates live without a full refetch.
        if (tab.value === 'sessions') {
          sessions.value = [{
            id: `live-${c.ts}-${Math.random()}`,
            ts: c.ts,
            proxyId: c.proxyId,
            ownerId: c.ownerId,
            src: c.src,
            srcPort: c.srcPort,
            host: c.host,
            port: c.port,
            up: c.up,
            down: c.down,
            ms: c.ms,
            kind: c.kind,
            ownerEmail: '',
            srcGeo: null,
            hostGeo: null,
            hostIp: null
          }, ...sessions.value].slice(0, 500)
        }
        // Incremental update: bump active+total on matching row + prepend event.
        if (tab.value === 'proxies') {
          const r = rows.value.find((x) => x.proxyId === c.proxyId)
          if (r) {
            r.total = (r.total || 0) + 1
            r.uploadBytes = (r.uploadBytes || 0) + (c.up || 0)
            r.downloadBytes = (r.downloadBytes || 0) + (c.down || 0)
            r.recentConns = [{ ts: c.ts, src: c.src, host: c.host, port: c.port, up: c.up, down: c.down, ms: c.ms, kind: c.kind }, ...(r.recentConns || [])].slice(0, 30)
            const t = r.topTargets.find((x) => x.host === c.host)
            if (t) { t.count += 1; t.bytesUp += c.up || 0; t.bytesDown += c.down || 0; t.lastTs = c.ts }
            else { r.topTargets = [{ host: c.host, count: 1, bytesUp: c.up || 0, bytesDown: c.down || 0, lastTs: c.ts }, ...r.topTargets].slice(0, 20) }
          }
        }
      } catch { /* noop */ }
    })
    sse.onerror = () => { sseConnected.value = false }
  } catch { sse = null; sseConnected.value = false }
}
function closeSse() { try { sse?.close() } catch { /* noop */ } sse = null; sseConnected.value = false }

onMounted(() => {
  refresh()
  openSse()
  // Slower poll fallback (every 30s) since SSE handles incremental updates.
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 30_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer); closeSse() })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">
        <Activity :size="14" style="vertical-align:-2px" />
        {{ t('admin.conn.eyebrow') }} · {{ t('admin.conn.proxyCount', { filtered: filtered.length, total: rows.length }) }}
      </span>
      <span class="sse-badge" :class="{ on: sseConnected }" :title="sseConnected ? t('admin.conn.sseLive') : t('admin.conn.ssePoll')">
        <Radio :size="11" /> {{ sseConnected ? 'LIVE' : 'POLL' }}<span v-if="liveDelta" style="margin-left:4px">+{{ liveDelta }}</span>
      </span>
      <div class="spacer"></div>
      <label class="filter-field" style="margin-right:8px">
        <input v-model="autoRefresh" type="checkbox" /> {{ t('admin.conn.autoPoll') }}
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh(); liveDelta = 0">
        <RefreshCw :size="12" /> {{ t('admin.conn.refresh') }}
      </button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- View tabs -->
    <div class="ac-tabs">
      <button type="button" :class="{ active: tab === 'sessions' }" @click="tab = 'sessions'; refresh()">
        <Activity :size="14" /> {{ t('admin.conn.tabSessions') }}
        <span v-if="tab === 'sessions' && sessionsTotal" class="tab-count">{{ sessionsTotal.toLocaleString() }}</span>
      </button>
      <button type="button" :class="{ active: tab === 'proxies' }" @click="tab = 'proxies'; refresh()">
        <Cpu :size="14" /> {{ t('admin.conn.tabProxies') }}
      </button>
      <button type="button" :class="{ active: tab === 'sources' }" @click="tab = 'sources'; refresh()">
        <Users :size="14" /> {{ t('admin.conn.tabSources') }}
      </button>
    </div>

    <!-- KPI strip -->
    <div v-if="tab === 'proxies'" class="metric-cards">
      <article>
        <Activity :size="20" />
        <span>{{ t('admin.conn.kpiOpen') }}</span>
        <strong>{{ formatNumber(summary.live) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.conn.kpiOpenSub', { n: formatNumber(summary.conns) }) }}</small>
      </article>
      <article>
        <Cpu :size="20" />
        <span>{{ t('admin.conn.kpiSpeed') }}</span>
        <strong style="font-size:18px">{{ formatRate(summary.bpsIn + summary.bpsOut) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">↑ {{ formatRate(summary.bpsOut) }} · ↓ {{ formatRate(summary.bpsIn) }}</small>
      </article>
      <article>
        <Globe :size="20" />
        <span>{{ t('admin.conn.kpiBwAll') }}</span>
        <strong style="font-size:18px">{{ formatBytes(summary.up + summary.down) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">↑ {{ formatBytes(summary.up) }} · ↓ {{ formatBytes(summary.down) }}</small>
      </article>
      <article>
        <Cpu :size="20" />
        <span>{{ t('admin.conn.kpiNodes') }}</span>
        <strong>{{ nodes.length }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.conn.kpiNodesSub', { n: filtered.length }) }}</small>
      </article>
    </div>

    <!-- Filters -->
    <section v-if="tab === 'proxies'" class="surface">
      <div class="ord-filters">
        <div class="filter-row">
          <label class="filter-field">
            <span>{{ t('admin.conn.filterNode') }}</span>
            <select v-model="nodeFilter">
              <option value="">{{ t('admin.conn.filterAll', { n: nodes.length }) }}</option>
              <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.name }}</option>
            </select>
          </label>
          <label class="filter-field" style="flex:1; min-width:240px">
            <span>{{ t('admin.conn.filterSearch') }}</span>
            <input v-model="search" type="search" :placeholder="t('admin.conn.searchPh')" />
          </label>
        </div>
      </div>
    </section>

    <!-- Sessions view (FortiView-style flat session table across all proxies) -->
    <section v-if="tab === 'sessions'" class="surface ac-sessions">
      <div class="ac-toolbar">
        <div class="ac-toolbar-left">
          <span class="ac-section-title"><Activity :size="14" /> {{ t('admin.conn.tabSessions') }}</span>
          <span class="ac-count-chip">{{ t('admin.conn.sessionsDisplay', { shown: sessions.length, total: sessionsTotal.toLocaleString() }) }}</span>
        </div>
        <div class="ac-toolbar-right">
          <div class="ac-range-pills">
            <button v-for="r in [{l:'1h',v:1},{l:'6h',v:6},{l:'24h',v:24},{l:'7d',v:168},{l:'30d',v:720}]"
                    :key="r.v" type="button" :class="{ active: sessionsHours === r.v }"
                    @click="sessionsHours = r.v; sessionsPage = 0; refresh()">{{ r.l }}</button>
          </div>
        </div>
      </div>

      <div class="ac-filter-bar">
        <div class="ac-filter-search">
          <Activity :size="14" />
          <input v-model="sessionFilters.host" type="search" :placeholder="t('admin.conn.filterHostPh')" @input="refresh" />
        </div>
        <div class="ac-filter-search ac-filter-narrow">
          <Users :size="14" />
          <input v-model="sessionFilters.src" type="search" :placeholder="t('admin.conn.filterSrcPh')" @input="refresh" />
        </div>
        <select v-model="sessionFilters.kind" class="ac-select" @change="refresh">
          <option value="">{{ t('admin.conn.allProtocol') }}</option>
          <option value="http">HTTP</option>
          <option value="connect">{{ t('admin.conn.protoHttps') }}</option>
          <option value="socks5">SOCKS5</option>
        </select>
      </div>

      <p v-if="!sessions.length && !loading" class="ac-empty">
        <Activity :size="22" style="opacity:0.4" />
        <span>{{ t('admin.conn.sessionsEmpty') }}</span>
      </p>

      <div v-if="sessions.length" class="ac-table">
        <div class="ac-table-head">
          <span>{{ t('admin.conn.colSource') }}</span>
          <span>{{ t('admin.conn.colOwner') }}</span>
          <span>{{ t('admin.conn.colDest') }}</span>
          <span>{{ t('admin.conn.colProto') }}</span>
          <span class="right">{{ t('admin.conn.colSrcPort') }}</span>
          <span class="right">{{ t('admin.conn.colDstPort') }}</span>
          <span class="right">{{ t('admin.conn.colBytes') }}</span>
          <span class="right">{{ t('admin.conn.colDuration') }}</span>
          <span class="right">{{ t('admin.conn.colTime') }}</span>
        </div>
        <div v-for="s in sessions" :key="s.id" class="ac-table-row">
          <span>
            <span class="dst-line">
              <span v-if="s.srcGeo?.cc" :title="`${s.srcGeo.country}${s.srcGeo.asnOrg ? ' · ' + s.srcGeo.asnOrg : ''}`" class="flag">{{ ccToFlag(s.srcGeo.cc) }}</span>
              <span class="mono">{{ s.src || '—' }}</span>
            </span>
          </span>
          <span class="owner-cell">{{ s.ownerEmail || '—' }}</span>
          <span>
            <span class="dst-line">
              <span v-if="s.hostGeo?.cc" :title="s.hostGeo.country" class="flag">{{ ccToFlag(s.hostGeo.cc) }}</span>
              <span class="mono dst-host">{{ s.host }}</span>
            </span>
            <span v-if="s.hostIp" class="mono dst-ip">{{ s.hostIp }}</span>
          </span>
          <span><span :class="['kind-pill', s.kind]">{{ s.kind }}</span></span>
          <span class="right mono muted">{{ s.srcPort || '—' }}</span>
          <span class="right mono">{{ s.port }}</span>
          <span class="right mono bytes">{{ formatBytes((s.up || 0) + (s.down || 0)) }}</span>
          <span class="right mono muted">{{ fmtDuration(s.ms) }}</span>
          <span class="right time-cell">{{ fmtTime(s.ts) }}</span>
        </div>
      </div>

      <div v-if="sessionsTotal > 0" class="ac-pager">
        <span class="ac-pager-info">{{ t('admin.conn.pageInfo') }} <strong>{{ sessionsPage + 1 }}</strong> {{ t('admin.conn.pageSep') }} {{ Math.max(1, Math.ceil(sessionsTotal / sessionsPageSize)) }}</span>
        <div class="ac-pager-spacer"></div>
        <span class="ac-pager-info" style="margin-right:6px">{{ t('admin.conn.perPage') }}</span>
        <select v-model.number="sessionsPageSize" class="ac-select ac-select-sm" @change="sessionsPage = 0; refresh()">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
        </select>
        <button class="ac-pager-btn" :disabled="sessionsPage === 0" @click="sessionsPage = 0; refresh()">«</button>
        <button class="ac-pager-btn" :disabled="sessionsPage === 0" @click="sessionsPage = Math.max(0, sessionsPage - 1); refresh()">‹</button>
        <button class="ac-pager-btn" :disabled="(sessionsPage + 1) * sessionsPageSize >= sessionsTotal" @click="sessionsPage = sessionsPage + 1; refresh()">›</button>
        <button class="ac-pager-btn" :disabled="(sessionsPage + 1) * sessionsPageSize >= sessionsTotal" @click="sessionsPage = Math.max(0, Math.ceil(sessionsTotal / sessionsPageSize) - 1); refresh()">»</button>
      </div>
    </section>

    <!-- By client IP view -->
    <section v-if="tab === 'sources'" class="surface">
      <div class="section-head" style="display:flex; align-items:center; gap:10px">
        <h2 style="margin:0"><Users :size="14" style="vertical-align:-2px" /> {{ t('admin.conn.srcTitle') }}</h2>
        <div class="spacer"></div>
        <label class="filter-field" style="width:auto">
          <span>{{ t('admin.conn.srcWindow') }}</span>
          <select v-model.number="sourcesHours" @change="refresh">
            <option :value="1">{{ t('admin.conn.srcWin1h') }}</option>
            <option :value="24">{{ t('admin.conn.srcWin24h') }}</option>
            <option :value="168">{{ t('admin.conn.srcWin7d') }}</option>
            <option :value="720">{{ t('admin.conn.srcWin30d') }}</option>
          </select>
        </label>
      </div>
      <p v-if="!sources.length && !loading" class="empty-text">{{ t('admin.conn.srcEmpty') }}</p>
      <div v-if="sources.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.5fr 0.7fr 0.7fr 0.7fr 1fr 1fr">
          <span>{{ t('admin.conn.colClientIp') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colHits') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colProxyCount') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colOwnerCount') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colBandwidth') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colLast') }}</span>
        </div>
        <div v-for="s in sources" :key="s.src" class="table-row" style="grid-template-columns: 1.5fr 0.7fr 0.7fr 0.7fr 1fr 1fr">
          <span class="cell-mono" style="font-size:12px">
            <span v-if="s.geo?.cc" :title="`${s.geo.country}${s.geo.asn ? ' · ' + s.geo.asn : ''}`" style="margin-right:4px">{{ ccToFlag(s.geo.cc) }}</span>{{ s.src }}
            <small v-if="s.geo?.asnOrg" style="display:block; color:var(--muted); font-size:11px; margin-left:18px">{{ s.geo.asnOrg }}</small>
          </span>
          <span style="text-align:right">{{ formatNumber(s.count) }}</span>
          <span style="text-align:right" :style="{ color: s.proxyCount > 1 ? 'var(--yellow)' : 'var(--text)' }">{{ s.proxyCount }}</span>
          <span style="text-align:right" :style="{ color: s.ownerCount > 1 ? 'var(--red)' : 'var(--text)' }">{{ s.ownerCount }}</span>
          <span class="cell-mono" style="text-align:right; font-size:12px">{{ formatBytes((s.bytesUp || 0) + (s.bytesDown || 0)) }}</span>
          <span style="text-align:right; font-size:11.5px; color:var(--muted)">{{ new Date(s.lastTs).toLocaleString('vi-VN') }}</span>
        </div>
      </div>
      <p style="font-size:12px; color:var(--muted); margin-top:10px">
        {{ t('admin.conn.srcFooter') }}
      </p>
    </section>

    <!-- Per-proxy connection table -->
    <section v-if="tab === 'proxies'" class="surface">
      <div class="section-head">
        <h2>{{ t('admin.conn.proxiesTitle', { n: filtered.length }) }}</h2>
        <span style="color:var(--muted);font-size:12px">{{ t('admin.conn.proxiesNote') }}</span>
      </div>
      <p v-if="!filtered.length && !loading" class="empty-text">
        {{ t('admin.conn.proxiesEmpty') }}
      </p>
      <div v-if="filtered.length" class="data-table conn-table">
        <div class="table-head">
          <span></span>
          <span>{{ t('admin.conn.colOwner') }} / Proxy</span>
          <span>{{ t('admin.conn.filterNode') }} · Zone</span>
          <span>{{ t('admin.conn.colBindIp') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colLiveTotal') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colBwAll') }}</span>
          <span style="text-align:right">{{ t('admin.conn.colSpeed') }}</span>
        </div>
        <template v-for="r in filtered" :key="r.proxyId">
          <div class="table-row" :class="{ open: expanded.has(r.proxyId) }" @click="toggle(r.proxyId)">
            <span class="row-caret">{{ expanded.has(r.proxyId) ? '▾' : '▸' }}</span>
            <span>
              <div style="font-weight:600">{{ r.ownerEmail || '—' }}</div>
              <small class="cell-mono" style="color:var(--muted); font-size:11px">{{ r.proxyId }} · {{ r.type }}</small>
            </span>
            <span>
              <div>{{ r.nodeName }}</div>
              <small style="color:var(--muted); font-size:11px">{{ r.zone || '—' }}</small>
            </span>
            <span class="cell-mono">
              {{ r.ip || r.bindIp }}:{{ r.port }}
              <small v-if="r.ip && r.bindIp && r.ip !== r.bindIp" style="display:block; color:var(--muted); font-size:10.5px">{{ t('admin.bw.egressPrefix') }}{{ r.bindIp }}</small>
            </span>
            <span style="text-align:right">
              <strong :style="{ color: r.active ? 'var(--green)' : 'var(--muted)' }">{{ r.active }}</strong>
              <small style="color:var(--muted); font-size:11px; display:block">{{ formatNumber(r.total) }}</small>
            </span>
            <span class="cell-mono" style="text-align:right; font-size:12px">
              ↑ {{ formatBytes(r.uploadBytes) }}<br />
              ↓ {{ formatBytes(r.downloadBytes) }}
            </span>
            <span class="cell-mono" style="text-align:right; font-size:12px">
              ↑ {{ formatRate(r.bpsOut) }}<br />
              ↓ {{ formatRate(r.bpsIn) }}
            </span>
          </div>
          <div v-if="expanded.has(r.proxyId)" class="conn-detail" @click.stop>
            <div style="display:flex; gap:8px; margin-bottom:10px">
              <button class="ghost-button" type="button" @click="goDrillDown(r.proxyId)">
                {{ t('admin.conn.openDetail') }}
              </button>
            </div>
            <div class="conn-detail-grid">
              <div>
                <h4>{{ t('admin.conn.topDestSubTitle', { n: r.topTargets.length }) }}</h4>
                <p v-if="!r.topTargets.length" class="empty-text" style="padding:8px 0">{{ t('admin.conn.topDestEmpty') }}</p>
                <div v-else class="data-table inner">
                  <div class="table-head inner-head" style="grid-template-columns: 1fr 60px 1fr 28px">
                    <span>{{ t('admin.connDetail.colHost') }}</span>
                    <span style="text-align:right">{{ t('admin.connDetail.colHits') }}</span>
                    <span style="text-align:right">{{ t('admin.conn.colBandwidth') }}</span>
                    <span></span>
                  </div>
                  <div v-for="dest in r.topTargets" :key="dest.host" class="table-row inner-row" style="grid-template-columns: 1fr 60px 1fr 28px">
                    <span class="cell-mono" style="font-size:12px">
                      <span v-if="dest.geo?.cc" :title="dest.geo.country" style="margin-right:4px">{{ ccToFlag(dest.geo.cc) }}</span>
                      {{ dest.host }}
                    </span>
                    <span style="text-align:right">{{ formatNumber(dest.count) }}</span>
                    <span class="cell-mono" style="text-align:right; font-size:12px">{{ formatBytes(dest.bytesUp + dest.bytesDown) }}</span>
                    <button class="icon-button" type="button" :title="t('admin.connDetail.blockTitle')" @click="blockHost(dest.host)"><Ban :size="12" /></button>
                  </div>
                </div>
              </div>
              <div>
                <h4>{{ t('admin.conn.recentTitle', { n: r.recentConns.length }) }}</h4>
                <p v-if="!r.recentConns.length" class="empty-text" style="padding:8px 0">{{ t('admin.conn.recentEmpty') }}</p>
                <div v-else class="data-table inner">
                  <div class="table-head inner-head">
                    <span>{{ t('admin.connDetail.colWhen') }}</span>
                    <span>{{ t('admin.connDetail.colClient') }}</span>
                    <span>{{ t('admin.connDetail.colTarget') }}</span>
                    <span style="text-align:right">{{ t('admin.connDetail.colBytes') }}</span>
                  </div>
                  <div v-for="(c, i) in r.recentConns" :key="i" class="table-row inner-row">
                    <span style="font-size:11.5px; color:var(--muted)">{{ fmtAgo(c.ts) }}</span>
                    <span class="cell-mono" style="font-size:11.5px">
                      <span v-if="c.srcGeo?.cc" :title="c.srcGeo.country" style="margin-right:3px">{{ ccToFlag(c.srcGeo.cc) }}</span>{{ c.src || '—' }}
                    </span>
                    <span class="cell-mono" style="font-size:11.5px">
                      <span v-if="c.hostGeo?.cc" :title="c.hostGeo.country" style="margin-right:3px">{{ ccToFlag(c.hostGeo.cc) }}</span>{{ c.host }}:{{ c.port }}
                    </span>
                    <span class="cell-mono" style="text-align:right; font-size:11.5px">{{ formatBytes(c.up + c.down) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>
  </section>
</template>

<style scoped>
.conn-table .table-head,
.conn-table .table-row {
  grid-template-columns: 24px 1.6fr 1.2fr 1.4fr 1fr 1.2fr 1.1fr;
}
.row-caret { color: var(--muted); font-family: var(--mono); font-size: 14px; user-select: none; }
.conn-table .table-row { cursor: pointer; }
.conn-table .table-row.open { background: rgba(255, 255, 255, 0.02); }
.conn-detail { padding: 12px 14px 14px 38px; border-bottom: 1px solid var(--border); background: rgba(255, 255, 255, 0.015); }
.conn-detail h4 { margin: 4px 0 8px; font-size: 12px; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
.conn-detail-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 18px; }
@media (max-width: 800px) { .conn-detail-grid { grid-template-columns: 1fr; } }
.data-table.inner { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.table-head.inner-head,
.table-row.inner-row { grid-template-columns: 1fr 80px 1fr; padding: 6px 10px; }
.conn-detail-grid > div:last-child .table-head.inner-head,
.conn-detail-grid > div:last-child .table-row.inner-row { grid-template-columns: 60px 1fr 1.4fr 1fr; }
.inner-row { font-size: 12px; }
.inner-head { font-size: 11px; color: var(--muted); }
.sse-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:10.5px; font-family:var(--mono); background:rgba(148,163,184,0.12); color:var(--muted); margin-left:8px }
.sse-badge.on { background:rgba(34,197,94,0.15); color:var(--green) }
.session-table .session-row { grid-template-columns: 1.4fr 1.1fr 1.8fr 0.9fr 0.5fr 0.6fr 0.6fr 0.8fr 0.8fr 0.7fr; gap: 6px; padding: 5px 10px; }
.session-table .table-head.session-row { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.pager { display:flex; align-items:center; gap:8px; padding:8px 0; font-size:12px; color:var(--muted); flex-wrap:wrap }
.pager button { padding:3px 10px; font-family:var(--mono) }
.pager .spacer { flex:1 }

/* ── Modern admin connections styling (FortiView-inspired) ───────────── */
.ac-tabs { display: inline-flex; padding: 4px; background: rgba(255,255,255,0.04); border-radius: 10px; gap: 2px; margin: 4px 0 4px; }
.ac-tabs button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; font-size: 12.5px; font-weight: 500;
  background: transparent; color: var(--muted); border: none; cursor: pointer;
  border-radius: 7px; transition: background 0.1s, color 0.1s;
}
.ac-tabs button:hover { color: var(--text); }
.ac-tabs button.active { background: var(--surface); color: var(--green); box-shadow: 0 0 0 1px var(--border); }
.ac-tabs .tab-count { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: rgba(34,197,94,0.15); color: var(--green); font-family: var(--mono); }

/* Sessions toolbar */
.ac-sessions { padding: 14px; }
.ac-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 0 0 14px; }
.ac-toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-toolbar-right { margin-left: auto; }
.ac-section-title { font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.ac-count-chip { font-size: 11.5px; color: var(--muted); font-family: var(--mono); padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,0.04); }

.ac-range-pills { display: inline-flex; padding: 3px; background: rgba(255,255,255,0.04); border-radius: 8px; gap: 2px; }
.ac-range-pills button {
  padding: 5px 12px; font-size: 12px; font-family: var(--mono);
  background: transparent; color: var(--muted); border: none; cursor: pointer;
  border-radius: 6px; transition: background 0.1s, color 0.1s;
}
.ac-range-pills button:hover { color: var(--text); }
.ac-range-pills button.active { background: var(--surface); color: var(--green); font-weight: 600; box-shadow: 0 0 0 1px var(--border); }

/* Filter bar */
.ac-filter-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.ac-filter-search { flex: 1; min-width: 240px; display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius); }
.ac-filter-search.ac-filter-narrow { flex: 0 1 240px; }
.ac-filter-search:focus-within { border-color: var(--green); background: rgba(34,197,94,0.04); }
.ac-filter-search input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); font-size: 12.5px; padding: 0; font-family: var(--mono); }
.ac-filter-search input::placeholder { color: var(--muted); font-family: inherit; }
.ac-filter-search :deep(svg) { color: var(--muted); flex-shrink: 0; }
.ac-select {
  padding: 7px 30px 7px 12px; font-size: 12.5px; background: rgba(255,255,255,0.03);
  border: 1px solid var(--border); border-radius: var(--radius); color: var(--text);
  appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
}
.ac-select:hover { border-color: rgba(34,197,94,0.4); }
.ac-select-sm { padding: 4px 24px 4px 10px; font-size: 11.5px; }

/* Empty state */
.ac-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 50px 20px; color: var(--muted); font-size: 13px; }

/* Session table */
.ac-table { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: rgba(0,0,0,0.15); }
.ac-table-head, .ac-table-row {
  display: grid;
  grid-template-columns: 1.3fr 1.2fr 1.9fr 0.7fr 0.6fr 0.6fr 0.8fr 0.8fr 0.8fr;
  gap: 12px;
  padding: 9px 14px;
  align-items: center;
}
.ac-table-head { background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
.ac-table-row { border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12.5px; transition: background 0.08s; }
.ac-table-row:last-child { border-bottom: none; }
.ac-table-row:hover { background: rgba(34,197,94,0.025); }
.ac-table .mono { font-family: var(--mono); font-size: 12px; }
.ac-table .right { text-align: right; }
.ac-table .muted { color: var(--muted); }
.ac-table .bytes { font-weight: 600; color: var(--text); }
.ac-table .time-cell { color: var(--muted); font-family: var(--mono); font-size: 11.5px; }
.ac-table .owner-cell { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dst-line { display: flex; align-items: center; gap: 5px; }
.dst-line .flag { font-size: 13px; line-height: 1; }
.dst-host { color: var(--text); }
.dst-ip { display: block; font-size: 10.5px; color: var(--muted); margin-top: 1px; }

.kind-pill {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 10.5px; font-family: var(--mono); text-transform: uppercase;
  font-weight: 600; letter-spacing: 0.04em;
}
.kind-pill.http    { background: rgba(59,130,246,0.15);  color: #93c5fd; }
.kind-pill.connect { background: rgba(168,85,247,0.15);  color: #c4b5fd; }
.kind-pill.socks5  { background: rgba(245,158,11,0.15);  color: #fcd34d; }

/* Pager */
.ac-pager { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: rgba(255,255,255,0.015); border-top: 1px solid var(--border); margin: 0 -14px -14px; }
.ac-pager-info { font-size: 12px; color: var(--muted); }
.ac-pager-info strong { color: var(--text); font-family: var(--mono); }
.ac-pager-spacer { flex: 1; }
.ac-pager-btn {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-family: var(--mono); cursor: pointer; padding: 0;
}
.ac-pager-btn:not(:disabled):hover { background: rgba(34,197,94,0.12); color: var(--green); border-color: var(--green); }
.ac-pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }

@media (max-width: 900px) {
  .ac-table-head, .ac-table-row { grid-template-columns: 1fr 1.5fr 0.6fr 0.7fr 0.7fr; gap: 8px; padding: 8px 10px; }
  .ac-table-head span:nth-child(2),
  .ac-table-row span:nth-child(2),
  .ac-table-head span:nth-child(5),
  .ac-table-row span:nth-child(5),
  .ac-table-head span:nth-child(6),
  .ac-table-row span:nth-child(6),
  .ac-table-head span:nth-child(8),
  .ac-table-row span:nth-child(8) { display: none; }
}
</style>
