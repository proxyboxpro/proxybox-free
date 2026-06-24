<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity, AlertTriangle, ArrowLeft, ChevronDown, Clock, Copy, Cpu, Globe, KeyRound,
  Network, Plus, Power, PowerOff, RefreshCw, RotateCcw, Server, ShieldCheck, Stethoscope,
  Terminal, Trash2, Wifi, Zap
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { formatBytes, formatNumber } from '../../utils/format'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const nodeId = computed(() => String(route.params.id || ''))

const node = ref(null)
const proxies = ref([])
const err = ref('')
const flash = ref('')
const busy = ref(false)
const actionBusy = ref('')
const lastOutput = ref(null)        // shown in result panel when diagnose/logs returns

// Inline buy form for "create proxy on this node"
const buyForm = ref({ type: 'ipv4', quantity: 1, rotate: false, durationDays: 365 })
const buyBusy = ref(false)

async function loadAll() {
  err.value = ''
  try {
    const nodes = await apiFetch('/api/v1/user/nodes')
    node.value = (nodes || []).find((n) => n.id === nodeId.value) || null
    if (!node.value) { err.value = t('cust.nodeDetail.notFound'); return }
  } catch (e) { err.value = e.message }
  try {
    const all = await apiFetch('/api/v1/user/proxies')
    proxies.value = (all || []).filter((p) => p.nodeId === nodeId.value)
  } catch { proxies.value = [] }
}

// Auto-refresh node stats every 10s so the customer sees live connections /
// bandwidth without manually hitting refresh.
let refreshTimer = null
function startAutoRefresh() {
  stopAutoRefresh()
  refreshTimer = setInterval(loadAll, 10_000)
}
function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}

onMounted(() => { loadAll(); startAutoRefresh() })
onBeforeUnmount(stopAutoRefresh)

