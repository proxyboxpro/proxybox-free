<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Activity, AlertTriangle, Box, Check, ChevronDown, Cloud, Cpu, History, KeyRound, Plus, Power, PowerOff, RefreshCw, RotateCcw, Server, ShieldCheck, Stethoscope, Terminal, Trash2, UploadCloud, Zap } from 'lucide-vue-next'
import { apiFetch } from '../../api'

const tab = ref('config')
const flash = ref('')
const err = ref('')

// ── Virtualizor instances (multi-zone) ───────────────────────────────────
const vzInstances = ref([])
const editingVz = ref(null)
const vzDraft = ref({ label: '', zone: '', panelUrl: '', apiKey: '', apiPass: '', insecureTls: true, enabled: true })
const vzTesting = ref('')
const vzTestResult = ref(null)

async function loadInstances() {
  try { vzInstances.value = await apiFetch('/api/admin/virtualizors') }
  catch (e) { err.value = e.message }
}
function startVzEdit(inst) {
  editingVz.value = inst ? inst.id : 'new'
  vzDraft.value = inst
    ? { label: inst.label, zone: inst.zone, panelUrl: inst.panelUrl, apiKey: '', apiPass: '', insecureTls: inst.insecureTls, enabled: inst.enabled }
    : { label: '', zone: '', panelUrl: '', apiKey: '', apiPass: '', insecureTls: true, enabled: true }
}
function cancelVzEdit() { editingVz.value = null }
async function saveVz() {
  err.value = ''; flash.value = ''
  try {
    if (editingVz.value === 'new') {
      const r = await apiFetch('/api/admin/virtualizors', { method: 'POST', body: vzDraft.value })
      flash.value = `Đã thêm Virtualizor instance ${r.id}.`
    } else {
      await apiFetch(`/api/admin/virtualizors/${editingVz.value}`, { method: 'PATCH', body: vzDraft.value })
      flash.value = 'Cập nhật instance thành công.'
    }
    setTimeout(() => flash.value = '', 3500)
    cancelVzEdit()
    await loadInstances()
  } catch (e) { err.value = e.message }
}
async function deleteVz(id) {
  if (!confirm('Xóa Virtualizor instance này? Hub plans gắn vào instance này sẽ không provision được nữa.')) return
  try { await apiFetch(`/api/admin/virtualizors/${id}`, { method: 'DELETE' }); await loadInstances() }
  catch (e) { err.value = e.message }
}
async function testVz(id) {
  vzTesting.value = id; vzTestResult.value = null
  try { vzTestResult.value = await apiFetch(`/api/admin/virtualizors/${id}/test`, { method: 'POST' }) }
  catch (e) { vzTestResult.value = { ok: false, error: e.message } }
  finally { vzTesting.value = ''; await loadInstances() }
}

// ── Passthrough Virtualizor data ──────────────────────────────────────────
const vzServers = ref(null)
const vzPlans = ref(null)
const vzIpPools = ref(null)
const vzTemplates = ref(null)
async function loadVzData(kind) {
  err.value = ''
  try {
    const r = await apiFetch(`/api/admin/virtualizor/${kind}`)
    if (kind === 'servers') vzServers.value = r
    if (kind === 'plans') vzPlans.value = r
    if (kind === 'ip-pools') vzIpPools.value = r
    if (kind === 'templates') vzTemplates.value = r
  } catch (e) { err.value = `${kind}: ${e.message}` }
}

// ── Hub plans CRUD ────────────────────────────────────────────────────────
const hubPlans = ref([])
const editingPlan = ref(null)
const draftPlan = reactive(newPlanDraft())
function newPlanDraft() {
  return {
    name: '', description: '', region: '', family: 'ipv4', enabled: true,
    hourlyPrice: 0, currency: 'VND', maxQuantity: 0,
    minHours: 1, maxHours: 720,
    specs: { cpu: 1, ramGB: 1, diskGB: 20, bandwidthGB: 1000, ipv4Count: 1, ipv6Range: '' },
    vz: { instanceId: '', virt: 'kvm', serverId: null, planId: null, osId: null, ipPool: null, ip6Pool: null, diskTemplate: null }
  }
}
async function loadHubPlans() {
  try { hubPlans.value = await apiFetch('/api/admin/hub-plans') }
  catch (e) { err.value = e.message }
}

// ── Live Virtualizor data for the plan editor ────────────────────────────
// When the admin picks a VZ instance in the plan form, we fetch its
// servers / plans / OS templates / IP pools so the operator can choose from
// the actual catalogue instead of typing IDs by hand. Cached per-instance
// so switching back and forth doesn't re-hit the panel every time.
const vzCatalogCache = reactive({})       // { [instanceId]: { servers, plans, ips, oses, loading, err } }
const vzCatalogLoading = ref(false)
const vzCatalogErr = ref('')
async function loadVzCatalog(instId) {
  if (!instId) return
  if (vzCatalogCache[instId]?.fetched) return
  vzCatalogLoading.value = true; vzCatalogErr.value = ''
  vzCatalogCache[instId] = { servers: null, plans: null, ips: null, oses: null, fetched: false }
  try {
    const [servers, plans, ipPools, templates] = await Promise.all([
      apiFetch(`/api/admin/virtualizors/${instId}/servers`).catch(() => null),
      apiFetch(`/api/admin/virtualizors/${instId}/plans`).catch(() => null),
      apiFetch(`/api/admin/virtualizors/${instId}/ip-pools`).catch(() => null),
      apiFetch(`/api/admin/virtualizors/${instId}/templates`).catch(() => null)
    ])
    vzCatalogCache[instId] = { servers, plans, ips: ipPools, oses: templates, fetched: true }
  } catch (e) { vzCatalogErr.value = e.message }
  finally { vzCatalogLoading.value = false }
}

