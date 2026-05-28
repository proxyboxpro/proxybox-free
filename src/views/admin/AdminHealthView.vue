<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, AlertTriangle, CheckCircle, Heart, RefreshCw, Wrench, Zap } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatNumber } from '../../utils/format'

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
        Auto-heal · {{ formatNumber(counters.total) }} proxy theo dõi
      </span>
      <div class="spacer"></div>
      <label class="filter-field" style="width:auto; margin-right:8px">
        <input v-model="autoRefresh" type="checkbox" /> tự động (30s)
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="12" :class="{ spin: loading }" /> làm mới
      </button>
      <button class="ghost-button" type="button" :disabled="sweeping" style="margin-left:6px; border-color: var(--green); color: var(--green)" @click="runSweep">
        <Zap :size="12" /> {{ sweeping ? 'Đang quét…' : 'Chạy quét ngay' }}
      </button>
    </div>

    <p class="hint-text">
      Auto-heal quét tất cả proxy mỗi 5 phút, đo bằng request thật qua chính proxy đó. Sai 3 lần liên tiếp → tự xoay
      IP egress (v6 mint mới từ /48 của node). Sai 6 lần → tự thay bằng proxy mới (cùng order, cùng zone, giữ nguyên hạn).
      Có 3 lớp chặn lạm dụng: cooldown {{ fmtMs(settings.autoFixCooldownMs) }}, tối đa {{ settings.maxAutoFixPerSweep }} fix/lần quét,
      và nếu &gt;{{ settings.nodeSuspectPct }}% proxy của 1 node cùng fail trong 1 lần quét → coi như node lỗi và NGỪNG auto-fix (tránh đốt pool IP).
    </p>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- KPI strip -->
    <div class="metric-cards">
      <article>
        <CheckCircle :size="20" />
        <span>Hoạt động</span>
        <strong style="color: var(--green)">{{ formatNumber(counters.active) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">/ {{ formatNumber(counters.total) }} tổng</small>
      </article>
      <article>
        <AlertTriangle :size="20" />
        <span>Đang lỗi</span>
        <strong :style="{ color: counters.failing > 0 ? 'var(--yellow)' : 'var(--muted)' }">{{ formatNumber(counters.failing) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">checkFailCount &gt; 0</small>
      </article>
      <article>
        <Wrench :size="20" />
        <span>Fix gần đây</span>
        <strong style="color: var(--blue)">{{ recentFixes.length }}</strong>
        <small style="color:var(--muted); font-size:11.5px">100 sự kiện gần nhất</small>
      </article>
      <article>
        <Activity :size="20" />
        <span>Đã thay (replaced)</span>
        <strong>{{ formatNumber(counters.replaced || 0) }}</strong>
        <small style="color:var(--muted); font-size:11.5px">expired: {{ counters.expired || 0 }}</small>
      </article>
    </div>

    <!-- Per-node fail rate -->
    <section class="surface">
      <div class="section-head">
        <h2>Tỉ lệ lỗi theo node</h2>
        <span style="color:var(--muted); font-size:12px">Node bị đánh dấu suspect khi &gt;{{ settings.nodeSuspectPct }}% proxy fail cùng lúc → tạm ngừng auto-fix node đó</span>
      </div>
      <p v-if="!perNode.length" class="empty-text">Chưa có dữ liệu.</p>
      <div v-if="perNode.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.4fr 1fr 0.6fr 0.6fr 0.8fr 0.7fr">
          <span>Node</span>
          <span>Host</span>
          <span style="text-align:right">Tổng</span>
          <span style="text-align:right">Lỗi</span>
          <span style="text-align:right">% lỗi</span>
          <span style="text-align:right">Trạng thái</span>
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
        <h2>Hành động auto-fix gần đây ({{ recentFixes.length }})</h2>
        <span style="color:var(--muted); font-size:12px">rotate = đổi IP egress · replace = thay proxy</span>
      </div>
      <p v-if="!recentFixes.length" class="empty-text">Chưa có sự kiện. Auto-heal sẽ ghi nhận tại đây khi xảy ra.</p>
      <div v-if="recentFixes.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 0.7fr 0.8fr 1.4fr">
          <span>Thời gian</span>
          <span>Hành động</span>
          <span>Chi tiết</span>
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
        <h2>Proxy đang lỗi ({{ data?.failerCount || 0 }})</h2>
        <span style="color:var(--muted); font-size:12px">Hiển thị 200 đầu tiên, sắp xếp theo số lần fail liên tiếp</span>
      </div>
      <p v-if="!failers.length" class="empty-text">Tất cả proxy đang khoẻ.</p>
      <div v-if="failers.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1fr 0.7fr 1.2fr 1fr 0.6fr 0.6fr 0.7fr 0.7fr 0.7fr">
          <span>Proxy</span>
          <span>Loại</span>
          <span>Owner</span>
          <span>Node</span>
          <span style="text-align:right">Fail liên tiếp</span>
          <span style="text-align:right">Tổng fail</span>
          <span style="text-align:right">Đã auto-fix</span>
          <span style="text-align:right">Check gần nhất</span>
          <span style="text-align:right">Trạng thái</span>
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
