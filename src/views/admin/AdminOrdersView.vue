<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Activity, AlertCircle, Calendar, ChevronDown, ChevronRight, Copy, DollarSign,
  Filter, Globe, MoreHorizontal, Network, RefreshCw, Search, Server, ShoppingCart,
  Users, X
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()
const list = ref([])
const users = ref([])
const nodes = ref([])
const zones = ref([])
const expanded = ref(new Set())
const expandedMembers = ref(new Map())  // orderId → members[]
// Default to "Đang chạy" tab so admin lands on the active business.
const filters = ref({ ownerId: '', status: 'active', type: '', from: '', to: '', nodeId: '', zone: '', q: '' })
const err = ref('')
const flash = ref('')
const loading = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    const qs = Object.entries(filters.value)
      .filter(([k, v]) => v && k !== 'q')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    list.value = await apiFetch(`/api/admin/orders${qs ? '?' + qs : ''}`)
    if (!users.value.length) users.value = await apiFetch('/api/admin/users').catch(() => [])
    if (!nodes.value.length) nodes.value = await apiFetch('/api/nodes').catch(() => [])
    if (!zones.value.length) zones.value = await apiFetch('/api/admin/zones').catch(() => [])
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function toggleExpand(o) {
  if (expanded.value.has(o.id)) {
    expanded.value.delete(o.id)
  } else {
    expanded.value.add(o.id)
    if (!expandedMembers.value.has(o.id)) {
      try {
        const r = await apiFetch(`/api/admin/orders/${o.id}/members`)
        expandedMembers.value.set(o.id, r.members || [])
      } catch (e) { expandedMembers.value.set(o.id, []) }
    }
  }
  expanded.value = new Set(expanded.value)
}

async function cancelOrder(o, ev) {
  ev?.stopPropagation()
  if (!confirm(t('admin.orders.confirmCancel', { id: o.id }))) return
  try {
    const r = await apiFetch(`/api/admin/orders/${o.id}/cancel-refund`, { method: 'POST' })
    flash.value = t('admin.orders.flashRefund', { amount: Number(r.refund).toLocaleString() })
    await refresh()
  } catch (e) { err.value = e.message }
}
function openDetail(o) { router.push({ name: 'admin-order-detail', params: { orderId: o.id } }) }
function copy(text, ev) { ev?.stopPropagation(); navigator.clipboard?.writeText(text); flash.value = t('admin.orders.flashCopy', { text: text.slice(0, 30) }); setTimeout(() => flash.value = '', 1500) }

const userById = computed(() => Object.fromEntries(users.value.map((u) => [u.id, u.email || u.id])))
const nodeById = computed(() => Object.fromEntries(nodes.value.map((n) => [n.id, n])))
const zoneById = computed(() => Object.fromEntries(zones.value.map((z) => [z.id, z])))

const filtered = computed(() => {
  if (!filters.value.q) return list.value
  const q = filters.value.q.toLowerCase()
  return list.value.filter((o) => `${o.id} ${o.item || ''} ${o.ownerId || ''} ${userById.value[o.ownerId] || ''} ${o.nodeId || ''} ${o.zone || ''}`.toLowerCase().includes(q))
})

// Aggregated KPIs across the filtered set.
const kpi = computed(() => {
  const total = filtered.value.length
  const active = filtered.value.filter((o) => o.effectiveStatus === 'active').length
  const cancelled = filtered.value.filter((o) => o.effectiveStatus === 'cancelled' || o.effectiveStatus === 'refunded' || o.effectiveStatus === 'deleted').length
  const totalProxies = filtered.value.reduce((s, o) => s + (Number(o.memberCount) || 0), 0)
  const totalIpv4 = filtered.value.reduce((s, o) => s + (Number(o.ipv4Count) || 0), 0)
  const totalIpv6 = filtered.value.reduce((s, o) => s + (Number(o.ipv6Count) || 0), 0)
  const revenue = filtered.value.reduce((s, o) => s + (Number(o.amount || o.totalCost) || 0), 0)
  // Top node by order count
  const byNode = new Map()
  for (const o of filtered.value) byNode.set(o.nodeId, (byNode.get(o.nodeId) || 0) + 1)
  const topNodeEntry = [...byNode.entries()].sort((a, b) => b[1] - a[1])[0]
  return { total, active, cancelled, totalProxies, totalIpv4, totalIpv6, revenue, topNode: topNodeEntry ? topNodeEntry[0] : '—', topNodeCount: topNodeEntry ? topNodeEntry[1] : 0 }
})

