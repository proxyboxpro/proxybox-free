<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, Download, Globe, RefreshCw, Server, Users } from 'lucide-vue-next'
import { apiFetch } from '../../api'

const stats = ref(null)
const err = ref('')
const loading = ref(false)
let pollHandle = null

async function refresh() {
  loading.value = true; err.value = ''
  try { stats.value = await apiFetch('/api/admin/downloads/stats') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

onMounted(() => {
  refresh()
  // Auto-refresh every 60s so admin can leave the tab open during a launch
  // and see counters tick up without a manual reload.
  pollHandle = setInterval(refresh, 60_000)
})
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })

// Friendly labels for the kind enum surfaced by the API.
const KIND_LABEL = {
  'install-panel':     'Panel installer (install-panel.sh)',
  'agent-script-linux':'Agent install script · Linux',
  'agent-script-win':  'Agent install script · Windows',
  'agent-script-v4':   'Agent install script · IPv4 preset',
  'agent-script-v6':   'Agent install script · IPv6 preset',
  'agent-binary-linux':'Agent binary · Linux (Rust)',
  'agent-binary-win':  'Agent binary · Windows (Rust .exe)',
  'agent-code':        'Agent code · Node.js fallback (agent.js)',
  'agent-other':       'Agent · other'
}
function kindLabel(k) { return KIND_LABEL[k] || k }
function kindColor(k) {
  if (k === 'install-panel') return '#22d3ee'
  if (k.startsWith('agent-binary')) return '#a78bfa'
  if (k.startsWith('agent-script')) return '#4ade80'
  if (k === 'agent-code') return '#f59e0b'
  return 'var(--muted)'
}

// Fill missing days in the daily series so the chart shows continuous bars
// even when no downloads happen on certain days.
const dailySeries = computed(() => {
  if (!stats.value?.daily) return []
  const map = new Map(stats.value.daily.map((d) => [d.day, d.c]))
  const out = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, count: map.get(key) || 0 })
  }
  return out
})

const maxDaily = computed(() => dailySeries.value.reduce((m, d) => Math.max(m, d.count), 0) || 1)

function fmtTs(ms) {
  const d = new Date(Number(ms) || 0)
  if (isNaN(d.getTime())) return '?'
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function shortUa(ua) {
  if (!ua) return ''
  // Common installer/cron UA matches — collapse to friendly tag.
  if (/curl/i.test(ua)) return 'curl'
  if (/wget/i.test(ua)) return 'wget'
  if (/PowerShell|WindowsPowerShell/i.test(ua)) return 'PowerShell'
  // Browser short-form
  const m = ua.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)
  if (m) return m[1]
  return ua.slice(0, 40)
}
</script>

<template>
  <section class="page-stack">
    <header class="page-head">
      <div>
        <h1><Download :size="20" style="vertical-align:-3px; color:var(--green)" /> OSS Downloads</h1>
        <p class="sub">Đếm số lượt khách hàng tải mã nguồn / agent từ panel này. Cập nhật mỗi 60s.</p>
      </div>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="13" :class="{ spin: loading }" /> Refresh
      </button>
    </header>

    <p v-if="err" class="error-text">{{ err }}</p>

    <template v-if="stats">
      <!-- KPI strip -->
      <div class="kpi-grid">
        <article class="kpi">
          <span class="ico" style="background:rgba(34,197,94,0.14); color:var(--green)"><Download :size="18" /></span>
          <div><span class="lbl">Tổng tải</span><strong>{{ stats.totals.lifetime.toLocaleString() }}</strong></div>
        </article>
        <article class="kpi">
          <span class="ico" style="background:rgba(34,211,238,0.14); color:#22d3ee"><Activity :size="18" /></span>
          <div><span class="lbl">24h qua</span><strong>{{ stats.totals.last24h.toLocaleString() }}</strong><small>{{ stats.totals.uniqIp24h }} unique IP</small></div>
        </article>
        <article class="kpi">
          <span class="ico" style="background:rgba(139,92,246,0.14); color:#a78bfa"><Activity :size="18" /></span>
          <div><span class="lbl">7 ngày qua</span><strong>{{ stats.totals.last7d.toLocaleString() }}</strong><small>{{ stats.totals.uniqIp7d }} unique IP</small></div>
        </article>
        <article class="kpi">
          <span class="ico" style="background:rgba(245,158,11,0.14); color:#f59e0b"><Globe :size="18" /></span>
          <div><span class="lbl">30 ngày qua</span><strong>{{ stats.totals.last30d.toLocaleString() }}</strong></div>
        </article>
        <article class="kpi">
          <span class="ico" style="background:rgba(96,165,250,0.14); color:#60a5fa"><Users :size="18" /></span>
          <div><span class="lbl">Unique IP tổng</span><strong>{{ stats.totals.uniqIpAll.toLocaleString() }}</strong></div>
        </article>
      </div>

      <!-- 30-day bar chart (lightweight CSS bars, no chart lib needed) -->
      <section class="surface chart-card">
        <div class="section-head">
          <h2><Activity :size="14" style="vertical-align:-2px" /> Tải theo ngày (30 ngày gần nhất)</h2>
        </div>
        <div class="bar-chart">
          <div v-for="d in dailySeries" :key="d.day" class="bar-col" :title="`${d.day}: ${d.count} lượt`">
            <span class="bar" :style="{ height: (d.count / maxDaily * 100) + '%' }" :data-count="d.count"></span>
            <small>{{ d.day.slice(5) }}</small>
          </div>
        </div>
      </section>

      <!-- Breakdown by kind -->
      <section class="surface">
        <div class="section-head"><h2><Server :size="14" style="vertical-align:-2px" /> Tải theo loại</h2></div>
        <div v-if="!stats.byKind.length" class="empty-text">Chưa có lượt tải nào.</div>
        <table v-else class="kind-table">
          <thead>
            <tr><th>Loại</th><th style="text-align:right">Tổng tải</th><th style="text-align:right">Unique IP</th><th>Phân bổ</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in stats.byKind" :key="row.kind">
              <td>
                <span class="kind-dot" :style="{ background: kindColor(row.kind) }"></span>
                {{ kindLabel(row.kind) }}
              </td>
              <td class="cell-mono num">{{ row.count.toLocaleString() }}</td>
              <td class="cell-mono num">{{ (stats.byKindUniq.find((x) => x.kind === row.kind)?.uniqIps || 0).toLocaleString() }}</td>
              <td>
                <span class="bar-mini" :style="{ width: (row.count / stats.totals.lifetime * 100) + '%', background: kindColor(row.kind) }"></span>
                <small style="margin-left:8px; color:var(--muted)">{{ ((row.count / stats.totals.lifetime) * 100).toFixed(1) }}%</small>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Recent 100 hits -->
      <section class="surface">
        <div class="section-head">
          <h2><Activity :size="14" style="vertical-align:-2px" /> Tải gần đây ({{ stats.recent.length }})</h2>
          <small style="color:var(--muted); margin-left:8px">IP đã mask octet cuối để screenshot an toàn</small>
        </div>
        <div v-if="!stats.recent.length" class="empty-text">Chưa có lượt tải.</div>
        <div v-else class="recent-table">
          <div class="r-head">
            <span>Thời gian</span><span>Loại</span><span>IP (masked)</span><span>Client</span><span>Referer</span>
          </div>
          <div v-for="(r, i) in stats.recent" :key="i" class="r-row">
            <span class="cell-mono">{{ fmtTs(r.ts) }}</span>
            <span><span class="kind-dot" :style="{ background: kindColor(r.kind) }"></span> {{ kindLabel(r.kind) }}</span>
            <span class="cell-mono">{{ r.ip || '-' }}</span>
            <span>{{ shortUa(r.ua) }}</span>
            <span class="cell-mono" style="font-size:11px; color:var(--muted)">{{ r.referer || '-' }}</span>
          </div>
        </div>
      </section>
    </template>

    <p v-else-if="!err" class="empty-text" style="padding:40px">Đang tải…</p>
  </section>
