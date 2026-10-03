<script setup>
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync, promptAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const { t } = useI18n()
const tab = ref('config')
const err = ref('')

// ── Virtualizor instances (multi-zone) ───────────────────────────────────
const vzInstances = ref([])
const editingVz = ref(null)
const vzDraft = ref({ label: '', zone: '', panelUrl: '', apiKey: '', apiPass: '', insecureTls: true, enabled: true })
const vzTesting = ref('')
const vzTestResult = ref(null)
const vzSaving = ref(false)

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
  vzSaving.value = true
  try {
    if (editingVz.value === 'new') {
      const r = await apiFetch('/api/admin/virtualizors', { method: 'POST', body: vzDraft.value })
      message.success(t('admin.hubs.vzAdded', { id: r.id }))
    } else {
      await apiFetch(`/api/admin/virtualizors/${editingVz.value}`, { method: 'PATCH', body: vzDraft.value })
      message.success(t('admin.hubs.vzUpdated'))
    }
    cancelVzEdit()
    await loadInstances()
  } catch (e) { message.error(e.message) }
  finally { vzSaving.value = false }
}
async function deleteVz(id) {
  if (!(await confirmAsync({ title: t('admin.hubs.vzConfirmDel'), danger: true }))) return
  try { await apiFetch(`/api/admin/virtualizors/${id}`, { method: 'DELETE' }); await loadInstances() }
  catch (e) { message.error(e.message) }
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
const vzDataBusy = ref('')             // `${instId}:${kind}` while in-flight

// ── Hub plans CRUD ────────────────────────────────────────────────────────
const hubPlans = ref([])
const editingPlan = ref(null)
const planSaving = ref(false)
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
function reloadVzCatalog() {
  const instId = draftPlan.vz.instanceId
  vzCatalogCache[instId] = { fetched: false }
  loadVzCatalog(instId)
}
function cancelEdit() { editingPlan.value = null; Object.assign(draftPlan, newPlanDraft()) }
async function savePlan() {
  planSaving.value = true
  try {
    if (editingPlan.value === 'new') {
      await apiFetch('/api/admin/hub-plans', { method: 'POST', body: draftPlan })
      message.success(t('admin.hubs.planCreated'))
    } else {
      await apiFetch(`/api/admin/hub-plans/${editingPlan.value}`, { method: 'PATCH', body: draftPlan })
      message.success(t('admin.hubs.planUpdated'))
    }
    cancelEdit()
    await loadHubPlans()
  } catch (e) { message.error(e.message) }
  finally { planSaving.value = false }
}
async function deletePlan(id) {
  if (!(await confirmAsync({ title: t('admin.hubs.planConfirmDel'), danger: true }))) return
  try { await apiFetch(`/api/admin/hub-plans/${id}`, { method: 'DELETE' }); await loadHubPlans() }
  catch (e) { message.error(e.message) }
}

// ── Provisioned hubs (admin overview) ─────────────────────────────────────
const provisionedHubs = ref([])
const hubsLoading = ref(false)
async function loadHubs() {
  hubsLoading.value = true
  try { provisionedHubs.value = await apiFetch('/api/admin/hubs') }
  catch (e) { err.value = e.message }
  finally { hubsLoading.value = false }
}

// ── Remote actions on a hub VM (reboot, diagnose, drain, …) ──────────────
const PACKAGE_WHITELIST = ['htop', 'atop', 'iperf3', 'mtr-tiny', 'mtr', 'vnstat', 'tcpdump', 'jq', 'dnsutils', 'net-tools', 'sysstat', 'iotop', 'bpytop']
const actionBusy = ref('')             // `${nodeId}:${action}` while in-flight
const actionResult = ref(null)         // { node, action, output } shown in panel
const cmdHistoryNode = ref(null)       // nodeId whose history dialog is open
const cmdHistoryData = ref({ pending: [], history: [] })

const DANGER_ACTIONS = ['reboot', 'power-off']

async function runAction(hub, action, opts = {}) {
  const { confirmMsg, body } = typeof opts === 'string' ? { confirmMsg: opts } : opts
  if (confirmMsg && !(await confirmAsync({ title: confirmMsg, danger: DANGER_ACTIONS.includes(action) }))) return
  const key = `${hub.id}:${action}`
  if (actionBusy.value) return
  actionBusy.value = key
  try {
    const r = await apiFetch(`/api/nodes/${hub.id}/action/${action}`, { method: 'POST', body })
    const verdict = r.ok === false ? 'FAILED' : (r.via === 'agent-channel' ? 'QUEUED' : 'OK')
    const text = `[${hub.name}] ${action} → ${verdict}${r.via ? ' (' + r.via + ')' : ''}`
    if (r.ok === false) message.error(text)
    else message.success(text)
    if (r.output) actionResult.value = { node: hub.name, action, output: r.output, ok: r.ok }
    if (r.oneLiner) actionResult.value = { node: hub.name, action, output: `Run this on the box:\n  ${r.oneLiner}\n\n${r.hint || ''}`, ok: true }
    if (!['diagnose', 'tail-logs'].includes(action)) await loadHubs()
  } catch (e) { message.error(`${action} failed: ${e.message}`) }
  finally { actionBusy.value = '' }
}

async function installPackage(hub) {
  const wl = PACKAGE_WHITELIST.join(', ')
  const pkg = await promptAsync({
    // The i18n string carries a line break before the whitelist.
    title: h('span', { style: { whiteSpace: 'pre-line' } }, t('admin.hubs.actInstallPkgPrompt', { name: hub.name, wl })),
    defaultValue: 'htop'
  })
  if (!pkg) return
  if (!PACKAGE_WHITELIST.includes(pkg.trim())) {
    message.error(t('admin.hubs.actInstallPkgNotWl', { pkg, wl }))
    return
  }
  await runAction(hub, 'install-package', { body: { package: pkg.trim() } })
}

async function openCmdHistory(hub) {
  cmdHistoryNode.value = hub.id
  try { cmdHistoryData.value = await apiFetch(`/api/nodes/${hub.id}/commands`) }
  catch (e) { message.error(e.message); cmdHistoryData.value = { pending: [], history: [] } }
}
function closeCmdHistory() { cmdHistoryNode.value = null }
function closeActionResult() { actionResult.value = null }

// Per-instance passthrough loader (replaces legacy single-instance versions)
async function loadVzDataForInst(instId, kind) {
  vzDataBusy.value = `${instId}:${kind}`
  try {
    const r = await apiFetch(`/api/admin/virtualizors/${instId}/${kind}`)
    if (kind === 'servers') vzServers.value = r
    if (kind === 'plans') vzPlans.value = r
    if (kind === 'ip-pools') vzIpPools.value = r
    if (kind === 'templates') vzTemplates.value = r
  } catch (e) { message.error(`${kind}: ${e.message}`) }
  finally { vzDataBusy.value = '' }
}

// ── Table columns / select options ───────────────────────────────────────
const vzColumns = computed(() => [
  { title: t('admin.hubs.vzColInst'), key: 'inst' },
  { title: t('admin.hubs.vzColZone'), key: 'zone', width: 120 },
  { title: t('admin.hubs.vzColPanelUrl'), key: 'panelUrl', ellipsis: true },
  { title: t('admin.hubs.vzColLastTest'), key: 'lastTest', width: 140 },
  { title: t('admin.hubs.colStatus'), key: 'status', width: 100 },
  { title: '', key: 'actions', width: 210, align: 'right' }
])
const planColumns = computed(() => [
  { title: t('admin.hubs.colPlan'), key: 'plan' },
  { title: t('admin.hubs.colRegionFam'), key: 'region', width: 150 },
  { title: t('admin.hubs.colSpecs'), key: 'specs', width: 210 },
  { title: t('admin.hubs.colHour'), key: 'price', width: 110, align: 'right' },
  { title: t('admin.hubs.colStatus'), key: 'status', width: 110 },
  { title: '', key: 'actions', width: 120, align: 'right' }
])
const familyOptions = computed(() => [
  { value: 'ipv4', label: t('admin.hubs.planFamilyV4') },
  { value: 'ipv6', label: t('admin.hubs.planFamilyV6') }
])
const virtOptions = [
  { value: 'kvm', label: 'KVM' }, { value: 'openvz', label: 'OpenVZ' }, { value: 'lxc', label: 'LXC' }, { value: 'proxmox-k', label: 'Proxmox KVM' }
]
const instanceOptions = computed(() => [
  { value: '', label: t('admin.hubs.planVzInstPh') },
  ...vzInstances.value.map((v) => ({ value: v.id, label: `${v.label} — ${v.zone} (${v.panelUrl})` }))
])
// Live catalogue dropdowns; the first entry maps to null / '' like the old
// "(chọn …)" placeholder <option>. Numeric ids stay numbers, pools stay strings.
const catalogInst = computed(() => draftPlan.vz.instanceId)
const serverOptions = computed(() => (catalogInst.value ? vzServerOptions(catalogInst.value) : []))
const planOptions = computed(() => (catalogInst.value ? vzPlanOptions(catalogInst.value) : []))
const osOptions = computed(() => (catalogInst.value ? vzOsOptions(catalogInst.value) : []))
const ip4PoolOptions = computed(() => (catalogInst.value ? vzIpPoolOptions(catalogInst.value, 'v4') : []))
const ip6PoolOptions = computed(() => (catalogInst.value ? vzIpPoolOptions(catalogInst.value, 'v6') : []))
const numOpts = (list, ph) => [{ value: null, label: ph }, ...list.map((o) => ({ value: Number(o.id), label: o.label }))]
const strOpts = (list, ph) => [{ value: '', label: ph }, ...list.map((o) => ({ value: String(o.id), label: o.label }))]

function hubStatus(s) { return s === 'online' ? 'active' : (s === 'provisioning' ? 'pending' : 'expired') }
function fmtStamp(s) { return s?.slice(0, 16).replace('T', ' ') }
function prettyJson(v) { return JSON.stringify(v, null, 2) }
const vzDataOutputs = computed(() => [vzServers.value, vzPlans.value, vzIpPools.value, vzTemplates.value].filter(Boolean))

onMounted(async () => {
  await loadInstances()
  await loadHubPlans()
  await loadHubs()
})
</script>
<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.hubs.eyebrow') }}</a-typography-text>
      <a-button shape="circle" :loading="hubsLoading" @click="loadHubs">
        <template #icon><ReloadOutlined /></template>
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-tabs v-model:active-key="tab" class="hub-tabs">
      <!-- ── Virtualizor instances (multi-zone) ─────────────────────────── -->
      <a-tab-pane key="config">
        <template #tab>
          <span class="tab-label">{{ t('admin.hubs.tabVz') }}<small>{{ t('admin.hubs.tabVzDesc') }}</small></span>
        </template>
        <a-card :body-style="{ paddingTop: '12px' }">
          <template #title>
            <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-title">
              <span><KeyOutlined /> {{ t('admin.hubs.vzTitle', { n: vzInstances.length }) }}</span>
              <a-button type="primary" @click="startVzEdit(null)">
                <template #icon><PlusOutlined /></template>
                {{ t('admin.hubs.vzAdd') }}
              </a-button>
            </a-flex>
          </template>
          <a-typography-paragraph type="secondary" class="hint">
            <span v-html="t('admin.hubs.vzHint')"></span>
          </a-typography-paragraph>

          <a-table
            :columns="vzColumns"
            :data-source="vzInstances"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 860 }"
          >
            <template #emptyText>
              <a-empty>
                <template #description><span v-html="t('admin.hubs.vzEmpty')"></span></template>
              </a-empty>
            </template>
            <template #bodyCell="{ column, record: v }">
              <template v-if="column.key === 'inst'">
                <a-typography-text strong>{{ v.label }}</a-typography-text>
                <div><a-typography-text type="secondary" class="mono small">{{ v.id }}</a-typography-text></div>
              </template>
              <template v-else-if="column.key === 'zone'"><span class="mono">{{ v.zone || '—' }}</span></template>
              <template v-else-if="column.key === 'panelUrl'">
                <a-tooltip :title="v.panelUrl"><span class="mono small">{{ v.panelUrl }}</span></a-tooltip>
              </template>
              <template v-else-if="column.key === 'lastTest'">
                <template v-if="v.lastTestedAt">
                  <a-typography-text type="secondary" class="mono small">{{ v.lastTestedAt.slice(11, 19) }}</a-typography-text>
                  <a-tag :color="v.lastTestOk ? 'success' : 'error'" :bordered="false" class="test-tag">{{ v.lastTestOk ? 'OK' : 'FAIL' }}</a-tag>
                </template>
                <a-typography-text v-else type="secondary">—</a-typography-text>
              </template>
              <template v-else-if="column.key === 'status'">
                <StatusTag :status="v.enabled ? 'active' : 'expired'" :label="v.enabled ? 'on' : 'off'" />
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space :size="4">
                  <a-button size="small" :loading="vzTesting === v.id" @click="testVz(v.id)">
                    <template #icon><SafetyCertificateOutlined /></template>
                    {{ vzTesting === v.id ? t('admin.hubs.vzTesting') : t('admin.hubs.vzBtnTest') }}
                  </a-button>
                  <a-button size="small" @click="startVzEdit(v)">{{ t('admin.hubs.vzBtnEdit') }}</a-button>
                  <a-button size="small" danger @click="deleteVz(v.id)">
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>

          <a-alert
            v-if="vzTestResult"
            class="test-result"
            show-icon
            closable
            :type="vzTestResult.ok ? 'success' : 'error'"
            :message="vzTestResult.ok ? t('admin.hubs.vzTestOk') : (vzTestResult.error || t('admin.hubs.vzTestErr'))"
            @close="vzTestResult = null"
          />
        </a-card>
      </a-tab-pane>

      <!-- ── Plans tab ──────────────────────────────────────────────────── -->
      <a-tab-pane key="plans">
        <template #tab>
          <span class="tab-label">{{ t('admin.hubs.tabPlans') }}<small>{{ t('admin.hubs.tabPlansDesc') }}</small></span>
        </template>
        <a-card :body-style="{ padding: 0 }">
          <template #title>
            <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-title">
              <span><CloudOutlined /> {{ t('admin.hubs.plansTitle', { n: hubPlans.length }) }}</span>
              <a-button type="primary" @click="startEdit(null)">
                <template #icon><PlusOutlined /></template>
                {{ t('admin.hubs.planNew') }}
              </a-button>
            </a-flex>
          </template>
          <a-table
            :columns="planColumns"
            :data-source="hubPlans"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 860 }"
            :locale="{ emptyText: t('admin.hubs.plansEmpty') }"
          >
            <template #bodyCell="{ column, record: p }">
              <template v-if="column.key === 'plan'">
                <a-typography-text strong>{{ p.name }}</a-typography-text>
                <div><a-typography-text type="secondary" class="mono small">{{ p.id }} · vz#{{ p.vz?.planId || '—' }}</a-typography-text></div>
              </template>
              <template v-else-if="column.key === 'region'">{{ p.region }} · {{ p.family }}</template>
              <template v-else-if="column.key === 'specs'">
                <span class="mono small">{{ p.specs.cpu }}vCPU · {{ p.specs.ramGB }}GB · {{ p.specs.diskGB }}GB</span>
              </template>
              <template v-else-if="column.key === 'price'">
                <span class="mono">{{ Number(p.hourlyPrice).toLocaleString() }}</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <StatusTag :status="p.enabled ? 'active' : 'expired'" :label="p.enabled ? t('admin.hubs.planEnabledTag') : t('admin.hubs.planDisabledTag')" />
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space :size="4">
                  <a-button size="small" @click="startEdit(p)">{{ t('admin.hubs.vzBtnEdit') }}</a-button>
                  <a-button size="small" danger @click="deletePlan(p.id)">
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <!-- ── Provisioned VMs ────────────────────────────────────────────── -->
      <a-tab-pane key="hubs">
        <template #tab>
          <span class="tab-label">{{ t('admin.hubs.tabVms') }}<small>{{ t('admin.hubs.tabVmsDesc', { n: provisionedHubs.length }) }}</small></span>
        </template>
        <a-card>
          <template #title>
            <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-title">
              <span><CloudServerOutlined /> {{ t('admin.hubs.vmsTitle', { n: provisionedHubs.length }) }}</span>
              <a-button :loading="hubsLoading" @click="loadHubs">
                <template #icon><ReloadOutlined /></template>
                {{ t('admin.hubs.vmsRefresh') }}
              </a-button>
            </a-flex>
          </template>
          <a-empty v-if="!provisionedHubs.length" :description="t('admin.hubs.vmsEmpty')" />
          <a-flex v-else vertical gap="middle">
            <a-card v-for="hub in provisionedHubs" :key="hub.id" size="small" type="inner">
              <template #title>
                <span class="mono">{{ hub.name }}</span>
                <div>
                  <a-typography-text type="secondary" class="small">
                    vpsid=<span class="mono">{{ hub.vpsid }}</span> ·
                  </a-typography-text>
                  <a-typography-text :copyable="{ text: hub.host }" class="mono small">{{ hub.host }}</a-typography-text>
                </div>
              </template>
              <template #extra><StatusTag :status="hubStatus(hub.status)" :label="hub.status" /></template>

              <a-descriptions size="small" :column="{ xs: 1, sm: 2, lg: 4 }">
                <a-descriptions-item :label="t('admin.hubs.vmOwner')">{{ hub.ownerEmail }}</a-descriptions-item>
                <a-descriptions-item :label="t('admin.hubs.vmPlan')">{{ hub.planName || hub.planId }}</a-descriptions-item>
                <a-descriptions-item :label="t('admin.hubs.vmProvisioned')"><span class="mono">{{ fmtStamp(hub.provisionedAt) }}</span></a-descriptions-item>
                <a-descriptions-item :label="t('admin.hubs.vmExpires')"><span class="mono">{{ fmtStamp(hub.expiresAt) }}</span></a-descriptions-item>
              </a-descriptions>

              <a-divider dashed class="act-divider" />
              <a-space wrap :size="6">
                <a-button size="small" :loading="actionBusy === hub.id + ':diagnose'" @click="runAction(hub, 'diagnose')">
                  <template #icon><MedicineBoxOutlined /></template>{{ t('admin.hubs.actDiagnose') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':tail-logs'" @click="runAction(hub, 'tail-logs')">
                  <template #icon><CodeOutlined /></template>{{ t('admin.hubs.actLogs') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':refresh-network'" @click="runAction(hub, 'refresh-network')">
                  <template #icon><ReloadOutlined /></template>{{ t('admin.hubs.actRefreshIp') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':restart-agent'" @click="runAction(hub, 'restart-agent', t('admin.hubs.actRestartAgentConfirm', { name: hub.name }))">
                  <template #icon><RedoOutlined /></template>{{ t('admin.hubs.actRestartAgent') }}
                </a-button>
                <a-button size="small" danger ghost :loading="actionBusy === hub.id + ':reboot'" @click="runAction(hub, 'reboot', t('admin.hubs.actRebootConfirm', { name: hub.name }))">
                  <template #icon><ThunderboltOutlined /></template>{{ t('admin.hubs.actReboot') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':power-on'" @click="runAction(hub, 'power-on')">
                  <template #icon><PoweroffOutlined /></template>{{ t('admin.hubs.actPowerOn') }}
                </a-button>
                <a-button size="small" danger :loading="actionBusy === hub.id + ':power-off'" @click="runAction(hub, 'power-off', t('admin.hubs.actPowerOffConfirm', { name: hub.name }))">
                  <template #icon><PoweroffOutlined /></template>{{ t('admin.hubs.actPowerOff') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':drain'" @click="runAction(hub, 'drain', t('admin.hubs.actDrainConfirm', { name: hub.name }))">
                  <template #icon><WarningOutlined /></template>{{ t('admin.hubs.actDrain') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':upgrade'" @click="runAction(hub, 'upgrade', t('admin.hubs.actUpgradeConfirm', { name: hub.name }))">
                  <template #icon><CloudUploadOutlined /></template>{{ t('admin.hubs.actUpgrade') }}
                </a-button>
                <a-button size="small" :loading="actionBusy === hub.id + ':install-package'" @click="installPackage(hub)">
                  <template #icon><AppstoreAddOutlined /></template>{{ t('admin.hubs.actInstallPkg') }}
                </a-button>
                <a-button size="small" @click="openCmdHistory(hub)">
                  <template #icon><HistoryOutlined /></template>{{ t('admin.hubs.actCmdHistory') }}
                </a-button>
              </a-space>
            </a-card>
          </a-flex>
        </a-card>
      </a-tab-pane>

      <!-- ── Virtualizor data tab ───────────────────────────────────────── -->
      <a-tab-pane key="vzdata">
        <template #tab>
          <span class="tab-label">{{ t('admin.hubs.tabData') }}<small>{{ t('admin.hubs.tabDataDesc') }}</small></span>
        </template>
        <a-card :body-style="{ paddingTop: '12px' }">
          <template #title><DatabaseOutlined /> {{ t('admin.hubs.vzDataTitle') }}</template>
          <a-typography-paragraph type="secondary" class="hint">{{ t('admin.hubs.vzDataHint') }}</a-typography-paragraph>
          <a-empty v-if="!vzInstances.length">
            <template #description><span v-html="t('admin.hubs.vzDataEmpty')"></span></template>
          </a-empty>
          <a-flex vertical gap="small">
            <a-card v-for="v in vzInstances" :key="v.id" size="small" type="inner">
              <template #title>
                {{ v.label }}
                <a-typography-text type="secondary" class="mono small"> · {{ v.zone }} · {{ v.id }}</a-typography-text>
              </template>
              <a-space wrap :size="6">
                <a-button size="small" :loading="vzDataBusy === `${v.id}:servers`" @click="loadVzDataForInst(v.id, 'servers')">{{ t('admin.hubs.vzListServers') }}</a-button>
                <a-button size="small" :loading="vzDataBusy === `${v.id}:plans`" @click="loadVzDataForInst(v.id, 'plans')">{{ t('admin.hubs.vzListPlans') }}</a-button>
                <a-button size="small" :loading="vzDataBusy === `${v.id}:ip-pools`" @click="loadVzDataForInst(v.id, 'ip-pools')">{{ t('admin.hubs.vzListIpPools') }}</a-button>
                <a-button size="small" :loading="vzDataBusy === `${v.id}:templates`" @click="loadVzDataForInst(v.id, 'templates')">{{ t('admin.hubs.vzListOsTpl') }}</a-button>
              </a-space>
            </a-card>
            <pre v-for="(out, i) in vzDataOutputs" :key="i" class="mono code-block">{{ prettyJson(out) }}</pre>
          </a-flex>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Virtualizor instance editor -->
    <a-modal
      :open="!!editingVz"
      :title="editingVz === 'new' ? t('admin.hubs.vzEditNew') : t('admin.hubs.vzEditExisting', { id: editingVz })"
      :ok-text="editingVz === 'new' ? t('admin.hubs.vzBtnAdd') : t('admin.hubs.vzBtnSave')"
      :cancel-text="t('admin.hubs.vzBtnCancel')"
      :confirm-loading="vzSaving"
      :width="640"
      destroy-on-close
      @ok="saveVz"
      @cancel="cancelVzEdit"
    >
      <a-form :model="vzDraft" layout="vertical" class="modal-form">
        <a-row :gutter="12">
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.vzLabel')">
              <a-input v-model:value="vzDraft.label" :placeholder="t('admin.hubs.vzLabelPh')" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.vzZone')">
              <a-input v-model:value="vzDraft.zone" class="mono" :placeholder="t('admin.hubs.vzZonePh')" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.hubs.vzPanelUrl')">
              <a-input v-model:value="vzDraft.panelUrl" type="url" class="mono" placeholder="https://10.10.10.2:4085" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.vzApiKey')">
              <a-input v-model:value="vzDraft.apiKey" class="mono" :placeholder="editingVz === 'new' ? t('admin.hubs.vzApiKeyPhNew') : t('admin.hubs.vzApiKeyPhKeep')" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.vzApiPass')">
              <a-input-password v-model:value="vzDraft.apiPass" class="mono" :placeholder="editingVz === 'new' ? t('admin.hubs.vzApiPassPhNew') : t('admin.hubs.vzApiKeyPhKeep')" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-checkbox v-model:checked="vzDraft.insecureTls">{{ t('admin.hubs.vzInsecureTls') }}</a-checkbox>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-checkbox v-model:checked="vzDraft.enabled">{{ t('admin.hubs.vzEnabled') }}</a-checkbox>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>

    <!-- Hub plan editor -->
    <a-modal
      :open="!!editingPlan"
      :title="editingPlan === 'new' ? t('admin.hubs.planEditNew') : t('admin.hubs.planEditExisting', { id: editingPlan })"
      :ok-text="editingPlan === 'new' ? t('admin.hubs.planBtnCreate') : t('admin.hubs.planBtnSave')"
      :cancel-text="t('admin.hubs.vzBtnCancel')"
      :confirm-loading="planSaving"
      :width="880"
      @ok="savePlan"
      @cancel="cancelEdit"
    >
      <a-form :model="draftPlan" layout="vertical" class="modal-form">
        <a-row :gutter="12">
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.planName')"><a-input v-model:value="draftPlan.name" /></a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.planRegion')"><a-input v-model:value="draftPlan.region" :placeholder="t('admin.hubs.planRegionPh')" /></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item :label="t('admin.hubs.planDesc')"><a-input v-model:value="draftPlan.description" /></a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.planFamily')"><a-select v-model:value="draftPlan.family" :options="familyOptions" /></a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item :label="t('admin.hubs.planHourly', { currency: draftPlan.currency })">
              <a-input-number v-model:value="draftPlan.hourlyPrice" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planMinHours')"><a-input-number v-model:value="draftPlan.minHours" :min="1" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planMaxHours')"><a-input-number v-model:value="draftPlan.maxHours" :min="1" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planMaxQty')"><a-input-number v-model:value="draftPlan.maxQuantity" :min="0" class="full-width" /></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item>
              <a-checkbox v-model:checked="draftPlan.enabled">{{ t('admin.hubs.planEnabled') }}</a-checkbox>
            </a-form-item>
          </a-col>
        </a-row>

        <a-divider orientation="left" orientation-margin="0" class="form-divider">{{ t('admin.hubs.planSpecs') }}</a-divider>
        <a-row :gutter="12">
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planVcpu')"><a-input-number v-model:value="draftPlan.specs.cpu" :min="1" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planRam')"><a-input-number v-model:value="draftPlan.specs.ramGB" :min="0" :step="0.5" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planDisk')"><a-input-number v-model:value="draftPlan.specs.diskGB" :min="0" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planBw')"><a-input-number v-model:value="draftPlan.specs.bandwidthGB" :min="0" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planIpv4Count')"><a-input-number v-model:value="draftPlan.specs.ipv4Count" :min="0" class="full-width" /></a-form-item>
          </a-col>
          <a-col :xs="12" :sm="8">
            <a-form-item :label="t('admin.hubs.planIpv6Range')"><a-input v-model:value="draftPlan.specs.ipv6Range" class="mono" :placeholder="t('admin.hubs.planIpv6RangePh')" /></a-form-item>
          </a-col>
        </a-row>

        <a-divider orientation="left" orientation-margin="0" class="form-divider">
          {{ t('admin.hubs.planVzMap') }}
          <a-typography-text type="secondary" class="small">{{ t('admin.hubs.planVzMapNote') }}</a-typography-text>
        </a-divider>
        <a-row :gutter="12">
          <a-col :span="24">
            <a-form-item :label="t('admin.hubs.planVzInst')">
              <a-flex gap="small">
                <a-select v-model:value="draftPlan.vz.instanceId" :options="instanceOptions" class="grow" />
                <a-tooltip v-if="draftPlan.vz.instanceId" :title="t('admin.hubs.planVzReload')">
                  <a-button :loading="vzCatalogLoading" @click="reloadVzCatalog">
                    <template #icon><ReloadOutlined /></template>
                    {{ vzCatalogLoading ? t('admin.hubs.planVzReloading') : t('admin.hubs.planVzReloadBtn') }}
                  </a-button>
                </a-tooltip>
              </a-flex>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzVirt')"><a-select v-model:value="draftPlan.vz.virt" :options="virtOptions" /></a-form-item>
          </a-col>

          <!-- Server: dropdown live-fetched từ /api/admin/virtualizors/:id/servers,
               fallback raw input nếu instance chưa pick hoặc fetch fail. -->
          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzServer')">
              <a-select v-if="serverOptions.length" v-model:value="draftPlan.vz.serverId" :options="numOpts(serverOptions, t('admin.hubs.planVzServerPh'))" />
              <a-input-number v-else v-model:value="draftPlan.vz.serverId" placeholder="0" class="full-width" />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzPlan')">
              <a-select v-if="planOptions.length" v-model:value="draftPlan.vz.planId" :options="numOpts(planOptions, t('admin.hubs.planVzPlanPh'))" />
              <a-input-number v-else v-model:value="draftPlan.vz.planId" placeholder="1" class="full-width" />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzOs')">
              <a-select v-if="osOptions.length" v-model:value="draftPlan.vz.osId" :options="numOpts(osOptions, t('admin.hubs.planVzOsPh'))" />
              <a-input-number v-else v-model:value="draftPlan.vz.osId" placeholder="1197" class="full-width" />
            </a-form-item>
          </a-col>

          <!-- IPv4 pool — REQUIRED. For ipv4-family plans this is the egress
               subnet sold to customer. For ipv6-family hubs this is the
               connect-host IP (proxy listens here, egress goes via IPv6). -->
          <a-col :xs="24" :sm="8">
            <a-form-item :label="`${t('admin.hubs.planVzIpPool')} ${draftPlan.family === 'ipv6' ? t('admin.hubs.planVzIpPoolHost') : t('admin.hubs.planVzIpPoolSell')}`">
              <a-select v-if="ip4PoolOptions.length" v-model:value="draftPlan.vz.ipPool" :options="strOpts(ip4PoolOptions, t('admin.hubs.planVzIpPoolPh'))" />
              <a-input v-else v-model:value="draftPlan.vz.ipPool" class="mono" placeholder="7" />
            </a-form-item>
          </a-col>

          <!-- IPv6 pool — only relevant when selling IPv6 hubs. Hidden for
               pure ipv4-family plans (no IPv6 subnet attached to VPS). -->
          <a-col v-if="draftPlan.family === 'ipv6'" :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzIp6Pool')">
              <a-select v-if="ip6PoolOptions.length" v-model:value="draftPlan.vz.ip6Pool" :options="strOpts(ip6PoolOptions, t('admin.hubs.planVzIp6PoolPh'))" />
              <a-input v-else v-model:value="draftPlan.vz.ip6Pool" class="mono" placeholder="5" />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :sm="8">
            <a-form-item :label="t('admin.hubs.planVzDiskTpl')"><a-input-number v-model:value="draftPlan.vz.diskTemplate" class="full-width" /></a-form-item>
          </a-col>
        </a-row>
        <a-alert v-if="vzCatalogLoading" type="info" show-icon :message="t('admin.hubs.planVzLoading')" />
        <a-alert v-else-if="draftPlan.vz.instanceId && !vzCatalogCache[draftPlan.vz.instanceId]?.fetched" type="warning" show-icon :message="t('admin.hubs.planVzNotLoaded')" />
        <a-typography-text v-else-if="draftPlan.vz.instanceId" type="secondary" class="small">{{ t('admin.hubs.planVzAutoLoaded') }}</a-typography-text>
      </a-form>
    </a-modal>

    <!-- Result dialog (diagnose / logs output) -->
    <a-modal :open="!!actionResult" :title="actionResult ? `${actionResult.node} · ${actionResult.action}` : ''" :width="820" @cancel="closeActionResult">
      <pre v-if="actionResult" class="mono code-block tall">{{ actionResult.output }}</pre>
      <template #footer>
        <a-button @click="closeActionResult">{{ t('admin.hubs.actClose') }}</a-button>
      </template>
    </a-modal>

    <!-- Command history (queue + completed) -->
    <a-modal :open="!!cmdHistoryNode" :title="t('admin.hubs.cmdHistTitle', { node: cmdHistoryNode })" :width="760" @cancel="closeCmdHistory">
      <a-typography-text type="warning" strong>{{ t('admin.hubs.cmdHistPending', { n: cmdHistoryData.pending.length }) }}</a-typography-text>
      <a-list size="small" :data-source="cmdHistoryData.pending" :locale="{ emptyText: t('admin.hubs.cmdHistPendingEmpty') }" class="hist-list">
        <template #renderItem="{ item: c }">
          <a-list-item>
            <a-tag :bordered="false" class="mono">{{ c.action }}</a-tag>
            <a-typography-text type="secondary" class="mono small">id={{ c.id.slice(0, 8) }} · {{ c.queuedAt?.slice(11, 19) }}</a-typography-text>
          </a-list-item>
        </template>
      </a-list>

      <a-typography-text strong>{{ t('admin.hubs.cmdHistDone', { n: cmdHistoryData.history.length }) }}</a-typography-text>
      <a-list size="small" :data-source="cmdHistoryData.history" :locale="{ emptyText: t('admin.hubs.cmdHistDoneEmpty') }" class="hist-list">
        <template #renderItem="{ item: c }">
          <a-list-item>
            <div class="full-width">
              <a-tag :color="c.code === 0 ? 'success' : 'error'" :bordered="false" class="mono">{{ c.action }}</a-tag>
              <a-typography-text type="secondary" class="mono small">code={{ c.code }} · {{ c.completedAt?.slice(11, 19) }}</a-typography-text>
              <pre v-if="c.output" class="mono code-block short">{{ c.output }}</pre>
            </div>
          </a-list-item>
        </template>
      </a-list>
      <template #footer>
        <a-button @click="closeCmdHistory">{{ t('admin.hubs.actClose') }}</a-button>
      </template>
    </a-modal>
  </div>
</template>

<style scoped>
.hub-tabs :deep(.ant-tabs-nav) { margin-bottom: 12px; }
.tab-label { display: inline-flex; flex-direction: column; align-items: flex-start; line-height: 1.3; }
.tab-label small { font-size: 11px; color: var(--pb-text-3); font-weight: 400; }
.card-title { white-space: normal; padding: 10px 0; }
.hint { margin-bottom: 12px; }
.small { font-size: 11.5px; }
.grow { flex: 1; min-width: 0; }
.test-tag { margin-inline: 6px 0; }
.test-result { margin-top: 12px; }
.act-divider { margin: 10px 0; }
.form-divider { margin: 0 0 12px; font-size: 13px; }
.modal-form { margin-top: 12px; }
.hist-list { margin: 4px 0 14px; }
.code-block {
  margin: 0; padding: 10px 12px; max-height: 400px; overflow: auto;
  font-size: 11px; white-space: pre-wrap; word-break: break-word;
  background: var(--pb-surface-2); border: 1px solid var(--pb-border); border-radius: 6px;
}
.code-block.tall { max-height: 480px; }
.code-block.short { max-height: 160px; margin-top: 6px; font-size: 10.5px; }
</style>
