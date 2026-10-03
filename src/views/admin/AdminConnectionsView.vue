<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber, formatRate } from '../../utils/format'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'

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
const expandedKeys = ref([])
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
  if (!(await confirmAsync({ title: t('admin.conn.confirmBlock', { host }), danger: true }))) return
  try {
    await apiFetch('/api/admin/deny-hosts', { method: 'POST', body: { host } })
    message.success(t('admin.conn.blocked', { host }))
  } catch (e) { message.error(t('admin.conn.blockErr', { msg: e.message })) }
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

function onTab(key) { tab.value = key; refresh() }
function onRefreshClick() { refresh(); liveDelta.value = 0 }
function setSessionsHours(h) { sessionsHours.value = h; sessionsPage.value = 0; refresh() }
// <a-pagination> reports (page, pageSize); a page-size change restarts at page 1.
function onSessionsPage(page, size) {
  if (size !== sessionsPageSize.value) { sessionsPageSize.value = size; sessionsPage.value = 0 }
  else sessionsPage.value = page - 1
  refresh()
}
const sessionsPages = computed(() => Math.max(1, Math.ceil(sessionsTotal.value / sessionsPageSize.value)))
const sessionsShowTotal = () => `${t('admin.conn.pageInfo')} ${sessionsPage.value + 1} ${t('admin.conn.pageSep')} ${sessionsPages.value}`

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
            const tgt = r.topTargets.find((x) => x.host === c.host)
            if (tgt) { tgt.count += 1; tgt.bytesUp += c.up || 0; tgt.bytesDown += c.down || 0; tgt.lastTs = c.ts }
            else { r.topTargets = [{ host: c.host, count: 1, bytesUp: c.up || 0, bytesDown: c.down || 0, lastTs: c.ts }, ...r.topTargets].slice(0, 20) }
          }
        }
      } catch { /* noop */ }
    })
    sse.onerror = () => { sseConnected.value = false }
  } catch { sse = null; sseConnected.value = false }
}
function closeSse() { try { sse?.close() } catch { /* noop */ } sse = null; sseConnected.value = false }

const fmtNum = ({ value }) => formatNumber(value)
const fmtBytes = ({ value }) => formatBytes(value)
// Recent-connection rows carry no id — key them by position.
const withIdx = (list) => (list || []).map((c, i) => ({ ...c, _k: i }))
const KIND_COLOR = { http: 'blue', connect: 'purple', socks5: 'orange' }

const SESSION_RANGES = [{ label: '1h', value: 1 }, { label: '6h', value: 6 }, { label: '24h', value: 24 }, { label: '7d', value: 168 }, { label: '30d', value: 720 }]
const kindOptions = computed(() => [
  { value: '', label: t('admin.conn.allProtocol') },
  { value: 'http', label: 'HTTP' },
  { value: 'connect', label: t('admin.conn.protoHttps') },
  { value: 'socks5', label: 'SOCKS5' }
])
const nodeOptions = computed(() => [
  { value: '', label: t('admin.conn.filterAll', { n: nodes.value.length }) },
  ...nodes.value.map((n) => ({ value: n.id, label: n.name }))
])
const sourceWindowOptions = computed(() => [
  { value: 1, label: t('admin.conn.srcWin1h') },
  { value: 24, label: t('admin.conn.srcWin24h') },
  { value: 168, label: t('admin.conn.srcWin7d') },
  { value: 720, label: t('admin.conn.srcWin30d') }
])