function setType(v) { filters.value.type = v; refresh() }
function setStatus(v) { filters.value.status = v; refresh() }
function clearFilters() {
  filters.value = { ownerId: '', status: '', type: '', from: '', to: '', nodeId: '', zone: '', q: '' }
  refresh()
}
function flagFor(zoneId) {
  const z = zoneById.value[zoneId]
  if (z?.flag) return z.flag
  return zoneId ? zoneId.slice(0, 2).toUpperCase() : ''
}
function fmtTs(ts) {
  if (!ts) return '—'
  return String(ts).slice(0, 16).replace('T', ' ')
}
function timeLeft(ms) {
  if (!ms) return '—'
  const diff = ms - Date.now()
  if (diff <= 0) return t('admin.orders.expired')
  const h = Math.floor(diff / 3600_000)
  const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`
}

const hasActiveFilters = computed(() => Object.entries(filters.value).some(([k, v]) => v && k !== 'q'))

onMounted(refresh)
</script>

<template>
  <section class="ord-page">
    <!-- ── Header ── -->
    <header class="ord-head">
      <div>
        <p class="eyebrow"><ShoppingCart :size="12" /> {{ t('admin.orders.eyebrow') }}</p>
        <h1>{{ t('admin.orders.title') }}</h1>
        <p class="sub">{{ t('admin.orders.subtitle') }}</p>
      </div>
      <div class="head-actions">
        <button class="ghost-button" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="13" :class="{ spin: loading }" /> {{ t('admin.orders.refresh') }}
        </button>
      </div>
    </header>

    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" class="ord-flash">{{ flash }}</p>

    <!-- ── KPI strip ── -->
    <div class="ord-kpis">
      <article class="kpi" :class="{ active: !filters.type && !filters.status }">
        <span class="lbl"><ShoppingCart :size="12" /> {{ t('admin.orders.kpiTotal') }}</span>
        <strong>{{ kpi.total }}</strong>
        <span class="foot">{{ t('admin.orders.kpiTotalSub', { active: kpi.active, cancelled: kpi.cancelled }) }}</span>
      </article>
      <article class="kpi">
        <span class="lbl"><Network :size="12" /> {{ t('admin.orders.kpiProxies') }}</span>
        <strong>{{ kpi.totalProxies }}</strong>
        <span class="foot">{{ t('admin.orders.kpiProxiesSub', { v4: kpi.totalIpv4, v6: kpi.totalIpv6 }) }}</span>
      </article>
      <article class="kpi">
        <span class="lbl"><DollarSign :size="12" /> {{ t('admin.orders.kpiRevenue') }}</span>
        <strong>{{ kpi.revenue.toLocaleString() }}<small>VND</small></strong>
        <span class="foot">{{ t('admin.orders.kpiRevenueSub') }}</span>
      </article>
      <article class="kpi">
        <span class="lbl"><Server :size="12" /> {{ t('admin.orders.kpiTopNode') }}</span>
        <strong class="small-num">{{ kpi.topNode }}</strong>
        <span class="foot">{{ t('admin.orders.kpiTopNodeSub', { n: kpi.topNodeCount }) }}</span>
      </article>
    </div>

    <!-- ── Filter bar ── -->
    <section class="ord-filters">
      <div class="row">
        <div class="segment-tabs">
          <button :class="{ active: filters.type === '' }" type="button" @click="setType('')">{{ t('admin.orders.tabAll') }}</button>
          <button :class="{ active: filters.type === 'IPv4' }" type="button" @click="setType('IPv4')">IPv4</button>
          <button :class="{ active: filters.type === 'IPv6' }" type="button" @click="setType('IPv6')">IPv6</button>
        </div>
        <div class="chips">
          <button :class="{ active: filters.status === 'active' }" type="button" @click="setStatus('active')">{{ t('admin.orders.statusActive') }}</button>
          <button :class="{ active: filters.status === 'expired' }" type="button" @click="setStatus('expired')">{{ t('admin.orders.statusExpired') }}</button>
          <button :class="{ active: filters.status === 'deleted' }" type="button" @click="setStatus('deleted')">{{ t('admin.orders.statusDeleted') }}</button>
          <button :class="{ active: filters.status === 'cancelled' }" type="button" @click="setStatus('cancelled')">{{ t('admin.orders.statusCancelled') }}</button>
          <button :class="{ active: filters.status === 'refunded' }" type="button" @click="setStatus('refunded')">{{ t('admin.orders.statusRefunded') }}</button>
          <button :class="{ active: filters.status === '' }" type="button" @click="setStatus('')">{{ t('admin.orders.statusAll') }}</button>
        </div>
        <div class="search-box">
          <Search :size="14" />
          <input v-model="filters.q" type="search" :placeholder="t('admin.orders.searchPh')" />
        </div>
      </div>
      <div class="row row-2">
        <label class="filter-field">
          <span><Server :size="11" /> {{ t('admin.orders.filterNode') }}</span>
          <select v-model="filters.nodeId" @change="refresh">
            <option value="">{{ t('admin.orders.filterAllNodes') }}</option>
            <option value="local">{{ t('admin.orders.localCp') }}</option>
            <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.name }} ({{ n.id }})</option>
          </select>
        </label>
        <label class="filter-field">
          <span><Globe :size="11" /> {{ t('admin.orders.filterZone') }}</span>
          <select v-model="filters.zone" @change="refresh">
            <option value="">{{ t('admin.orders.filterAllZones') }}</option>
            <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.flag || z.id }} {{ z.name }}</option>
          </select>
        </label>
        <label class="filter-field">
          <span><Users :size="11" /> {{ t('admin.orders.filterOwner') }}</span>
          <select v-model="filters.ownerId" @change="refresh">
            <option value="">{{ t('admin.orders.filterAllOwners') }}</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.email }}</option>
          </select>
        </label>
        <label class="filter-field">
          <span><Calendar :size="11" /> {{ t('admin.orders.filterFrom') }}</span>
          <input v-model="filters.from" type="date" @change="refresh" />
        </label>
        <label class="filter-field">
          <span><Calendar :size="11" /> {{ t('admin.orders.filterTo') }}</span>
          <input v-model="filters.to" type="date" @change="refresh" />
        </label>
        <button v-if="hasActiveFilters" class="clear-btn" type="button" @click="clearFilters"><X :size="12" /> {{ t('admin.orders.clear') }}</button>
      </div>
    </section>

    <!-- ── Orders table ── -->
    <section v-if="filtered.length" class="ord-table">
      <header>
        <span></span>
        <span>{{ t('admin.orders.colId') }}</span>
        <span>{{ t('admin.orders.colOwner') }}</span>
        <span>{{ t('admin.orders.colItem') }}</span>
        <span>{{ t('admin.orders.colType') }}</span>
        <span>{{ t('admin.orders.colZone') }}</span>
        <span>{{ t('admin.orders.colNodeC') }}</span>
        <span>{{ t('admin.orders.colRevenue') }}</span>
        <span>{{ t('admin.orders.colCreatedAt') }}</span>
        <span>{{ t('admin.orders.colStatus') }}</span>
        <span></span>
      </header>
      <template v-for="o in filtered" :key="o.id">
        <article class="ord-row" :class="{ expanded: expanded.has(o.id) }" @click="toggleExpand(o)">
          <button class="expand-btn" type="button" @click.stop="toggleExpand(o)">
            <ChevronDown v-if="expanded.has(o.id)" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>
          <span class="cell-mono mono-id">{{ o.id }}</span>
          <span class="email-cell">
            <span>{{ userById[o.ownerId] || (o.ownerId ? t('admin.orders.unknown') : '—') }}</span>
          </span>
          <span class="item-cell">
            {{ o.item }}
            <small>{{ t('admin.orders.proxiesSuffix', { n: o.memberCount }) }}</small>
          </span>
          <span>
            <span v-if="o.typesLabel === 'ipv6'" class="badge type-v6">IPv6</span>
            <span v-else-if="o.typesLabel === 'ipv4'" class="badge type-v4">IPv4</span>
            <span v-else-if="o.typesLabel === 'mixed'" class="badge type-mix">MIX</span>
            <span v-else class="badge">—</span>
          </span>
          <span class="zone-cell">
            <span v-if="o.zone" class="flag-pill">{{ flagFor(o.zone) }}</span>
            <span style="font-size: 11.5px">{{ o.zone || '—' }}</span>
          </span>
          <span class="cell-mono node-cell">{{ o.nodeId === 'local' ? 'local' : (nodeById[o.nodeId]?.name || o.nodeId) }}</span>
          <span class="cell-mono amount-cell">{{ Number(o.amount || o.totalCost || 0).toLocaleString() }}</span>
          <span class="cell-mono time-cell">
            {{ fmtTs(o.createdAt || o.date) }}
            <small v-if="o.expiringMs">{{ t('admin.orders.timeLeft', { left: timeLeft(o.expiringMs) }) }}</small>
          </span>
          <span>
            <span :class="['status-pill', o.effectiveStatus === 'active' ? 'active' : (o.effectiveStatus === 'expired' ? 'pending' : 'failed')]">
              {{ ({ active: t('admin.orders.statusActive'), expired: t('admin.orders.statusExpired'), deleted: t('admin.orders.statusDeleted'), cancelled: t('admin.orders.statusCancelled'), refunded: t('admin.orders.statusRefunded') })[o.effectiveStatus] || o.effectiveStatus }}
            </span>
          </span>
          <span class="actions-cell" @click.stop>
            <button class="ghost-button mini" type="button" @click="openDetail(o)" :title="t('admin.orders.actDetail')">
              <MoreHorizontal :size="12" />
            </button>
            <button v-if="o.status === 'paid' && o.ownerId" class="ghost-button mini danger" type="button" @click="cancelOrder(o, $event)" :title="t('admin.orders.actCancel')">
              <X :size="12" />
            </button>
          </span>
        </article>

        <!-- Expanded member proxies -->
        <div v-if="expanded.has(o.id)" :key="o.id + '-exp'" class="ord-members">
          <div v-if="!expandedMembers.get(o.id)" class="loading-row">{{ t('admin.orders.loadingMembers') }}</div>
          <div v-else-if="!expandedMembers.get(o.id).length" class="loading-row">{{ t('admin.orders.noMembers') }}</div>
          <table v-else>
            <thead>
              <tr><th>{{ t('admin.orders.colProxy') }}</th><th>{{ t('admin.orders.colEndpoint') }}</th><th>{{ t('admin.orders.colCreds') }}</th><th>{{ t('admin.orders.colStatus') }}</th><th>{{ t('admin.orders.colExpires') }}</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="p in expandedMembers.get(o.id)" :key="p.id">
                <td class="cell-mono">{{ p.name || p.id.slice(0, 12) }}</td>
                <td class="cell-mono">
                  <span @click.stop="copy(`${p.ip || p.bindIp || p.listenHost}:${p.port}`, $event)" style="cursor:pointer">{{ p.ip || p.bindIp || p.listenHost }}:{{ p.port }} <Copy :size="10" style="vertical-align: -1px; color: var(--muted)" /></span>
                </td>
                <td class="cell-mono">
                  <span @click.stop="copy(`${p.username}:${p.password}`, $event)" style="cursor:pointer">{{ p.username }}:{{ p.password }} <Copy :size="10" style="vertical-align: -1px; color: var(--muted)" /></span>
                </td>
                <td><span :class="['status-pill', p.status === 'active' ? 'active' : (p.status === 'expired' ? 'failed' : 'pending')]">{{ p.status }}</span></td>
                <td class="cell-mono" style="font-size: 11px">{{ fmtTs(p.expiresAt) }}</td>
                <td><span v-if="p.rotate" class="badge type-v6">rot</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
    <p v-else class="empty">{{ loading ? t('admin.orders.loading') : t('admin.orders.empty') }}</p>
  </section>
</template>

<style scoped>
.ord-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 24px; }

.ord-head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-bottom: 4px; }
.ord-head .eyebrow { color: #22c55e; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; margin: 0 0 4px; }
.ord-head h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
.ord-head .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.head-actions { display: inline-flex; gap: 8px; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.ord-flash { color: #22c55e; background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 8px; padding: 8px 14px; font-size: 13px; }

/* KPI strip */
.ord-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kpi {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
}
.kpi.active { border-color: rgba(34, 197, 94, 0.4); }
.kpi .lbl { color: var(--muted); font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; font-weight: 500; }
.kpi strong { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 700; color: var(--text); line-height: 1.1; display: flex; align-items: baseline; gap: 4px; }
.kpi strong small { font-size: 10.5px; color: var(--muted); font-weight: 500; }
.kpi strong.small-num { font-size: 14px; }
.kpi .foot { color: var(--muted); font-size: 10.5px; }

/* Filters */
.ord-filters {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.ord-filters .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.ord-filters .row-2 { padding-top: 10px; border-top: 1px dashed var(--border); }
.ord-filters .search-box { flex: 1; min-width: 240px; max-width: 340px; }
.filter-field { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }
.filter-field > span { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.filter-field select, .filter-field input { padding: 6px 10px; font-size: 12px; border-radius: 7px; }
.clear-btn { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); border-radius: 7px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; align-self: flex-end; }
.clear-btn:hover { background: rgba(239,68,68,0.16); }

/* Table */
.ord-table {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden;
}
.ord-table header,
.ord-row {
  display: grid;
  grid-template-columns: 30px 110px 1.4fr 1.6fr 60px 100px 1fr 110px 130px 90px 70px;
  gap: 10px; padding: 10px 14px;
  align-items: center;
  font-size: 12px;
}
.ord-table header {
  background: var(--surface-2); color: var(--muted);
  font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
}
.ord-row { cursor: pointer; border-bottom: 1px solid rgba(148, 163, 184, 0.06); transition: 100ms; }
.ord-row:hover { background: rgba(148, 163, 184, 0.04); }
.ord-row.expanded { background: rgba(34, 197, 94, 0.04); }
.expand-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 2px; display: grid; place-items: center; }
.expand-btn:hover { color: #22c55e; }
.mono-id { color: var(--text); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.email-cell { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-cell { font-size: 12px; color: var(--text); }
.item-cell small { display: block; font-size: 10.5px; color: var(--muted); }
.zone-cell { display: inline-flex; align-items: center; gap: 5px; color: var(--text); }
.flag-pill { font-size: 9.5px; font-family: 'JetBrains Mono', monospace; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-weight: 700; color: var(--muted); }
.node-cell { font-size: 11.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amount-cell { font-size: 12px; color: #22c55e; font-weight: 600; }
.time-cell { font-size: 11px; color: var(--muted); }
.time-cell small { display: block; font-size: 10px; color: #f59e0b; }
.actions-cell { display: inline-flex; gap: 4px; }
.ghost-button.mini { padding: 4px 6px; }
.ghost-button.mini.danger { color: #ef4444; }
.ghost-button.mini.danger:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); }

.badge {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em;
  padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace;
}
.badge.type-v4 { background: rgba(59,130,246,0.16); color: #60a5fa; }
.badge.type-v6 { background: rgba(34,197,94,0.16); color: #22c55e; }
.badge.type-mix { background: rgba(245,158,11,0.16); color: #f59e0b; }

.status-pill {
  font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: 0.04em;
  font-family: 'JetBrains Mono', monospace;
}
.status-pill.active { background: rgba(34,197,94,0.16); color: #22c55e; }
.status-pill.failed { background: rgba(239,68,68,0.16); color: #ef4444; }
.status-pill.pending { background: rgba(245,158,11,0.16); color: #f59e0b; }

/* Expanded members table */
.ord-members {
  background: rgba(34, 197, 94, 0.03);
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
  padding: 6px 16px 14px 50px;
}
.ord-members table { width: 100%; border-collapse: collapse; }
.ord-members th, .ord-members td {
  text-align: left; padding: 6px 10px; font-size: 11.5px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
}
.ord-members th { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.ord-members td { color: var(--text); }
.loading-row { padding: 14px; color: var(--muted); text-align: center; font-size: 12px; }

.empty { padding: 60px 0; text-align: center; color: var(--muted); }

@media (max-width: 1200px) {
  .ord-table header, .ord-row { grid-template-columns: 30px 90px 1fr 1.4fr 50px 90px 1fr 90px 90px 70px 60px; font-size: 11px; }
  .ord-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .ord-kpis { grid-template-columns: 1fr; }
  .ord-table { overflow-x: auto; }
  .ord-table header, .ord-row { min-width: 920px; }
}
</style>