// Normalise each VZ passthrough into [{id, label}] for v-for in the dropdowns.
// The panel returns shapes like { serverlist: { 0: { server_name: 'localhost' } } }
// or { plans: { 1: { plan_name: 'dev', ram: 1024 } } } — flatten consistently.
function vzServerOptions(instId) {
  const raw = vzCatalogCache[instId]?.servers
  const obj = raw?.serverlist || raw?.servers || raw || {}
  return Object.entries(obj).map(([id, s]) => ({
    id, label: `${id} · ${s.server_name || s.name || 'server'}`
  }))
}
function vzPlanOptions(instId) {
  const raw = vzCatalogCache[instId]?.plans
  const obj = raw?.plans || raw || {}
  return Object.entries(obj).map(([id, p]) => {
    const ram = p.ram ? `${p.ram}MB` : ''
    const disk = p.space ? `${p.space}GB` : ''
    const bits = [p.plan_name || p.name, ram, disk].filter(Boolean).join(' · ')
    return { id, label: `${id} · ${bits || 'plan'}` }
  })
}
function vzOsOptions(instId) {
  const raw = vzCatalogCache[instId]?.oses
  const obj = raw?.oses || raw?.os || raw || {}
  return Object.entries(obj)
    .filter(([, t]) => (t.type === 'kvm' || t.type === 'proxk'))   // hide windows/openvz noise
    .map(([id, t]) => ({ id, label: `${id} · ${t.name || t.filename || 'image'}` }))
}
function vzIpPoolOptions(instId, family) {
  // family: 'v4' → only IPv4 pools (ipv6 != '1')
  //         'v6' → only IPv6 pools (ipv6 == '1')
  //         undefined/'all' → both (used as fallback when family not specified)
  const raw = vzCatalogCache[instId]?.ips
  const obj = raw?.ippools || raw?.ippool || raw || {}
  return Object.entries(obj)
    .filter(([, p]) => {
      const isV6 = String(p.ipv6 || '0') === '1'
      if (family === 'v4') return !isV6
      if (family === 'v6') return isV6
      return true
    })
    .map(([id, p]) => ({
      id,
      label: `${id} · ${p.ippool_name || p.name || '?'}`
    }))
}

// Auto-fetch when the operator selects a VZ instance in the plan form.
watch(() => draftPlan.vz?.instanceId, (instId) => {
  if (instId) loadVzCatalog(instId)
})
function startEdit(plan) {
  editingPlan.value = plan ? plan.id : 'new'
  Object.assign(draftPlan, plan ? JSON.parse(JSON.stringify(plan)) : newPlanDraft())
  // Pre-fetch the VZ catalogue so dropdowns populate immediately when the
  // operator opens an existing plan (watcher only fires on instanceId change).
  if (draftPlan.vz?.instanceId) loadVzCatalog(draftPlan.vz.instanceId)
}
function cancelEdit() { editingPlan.value = null; Object.assign(draftPlan, newPlanDraft()) }
async function savePlan() {
  err.value = ''
  try {
    if (editingPlan.value === 'new') {
      await apiFetch('/api/admin/hub-plans', { method: 'POST', body: draftPlan })
      flash.value = 'Tạo plan mới thành công.'
    } else {
      await apiFetch(`/api/admin/hub-plans/${editingPlan.value}`, { method: 'PATCH', body: draftPlan })
      flash.value = 'Cập nhật plan thành công.'
    }
    setTimeout(() => flash.value = '', 3000)
    cancelEdit()
    await loadHubPlans()
  } catch (e) { err.value = e.message }
}
async function deletePlan(id) {
  if (!confirm('Xóa plan này? Các hub đã provision không bị xóa nhưng plan không còn cho khách buy.')) return
  try { await apiFetch(`/api/admin/hub-plans/${id}`, { method: 'DELETE' }); await loadHubPlans() }
  catch (e) { err.value = e.message }
}

// ── Provisioned hubs (admin overview) ─────────────────────────────────────
const provisionedHubs = ref([])
async function loadHubs() {
  try { provisionedHubs.value = await apiFetch('/api/admin/hubs') }
  catch (e) { err.value = e.message }
}

// ── Remote actions on a hub VM (reboot, diagnose, drain, …) ──────────────
const PACKAGE_WHITELIST = ['htop', 'atop', 'iperf3', 'mtr-tiny', 'mtr', 'vnstat', 'tcpdump', 'jq', 'dnsutils', 'net-tools', 'sysstat', 'iotop', 'bpytop']
const actionBusy = ref('')             // `${nodeId}:${action}` while in-flight
const actionResult = ref(null)         // { node, action, output } shown in panel
const cmdHistoryNode = ref(null)       // nodeId whose history dialog is open
const cmdHistoryData = ref({ pending: [], history: [] })