const sessionColumns = computed(() => [
  { title: t('admin.conn.colSource'), key: 'src', width: 170 },
  { title: t('admin.conn.colOwner'), key: 'owner', ellipsis: true, responsive: ['md'] },
  { title: t('admin.conn.colDest'), key: 'dest' },
  { title: t('admin.conn.colProto'), key: 'kind', width: 100 },
  { title: t('admin.conn.colSrcPort'), key: 'srcPort', align: 'right', width: 90, responsive: ['md'] },
  { title: t('admin.conn.colDstPort'), key: 'port', align: 'right', width: 90, responsive: ['md'] },
  { title: t('admin.conn.colBytes'), key: 'bytes', align: 'right', width: 100 },
  { title: t('admin.conn.colDuration'), key: 'ms', align: 'right', width: 100, responsive: ['md'] },
  { title: t('admin.conn.colTime'), key: 'ts', align: 'right', width: 90 }
])
const proxyColumns = computed(() => [
  { title: `${t('admin.conn.colOwner')} / Proxy`, key: 'owner' },
  { title: `${t('admin.conn.filterNode')} · Zone`, key: 'node', responsive: ['md'] },
  { title: t('admin.conn.colBindIp'), key: 'bind' },
  { title: t('admin.conn.colLiveTotal'), key: 'live', align: 'right', width: 110 },
  { title: t('admin.conn.colBwAll'), key: 'bw', align: 'right', width: 130 },
  { title: t('admin.conn.colSpeed'), key: 'speed', align: 'right', width: 120, responsive: ['sm'] }
])
const destColumns = computed(() => [
  { title: t('admin.connDetail.colHost'), key: 'host' },
  { title: t('admin.connDetail.colHits'), key: 'count', align: 'right', width: 70 },
  { title: t('admin.conn.colBandwidth'), key: 'bytes', align: 'right', width: 100 },
  { title: '', key: 'block', align: 'right', width: 48 }
])
const recentColumns = computed(() => [
  { title: t('admin.connDetail.colWhen'), key: 'ago', width: 64 },
  { title: t('admin.connDetail.colClient'), key: 'src' },
  { title: t('admin.connDetail.colTarget'), key: 'target' },
  { title: t('admin.connDetail.colBytes'), key: 'bytes', align: 'right', width: 90 }
])
const sourceColumns = computed(() => [
  { title: t('admin.conn.colClientIp'), key: 'src' },
  { title: t('admin.conn.colHits'), key: 'count', align: 'right', width: 90 },
  { title: t('admin.conn.colProxyCount'), key: 'proxyCount', align: 'right', width: 80 },
  { title: t('admin.conn.colOwnerCount'), key: 'ownerCount', align: 'right', width: 80 },
  { title: t('admin.conn.colBandwidth'), key: 'bytes', align: 'right', width: 110 },
  { title: t('admin.conn.colLast'), key: 'last', align: 'right', width: 170, responsive: ['sm'] }
])
const pagination = { defaultPageSize: 50, showSizeChanger: true, hideOnSinglePage: true }

