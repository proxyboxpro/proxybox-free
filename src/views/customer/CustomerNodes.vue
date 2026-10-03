<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { formatBytes, formatNumber } from '../../utils/format'
import { message, confirmAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const router = useRouter()
const { t } = useI18n()

// Docs steps are collapsible — show only the title until the user clicks.
// Most operators don't need to re-read the intro after first install.
const openStep = ref(0)             // 0 = none open, 1|2|3 = which step body is shown
const STEPS = [
  { n: 1, titleKey: 'cust.nodes.step1Title', bodyKey: 'cust.nodes.step1Body' },
  { n: 2, titleKey: 'cust.nodes.step2Title', bodyKey: 'cust.nodes.step2Body' },
  { n: 3, titleKey: 'cust.nodes.step3Title', bodyKey: 'cust.nodes.step3Body' }
]
function toggleStep(n) { openStep.value = openStep.value === n ? 0 : n }

const nodes = ref([])
const token = ref(null)
const err = ref('')
const busy = ref(false)
const loading = ref(false)

async function loadNodes() {
  err.value = ''
  loading.value = true
  try { nodes.value = await apiFetch('/api/v1/user/nodes') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function loadToken() {
  try { token.value = await apiFetch('/api/v1/user/nodes/fleet-token') }
  catch (e) { if (e.status !== 404) err.value = e.message }
}
async function generateToken() {
  busy.value = true
  try {
    token.value = await apiFetch('/api/v1/user/nodes/fleet-token', { method: 'POST' })
    message.success(t('cust.nodes.tokenGenerated'), 4)
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}
async function revokeToken() {
  if (!(await confirmAsync({ title: t('cust.nodes.revokeConfirm'), danger: true }))) return
  try {
    await apiFetch('/api/v1/user/nodes/fleet-token', { method: 'DELETE' })
    token.value = null
    message.success(t('cust.nodes.tokenRevoked'))
  } catch (e) { message.error(e.message) }
}
function copyCmd(text) {
  navigator.clipboard?.writeText(text)
    .then(() => message.success(t('cust.detail.copied')))
    .catch((e) => message.error(e.message))
}

// Install commands shown once a token exists.
const installCmds = computed(() => (token.value ? [
  { key: 'v4', title: 'Linux IPv4', cmd: token.value.installLinuxV4 },
  { key: 'v6', title: 'Linux IPv6', cmd: token.value.installLinuxV6 },
  { key: 'win', title: 'Windows (Admin)', cmd: token.value.installWindows },
  { key: 'un', title: t('cust.nodes.uninstall'), cmd: token.value.uninstall, danger: true }
] : []))

function openNode(n) { router.push({ name: 'my-node-detail', params: { id: n.id } }) }

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
  <div class="page nodes-page">
    <a-flex justify="space-between" align="flex-start" wrap="wrap" gap="middle">
      <div class="intro">
        <a-typography-title :level="5" class="intro-title">
          ProxyBox <a-typography-text type="secondary" class="intro-small">· IPv4 / IPv6</a-typography-text>
        </a-typography-title>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <a-typography-text type="secondary" class="rich"><span v-html="t('cust.nodes.subtitle')" /></a-typography-text>
      </div>
      <a-button @click="router.push('/api-docs')">
        <template #icon><CodeOutlined /></template>
        {{ t('cust.user.apiDocs') }}
      </a-button>
    </a-flex>

    <!-- How it works — collapsible 3-step intro (click a step to expand) -->
    <a-row :gutter="[12, 12]">
      <a-col v-for="s in STEPS" :key="s.n" :xs="24" :md="8">
        <a-collapse
          :active-key="openStep === s.n ? [String(s.n)] : []"
          expand-icon-position="end"
          class="howto"
          @change="toggleStep(s.n)"
        >
          <a-collapse-panel :key="String(s.n)">
            <template #header>
              <a-space :size="10">
                <a-tag color="green" :bordered="false" class="mono step-num">{{ s.n }}</a-tag>
                <a-typography-text strong>{{ t(s.titleKey) }}</a-typography-text>
              </a-space>
            </template>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <a-typography-text type="secondary" class="rich step-body"><span v-html="t(s.bodyKey)" /></a-typography-text>
          </a-collapse-panel>
        </a-collapse>
      </a-col>
    </a-row>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.nodes.kpiNodes')" :value="nodes.length">
            <template #prefix><CloudServerOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.nodes.kpiProxies')" :value="totals.active" :suffix="`/ ${totals.proxies}`">
            <template #prefix><ApartmentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.nodes.kpiConns')" :value="formatNumber(totals.conns)">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('cust.nodes.kpiBandwidth')" :value="formatBytes(totals.bw)">
            <template #prefix><WifiOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Token + install -->
    <a-card size="small">
      <template #title><KeyOutlined /> {{ t('cust.nodes.tokenTitle') }}</template>
      <template #extra>
        <a-button v-if="!token" type="primary" size="small" :loading="busy" @click="generateToken">
          <template #icon><PlusOutlined /></template>
          {{ t('cust.nodes.genToken') }}
        </a-button>
        <a-space v-else :size="4">
          <a-tooltip :title="t('cust.nodes.rotateToken')">
            <a-button size="small" :loading="busy" @click="generateToken">
              <template #icon><ReloadOutlined /></template>
            </a-button>
          </a-tooltip>
          <a-tooltip :title="t('cust.nodes.revokeToken')">
            <a-button size="small" danger @click="revokeToken">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </a-tooltip>
        </a-space>
      </template>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <a-typography-text v-if="!token" type="secondary" class="rich"><span v-html="t('cust.nodes.tokenEmpty')" /></a-typography-text>

      <template v-else>
        <a-typography-text class="mono token" :copyable="{ text: token.token }">
          {{ token.token.slice(0, 14) }}…{{ token.token.slice(-6) }}
        </a-typography-text>

        <a-row :gutter="[8, 8]" class="cmds">
          <a-col v-for="c in installCmds" :key="c.key" :xs="24" :md="12">
            <a-card size="small" type="inner" class="cmd-card">
              <template #title>
                <a-typography-text :type="c.danger ? 'danger' : undefined" strong>{{ c.title }}</a-typography-text>
              </template>
              <template #extra>
                <a-button size="small" type="text" @click="copyCmd(c.cmd)">
                  <template #icon><CopyOutlined /></template>
                  Copy
                </a-button>
              </template>
              <a-typography-paragraph class="cmd"><pre class="mono">{{ c.cmd }}</pre></a-typography-paragraph>
            </a-card>
          </a-col>
        </a-row>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <a-typography-paragraph type="secondary" class="rich hint"><span v-html="t('cust.nodes.ipv6Hint')" /></a-typography-paragraph>
      </template>
    </a-card>

    <!-- Nodes list -->
    <a-card size="small">
      <template #title><CloudServerOutlined /> {{ t('cust.nodes.yourNodes') }}</template>
      <template #extra>
        <a-tooltip :title="t('cust.refresh')">
          <a-button size="small" :loading="loading" @click="loadNodes">
            <template #icon><ReloadOutlined /></template>
          </a-button>
        </a-tooltip>
      </template>

      <a-empty v-if="!nodes.length" :description="t('cust.nodes.emptyNodes')" />

      <a-row v-else :gutter="[12, 12]">
        <a-col v-for="n in nodes" :key="n.id" :xs="24" :md="12" :xxl="8">
          <a-card
            size="small"
            hoverable
            class="node-card"
            :class="{ offline: n.status !== 'online', disabled: n.disabled }"
            role="link"
            tabindex="0"
            @click="openNode(n)"
            @keyup.enter="openNode(n)"
          >
            <a-flex vertical gap="small">
              <a-flex align="center" gap="small">
                <a-tag :color="n.family === 'ipv6' ? 'purple' : 'blue'" :bordered="false" class="mono fam">{{ (n.family || 'dual').toUpperCase() }}</a-tag>
                <a-typography-text strong :ellipsis="{ tooltip: n.name }" :content="n.name" class="node-name" />
                <StatusTag :status="n.status" />
              </a-flex>
              <a-typography-text type="secondary" class="mono small">{{ n.host }}</a-typography-text>
              <a-row :gutter="8">
                <a-col :span="8">
                  <a-statistic :title="t('cust.nodeDetail.statProxies')" :value="n.activeProxies" :suffix="`/${n.proxyCount}`" class="mini-stat" />
                </a-col>
                <a-col :span="8">
                  <a-statistic :title="t('cust.nodeDetail.statConns')" :value="formatNumber(n.activeConns)" :value-style="{ color: 'var(--pb-success)' }" class="mini-stat" />
                </a-col>
                <a-col :span="8">
                  <a-statistic :title="t('cust.nodeDetail.statBandwidth')" :value="formatBytes((n.uploadBytes || 0) + (n.downloadBytes || 0))" class="mini-stat" />
                </a-col>
              </a-row>
              <a-typography-text v-if="n.version" type="secondary" class="small">
                agent v{{ n.version }} · last seen {{ n.lastSeenAt ? n.lastSeenAt.slice(0,19).replace('T',' ') : '—' }}
              </a-typography-text>
            </a-flex>
            <template #actions>
              <a-flex justify="space-between" align="center" class="open-cta">
                <span>{{ t('cust.nodes.manageNode') }}</span>
                <ArrowRightOutlined />
              </a-flex>
            </template>
          </a-card>
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>

<style scoped>
/* i18n strings rendered with v-html still reference the legacy --green var. */
.nodes-page { --green: var(--pb-primary); }
.intro { flex: 1 1 320px; min-width: 0; }
.intro-title { margin-bottom: 4px !important; }
.intro-small { font-size: 14px; font-weight: 500; }
.rich { line-height: 1.6; }
.rich :deep(code) { font-family: var(--pb-mono); font-size: 0.92em; }
.rich :deep(.link-green) { color: var(--pb-primary); font-weight: 600; }
.step-num { margin-inline-end: 0; }
.step-body { font-size: 12.5px; }
.howto :deep(.ant-collapse-header) { align-items: center !important; }

.token { display: inline-block; margin-bottom: 12px; }
.cmds { margin-bottom: 4px; }
.cmd-card { height: 100%; }
.cmd { margin-bottom: 0 !important; }
.cmd pre { margin: 0; font-size: 11.5px; white-space: pre-wrap; word-break: break-all; }
.hint { margin: 8px 0 0 !important; font-size: 12px; }

.node-card { height: 100%; }
.node-card.offline { border-color: var(--pb-error); opacity: 0.75; }
.node-card.disabled { opacity: 0.55; }
.node-name { flex: 1; min-width: 0; }
.fam { margin-inline-end: 0; }
.small { font-size: 12px; }
.mini-stat :deep(.ant-statistic-title) { font-size: 11px; margin-bottom: 0; }
.mini-stat :deep(.ant-statistic-content) { font-size: 15px; font-family: var(--pb-mono); }
.open-cta { padding: 0 16px; color: var(--pb-primary); font-weight: 600; font-size: 12px; }
</style>
