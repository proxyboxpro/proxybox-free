<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Cpu, Download, FileText, HardDrive, RefreshCw, Server, Terminal, Trash2 } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { fetchNode, syncNode, removeNode, installNode } from '../store/nodes'
import { formatBytes } from '../utils/format'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const node = ref(null)
const loading = ref(true)
const errorText = ref('')
const syncing = ref(false)
const installing = ref(false)
const installOutput = ref('')
const familySaving = ref(false)
const logsOpen = ref(false)
const logsLoading = ref(false)
const logsOutput = ref('')
const logsLines = ref(200)
const logsErr = ref('')

const nodeId = computed(() => route.params.nodeId)
const isLocal = computed(() => nodeId.value === 'local')

async function load() {
  loading.value = true; errorText.value = ''
  try { node.value = await fetchNode(nodeId.value) }
  catch (e) { errorText.value = e.message; node.value = null }
  finally { loading.value = false }
}

async function onSync() {
  if (syncing.value) return
  syncing.value = true
  try { await syncNode(nodeId.value); setTimeout(load, 1500) }
  catch (e) { errorText.value = e.message }
  finally { syncing.value = false }
}

async function setFamily(fam) {
  if (familySaving.value) return
  if (node.value && (node.value.family || '').toLowerCase() === fam) return
  familySaving.value = true; errorText.value = ''
  try {
    const updated = await apiFetch(`/api/nodes/${nodeId.value}`, { method: 'PATCH', body: { family: fam } })
    node.value = { ...node.value, ...updated }
    setTimeout(load, 300)
  } catch (e) { errorText.value = e.message }
  finally { familySaving.value = false }
}

async function onInstall() {
  if (installing.value || isLocal.value) return
  installing.value = true; installOutput.value = ''
  try {
    const r = await installNode(nodeId.value)
    installOutput.value = r.output || r.error || (r.ok ? 'OK' : 'failed')
    setTimeout(load, 1500)
  } catch (e) { installOutput.value = e.message }
  finally { installing.value = false }
}

async function onDelete() {
  if (isLocal.value) return
  if (!confirm(t('nodes.confirmDelete'))) return
  try { await removeNode(nodeId.value); router.push({ name: 'admin-nodes' }) }
  catch (e) { errorText.value = e.message }
}

const upgrade = ref(null)
const upgradeLoading = ref(false)
const upgradeCopied = ref(false)
async function loadUpgrade() {
  if (isLocal.value) return
  upgradeLoading.value = true
  try { upgrade.value = await apiFetch(`/api/nodes/${nodeId.value}/upgrade-command`) }
  catch (e) { errorText.value = e.message }
  finally { upgradeLoading.value = false }
}
async function rotateUpgradeToken() {
  if (!confirm('Tạo token mới? URL cũ sẽ ngừng hoạt động.')) return
  upgradeLoading.value = true
  try { upgrade.value = await apiFetch(`/api/nodes/${nodeId.value}/upgrade-command`, { method: 'POST' }) }
  catch (e) { errorText.value = e.message }
  finally { upgradeLoading.value = false }
}
async function copyUpgradeCmd() {
  if (!upgrade.value?.oneLiner) return
  try { await navigator.clipboard.writeText(upgrade.value.oneLiner); upgradeCopied.value = true; setTimeout(() => { upgradeCopied.value = false }, 2000) } catch { /* noop */ }
}

async function fetchLogs() {
  if (logsLoading.value) return
  logsLoading.value = true; logsErr.value = ''
  try {
    const r = await apiFetch(`/api/nodes/${nodeId.value}/logs?lines=${Math.max(10, Math.min(5000, Number(logsLines.value) || 200))}`)
    logsOutput.value = r.output || r.error || ''
  } catch (e) { logsErr.value = e.message }
  finally { logsLoading.value = false }
}
function toggleLogs() {
  logsOpen.value = !logsOpen.value
  if (logsOpen.value && !logsOutput.value) fetchLogs()
}

function uptime(seconds) {
  const s = Number(seconds) || 0
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

const family = computed(() => (node.value?.family || '').toLowerCase())
const isV4 = computed(() => family.value === 'ipv4')
const isV6 = computed(() => family.value === 'ipv6')
const ipv4 = computed(() => node.value?.network?.ipv4 || [])
const ipv6 = computed(() => node.value?.network?.ipv6 || [])
const ipv6Prefixes = computed(() => node.value?.network?.ipv6Prefixes || [])
const proxies = computed(() => node.value?.proxies || [])
const ipv4Proxies = computed(() => proxies.value.filter((p) => (p.type || '').toLowerCase() === 'ipv4'))
const ipv6Proxies = computed(() => proxies.value.filter((p) => (p.type || '').toLowerCase() === 'ipv6'))

const totalUp = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.uploadBytes || 0), 0))
const totalDown = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.downloadBytes || 0), 0))
const totalMonth = computed(() => proxies.value.reduce((a, p) => a + (p.stats?.monthBytes || 0), 0))

