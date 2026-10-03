<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { DeleteOutlined, GlobalOutlined, WindowsOutlined } from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { nodesState, loadNodes, addNode, removeNode, installNode, syncNode } from '../store/nodes'
import { message, confirmAsync } from '../ui/feedback'
import StatusTag from '../components/ui/StatusTag.vue'

const { t } = useI18n()
const syncing = ref('')
const busy = ref('')

const showForm = ref(false)
const submitting = ref(false)
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
const ownerOptions = computed(() => [
  { label: 'All', value: 'all' },
  { label: `Fleet (${fleetCount.value})`, value: 'fleet' },
  { label: `BYON (${byonCount.value})`, value: 'byon' }
])
const emptyText = computed(() => (ownerFilter.value === 'byon' ? t('nodes.add.emptyByon')
  : ownerFilter.value === 'fleet' ? t('nodes.add.emptyFleet')
    : t('nodes.add.emptyAll')))
const zoneOptions = computed(() => [
  { label: t('nodes.add.zoneAuto'), value: '' },
  ...zones.value.map((z) => ({ label: `${z.flag || ''} ${z.name}`.trim(), value: z.id }))
])

const columns = computed(() => [
  { title: t('nodes.list.colNode'), key: 'node', width: 260 },
  { title: t('nodes.list.colEndpoint'), key: 'endpoint', width: 220 },
  { title: t('nodes.list.colFamilyZone'), key: 'family', width: 150 },
  { title: t('nodes.list.colStatus'), key: 'status', width: 150 },
  { title: t('nodes.list.colActions'), key: 'actions', width: 380 }
])
const expandedKeys = computed(() => Object.keys(installOut))

function detailLink(id) { return { name: 'admin-node-detail', params: { nodeId: id } } }
function statusColor(s) { return s === 'online' ? 'success' : (s === 'install-failed' ? 'error' : 'warning') }

async function onSync(id) {
  if (syncing.value) return
  syncing.value = id
  try { await syncNode(id) } catch (e) { message.error(e.message) } finally { syncing.value = '' }
}
async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await addNode({ name: form.name, host: form.host, sshUser: form.sshUser, sshPassword: form.sshPassword, family: form.family, tag: form.tag, zone: form.zone })
    form.name = ''; form.host = ''; form.sshPassword = ''; form.family = 'ipv4'; form.tag = ''; form.zone = ''
    showForm.value = false
  } catch (e) { message.error(e.message) }
  finally { submitting.value = false }
}
async function onRemove(id) {
  if (!(await confirmAsync({ title: t('nodes.add.confirmDelete', { id }), danger: true }))) return
  try { await removeNode(id) } catch (e) { message.error(e.message) }
}
async function onInstall(id) {
  if (installing.value) return
  installing.value = id
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
    message.success(r.disabled ? t('nodes.add.flashDisabled', { name: n.name }) : t('nodes.add.flashEnabled', { name: n.name }))
  } catch (e) { message.error(e.message) }
  finally { busy.value = '' }
}
async function onCheckAll(n) {
  busy.value = n.id
  try {
    const r = await apiFetch(`/api/nodes/${n.id}/check-all`, { method: 'POST' })
    message.success(t('nodes.add.checkAllResult', { name: n.name, passed: r.passed, total: r.total, failed: r.failed }), 6)
  } catch (e) { message.error(e.message) }
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
  if (!(await confirmAsync({ title: t('nodes.fleet.confirmRevoke'), danger: true }))) return
  fleetBusy.value = true
  try { await apiFetch('/api/nodes/fleet-token', { method: 'DELETE' }); fleet.value = null }
  catch (e) { fleetErr.value = e.message }
  finally { fleetBusy.value = false }
}
async function copyText(s, key) {
  try { await navigator.clipboard.writeText(s); fleetCopied.value = key; setTimeout(() => { if (fleetCopied.value === key) fleetCopied.value = '' }, 1500) } catch { /* ignore */ }
}
const fleetCmds = computed(() => {
  const f = fleet.value
  if (!f) return []
  return [
    { key: 'linux-v4', icon: GlobalOutlined, title: t('nodes.fleet.linuxV4'), tag: 'v4', tagColor: 'blue', cmd: f.installLinuxV4 || f.installLinux, hint: t('nodes.fleet.linuxV4Note') },
    { key: 'linux-v6', icon: GlobalOutlined, title: t('nodes.fleet.linuxV6'), tag: 'v6', tagColor: 'purple', cmd: f.installLinuxV6 || f.installLinux, hint: t('nodes.fleet.linuxV6Note') },
    { key: 'win', icon: WindowsOutlined, title: 'Windows (PowerShell, Administrator)', cmd: f.installWindows },
    { key: 'uninst', icon: DeleteOutlined, title: t('nodes.fleet.uninstall'), tag: t('nodes.fleet.tagDanger'), tagColor: 'red', cmd: f.uninstall, hint: t('nodes.fleet.uninstallNote') }
  ]
})

