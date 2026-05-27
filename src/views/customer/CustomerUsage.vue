<script setup>
import { computed, onMounted, ref } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import {
  Activity, ArrowDown, ArrowUp, BarChart3, Layers, RefreshCw, Search, Wifi
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { formatBytes } from '../../utils/format'
import CountryFlag from '../../components/CountryFlag.vue'

const apexchart = VueApexCharts.component || VueApexCharts
const { t } = useI18n()
const data = ref(null)
const err = ref('')
const search = ref('')
const ppWin = ref('30d')   // per-proxy table window: '24h' | '30d'

async function refresh() {
  err.value = ''
  try { data.value = await apiFetch('/api/v1/user/usage/summary') }
  catch (e) { err.value = e.message }
}

function fmtRate(bps) { return bps ? `${formatBytes(bps)}/s` : '0 B/s' }
function countryFromZone(z) {
  z = String(z || '').toLowerCase()
  if (z.startsWith('vn')) return 'VN'
  if (z.startsWith('us')) return 'US'
  if (z.startsWith('uk') || z.startsWith('gb')) return 'GB'
  if (z.startsWith('de')) return 'DE'
  if (z.startsWith('jp')) return 'JP'
  if (z.startsWith('sg')) return 'SG'
  if (z.startsWith('hk')) return 'HK'
  return 'GLOBAL'
}
function hoursAgoLabel(idx, total) {
  const ago = total - 1 - idx
  if (ago === 0) return t('cust.usage.now')
  if (ago < 24) return `-${ago}h`
  return `-${Math.round(ago / 24)}d`
}

const totals = computed(() => data.value?.totals || { upload: 0, download: 0, conns: 0, proxyCount: 0 })
const totalBytes = computed(() => (totals.value.upload || 0) + (totals.value.download || 0))
const quotaGB = computed(() => Number(data.value?.quotaGB) || 0)

// Accurate cumulative transferred volume over rolling windows (from conn_events).
const EMPTY_WIN = { up: 0, down: 0 }
const windows = computed(() => data.value?.windows || { h1: EMPTY_WIN, h24: EMPTY_WIN, d30: EMPTY_WIN })
const windowCards = computed(() => {
  const w = windows.value
  return [
    { key: 'h1',  label: t('cust.usage.win1h'),  up: w.h1?.up || 0,  down: w.h1?.down || 0 },
    { key: 'h24', label: t('cust.usage.win24h'), up: w.h24?.up || 0, down: w.h24?.down || 0 },
    { key: 'd30', label: t('cust.usage.win30d'), up: w.d30?.up || 0, down: w.d30?.down || 0 }
  ]
})

// Normalize hourly into 24 fixed buckets — pad with zeros if API returns less.
// No synthetic data: flat-empty is honest when no traffic yet.
const buckets = computed(() => {
  const h = data.value?.hourly || []
  const n = 24
  const out = []
  const start = Math.max(0, h.length - n)
  const slice = h.slice(start)
  const pad = n - slice.length
  const now = Date.now()
  for (let i = 0; i < pad; i += 1) {
    out.push({ uploadBytes: 0, downloadBytes: 0, ts: now - (n - i) * 3600_000 })
  }
  for (let i = 0; i < slice.length; i += 1) {
    const r = slice[i]
    out.push({
      uploadBytes: Number(r.uploadBytes || 0),
      downloadBytes: Number(r.downloadBytes || 0),
      ts: r.ts ? new Date(r.ts).getTime() : (now - (slice.length - i) * 3600_000)
    })
  }
  return out
})
const hasUsageData = computed(() => buckets.value.some((b) => b.uploadBytes > 0 || b.downloadBytes > 0))
const maxY = computed(() => buckets.value.reduce((m, b) => Math.max(m, b.uploadBytes, b.downloadBytes), 0))

// ApexCharts series + options
const chartSeries = computed(() => [
  { name: t('cust.usage.up'),   data: buckets.value.map((b) => [b.ts, b.uploadBytes]) },
  { name: t('cust.usage.down'), data: buckets.value.map((b) => [b.ts, b.downloadBytes]) }
])
const chartOptions = computed(() => ({
  chart: { type: 'area', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 350 }, background: 'transparent', fontFamily: 'inherit' },
  theme: { mode: 'dark' },
  colors: ['#22c55e', '#3b82f6'],
  stroke: { curve: 'smooth', width: 2 },
  dataLabels: { enabled: false },
  fill: { type: 'gradient', gradient: { shadeIntensity: 0.8, opacityFrom: 0.45, opacityTo: 0.04, stops: [0, 100] } },
  grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 3, padding: { top: 6, right: 12, bottom: 0, left: 6 } },
  xaxis: {
    type: 'datetime',
    labels: { style: { colors: '#94a3b8', fontSize: '11px', fontFamily: 'ui-monospace, monospace' }, datetimeUTC: false },
    axisBorder: { show: false }, axisTicks: { color: 'rgba(255,255,255,0.1)' }
  },
  yaxis: {
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px', fontFamily: 'ui-monospace, monospace' },
      formatter: (v) => formatBytes(v)
    }
  },
  tooltip: {
    theme: 'dark',
    x: { format: 'HH:mm dd/MM' },
    y: { formatter: (v) => formatBytes(v) }
  },
  legend: { show: false }
}))

