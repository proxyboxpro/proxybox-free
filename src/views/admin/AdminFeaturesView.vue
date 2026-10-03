<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Grid } from 'ant-design-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const screens = Grid.useBreakpoint()

// 8 tabbed settings groups + legacy feature-flag toggles.
// Labels/descriptions resolved via t() in template — we store descKey here.
const TABS = computed(() => [
  { id: 'features',       label: t('admin.feat.tabFeatures'),  desc: t('admin.feat.tabFeaturesDesc') },
  { id: 'anti-abuse',     label: 'Anti-abuse',                 desc: t('admin.feat.tabAntiAbuseDesc') },
  { id: 'proxy-defaults', label: 'Proxy defaults',             desc: t('admin.feat.tabProxyDefaultsDesc') },
  { id: 'branding',       label: 'Branding & UX',              desc: t('admin.feat.tabBrandingDesc') },
  { id: 'alerts',         label: 'Alerts',                     desc: t('admin.feat.tabAlertsDesc') },
  { id: 'billing',        label: 'Billing',                    desc: t('admin.feat.tabBillingDesc') },
  { id: 'health-check',   label: 'Health-check',               desc: t('admin.feat.tabHealthDesc') },
  { id: 'engine',         label: 'Engine',                     desc: t('admin.feat.tabEngineDesc') },
  { id: 'operations',     label: 'Operations',                 desc: t('admin.feat.tabOpsDesc') }
])

const FEATURE_DESCRIPTIONS = computed(() => ({
  registration:    t('admin.feat.desc.registration'),
  oauth:           t('admin.feat.desc.oauth'),
  totp:            t('admin.feat.desc.totp'),
  billing:         t('admin.feat.desc.billing'),
  affiliate:       t('admin.feat.desc.affiliate'),
  customerWebhook: t('admin.feat.desc.customerWebhook'),
  autoRenew:       t('admin.feat.desc.autoRenew'),
  ipWhitelist:     t('admin.feat.desc.ipWhitelist'),
  stickySession:   t('admin.feat.desc.stickySession')
}))

