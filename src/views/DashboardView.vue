<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import { Empty } from 'ant-design-vue'
import { formatBytes, formatNumber } from '../utils/format'
import { apiFetch } from '../api'
import { isDark } from '../theme'
import StatusTag from '../components/ui/StatusTag.vue'

const apexchart = VueApexCharts.component || VueApexCharts
const router = useRouter()
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

// ── State ──────────────────────────────────────────────────────────────────
const dashboard = ref(null)
const tsRange = ref('1h')
const tsPoints = ref([])
const tsLoading = ref(false)
const tsTab = ref('conns') // conns | bandwidth
const refreshing = ref(false)
let pollTimer = null, tsTimer = null

async function loadDashboard() {
  refreshing.value = true
  try { dashboard.value = await apiFetch('/api/admin/dashboard') }
  catch { /* keep last */ }
  finally { refreshing.value = false }
}
async function loadTimeseries() {
  tsLoading.value = true
  try {
    const data = await apiFetch(`/api/admin/metrics/timeseries?range=${tsRange.value}`)
    tsPoints.value = data?.points || []
  } catch { /* keep last */ }
  finally { tsLoading.value = false }
}
function setTsRange(r) { tsRange.value = r; loadTimeseries() }

// ── Computed shortcuts ─────────────────────────────────────────────────────
const sys = computed(() => dashboard.value?.system || null)
const px = computed(() => dashboard.value?.proxies || { total: 0, active: 0, expired: 0, grace: 0, error: 0, ipv4: 0, ipv6: 0, expiringSoon: 0 })
const nd = computed(() => dashboard.value?.nodes || { total: 0, online: 0, offline: 0, list: [] })
const tr = computed(() => dashboard.value?.traffic || { liveConns: 0, totalConns: 0, uploadBytes: 0, downloadBytes: 0, monthBytes: 0 })
const tops = computed(() => dashboard.value?.topTargets || [])
const audit = computed(() => (dashboard.value?.recentAudit || []).map((a, i) => ({ ...a, _k: i })))
const saturation = computed(() => dashboard.value?.saturation || [])
const caps = computed(() => dashboard.value?.caps || { maxConnsPerProxy: 100, maxConnsPerSrcIp: 60, newConnsPerSecPerIp: 30 })

const verdict = computed(() => {
  if (px.value.expired > 0 || nd.value.offline > 0 || px.value.error > 0) return 'alert'
  if (px.value.expiringSoon > 0 || px.value.grace > 0) return 'warn'
  return 'ok'
})
const verdictBadge = computed(() => ({ ok: 'success', warn: 'warning', alert: 'error' })[verdict.value])