onMounted(async () => {
  loadNodes()
  try { zones.value = await apiFetch('/api/admin/zones') } catch { /* not admin */ }
  loadFleetToken()
})
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('nodes.title') }}</a-typography-text>
      <a-button type="primary" @click="showForm = !showForm">
        <template #icon><PlusOutlined /></template>
        {{ t('nodes.add') }}
      </a-button>
    </a-flex>

    <a-alert v-if="nodesState.error" type="error" show-icon :message="nodesState.error" />

    <!-- ── Add node form ───────────────────────────────────────────────── -->
    <a-card v-if="showForm" :title="t('nodes.add')">
      <a-typography-paragraph type="secondary">{{ t('nodes.addHint') }}</a-typography-paragraph>
      <a-form :model="form" layout="vertical" @finish="submit">
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.name')" name="name"><a-input v-model:value="form.name" placeholder="vn-edge-2" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.host')" name="host"><a-input v-model:value="form.host" placeholder="103.x.x.x" class="mono" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.sshUser')" name="sshUser"><a-input v-model:value="form.sshUser" placeholder="root" class="mono" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.sshPassword')" name="sshPassword"><a-input-password v-model:value="form.sshPassword" placeholder="••••••" /></a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item name="family">
              <template #label>
                <a-space :size="4">{{ t('nodes.family') }}<a-typography-text type="danger" strong>{{ t('nodes.add.required') }}</a-typography-text></a-space>
              </template>
              <a-radio-group v-model:value="form.family" button-style="solid">
                <a-radio-button value="ipv4">IPv4 only</a-radio-button>
                <a-radio-button value="ipv6">IPv6 only</a-radio-button>
              </a-radio-group>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.tag')" name="tag"><a-input v-model:value="form.tag" :placeholder="t('nodes.add.tagPh')" :maxlength="32" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('nodes.add.zoneLabel')" name="zone"><a-select v-model:value="form.zone" :options="zoneOptions" /></a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="submitting">{{ submitting ? t('auth.processing') : t('nodes.register') }}</a-button>
      </a-form>
    </a-card>

    <!-- ── Quick (zero-touch) enrollment ───────────────────────────────── -->
    <a-card>
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span><ThunderboltOutlined class="title-icon" /> {{ t('nodes.fleet.title') }}</span>
          <a-button v-if="!fleet" type="primary" :loading="fleetBusy" @click="regenFleetToken">
            <template #icon><KeyOutlined /></template>
            {{ t('nodes.fleet.generate') }}
          </a-button>
          <a-space v-else wrap :size="8">
            <a-button :disabled="fleetBusy" @click="regenFleetToken"><template #icon><RedoOutlined /></template>{{ t('nodes.fleet.rotate') }}</a-button>
            <a-button danger :disabled="fleetBusy" @click="revokeFleetToken"><template #icon><DeleteOutlined /></template>{{ t('nodes.fleet.revoke') }}</a-button>
          </a-space>
        </a-flex>
      </template>
      <a-alert v-if="fleetErr" type="error" show-icon :message="fleetErr" class="block-gap" />
      <a-typography-paragraph type="secondary">{{ t('nodes.fleet.intro') }}</a-typography-paragraph>
      <template v-if="fleet">
        <a-row :gutter="[12, 12]">
          <a-col v-for="c in fleetCmds" :key="c.key" :xs="24" :xl="12">
            <a-card size="small" class="full-height">
              <template #title>
                <a-space :size="6">
                  <component :is="c.icon" />
                  <span>{{ c.title }}</span>
                  <a-tag v-if="c.tag" :color="c.tagColor" :bordered="false" class="mono">{{ c.tag }}</a-tag>
                </a-space>
              </template>
              <template #extra>
                <a-button size="small" @click="copyText(c.cmd, c.key)">
                  <template #icon><CheckOutlined v-if="fleetCopied === c.key" /><CopyOutlined v-else /></template>
                  {{ fleetCopied === c.key ? t('nodes.fleet.copied') : t('nodes.fleet.copy') }}
                </a-button>
              </template>
              <a-typography-paragraph class="cmd-block"><pre class="mono">{{ c.cmd }}</pre></a-typography-paragraph>
              <a-typography-text v-if="c.hint" type="secondary" class="hint">{{ c.hint }}</a-typography-text>
            </a-card>
          </a-col>
          <a-col :xs="24" :xl="12">
            <a-card size="small" :title="t('nodes.fleet.directDownload')" class="full-height">
              <a-space wrap>
                <a-button :href="fleet.binaryLinux" target="_blank"><template #icon><DownloadOutlined /></template>Linux binary</a-button>
                <a-button :href="fleet.binaryWindows" target="_blank"><template #icon><DownloadOutlined /></template>Windows .exe</a-button>
              </a-space>
            </a-card>
          </a-col>
        </a-row>
        <a-flex wrap="wrap" gap="small" align="center" class="token-row">
          <a-typography-text type="secondary">{{ t('nodes.fleet.token') }}:</a-typography-text>
          <a-typography-text class="mono" :copyable="{ text: fleet.token }">{{ fleet.token }}</a-typography-text>
        </a-flex>
      </template>
    </a-card>

    <!-- ── Local node summary card ───────────────────────────────────────── -->
    <a-card v-if="local">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <RouterLink :to="detailLink('local')"><CloudServerOutlined /> {{ local.name }}</RouterLink>
          <a-space wrap :size="8">
            <a-button :loading="syncing === 'local'" @click="onSync('local')">
              <template #icon><SyncOutlined /></template>
              {{ syncing === 'local' ? t('nodes.syncing') : t('nodes.sync') }}
            </a-button>
            <a-button :loading="busy === 'local'" @click="onCheckAll({ id: 'local', name: 'control plane' })">
              <template #icon><SafetyCertificateOutlined /></template>
              Check all
            </a-button>
            <StatusTag status="online" />
          </a-space>
        </a-flex>
      </template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 4 }">
        <a-descriptions-item label="Host"><a-typography-text class="mono" :copyable="{ text: local.host }">{{ local.host }}</a-typography-text></a-descriptions-item>
        <a-descriptions-item :label="t('nodes.proxies')">{{ local.proxies }}</a-descriptions-item>
        <a-descriptions-item :label="t('nodes.ipv4')">{{ local.network ? local.network.ipv4PoolSize : '—' }}</a-descriptions-item>
        <a-descriptions-item :label="t('nodes.ipv6')">{{ local.network ? local.network.ipv6PoolSize : '—' }}</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- ── Agent node list — compact table with inline actions ──────────── -->
    <a-card :body-style="{ padding: 0 }">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="card-head-controls">
          <span>{{ t('nodes.agents') }} ({{ others.length }})</span>
          <a-segmented v-model:value="ownerFilter" :options="ownerOptions" />
        </a-flex>
      </template>
      <a-table
        :columns="columns"
        :data-source="others"
        row-key="id"
        size="middle"
        :pagination="false"
        :scroll="{ x: 1160 }"
        :locale="{ emptyText }"
        :expanded-row-keys="expandedKeys"
        :show-expand-column="false"
      >
        <template #bodyCell="{ column, record: n }">
          <template v-if="column.key === 'node'">
            <a-space wrap :size="4">
              <RouterLink :to="detailLink(n.id)"><CloudServerOutlined /> {{ n.name }}</RouterLink>
              <a-tooltip v-if="n.isByon" :title="t('nodes.list.byonTitle', { email: n.ownerEmail })">
                <a-tag color="gold" :bordered="false">BYON · {{ n.ownerEmail || n.ownerId }}</a-tag>
              </a-tooltip>
              <a-tag v-else-if="n.tag" :bordered="false">{{ n.tag }}</a-tag>
              <a-tag v-if="n.version" :bordered="false" class="mono">v{{ n.version }}</a-tag>
            </a-space>
          </template>
          <template v-else-if="column.key === 'endpoint'">
            <span class="mono">{{ n.sshUser }}@{{ n.host }}</span>
            <a-typography-text v-if="n.proxies" type="secondary"> · {{ n.proxies }} px</a-typography-text>
          </template>
          <template v-else-if="column.key === 'family'">
            <a-space wrap :size="4">
              <a-tag v-if="n.family" :color="n.family === 'ipv6' ? 'purple' : n.family === 'ipv4' ? 'blue' : 'cyan'" :bordered="false" class="mono">{{ n.family }}</a-tag>
              <a-tag v-if="n.zone && n.zone !== 'auto'" :bordered="false">{{ n.zone }}</a-tag>
            </a-space>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-space wrap :size="4">
              <StatusTag v-if="n.disabled" status="disabled" color="error" :label="t('nodes.list.disabled')" />
              <StatusTag v-else :status="n.status" :color="statusColor(n.status)" />
              <a-tooltip v-if="n.outdated" :title="t('nodes.list.outdatedTitle', { cur: n.version, latest: n.latestAgentVersion })">
                <StatusTag status="pending" :label="t('nodes.list.outdated')" />
              </a-tooltip>
            </a-space>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space wrap :size="4">
              <a-button size="small" :loading="syncing === n.id" @click="onSync(n.id)"><template #icon><SyncOutlined /></template>{{ t('nodes.list.sync') }}</a-button>
              <a-button size="small" :disabled="busy === n.id" @click="onCheckAll(n)"><template #icon><SafetyCertificateOutlined /></template>{{ t('nodes.list.checkLive') }}</a-button>
              <a-button size="small" :disabled="busy === n.id" @click="onToggle(n)"><template #icon><PoweroffOutlined /></template>{{ n.disabled ? t('nodes.list.enable') : t('nodes.list.disable') }}</a-button>
              <a-button v-if="n.hasCreds && n.status !== 'online'" size="small" type="primary" :loading="installing === n.id" @click="onInstall(n.id)">{{ t('nodes.list.install') }}</a-button>
              <a-button size="small" danger @click="onRemove(n.id)"><template #icon><DeleteOutlined /></template></a-button>
            </a-space>
          </template>
        </template>
        <template #expandedRowRender="{ record: n }">
          <a-alert v-if="installOut[n.id]" :type="installOut[n.id].ok ? 'success' : 'error'" class="install-out">
            <template #message><pre class="mono">{{ installOut[n.id].output }}</pre></template>
          </a-alert>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.title-icon { color: var(--pb-primary); }
.block-gap { margin-bottom: 12px; }
.full-height { height: 100%; }
.card-head-controls { padding: 8px 0; }
.card-head-controls :deep(.ant-segmented), .card-head-controls :deep(.ant-btn) { font-weight: 400; }
.cmd-block { margin-bottom: 8px !important; }
.cmd-block pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
.hint { font-size: 12px; }
.token-row { margin-top: 12px; }
.install-out pre { margin: 0; max-height: 180px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
</style>
