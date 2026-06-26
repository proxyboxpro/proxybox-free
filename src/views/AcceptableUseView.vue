<script setup>
import { computed } from 'vue'
import { ShieldCheck, AlertTriangle, Scale, FileText, Mail, Lock, Gavel, Info } from 'lucide-vue-next'
import PublicTopNav from '../components/PublicTopNav.vue'
import { useI18n } from '../i18n'
import { aup, AUP_VERSION } from '../data/aup.js'

const { t, locale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const doc = computed(() => aup[locale.value] || aup.vi)
</script>

<template>
  <div class="aup-page">
    <PublicTopNav :subLabel="locale === 'vi' ? 'Chính sách' : 'Policy'" />

    <section class="aup">
      <header class="aup-head">
        <p class="eyebrow"><ShieldCheck :size="13" /> {{ doc.eyebrow }}</p>
        <h1>{{ doc.title }}</h1>
        <p class="sub">{{ doc.subtitle }}</p>
        <p class="updated">{{ doc.updatedLabel }} {{ AUP_VERSION }}</p>
      </header>

      <div class="aup-lead">
        <p v-for="(p, i) in doc.lead" :key="i">{{ p }}</p>
      </div>

      <div class="aup-block danger">
        <h2><AlertTriangle :size="18" /> {{ doc.prohibitedHeading }}</h2>
        <ul class="prohibited">
          <li v-for="(it, i) in doc.prohibited" :key="i">
            <div class="ph-top">
              <strong>{{ it.category }}</strong>
              <em v-if="it.legalRef" class="ref">{{ it.legalRef }}</em>
            </div>
            <span>{{ it.detail }}</span>
          </li>
        </ul>
      </div>

      <div class="aup-block">
        <h2><Scale :size="18" /> {{ doc.legalHeading }}</h2>
        <div class="legal-table">
          <div class="lt-row" v-for="(l, i) in doc.legalBasis" :key="i">
            <div class="lt-inst">
              <strong>{{ l.instrument }}</strong>
              <code>{{ l.citation }}</code>
            </div>
            <div class="lt-req">{{ l.requires }}</div>
          </div>
        </div>
      </div>

      <div class="aup-block">
        <h2><FileText :size="18" /> {{ doc.obligationsHeading }}</h2>
        <ul class="bullet"><li v-for="(o, i) in doc.obligations" :key="i">{{ o }}</li></ul>
      </div>

      <div class="aup-block">
        <h2><Lock :size="18" /> {{ doc.privacyHeading }}</h2>
        <p v-for="(p, i) in doc.privacy" :key="i">{{ p }}</p>
      </div>

      <div class="aup-block">
        <h2><Gavel :size="18" /> {{ doc.enforcementHeading }}</h2>
        <p v-for="(p, i) in doc.enforcement" :key="i">{{ p }}</p>
      </div>

      <div class="aup-block">
        <h2><Mail :size="18" /> {{ doc.abuseHeading }}</h2>
        <p v-for="(p, i) in doc.abuse" :key="i" v-html="p"></p>
      </div>

      <div class="aup-block">
        <h2><Info :size="18" /> {{ doc.disclaimerHeading }}</h2>
        <p v-for="(p, i) in doc.disclaimer" :key="i">{{ p }}</p>
      </div>

      <div class="aup-block">
        <h2><Scale :size="18" /> {{ doc.lawHeading }}</h2>
        <p v-for="(p, i) in doc.law" :key="i">{{ p }}</p>
      </div>

      <footer class="aup-foot">
        <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
        <span class="aup-foot-links">
          <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
          <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink> ·
          <RouterLink to="/">{{ locale === 'vi' ? 'Trang chủ' : 'Home' }}</RouterLink>
        </span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.aup-page {
  min-height: 100vh;
  background:
    radial-gradient(900px 500px at 90% -10%, rgba(88,166,255,0.06), transparent 65%),
    radial-gradient(700px 400px at -5% 30%, rgba(63,185,80,0.05), transparent 65%),
    var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.aup-page * { box-sizing: border-box; }
.aup-page a { color: inherit; text-decoration: none; }

.aup {
  max-width: 880px; margin: 0 auto;
  padding: 32px 24px 64px;
  display: flex; flex-direction: column; gap: 24px;
}

.aup-head .eyebrow {
  color: var(--green); font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 5px; margin: 0 0 6px;
}
.aup-head h1 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -0.4px; }
.aup-head .sub { margin: 8px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
.aup-head .updated { margin: 6px 0 0; color: var(--dim); font-size: 12px; }

.aup-lead p { margin: 0 0 12px; color: var(--muted); font-size: 14.5px; line-height: 1.7; }

.aup-block {
  background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: var(--radius); padding: 18px 20px;
}
.aup-block.danger { border-color: color-mix(in srgb, var(--red) 35%, var(--border-soft)); }
.aup-block h2 {
  margin: 0 0 12px; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; gap: 8px;
}
.aup-block.danger h2 { color: var(--red); }
.aup-block p { margin: 0 0 10px; color: var(--muted); font-size: 14px; line-height: 1.7; }
.aup-block p:last-child { margin-bottom: 0; }
.aup-block :deep(a) { color: var(--green); }
.aup-block :deep(a:hover) { text-decoration: underline; }

.prohibited { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.prohibited li {
  padding: 12px 14px; border: 1px solid var(--border-soft); border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.ph-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ph-top strong { color: var(--text); font-size: 14px; }
.prohibited .ref {
  font-family: var(--mono); font-size: 11px; color: var(--dim);
  font-style: normal; white-space: nowrap;
}
.prohibited span { display: block; margin-top: 5px; color: var(--muted); font-size: 13.5px; line-height: 1.6; }

.legal-table { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--border-soft); border-radius: var(--radius-sm); overflow: hidden; }
.lt-row { display: grid; grid-template-columns: 0.9fr 1.4fr; gap: 14px; padding: 12px 14px; }
.lt-row:not(:last-child) { border-bottom: 1px solid var(--border-soft); }
.lt-inst { display: flex; flex-direction: column; gap: 4px; }
.lt-inst strong { color: var(--text); font-size: 13.5px; }
.lt-inst code { font-family: var(--mono); font-size: 11.5px; color: var(--blue); }
.lt-req { color: var(--muted); font-size: 13.5px; line-height: 1.6; }

.bullet { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }
.bullet li { color: var(--muted); font-size: 14px; line-height: 1.6; }

.aup-foot {
  margin-top: 6px; padding-top: 18px; border-top: 1px solid var(--border-soft);
  display: flex; flex-direction: column; gap: 8px;
  color: var(--dim); font-size: 12.5px;
}
.aup-foot-links a { color: var(--muted); }
.aup-foot-links a:hover { color: var(--text); }

@media (max-width: 640px) {
  .aup { padding: 24px 16px 48px; }
  .aup-head h1 { font-size: 24px; }
  .lt-row { grid-template-columns: 1fr; gap: 6px; }
}
</style>
