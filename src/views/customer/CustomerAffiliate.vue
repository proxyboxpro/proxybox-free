<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  ChevronRight, Clipboard, Copy, Gift, Share2, Sparkles, TrendingUp, Users, Wallet
} from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const data = ref(null)
const err = ref('')
const flash = ref('')

async function refresh() {
  err.value = ''
  try { data.value = await apiFetch('/api/v1/user/affiliate') }
  catch (e) { err.value = e.message }
}

const fullUrl = computed(() => {
  if (!data.value) return ''
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}${data.value.shareUrl || `/register?ref=${data.value.referralCode || ''}`}`
})
function copy(text, label) {
  navigator.clipboard?.writeText(text); flash.value = label || t('cust.detail.copied'); setTimeout(() => flash.value = '', 1200)
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

onMounted(refresh)
</script>

<template>
  <h1>{{ t('cust.aff.title') }}</h1>
  <p class="sub">{{ t('cust.aff.subtitle') }}</p>

  <p v-if="err" class="error-text">{{ err }}</p>
  <p v-if="flash" style="color:#4ade80; font-size:13px">{{ flash }}</p>

  <div v-if="data">
    <!-- KPI row -->
    <div class="kpi-row">
      <div class="kpi-card-v2">
        <span class="ico purple"><Wallet :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.aff.kpiEarned') }}</span>
          <span class="val">{{ Number(data.totalEarned).toLocaleString() }}</span>
          <span class="foot"><span class="dot"></span> VND</span>
        </div>
      </div>
      <div class="kpi-card-v2">
        <span class="ico green"><Users :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.aff.kpiReferred') }}</span>
          <span class="val">{{ data.totalReferred }}</span>
          <span class="foot"><span class="dot"></span> {{ t('cust.aff.referredSub') }}</span>
        </div>
      </div>
      <div class="kpi-card-v2">
        <span class="ico amber"><TrendingUp :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.aff.kpiPerSignup') }}</span>
          <span class="val">{{ Number(data.kickbackPerSignup).toLocaleString() }}</span>
          <span class="foot"><span class="dot"></span> {{ t('cust.aff.perSignupUnit') }}</span>
        </div>
      </div>
      <div class="kpi-card-v2">
        <span class="ico blue"><Gift :size="22" /></span>
        <div class="body">
          <span class="lbl">{{ t('cust.aff.kpiCode') }}</span>
          <span class="val cell-mono" style="font-size:16px">{{ data.referralCode || '—' }}</span>
          <span class="foot"><span class="dot"></span> {{ t('cust.aff.codeSub') }}</span>
        </div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 1fr 360px; gap:18px; align-items:start">
      <!-- LEFT: share + referrals -->
      <div style="display:flex; flex-direction:column; gap:14px; min-width:0">
        <section class="surface">
          <h2 style="margin:0 0 6px; color:var(--text); font-size:16px"><Share2 :size="14" style="vertical-align:-2px; color:var(--pxl)" /> {{ t('cust.aff.shareTitle') }}</h2>
          <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px">{{ t('cust.aff.shareDesc') }}</p>

          <span class="eyebrow">{{ t('cust.aff.linkLabel') }}</span>
          <div class="credential-box" style="display:flex; align-items:center; gap:8px; margin: 6px 0 12px; background: var(--pxl-card-2); border-color: var(--pxl-bd)">
            <code style="flex:1; word-break:break-all; color:var(--text)">{{ fullUrl }}</code>
            <button class="ghost-button" type="button" @click="copyLink"><Clipboard :size="14" /></button>
          </div>

          <span class="eyebrow">{{ t('cust.aff.textLabel') }}</span>
          <pre style="margin-top: 6px; font-size:12.5px; white-space:pre-wrap; line-height:1.55; background: var(--pxl-card-2); border-color: var(--pxl-bd); color:var(--text)">{{ data.shareText || '' }}
{{ fullUrl }}</pre>

          <div class="action-row" style="margin-top:14px; gap:8px">
            <button class="primary-action" type="button" @click="copyText"><Copy :size="14" /> {{ t('cust.aff.copyAll') }}</button>
            <button class="ghost-button" type="button" @click="shareTelegram">{{ t('cust.aff.shareTg') }}</button>
            <button class="ghost-button" type="button" @click="shareFb">{{ t('cust.aff.shareFb') }}</button>
          </div>
        </section>

        <!-- Referrals table -->
        <section class="dt2">
          <div class="dt2-toolbar">
            <h2 style="margin:0; color:var(--text); font-size:15px">{{ t('cust.aff.referralsTitle') }} ({{ data.referrals?.length || 0 }})</h2>
          </div>
          <div class="dt2-head" style="grid-template-columns: 1.2fr 2fr 0.8fr">
            <span>{{ t('cust.aff.col.signupAt') }}</span>
            <span>{{ t('cust.aff.col.email') }}</span>
            <span>{{ t('cust.aff.col.kickback') }}</span>
          </div>
          <div v-for="(r, i) in (data.referrals || [])" :key="i" class="dt2-row" style="grid-template-columns: 1.2fr 2fr 0.8fr">
            <span class="cell-mono">{{ r.signupDate || '—' }}</span>
            <span class="cell-mono" style="color:var(--text)">{{ r.maskedEmail }}</span>
            <span class="cell-mono" style="color:#4ade80">+{{ Number(r.kickback || data.kickbackPerSignup).toLocaleString() }}</span>
          </div>
          <p v-if="!data.referrals?.length" class="empty-text" style="padding:30px">{{ t('cust.aff.empty') }}</p>
        </section>
      </div>

      <!-- RIGHT: how it works -->
      <aside style="display:flex; flex-direction:column; gap:14px; position:sticky; top:80px">
        <div class="px-detail">
          <h3>{{ t('cust.aff.howTitle') }}</h3>
          <div style="display:flex; flex-direction:column; gap:14px; margin-top:6px">
            <div style="display:flex; gap:10px">
              <div class="kpi-card-v2" style="padding:0; background:transparent; border:none">
                <span class="ico purple" style="width:36px; height:36px; border-radius:10px"><Share2 :size="16" /></span>
              </div>
              <div>
                <div style="color:var(--text); font-size:13px; font-weight:600">{{ t('cust.aff.step1') }}</div>
                <div style="color:var(--muted); font-size:11.5px">{{ t('cust.aff.step1Desc') }}</div>
              </div>
            </div>
            <div style="display:flex; gap:10px">
              <div class="kpi-card-v2" style="padding:0; background:transparent; border:none">
                <span class="ico green" style="width:36px; height:36px; border-radius:10px"><Users :size="16" /></span>
              </div>
              <div>
                <div style="color:var(--text); font-size:13px; font-weight:600">{{ t('cust.aff.step2') }}</div>
                <div style="color:var(--muted); font-size:11.5px">{{ t('cust.aff.step2Desc') }}</div>
              </div>
            </div>
            <div style="display:flex; gap:10px">
              <div class="kpi-card-v2" style="padding:0; background:transparent; border:none">
                <span class="ico amber" style="width:36px; height:36px; border-radius:10px"><Wallet :size="16" /></span>
              </div>
              <div>
                <div style="color:var(--text); font-size:13px; font-weight:600">{{ t('cust.aff.step3') }}</div>
                <div style="color:var(--muted); font-size:11.5px">{{ t('cust.aff.step3Desc') }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="px-detail">
          <h3>{{ t('cust.aff.tipsTitle') }}</h3>
          <span class="help-link" style="cursor:default"><Sparkles :size="14" /> {{ t('cust.aff.tip1') }}</span>
          <span class="help-link" style="cursor:default"><Sparkles :size="14" /> {{ t('cust.aff.tip2') }}</span>
          <span class="help-link" style="cursor:default"><Sparkles :size="14" /> {{ t('cust.aff.tip3') }}</span>
        </div>
      </aside>
    </div>
  </div>
</template>
