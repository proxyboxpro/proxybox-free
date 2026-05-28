<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VueApexCharts from 'vue3-apexcharts'
import { Activity, ArrowLeft, Ban, RefreshCw, Search } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber, formatRate } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
}

const apexchart = VueApexCharts.component || VueApexCharts
const route = useRoute()
const router = useRouter()
const proxyId = computed(() => route.params.proxyId)

const summary = ref(null)
const events = ref([])
const topHosts = ref([])
const history = ref([])
const hostFilter = ref('')
const srcFilter = ref('')
const range = ref('24h')
const err = ref('')
const loading = ref(false)
let timer = null

async function loadSummary() {
  try {
    const all = await apiFetch('/api/admin/connections')
    summary.value = all.find((r) => r.proxyId === proxyId.value) || null
  } catch (e) { err.value = e.message }
}
function rangeToHours() { return range.value === '1h' ? 1 : range.value === '24h' ? 24 : range.value === '7d' ? 168 : 720 }
async function loadHistory() {
  try {
    // hourly traffic
    const hr = await apiFetch(`/api/admin/metrics/timeseries?range=${range.value === '1h' ? '1h' : (range.value === '24h' ? '24h' : (range.value === '7d' ? '7d' : '30d'))}`)
    history.value = hr?.points || []
  } catch { history.value = [] }
}
async function loadTopHosts() {
  try {
    const r = await apiFetch(`/api/admin/connections/${proxyId.value}/top-hosts?hours=${rangeToHours()}`)
    topHosts.value = r?.hosts || []
  } catch { topHosts.value = [] }
}
async function loadEvents() {
  loading.value = true
  try {
    const since = Date.now() - rangeToHours() * 3600_000
    let qs = `from=${since}&limit=300`
    if (hostFilter.value) qs += `&host=${encodeURIComponent(hostFilter.value)}`
    if (srcFilter.value) qs += `&src=${encodeURIComponent(srcFilter.value)}`
    const r = await apiFetch(`/api/admin/connections/${proxyId.value}/events?${qs}`)
    events.value = r?.events || []
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function refresh() { await Promise.all([loadSummary(), loadHistory(), loadTopHosts(), loadEvents()]) }
async function blockHost(host) {
  if (!confirm(t('admin.connDetail.confirmBlock', { host }))) return
  try {
    await apiFetch('/api/admin/deny-hosts', { method: 'POST', body: { host } })
    alert(t('admin.connDetail.blocked', { host }))
  } catch (e) { alert(t('admin.connDetail.blockErr', { msg: e.message })) }
}

watch(range, refresh)
onMounted(() => { refresh(); timer = setInterval(refresh, 10_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const bwSeries = computed(() => [
  { name: 'Bytes ↓', data: history.value.map((p) => [p.ts, p.down || 0]) },
  { name: 'Bytes ↑', data: history.value.map((p) => [p.ts, p.up || 0]) }
])
const bwOptions = computed(() => ({
  chart: { type: 'area', toolbar: { show: false }, animations: { enabled: false }, background: 'transparent', stacked: true },
  theme: { mode: 'dark' },
  stroke: { curve: 'smooth', width: 1.5 },
  dataLabels: { enabled: false },
  colors: ['#3b82f6', '#8b5cf6'],
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.6, opacityFrom: 0.4, opacityTo: 0.05 } },
  grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 2 },
  xaxis: { type: 'datetime', labels: { style: { colors: '#94a3b8', fontSize: '11px' } } },
  yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (v) => formatBytes(v) } },
  tooltip: { theme: 'dark', y: { formatter: (v) => formatBytes(v) } },
  legend: { labels: { colors: '#94a3b8' } }
}))
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <button class="ghost-button" type="button" @click="router.push({ name: 'admin-connections' })"><ArrowLeft :size="13" /></button>
      <span class="eyebrow"><Activity :size="14" style="vertical-align:-2px" /> {{ t('admin.connDetail.proxyLabel') }} <span class="cell-mono">{{ proxyId }}</span></span>
      <div class="spacer"></div>
      <div class="segment-tabs">
        <button type="button" :class="{ active: range === '1h' }" @click="range = '1h'">1h</button>
        <button type="button" :class="{ active: range === '24h' }" @click="range = '24h'">24h</button>
        <button type="button" :class="{ active: range === '7d' }" @click="range = '7d'">7d</button>
        <button type="button" :class="{ active: range === '30d' }" @click="range = '30d'">30d</button>
      </div>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh"><RefreshCw :size="12" /></button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- Summary -->
    <section v-if="summary" class="surface">
      <div class="metric-cards">
        <article><span>{{ t('admin.connDetail.owner') }}</span><strong style="font-size:14px">{{ summary.ownerEmail || '—' }}</strong><small style="color:var(--muted);font-size:11.5px">{{ summary.ownerId }}</small></article>
        <article><span>{{ t('admin.connDetail.host') }}</span><strong class="cell-mono" style="font-size:13px">{{ summary.ip || summary.bindIp }}:{{ summary.port }}</strong><small style="color:var(--muted);font-size:11.5px">{{ t('admin.connDetail.egressPrefix') }}{{ summary.bindIp }} · {{ summary.nodeName }} · {{ summary.zone }}</small></article>
        <article><span>{{ t('admin.connDetail.open') }}</span><strong :style="{color: summary.active ? 'var(--green)' : 'var(--muted)'}">{{ summary.active }}</strong><small style="color:var(--muted);font-size:11.5px">{{ t('admin.connDetail.allTime', { n: formatNumber(summary.total) }) }}</small></article>
        <article><span>{{ t('admin.connDetail.bandwidth') }}</span><strong style="font-size:14px">{{ formatBytes(summary.uploadBytes + summary.downloadBytes) }}</strong><small style="color:var(--muted);font-size:11.5px">↑ {{ formatRate(summary.bpsOut) }} · ↓ {{ formatRate(summary.bpsIn) }}</small></article>
      </div>
    </section>

    <!-- Bandwidth chart -->
    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.connDetail.bwTitle', { range }) }}</h2></div>
      <p v-if="!history.length" class="empty-text" style="padding:24px 0">{{ t('admin.connDetail.bwEmpty') }}</p>
      <apexchart v-else type="area" :options="bwOptions" :series="bwSeries" :height="240" />
    </section>

    <!-- Top hosts in window -->
    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.connDetail.topTitle', { range }) }}</h2></div>
      <p v-if="!topHosts.length" class="empty-text">{{ t('admin.connDetail.topEmpty') }}</p>
      <div v-if="topHosts.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 2fr 80px 1fr 1fr 32px">
          <span>{{ t('admin.connDetail.colHost') }}</span>
          <span style="text-align:right">{{ t('admin.connDetail.colHits') }}</span>
          <span style="text-align:right">{{ t('admin.connDetail.colBytes') }}</span>
          <span style="text-align:right">{{ t('admin.connDetail.colLast') }}</span>
          <span></span>
        </div>
        <div v-for="h in topHosts" :key="h.host" class="table-row" style="grid-template-columns: 2fr 80px 1fr 1fr 32px">
          <span class="cell-mono" style="font-size:12.5px">
            <span v-if="h.geo?.cc" :title="`${h.geo.country}${h.geo.asn ? ' · ' + h.geo.asn : ''}`" style="margin-right:4px">{{ ccToFlag(h.geo.cc) }}</span>{{ h.host }}
          </span>
          <span style="text-align:right">{{ formatNumber(h.count) }}</span>
          <span class="cell-mono" style="text-align:right; font-size:12px">{{ formatBytes(h.bytesUp + h.bytesDown) }}</span>
          <span style="text-align:right; color:var(--muted); font-size:11.5px">{{ new Date(h.lastTs).toLocaleString('vi-VN') }}</span>
          <button class="icon-button" type="button" :title="t('admin.connDetail.blockTitle')" @click="blockHost(h.host)"><Ban :size="12" /></button>
        </div>
      </div>
    </section>

    <!-- Event log -->
    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.connDetail.evLogTitle', { n: events.length }) }}</h2></div>
      <div class="ord-filters">
        <div class="filter-row">
          <label class="filter-field"><Search :size="13" /><input v-model="hostFilter" :placeholder="t('admin.connDetail.filterHost')" @input="loadEvents" /></label>
          <label class="filter-field"><Search :size="13" /><input v-model="srcFilter" :placeholder="t('admin.connDetail.filterSrc')" @input="loadEvents" /></label>
        </div>
      </div>
      <p v-if="!events.length && !loading" class="empty-text">{{ t('admin.connDetail.evEmpty') }}</p>
      <div v-if="events.length" class="data-table" style="margin-top:10px">
        <div class="table-head" style="grid-template-columns: 1.3fr 0.9fr 2fr 70px 60px 1fr">
          <span>{{ t('admin.connDetail.colWhen') }}</span>
          <span>{{ t('admin.connDetail.colClient') }}</span>
          <span>{{ t('admin.connDetail.colTarget') }}</span>
          <span style="text-align:right">{{ t('admin.connDetail.colBytes') }}</span>
          <span style="text-align:right">{{ t('admin.connDetail.colMs') }}</span>
          <span>{{ t('admin.connDetail.colKind') }}</span>
        </div>
        <div v-for="(c, i) in events" :key="i" class="table-row" style="grid-template-columns: 1.3fr 0.9fr 2fr 70px 60px 1fr">
          <span style="font-size:11.5px; color:var(--muted)">{{ new Date(c.ts).toLocaleString('vi-VN') }}</span>
          <span class="cell-mono" style="font-size:11.5px">
            <span v-if="c.srcGeo?.cc" :title="c.srcGeo.country" style="margin-right:3px">{{ ccToFlag(c.srcGeo.cc) }}</span>{{ c.src || '—' }}
          </span>
          <span class="cell-mono" style="font-size:11.5px">
            <span v-if="c.hostGeo?.cc" :title="c.hostGeo.country" style="margin-right:3px">{{ ccToFlag(c.hostGeo.cc) }}</span>{{ c.host }}:{{ c.port }}
          </span>
          <span class="cell-mono" style="text-align:right; font-size:11.5px">{{ formatBytes((c.up || 0) + (c.dn || c.down || 0)) }}</span>
          <span class="cell-mono" style="text-align:right; font-size:11.5px">{{ c.ms }}</span>
          <span style="font-size:11.5px; color:var(--muted)">{{ c.kind }}</span>
        </div>
      </div>
    </section>
  </section>
</template>