async function runAction(h, action, opts = {}) {
  const { confirmMsg, body } = typeof opts === 'string' ? { confirmMsg: opts } : opts
  if (confirmMsg && !confirm(confirmMsg)) return
  const key = `${h.id}:${action}`
  if (actionBusy.value) return
  actionBusy.value = key; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch(`/api/nodes/${h.id}/action/${action}`, { method: 'POST', body })
    const verdict = r.ok === false ? 'FAILED' : (r.via === 'agent-channel' ? 'QUEUED' : 'OK')
    flash.value = `[${h.name}] ${action} → ${verdict}${r.via ? ' (' + r.via + ')' : ''}`
    setTimeout(() => flash.value = '', 4500)
    if (r.output) actionResult.value = { node: h.name, action, output: r.output, ok: r.ok }
    if (r.oneLiner) actionResult.value = { node: h.name, action, output: `Run this on the box:\n  ${r.oneLiner}\n\n${r.hint || ''}`, ok: true }
    if (!['diagnose', 'tail-logs'].includes(action)) await loadHubs()
  } catch (e) { err.value = `${action} failed: ${e.message}` }
  finally { actionBusy.value = '' }
}

async function installPackage(h) {
  const pkg = prompt(`Cài package nào trên ${h.name}?\nWhitelist: ${PACKAGE_WHITELIST.join(', ')}`, 'htop')
  if (!pkg) return
  if (!PACKAGE_WHITELIST.includes(pkg.trim())) {
    err.value = `package "${pkg}" không thuộc whitelist (${PACKAGE_WHITELIST.join(', ')})`
    return
  }
  await runAction(h, 'install-package', { body: { package: pkg.trim() } })
}

async function openCmdHistory(h) {
  cmdHistoryNode.value = h.id
  try { cmdHistoryData.value = await apiFetch(`/api/nodes/${h.id}/commands`) }
  catch (e) { err.value = e.message; cmdHistoryData.value = { pending: [], history: [] } }
}
function closeCmdHistory() { cmdHistoryNode.value = null }
function closeActionResult() { actionResult.value = null }

// Per-instance passthrough loader (replaces legacy single-instance versions)
async function loadVzDataForInst(instId, kind) {
  err.value = ''
  try {
    const r = await apiFetch(`/api/admin/virtualizors/${instId}/${kind}`)
    if (kind === 'servers') vzServers.value = r
    if (kind === 'plans') vzPlans.value = r
    if (kind === 'ip-pools') vzIpPools.value = r
    if (kind === 'templates') vzTemplates.value = r
  } catch (e) { err.value = `${kind}: ${e.message}` }
}

