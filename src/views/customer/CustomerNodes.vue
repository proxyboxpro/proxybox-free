<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Activity, ChevronDown, ChevronRight, Copy, Cpu, ExternalLink, KeyRound, MoreHorizontal,
  Network, Plus, RefreshCw, Server, ShieldCheck, Terminal, Trash2, Wifi
} from 'lucide-vue-next'

// Docs steps are collapsible — show only the title until the user clicks "?".
// Most operators don't need to re-read the intro after first install.
const openStep = ref(0)             // 0 = none open, 1|2|3 = which step body is shown
const router = useRouter()
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { formatBytes, formatNumber } from '../../utils/format'

const { t } = useI18n()
const nodes = ref([])
const token = ref(null)
const err = ref('')
const flash = ref('')
const busy = ref(false)
const copiedKey = ref('')

async function loadNodes() {
  err.value = ''
  try { nodes.value = await apiFetch('/api/v1/user/nodes') }
  catch (e) { err.value = e.message }
}
async function loadToken() {
  try { token.value = await apiFetch('/api/v1/user/nodes/fleet-token') }
  catch (e) { if (e.status !== 404) err.value = e.message }
}
async function generateToken() {
  busy.value = true
  try {
    token.value = await apiFetch('/api/v1/user/nodes/fleet-token', { method: 'POST' })
    flash.value = t('cust.nodes.tokenGenerated')
    setTimeout(() => flash.value = '', 4000)
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}
async function revokeToken() {
  if (!confirm(t('cust.nodes.revokeConfirm'))) return
  try {
    await apiFetch('/api/v1/user/nodes/fleet-token', { method: 'DELETE' })
    token.value = null
    flash.value = t('cust.nodes.tokenRevoked')
    setTimeout(() => flash.value = '', 3000)
  } catch (e) { err.value = e.message }
}
async function deleteNode(node) {
  if (!confirm(t('cust.nodes.deleteConfirm', { name: node.name, host: node.host }))) return
  try {
    const r = await apiFetch(`/api/v1/user/nodes/${node.id}`, { method: 'DELETE' })
    flash.value = t('cust.nodes.nodeDeleted', { n: r.removedProxies })
    setTimeout(() => flash.value = '', 3000)
    await loadNodes()
  } catch (e) { err.value = e.message }
}
async function toggleNode(node) {
  try {
    await apiFetch(`/api/v1/user/nodes/${node.id}/${node.disabled ? 'enable' : 'disable'}`, { method: 'POST' })
    await loadNodes()
  } catch (e) { err.value = e.message }
}
function copyCmd(text, key) {
  navigator.clipboard?.writeText(text)
  copiedKey.value = key
  setTimeout(() => copiedKey.value = '', 1500)
}

onMounted(() => { loadNodes(); loadToken() })

const totals = computed(() => nodes.value.reduce((acc, n) => {
  acc.proxies += n.proxyCount || 0
  acc.active  += n.activeProxies || 0
  acc.conns   += n.activeConns || 0
  acc.bw      += (n.uploadBytes || 0) + (n.downloadBytes || 0)
  return acc
}, { proxies: 0, active: 0, conns: 0, bw: 0 }))
</script>

<template>
  <div class="page-head">
    <div>
      <h1>ProxyBox <small>· IPv4 / IPv6</small></h1>
      <p class="sub" v-html="t('cust.nodes.subtitle')"></p>
    </div>
    <router-link to="/api-docs" class="ghost-button">
      <Terminal :size="13" /> API docs
    </router-link>
  </div>

  <!-- How it works — collapsible 3-step intro (click number to expand) -->
  <section class="howto">
    <button type="button" class="ht-step" :class="{ open: openStep === 1 }" @click="openStep = openStep === 1 ? 0 : 1">
      <span class="ht-num">1</span>
      <div class="ht-body">
        <strong>{{ t('cust.nodes.step1Title') }} <ChevronRight :size="12" class="chev" /></strong>
        <p v-if="openStep === 1" v-html="t('cust.nodes.step1Body')"></p>
      </div>
    </button>
    <button type="button" class="ht-step" :class="{ open: openStep === 2 }" @click="openStep = openStep === 2 ? 0 : 2">
      <span class="ht-num">2</span>
      <div class="ht-body">
        <strong>{{ t('cust.nodes.step2Title') }} <ChevronRight :size="12" class="chev" /></strong>
        <p v-if="openStep === 2" v-html="t('cust.nodes.step2Body')"></p>
      </div>
    </button>
    <button type="button" class="ht-step" :class="{ open: openStep === 3 }" @click="openStep = openStep === 3 ? 0 : 3">
      <span class="ht-num">3</span>
      <div class="ht-body">
        <strong>{{ t('cust.nodes.step3Title') }} <ChevronRight :size="12" class="chev" /></strong>
        <p v-if="openStep === 3" v-html="t('cust.nodes.step3Body')"></p>
      </div>
    </button>
  </section>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" class="success-text">{{ flash }}</p>

  <!-- KPI strip -->
  <div class="byon-kpi">
    <article>
      <span class="kpi-ico" style="background:rgba(139,92,246,0.12);color:#a78bfa"><Server :size="14" /></span>
      <div>
        <span class="lbl">Nodes</span>
        <strong>{{ nodes.length }}</strong>
      </div>
    </article>
    <article>
      <span class="kpi-ico" style="background:rgba(34,197,94,0.12);color:#22c55e"><Network :size="14" /></span>
      <div>
        <span class="lbl">Proxies (BYON)</span>
        <strong>{{ totals.active }}<small>/{{ totals.proxies }}</small></strong>
      </div>
    </article>
    <article>
      <span class="kpi-ico" style="background:rgba(59,130,246,0.12);color:#60a5fa"><Activity :size="14" /></span>
      <div>
        <span class="lbl">Live conns</span>
        <strong>{{ formatNumber(totals.conns) }}</strong>
      </div>
    </article>
    <article>
      <span class="kpi-ico" style="background:rgba(6,182,212,0.12);color:#22d3ee"><Wifi :size="14" /></span>
      <div>
        <span class="lbl">Bandwidth</span>
        <strong>{{ formatBytes(totals.bw) }}</strong>
      </div>
    </article>
  </div>

  <!-- Token + install (compact) -->
  <section class="surface tok-section">
    <div class="tok-head">
      <span class="tok-title"><KeyRound :size="13" /> {{ t('cust.nodes.tokenTitle') }}</span>
      <code v-if="token" class="tok-inline" :title="token.token">{{ token.token.slice(0, 14) }}…{{ token.token.slice(-6) }}</code>
      <span class="tok-actions">
        <button v-if="!token" class="primary-action small" type="button" :disabled="busy" @click="generateToken">
          <Plus :size="12" /> {{ t('cust.nodes.genToken') }}
        </button>
        <template v-else>
          <button class="ghost-button mini" type="button" @click="copyCmd(token.token, 'tok')">
            <Copy :size="11" /> {{ copiedKey === 'tok' ? '✓' : 'Copy' }}
          </button>
          <button class="ghost-button mini" type="button" @click="generateToken" title="Rotate token">
            <RefreshCw :size="11" />
          </button>
          <button class="ghost-button mini" type="button" @click="revokeToken" title="Revoke token">
            <Trash2 :size="11" />
          </button>
        </template>
      </span>
    </div>

    <div v-if="!token" class="tok-empty" v-html="t('cust.nodes.tokenEmpty')"></div>

    <div v-else class="install-cmds">
      <div class="cmd-card">
        <header><strong>Linux IPv4</strong>
          <button class="ghost-button mini" type="button" @click="copyCmd(token.installLinuxV4, 'v4')">
            <Copy :size="11" /> {{ copiedKey === 'v4' ? '✓' : 'Copy' }}
          </button>
        </header>
        <code class="cmd-line">{{ token.installLinuxV4 }}</code>
      </div>
      <div class="cmd-card">
        <header><strong>Linux IPv6</strong>
          <button class="ghost-button mini" type="button" @click="copyCmd(token.installLinuxV6, 'v6')">
            <Copy :size="11" /> {{ copiedKey === 'v6' ? '✓' : 'Copy' }}
          </button>
        </header>
        <code class="cmd-line">{{ token.installLinuxV6 }}</code>
      </div>
      <div class="cmd-card">
        <header><strong>Windows (Admin)</strong>
          <button class="ghost-button mini" type="button" @click="copyCmd(token.installWindows, 'win')">
            <Copy :size="11" /> {{ copiedKey === 'win' ? '✓' : 'Copy' }}
          </button>
        </header>
        <code class="cmd-line">{{ token.installWindows }}</code>
      </div>
      <div class="cmd-card uninstall">
        <header><strong>{{ t('cust.nodes.uninstall') }}</strong>
          <button class="ghost-button mini" type="button" @click="copyCmd(token.uninstall, 'un')">
            <Copy :size="11" /> {{ copiedKey === 'un' ? '✓' : 'Copy' }}
          </button>
        </header>
        <code class="cmd-line">{{ token.uninstall }}</code>
      </div>
      <p class="hint" style="grid-column:1/-1" v-html="t('cust.nodes.ipv6Hint')"></p>
    </div>
  </section>

  <!-- Nodes list -->
  <section class="surface" style="padding:18px">
    <div class="section-head">
      <h2><Server :size="14" style="vertical-align:-2px" /> {{ t('cust.nodes.yourNodes') }}</h2>
      <button class="ghost-button" type="button" style="margin-left:auto" @click="loadNodes">
        <RefreshCw :size="13" />
      </button>
    </div>

    <p v-if="!nodes.length" class="empty-text" style="text-align:left; padding:18px 0">{{ t('cust.nodes.emptyNodes') }}</p>

    <div v-else class="node-grid">
      <article
        v-for="n in nodes" :key="n.id"
        class="byon-node clickable"
        :class="{ offline: n.status !== 'online', disabled: n.disabled }"
        role="link" tabindex="0"
        @click="router.push({ name: 'my-node-detail', params: { id: n.id } })"
        @keyup.enter="router.push({ name: 'my-node-detail', params: { id: n.id } })"
      >
        <header>
          <span :class="['fam-tag', n.family]">{{ (n.family || 'dual').toUpperCase() }}</span>
          <strong class="nm">{{ n.name }}</strong>
          <span :class="['st-pill', n.status === 'online' ? 'on' : 'off']">{{ n.status }}</span>
        </header>
        <p class="host cell-mono">{{ n.host }}</p>
        <div class="metrics">
          <div>
            <small>Proxies</small>
            <strong>{{ n.activeProxies }}<small>/{{ n.proxyCount }}</small></strong>
          </div>
          <div>
            <small>Live conns</small>
            <strong style="color:var(--green)">{{ formatNumber(n.activeConns) }}</strong>
          </div>
          <div>
            <small>Bandwidth</small>
            <strong>{{ formatBytes((n.uploadBytes || 0) + (n.downloadBytes || 0)) }}</strong>
          </div>
        </div>
        <p v-if="n.version" class="ver muted-sm">agent v{{ n.version }} · last seen {{ n.lastSeenAt ? n.lastSeenAt.slice(0,19).replace('T',' ') : '—' }}</p>
        <footer class="open-cta">
          <span>{{ t('cust.nodes.manageNode') }}</span>
          <ExternalLink :size="12" />
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; line-height: 1.55; }
.success-text { color: var(--green); font-size: 13px; margin: 4px 0 10px; }
.muted-sm { color: var(--muted); font-size: 11px; }
.hint { font-size: 11.5px; color: var(--muted); margin: 10px 0 0; line-height: 1.5; }
.hint code { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; color: #d6c060; }
.link-green { color: var(--green); font-weight: 600; }

/* Header */
.page-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
.page-head > div { flex: 1; min-width: 280px; }
.page-head h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
.page-head h1 small { color: var(--muted); font-size: 14px; font-weight: 500; margin-left: 6px; }

/* Collapsible 3-step how-to. Each step is a button (click number/title to
   reveal body). Default state: title only — keeps the page free of clutter
   for returning users who already know the flow. */
.howto {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  margin-bottom: 14px;
}
@media (max-width: 800px) { .howto { grid-template-columns: 1fr; } }
.ht-step {
  display: flex; gap: 10px; align-items: flex-start;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px;
  cursor: pointer; font: inherit; color: inherit; text-align: left;
  transition: border-color 150ms, background 150ms;
}
.ht-step:hover { border-color: var(--muted); }
.ht-step.open { border-color: rgba(34,197,94,0.4); background: rgba(34,197,94,0.04); }
.ht-num {
  flex-shrink: 0; width: 24px; height: 24px;
  display: grid; place-items: center;
  background: rgba(34,197,94,0.12); color: var(--green);
  border-radius: 6px;
  font-family: var(--mono); font-weight: 700; font-size: 12.5px;
}
.ht-body { flex: 1; min-width: 0; }
.ht-step strong { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text); }
.ht-step .chev { color: var(--muted); transition: transform 150ms; }
.ht-step.open .chev { transform: rotate(90deg); color: var(--green); }
.ht-step p { font-size: 11.5px; color: var(--muted); margin: 6px 0 0; line-height: 1.55; }
.ht-step code { font-family: var(--mono); font-size: 10.5px; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; color: #d6c060; }

/* Compact token section */
.tok-section { padding: 10px 14px; margin-bottom: 14px; }
.tok-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tok-title { font-size: 12px; color: var(--text); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 5px; }
.tok-inline { font-family: var(--mono); font-size: 11.5px; color: var(--green); padding: 3px 8px; background: rgba(0,0,0,0.35); border-radius: 4px; border: 1px solid var(--border); }
.tok-actions { margin-left: auto; display: inline-flex; gap: 4px; align-items: center; }
.tok-empty { font-size: 12.5px; color: var(--muted); margin: 8px 0 0; }
.ghost-button.mini { padding: 3px 7px; font-size: 10.5px; }
.ghost-button.mini svg.open { transform: rotate(180deg); transition: transform 150ms; }

.byon-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
@media (max-width: 700px) { .byon-kpi { grid-template-columns: repeat(2, 1fr); } }
.byon-kpi article {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px;
}
.kpi-ico { width: 32px; height: 32px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; }
.byon-kpi .lbl { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.byon-kpi strong { font-size: 20px; color: var(--text); font-family: var(--mono); font-weight: 700; display: block; }
.byon-kpi strong small { font-size: 13px; color: var(--muted); font-weight: 400; }

.token-display {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 10px;
  margin: 12px 0;
}
.token-val {
  flex: 1; min-width: 0;
  font-family: var(--mono); font-size: 11.5px; color: var(--green);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  filter: blur(2.5px); transition: filter 120ms;
}
.token-val:hover { filter: none; }

.install-cmds { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
@media (max-width: 700px) { .install-cmds { grid-template-columns: 1fr; } }
.cmd-card {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 10px;
  display: flex; flex-direction: column; gap: 5px;
}
.cmd-card.uninstall { border-color: rgba(239, 68, 68, 0.25); }
.cmd-card.uninstall strong { color: #f87171; }
.cmd-card header { display: flex; align-items: center; justify-content: space-between; }
.cmd-card strong { font-size: 12px; color: var(--text); }
.cmd-line {
  font-family: var(--mono); font-size: 10.5px;
  background: rgba(0,0,0,0.35); border-radius: 4px;
  padding: 6px 8px; color: #9bb8b1;
  overflow-x: auto; white-space: nowrap;
  min-width: 0;
}
.cmd-card { min-width: 0; overflow: hidden; }
.ghost-button.mini { padding: 2px 7px; font-size: 10.5px; }

.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.byon-node {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.byon-node.offline { border-color: var(--red); opacity: 0.7; }
.byon-node.disabled { opacity: 0.55; }
.byon-node.clickable { cursor: pointer; transition: border-color 150ms, transform 150ms, box-shadow 150ms; }
.byon-node.clickable:hover { border-color: var(--green); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(34,197,94,0.12); }
.byon-node.clickable:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.open-cta {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 6px; border-top: 1px dashed var(--border);
  font-size: 12px; color: var(--green); font-weight: 600;
}
.byon-node header { display: flex; align-items: center; gap: 8px; }
.byon-node .fam-tag {
  font-family: var(--mono); font-size: 9.5px; font-weight: 700;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(59,130,246,0.16); color: #60a5fa;
}
.byon-node .fam-tag.ipv6 { background: rgba(139,92,246,0.16); color: #a78bfa; }
.byon-node .nm { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.byon-node .st-pill { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.byon-node .st-pill.on { background: rgba(34,197,94,0.16); color: var(--green); }
.byon-node .st-pill.off { background: rgba(239,68,68,0.16); color: var(--red); }
.byon-node .host { font-size: 11px; color: var(--muted); margin: 0; font-family: var(--mono); }
.byon-node .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.byon-node .metrics > div { display: flex; flex-direction: column; gap: 1px; }
.byon-node .metrics small { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.byon-node .metrics strong { font-size: 13px; color: var(--text); font-family: var(--mono); }
.byon-node .ver { font-size: 10.5px; color: var(--muted); margin: 0; }
.byon-node footer { display: flex; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
.row-act-btn.danger { color: var(--red); }
.row-act-btn.danger:hover { background: rgba(239,68,68,0.1); }

/* Mobile optimization */
@media (max-width: 700px) {
  .page-head { flex-direction: column; align-items: stretch; }
  .page-head h1 { font-size: 20px; }
  .page-head h1 small { font-size: 12px; }
  .howto { grid-template-columns: 1fr; gap: 8px; }
  .ht-step { padding: 9px 11px; }
  .tok-section { padding: 10px 11px; }
  .tok-head { flex-direction: column; align-items: stretch; gap: 8px; }
  .tok-inline { font-size: 10px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tok-actions { margin-left: 0; flex-wrap: wrap; justify-content: flex-start; gap: 4px; }
  .tok-actions .ghost-button.mini { flex: 1 1 calc(33% - 4px); justify-content: center; min-width: 70px; }
  .tok-actions .primary-action { flex: 1 1 100%; justify-content: center; }
  .install-cmds { grid-template-columns: 1fr; gap: 6px; }
  .cmd-card { padding: 7px 9px; gap: 4px; }
  .cmd-card header strong { font-size: 11px; }
  .cmd-card header .ghost-button.mini { padding: 2px 6px; font-size: 10px; }
  /* CRITICAL on mobile: wrap the long install URL instead of letting it
     overflow the card. Mono break-all keeps token + URL all readable. */
  .cmd-line {
    font-size: 10px; line-height: 1.45;
    white-space: pre-wrap; word-break: break-all; overflow-wrap: break-word;
    overflow-x: visible;
  }
  .node-grid { grid-template-columns: 1fr; }
  .byon-node { padding: 11px 12px; }
  .byon-node .nm { font-size: 12.5px; }
  .byon-node .host { font-size: 10.5px; word-break: break-all; }
  .byon-node .metrics { grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .byon-node .metrics small { font-size: 9.5px; }
  .byon-node .metrics strong { font-size: 12px; }
}
@media (max-width: 420px) {
  .byon-node .metrics { grid-template-columns: 1fr 1fr; }
}
</style>