async function toggleNode() {
  if (!node.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    await apiFetch(`/api/v1/user/nodes/${node.value.id}/${node.value.disabled ? 'enable' : 'disable'}`, { method: 'POST' })
    await loadAll()
    flash.value = node.value?.disabled ? t('cust.nodeDetail.enabled') : t('cust.nodeDetail.disabled')
    setTimeout(() => flash.value = '', 3500)
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}

async function deleteNode() {
  if (!node.value) return
  if (!confirm(t('cust.nodeDetail.delNodeConfirm', { name: node.value.name }))) return
  busy.value = true; err.value = ''
  try {
    await apiFetch(`/api/v1/user/nodes/${node.value.id}`, { method: 'DELETE' })
    router.push('/my-nodes')
  } catch (e) { err.value = e.message; busy.value = false }
}

async function deleteProxy(p) {
  if (!confirm(t('cust.nodeDetail.delProxyConfirm', { id: p.id }))) return
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}`, { method: 'DELETE' })
    await loadAll()
    flash.value = t('cust.nodeDetail.proxyDeleted', { id: p.id })
    setTimeout(() => flash.value = '', 3000)
  } catch (e) { err.value = e.message }
}

async function rotateProxy(p) {
  try {
    await apiFetch(`/api/v1/user/proxies/${p.id}/rotate`, { method: 'POST' })
    await loadAll()
    flash.value = t('cust.nodeDetail.ipRotated', { id: p.id })
    setTimeout(() => flash.value = '', 3000)
  } catch (e) { err.value = e.message }
}

async function checkProxy(p) {
  try {
    const r = await apiFetch(`/api/v1/user/proxies/${p.id}/check`, { method: 'POST' })
    flash.value = `[${p.id}] ${r.ok ? 'OK' : 'FAIL'} · ${r.latency || '-'}ms`
    setTimeout(() => flash.value = '', 4000)
    await loadAll()
  } catch (e) { err.value = e.message }
}

async function createProxies() {
  if (buyBusy.value || !node.value) return
  buyBusy.value = true; err.value = ''; flash.value = ''
  try {
    const body = {
      nodeId: node.value.id,
      type: buyForm.value.type,
      quantity: Math.max(1, Math.min(50, Number(buyForm.value.quantity) || 1)),
      rotate: buyForm.value.type === 'ipv6' && Boolean(buyForm.value.rotate),
      durationDays: Math.max(1, Math.min(3650, Number(buyForm.value.durationDays) || 365))
    }
    const r = await apiFetch('/api/v1/user/proxies/from-own-node', { method: 'POST', body })
    flash.value = t('cust.buy.byon.created', { count: r.count, node: node.value.name })
    setTimeout(() => flash.value = '', 4000)
    await loadAll()
  } catch (e) { err.value = e.message }
  finally { buyBusy.value = false }
}

function copyToClipboard(s, key) {
  navigator.clipboard?.writeText(s).then(() => {
    flash.value = `Copied ${key}`
    setTimeout(() => flash.value = '', 1500)
  })
}

// Live totals derived from the proxy list on this node.
const totals = computed(() => {
  const ps = proxies.value
  return {
    count: ps.length,
    active: ps.filter((p) => p.status === 'active').length,
    conns: ps.reduce((s, p) => s + (p.stats?.activeConnections || 0), 0),
    bw: ps.reduce((s, p) => s + (p.stats?.uploadBytes || 0) + (p.stats?.downloadBytes || 0), 0)
  }
})

const isHub = computed(() => Boolean(node.value?.hub))
const hub = computed(() => node.value?.hub || null)
const ipv6PrefixHint = computed(() => {
  const pfx = node.value?.network?.ipv6Prefixes?.[0]
  if (!pfx) return null
  return `${pfx.prefix}/${pfx.prefixLen}`
})
</script>

<template>
  <div class="page-head">
    <button class="ghost-button" type="button" @click="router.push('/my-nodes')">
      <ArrowLeft :size="13" /> {{ t('cust.nodeDetail.back') }}
    </button>
    <div class="title-wrap" v-if="node">
      <h1>{{ node.name }}</h1>
      <p class="sub">
        <span :class="['fam-tag', node.family]">{{ (node.family || 'dual').toUpperCase() }}</span>
        <span :class="['st-pill', node.status === 'online' ? 'on' : 'off']">{{ node.status }}</span>
        <span v-if="node.tag === 'hub'" class="tag tag-hub">HUB · {{ hub?.planName || hub?.planId }}</span>
        <span class="cell-mono host-line">{{ node.host }}</span>
      </p>
    </div>
    <button class="ghost-button" type="button" @click="loadAll" :disabled="busy">
      <RefreshCw :size="13" /> {{ t('cust.refresh') }}
    </button>
  </div>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" class="success-text">{{ flash }}</p>

  <template v-if="node">
    <!-- KPI strip -->
    <div class="kpi-strip">
      <article>
        <span class="ico" style="background:rgba(34,197,94,0.12);color:#22c55e"><Network :size="14" /></span>
        <div>
          <span class="lbl">{{ t('cust.nodeDetail.statProxies') }}</span>
          <strong>{{ totals.active }}<small>/{{ totals.count }}</small></strong>
        </div>
      </article>
      <article>
        <span class="ico" style="background:rgba(59,130,246,0.12);color:#60a5fa"><Activity :size="14" /></span>
        <div>
          <span class="lbl">{{ t('cust.nodeDetail.statConns') }}</span>
          <strong>{{ formatNumber(totals.conns) }}</strong>
        </div>
      </article>
      <article>
        <span class="ico" style="background:rgba(6,182,212,0.12);color:#22d3ee"><Wifi :size="14" /></span>
        <div>
          <span class="lbl">{{ t('cust.nodeDetail.statBandwidth') }}</span>
          <strong>{{ formatBytes(totals.bw) }}</strong>
        </div>
      </article>
      <article>
        <span class="ico" style="background:rgba(139,92,246,0.12);color:#a78bfa"><Cpu :size="14" /></span>
        <div>
          <span class="lbl">{{ t('cust.nodeDetail.statAgent') }}</span>
          <strong style="font-size:14px">v{{ node.version || '—' }}</strong>
        </div>
      </article>
    </div>

    <div class="layout-2col">
      <!-- LEFT: proxies + create form -->
      <div class="col-main">
        <section class="surface buy-card">
          <header><Plus :size="14" style="color:var(--green)" /> <strong>{{ t('cust.nodeDetail.createTitle') }}</strong> <small>{{ t('cust.nodeDetail.freeSmall') }}</small></header>
          <div class="buy-form">
            <label class="field">
              <span>{{ t('cust.buy.byon.typeLabel') }}</span>
              <select v-model="buyForm.type">
                <option v-if="!node.family || node.family === 'dual' || node.family === 'ipv4'" value="ipv4">IPv4</option>
                <option v-if="!node.family || node.family === 'dual' || node.family === 'ipv6'" value="ipv6">IPv6 {{ ipv6PrefixHint ? `(${ipv6PrefixHint})` : '' }}</option>
              </select>
            </label>
            <label class="field">
              <span>{{ t('cust.buy.quantity') }}</span>
              <input v-model.number="buyForm.quantity" type="number" min="1" max="50" />
            </label>
            <label class="field">
              <span>{{ t('cust.buy.byon.durationDays') }}</span>
              <input v-model.number="buyForm.durationDays" type="number" min="1" max="3650" />
            </label>
            <label v-if="buyForm.type === 'ipv6'" class="field-checkbox">
              <input v-model="buyForm.rotate" type="checkbox" />
              <span>{{ t('cust.nodeDetail.rotationPool') }}</span>
            </label>
            <button class="primary-action" type="button" :disabled="buyBusy" @click="createProxies">
              <Plus :size="13" /> {{ buyBusy ? t('cust.buy.byon.creating') : t('cust.nodeDetail.createBtn', { n: buyForm.quantity }) }}
            </button>
          </div>
        </section>

        <section class="surface" style="padding:14px">
          <header style="display:flex; align-items:center; gap:8px; margin-bottom:10px">
            <Network :size="14" style="color:var(--green)" />
            <strong>{{ t('cust.nodeDetail.proxiesTitle', { n: proxies.length }) }}</strong>
          </header>

          <p v-if="!proxies.length" class="empty-text" style="text-align:left; padding:14px 0">
            {{ t('cust.nodeDetail.emptyProxies') }}
          </p>

          <ul v-else class="proxy-list">
            <li v-for="p in proxies" :key="p.id" class="proxy-row" :class="{ disabled: p.status === 'expired' || p.status === 'error' }">
              <div class="px-main">
                <strong class="cell-mono">{{ p.id }}</strong>
                <span :class="['st-pill mini', p.status === 'active' ? 'on' : (p.status === 'expired' ? 'off' : 'warn')]">{{ p.status }}</span>
                <span :class="['fam-tag', p.type === 'IPv6' ? 'ipv6' : 'ipv4']">{{ p.type }}</span>
              </div>
              <div class="px-endpoint">
                <code class="cell-mono">{{ (p.ip || p.host) }}:{{ p.port }}</code>
                <button class="ghost-button mini" type="button" @click="copyToClipboard(p.http || `http://${p.username}:${p.password}@${p.ip}:${p.port}`, p.id)">
                  <Copy :size="10" /> http
                </button>
                <button class="ghost-button mini" type="button" @click="copyToClipboard(p.socks5 || `socks5://${p.username}:${p.password}@${p.ip}:${p.port}`, p.id+'-s5')">
                  <Copy :size="10" /> socks5
                </button>
              </div>
              <div class="px-stats cell-mono">
                <small>conns:</small> {{ p.stats?.activeConnections || 0 }}
                <small style="margin-left:8px">bw:</small> {{ formatBytes((p.stats?.uploadBytes || 0) + (p.stats?.downloadBytes || 0)) }}
              </div>
              <div class="px-actions">
                <button v-if="p.type === 'IPv6'" class="ghost-button mini" type="button" :title="t('cust.nodeDetail.tipRotateIp')" @click="rotateProxy(p)">
                  <RotateCcw :size="11" />
                </button>
                <button class="ghost-button mini" type="button" :title="t('cust.nodeDetail.healthCheck')" @click="checkProxy(p)">
                  <ShieldCheck :size="11" />
                </button>
                <button class="ghost-button mini danger" type="button" :title="t('cust.nodeDetail.del')" @click="deleteProxy(p)">
                  <Trash2 :size="11" />
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- Hub-specific info (when this node is a rented hub VPS) -->
        <section v-if="isHub" class="surface hub-info">
          <header><Server :size="14" style="color:#22d3ee" /> <strong>{{ t('cust.nodeDetail.hubInfo') }}</strong></header>
          <dl class="kv-grid">
            <div><dt>Plan</dt><dd>{{ hub.planName }}</dd></div>
            <div><dt>VPS ID</dt><dd class="cell-mono">{{ hub.vpsid }}</dd></div>
            <div><dt>{{ t('cust.nodeDetail.paid') }}</dt><dd>{{ hub.hoursPaid }} {{ t('cust.nodeDetail.hoursUnit') }}</dd></div>
            <div><dt>{{ t('cust.nodeDetail.expires') }}</dt><dd class="cell-mono">{{ hub.expiresAt?.slice(0,16).replace('T',' ') }}</dd></div>
            <div><dt>{{ t('cust.nodeDetail.status') }}</dt><dd>{{ hub.state || '—' }}</dd></div>
            <div><dt>{{ t('cust.nodeDetail.price') }}</dt><dd>{{ Number(hub.hourlyPrice || 0).toLocaleString() }} {{ t('cust.nodeDetail.perHourUnit') }}</dd></div>
          </dl>
        </section>
      </div>

      <!-- RIGHT: node info + actions -->
      <aside class="col-aside">
        <section class="surface">
          <header style="display:flex; align-items:center; gap:6px; margin-bottom:10px">
            <Server :size="14" /> <strong>{{ t('cust.nodeDetail.nodeInfo') }}</strong>
          </header>
          <dl class="kv-grid">
            <div><dt>Host</dt><dd class="cell-mono">{{ node.host }}</dd></div>
            <div><dt>{{ t('nodes.family') }}</dt><dd>{{ (node.family || 'dual').toUpperCase() }}</dd></div>
            <div><dt>Zone</dt><dd>{{ node.zone || node.region || '—' }}</dd></div>
            <div><dt>Tag</dt><dd>{{ node.tag || 'byon' }}</dd></div>
            <div><dt>Agent</dt><dd class="cell-mono">v{{ node.version || '—' }}</dd></div>
            <div><dt>{{ t('cust.nodeDetail.dtLastSeen') }}</dt><dd class="cell-mono">{{ node.lastSeenAt?.slice(11,19) || '—' }}</dd></div>
          </dl>
          <details v-if="node.network" class="net-details">
            <summary>Network <ChevronDown :size="12" /></summary>
            <div v-if="node.network.ipv4?.length">
              <strong>IPv4:</strong>
              <code v-for="ip in node.network.ipv4" :key="ip.address" class="cell-mono ip-chip">{{ ip.address }}</code>
            </div>
            <div v-if="node.network.ipv6Prefixes?.length">
              <strong>IPv6 prefixes:</strong>
              <code v-for="p in node.network.ipv6Prefixes" :key="p.prefix" class="cell-mono ip-chip">{{ p.prefix }}/{{ p.prefixLen }}</code>
            </div>
          </details>
        </section>

        <section class="surface">
          <header style="display:flex; align-items:center; gap:6px; margin-bottom:10px">
            <ShieldCheck :size="14" /> <strong>{{ t('cust.nodeDetail.actions') }}</strong>
          </header>
          <div class="action-stack">
            <button class="action-row" type="button" :disabled="busy" @click="toggleNode">
              <component :is="node.disabled ? Power : PowerOff" :size="13" />
              <span>{{ node.disabled ? t('cust.nodeDetail.enableNode') : t('cust.nodeDetail.pauseNode') }}</span>
              <small>{{ node.disabled ? t('cust.nodeDetail.agentResume') : t('cust.nodeDetail.agentPause') }}</small>
            </button>
            <button class="action-row danger" type="button" :disabled="busy" @click="deleteNode">
              <Trash2 :size="13" />
              <span>{{ t('cust.nodeDetail.deleteNode') }}</span>
              <small>{{ t('cust.nodeDetail.deleteNodeHint') }}</small>
            </button>
          </div>
        </section>
      </aside>
    </div>
  </template>

  <p v-else-if="!err" class="empty-text" style="padding:60px">{{ t('common.loading') }}</p>
</template>

<style scoped>
.error-text { color: var(--red); font-size: 13px; margin: 4px 0 10px; }
.success-text { color: var(--green); font-size: 13px; margin: 4px 0 10px; }
.empty-text { color: var(--muted); text-align: center; font-size: 13px; }

.page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.title-wrap { flex: 1; min-width: 200px; }
.title-wrap h1 { margin: 0; font-size: 22px; font-weight: 700; }
.sub { margin: 4px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }

.fam-tag {
  font-family: var(--mono); font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(59,130,246,0.16); color: #60a5fa;
}
.fam-tag.ipv6 { background: rgba(139,92,246,0.16); color: #a78bfa; }
.st-pill { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.st-pill.on { background: rgba(34,197,94,0.16); color: var(--green); }
.st-pill.off { background: rgba(239,68,68,0.16); color: var(--red); }
.st-pill.warn { background: rgba(245,158,11,0.16); color: #f59e0b; }
.st-pill.mini { font-size: 9.5px; padding: 1px 5px; }
.tag-hub { font-size: 10.5px; padding: 2px 7px; border-radius: 4px; background: rgba(34,211,238,0.16); color: #22d3ee; font-weight: 600; }
.host-line { font-size: 12px; color: var(--text); }

.kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
@media (max-width: 700px) { .kpi-strip { grid-template-columns: repeat(2, 1fr); } }
.kpi-strip article {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px;
}
.kpi-strip .ico { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; }
.kpi-strip .lbl { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.kpi-strip strong { font-size: 18px; color: var(--text); font-family: var(--mono); display: block; }
.kpi-strip strong small { font-size: 12px; color: var(--muted); font-weight: 400; }

.layout-2col { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; align-items: start; }
@media (max-width: 900px) { .layout-2col { grid-template-columns: 1fr; } }
.col-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.col-aside { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

.surface header strong { font-size: 13px; color: var(--text); }
.surface header small { font-size: 11.5px; color: var(--muted); }

.buy-card { padding: 14px 16px; }
.buy-form {
  display: grid; grid-template-columns: 1fr 110px 130px; gap: 10px; align-items: end;
  margin-top: 10px;
}
@media (max-width: 600px) { .buy-form { grid-template-columns: 1fr 1fr; } }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field > span { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.field input, .field select {
  height: 34px; padding: 0 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 13px; outline: none;
}
.field input:focus, .field select:focus { border-color: var(--green); }
.field-checkbox { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); cursor: pointer; grid-column: 1 / -1; }
.buy-form .primary-action { grid-column: 1 / -1; justify-content: center; }
@media (min-width: 601px) {
  .buy-form .primary-action { grid-column: auto; }
}

.proxy-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.proxy-row {
  display: grid;
  grid-template-columns: 1.4fr 2fr 1fr 0.8fr;
  gap: 10px; align-items: center;
  padding: 8px 10px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
}
.proxy-row.disabled { opacity: 0.55; }
.px-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
.px-main strong { font-size: 12.5px; }
.px-endpoint { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.px-endpoint code { font-size: 11.5px; color: var(--text); }
.px-stats { font-size: 11px; color: var(--muted); }
.px-stats small { color: var(--muted); text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.04em; margin-right: 2px; }
.px-actions { display: flex; gap: 4px; justify-content: flex-end; }
.ghost-button.mini { padding: 3px 7px; font-size: 10.5px; display: inline-flex; align-items: center; gap: 3px; }
.ghost-button.mini.danger { color: var(--red); border-color: rgba(239,68,68,0.3); }
.ghost-button.mini.danger:hover { background: rgba(239,68,68,0.08); }
@media (max-width: 700px) {
  .proxy-row {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .px-actions { justify-content: flex-start; }
}

.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin: 0; }
.kv-grid > div { min-width: 0; }
.kv-grid dt { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kv-grid dd { margin: 1px 0 0; font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.net-details { margin-top: 10px; }
.net-details summary { cursor: pointer; color: var(--muted); font-size: 11.5px; list-style: none; display: inline-flex; align-items: center; gap: 4px; }
.net-details summary::-webkit-details-marker { display: none; }
.net-details > div { margin-top: 6px; font-size: 11.5px; }
.ip-chip {
  display: inline-block; margin: 3px 4px 0 0;
  padding: 2px 6px;
  background: rgba(0,0,0,0.3); border-radius: 4px;
  font-size: 10.5px; color: var(--text);
}

.action-stack { display: flex; flex-direction: column; gap: 6px; }
.action-row {
  display: grid; grid-template-columns: 18px 1fr; grid-template-rows: auto auto;
  gap: 2px 10px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 9px 12px;
  cursor: pointer; text-align: left; color: var(--text); font: inherit;
  transition: border-color 150ms, background 150ms;
}
.action-row > :first-child { grid-row: 1 / span 2; align-self: center; }
.action-row span { font-size: 12.5px; font-weight: 600; }
.action-row small { font-size: 10.5px; color: var(--muted); grid-column: 2; }
.action-row:hover:not(:disabled) { border-color: var(--green); background: rgba(34,197,94,0.04); }
.action-row.danger { color: var(--red); }
.action-row.danger:hover:not(:disabled) { border-color: var(--red); background: rgba(239,68,68,0.06); }
.action-row:disabled { opacity: 0.5; cursor: wait; }

.hub-info { padding: 14px 16px; border-color: rgba(34,211,238,0.25); }
.hub-info dt { color: rgba(34,211,238,0.7); }
</style>