// Field metadata per settings group: label / hint / kind (int/bool/str/float/select)
const FIELD_META = {
  'anti-abuse': [
    ['maxConnsPerProxy',       'A. Max conns / proxy',         'int', 'Tổng kết nối đồng thời / 1 proxy (HTTP+SOCKS5+Trojan+HTTPS-proxy cộng dồn)'],
    ['maxConnsPerSrcIp',       'B. Max conns / source IP',     'int', '1 IP nguồn không hog hết cap A'],
    ['newConnsPerSecPerIp',    'C. New conns / s / IP',        'int', 'Burst rate per source IP, chặn flood'],
    ['loginMaxAttemptsPer15Min','Login max attempts / 15p',    'int', 'Max lần đăng nhập sai trong 15 phút trước khi lockout'],
    ['loginLockoutMinutes',    'Login lockout duration (min)', 'int', 'Khóa account/IP bao nhiêu phút sau khi vượt cap login'],
    ['quotaGracePercent',      'Quota grace %',                'int', 'Cho phép vượt quota N% trước khi cắt'],
    ['autoSuspendAfterFails',  'Auto-suspend after N fails',   'int', 'Proxy fail liên tiếp N lần check → tự suspend'],
    ['rotateCooldownSec',      'Rotate cooldown (sec)',        'int', 'Min interval giữa 2 lần rotate URL']
  ],
  'engine': [
    ['clientIdleTimeoutSec',     'Client idle timeout (s)',      'int', 'TCP idle timeout — close conn nếu không activity'],
    ['upstreamConnectTimeoutSec','Upstream connect timeout (s)', 'int', 'Timeout khi dial tới target server'],
    ['relayBufferKB',            'Relay buffer / direction (KB)','int', '256KB user-space buffer (cần restart agent)'],
    ['listenBacklog',            'TCP listen backlog',           'int', 'Accept queue size (cần restart)'],
    ['agentPollIntervalSec',     'Agent poll interval (s)',      'int', 'Fallback poll cadence khi long-poll fail'],
    ['agentHeartbeatSec',        'Agent heartbeat interval (s)', 'int', 'Tần suất agent gửi heartbeat về master'],
    ['longPollHoldSec',          'Master long-poll hold (s)',    'int', 'Tối đa master hold connection trước khi reply'],
    ['workerCountPerProxy',      'SO_REUSEPORT workers / proxy', 'int', '0 = auto (min(num_cpus, 8)). Cần restart agent.']
  ],
  'proxy-defaults': [
    ['portStart',             'Port start',                     'int', 'Auto-allocate port bắt đầu từ đâu (mỗi proxy reserve port + tlsPort)'],
    ['expiresDays',           'Default expires (days)',         'int', 'Proxy mới hết hạn sau N ngày nếu plan không override'],
    ['region',                'Default region',                 'str', 'Region tag mặc định cho proxy mới'],
    ['listenHost',            'Default listen host',            'str', '0.0.0.0 hoặc IP cụ thể'],
    ['allowPrivateTargets',   'Allow private targets',          'bool','Cho proxy connect tới 192.168/10/RFC1918 (mặc định off cho an toàn)'],
    ['defaultMonthlyQuotaGB', 'Default monthly quota (GB)',     'int', '0 = unlimited'],
    ['defaultBytesPerSec',    'Default speed cap (B/s)',        'int', '0 = unlimited'],
    ['defaultRotateEverySec', 'Default auto-rotate (s)',        'int', '0 = manual rotate only'],
    ['ipv6PoolPerPrefix',     'IPv6 pool / /48 prefix',         'int', 'Số address synthesize mỗi prefix cho rotate pool']
  ],
  'branding': [
    ['brandName',          'Brand name',          'str',  'Tên hiển thị mọi nơi (sidebar, login, email)'],
    ['supportEmail',       'Support email',       'str',  'Email liên hệ customer thấy'],
    ['supportTelegram',    'Support Telegram',    'str',  '@username hoặc https://t.me/...'],
    ['footerText',         'Footer text (markdown)','str','Hiển thị cuối mỗi trang'],
    ['maintenanceMode',    'Maintenance mode',    'bool', 'Bật = chặn customer login, hiển thị message'],
    ['maintenanceMessage', 'Maintenance message', 'str',  'Text hiển thị khi maintenanceMode ON'],
    ['broadcastText',      'Broadcast banner',    'str',  'Banner luôn hiện trên đầu trang (announcement)'],
    ['broadcastLevel',     'Broadcast level',     'select:info|warn|critical', 'Màu banner'],
    ['loginPageNote',      'Login page note',     'str',  'Hiển thị dưới form login'],
    ['defaultLocale',      'Default locale',      'select:vi|en', ''],
    ['defaultTheme',       'Default theme',       'select:dark|light', ''],
    ['logoUrl',            'Logo URL',            'str',  ''],
    ['faviconUrl',         'Favicon URL',         'str',  '']
  ],
  'alerts': [
    ['webhookUrl',         'Alert webhook URL',      'str',  'Slack/Telegram/Discord incoming webhook'],
    ['webhookFormat',      'Webhook format',         'select:slack|telegram|discord', 'Payload format match webhook type'],
    ['dedupeMinutes',      'Dedupe window (min)',    'int',  'Cùng 1 alert không lặp lại trong N phút'],
    ['onAgentOfflineMin',  'Agent offline alert (min)','int','Cảnh báo khi agent không heartbeat sau N phút'],
    ['highCpuPercent',     'High CPU %',             'int',  'Alert khi CPU > N% sustained'],
    ['highRamPercent',     'High RAM %',             'int',  'Alert khi RAM > N% sustained'],
    ['lowDiskPercent',     'Low disk %',             'int',  'Alert khi disk free < N%'],
    ['quotaSpikePercent',  'Quota spike %',          'int',  'Alert khi proxy dùng > N% quota trong 1h'],
    ['slaTargetPercent',   'SLA target %',           'float','Mục tiêu uptime, hiển thị trên dashboard']
  ],
  'billing': [
    ['defaultCurrency',     'Default currency',         'select:VND|USD|EUR', ''],
    ['minTopupAmount',      'Min topup amount',         'int',  'Customer top up ít nhất bao nhiêu'],
    ['maxTopupAmount',      'Max topup amount',         'int',  '1 lần top up tối đa'],
    ['walletDecimals',      'Wallet decimals',          'int',  '0 cho VND, 2 cho USD'],
    ['autoRenewThresholdPct','Auto-renew threshold %',  'int',  'Auto-renew khi ví đủ N% giá renew'],
    ['autoRenewAdvanceHours','Auto-renew advance (h)',  'int',  'Renew trước hết hạn N giờ'],
    ['trialDays',           'Trial days',               'int',  'Tài khoản mới có N ngày miễn phí'],
    ['invoicePrefix',       'Invoice prefix',           'str',  'Tag invoice ID, vd "INV"'],
    ['vatPercent',          'VAT %',                    'int',  '0 = không tính VAT'],
    ['stripeEnabled',       'Stripe enabled',           'bool', 'Cho phép thanh toán Stripe'],
    ['stripeMode',          'Stripe mode',              'select:test|live', '']
  ],
  'health-check': [
    ['checkHost',                  'Check host (IPv4)',         'str', 'Probe URL để test proxy live (ipv4)'],
    ['checkHostV6',                'Check host (IPv6)',         'str', 'Probe dual-stack cho IPv6 proxy'],
    ['checkTimeoutMs',             'Check timeout (ms)',        'int', 'Probe timeout'],
    ['speedtestHost',              'Speedtest host',            'str', 'Test bandwidth'],
    ['speedtestBytes',             'Speedtest bytes',           'int', 'Số byte download để test'],
    ['probeIntervalMin',           'Probe interval (min)',      'int', 'Auto-probe mỗi N phút'],
    ['failThresholdBeforeAutoRotate','Fail threshold auto-rotate','int','Sau N lần check fail liên tiếp → auto rotate IPv6']
  ],
  'operations': [
    ['auditRetentionDays',         'Audit retention (days)',    'int',  'Xóa audit log cũ hơn N ngày'],
    ['statsResetCadence',          'Stats reset cadence',       'select:daily|weekly|monthly', 'Khi nào reset monthly counter'],
    ['sweepExpiredIntervalMin',    'Sweep expired (min)',       'int',  'Cadence kiểm tra proxy hết hạn'],
    ['sweepAutoRotateIntervalSec', 'Sweep auto-rotate (sec)',   'int',  'Cadence trigger auto-rotate IPv6'],
    ['autoUpgradeAgents',          'Auto-upgrade agents',       'bool', 'Agent 1.7+ tự fetch binary mới khi master bump version'],
    ['pinAgentVersion',            'Pin agent version',         'str',  'Rollback: trống = latest, vd "1.7.0" = pin'],
    ['nodeAutoDisableAfterMin',    'Node auto-disable (min)',   'int',  'Node offline N phút → auto disable'],
    ['enableAuditFullPayload',     'Log full request body',     'bool', 'DEBUG ONLY — verbose audit, không bật prod']
  ]
}

