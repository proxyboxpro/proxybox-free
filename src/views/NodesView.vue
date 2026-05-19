<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Copy, Download, Key, Plus, Power, RefreshCw, RotateCw, Server, ShieldCheck, Trash2, Zap } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { nodesState, loadNodes, addNode, removeNode, installNode, syncNode } from '../store/nodes'

const { t } = useI18n()
const syncing = ref('')
const busy = ref('')
const flash = ref('')

const showForm = ref(false)
const submitting = ref(false)
const errorText = ref('')
const zones = ref([])
// Drop "dual" — admin must classify the node strictly as v4 OR v6.
const form = reactive({ name: '', host: '', sshUser: 'root', sshPassword: '', family: 'ipv4', tag: '', zone: '' })
const installing = ref('')
const installOut = reactive({})

const local = computed(() => nodesState.nodes.find((n) => n.id === 'local') || null)
const ownerFilter = ref('all')   // all | byon | fleet
const others = computed(() => {
  const rest = nodesState.nodes.filter((n) => n.id !== 'local')
  if (ownerFilter.value === 'byon')  return rest.filter((n) => n.isByon || n.ownerId)
  if (ownerFilter.value === 'fleet') return rest.filter((n) => !n.isByon && !n.ownerId)
  return rest
})
const byonCount  = computed(() => nodesState.nodes.filter((n) => n.isByon || n.ownerId).length)
const fleetCount = computed(() => nodesState.nodes.filter((n) => n.id !== 'local' && !n.isByon && !n.ownerId).length)

function detailLink(id) { return { name: 'admin-node-detail', params: { nodeId: id } } }

async function onSync(id) {
  if (syncing.value) return
  syncing.value = id
  try { await syncNode(id) } catch (e) { errorText.value = e.message } finally { syncing.value = '' }
}
async function submit() {
  if (submitting.value) return
  errorText.value = ''
  submitting.value = true
  try {
    await addNode({ name: form.name, host: form.host, sshUser: form.sshUser, sshPassword: form.sshPassword, family: form.family, tag: form.tag, zone: form.zone })
    form.name = ''; form.host = ''; form.sshPassword = ''; form.family = 'ipv4'; form.tag = ''; form.zone = ''
    showForm.value = false
  } catch (e) { errorText.value = e.message }
  finally { submitting.value = false }
}
async function onRemove(id) {
  if (!confirm(`Xoá node ${id}? Mọi proxy thuộc node sẽ bị đánh dấu expired.`)) return
  try { await removeNode(id) } catch (e) { errorText.value = e.message }
}
async function onInstall(id) {
  if (installing.value) return
  installing.value = id; errorText.value = ''
  try {
    const r = await installNode(id)
    installOut[id] = { ok: !!r.ok, output: r.output || r.error || '' }
  } catch (e) { installOut[id] = { ok: false, output: e.message } }
  finally { installing.value = '' }
}
async function onToggle(n) {
  busy.value = n.id
  try {
    const action = n.disabled ? 'enable' : 'disable'
    const r = await apiFetch(`/api/nodes/${n.id}/${action}`, { method: 'POST' })
    n.disabled = r.disabled
    flash.value = `${n.name} ${action}d`
  } catch (e) { errorText.value = e.message }
  finally { busy.value = '' }
}
async function onCheckAll(n) {
  busy.value = n.id; flash.value = ''
  try {
    const r = await apiFetch(`/api/nodes/${n.id}/check-all`, { method: 'POST' })
    flash.value = `${n.name}: ${r.passed}/${r.total} live, ${r.failed} failed`
  } catch (e) { errorText.value = e.message }
  finally { busy.value = '' }
}