onMounted(async () => {
  await loadInstances()
  await loadHubPlans()
  await loadHubs()
})
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Hub provisioning</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="loadHubs"><RefreshCw :size="13" /></button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green); font-size:13px">{{ flash }}</p>

    <div class="settings-tabs">
      <button :class="{ active: tab === 'config' }" @click="tab = 'config'"><span class="t-name">Virtualizor</span><small class="t-desc">Panel creds</small></button>
      <button :class="{ active: tab === 'plans' }" @click="tab = 'plans'"><span class="t-name">Hub plans</span><small class="t-desc">Catalog bán cho khách</small></button>
      <button :class="{ active: tab === 'hubs' }" @click="tab = 'hubs'"><span class="t-name">Active VMs</span><small class="t-desc">Đang chạy ({{ provisionedHubs.length }})</small></button>
      <button :class="{ active: tab === 'vzdata' }" @click="tab = 'vzdata'"><span class="t-name">Virtualizor data</span><small class="t-desc">Servers / IP pools / templates</small></button>
    </div>

    <!-- ── Virtualizor instances (multi-zone) ─────────────────────────────── -->
    <section v-if="tab === 'config'" class="surface" style="padding:16px">
      <div class="section-head">
        <h2><KeyRound :size="14" style="vertical-align:-2px" /> Virtualizor instances ({{ vzInstances.length }})</h2>
        <button class="primary-action" type="button" style="margin-left:auto" @click="startVzEdit(null)">
          <Plus :size="13" /> Thêm instance
        </button>
      </div>
      <p class="hint">
        Mỗi instance = 1 panel Virtualizor riêng = 1 zone (vd <code>vn-hcm</code>, <code>us-east</code>, <code>sg</code>).
        Credentials mã hóa AES-256-GCM. Nếu Virtualizor có bật API IP Access List, thêm <strong>IP của panel này</strong> (lệnh <code>curl ifconfig.me</code> trên server) vào <strong>Configuration → API → IP Access List</strong> của Virtualizor.
      </p>

      <div v-if="editingVz" class="surface" style="padding:14px; background:rgba(34,197,94,0.04); border-color:rgba(34,197,94,0.25); margin:10px 0">
        <h3 style="margin:0 0 10px; font-size:14px">{{ editingVz === 'new' ? 'Thêm Virtualizor instance' : `Sửa ${editingVz}` }}</h3>
        <div class="form-grid form-2col">
          <label class="field"><span>Label</span><input v-model="vzDraft.label" type="text" placeholder="VN-HCM panel" /></label>
          <label class="field"><span>Zone slug</span><input v-model="vzDraft.zone" type="text" placeholder="vn-hcm, us-east, sg..." /></label>
          <label class="field" style="grid-column:span 2"><span>Panel URL</span><input v-model="vzDraft.panelUrl" type="url" placeholder="https://10.10.10.2:4085" /></label>
          <label class="field"><span>API Key</span><input v-model="vzDraft.apiKey" type="text" :placeholder="editingVz === 'new' ? '32-char key' : '(giữ giá trị cũ)'" /></label>
          <label class="field"><span>API Password</span><input v-model="vzDraft.apiPass" type="password" :placeholder="editingVz === 'new' ? '32-char password' : '(giữ giá trị cũ)'" /></label>
          <label class="field-checkbox"><input v-model="vzDraft.insecureTls" type="checkbox" /><span>Accept self-signed TLS</span></label>
          <label class="field-checkbox"><input v-model="vzDraft.enabled" type="checkbox" /><span>Enabled</span></label>
        </div>
        <div style="display:flex; gap:8px; margin-top:12px">
          <button class="primary-action" type="button" @click="saveVz">{{ editingVz === 'new' ? 'Thêm' : 'Lưu' }}</button>
          <button class="ghost-button" type="button" @click="cancelVzEdit">Hủy</button>
        </div>
      </div>

      <div v-if="!vzInstances.length && !editingVz" class="empty-text" style="text-align:left; padding:18px 0">
        Chưa có instance nào. Bấm <strong>Thêm instance</strong> để cấu hình Virtualizor panel đầu tiên.
      </div>

      <div v-else class="data-table">
        <div class="table-head" style="grid-template-columns: 1fr 1fr 1.4fr 0.8fr 0.8fr 200px">
          <span>Instance</span><span>Zone</span><span>Panel URL</span><span>Last test</span><span>Status</span><span></span>
        </div>
        <div v-for="v in vzInstances" :key="v.id" class="table-row" style="grid-template-columns: 1fr 1fr 1.4fr 0.8fr 0.8fr 200px">
          <div>
            <strong>{{ v.label }}</strong>
            <small style="display:block; color:var(--muted)">{{ v.id }}</small>
          </div>
          <span class="cell-mono">{{ v.zone || '—' }}</span>
          <span class="cell-mono" style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ v.panelUrl }}</span>
          <span class="cell-mono" style="font-size:11px; color:var(--muted)">
            <template v-if="v.lastTestedAt">
              {{ v.lastTestedAt.slice(11, 19) }}
              <span :style="{ color: v.lastTestOk ? 'var(--green)' : 'var(--red)' }">{{ v.lastTestOk ? 'OK' : 'FAIL' }}</span>
            </template>
            <template v-else>—</template>
          </span>
          <span :class="['status-pill', v.enabled ? 'active' : 'expired']">{{ v.enabled ? 'on' : 'off' }}</span>
          <span style="display:inline-flex; gap:4px">
            <button class="ghost-button" type="button" :disabled="vzTesting === v.id" @click="testVz(v.id)">
              <ShieldCheck :size="11" /> {{ vzTesting === v.id ? 'Testing…' : 'Test' }}
            </button>
            <button class="ghost-button" type="button" @click="startVzEdit(v)">Edit</button>
            <button class="ghost-button" type="button" @click="deleteVz(v.id)"><Trash2 :size="11" /></button>
          </span>
        </div>
      </div>

      <div v-if="vzTestResult" :class="['test-result', vzTestResult.ok ? 'ok' : 'err']" style="margin-top:12px">
        <template v-if="vzTestResult.ok"><Check :size="14" /> Kết nối OK.</template>
        <template v-else><AlertTriangle :size="14" /> {{ vzTestResult.error || 'unknown error' }}</template>
      </div>
    </section>

    <!-- ── Plans tab ─────────────────────────────────────────────────────── -->
    <section v-if="tab === 'plans'" class="surface" style="padding:16px">
      <div class="section-head">
        <h2><Cloud :size="14" style="vertical-align:-2px" /> Hub plans ({{ hubPlans.length }})</h2>
        <button class="primary-action" type="button" style="margin-left:auto" @click="startEdit(null)">
          <Plus :size="13" /> New plan
        </button>
      </div>

      <div v-if="editingPlan" class="surface" style="padding:14px; background:rgba(34,197,94,0.04); border-color:rgba(34,197,94,0.25); margin:10px 0">
        <h3 style="margin:0 0 10px; font-size:14px">{{ editingPlan === 'new' ? 'Plan mới' : `Sửa ${editingPlan}` }}</h3>
        <div class="form-grid form-2col">
          <label class="field"><span>Tên</span><input v-model="draftPlan.name" type="text" /></label>
          <label class="field"><span>Region</span><input v-model="draftPlan.region" type="text" placeholder="VN, US, SG..." /></label>
          <label class="field" style="grid-column:span 2"><span>Mô tả (customer-facing)</span><input v-model="draftPlan.description" type="text" /></label>
          <label class="field"><span>Loại proxy (hiển thị cho user)</span>
            <select v-model="draftPlan.family">
              <option value="ipv4">Proxy Hub IPv4</option>
              <option value="ipv6">Proxy Hub IPv6</option>
            </select>
          </label>
          <label class="field"><span>Giá / giờ ({{ draftPlan.currency }})</span><input v-model.number="draftPlan.hourlyPrice" type="number" min="0" /></label>
          <label class="field"><span>Min hours</span><input v-model.number="draftPlan.minHours" type="number" min="1" /></label>
          <label class="field"><span>Max hours</span><input v-model.number="draftPlan.maxHours" type="number" min="1" /></label>
          <label class="field"><span>Max quantity (0 = unlimited)</span><input v-model.number="draftPlan.maxQuantity" type="number" min="0" /></label>
          <label class="field-checkbox" style="grid-column:span 2"><input v-model="draftPlan.enabled" type="checkbox" /><span>Enabled (customer thấy được)</span></label>
        </div>

        <h4 class="section-h4">Specs (customer-facing)</h4>
        <div class="form-grid form-3col">
          <label class="field"><span>vCPU</span><input v-model.number="draftPlan.specs.cpu" type="number" min="1" /></label>
          <label class="field"><span>RAM (GB)</span><input v-model.number="draftPlan.specs.ramGB" type="number" min="0" step="0.5" /></label>
          <label class="field"><span>Disk (GB)</span><input v-model.number="draftPlan.specs.diskGB" type="number" min="0" /></label>
          <label class="field"><span>Bandwidth/month (GB)</span><input v-model.number="draftPlan.specs.bandwidthGB" type="number" min="0" /></label>
          <label class="field"><span>IPv4 count</span><input v-model.number="draftPlan.specs.ipv4Count" type="number" min="0" /></label>
          <label class="field"><span>IPv6 range</span><input v-model="draftPlan.specs.ipv6Range" type="text" placeholder="/64, /48..." /></label>
        </div>

        <h4 class="section-h4">
          Virtualizor mapping
          <small style="color:var(--muted); font-weight:400">(admin-only, không expose cho customer)</small>
          <button
            v-if="draftPlan.vz.instanceId"
            type="button" class="ghost-button"
            style="margin-left:auto; padding:3px 10px; font-size:11.5px"
            :disabled="vzCatalogLoading"
            @click="vzCatalogCache[draftPlan.vz.instanceId] = { fetched: false }; loadVzCatalog(draftPlan.vz.instanceId)"
            title="Reload data từ Virtualizor"
          >
            <RefreshCw :size="11" /> {{ vzCatalogLoading ? 'Đang tải…' : 'Reload' }}
          </button>
        </h4>
        <div class="form-grid form-3col">
          <label class="field" style="grid-column: span 3">
            <span>Virtualizor instance</span>
            <select v-model="draftPlan.vz.instanceId">
              <option value="">(Pick instance — bắt buộc)</option>
              <option v-for="v in vzInstances" :key="v.id" :value="v.id">{{ v.label }} — {{ v.zone }} ({{ v.panelUrl }})</option>
            </select>
          </label>
          <label class="field"><span>Virtualization</span>
            <select v-model="draftPlan.vz.virt">
              <option value="kvm">KVM</option><option value="openvz">OpenVZ</option><option value="lxc">LXC</option><option value="proxmox-k">Proxmox KVM</option>
            </select>
          </label>

          <!-- Server: dropdown live-fetched từ /api/admin/virtualizors/:id/servers,
               fallback raw input nếu instance chưa pick hoặc fetch fail. -->
          <label class="field">
            <span>Server</span>
            <select
              v-if="draftPlan.vz.instanceId && vzServerOptions(draftPlan.vz.instanceId).length"
              v-model="draftPlan.vz.serverId"
              @change="draftPlan.vz.serverId = Number(draftPlan.vz.serverId)"
            >
              <option :value="null">(chọn server)</option>
              <option v-for="s in vzServerOptions(draftPlan.vz.instanceId)" :key="s.id" :value="Number(s.id)">{{ s.label }}</option>
            </select>
            <input v-else v-model.number="draftPlan.vz.serverId" type="number" placeholder="0" />
          </label>

          <label class="field">
            <span>Plan</span>
            <select
              v-if="draftPlan.vz.instanceId && vzPlanOptions(draftPlan.vz.instanceId).length"
              v-model="draftPlan.vz.planId"
              @change="draftPlan.vz.planId = Number(draftPlan.vz.planId)"
            >
              <option :value="null">(chọn plan)</option>
              <option v-for="p in vzPlanOptions(draftPlan.vz.instanceId)" :key="p.id" :value="Number(p.id)">{{ p.label }}</option>
            </select>
            <input v-else v-model.number="draftPlan.vz.planId" type="number" placeholder="1" />
          </label>

          <label class="field">
            <span>OS template</span>
            <select
              v-if="draftPlan.vz.instanceId && vzOsOptions(draftPlan.vz.instanceId).length"
              v-model="draftPlan.vz.osId"
              @change="draftPlan.vz.osId = Number(draftPlan.vz.osId)"
            >
              <option :value="null">(chọn OS)</option>
              <option v-for="o in vzOsOptions(draftPlan.vz.instanceId)" :key="o.id" :value="Number(o.id)">{{ o.label }}</option>
            </select>
            <input v-else v-model.number="draftPlan.vz.osId" type="number" placeholder="1197" />
          </label>

          <!-- IPv4 pool — REQUIRED. For ipv4-family plans this is the egress
               subnet sold to customer. For ipv6-family hubs this is the
               connect-host IP (proxy listens here, egress goes via IPv6). -->
          <label class="field">
            <span>IPv4 Pool {{ draftPlan.family === 'ipv6' ? '(host IP)' : '(subnet bán cho khách)' }}</span>
            <select
              v-if="draftPlan.vz.instanceId && vzIpPoolOptions(draftPlan.vz.instanceId, 'v4').length"
              v-model="draftPlan.vz.ipPool"
            >
              <option value="">(chọn pool IPv4)</option>
              <option v-for="p in vzIpPoolOptions(draftPlan.vz.instanceId, 'v4')" :key="p.id" :value="String(p.id)">{{ p.label }}</option>
            </select>
            <input v-else v-model="draftPlan.vz.ipPool" type="text" placeholder="7" />
          </label>

          <!-- IPv6 pool — only relevant when selling IPv6 hubs. Hidden for
               pure ipv4-family plans (no IPv6 subnet attached to VPS). -->
          <label v-if="draftPlan.family === 'ipv6'" class="field">
            <span>IPv6 Pool (subnet /48 bán cho khách)</span>
            <select
              v-if="draftPlan.vz.instanceId && vzIpPoolOptions(draftPlan.vz.instanceId, 'v6').length"
              v-model="draftPlan.vz.ip6Pool"
            >
              <option value="">(chọn pool IPv6)</option>
              <option v-for="p in vzIpPoolOptions(draftPlan.vz.instanceId, 'v6')" :key="p.id" :value="String(p.id)">{{ p.label }}</option>
            </select>
            <input v-else v-model="draftPlan.vz.ip6Pool" type="text" placeholder="5" />
          </label>

          <label class="field"><span>Disk Template (optional)</span><input v-model.number="draftPlan.vz.diskTemplate" type="number" /></label>
        </div>
        <p v-if="vzCatalogLoading" class="hint" style="margin-top:6px">Đang fetch data từ Virtualizor…</p>
        <p v-else-if="draftPlan.vz.instanceId && !vzCatalogCache[draftPlan.vz.instanceId]?.fetched" class="hint" style="margin-top:6px; color:#f59e0b">
          Chưa load được data từ instance này — kiểm tra Virtualizor instance hoạt động chưa, hoặc bấm Reload.
        </p>
        <p v-else-if="draftPlan.vz.instanceId" class="hint" style="margin-top:6px">
          Dropdown lấy trực tiếp từ Virtualizor panel — không phải gõ ID bằng tay.
        </p>

        <div style="display:flex; gap:8px; margin-top:12px">
          <button class="primary-action" type="button" @click="savePlan">{{ editingPlan === 'new' ? 'Tạo plan' : 'Lưu' }}</button>
          <button class="ghost-button" type="button" @click="cancelEdit">Hủy</button>
        </div>
      </div>

      <div v-if="!hubPlans.length && !editingPlan" class="empty-text" style="text-align:left; padding:18px 0">
        Chưa có plan nào. Cấu hình Virtualizor xong → tạo plan đầu tiên ở đây.
      </div>

      <div v-else class="data-table">
        <div class="table-head" style="grid-template-columns: 1.5fr 1fr 1fr 80px 100px 120px">
          <span>Plan</span><span>Region/Family</span><span>Specs</span><span>Hour</span><span>Status</span><span></span>
        </div>
        <div v-for="p in hubPlans" :key="p.id" class="table-row" style="grid-template-columns: 1.5fr 1fr 1fr 80px 100px 120px">
          <div>
            <strong>{{ p.name }}</strong>
            <small style="display:block; color:var(--muted)">{{ p.id }} · vz#{{ p.vz?.planId || '—' }}</small>
          </div>
          <span>{{ p.region }} · {{ p.family }}</span>
          <span class="cell-mono" style="font-size:11px">{{ p.specs.cpu }}vCPU · {{ p.specs.ramGB }}GB · {{ p.specs.diskGB }}GB</span>
          <span class="cell-mono">{{ Number(p.hourlyPrice).toLocaleString() }}</span>
          <span :class="['status-pill', p.enabled ? 'active' : 'expired']">{{ p.enabled ? 'enabled' : 'disabled' }}</span>
          <span style="display:inline-flex; gap:4px">
            <button class="ghost-button" type="button" @click="startEdit(p)">Edit</button>
            <button class="ghost-button" type="button" @click="deletePlan(p.id)"><Trash2 :size="11" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- ── Provisioned VMs ───────────────────────────────────────────────── -->
    <section v-if="tab === 'hubs'" class="surface" style="padding:16px">
      <div class="section-head" style="display:flex; align-items:center; gap:8px">
        <h2 style="margin:0"><Server :size="14" style="vertical-align:-2px" /> VMs đang chạy ({{ provisionedHubs.length }})</h2>
        <button class="ghost-button" type="button" style="margin-left:auto" @click="loadHubs"><RefreshCw :size="12" /> Refresh</button>
      </div>
      <p v-if="!provisionedHubs.length" class="empty-text" style="text-align:left; padding:18px 0">Chưa có hub nào được provision.</p>
      <ul v-else class="hub-cards">
        <li v-for="h in provisionedHubs" :key="h.id" class="hub-card">
          <header>
            <div>
              <strong class="cell-mono">{{ h.name }}</strong>
              <small>vpsid={{ h.vpsid }} · <code>{{ h.host }}</code></small>
            </div>
            <span :class="['status-pill', h.status === 'online' ? 'active' : (h.status === 'provisioning' ? 'pending' : 'expired')]">{{ h.status }}</span>
          </header>
          <dl class="hub-meta">
            <div><dt>Owner</dt><dd>{{ h.ownerEmail }}</dd></div>
            <div><dt>Plan</dt><dd>{{ h.planName || h.planId }}</dd></div>
            <div><dt>Provisioned</dt><dd class="cell-mono">{{ h.provisionedAt?.slice(0,16).replace('T',' ') }}</dd></div>
            <div><dt>Expires</dt><dd class="cell-mono">{{ h.expiresAt?.slice(0,16).replace('T',' ') }}</dd></div>
          </dl>
          <div class="hub-actions">
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':diagnose'" @click="runAction(h, 'diagnose')">
              <Stethoscope :size="12" /> Chẩn đoán
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':tail-logs'" @click="runAction(h, 'tail-logs')">
              <Terminal :size="12" /> Logs
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':refresh-network'" @click="runAction(h, 'refresh-network')">
              <RefreshCw :size="12" /> Refresh IP
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':restart-agent'" @click="runAction(h, 'restart-agent', `Restart agent service trên ${h.name}?`)">
              <RotateCcw :size="12" /> Restart agent
            </button>
            <button class="act ghost-button warn" :disabled="actionBusy === h.id + ':reboot'" @click="runAction(h, 'reboot', `Reboot VM ${h.name}? Mất ~1 phút.`)">
              <Zap :size="12" /> Reboot VM
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':power-on'" @click="runAction(h, 'power-on')">
              <Power :size="12" /> Power ON
            </button>
            <button class="act ghost-button danger" :disabled="actionBusy === h.id + ':power-off'" @click="runAction(h, 'power-off', `Power-OFF cứng VM ${h.name}?`)">
              <PowerOff :size="12" /> Power OFF
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':drain'" @click="runAction(h, 'drain', `Drain ${h.name}? Agent sẽ ngừng nhận proxy mới.`)">
              <AlertTriangle :size="12" /> Drain
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':upgrade'" @click="runAction(h, 'upgrade', `Force upgrade agent binary trên ${h.name}?`)">
              <UploadCloud :size="12" /> Force upgrade
            </button>
            <button class="act ghost-button" :disabled="actionBusy === h.id + ':install-package'" @click="installPackage(h)">
              <Box :size="12" /> Cài package
            </button>
            <button class="act ghost-button" @click="openCmdHistory(h)">
              <History :size="12" /> Lịch sử lệnh
            </button>
          </div>
        </li>
      </ul>

      <!-- Result dialog (diagnose / logs output) -->
      <div v-if="actionResult" class="action-result">
        <header>
          <strong>{{ actionResult.node }} · {{ actionResult.action }}</strong>
          <button class="ghost-button" @click="closeActionResult">Đóng</button>
        </header>
        <pre>{{ actionResult.output }}</pre>
      </div>

      <!-- Command history (queue + completed) -->
      <div v-if="cmdHistoryNode" class="action-result">
        <header>
          <strong>{{ cmdHistoryNode }} · lịch sử lệnh</strong>
          <button class="ghost-button" @click="closeCmdHistory">Đóng</button>
        </header>
        <div style="padding:10px 14px; font-size:12px">
          <strong style="color:#fbbf24">Đang chờ ({{ cmdHistoryData.pending.length }})</strong>
          <ul v-if="cmdHistoryData.pending.length" style="margin:6px 0 14px; padding-left:18px">
            <li v-for="c in cmdHistoryData.pending" :key="c.id">
              <code style="color:var(--text)">{{ c.action }}</code>
              <small style="color:var(--muted)"> · id={{ c.id.slice(0,8) }} · {{ c.queuedAt?.slice(11,19) }}</small>
            </li>
          </ul>
          <p v-else style="color:var(--muted); margin:6px 0 14px">Không có lệnh đang chờ.</p>

          <strong>Đã chạy ({{ cmdHistoryData.history.length }})</strong>
          <ul v-if="cmdHistoryData.history.length" style="margin:6px 0 0; padding-left:18px">
            <li v-for="c in cmdHistoryData.history" :key="c.id" style="margin-bottom:6px">
              <code :style="{ color: c.code === 0 ? '#4ade80' : '#ef4444' }">{{ c.action }}</code>
              <small style="color:var(--muted)"> · code={{ c.code }} · {{ c.completedAt?.slice(11,19) }}</small>
              <pre v-if="c.output" style="margin:4px 0 0; padding:6px 8px; background:rgba(0,0,0,0.3); border-radius:4px; max-height:160px; overflow:auto; white-space:pre-wrap; font-size:10.5px">{{ c.output }}</pre>
            </li>
          </ul>
          <p v-else style="color:var(--muted); margin:6px 0 0">Chưa có lệnh nào.</p>
        </div>
      </div>
    </section>

    <!-- ── Virtualizor data tab ──────────────────────────────────────────── -->
    <section v-if="tab === 'vzdata'" class="surface" style="padding:16px">
      <div class="section-head"><h2><Cpu :size="14" style="vertical-align:-2px" /> Virtualizor data passthroughs</h2></div>
      <p class="hint">Lookup IDs để gán vào hub plan. Chọn instance trước.</p>
      <div v-if="!vzInstances.length" class="empty-text" style="text-align:left; padding:14px">
        Chưa có Virtualizor instance nào — vào tab <strong>Virtualizor</strong> để thêm.
      </div>
      <div v-for="v in vzInstances" :key="v.id" class="inst-row">
        <header>
          <strong>{{ v.label }}</strong> <span class="cell-mono" style="color:var(--muted); font-size:11px">· {{ v.zone }} · {{ v.id }}</span>
        </header>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin:8px 0">
          <button class="ghost-button" @click="loadVzDataForInst(v.id, 'servers')">List servers</button>
          <button class="ghost-button" @click="loadVzDataForInst(v.id, 'plans')">List plans</button>
          <button class="ghost-button" @click="loadVzDataForInst(v.id, 'ip-pools')">List IP pools</button>
          <button class="ghost-button" @click="loadVzDataForInst(v.id, 'templates')">List OS templates</button>
        </div>
      </div>
      <pre v-if="vzServers" class="json-out">{{ JSON.stringify(vzServers, null, 2) }}</pre>
      <pre v-if="vzPlans" class="json-out">{{ JSON.stringify(vzPlans, null, 2) }}</pre>
      <pre v-if="vzIpPools" class="json-out">{{ JSON.stringify(vzIpPools, null, 2) }}</pre>
      <pre v-if="vzTemplates" class="json-out">{{ JSON.stringify(vzTemplates, null, 2) }}</pre>
    </section>
  </section>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 8px 0 14px; }