watch(nodeId, () => { load(); loadUpgrade() })
onMounted(() => { load(); loadUpgrade() })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <button class="ghost-button" type="button" @click="router.push({ name: 'admin-nodes' })"><ArrowLeft :size="15" /> {{ t('nodes.backToList') }}</button>
      <div class="spacer"></div>
      <button class="primary-action small" type="button" :disabled="syncing" @click="onSync"><RefreshCw :size="15" /> {{ syncing ? t('nodes.syncing') : t('nodes.sync') }}</button>
      <button v-if="!isLocal && node && node.hasCreds && node.status !== 'online'" class="ghost-button" type="button" :disabled="installing" @click="onInstall">{{ installing ? t('nodes.installing') : t('nodes.install') }}</button>
      <button v-if="!isLocal" class="ghost-button" type="button" @click="onDelete"><Trash2 :size="14" /></button>
    </div>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>
    <p v-if="loading && !node" class="empty-text">{{ t('common.loading') }}</p>

    <section v-if="node" class="surface">
      <div class="section-head">
        <h2><Server :size="16" style="vertical-align:-3px" /> {{ node.name }} <span style="color:var(--muted); font-size:12px; margin-left:8px">{{ nodeId }}</span></h2>
        <span :class="['status-pill', node.status === 'online' ? 'active' : (node.status === 'install-failed' ? 'failed' : 'pending')]">{{ node.status }}</span>
      </div>
      <div class="detail-grid">
        <div><span>{{ t('nodes.role') }}</span><strong>{{ node.role }}</strong></div>
        <div>
          <span>{{ t('nodes.family') }}</span>
          <div class="family-toggle">
            <button
              type="button"
              :class="['family-btn', { active: isV4 }]"
              :disabled="familySaving"
              @click="setFamily('ipv4')"
            >IPv4</button>
            <button
              type="button"
              :class="['family-btn', { active: isV6 }]"
              :disabled="familySaving"
              @click="setFamily('ipv6')"
            >IPv6</button>
          </div>
        </div>
        <div><span>{{ t('nodes.host') }}</span><strong class="cell-mono">{{ node.host }}</strong></div>
        <div>
          <span>{{ t('nodes.version') }}</span>
          <strong>
            {{ node.version || '—' }}
            <span v-if="node.outdated" class="status-pill pending" style="margin-left:6px; font-size:10.5px">outdated</span>
            <span v-else-if="node.version && node.latestAgentVersion === node.version" class="status-pill active" style="margin-left:6px; font-size:10.5px">latest</span>
          </strong>
        </div>
        <div v-if="isLocal"><span>{{ t('nodes.uptime') }}</span><strong>{{ uptime(node.uptimeSeconds) }}</strong></div>
        <div v-else><span>{{ t('nodes.lastSeen') }}</span><strong>{{ node.lastSeenAt || '—' }}</strong></div>
        <div><span>{{ t('nodes.proxies') }}</span><strong>{{ proxies.length }}</strong></div>
        <div><span>{{ t('detail.traffic') }} ↑/↓ {{ t('common.thisMonth') }}</span><strong class="cell-mono">{{ formatBytes(totalUp) }} / {{ formatBytes(totalDown) }} ({{ formatBytes(totalMonth) }})</strong></div>
      </div>
    </section>

    <section v-if="node && node.metrics" class="surface">
      <div class="section-head"><h2><Cpu :size="16" style="vertical-align:-3px" /> {{ t('nodes.metrics') }}</h2></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">CPU</div><div class="metric-value">{{ node.metrics.cpuPct }}%</div></div>
        <div class="metric-card"><div class="metric-label">RAM</div><div class="metric-value">{{ node.metrics.ramPct }}%</div><div class="metric-foot">{{ formatBytes(node.metrics.ramUsed) }} / {{ formatBytes(node.metrics.ramTotal) }}</div></div>
        <div class="metric-card"><div class="metric-label">Load (1m / 5m)</div><div class="metric-value">{{ Number(node.metrics.load1).toFixed(2) }} / {{ Number(node.metrics.load5).toFixed(2) }}</div></div>
        <div class="metric-card"><div class="metric-label">Net RX</div><div class="metric-value">{{ formatBytes(node.metrics.netRxBps) }}/s</div></div>
        <div class="metric-card"><div class="metric-label">Net TX</div><div class="metric-value">{{ formatBytes(node.metrics.netTxBps) }}/s</div></div>
        <div class="metric-card"><div class="metric-label">{{ t('nodes.uptime') }}</div><div class="metric-value">{{ uptime(node.metrics.uptimeSec) }}</div></div>
      </div>
    </section>

    <!-- Upgrade agent — admin runs the one-liner on the node to swap binary -->
    <section v-if="node && !isLocal" class="surface">
      <div class="section-head" style="display:flex; align-items:center; gap:10px">
        <h2><Download :size="16" style="vertical-align:-3px" /> Cập nhật agent</h2>
        <span v-if="upgrade?.outdated" class="status-pill pending" style="font-size:11px">v{{ upgrade.currentVersion }} → v{{ upgrade.latestVersion }}</span>
        <span v-else-if="upgrade && !upgrade.outdated && upgrade.currentVersion" class="status-pill active" style="font-size:11px">đang dùng phiên bản mới nhất (v{{ upgrade.latestVersion }})</span>
        <div class="spacer"></div>
        <button class="ghost-button" type="button" :disabled="upgradeLoading" @click="rotateUpgradeToken" style="font-size:11px">Đổi token</button>
      </div>
      <p v-if="!upgrade" class="empty-text" style="padding:10px 0">Đang tải lệnh upgrade…</p>
      <div v-else>
        <p style="font-size:13px; color:var(--muted); margin:0 0 8px">
          SSH vào node <code>{{ node.host }}</code> và chạy lệnh dưới đây để cập nhật agent lên phiên bản mới nhất.
          Lệnh tự stop service, tải binary, restart — config + PKI giữ nguyên.
        </p>
        <div class="upgrade-cmd-box">
          <code>{{ upgrade.oneLiner }}</code>
          <button class="ghost-button" type="button" @click="copyUpgradeCmd">
            {{ upgradeCopied ? '✓ copied' : 'copy' }}
          </button>
        </div>
        <p style="font-size:11.5px; color:var(--muted); margin:8px 0 0">
          Script: <a :href="upgrade.upgradeScriptUrl" target="_blank" rel="noopener" style="color:var(--muted)">xem nội dung</a> ·
          Binary: <a :href="upgrade.binaryUrl" target="_blank" rel="noopener" style="color:var(--muted)">download</a>
        </p>
      </div>
    </section>

    <section v-if="node" class="surface">
      <div class="section-head">
        <h2><HardDrive :size="16" style="vertical-align:-3px" /> {{ t('nodes.networkInfra') }}</h2>
        <button class="ghost-button" type="button" :disabled="syncing" @click="onSync"><RefreshCw :size="14" /> {{ t('nodes.syncIPs') }}</button>
      </div>
      <div class="detail-grid">
        <div v-if="!isV6">
          <span>{{ t('nodes.ipv4Count') }}</span>
          <strong>{{ ipv4.length }} {{ t('nodes.addresses') }}</strong>
        </div>
        <div v-if="!isV4">
          <span>{{ t('nodes.ipv6Count') }}</span>
          <strong>{{ ipv6.length }} {{ t('nodes.addresses') }}</strong>
        </div>
        <div v-if="!isV4">
          <span>{{ t('nodes.ipv6Prefix') }}</span>
          <strong class="cell-mono">{{ ipv6Prefixes.length ? ipv6Prefixes.map((p) => p.cidr).join(', ') : '—' }}</strong>
        </div>
        <div v-if="node.network && node.network.ipv4PoolSize !== undefined">
          <span>{{ t('nodes.poolSize') }}</span>
          <strong>{{ isV6 ? (node.network.ipv6PoolSize || 0) : (isV4 ? (node.network.ipv4PoolSize || 0) : (node.network.ipv4PoolSize || 0) + (node.network.ipv6PoolSize || 0)) }}</strong>
        </div>
      </div>
      <details v-if="!isV6 && ipv4.length" style="margin-top:12px">
        <summary style="cursor:pointer; color:var(--muted); font-size:13px">{{ t('nodes.showIpv4List') }} ({{ ipv4.length }})</summary>
        <div class="credential-box" style="margin-top:8px; max-height:200px; overflow:auto">
          <code>{{ ipv4.map((e) => e.address).join(', ') }}</code>
        </div>
      </details>
      <details v-if="!isV4 && ipv6.length" style="margin-top:8px">
        <summary style="cursor:pointer; color:var(--muted); font-size:13px">{{ t('nodes.showIpv6List') }} ({{ ipv6.length }})</summary>
        <div class="credential-box" style="margin-top:8px; max-height:200px; overflow:auto">
          <code>{{ ipv6.map((e) => e.address).join(', ') }}</code>
        </div>
      </details>
    </section>

    <section v-if="node && (ipv4Proxies.length || ipv6Proxies.length)" class="surface">
      <div class="section-head"><h2><Cpu :size="16" style="vertical-align:-3px" /> {{ t('nodes.proxiesOnNode') }}</h2></div>
      <p v-if="!isV6 && ipv4Proxies.length" style="font-size:13px; color:var(--muted); margin-bottom:6px">IPv4 ({{ ipv4Proxies.length }})</p>
      <div v-if="!isV6 && ipv4Proxies.length" class="data-table" style="margin-bottom:14px">
        <div v-for="p in ipv4Proxies.slice(0, 20)" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.5fr auto">
          <span>{{ p.name }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
        <p v-if="ipv4Proxies.length > 20" class="empty-text">… {{ t('nodes.andMore') }} {{ ipv4Proxies.length - 20 }}</p>
      </div>
      <p v-if="!isV4 && ipv6Proxies.length" style="font-size:13px; color:var(--muted); margin-bottom:6px">IPv6 ({{ ipv6Proxies.length }})</p>
      <div v-if="!isV4 && ipv6Proxies.length" class="data-table">
        <div v-for="p in ipv6Proxies.slice(0, 20)" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.5fr auto">
          <span>{{ p.name }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}<span v-if="p.mode === 'rotating'" class="tag rotating" style="margin-left:6px">rotating</span></span>
          <span :class="['status-pill', p.status]">{{ p.status }}</span>
        </div>
        <p v-if="ipv6Proxies.length > 20" class="empty-text">… {{ t('nodes.andMore') }} {{ ipv6Proxies.length - 20 }}</p>
      </div>
    </section>

    <section v-if="installOutput" class="surface">
      <div class="section-head"><h2>{{ t('nodes.installOutput') }}</h2></div>
      <pre style="max-height:260px; overflow:auto"><code>{{ installOutput }}</code></pre>
    </section>

    <!-- Logs viewer (journalctl via SSH for remote, local file for control plane) -->
    <section class="surface">
      <div class="section-head">
        <h2><Terminal :size="15" style="vertical-align:-3px" /> {{ t('nodes.logs') }}</h2>
        <div class="action-row">
          <label class="input-field" style="flex-direction:row; align-items:center; gap:6px; padding:0; font-size:11px; color:var(--muted); text-transform:none; letter-spacing:0">
            {{ t('nodes.logsLines') }}:
            <input v-model.number="logsLines" type="number" min="10" max="5000" style="width:80px; padding:4px 8px; font-size:12px" />
          </label>
          <button class="ghost-button" type="button" :disabled="logsLoading" @click="fetchLogs"><RefreshCw :size="13" /> {{ logsLoading ? t('common.loading') : t('common.refresh') }}</button>
          <button class="ghost-button" type="button" @click="toggleLogs">{{ logsOpen ? t('nodes.logsHide') : t('nodes.logsShow') }}</button>
        </div>
      </div>
      <p v-if="logsErr" class="error-text" style="margin-bottom: 10px">{{ logsErr }}</p>
      <pre v-if="logsOpen" style="max-height: 480px; overflow: auto; font-size: 11.5px; background: #000; border-color: var(--border-soft)"><code style="color: #c4d8d4">{{ logsOutput || t('nodes.logsEmpty') }}</code></pre>
      <p v-else-if="!logsErr" style="font-size: 12px; color: var(--muted); margin: 0">
        <FileText :size="12" style="vertical-align:-2px" /> {{ isLocal ? t('nodes.logsHintLocal') : t('nodes.logsHintRemote') }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.upgrade-cmd-box { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#0f1419; border:1px solid var(--border); border-radius:var(--radius); font-family:var(--mono); font-size:12px }
.upgrade-cmd-box code { flex:1; overflow-x:auto; white-space:nowrap; color:#9bb8b1 }
.upgrade-cmd-box button { white-space:nowrap; font-size:11px }
.family-toggle { display:inline-flex; gap:4px; margin-top:2px }
.family-toggle .family-btn { background:var(--surface-2); border:1px solid var(--border); color:var(--muted); padding:3px 12px; border-radius:var(--radius); font-size:11.5px; font-weight:600; letter-spacing:0.4px; cursor:pointer; font-family:var(--mono) }
.family-toggle .family-btn:hover:not(:disabled) { border-color:var(--green); color:var(--text) }
.family-toggle .family-btn.active { background:rgba(74,222,128,0.12); border-color:var(--green); color:var(--green) }
.family-toggle .family-btn:disabled { opacity:0.6; cursor:default }
</style>
