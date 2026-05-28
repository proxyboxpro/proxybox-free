<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BarChart3, RefreshCw, ArrowUp, ArrowDown, Activity } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()
const win = ref('h24')          // h1 | h24 | d30
const proxies = ref([])
const totals = ref({ up: 0, down: 0, conns: 0, proxyCount: 0 })
const err = ref('')
const loading = ref(false)
const typeFilter = ref('')
const search = ref('')
const sortDir = ref('desc')     // desc = most first, asc = least first
const autoRefresh = ref(false)
let timer = null

const WINDOWS = computed(() => [
  { v: 'h1', l: t('admin.bw.win1h') },
  { v: 'h24', l: t('admin.bw.win24h') },
  { v: 'd30', l: t('admin.bw.win30d') }
])

async function refresh() {
  loading.value = true; err.value = ''
  try {
    const data = await apiFetch(`/api/admin/bandwidth?window=${win.value}`)
    proxies.value = data?.proxies || []
    totals.value = data?.totals || { up: 0, down: 0, conns: 0, proxyCount: 0 }
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

function setWindow(v) { if (win.value !== v) { win.value = v; refresh() } }

const filtered = computed(() => {
  let list = proxies.value
  if (typeFilter.value) list = list.filter((p) => p.type === typeFilter.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter((p) => `${p.proxyId} ${p.ownerEmail} ${p.bindIp} ${p.ip} ${p.port} ${p.zone} ${p.nodeName}`.toLowerCase().includes(q))
  }
  // Backend returns desc by total; re-sort for the "ít nhất" view.
  const sorted = [...list].sort((a, b) => sortDir.value === 'asc' ? a.total - b.total : b.total - a.total)
  return sorted
})

// Largest total in the current filtered set — drives the relative bar width.
const maxTotal = computed(() => filtered.value.reduce((m, p) => Math.max(m, p.total || 0), 0) || 1)

const kpi = computed(() => ({
  total: (totals.value.up || 0) + (totals.value.down || 0),
  up: totals.value.up || 0,
  down: totals.value.down || 0,
  conns: totals.value.conns || 0,
  count: totals.value.proxyCount || 0
}))

function fmtLastTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('vi-VN', { hour12: false })
}
function goDetail(p) { if (p.exists) router.push({ name: 'admin-connection-detail', params: { proxyId: p.proxyId } }) }

onMounted(() => {
  refresh()
  timer = setInterval(() => { if (autoRefresh.value) refresh() }, 30_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">
        <BarChart3 :size="14" style="vertical-align:-2px" />
        {{ t('admin.bw.eyebrowSuffix') }} · {{ filtered.length }} {{ t('admin.bw.ports') }}
      </span>
      <div class="spacer"></div>
      <label class="filter-field" style="margin-right:8px; width:auto">
        <input v-model="autoRefresh" type="checkbox" /> {{ t('admin.bw.autoRefresh') }}
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="12" /> {{ t('admin.bw.refresh') }}
      </button>
    </div>

    <p class="hint-text">
      {{ t('admin.bw.intro') }}
    </p>

    <!-- Window selector -->
    <div class="bw-range-pills">
      <button v-for="w in WINDOWS" :key="w.v" type="button" :class="{ active: win === w.v }" @click="setWindow(w.v)">
        {{ w.l }}
      </button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- KPI strip -->
    <div class="metric-cards">
      <article>
        <BarChart3 :size="20" />
        <span>{{ t('admin.bw.kpiTotal') }}</span>
        <strong style="font-size:18px">{{ formatBytes(kpi.total) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.bw.kpiTotalSub', { n: kpi.count }) }}</small>
      </article>
      <article>
        <ArrowUp :size="20" />
        <span>{{ t('admin.bw.kpiUpload') }}</span>
        <strong style="font-size:18px">{{ formatBytes(kpi.up) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.bw.kpiUploadSub') }}</small>
      </article>
      <article>
        <ArrowDown :size="20" />
        <span>{{ t('admin.bw.kpiDownload') }}</span>
        <strong style="font-size:18px">{{ formatBytes(kpi.down) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.bw.kpiDownloadSub') }}</small>
      </article>
      <article>
        <Activity :size="20" />
        <span>{{ t('admin.bw.kpiConns') }}</span>
        <strong>{{ formatNumber(kpi.conns) }}</strong>
        <small style="color:var(--muted);font-size:11.5px">{{ t('admin.bw.kpiConnsSub') }}</small>
      </article>
    </div>

    <!-- Filters -->
    <section class="surface">
      <div class="ord-filters">
        <div class="filter-row">
          <label class="filter-field">
            <span>{{ t('admin.bw.filterType') }}</span>
            <select v-model="typeFilter">
              <option value="">{{ t('admin.bw.filterAll') }}</option>
              <option value="IPv4">IPv4</option>
              <option value="IPv6">IPv6</option>
              <option value="Hub">Hub</option>
            </select>
          </label>
          <label class="filter-field">
            <span>{{ t('admin.bw.filterSort') }}</span>
            <select v-model="sortDir">
              <option value="desc">{{ t('admin.bw.sortDesc') }}</option>
              <option value="asc">{{ t('admin.bw.sortAsc') }}</option>
            </select>
          </label>
          <label class="filter-field" style="flex:1; min-width:240px">
            <span>{{ t('admin.bw.filterSearch') }}</span>
            <input v-model="search" type="search" :placeholder="t('admin.bw.searchPh')" />
          </label>
        </div>
      </div>
    </section>

    <!-- Ranking table -->
    <section class="surface">
      <div class="section-head">
        <h2>{{ t('admin.bw.rankTitle', { n: filtered.length }) }}</h2>
        <span style="color:var(--muted);font-size:12px">{{ t('admin.bw.rankNote') }}</span>
      </div>
      <p v-if="!filtered.length && !loading" class="empty-text">
        {{ t('admin.bw.empty') }}
      </p>
      <div v-if="filtered.length" class="data-table bw-table">
        <div class="table-head">
          <span style="text-align:right">#</span>
          <span>{{ t('admin.bw.colOwner') }}</span>
          <span>{{ t('admin.bw.colNode') }}</span>
          <span>{{ t('admin.bw.colIpPort') }}</span>
          <span style="text-align:right">{{ t('admin.bw.colConns') }}</span>
          <span style="text-align:right">{{ t('admin.bw.colUpDown') }}</span>
          <span style="text-align:right">{{ t('admin.bw.colTotal') }}</span>
        </div>
        <div v-for="(p, i) in filtered" :key="p.proxyId" class="table-row" :class="{ clickable: p.exists }" @click="goDetail(p)">
          <span style="text-align:right; color:var(--muted); font-family:var(--mono)">{{ i + 1 }}</span>
          <span>
            <div style="font-weight:600">{{ p.ownerEmail || '—' }}</div>
            <small class="cell-mono" style="color:var(--muted); font-size:11px">
              {{ p.proxyId }} · {{ p.type || '?' }}
              <span v-if="!p.exists" style="color:var(--red)">{{ t('admin.bw.deletedSuffix') }}</span>
            </small>
          </span>
          <span>
            <div>{{ p.nodeName || '—' }}</div>
            <small style="color:var(--muted); font-size:11px">{{ p.zone || '—' }}</small>
          </span>
          <span class="cell-mono" style="font-size:12px">
            {{ p.ip || p.bindIp || '—' }}<template v-if="p.port">:{{ p.port }}</template>
            <small v-if="p.ip && p.bindIp && p.ip !== p.bindIp" style="display:block; color:var(--muted); font-size:10.5px">{{ t('admin.bw.egressPrefix') }}{{ p.bindIp }}</small>
          </span>
          <span style="text-align:right">
            <strong>{{ formatNumber(p.conns) }}</strong>
            <small v-if="p.srcCount" style="color:var(--muted); font-size:11px; display:block">{{ formatNumber(p.srcCount) }} {{ t('admin.bw.clientIp') }}</small>
          </span>
          <span class="cell-mono" style="text-align:right; font-size:12px">
            ↑ {{ formatBytes(p.up) }}<br />
            ↓ {{ formatBytes(p.down) }}
          </span>
          <span style="text-align:right">
            <strong class="cell-mono" style="font-size:12.5px">{{ formatBytes(p.total) }}</strong>
            <span class="bw-bar"><span class="bw-bar-fill" :style="{ width: Math.max(2, Math.round((p.total / maxTotal) * 100)) + '%' }"></span></span>
          </span>
        </div>
      </div>
      <p v-if="filtered.length" style="font-size:12px; color:var(--muted); margin-top:10px">
        {{ t('admin.bw.footer') }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.hint-text { font-size: 12.5px; color: var(--muted); margin: -2px 0 4px; line-height: 1.5; max-width: 760px; }
.bw-range-pills { display: inline-flex; padding: 3px; background: rgba(255,255,255,0.04); border-radius: 8px; gap: 2px; }
.bw-range-pills button {
  padding: 6px 16px; font-size: 12.5px; font-weight: 500;
  background: transparent; color: var(--muted); border: none; cursor: pointer;
  border-radius: 6px; transition: background 0.1s, color 0.1s;
}
.bw-range-pills button:hover { color: var(--text); }
.bw-range-pills button.active { background: var(--surface); color: var(--green); font-weight: 600; box-shadow: 0 0 0 1px var(--border); }

.bw-table .table-head,
.bw-table .table-row { grid-template-columns: 44px 1.7fr 1.1fr 1.4fr 0.9fr 1.1fr 1.2fr; }
.bw-table .table-row.clickable { cursor: pointer; }
.bw-table .table-row.clickable:hover { background: rgba(34,197,94,0.025); }
.bw-bar { display: block; height: 4px; margin-top: 4px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden; }
.bw-bar-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--green)); border-radius: 999px; }

@media (max-width: 900px) {
  .bw-table .table-head,
  .bw-table .table-row { grid-template-columns: 30px 1.6fr 1.3fr 0.9fr 1.1fr; }
  .bw-table .table-head span:nth-child(3),
  .bw-table .table-row span:nth-child(3),
  .bw-table .table-head span:nth-child(5),
  .bw-table .table-row span:nth-child(5) { display: none; }
}
</style>
