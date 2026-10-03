<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { ShareAltOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons-vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const data = ref(null)
const err = ref('')
const loading = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try { data.value = await apiFetch('/api/v1/user/affiliate') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

const fullUrl = computed(() => {
  if (!data.value) return ''
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}${data.value.shareUrl || `/register?ref=${data.value.referralCode || ''}`}`
})
const shareBlock = computed(() => `${data.value?.shareText || ''}\n${fullUrl.value}`)
function copy(text, label) {
  navigator.clipboard?.writeText(text)
  message.success(label || t('cust.detail.copied'))
}
function copyLink() { copy(fullUrl.value, t('cust.aff.copiedLink')) }
function copyText() {
  if (!data.value) return
  copy(`${data.value.shareText || ''}\n${fullUrl.value}`, t('cust.aff.copiedAll'))
}
function shareTelegram() {
  if (!data.value) return
  window.open(`https://t.me/share/url?url=${encodeURIComponent(fullUrl.value)}&text=${encodeURIComponent(data.value.shareText || '')}`, '_blank')
}
function shareFb() {
  if (!data.value) return
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl.value)}`, '_blank')
}

const referralColumns = computed(() => [
  { title: t('cust.aff.col.signupAt'), key: 'signupDate', dataIndex: 'signupDate', width: 160 },
  { title: t('cust.aff.col.email'), key: 'maskedEmail', dataIndex: 'maskedEmail' },
  { title: t('cust.aff.col.kickback'), key: 'kickback', dataIndex: 'kickback', width: 140, align: 'right' }
])
const referralRows = computed(() => (data.value?.referrals || []).map((r, i) => ({ ...r, _k: i })))

const howSteps = computed(() => [
  { title: t('cust.aff.step1'), description: t('cust.aff.step1Desc'), icon: h(ShareAltOutlined), status: 'process' },
  { title: t('cust.aff.step2'), description: t('cust.aff.step2Desc'), icon: h(TeamOutlined), status: 'process' },
  { title: t('cust.aff.step3'), description: t('cust.aff.step3Desc'), icon: h(WalletOutlined), status: 'process' }
])
const tips = computed(() => [t('cust.aff.tip1'), t('cust.aff.tip2'), t('cust.aff.tip3')])

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.aff.subtitle') }}</a-typography-text>

    <a-alert v-if="err" type="error" show-icon :message="err" />

    <a-card v-if="!data && loading"><a-skeleton active /></a-card>

    <template v-if="data">
      <!-- KPI row -->
      <a-row :gutter="[12, 12]">
        <a-col :xs="12" :lg="6">
          <a-card size="small">
            <a-statistic :title="t('cust.aff.kpiEarned')" :value="Number(data.totalEarned)" :value-style="{ color: 'var(--pb-primary)' }">
              <template #prefix><WalletOutlined /></template>
              <template #formatter="{ value }"><span class="mono">{{ Number(value).toLocaleString() }}</span></template>
            </a-statistic>
            <a-typography-text type="secondary" class="small-text">VND</a-typography-text>
          </a-card>
        </a-col>
        <a-col :xs="12" :lg="6">
          <a-card size="small">
            <a-statistic :title="t('cust.aff.kpiReferred')" :value="data.totalReferred">
              <template #prefix><TeamOutlined /></template>
            </a-statistic>
            <a-typography-text type="secondary" class="small-text">{{ t('cust.aff.referredSub') }}</a-typography-text>
          </a-card>
        </a-col>
        <a-col :xs="12" :lg="6">
          <a-card size="small">
            <a-statistic :title="t('cust.aff.kpiPerSignup')" :value="Number(data.kickbackPerSignup)">
              <template #prefix><RiseOutlined /></template>
              <template #formatter="{ value }"><span class="mono">{{ Number(value).toLocaleString() }}</span></template>
            </a-statistic>
            <a-typography-text type="secondary" class="small-text">{{ t('cust.aff.perSignupUnit') }}</a-typography-text>
          </a-card>
        </a-col>
        <a-col :xs="12" :lg="6">
          <a-card size="small">
            <a-statistic :title="t('cust.aff.kpiCode')" :value="data.referralCode || '—'">
              <template #prefix><GiftOutlined /></template>
              <template #formatter="{ value }">
                <a-typography-text v-if="data.referralCode" class="mono code-val" :copyable="{ text: data.referralCode }">{{ value }}</a-typography-text>
                <span v-else>—</span>
              </template>
            </a-statistic>
            <a-typography-text type="secondary" class="small-text">{{ t('cust.aff.codeSub') }}</a-typography-text>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]">
        <!-- LEFT: share + referrals -->
        <a-col :xs="24" :lg="15" :xl="16">
          <a-flex vertical gap="middle">
            <a-card>
              <template #title><ShareAltOutlined class="title-ico" /> {{ t('cust.aff.shareTitle') }}</template>
              <a-flex vertical gap="middle">
                <a-typography-text type="secondary">{{ t('cust.aff.shareDesc') }}</a-typography-text>

                <div>
                  <a-typography-text strong>{{ t('cust.aff.linkLabel') }}</a-typography-text>
                  <a-space-compact block class="field-gap">
                    <a-input :value="fullUrl" readonly class="mono" />
                    <a-button @click="copyLink"><template #icon><CopyOutlined /></template></a-button>
                  </a-space-compact>
                </div>

                <div>
                  <a-typography-text strong>{{ t('cust.aff.textLabel') }}</a-typography-text>
                  <a-typography-paragraph class="field-gap share-text">
                    <pre>{{ shareBlock }}</pre>
                  </a-typography-paragraph>
                </div>

                <a-space wrap>
                  <a-button type="primary" @click="copyText"><template #icon><CopyOutlined /></template>{{ t('cust.aff.copyAll') }}</a-button>
                  <a-button @click="shareTelegram"><template #icon><SendOutlined /></template>{{ t('cust.aff.shareTg') }}</a-button>
                  <a-button @click="shareFb"><template #icon><FacebookOutlined /></template>{{ t('cust.aff.shareFb') }}</a-button>
                </a-space>
              </a-flex>
            </a-card>

            <!-- Referrals table -->
            <a-card :title="`${t('cust.aff.referralsTitle')} (${data.referrals?.length || 0})`" :body-style="{ padding: 0 }">
              <a-table
                :columns="referralColumns"
                :data-source="referralRows"
                row-key="_k"
                size="middle"
                :pagination="{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }"
                :scroll="{ x: 520 }"
                :locale="{ emptyText: t('cust.aff.empty') }"
              >
                <template #bodyCell="{ column, record: r }">
                  <template v-if="column.key === 'signupDate'">
                    <span class="mono">{{ r.signupDate || '—' }}</span>
                  </template>
                  <template v-else-if="column.key === 'maskedEmail'">
                    <span class="mono">{{ r.maskedEmail }}</span>
                  </template>
                  <template v-else-if="column.key === 'kickback'">
                    <a-typography-text type="success" class="mono">+{{ Number(r.kickback || data.kickbackPerSignup).toLocaleString() }}</a-typography-text>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-flex>
        </a-col>

        <!-- RIGHT: how it works -->
        <a-col :xs="24" :lg="9" :xl="8">
          <a-flex vertical gap="middle" class="aside">
            <a-card size="small" :title="t('cust.aff.howTitle')">
              <a-steps direction="vertical" size="small" :items="howSteps" />
            </a-card>

            <a-card size="small" :title="t('cust.aff.tipsTitle')">
              <a-flex vertical gap="small">
                <span v-for="(tip, i) in tips" :key="i" class="tip"><StarOutlined class="title-ico" /> {{ tip }}</span>
              </a-flex>
            </a-card>
          </a-flex>
        </a-col>
      </a-row>
    </template>
  </div>
</template>

<style scoped>
.small-text { font-size: 12px; }
.title-ico { color: var(--pb-primary); }
.code-val { font-size: 18px; }
.field-gap { margin-top: 6px; }
.share-text { margin-bottom: 0; }
.share-text pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.55; }
.tip { display: flex; gap: 8px; align-items: baseline; }

@media (min-width: 992px) {
  .aside { position: sticky; top: 84px; }
}
</style>