onMounted(() => {
  refresh()
  openSse()
  // Slower poll fallback (every 30s) since SSE handles incremental updates.
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 30_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer); closeSse() })
</script>
<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-space wrap :size="8">
        <a-typography-text type="secondary">
          <LineChartOutlined />
          {{ t('admin.conn.eyebrow') }} · {{ t('admin.conn.proxyCount', { filtered: filtered.length, total: rows.length }) }}
        </a-typography-text>
        <a-tooltip :title="sseConnected ? t('admin.conn.sseLive') : t('admin.conn.ssePoll')">
          <a-tag :color="sseConnected ? 'success' : 'default'" :bordered="false" class="mono sse-tag">
            <WifiOutlined /> {{ sseConnected ? 'LIVE' : 'POLL' }}<template v-if="liveDelta"> +{{ liveDelta }}</template>
          </a-tag>
        </a-tooltip>
      </a-space>
      <a-space wrap>
        <a-checkbox v-model:checked="autoRefresh">{{ t('admin.conn.autoPoll') }}</a-checkbox>
        <a-button :loading="loading" @click="onRefreshClick">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.conn.refresh') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-tabs :active-key="tab" class="conn-tabs" @change="onTab">
      <!-- Sessions view (FortiView-style flat session table across all proxies) -->
      <a-tab-pane key="sessions">
        <template #tab>
          <span>
            <LineChartOutlined />{{ t('admin.conn.tabSessions') }}
            <a-tag v-if="tab === 'sessions' && sessionsTotal" color="success" :bordered="false" class="mono tab-count">{{ sessionsTotal.toLocaleString() }}</a-tag>
          </span>
        </template>

        <a-card :body-style="{ padding: 0 }">
          <a-flex vertical gap="middle" class="card-pad">
            <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
              <a-tag :bordered="false" class="mono">{{ t('admin.conn.sessionsDisplay', { shown: sessions.length, total: sessionsTotal.toLocaleString() }) }}</a-tag>
              <a-segmented :value="sessionsHours" :options="SESSION_RANGES" @change="setSessionsHours" />
            </a-flex>
            <a-flex wrap="wrap" gap="small">
              <a-input v-model:value="sessionFilters.host" allow-clear :placeholder="t('admin.conn.filterHostPh')" class="mono f-host" @change="refresh">
                <template #prefix><GlobalOutlined /></template>
              </a-input>
              <a-input v-model:value="sessionFilters.src" allow-clear :placeholder="t('admin.conn.filterSrcPh')" class="mono f-src" @change="refresh">
                <template #prefix><UserOutlined /></template>
              </a-input>
              <a-select v-model:value="sessionFilters.kind" :options="kindOptions" class="f-kind" @change="refresh" />
            </a-flex>
          </a-flex>

          <a-table
            :columns="sessionColumns"
            :data-source="sessions"
            :loading="loading"
            :pagination="false"
            row-key="id"
            size="small"
            :scroll="{ x: 640 }"
            :locale="{ emptyText: t('admin.conn.sessionsEmpty') }"
          >
            <template #bodyCell="{ column, record: s }">
              <template v-if="column.key === 'src'">
                <a-tooltip v-if="s.srcGeo?.cc" :title="`${s.srcGeo.country}${s.srcGeo.asnOrg ? ' · ' + s.srcGeo.asnOrg : ''}`">
                  <span class="flag">{{ ccToFlag(s.srcGeo.cc) }}</span>
                </a-tooltip>
                <span class="mono">{{ s.src || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'owner'">{{ s.ownerEmail || '—' }}</template>
              <template v-else-if="column.key === 'dest'">
                <a-tooltip v-if="s.hostGeo?.cc" :title="s.hostGeo.country">
                  <span class="flag">{{ ccToFlag(s.hostGeo.cc) }}</span>
                </a-tooltip>
                <span class="mono">{{ s.host }}</span>
                <div v-if="s.hostIp"><a-typography-text type="secondary" class="mono small">{{ s.hostIp }}</a-typography-text></div>
              </template>
              <template v-else-if="column.key === 'kind'">
                <a-tag :color="KIND_COLOR[s.kind] || 'default'" :bordered="false" class="mono kind-tag">{{ s.kind }}</a-tag>
              </template>
              <template v-else-if="column.key === 'srcPort'">
                <a-typography-text type="secondary" class="mono">{{ s.srcPort || '—' }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'port'"><span class="mono">{{ s.port }}</span></template>
              <template v-else-if="column.key === 'bytes'">
                <strong class="mono nowrap">{{ formatBytes((s.up || 0) + (s.down || 0)) }}</strong>
              </template>
              <template v-else-if="column.key === 'ms'">
                <a-typography-text type="secondary" class="mono nowrap">{{ fmtDuration(s.ms) }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'ts'">
                <a-typography-text type="secondary" class="mono small">{{ fmtTime(s.ts) }}</a-typography-text>
              </template>
            </template>
          </a-table>

          <a-flex v-if="sessionsTotal > 0" justify="flex-end" class="card-pad">
            <a-pagination
              :current="sessionsPage + 1"
              :page-size="sessionsPageSize"
              :total="sessionsTotal"
              :page-size-options="['25', '50', '100', '200', '500']"
              :show-total="sessionsShowTotal"
              show-size-changer
              size="small"
              @change="onSessionsPage"
            />
          </a-flex>
        </a-card>
      </a-tab-pane>

      <!-- Per-proxy connection table -->
      <a-tab-pane key="proxies">
        <template #tab><span><ClusterOutlined />{{ t('admin.conn.tabProxies') }}</span></template>

        <div class="page">
          <!-- KPI strip -->
          <a-row :gutter="[12, 12]">
            <a-col :xs="12" :md="6">
              <a-card size="small" class="fill">
                <a-statistic :title="t('admin.conn.kpiOpen')" :value="summary.live" :formatter="fmtNum">
                  <template #prefix><LineChartOutlined /></template>
                </a-statistic>
                <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.conn.kpiOpenSub', { n: formatNumber(summary.conns) }) }}</a-typography-text>
              </a-card>
            </a-col>
            <a-col :xs="12" :md="6">
              <a-card size="small" class="fill">
                <a-statistic :title="t('admin.conn.kpiSpeed')" :value="formatRate(summary.bpsIn + summary.bpsOut) || '—'">
                  <template #prefix><DashboardOutlined /></template>
                </a-statistic>
                <a-typography-text type="secondary" class="kpi-sub">↑ {{ formatRate(summary.bpsOut) }} · ↓ {{ formatRate(summary.bpsIn) }}</a-typography-text>
              </a-card>
            </a-col>
            <a-col :xs="12" :md="6">
              <a-card size="small" class="fill">
                <a-statistic :title="t('admin.conn.kpiBwAll')" :value="summary.up + summary.down" :formatter="fmtBytes">
                  <template #prefix><GlobalOutlined /></template>
                </a-statistic>
                <a-typography-text type="secondary" class="kpi-sub">↑ {{ formatBytes(summary.up) }} · ↓ {{ formatBytes(summary.down) }}</a-typography-text>
              </a-card>
            </a-col>
            <a-col :xs="12" :md="6">
              <a-card size="small" class="fill">
                <a-statistic :title="t('admin.conn.kpiNodes')" :value="nodes.length">
                  <template #prefix><CloudServerOutlined /></template>
                </a-statistic>
                <a-typography-text type="secondary" class="kpi-sub">{{ t('admin.conn.kpiNodesSub', { n: filtered.length }) }}</a-typography-text>
              </a-card>
            </a-col>
          </a-row>

          <!-- Filters -->
          <a-card size="small">
            <a-form layout="inline" class="filters">
              <a-form-item :label="t('admin.conn.filterNode')">
                <a-select v-model:value="nodeFilter" :options="nodeOptions" style="width: 180px" />
              </a-form-item>
              <a-form-item :label="t('admin.conn.filterSearch')" class="grow">
                <a-input-search v-model:value="search" allow-clear :placeholder="t('admin.conn.searchPh')" />
              </a-form-item>
            </a-form>
          </a-card>

          <a-card :title="t('admin.conn.proxiesTitle', { n: filtered.length })" :body-style="{ padding: 0 }">
            <template #extra>
              <a-typography-text type="secondary" class="card-note">{{ t('admin.conn.proxiesNote') }}</a-typography-text>
            </template>
            <a-table
              v-model:expanded-row-keys="expandedKeys"
              :columns="proxyColumns"
              :data-source="filtered"
              :loading="loading"
              :pagination="pagination"
              row-key="proxyId"
              size="middle"
              expand-row-by-click
              :scroll="{ x: 640 }"
              :row-class-name="() => 'clickable'"
              :locale="{ emptyText: t('admin.conn.proxiesEmpty') }"
            >
              <template #bodyCell="{ column, record: r }">
                <template v-if="column.key === 'owner'">
                  <a-typography-text strong>{{ r.ownerEmail || '—' }}</a-typography-text>
                  <div><a-typography-text type="secondary" class="mono small">{{ r.proxyId }} · {{ r.type }}</a-typography-text></div>
                </template>
                <template v-else-if="column.key === 'node'">
                  <div>{{ r.nodeName }}</div>
                  <a-typography-text type="secondary" class="small">{{ r.zone || '—' }}</a-typography-text>
                </template>
                <template v-else-if="column.key === 'bind'">
                  <span class="mono">{{ r.ip || r.bindIp }}:{{ r.port }}</span>
                  <div v-if="r.ip && r.bindIp && r.ip !== r.bindIp">
                    <a-typography-text type="secondary" class="mono small">{{ t('admin.bw.egressPrefix') }}{{ r.bindIp }}</a-typography-text>
                  </div>
                </template>
                <template v-else-if="column.key === 'live'">
                  <a-typography-text strong :type="r.active ? 'success' : 'secondary'">{{ r.active }}</a-typography-text>
                  <div><a-typography-text type="secondary" class="small">{{ formatNumber(r.total) }}</a-typography-text></div>
                </template>
                <template v-else-if="column.key === 'bw'">
                  <span class="mono nowrap">↑ {{ formatBytes(r.uploadBytes) }}</span><br />
                  <span class="mono nowrap">↓ {{ formatBytes(r.downloadBytes) }}</span>
                </template>
                <template v-else-if="column.key === 'speed'">
                  <span class="mono nowrap">↑ {{ formatRate(r.bpsOut) }}</span><br />
                  <span class="mono nowrap">↓ {{ formatRate(r.bpsIn) }}</span>
                </template>
              </template>

              <template #expandedRowRender="{ record: r }">
                <a-flex vertical gap="middle">
                  <div>
                    <a-button size="small" @click="goDrillDown(r.proxyId)">{{ t('admin.conn.openDetail') }}</a-button>
                  </div>
                  <a-row :gutter="[16, 16]">
                    <a-col :xs="24" :lg="10">
                      <a-typography-text type="secondary" class="sub-title">{{ t('admin.conn.topDestSubTitle', { n: r.topTargets.length }) }}</a-typography-text>
                      <a-table
                        :columns="destColumns"
                        :data-source="r.topTargets"
                        :pagination="false"
                        row-key="host"
                        size="small"
                        bordered
                        :locale="{ emptyText: t('admin.conn.topDestEmpty') }"
                      >
                        <template #bodyCell="{ column: dc, record: dest }">
                          <template v-if="dc.key === 'host'">
                            <a-tooltip v-if="dest.geo?.cc" :title="dest.geo.country">
                              <span class="flag">{{ ccToFlag(dest.geo.cc) }}</span>
                            </a-tooltip>
                            <span class="mono">{{ dest.host }}</span>
                          </template>
                          <template v-else-if="dc.key === 'count'">{{ formatNumber(dest.count) }}</template>
                          <template v-else-if="dc.key === 'bytes'">
                            <span class="mono nowrap">{{ formatBytes(dest.bytesUp + dest.bytesDown) }}</span>
                          </template>
                          <template v-else-if="dc.key === 'block'">
                            <a-tooltip :title="t('admin.connDetail.blockTitle')">
                              <a-button size="small" type="text" danger @click="blockHost(dest.host)">
                                <template #icon><StopOutlined /></template>
                              </a-button>
                            </a-tooltip>
                          </template>
                        </template>
                      </a-table>
                    </a-col>
                    <a-col :xs="24" :lg="14">
                      <a-typography-text type="secondary" class="sub-title">{{ t('admin.conn.recentTitle', { n: r.recentConns.length }) }}</a-typography-text>
                      <a-table
                        :columns="recentColumns"
                        :data-source="withIdx(r.recentConns)"
                        :pagination="false"
                        row-key="_k"
                        size="small"
                        bordered
                        :locale="{ emptyText: t('admin.conn.recentEmpty') }"
                      >
                        <template #bodyCell="{ column: rc, record: c }">
                          <template v-if="rc.key === 'ago'">
                            <a-typography-text type="secondary" class="small">{{ fmtAgo(c.ts) }}</a-typography-text>
                          </template>
                          <template v-else-if="rc.key === 'src'">
                            <a-tooltip v-if="c.srcGeo?.cc" :title="c.srcGeo.country">
                              <span class="flag">{{ ccToFlag(c.srcGeo.cc) }}</span>
                            </a-tooltip>
                            <span class="mono">{{ c.src || '—' }}</span>
                          </template>
                          <template v-else-if="rc.key === 'target'">
                            <a-tooltip v-if="c.hostGeo?.cc" :title="c.hostGeo.country">
                              <span class="flag">{{ ccToFlag(c.hostGeo.cc) }}</span>
                            </a-tooltip>
                            <span class="mono">{{ c.host }}:{{ c.port }}</span>
                          </template>
                          <template v-else-if="rc.key === 'bytes'">
                            <span class="mono nowrap">{{ formatBytes(c.up + c.down) }}</span>
                          </template>
                        </template>
                      </a-table>
                    </a-col>
                  </a-row>
                </a-flex>
              </template>
            </a-table>
          </a-card>
        </div>
      </a-tab-pane>

      <!-- By client IP view -->
      <a-tab-pane key="sources">
        <template #tab><span><TeamOutlined />{{ t('admin.conn.tabSources') }}</span></template>

        <a-card :body-style="{ padding: 0 }">
          <template #title><TeamOutlined /> {{ t('admin.conn.srcTitle') }}</template>
          <a-flex align="center" gap="small" wrap="wrap" class="card-pad">
            <a-typography-text type="secondary">{{ t('admin.conn.srcWindow') }}</a-typography-text>
            <a-select v-model:value="sourcesHours" :options="sourceWindowOptions" style="width: 130px" @change="refresh" />
          </a-flex>
          <a-table
            :columns="sourceColumns"
            :data-source="sources"
            :loading="loading"
            :pagination="pagination"
            row-key="src"
            size="middle"
            :scroll="{ x: 640 }"
            :locale="{ emptyText: t('admin.conn.srcEmpty') }"
          >
            <template #bodyCell="{ column, record: s }">
              <template v-if="column.key === 'src'">
                <a-tooltip v-if="s.geo?.cc" :title="`${s.geo.country}${s.geo.asn ? ' · ' + s.geo.asn : ''}`">
                  <span class="flag">{{ ccToFlag(s.geo.cc) }}</span>
                </a-tooltip>
                <a-typography-text :copyable="{ text: s.src }" class="mono">{{ s.src }}</a-typography-text>
                <div v-if="s.geo?.asnOrg"><a-typography-text type="secondary" class="small">{{ s.geo.asnOrg }}</a-typography-text></div>
              </template>
              <template v-else-if="column.key === 'count'">{{ formatNumber(s.count) }}</template>
              <template v-else-if="column.key === 'proxyCount'">
                <a-typography-text :type="s.proxyCount > 1 ? 'warning' : undefined">{{ s.proxyCount }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'ownerCount'">
                <a-typography-text :type="s.ownerCount > 1 ? 'danger' : undefined">{{ s.ownerCount }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'bytes'">
                <span class="mono nowrap">{{ formatBytes((s.bytesUp || 0) + (s.bytesDown || 0)) }}</span>
              </template>
              <template v-else-if="column.key === 'last'">
                <a-typography-text type="secondary" class="small">{{ new Date(s.lastTs).toLocaleString('vi-VN') }}</a-typography-text>
              </template>
            </template>
          </a-table>
          <div class="card-pad">
            <a-typography-text type="secondary" class="card-note">{{ t('admin.conn.srcFooter') }}</a-typography-text>
          </div>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<style scoped>
.conn-tabs :deep(.ant-tabs-nav) { margin-bottom: 12px; }
.conn-tabs :deep(.ant-tabs-tab .anticon) { margin-inline-end: 6px; }
.tab-count { margin-inline: 6px 0; }
.sse-tag { margin-inline-end: 0; }
.card-pad { padding: 12px 16px; }
.card-note { font-size: 12px; font-weight: 400; }
.kpi-sub { font-size: 12px; }
.fill { height: 100%; }
.filters { row-gap: 8px; }
.filters .grow { flex: 1 1 240px; }
.f-host { flex: 1 1 240px; }
.f-src { flex: 0 1 240px; min-width: 180px; }
.f-kind { width: 180px; }
.small { font-size: 11.5px; }
.flag { margin-right: 4px; }
.kind-tag { text-transform: uppercase; font-size: 10.5px; font-weight: 600; }
.sub-title { display: block; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
:deep(.clickable) { cursor: pointer; }
</style>