.hint code { font-family: var(--mono); background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; color: #d6c060; font-size: 11px; }

.settings-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; padding: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
.settings-tabs button { flex: 1 1 auto; min-width: 130px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 10px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: var(--text); cursor: pointer; font-size: 12.5px; text-align: left; }
.settings-tabs button:hover { background: rgba(255,255,255,0.04); }
.settings-tabs button.active { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.35); color: var(--green); }
.settings-tabs button .t-name { font-weight: 600; }
.settings-tabs button .t-desc { font-size: 10.5px; color: var(--muted); }
.settings-tabs button.active .t-desc { color: rgba(34,197,94,0.7); }

.form-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.form-2col { grid-template-columns: 1fr 1fr; }
.form-3col { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 800px) { .form-3col, .form-2col { grid-template-columns: 1fr 1fr; } }
.field { display: flex; flex-direction: column; gap: 4px; }
.field > span { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.field input, .field select { height: 36px; padding: 0 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font: 13px / 1.3 inherit; outline: none; }
.field input:focus, .field select:focus { border-color: var(--green); }
.field-checkbox { display: inline-flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 12.5px; color: var(--text); cursor: pointer; }
.section-h4 { margin: 16px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

.test-result { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 8px 12px; border-radius: 6px; font-size: 12.5px; }
.test-result.ok  { background: rgba(34,197,94,0.08);  color: var(--green); border: 1px solid rgba(34,197,94,0.3); }
.test-result.err { background: rgba(239,68,68,0.08); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }

.json-out { font-family: var(--mono); font-size: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; max-height: 400px; overflow: auto; margin: 8px 0; color: #9bb8b1; }
.inst-row { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; }
.inst-row > header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.inst-row strong { font-size: 12.5px; color: var(--text); }

/* ── Active VMs card grid + admin remote-action buttons ─────────────────── */
.hub-cards { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: 1fr; gap: 10px; }
.hub-card {
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
}
.hub-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.hub-card > header > div { min-width: 0; flex: 1; }
.hub-card > header strong { font-size: 13px; color: var(--text); display: block; }
.hub-card > header small { font-size: 11px; color: var(--muted); }
.hub-card > header small code { font-family: var(--mono); color: var(--text); background: rgba(255,255,255,0.04); padding: 1px 5px; border-radius: 3px; }
.hub-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 14px; margin: 0; }
.hub-meta > div { min-width: 0; }
.hub-meta dt { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.hub-meta dd { margin: 2px 0 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-actions { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
.act { font-size: 11.5px; padding: 5px 9px; display: inline-flex; align-items: center; gap: 5px; }
.act.warn  { border-color: rgba(245,158,11,0.4); color: #f59e0b; }
.act.danger{ border-color: rgba(239,68,68,0.4);  color: #ef4444; }
.act:disabled { opacity: 0.5; cursor: wait; }
.action-result {
  margin-top: 12px; background: #0a0e14; border: 1px solid var(--border); border-radius: 8px;
  overflow: hidden;
}
.action-result > header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border);
}
.action-result > header strong { font-size: 12.5px; color: var(--text); }
.action-result pre {
  margin: 0; padding: 12px 14px;
  font-family: var(--mono); font-size: 11px; color: #9bb8b1;
  white-space: pre-wrap; word-break: break-word;
  max-height: 480px; overflow: auto;
}
@media (max-width: 700px) {
  .hub-meta { grid-template-columns: 1fr 1fr; }
  .hub-card > header { flex-direction: column; align-items: stretch; }
  .act { flex: 1 1 calc(50% - 3px); justify-content: center; }
}

/* Mobile: collapse settings-tabs to wrap, tables to card-style rows */
@media (max-width: 800px) {
  .settings-tabs { flex-direction: column; }
  .settings-tabs button { min-width: 0; }
  .form-2col, .form-3col { grid-template-columns: 1fr !important; }
  .data-table .table-head { display: none; }
  .data-table .table-row {
    display: flex !important; flex-direction: column; align-items: stretch !important;
    gap: 6px !important; padding: 10px !important;
    border-bottom: 1px solid var(--border) !important;
  }
  .data-table .table-row > * { width: 100%; }
}
</style>