</template>

<style scoped>
.error-text { color: var(--red); font-size: 13px; margin: 4px 0 10px; padding: 10px 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 8px; }
.empty-text { text-align: center; color: var(--muted); font-size: 13px; padding: 14px; }
.page-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
.page-head > div { flex: 1; min-width: 0; }
.page-head h1 { margin: 0; font-size: 22px; font-weight: 700; }
.page-head .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }

.kpi-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;
  margin-bottom: 16px;
}
.kpi {
  display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px;
}
.kpi .ico {
  width: 36px; height: 36px; border-radius: 8px;
  display: grid; place-items: center; flex-shrink: 0;
}
.kpi .lbl { display: block; font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.kpi strong { display: block; font-size: 22px; color: var(--text); font-family: var(--mono); font-weight: 700; }
.kpi small { display: block; font-size: 10.5px; color: var(--muted); margin-top: 2px; }

/* 30-day bar chart — pure CSS bars, snappy for monitoring during a launch */
.chart-card { padding: 16px 18px; }
.bar-chart {
  display: grid;
  grid-template-columns: repeat(30, 1fr);
  align-items: end;
  gap: 4px;
  height: 160px;
  padding: 12px 0 0;
}
.bar-col {
  display: flex; flex-direction: column; align-items: stretch; gap: 4px;
  height: 100%;
}
.bar-col .bar {
  flex: 1; min-height: 2px;
  background: linear-gradient(180deg, var(--green) 0%, rgba(34,197,94,0.4) 100%);
  border-radius: 3px 3px 0 0;
  position: relative;
  transition: opacity 120ms;
  align-self: stretch;
}
.bar-col:hover .bar { opacity: 0.75; }
.bar-col small {
  font-size: 9px; color: var(--muted);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
@media (max-width: 700px) {
  .bar-col small { display: none; }
  .bar-chart { height: 100px; }
}

/* Kind table */
.kind-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.kind-table th, .kind-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.kind-table th { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.kind-table .num { text-align: right; font-family: var(--mono); }
.kind-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  margin-right: 8px; vertical-align: middle;
}
.bar-mini { display: inline-block; height: 6px; border-radius: 3px; min-width: 2px; max-width: 200px; vertical-align: middle; }

/* Recent table (flex rows so columns can wrap on phone) */
.recent-table { display: flex; flex-direction: column; gap: 1px; margin-top: 8px; }
.r-head, .r-row {
  display: grid; grid-template-columns: 1.3fr 1.4fr 1fr 0.8fr 1.5fr;
  gap: 10px; padding: 6px 10px; align-items: center;
  font-size: 12.5px;
}
.r-head { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; border-bottom: 1px solid var(--border); }
.r-row { border-bottom: 1px solid var(--pxl-bd-soft); }
.r-row:hover { background: rgba(255,255,255,0.02); }
@media (max-width: 800px) {
  .r-head { display: none; }
  .r-row { grid-template-columns: 1fr; gap: 2px; padding: 8px 10px; }
  .r-row span:first-child { font-weight: 600; }
}

.spin { animation: spin 1.2s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