function fmtUptime(s) {
  if (!s) return '—'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`)
}
function pct(num, den) { return den > 0 ? Math.min(100, Math.round((num / den) * 100)) : 0 }

// ── Chart configs ──────────────────────────────────────────────────────────
const COLORS = { green: '#22c55e', blue: '#3b82f6', purple: '#8b5cf6', yellow: '#f59e0b', red: '#ef4444', cyan: '#06b6d4', grey: '#64748b' }
const chartText = computed(() => (isDark.value ? '#94a3b8' : '#64748b'))
const chartStrong = computed(() => (isDark.value ? '#e2e8f0' : '#1f2937'))
const chartBase = computed(() => ({
  chart: { toolbar: { show: false }, animations: { enabled: false }, background: 'transparent', fontFamily: 'inherit' },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  dataLabels: { enabled: false },
  grid: { borderColor: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', strokeDashArray: 2 },
  tooltip: { theme: isDark.value ? 'dark' : 'light' }
}))
const axisLabels = computed(() => ({ style: { colors: chartText.value, fontSize: '11px' } }))
const xFormat = computed(() => (tsRange.value === '1h' ? 'HH:mm' : 'dd/MM HH:mm'))

const connSeries = computed(() => [{ name: 'Kết nối live', data: tsPoints.value.map((p) => [p.ts, p.active || 0]) }])
const connOptions = computed(() => ({
  ...chartBase.value,
  chart: { ...chartBase.value.chart, type: 'area' },
  stroke: { curve: 'smooth', width: 2 },
  colors: [COLORS.green],
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.8, opacityFrom: 0.4, opacityTo: 0.02 } },
  xaxis: { type: 'datetime', labels: axisLabels.value },
  yaxis: { labels: { ...axisLabels.value, formatter: (v) => formatNumber(Math.round(v)) } },
  tooltip: { ...chartBase.value.tooltip, x: { format: xFormat.value } }
}))

const bwSeries = computed(() => [
  { name: 'Download', data: tsPoints.value.map((p) => [p.ts, (p.down ?? p.bpsIn) || 0]) },
  { name: 'Upload',   data: tsPoints.value.map((p) => [p.ts, (p.up   ?? p.bpsOut) || 0]) }
])
const bwOptions = computed(() => ({
  ...chartBase.value,
  chart: { ...chartBase.value.chart, type: 'area', stacked: true },
  stroke: { curve: 'smooth', width: 1.5 },
  colors: [COLORS.blue, COLORS.purple],
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.6, opacityFrom: 0.35, opacityTo: 0.05 } },
  xaxis: { type: 'datetime', labels: axisLabels.value },
  yaxis: { labels: { ...axisLabels.value, formatter: (v) => formatBytes(v) } },
  tooltip: { ...chartBase.value.tooltip, y: { formatter: (v) => formatBytes(v) }, x: { format: xFormat.value } },
  legend: { labels: { colors: chartText.value }, fontSize: '11px' }
}))

function donutOptions(labels, colors, totalLabel) {
  return {
    ...chartBase.value,
    chart: { ...chartBase.value.chart, type: 'donut' },
    labels,
    colors,
    legend: { position: 'bottom', labels: { colors: chartText.value }, fontSize: '11px', itemMargin: { horizontal: 6, vertical: 4 } },
    plotOptions: { pie: { donut: { size: '68%', labels: { show: true, name: { color: chartText.value, fontSize: '11px' }, value: { color: chartStrong.value, fontSize: '20px', fontWeight: 700 }, total: { show: true, label: totalLabel, color: chartText.value, formatter: () => px.value.total } } } } },
    stroke: { width: 0 }
  }
}

// Status donut — the server's `active` count includes the expiring-soon ones
const statusDonutSeries = computed(() => [Math.max(0, px.value.active - px.value.expiringSoon), px.value.expiringSoon, px.value.grace, px.value.expired, px.value.error])
const statusDonutOptions = computed(() => donutOptions(['Active', 'Sắp hết hạn', 'Grace', 'Hết hạn', 'Lỗi'], [COLORS.green, COLORS.yellow, COLORS.cyan, COLORS.red, COLORS.grey], 'Tổng'))

// Family donut
const familyDonutSeries = computed(() => [px.value.ipv4, px.value.ipv6])
const familyDonutOptions = computed(() => donutOptions(['IPv4', 'IPv6'], [COLORS.blue, COLORS.purple], 'Pool'))

// ── Tables ─────────────────────────────────────────────────────────────────
const FAMILY_COLOR = { ipv4: 'blue', ipv6: 'purple', dual: 'cyan' }
const METHOD_COLOR = { GET: 'green', POST: 'blue', PATCH: 'orange', PUT: 'orange', DELETE: 'red' }
function statusType(s) { return s >= 400 ? 'danger' : s >= 300 ? 'warning' : 'success' }

const topColumns = [
  { title: '#', key: 'rank', width: 44, align: 'right' },
  { title: 'Host', key: 'host', dataIndex: 'host', ellipsis: true },
  { title: '', key: 'share', width: 100 },
  { title: 'Bytes', key: 'bytes', width: 100, align: 'right' },
  { title: 'Req', key: 'count', width: 120, align: 'right' }
]
const auditColumns = [
  { title: 'Method', key: 'method', width: 84 },
  { title: 'Path', key: 'path', dataIndex: 'path', ellipsis: true },
  { title: 'Status', key: 'status', width: 70, align: 'center' },
  { title: 'Actor', key: 'actor', width: 140, ellipsis: true },
  { title: 'Time', key: 'ts', width: 84, align: 'right' }
]

// ── Nav helpers ────────────────────────────────────────────────────────────
function goNodes()   { router.push({ name: 'admin-nodes' }) }
function goProxies() { router.push({ name: 'admin-orders' }) }
function goSettings(){ router.push({ name: 'admin-features' }) }
function goConn(id)  { router.push({ name: 'admin-connection-detail', params: { proxyId: id } }) }

onMounted(() => {
  loadDashboard(); loadTimeseries()
  pollTimer = setInterval(() => loadDashboard(), 15_000)
  tsTimer   = setInterval(() => loadTimeseries(), 30_000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tsTimer)   clearInterval(tsTimer)
})
</script>

<template>
  <div class="page">
    <!-- ── Header bar: health verdict + version + refresh ─────────────────── -->
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-badge :status="verdictBadge" :text="verdict === 'ok' ? 'Tất cả ổn định' : verdict === 'warn' ? 'Cần chú ý' : 'Có sự cố'" />
      <a-space wrap>
        <a-typography-text v-if="sys" type="secondary" class="mono">v{{ sys.version }} · uptime {{ fmtUptime(sys.uptimeSeconds) }}</a-typography-text>
        <a-button :loading="refreshing" @click="loadDashboard">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-space>
    </a-flex>

    <!-- ── 6-card KPI hero ──────────────────────────────────────────────────── -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" hoverable class="kpi" @click="goProxies">
          <a-statistic title="Proxies" :value="formatNumber(px.active)" :suffix="`/ ${formatNumber(px.total)}`">
            <template #prefix><ClusterOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub"><span class="mono">{{ px.ipv4 }}</span> v4 · <span class="mono">{{ px.ipv6 }}</span> v6</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" hoverable class="kpi" @click="goNodes">
          <a-statistic title="Nodes" :value="nd.online" :suffix="`/ ${nd.total}`">
            <template #prefix><CloudServerOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text :type="nd.offline > 0 ? 'danger' : 'secondary'" class="kpi-sub">{{ nd.offline === 0 ? 'all online' : `${nd.offline} offline` }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" class="kpi">
          <a-statistic title="Live connections" :value="formatNumber(tr.liveConns)">
            <template #prefix><LinkOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">{{ formatNumber(tr.totalConns) }} all-time</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" class="kpi">
          <a-statistic title="Sắp hết hạn 7d" :value="px.expiringSoon">
            <template #prefix><WarningOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text :type="px.expired > 0 ? 'danger' : 'secondary'" class="kpi-sub">{{ px.expired }} expired</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" class="kpi">
          <a-statistic title="Băng thông tháng" :value="formatBytes(tr.monthBytes)">
            <template #prefix><HddOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">↑ {{ formatBytes(tr.uploadBytes) }} · ↓ {{ formatBytes(tr.downloadBytes) }}</a-typography-text>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="8" :xl="4">
        <a-card size="small" hoverable class="kpi" @click="goSettings">
          <a-statistic title="Cap (A/B/C)" :value="`${caps.maxConnsPerProxy}/${caps.maxConnsPerSrcIp}/${caps.newConnsPerSecPerIp}`" :value-style="{ fontFamily: 'var(--pb-mono)', fontSize: '20px' }">
            <template #prefix><SafetyOutlined class="kpi-icon" /></template>
          </a-statistic>
          <a-typography-text type="secondary" class="kpi-sub">proxy · IP · /s</a-typography-text>
        </a-card>
      </a-col>
    </a-row>

    <!-- ── Main timeseries (tabbed: conns | bandwidth) ──────────────────────── -->
    <a-card size="small">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <a-segmented
            v-model:value="tsTab"
            :options="[{ label: 'Kết nối live', value: 'conns' }, { label: 'Băng thông', value: 'bandwidth' }]"
          />
          <a-segmented
            :value="tsRange"
            :options="['1h', '24h', '7d', '30d']"
            @change="setTsRange"
          />
        </a-flex>
      </template>
      <a-spin :spinning="tsLoading && !tsPoints.length">
        <div class="chart-body">
          <a-empty v-if="!tsPoints.length">
            <template #description>Chưa có dữ liệu cho khoảng <strong>{{ tsRange }}</strong>. Biểu đồ tự cập nhật khi có request.</template>
          </a-empty>
          <apexchart v-else-if="tsTab === 'conns'" type="area" :options="connOptions" :series="connSeries" :height="280" />
          <apexchart v-else type="area" :options="bwOptions" :series="bwSeries" :height="280" />
        </div>
      </a-spin>
    </a-card>

    <!-- ── 3-col mid row: status donut + family donut + cap saturation ──────── -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="24" :md="12" :xl="7">
        <a-card size="small" title="Trạng thái proxy" class="full-height">
          <apexchart v-if="px.total" type="donut" :options="statusDonutOptions" :series="statusDonutSeries" :height="240" />
          <a-empty v-else :image="simpleImage" description="Chưa có proxy nào." />
        </a-card>
      </a-col>
      <a-col :xs="24" :md="12" :xl="7">
        <a-card size="small" title="Phân bổ family" class="full-height">
          <apexchart v-if="px.total" type="donut" :options="familyDonutOptions" :series="familyDonutSeries" :height="240" />
          <a-empty v-else :image="simpleImage" description="Chưa có proxy nào." />
        </a-card>
      </a-col>
      <a-col :xs="24" :xl="10">
        <a-card size="small" title="Cap saturation" class="full-height">
          <template #extra><a-typography-text type="secondary">≥50% cap A</a-typography-text></template>
          <a-list v-if="saturation.length" size="small" :data-source="saturation" :split="false">
            <template #renderItem="{ item: s }">
              <a-list-item class="clickable" @click="goConn(s.id)">
                <a-flex align="center" gap="small" class="full-width">
                  <a-tooltip :title="s.id"><span class="mono sat-id">{{ s.id }}</span></a-tooltip>
                  <a-progress
                    :percent="s.pct"
                    :show-info="false"
                    size="small"
                    :status="s.pct >= 80 ? 'exception' : 'success'"
                    class="sat-bar"
                  />
                  <a-typography-text :type="s.pct >= 80 ? 'warning' : 'secondary'" class="mono sat-num">{{ s.active }}/{{ s.max }}</a-typography-text>
                </a-flex>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-else :image="simpleImage" description="Không có proxy nào đang gần cap." />
        </a-card>
      </a-col>
    </a-row>

    <!-- ── Per-node load grid ───────────────────────────────────────────────── -->
    <a-card size="small">
      <template #title><CloudServerOutlined /> Nodes ({{ nd.list.length }})</template>
      <template #extra>
        <a-button type="link" size="small" @click="goNodes">Xem chi tiết <RightOutlined /></a-button>
      </template>
      <a-row v-if="nd.list.length" :gutter="[10, 10]">
        <a-col v-for="n in nd.list" :key="n.id" :xs="24" :sm="12" :xl="8" :xxl="6">
          <a-card size="small" :class="{ 'node-offline': n.status !== 'online' }">
            <a-flex align="center" gap="small">
              <a-tag :color="FAMILY_COLOR[n.family || 'dual'] || 'cyan'" :bordered="false" class="mono">{{ (n.family || 'dual').toUpperCase() }}</a-tag>
              <a-tooltip :title="n.name"><strong class="node-name">{{ n.name }}</strong></a-tooltip>
              <StatusTag :status="n.status" :color="n.status === 'online' ? 'success' : 'error'" />
            </a-flex>
            <a-typography-text type="secondary" class="mono node-host">{{ n.host }}</a-typography-text>
            <a-row :gutter="6" class="node-metrics">
              <a-col :span="8"><a-statistic title="Proxies" :value="n.proxies" :value-style="{ fontSize: '14px' }" /></a-col>
              <a-col :span="8"><a-statistic title="Active conn" :value="formatNumber(n.activeConns)" :value-style="{ fontSize: '14px', color: 'var(--pb-success)' }" /></a-col>
              <a-col :span="8"><a-statistic title="Bandwidth" :value="formatBytes(n.monthBytes)" :value-style="{ fontSize: '14px' }" /></a-col>
            </a-row>
            <a-progress :percent="pct(n.activeConns, Math.max(1, n.proxies * caps.maxConnsPerProxy))" :show-info="false" size="small" status="success" />
          </a-card>
        </a-col>
      </a-row>
      <a-empty v-else :image="simpleImage" description="Chưa có node nào." />
    </a-card>

    <!-- ── 2-col bottom: top destinations + recent activity ─────────────────── -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="24" :xl="12">
        <a-card size="small" :body-style="{ padding: 0 }" class="full-height">
          <template #title><GlobalOutlined /> Top destination hosts</template>
          <a-table
            :columns="topColumns"
            :data-source="tops"
            row-key="host"
            size="small"
            :pagination="false"
            :scroll="{ x: 500 }"
            :locale="{ emptyText: 'Chưa có traffic.' }"
          >
            <template #bodyCell="{ column, record, index }">
              <template v-if="column.key === 'rank'"><a-typography-text type="secondary" class="mono">{{ index + 1 }}</a-typography-text></template>
              <template v-else-if="column.key === 'host'"><span class="mono">{{ record.host }}</span></template>
              <template v-else-if="column.key === 'share'">
                <a-progress :percent="pct(record.bytes, tops[0]?.bytes)" :show-info="false" size="small" />
              </template>
              <template v-else-if="column.key === 'bytes'"><span class="mono">{{ formatBytes(record.bytes) }}</span></template>
              <template v-else-if="column.key === 'count'"><a-typography-text type="secondary">{{ formatNumber(record.count) }} req</a-typography-text></template>
            </template>
          </a-table>
        </a-card>
      </a-col>
      <a-col :xs="24" :xl="12">
        <a-card size="small" :body-style="{ padding: 0 }" class="full-height">
          <template #title><FileTextOutlined /> Recent activity</template>
          <a-table
            :columns="auditColumns"
            :data-source="audit"
            row-key="_k"
            size="small"
            :pagination="false"
            :scroll="{ x: 520 }"
            :locale="{ emptyText: 'Chưa có hoạt động.' }"
          >
            <template #bodyCell="{ column, record: a }">
              <template v-if="column.key === 'method'">
                <a-tag :color="METHOD_COLOR[(a.method || '').toUpperCase()] || 'default'" :bordered="false" class="mono">{{ a.method }}</a-tag>
              </template>
              <template v-else-if="column.key === 'path'">
                <a-tooltip :title="a.path"><span class="mono">{{ a.path }}</span></a-tooltip>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-typography-text v-if="a.status" :type="statusType(a.status)" class="mono">{{ a.status }}</a-typography-text>
                <a-typography-text v-else type="secondary">—</a-typography-text>
              </template>
              <template v-else-if="column.key === 'actor'"><a-typography-text type="secondary">{{ a.actor || '—' }}</a-typography-text></template>
              <template v-else-if="column.key === 'ts'"><a-typography-text type="secondary" class="mono">{{ a.ts ? a.ts.slice(11, 19) : '' }}</a-typography-text></template>
            </template>
          </a-table>
        </a-card>
      </a-col>
    </a-row>

    <!-- ── System health strip (footer) ─────────────────────────────────────── -->
    <a-card v-if="sys" size="small">
      <a-row :gutter="[16, 12]">
        <a-col :xs="12" :sm="8" :lg="4">
          <a-statistic title="Heap RAM" :value="formatBytes(sys.memory.heapUsed)" :suffix="`/ ${formatBytes(sys.memory.heapTotal)}`" :value-style="{ fontSize: '15px' }" class="mono-stat" />
          <a-progress :percent="pct(sys.memory.heapUsed, sys.memory.heapTotal)" :show-info="false" size="small" status="success" />
        </a-col>
        <a-col :xs="12" :sm="8" :lg="4"><a-statistic title="RSS" :value="formatBytes(sys.memory.rss)" :value-style="{ fontSize: '15px' }" class="mono-stat" /></a-col>
        <a-col :xs="12" :sm="8" :lg="4"><a-statistic title="Listeners" :value="sys.listeners" :value-style="{ fontSize: '15px' }" class="mono-stat" /></a-col>
        <a-col :xs="12" :sm="8" :lg="4"><a-statistic title="Sessions" :value="sys.sessions.active" :value-style="{ fontSize: '15px' }" class="mono-stat" /></a-col>
        <a-col :xs="12" :sm="8" :lg="4"><a-statistic title="Users" :value="formatNumber(sys.users)" :value-style="{ fontSize: '15px' }" class="mono-stat" /></a-col>
        <a-col :xs="12" :sm="8" :lg="4"><a-statistic title="DB size" :value="formatBytes(sys.dbSize)" :value-style="{ fontSize: '15px' }" class="mono-stat" /></a-col>
      </a-row>
    </a-card>
  </div>
</template>

<style scoped>
.kpi { height: 100%; }
.kpi-icon { font-size: 16px; margin-inline-end: 4px; opacity: 0.75; }
.kpi-sub { font-size: 12px; }
.card-head-controls { padding: 8px 0; }
.card-head-controls :deep(.ant-segmented) { font-weight: 400; }
.chart-body { min-height: 280px; display: flex; flex-direction: column; justify-content: center; }
.full-height { height: 100%; }
.clickable { cursor: pointer; }
.sat-id { width: 110px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }
.sat-bar { flex: 1; margin: 0; }
.sat-num { width: 70px; flex-shrink: 0; text-align: right; }
.node-offline { opacity: 0.6; }
.node-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-host { display: block; margin: 4px 0 8px; font-size: 12px; }
.node-metrics { margin-bottom: 6px; }
.node-metrics :deep(.ant-statistic-title) { font-size: 11px; margin-bottom: 0; }
.mono-stat :deep(.ant-statistic-content) { font-family: var(--pb-mono); }
</style>
