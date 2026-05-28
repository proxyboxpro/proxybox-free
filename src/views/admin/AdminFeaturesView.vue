<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()

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
const flash = ref('')

// State per tab
const features = ref({})
const groups = reactive({}) // groupId -> values object

async function refresh() {
  err.value = ''; flash.value = ''
  try {
    features.value = await apiFetch('/api/admin/features')
    for (const tab of TABS.filter(t => t.id !== 'features')) {
      groups[tab.id] = await apiFetch(`/api/admin/settings/${tab.id}`)
    }
  } catch (e) { err.value = e.message }
}

async function saveFeatures() {
  try {
    features.value = await apiFetch('/api/admin/features', { method: 'PATCH', body: features.value })
    flash.value = t('admin.feat.flashFeatures')
    setTimeout(() => flash.value = '', 3000)
  } catch (e) { err.value = e.message }
}

async function saveGroup(groupId) {
  try {
    groups[groupId] = await apiFetch(`/api/admin/settings/${groupId}`, { method: 'PATCH', body: groups[groupId] })
    const tab = TABS.value.find(tt => tt.id === groupId)
    flash.value = t('admin.feat.flashGroup', { label: tab.label })
    setTimeout(() => flash.value = '', 3500)
  } catch (e) { err.value = e.message }
}

function parseSelect(kind) {
  return kind.startsWith('select:') ? kind.slice(7).split('|') : null
}

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.feat.eyebrow') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" class="success-text">{{ flash }}</p>

    <!-- Tab strip -->
    <div class="settings-tabs">
      <button
        v-for="tab in TABS" :key="tab.id"
        type="button"
        class="settings-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <span class="t-name">{{ tab.label }}</span>
        <small class="t-desc">{{ tab.desc }}</small>
      </button>
    </div>

    <!-- Features tab -->
    <section v-if="activeTab === 'features'" class="surface">
      <div class="section-head"><h2>{{ t('admin.feat.flagsTitle') }}</h2></div>
      <p class="hint">{{ t('admin.feat.flagsHint') }}</p>
      <div class="data-table">
        <div class="table-head" style="grid-template-columns: 1.4fr 3fr auto">
          <span>{{ t('admin.feat.colFlag') }}</span><span>{{ t('admin.feat.colDesc') }}</span><span></span>
        </div>
        <div v-for="(_, name) in features" :key="name" class="table-row" style="grid-template-columns: 1.4fr 3fr auto">
          <span class="cell-mono">{{ name }}</span>
          <span class="muted">{{ FEATURE_DESCRIPTIONS[name] || '—' }}</span>
          <label class="check-line"><input v-model="features[name]" type="checkbox" /><span>{{ features[name] ? t('admin.feat.on') : t('admin.feat.off') }}</span></label>
        </div>
      </div>
      <button class="primary-action" type="button" style="margin-top:14px" @click="saveFeatures">{{ t('admin.feat.saveFeatures') }}</button>
    </section>

    <!-- All other tabs render the same generic table from FIELD_META -->
    <section v-for="tab in TABS.filter(tt => tt.id !== 'features')" v-show="activeTab === tab.id" :key="tab.id" class="surface">
      <div class="section-head"><h2>{{ tab.label }}</h2></div>
      <p class="hint">{{ t('admin.feat.tabFooter', { desc: tab.desc }) }}</p>
      <div v-if="groups[tab.id]" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.4fr 2.6fr 160px">
          <span>{{ t('admin.feat.colField') }}</span><span>{{ t('admin.feat.colDesc') }}</span><span style="text-align:right">{{ t('admin.feat.colValue') }}</span>
        </div>
        <div
          v-for="[key, label, kind, hint] in FIELD_META[tab.id]"
          :key="key"
          class="table-row"
          style="grid-template-columns: 1.4fr 2.6fr 160px"
        >
          <span>{{ label }}</span>
          <span class="muted">{{ hint }}</span>
          <template v-if="kind === 'bool'">
            <label class="check-line" style="justify-content:flex-end"><input v-model="groups[tab.id][key]" type="checkbox" /><span>{{ groups[tab.id][key] ? t('admin.feat.on') : t('admin.feat.off') }}</span></label>
          </template>
          <template v-else-if="kind === 'int' || kind === 'float'">
            <input v-model.number="groups[tab.id][key]" :type="'number'" :step="kind === 'float' ? '0.01' : '1'" min="0" class="cell-mono input-mono" />
          </template>
          <template v-else-if="kind.startsWith('select:')">
            <select v-model="groups[tab.id][key]" class="input-mono">
              <option v-for="opt in parseSelect(kind)" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>
          <template v-else>
            <input v-model="groups[tab.id][key]" type="text" class="cell-mono input-mono" />
          </template>
        </div>
      </div>
      <button class="primary-action" type="button" style="margin-top:14px" @click="saveGroup(tab.id)">{{ t('admin.feat.saveGroup', { label: tab.label }) }}</button>
    </section>
  </section>
</template>

<style scoped>
.success-text { color: var(--green); font-size: 13px; margin: 4px 0 10px; }
.hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.muted { color: var(--muted); font-size: 12.5px; }

.settings-tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-bottom: 14px;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.settings-tab {
  flex: 1 1 auto; min-width: 130px;
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 1px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font-size: 12.5px;
  text-align: left;
}
.settings-tab:hover { background: rgba(255,255,255,0.04); }
.settings-tab.active {
  background: rgba(34,197,94,0.08);
  border-color: rgba(34,197,94,0.35);
  color: var(--green);
}
.settings-tab .t-name { font-weight: 600; }
.settings-tab .t-desc { font-size: 10.5px; color: var(--muted); }
.settings-tab.active .t-desc { color: rgba(34,197,94,0.7); }

.input-mono {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  text-align: right;
}
.input-mono:focus { outline: none; border-color: var(--green); }
select.input-mono { text-align: left; }
</style>
