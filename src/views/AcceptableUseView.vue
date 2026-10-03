<script setup>
import { computed } from 'vue'
import PublicTopNav from '../components/PublicTopNav.vue'
import { useI18n } from '../i18n'
import { aup, AUP_VERSION } from '../data/aup.js'

const { t, locale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const year = new Date().getFullYear()
const doc = computed(() => aup[locale.value] || aup.vi)
</script>

<template>
  <a-layout class="pub-page">
    <PublicTopNav :sub-label="locale === 'vi' ? 'Chính sách' : 'Policy'" />

    <a-layout-content class="pub-shell">
      <header class="pub-head">
        <a-typography-text type="success" strong class="kicker">
          <SafetyCertificateOutlined /> {{ doc.eyebrow }}
        </a-typography-text>
        <a-typography-title :level="1" class="page-title">{{ doc.title }}</a-typography-title>
        <a-typography-paragraph type="secondary" class="page-sub">{{ doc.subtitle }}</a-typography-paragraph>
        <a-tag :bordered="false" class="mono">{{ doc.updatedLabel }} {{ AUP_VERSION }}</a-tag>
      </header>

      <a-typography class="lead">
        <p v-for="(p, i) in doc.lead" :key="i">{{ p }}</p>
      </a-typography>

      <a-card class="danger-card">
        <template #title>
          <a-typography-title :level="2" type="danger" class="block-title">
            <WarningOutlined /> {{ doc.prohibitedHeading }}
          </a-typography-title>
        </template>
        <a-list :data-source="doc.prohibited" item-layout="vertical" size="small" class="prohibited">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title><span class="ph-title">{{ item.category }}</span></template>
                <template v-if="item.legalRef" #description><span class="mono legal-ref">{{ item.legalRef }}</span></template>
              </a-list-item-meta>
              <a-typography-text type="secondary">{{ item.detail }}</a-typography-text>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><BankOutlined /> {{ doc.legalHeading }}</a-typography-title>
        </template>
        <a-list :data-source="doc.legalBasis" size="small" bordered>
          <template #renderItem="{ item }">
            <a-list-item>
              <a-row :gutter="[14, 4]" class="legal-row">
                <a-col :xs="24" :md="9">
                  <a-flex vertical :gap="2">
                    <a-typography-text strong>{{ item.instrument }}</a-typography-text>
                    <a-typography-text type="secondary" class="mono legal-ref">{{ item.citation }}</a-typography-text>
                  </a-flex>
                </a-col>
                <a-col :xs="24" :md="15">
                  <a-typography-text type="secondary">{{ item.requires }}</a-typography-text>
                </a-col>
              </a-row>
            </a-list-item>
          </template>
        </a-list>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><FileTextOutlined /> {{ doc.obligationsHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body">
          <ul><li v-for="(o, i) in doc.obligations" :key="i">{{ o }}</li></ul>
        </a-typography>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><LockOutlined /> {{ doc.privacyHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body"><p v-for="(p, i) in doc.privacy" :key="i">{{ p }}</p></a-typography>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><AuditOutlined /> {{ doc.enforcementHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body"><p v-for="(p, i) in doc.enforcement" :key="i">{{ p }}</p></a-typography>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><MailOutlined /> {{ doc.abuseHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body"><p v-for="(p, i) in doc.abuse" :key="i" v-html="p"></p></a-typography>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><InfoCircleOutlined /> {{ doc.disclaimerHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body"><p v-for="(p, i) in doc.disclaimer" :key="i">{{ p }}</p></a-typography>
      </a-card>

      <a-card>
        <template #title>
          <a-typography-title :level="2" class="block-title"><BankOutlined /> {{ doc.lawHeading }}</a-typography-title>
        </template>
        <a-typography class="block-body"><p v-for="(p, i) in doc.law" :key="i">{{ p }}</p></a-typography>
      </a-card>
    </a-layout-content>

    <a-layout-footer class="pub-foot">
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="pub-foot-inner">
        <span>{{ t('landing.foot.copyright', { year, ver: appVersion }) }}</span>
        <span>
          <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
          <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink> ·
          <RouterLink to="/">{{ locale === 'vi' ? 'Trang chủ' : 'Home' }}</RouterLink>
        </span>
      </a-flex>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped>
.pub-page { min-height: 100vh; }
.pub-shell {
  width: 100%; max-width: 880px; margin: 0 auto;
  padding: 32px 24px 56px;
  display: flex; flex-direction: column; gap: 20px;
}

/* Header */
.kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.page-title { margin: 4px 0 8px !important; font-size: 30px !important; letter-spacing: -0.4px; }
.page-sub { margin: 0 0 10px !important; font-size: 15px; line-height: 1.6; }

.lead { font-size: 14.5px; line-height: 1.7; }
.lead p:last-child { margin-bottom: 0; }

/* Section cards */
.block-title { margin: 0 !important; font-size: 16px !important; line-height: 1.5 !important; white-space: normal; }
.block-title :deep(.anticon) { margin-inline-end: 6px; }
.block-body { font-size: 14px; line-height: 1.7; }
.block-body p:last-child,
.block-body ul { margin-bottom: 0; }
.danger-card { border-color: color-mix(in srgb, var(--pb-error) 40%, var(--pb-border)); }

.prohibited :deep(.ant-list-item) { padding-inline: 0; }
.ph-title { font-weight: 600; }
.legal-ref { font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; word-break: normal; }
.legal-row { width: 100%; }

/* Footer */
.pub-foot { padding: 20px 24px; border-top: 1px solid var(--pb-border-soft); }
.pub-foot-inner { max-width: 832px; margin: 0 auto; font-size: 12.5px; color: var(--pb-text-3); }
.pub-foot a { color: var(--pb-text-2); }
.pub-foot a:hover { color: var(--pb-primary); }

@media (max-width: 767px) {
  .pub-shell { padding: 24px 16px 40px; gap: 16px; }
  .page-title { font-size: 24px !important; }
  .pub-shell :deep(.ant-card-head) { padding-inline: 14px; }
  .pub-shell :deep(.ant-card-body) { padding: 14px; }
  .pub-foot { padding: 18px 16px; }
  .pub-foot-inner { flex-direction: column; align-items: flex-start !important; }
}
</style>
