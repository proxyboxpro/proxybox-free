<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, AlertTriangle, CheckCircle, Heart, RefreshCw, Wrench, Zap } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const data = ref(null)
const err = ref('')
const loading = ref(false)
const sweeping = ref(false)
const autoRefresh = ref(true)
let timer = null

async function refresh() {
  loading.value = true; err.value = ''
  try { data.value = await apiFetch('/api/admin/health') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function runSweep() {
  if (sweeping.value) return
  sweeping.value = true; err.value = ''
  try {
    await apiFetch('/api/admin/health/sweep', { method: 'POST' })
    // Sweep is async on the server; give probes ~18s before refreshing.
    setTimeout(() => { refresh(); sweeping.value = false }, 18000)
  } catch (e) { err.value = e.message; sweeping.value = false }
}

function fmtMs(ms) {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return (s / 3600).toFixed(1) + 'h'
}
function fmtAgo(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

const counters = computed(() => data.value?.counters || { total: 0, active: 0, error: 0, expired: 0, replaced: 0, failing: 0, neverChecked: 0 })
const settings = computed(() => data.value?.settings || {})
const perNode = computed(() => data.value?.perNode || [])
const failers = computed(() => data.value?.topFailers || [])
const recentFixes = computed(() => data.value?.recentFixes || [])

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
        <Heart :size="14" style="vertical-align:-2px" />
        Auto-heal · {{ formatNumber(counters.total) }} {{ t('admin.health.eyebrowSuffix') }}
      </span>
      <div class="spacer"></div>
      <label class="filter-field" style="width:auto; margin-right:8px">
        <input v-model="autoRefresh" type="checkbox" /> {{ t('admin.health.autoRefresh') }}
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="12" :class="{ spin: loading }" /> {{ t('admin.health.refresh') }}
      </button>
      <button class="ghost-button" type="button" :disabled="sweeping" style="margin-left:6px; border-color: var(--green); color: var(--green)" @click="runSweep">
        <Zap :size="12" /> {{ sweeping ? t('admin.health.sweeping') : t('admin.health.sweepNow') }}
      </button>
    </div>

    <p class="hint-text">
      {{ t('admin.health.intro', { cooldown: fmtMs(settings.autoFixCooldownMs), maxFix: settings.maxAutoFixPerSweep, suspectPct: settings.nodeSuspectPct }) }}
    </p>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- KPI strip -->
    <div class="metric-cards">
      <article>
        <CheckCircle :size="20" />
        <span>{{ t('admin.health.kpiActive') }}</span>
        <strong style="color: var(--green)">{{ formatNumber(counters.active) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.health.kpiActiveSub', { total: formatNumber(counters.total) }) }}</small>
      </article>
      <article>
        <AlertTriangle :size="20" />
        <span>{{ t('admin.health.kpiFailing') }}</span>
        <strong :style="{ color: counters.failing > 0 ? 'var(--yellow)' : 'var(--muted)' }">{{ formatNumber(counters.failing) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.health.kpiFailingSub') }}</small>
      </article>
      <article>
        <Wrench :size="20" />
        <span>{{ t('admin.health.kpiFixes') }}</span>
        <strong style="color: var(--blue)">{{ recentFixes.length }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.health.kpiFixesSub') }}</small>
      </article>
      <article>
        <Activity :size="20" />
        <span>{{ t('admin.health.kpiReplaced') }}</span>
        <strong>{{ formatNumber(counters.replaced || 0) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">{{ t('admin.health.kpiReplacedSub', { n: counters.expired || 0 }) }}</small>
      </article>
    </div>

    <!-- Per-node fail rate -->
    <section class="surface">
      <div class="section-head">
        <h2>{{ t('admin.health.perNodeTitle') }}</h2>
        <span style="color:var(--muted); font-size:12px">{{ t('admin.health.perNodeNote', { pct: settings.nodeSuspectPct }) }}</span>
      </div>
      <p v-if="!perNode.length" class="empty-text">{{ t('admin.health.empty') }}</p>
      <div v-if="perNode.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.4fr 1fr 0.6fr 0.6fr 0.8fr 0.7fr">
          <span>{{ t('admin.health.colNode') }}</span>
          <span>{{ t('admin.health.colHost') }}</span>
          <span style="text-align:right">{{ t('admin.health.colTotal') }}</span>
          <span style="text-align:right">{{ t('admin.health.colFail') }}</span>
          <span style="text-align:right">{{ t('admin.health.colFailPct') }}</span>
          <span style="text-align:right">{{ t('admin.health.colStatus') }}</span>
        </div>
        <div v-for="n in perNode" :key="n.nodeId" class="table-row" :class="{ 'is-suspect': n.suspect }" style="grid-template-columns: 1.4fr 1fr 0.6fr 0.6fr 0.8fr 0.7fr">
          <span>{{ n.nodeName }}</span>
          <span class="cell-mono">{{ n.host || '—' }}</span>
          <span style="text-align:right">{{ formatNumber(n.total) }}</span>
          <span style="text-align:right" :style="{ color: n.failing > 0 ? 'var(--yellow)' : 'var(--muted)' }">{{ formatNumber(n.failing) }}</span>
          <span class="cell-mono" style="text-align:right">{{ n.failPct }}%</span>
          <span style="text-align:right">
            <span v-if="n.suspect" class="status-pill error">SUSPECT</span>
            <span v-else-if="n.failPct === 0" class="status-pill active">OK</span>
            <span v-else class="status-pill pending">{{ n.failPct.toFixed(1) }}%</span>
          </span>
        </div>
      </div>
    </section>

    <!-- Recent auto-fix audit -->
    <section class="surface">
      <div class="section-head">
        <h2>{{ t('admin.health.recentTitle', { n: recentFixes.length }) }}</h2>
        <span style="color:var(--muted); font-size:12px">{{ t('admin.health.recentNote') }}</span>
      </div>
      <p v-if="!recentFixes.length" class="empty-text">{{ t('admin.health.recentEmpty') }}</p>
      <div v-if="recentFixes.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 0.7fr 0.8fr 1.4fr">
          <span>{{ t('admin.health.colTime') }}</span>
          <span>{{ t('admin.health.colAction') }}</span>
          <span>{{ t('admin.health.colDetail') }}</span>
        </div>
        <div v-for="(f, i) in recentFixes" :key="i" class="table-row" style="grid-template-columns: 0.7fr 0.8fr 1.4fr">
          <span class="cell-mono" style="font-size:11.5px; color:var(--muted)">{{ f.ts }}</span>
          <span>
            <span v-if="f.path && f.path.endsWith('/rotate')" class="status-pill pending">rotate</span>
            <span v-else-if="f.path && f.path.endsWith('/replace')" class="status-pill active">replace</span>
            <span v-else class="status-pill error">{{ (f.path || '').split('/').pop() }}</span>
            <small class="cell-mono" style="display:block; color:var(--muted); font-size:10.5px; margin-top:2px">
              {{ (f.path || '').match(/\/proxy\/([^/]+)/)?.[1] || '—' }}
            </small>
          </span>
          <span class="cell-mono" style="font-size:11.5px; word-break:break-all">{{ f.note }}</span>
        </div>
      </div>
    </section>

    <!-- Top current failers -->
    <section class="surface">
      <div class="section-head">
        <h2>{{ t('admin.health.failersTitle', { n: data?.failerCount || 0 }) }}</h2>
        <span style="color:var(--muted); font-size:12px">{{ t('admin.health.failersNote') }}</span>
      </div>
      <p v-if="!failers.length" class="empty-text">{{ t('admin.health.failersEmpty') }}</p>
      <div v-if="failers.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1fr 0.7fr 1.2fr 1fr 0.6fr 0.6fr 0.7fr 0.7fr 0.7fr">
          <span>{{ t('admin.health.colProxy') }}</span>
          <span>{{ t('admin.health.colType') }}</span>
          <span>{{ t('admin.health.colOwner') }}</span>
          <span>{{ t('admin.health.colNode') }}</span>
          <span style="text-align:right">{{ t('admin.health.colFailStreak') }}</span>
          <span style="text-align:right">{{ t('admin.health.colTotalFail') }}</span>
          <span style="text-align:right">{{ t('admin.health.colAutoFixed') }}</span>
          <span style="text-align:right">{{ t('admin.health.colLastCheck') }}</span>
          <span style="text-align:right">{{ t('admin.health.colStatus') }}</span>
        </div>
        <div v-for="f in failers" :key="f.proxyId" class="table-row" style="grid-template-columns: 1fr 0.7fr 1.2fr 1fr 0.6fr 0.6fr 0.7fr 0.7fr 0.7fr">
          <span>
            <span class="cell-mono">{{ f.proxyId }}</span>
            <small class="cell-mono" style="display:block; color:var(--muted); font-size:10.5px">:{{ f.port }}</small>
          </span>
          <span>{{ f.type }}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ f.ownerEmail || '—' }}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ f.nodeName }}</span>
          <span class="cell-mono" style="text-align:right; color: var(--yellow); font-weight:600">{{ f.checkFailCount }}</span>
          <span class="cell-mono" style="text-align:right; color: var(--muted)">{{ f.totalFails }}</span>
          <span style="text-align:right">
            <span v-if="f.autoFixCount > 0">
              <strong class="cell-mono">{{ f.autoFixCount }}</strong>
              <small class="cell-mono" style="display:block; color:var(--muted); font-size:10.5px">{{ f.lastAutoFixAction }} · {{ fmtAgo(f.lastAutoFixAt) }}</small>
            </span>
            <span v-else style="color: var(--muted)">—</span>
          </span>
          <span style="text-align:right; font-size:11.5px; color:var(--muted)">{{ fmtAgo(f.lastCheckedAt) }}</span>
          <span style="text-align:right">
            <span :class="['status-pill', f.status === 'active' ? 'active' : f.status === 'expired' ? 'expired' : 'pending']">{{ f.status }}</span>
          </span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.hint-text { font-size: 12.5px; color: var(--muted); margin: -2px 0 4px; line-height: 1.6; max-width: 920px; }
.is-suspect { background: rgba(248, 81, 73, 0.06) !important; border-color: rgba(248, 81, 73, 0.4) !important; }
.spin { animation: hspin 0.9s linear infinite; }
@keyframes hspin { to { transform: rotate(360deg); } }
</style>