// ── Fleet (zero-touch) enrollment ──────────────────────────────────────────
const fleet = ref(null)         // { token, installLinux, installWindows, ... } | null
const fleetBusy = ref(false)
const fleetErr = ref('')
const fleetCopied = ref('')
async function loadFleetToken() {
  fleetErr.value = ''
  try { fleet.value = await apiFetch('/api/nodes/fleet-token') }
  catch (e) { if (e.status === 404) fleet.value = null; else fleetErr.value = e.message }
}
async function regenFleetToken() {
  if (fleetBusy.value) return
  fleetBusy.value = true; fleetErr.value = ''
  try { fleet.value = await apiFetch('/api/nodes/fleet-token', { method: 'POST' }) }
  catch (e) { fleetErr.value = e.message }
  finally { fleetBusy.value = false }
}
async function revokeFleetToken() {
  if (!fleet.value) return
  if (!confirm('Revoke fleet token? Các máy chưa cài sẽ không claim được nữa (máy đã cài vẫn chạy bình thường).')) return
  fleetBusy.value = true
  try { await apiFetch('/api/nodes/fleet-token', { method: 'DELETE' }); fleet.value = null }
  catch (e) { fleetErr.value = e.message }
  finally { fleetBusy.value = false }
}
async function copyText(s, key) {
  try { await navigator.clipboard.writeText(s); fleetCopied.value = key; setTimeout(() => { if (fleetCopied.value === key) fleetCopied.value = '' }, 1500) } catch { /* ignore */ }
}

