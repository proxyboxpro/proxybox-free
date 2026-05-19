<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Box, CheckCircle2, ShoppingCart, Network, Wallet, ArrowRight, X } from 'lucide-vue-next'
import { useI18n } from '../i18n'

const STORAGE_KEY = 'proxyhub.onboarding.dismissed'
const router = useRouter()
const { t } = useI18n()
const open = ref(false)
const step = ref(0)

const steps = [
  { icon: Box,          titleKey: 'onboard.s1.title', bodyKey: 'onboard.s1.body' },
  { icon: ShoppingCart, titleKey: 'onboard.s2.title', bodyKey: 'onboard.s2.body' },
  { icon: Network,      titleKey: 'onboard.s3.title', bodyKey: 'onboard.s3.body' },
  { icon: Wallet,       titleKey: 'onboard.s4.title', bodyKey: 'onboard.s4.body' }
]

function next() { if (step.value < steps.length - 1) step.value += 1; else dismiss() }
function dismiss() { localStorage.setItem(STORAGE_KEY, '1'); open.value = false }
function skip() { dismiss() }
function goBuy() { dismiss(); router.push({ name: 'buy' }) }

onMounted(() => {
  if (!localStorage.getItem(STORAGE_KEY)) open.value = true
})
</script>

<template>
  <div v-if="open" class="onb-backdrop">
    <article class="onb-card">
      <button type="button" class="close-btn" @click="skip"><X :size="16" /></button>
      <div class="onb-step">
        <component :is="steps[step].icon" :size="42" style="color: var(--blue)" />
        <h2>{{ t(steps[step].titleKey) }}</h2>
        <p>{{ t(steps[step].bodyKey) }}</p>
      </div>
      <div class="onb-dots">
        <span v-for="(s, i) in steps" :key="i" :class="{ active: i === step }"></span>
      </div>
      <div class="onb-actions">
        <button type="button" class="ghost-button" @click="skip">{{ t('onboard.skip') }}</button>
        <button v-if="step < steps.length - 1" type="button" class="primary-action" @click="next">
          {{ t('onboard.next') }} <ArrowRight :size="14" />
        </button>
        <button v-else type="button" class="primary-action" @click="goBuy">
          <CheckCircle2 :size="14" /> {{ t('onboard.start') }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.onb-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 99; display: flex; align-items: center; justify-content: center; padding: 20px; }
.onb-card { width: 460px; max-width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 32px 28px; position: relative; }
.close-btn { position: absolute; top: 12px; right: 12px; background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; }
.close-btn:hover { color: var(--text); }
.onb-step { text-align: center; padding: 12px 0 8px; }
.onb-step h2 { margin: 14px 0 8px; font-size: 22px; }
.onb-step p { color: var(--muted); line-height: 1.5; font-size: 14px; }
.onb-dots { display: flex; justify-content: center; gap: 6px; margin: 20px 0; }
.onb-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--border); transition: 0.2s; }
.onb-dots span.active { background: var(--blue); width: 24px; border-radius: 4px; }
.onb-actions { display: flex; gap: 10px; justify-content: flex-end; }
.onb-actions .primary-action { display: inline-flex; gap: 6px; align-items: center; }
</style>