// ── Donut: upload vs download split ─────────────────────────────────────────
const donut = computed(() => {
  const up = totals.value.upload || 0
  const dn = totals.value.download || 0
  const total = up + dn
  if (total === 0) return { upPct: 0, dnPct: 0, upDash: 0, dnDash: 0, circ: 2 * Math.PI * 36 }
  const upPct = up / total
  const dnPct = dn / total
  const C = 2 * Math.PI * 36
  return { upPct, dnPct, upDash: upPct * C, dnDash: dnPct * C, circ: C }
})

// ── Per-proxy table data ────────────────────────────────────────────────────
// Per-proxy up/down for the selected window (accurate, from conn_events). Falls
// back to since-restart counters if the backend didn't attach window data.
function proxyWin(p) {
  const w = ppWin.value === '24h' ? p.win24 : p.win30
  if (w) return { up: w.up || 0, down: w.down || 0 }
  return { up: p.uploadBytes || 0, down: p.downloadBytes || 0 }
}
const rows = computed(() => {
  const r = (data.value?.perProxy || []).map((p) => {
    const w = proxyWin(p)
    return { ...p, wUp: w.up, wDown: w.down, total: w.up + w.down }
  })
  const max = Math.max(1, ...r.map((p) => p.total))
  return r
    .filter((p) => {
      if (!search.value) return true
      const q = search.value.toLowerCase()
      return `${p.name || ''} ${p.bindIp || ''} ${p.port || ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => b.total - a.total)
    .map((p) => ({ ...p, share: Math.min(100, Math.round((p.total / max) * 100)) }))
})

onMounted(refresh)
</script>

<template>
  <h1>{{ t('cust.usage.title') }}</h1>
  <p class="sub">{{ t('cust.usage.subtitle') }}</p>

  <p v-if="err" class="error-text">{{ err }}</p>

  <!-- KPI row -->
  <div class="kpi-row" style="grid-template-columns: repeat(5, 1fr)">
    <div class="kpi-card-v2">
      <span class="ico purple"><Activity :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.kpiTotal') }}</span>
        <span class="val" style="font-size:20px">{{ formatBytes(totalBytes) }}</span>
        <span class="foot"><span class="dot"></span> {{ t('cust.billing.thisMonth') }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico green"><ArrowUp :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.kpiUpload') }}</span>
        <span class="val" style="font-size:20px">{{ formatBytes(totals.upload) }}</span>
        <span class="foot"><span class="dot"></span> ↑ outbound</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico blue"><ArrowDown :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.kpiDownload') }}</span>
        <span class="val" style="font-size:20px">{{ formatBytes(totals.download) }}</span>
        <span class="foot"><span class="dot"></span> ↓ inbound</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico amber"><Wifi :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.kpiConns') }}</span>
        <span class="val">{{ Number(totals.conns || 0).toLocaleString() }}</span>
        <span class="foot"><span class="dot"></span> {{ t('cust.usage.totalConns') }}</span>
      </div>
    </div>
    <div class="kpi-card-v2" v-if="quotaGB > 0">
      <span class="ico" :class="(totalBytes / 1e9) > quotaGB ? 'red' : 'green'"><ArrowUp :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.quotaLabel') }}</span>
        <span class="val" style="font-size:20px">{{ (totalBytes / 1e9).toFixed(1) }} / {{ quotaGB }} GB</span>
        <span class="foot"><span class="dot"></span> {{ t('cust.usage.quotaFoot') }}</span>
      </div>
    </div>
    <div class="kpi-card-v2">
      <span class="ico rose"><Layers :size="22" /></span>
      <div class="body">
        <span class="lbl">{{ t('cust.usage.kpiProxyCount') }}</span>
        <span class="val">{{ totals.proxyCount }}</span>
        <span class="foot"><span class="dot"></span> {{ t('cust.proxies.kpiTotalSub') }}</span>
      </div>
    </div>
  </div>

  <!-- Accurate cumulative traffic totals over 1h / 24h / 30d -->
  <section class="surface bw-windows-wrap">
    <div class="bw-windows-head">
      <h2><BarChart3 :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.usage.windowsTitle') }}</h2>
      <span class="bw-windows-hint">{{ t('cust.usage.windowsHint') }}</span>
    </div>
    <div class="bw-windows">
      <article v-for="w in windowCards" :key="w.key" class="bw-win-card">
        <span class="bw-win-label">{{ w.label }}</span>
        <strong class="bw-win-total cell-mono">{{ formatBytes(w.up + w.down) }}</strong>
        <div class="bw-win-split">
          <span class="cell-mono" style="color:#4ade80"><ArrowUp :size="12" style="vertical-align:-2px" /> {{ formatBytes(w.up) }}</span>
          <span class="cell-mono" style="color:#60a5fa"><ArrowDown :size="12" style="vertical-align:-2px" /> {{ formatBytes(w.down) }}</span>
        </div>
      </article>
    </div>
  </section>

  <!-- Main chart + donut split -->
  <div style="display:grid; grid-template-columns: 1fr 280px; gap:14px; margin-bottom:14px">
    <!-- Dual-line area chart -->
    <section class="surface" style="padding:18px">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px">
        <h2 style="margin:0; color:var(--text); font-size:15px"><BarChart3 :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.usage.chart24h') }}</h2>
        <div v-if="hasUsageData" style="display:inline-flex; gap:14px; font-size:12px; color:var(--muted)">
          <span style="display:inline-flex; align-items:center; gap:6px"><span style="width:12px; height:3px; background:#4ade80; border-radius:2px"></span> {{ t('cust.usage.up') }}</span>
          <span style="display:inline-flex; align-items:center; gap:6px"><span style="width:12px; height:3px; background:#60a5fa; border-radius:2px"></span> {{ t('cust.usage.down') }}</span>
          <span>{{ t('cust.usage.peak') }} ≈ <span class="cell-mono" style="color:var(--text)">{{ formatBytes(maxY) }}</span></span>
        </div>
      </div>

      <!-- ApexCharts area chart — smooth gradient + hover tooltip + responsive. Renders
           empty (flat zero) when no traffic yet — that's an honest "no data" signal. -->
      <apexchart type="area" height="280" :options="chartOptions" :series="chartSeries" />
      <p v-if="!hasUsageData" style="margin-top:-30px; padding:14px 20px; text-align:center; color:var(--muted); font-size:12.5px">
        {{ t('cust.usage.empty') }}
      </p>
    </section>

    <!-- Donut: upload vs download split -->
    <section class="surface" style="padding:18px; display:flex; flex-direction:column; gap:10px">
      <h2 style="margin:0; color:var(--text); font-size:15px">{{ t('cust.usage.split') }}</h2>

      <div style="display:flex; align-items:center; justify-content:center; padding:8px 0">
        <svg viewBox="0 0 100 100" width="160" height="160">
          <!-- Background ring -->
          <circle cx="50" cy="50" r="36" fill="none" stroke="#232a36" stroke-width="14" />
          <!-- Upload arc -->
          <circle
            cx="50" cy="50" r="36" fill="none"
            stroke="#4ade80" stroke-width="14"
            :stroke-dasharray="`${donut.upDash} ${donut.circ}`"
            stroke-dashoffset="0"
            transform="rotate(-90 50 50)"
            stroke-linecap="round"
          />
          <!-- Download arc -->
          <circle
            cx="50" cy="50" r="36" fill="none"
            stroke="#60a5fa" stroke-width="14"
            :stroke-dasharray="`${donut.dnDash} ${donut.circ}`"
            :stroke-dashoffset="-donut.upDash"
            transform="rotate(-90 50 50)"
            stroke-linecap="round"
          />
          <!-- Center label -->
          <text x="50" y="48" text-anchor="middle" font-size="9" fill="#7d8590" font-family="ui-monospace, monospace">{{ t('cust.usage.kpiTotal') }}</text>
          <text x="50" y="60" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="ui-monospace, monospace">{{ formatBytes(totalBytes) }}</text>
        </svg>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px">
        <div style="display:flex; align-items:center; gap:10px; padding:8px; background:var(--pxl-card-2); border-radius:8px">
          <span style="width:10px; height:10px; border-radius:50%; background:#4ade80; flex:none"></span>
          <span style="flex:1; color:var(--text); font-size:12.5px">{{ t('cust.usage.up') }}</span>
          <span class="cell-mono" style="color:#4ade80">{{ Math.round(donut.upPct * 100) }}%</span>
          <span class="cell-mono" style="color:var(--muted); font-size:11px">{{ formatBytes(totals.upload) }}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; padding:8px; background:var(--pxl-card-2); border-radius:8px">
          <span style="width:10px; height:10px; border-radius:50%; background:#60a5fa; flex:none"></span>
          <span style="flex:1; color:var(--text); font-size:12.5px">{{ t('cust.usage.down') }}</span>
          <span class="cell-mono" style="color:#60a5fa">{{ Math.round(donut.dnPct * 100) }}%</span>
          <span class="cell-mono" style="color:var(--muted); font-size:11px">{{ formatBytes(totals.download) }}</span>
        </div>
      </div>
    </section>
  </div>

  <!-- Per-proxy table -->
  <section class="dt2">
    <div class="dt2-toolbar">
      <h2 style="margin:0; color:var(--text); font-size:15px">{{ t('cust.usage.perProxy') }} ({{ rows.length }})</h2>
      <div class="ppwin-pills" :title="t('cust.usage.ppWindow')">
        <button type="button" :class="{ active: ppWin === '24h' }" @click="ppWin = '24h'">24h</button>
        <button type="button" :class="{ active: ppWin === '30d' }" @click="ppWin = '30d'">30d</button>
      </div>
      <div class="spacer"></div>
      <div class="search-box">
        <Search :size="14" />
        <input v-model="search" type="search" :placeholder="t('cust.proxies.searchPlaceholder')" />
      </div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /></button>
    </div>

    <div class="dt2-head" style="grid-template-columns: 1.2fr 1.2fr 1fr 0.9fr 0.9fr 1fr 1.4fr">
      <span>{{ t('cust.col.name') }}</span>
      <span>{{ t('cust.col.endpoint') }}</span>
      <span>{{ t('cust.col.country') }}</span>
      <span>{{ t('cust.usage.up') }}</span>
      <span>{{ t('cust.usage.down') }}</span>
      <span>{{ t('cust.usage.live') }}</span>
      <span>{{ t('cust.usage.share') }}</span>
    </div>

    <div v-for="p in rows" :key="p.id" class="dt2-row" style="grid-template-columns: 1.2fr 1.2fr 1fr 0.9fr 0.9fr 1fr 1.4fr">
      <span class="name">{{ p.name || p.id }}</span>
      <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
      <span class="country"><CountryFlag :code="countryFromZone(p.zone)" :size="18" /> {{ p.zone || 'auto' }}</span>
      <span class="cell-mono" style="color:#4ade80">{{ formatBytes(p.wUp || 0) }}</span>
      <span class="cell-mono" style="color:#60a5fa">{{ formatBytes(p.wDown || 0) }}</span>
      <span class="cell-mono" style="font-size:11.5px">↑{{ fmtRate(p.bpsOut) }} ↓{{ fmtRate(p.bpsIn) }}</span>
      <span class="usage-bar">
        <span class="vals">{{ formatBytes(p.total) }}</span>
        <span class="bar"><span :style="{ width: p.share + '%' }"></span></span>
      </span>
    </div>

    <p v-if="!rows.length" class="empty-text" style="padding:30px">{{ t('cust.usage.empty') }}</p>
  </section>
</template>

<style scoped>
.bw-windows-wrap { padding: 16px 18px; margin-bottom: 14px; }
.bw-windows-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.bw-windows-head h2 { margin: 0; color: var(--text); font-size: 15px; }
.bw-windows-hint { font-size: 12px; color: var(--muted); }
.bw-windows { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.bw-win-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px; border-radius: 10px;
  background: var(--pxl-card-2, rgba(255,255,255,0.03));
  border: 1px solid var(--border);
}
.bw-win-label { font-size: 12.5px; color: var(--muted); }
.bw-win-total { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1.1; }
.bw-win-split { display: flex; gap: 16px; font-size: 12px; margin-top: 2px; }

.ppwin-pills { display: inline-flex; padding: 2px; background: rgba(255,255,255,0.05); border-radius: 7px; gap: 2px; margin-left: 10px; }
.ppwin-pills button {
  padding: 4px 12px; font-size: 11.5px; font-family: var(--mono);
  background: transparent; color: var(--muted); border: none; cursor: pointer; border-radius: 5px;
}
.ppwin-pills button.active { background: var(--surface, rgba(255,255,255,0.08)); color: var(--pxl, var(--green)); font-weight: 600; }

@media (max-width: 720px) {
  .bw-windows { grid-template-columns: 1fr; }
}
</style>