const activeTab = ref('features')
const err = ref('')
const loading = ref(false)
const saving = ref('') // tab id currently being saved

// State per tab
const features = ref({})
const groups = reactive({}) // groupId -> values object

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    features.value = await apiFetch('/api/admin/features')
    for (const tab of TABS.value.filter((tt) => tt.id !== 'features')) {
      groups[tab.id] = await apiFetch(`/api/admin/settings/${tab.id}`)
    }
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function saveFeatures() {
  saving.value = 'features'
  try {
    features.value = await apiFetch('/api/admin/features', { method: 'PATCH', body: features.value })
    message.success(t('admin.feat.flashFeatures'))
  } catch (e) { message.error(e.message) }
  finally { saving.value = '' }
}

async function saveGroup(groupId) {
  saving.value = groupId
  try {
    groups[groupId] = await apiFetch(`/api/admin/settings/${groupId}`, { method: 'PATCH', body: groups[groupId] })
    const tab = TABS.value.find((tt) => tt.id === groupId)
    message.success(t('admin.feat.flashGroup', { label: tab.label }), 3.5)
  } catch (e) { message.error(e.message) }
  finally { saving.value = '' }
}

function selectOptions(kind) {
  return kind.slice(7).split('|').map((v) => ({ label: v, value: v }))
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.feat.eyebrow') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card :body-style="{ padding: screens.md ? '16px 24px 24px 0' : '0 16px 16px' }">
      <a-tabs v-model:active-key="activeTab" :tab-position="screens.md ? 'left' : 'top'">
        <a-tab-pane v-for="tab in TABS" :key="tab.id">
          <template #tab>
            <div class="tab-label">
              <span>{{ tab.label }}</span>
              <a-typography-text v-if="screens.md" type="secondary" class="tab-desc">{{ tab.desc }}</a-typography-text>
            </div>
          </template>

          <!-- Features tab: runtime module toggles -->
          <template v-if="tab.id === 'features'">
            <a-typography-title :level="5" class="pane-title">{{ t('admin.feat.flagsTitle') }}</a-typography-title>
            <a-typography-paragraph type="secondary">{{ t('admin.feat.flagsHint') }}</a-typography-paragraph>
            <a-list
              :data-source="Object.keys(features)"
              :loading="loading && !Object.keys(features).length"
              bordered
              size="small"
            >
              <template #renderItem="{ item: name }">
                <a-list-item>
                  <a-list-item-meta :description="FEATURE_DESCRIPTIONS[name] || '—'">
                    <template #title><span class="mono">{{ name }}</span></template>
                  </a-list-item-meta>
                  <a-switch
                    v-model:checked="features[name]"
                    :checked-children="t('admin.feat.on')"
                    :un-checked-children="t('admin.feat.off')"
                  />
                </a-list-item>
              </template>
            </a-list>
            <a-button type="primary" class="save-btn" :loading="saving === 'features'" @click="saveFeatures">
              <template #icon><SaveOutlined /></template>
              {{ t('admin.feat.saveFeatures') }}
            </a-button>
          </template>

          <!-- All other tabs render the same generic form from FIELD_META -->
          <template v-else>
            <a-typography-title :level="5" class="pane-title">{{ tab.label }}</a-typography-title>
            <a-typography-paragraph type="secondary">{{ t('admin.feat.tabFooter', { desc: tab.desc }) }}</a-typography-paragraph>
            <a-form v-if="groups[tab.id]" :model="groups[tab.id]" layout="vertical" @finish="saveGroup(tab.id)">
              <a-row :gutter="[16, 0]">
                <a-col v-for="[key, label, kind, hint] in FIELD_META[tab.id]" :key="key" :xs="24" :lg="12" :xxl="8">
                  <a-form-item :label="label" :name="key" :extra="hint || undefined">
                    <a-switch
                      v-if="kind === 'bool'"
                      v-model:checked="groups[tab.id][key]"
                      :checked-children="t('admin.feat.on')"
                      :un-checked-children="t('admin.feat.off')"
                    />
                    <a-input-number
                      v-else-if="kind === 'int' || kind === 'float'"
                      v-model:value="groups[tab.id][key]"
                      :min="0"
                      :step="kind === 'float' ? 0.01 : 1"
                      class="mono full-width"
                    />
                    <a-select
                      v-else-if="kind.startsWith('select:')"
                      v-model:value="groups[tab.id][key]"
                      :options="selectOptions(kind)"
                      class="mono"
                    />
                    <a-input v-else v-model:value="groups[tab.id][key]" class="mono" />
                  </a-form-item>
                </a-col>
              </a-row>
              <a-button type="primary" html-type="submit" :loading="saving === tab.id">
                <template #icon><SaveOutlined /></template>
                {{ t('admin.feat.saveGroup', { label: tab.label }) }}
              </a-button>
            </a-form>
            <a-skeleton v-else-if="loading" active />
            <a-empty v-else />
          </template>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<style scoped>
.tab-label { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.3; text-align: left; }
.tab-desc { font-size: 11.5px; }
.pane-title { margin-top: 0; }
.save-btn { margin-top: 16px; }
</style>