onMounted(async () => {
  loadNodes()
  try { zones.value = await apiFetch('/api/admin/zones') } catch { /* not admin */ }
  loadFleetToken()
})
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('nodes.title') }}</span>
      <div class="spacer"></div>
      <button class="primary-action small" type="button" @click="showForm = !showForm"><Plus :size="16" /> {{ t('nodes.add') }}</button>
    </div>

    <p v-if="nodesState.error" class="error-text">{{ nodesState.error }}</p>
    <p v-if="errorText" class="error-text">{{ errorText }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <!-- ── Quick (zero-touch) enrollment ───────────────────────────────── -->
    <section class="surface">
      <div class="section-head">
        <h2><Zap :size="16" style="vertical-align:-3px; color:var(--green)" /> {{ t('nodes.fleet.title') }}</h2>
        <div class="action-row">
          <button v-if="!fleet" class="primary-action small" type="button" :disabled="fleetBusy" @click="regenFleetToken">
            <Key :size="14" /> {{ fleetBusy ? '...' : t('nodes.fleet.generate') }}
          </button>
          <template v-else>
            <button class="ghost-button" type="button" :disabled="fleetBusy" @click="regenFleetToken"><RotateCw :size="13" /> {{ t('nodes.fleet.rotate') }}</button>
            <button class="ghost-button" type="button" :disabled="fleetBusy" @click="revokeFleetToken"><Trash2 :size="13" /> {{ t('nodes.fleet.revoke') }}</button>
          </template>
        </div>
      </div>
      <p v-if="fleetErr" class="error-text">{{ fleetErr }}</p>
      <p v-if="!fleet" class="empty-text" style="text-align:left">{{ t('nodes.fleet.intro') }}</p>
      <template v-else>
        <p class="empty-text" style="text-align:left">{{ t('nodes.fleet.intro') }}</p>
        <div class="fleet-grid">
          <div class="fleet-cmd fleet-cmd-v4">
            <div class="fleet-cmd-head">
              <strong>🌐 Linux · IPv4 node</strong>
              <span class="fleet-tag tag-v4">v4</span>
              <button class="ghost-button" type="button" style="padding:2px 8px" @click="copyText(fleet.installLinuxV4 || fleet.installLinux, 'linux-v4')">
                <Copy :size="12" /> {{ fleetCopied === 'linux-v4' ? '✓ copied' : 'Copy' }}
              </button>
            </div>
            <code class="fleet-snippet cell-mono">{{ fleet.installLinuxV4 || fleet.installLinux }}</code>
            <p class="fleet-hint">Server có IPv4 public — proxy egress qua chính IPv4 đó.</p>
          </div>
          <div class="fleet-cmd fleet-cmd-v6">
            <div class="fleet-cmd-head">
              <strong>🌍 Linux · IPv6 node</strong>
              <span class="fleet-tag tag-v6">v6</span>
              <button class="ghost-button" type="button" style="padding:2px 8px" @click="copyText(fleet.installLinuxV6 || fleet.installLinux, 'linux-v6')">
                <Copy :size="12" /> {{ fleetCopied === 'linux-v6' ? '✓ copied' : 'Copy' }}
              </button>
            </div>
            <code class="fleet-snippet cell-mono">{{ fleet.installLinuxV6 || fleet.installLinux }}</code>
            <p class="fleet-hint">Server có IPv6 /48 (hoặc /64) — egress qua IPv6, customer connect qua IPv4 của server.</p>
          </div>
          <div class="fleet-cmd">
            <div class="fleet-cmd-head">
              <strong>Windows (PowerShell, Administrator)</strong>
              <button class="ghost-button" type="button" style="padding:2px 8px" @click="copyText(fleet.installWindows, 'win')">
                <Copy :size="12" /> {{ fleetCopied === 'win' ? '✓ copied' : 'Copy' }}
              </button>
            </div>
            <code class="fleet-snippet cell-mono">{{ fleet.installWindows }}</code>
          </div>
          <div class="fleet-cmd fleet-cmd-uninstall">
            <div class="fleet-cmd-head">
              <strong>🗑 Gỡ cài đặt (Linux)</strong>
              <span class="fleet-tag tag-danger">danger</span>
              <button class="ghost-button" type="button" style="padding:2px 8px" @click="copyText(fleet.uninstall, 'uninst')">
                <Copy :size="12" /> {{ fleetCopied === 'uninst' ? '✓ copied' : 'Copy' }}
              </button>
            </div>
            <code class="fleet-snippet cell-mono">{{ fleet.uninstall }}</code>
            <p class="fleet-hint">Stop service + xoá binary + config + sysctl rules. Idempotent.</p>
          </div>
          <div class="fleet-cmd">
            <div class="fleet-cmd-head">
              <strong>{{ t('nodes.fleet.directDownload') }}</strong>
            </div>
            <div class="fleet-dl-row">
              <a class="ghost-button" :href="fleet.binaryLinux" target="_blank"><Download :size="13" /> Linux binary</a>
              <a class="ghost-button" :href="fleet.binaryWindows" target="_blank"><Download :size="13" /> Windows .exe</a>
            </div>
          </div>
        </div>
        <p class="empty-text" style="text-align:left; margin-top:10px">
          <span style="color:var(--muted)">{{ t('nodes.fleet.token') }}:</span>
          <span class="cell-mono" style="margin-left:6px">{{ fleet.token }}</span>
        </p>
      </template>
    </section>

    <section v-if="showForm" class="surface">
      <div class="section-head"><h2>{{ t('nodes.add') }}</h2></div>
      <p class="empty-text" style="text-align:left">{{ t('nodes.addHint') }}</p>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('nodes.name') }}</span><input v-model="form.name" placeholder="vn-edge-2" /></label>
        <label class="input-field"><span>{{ t('nodes.host') }}</span><input v-model="form.host" placeholder="103.x.x.x" /></label>
        <label class="input-field"><span>{{ t('nodes.sshUser') }}</span><input v-model="form.sshUser" placeholder="root" /></label>
        <label class="input-field"><span>{{ t('nodes.sshPassword') }}</span><input v-model="form.sshPassword" type="password" placeholder="••••••" /></label>
        <label class="input-field" style="grid-column:1/-1">
          <span>{{ t('nodes.family') }} <strong style="color:#b91c1c">(bắt buộc)</strong></span>
          <div class="segment-tabs">
            <button :class="{ active: form.family === 'ipv4' }" type="button" @click="form.family = 'ipv4'">IPv4 only</button>
            <button :class="{ active: form.family === 'ipv6' }" type="button" @click="form.family = 'ipv6'">IPv6 only</button>
          </div>
        </label>
        <label class="input-field"><span>{{ t('nodes.tag') }}</span><input v-model="form.tag" placeholder="prod / test / vn-edge" maxlength="32" /></label>
        <label class="input-field">
          <span>Zone (geographic)</span>
          <select v-model="form.zone">
            <option value="">— auto —</option>
            <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.flag }} {{ z.name }}</option>
          </select>
        </label>
      </div>
      <button class="primary-action small" type="button" :disabled="submitting" @click="submit">{{ submitting ? t('auth.processing') : t('nodes.register') }}</button>
    </section>

    <!-- Local node summary card -->
    <section v-if="local" class="surface">
      <div class="section-head">
        <h2><RouterLink :to="detailLink('local')" style="color:inherit"><Server :size="16" style="vertical-align:-3px" /> {{ local.name }}</RouterLink></h2>
        <div class="action-row">
          <button class="ghost-button" type="button" :disabled="syncing === 'local'" @click="onSync('local')"><RefreshCw :size="15" /> {{ syncing === 'local' ? t('nodes.syncing') : t('nodes.sync') }}</button>
          <button class="ghost-button" type="button" :disabled="busy === 'local'" @click="onCheckAll({ id: 'local', name: 'control plane' })"><ShieldCheck :size="15" /> Check all</button>
          <span class="status-pill active">online</span>
        </div>
      </div>
      <div class="detail-grid">
        <div><span>Host</span><strong class="cell-mono">{{ local.host }}</strong></div>
        <div><span>{{ t('nodes.proxies') }}</span><strong>{{ local.proxies }}</strong></div>
        <div><span>{{ t('nodes.ipv4') }}</span><strong>{{ local.network ? local.network.ipv4PoolSize : '—' }}</strong></div>
        <div><span>{{ t('nodes.ipv6') }}</span><strong>{{ local.network ? local.network.ipv6PoolSize : '—' }}</strong></div>
      </div>
    </section>

    <!-- Agent node list — compact table with inline actions -->
    <section class="surface">
      <div class="section-head" style="display:flex; align-items:center; gap:10px">
        <h2 style="margin:0">{{ t('nodes.agents') }} ({{ others.length }})</h2>
        <div class="seg-tabs">
          <button :class="{ active: ownerFilter === 'all'   }" type="button" @click="ownerFilter = 'all'">All</button>
          <button :class="{ active: ownerFilter === 'fleet' }" type="button" @click="ownerFilter = 'fleet'">Fleet ({{ fleetCount }})</button>
          <button :class="{ active: ownerFilter === 'byon'  }" type="button" @click="ownerFilter = 'byon'">BYON ({{ byonCount }})</button>
        </div>
      </div>
      <p v-if="others.length === 0" class="empty-text">
        {{ ownerFilter === 'byon' ? 'Chưa có node BYON nào (do user tự cài).'
         : ownerFilter === 'fleet' ? 'Chưa có node fleet (admin pool) nào.'
         : 'Chưa có agent nào. Thêm node bằng nút "Add" phía trên.' }}
      </p>
      <div v-else class="data-table">
        <div class="table-row" style="grid-template-columns: 1.6fr 1.4fr 1fr 1fr 2.6fr; font-weight:600; background:var(--surface-2)">
          <span>Node</span><span>Endpoint</span><span>Family · Zone</span><span>Status</span><span>Actions</span>
        </div>
        <div v-for="n in others" :key="n.id" class="table-row" style="grid-template-columns: 1.6fr 1.4fr 1fr 1fr 2.6fr">
          <RouterLink :to="detailLink(n.id)" class="proxy-name" style="color:inherit">
            <Server :size="14" /> {{ n.name }}
            <span v-if="n.isByon" class="tag tag-byon" :title="'BYON: customer-owned · ' + n.ownerEmail" style="margin-left:6px">BYON · {{ n.ownerEmail || n.ownerId }}</span>
            <span v-else-if="n.tag" class="tag" style="margin-left:6px">{{ n.tag }}</span>
            <span v-if="n.version" class="tag" style="margin-left:4px">v{{ n.version }}</span>
          </RouterLink>
          <span class="cell-mono" style="font-size:12.5px">{{ n.sshUser }}@{{ n.host }}<span v-if="n.proxies" style="color:var(--muted)"> · {{ n.proxies }} px</span></span>
          <span>
            <span v-if="n.family" class="tag" :class="'tag-fam-' + n.family">{{ n.family }}</span>
            <span v-if="n.zone && n.zone !== 'auto'" class="tag" style="margin-left:4px">{{ n.zone }}</span>
          </span>
          <span>
            <span v-if="n.disabled" class="status-pill failed">disabled</span>
            <span v-else :class="['status-pill', n.status === 'online' ? 'active' : (n.status === 'install-failed' ? 'failed' : 'pending')]">{{ n.status }}</span>
            <span v-if="n.outdated" class="status-pill pending" :title="`Agent v${n.version} → cần cập nhật lên v${n.latestAgentVersion}`" style="margin-left:4px; font-size:10px">outdated</span>
          </span>
          <span class="action-row">
            <button class="ghost-button" type="button" :disabled="syncing === n.id" style="padding:2px 8px" @click="onSync(n.id)"><RefreshCw :size="13" /> Sync</button>
            <button class="ghost-button" type="button" :disabled="busy === n.id" style="padding:2px 8px" @click="onCheckAll(n)"><ShieldCheck :size="13" /> Check live</button>
            <button class="ghost-button" type="button" :disabled="busy === n.id" style="padding:2px 8px" @click="onToggle(n)"><Power :size="13" /> {{ n.disabled ? 'Enable' : 'Disable' }}</button>
            <button v-if="n.hasCreds && n.status !== 'online'" class="primary-action small" type="button" :disabled="installing === n.id" style="padding:2px 8px" @click="onInstall(n.id)">{{ installing === n.id ? '...' : 'Install' }}</button>
            <button class="ghost-button" type="button" style="padding:2px 8px" @click="onRemove(n.id)"><Trash2 :size="13" /></button>
          </span>
          <div v-if="installOut[n.id]" style="grid-column:1/-1; padding-top:4px">
            <pre :style="{ maxHeight: '180px', overflow: 'auto', borderColor: installOut[n.id].ok ? '#dcfce7' : '#fee2e2' }"><code>{{ installOut[n.id].output }}</code></pre>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.fleet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.fleet-cmd {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fleet-cmd-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 12px; color: var(--muted);
}
.fleet-cmd-head strong { color: var(--text); font-weight: 600; font-size: 12px; }
.fleet-snippet {
  display: block;
  background: var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
  word-break: break-all;
  line-height: 1.5;
}
.fleet-dl-row { display: flex; gap: 8px; flex-wrap: wrap; }
.fleet-dl-row .ghost-button { padding: 4px 10px; font-size: 12px; }
.fleet-cmd-head strong { display: flex; align-items: center; gap: 6px; }
.fleet-cmd-head .ghost-button { margin-left: auto; }
.fleet-tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-family: var(--mono); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.fleet-tag.tag-v4 { background: rgba(59,130,246,0.15); color: #93c5fd; }
.fleet-tag.tag-v6 { background: rgba(168,85,247,0.15); color: #c4b5fd; }
.fleet-tag.tag-danger { background: rgba(239,68,68,0.15); color: #fca5a5; }
.fleet-cmd-v4 { border-left: 3px solid #3b82f6; padding-left: 10px; }
.fleet-cmd-v6 { border-left: 3px solid #a855f7; padding-left: 10px; }
.fleet-cmd-uninstall { border-left: 3px solid #ef4444; padding-left: 10px; }
.fleet-hint { font-size: 11px; color: var(--muted); margin: 0; line-height: 1.4; }

/* Segment tabs to filter the agent list by owner type (fleet / BYON). */
.seg-tabs {
  display: inline-flex; margin-left: auto;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
  padding: 2px;
}
.seg-tabs button {
  padding: 4px 10px; font-size: 11.5px;
  background: transparent; border: none; color: var(--muted);
  border-radius: 6px; cursor: pointer;
}
.seg-tabs button.active { background: rgba(34,197,94,0.12); color: var(--green); font-weight: 600; }
@media (max-width: 700px) {
  .seg-tabs { margin-left: 0; flex-wrap: wrap; }
  .seg-tabs button { flex: 1; }
}
</style>
