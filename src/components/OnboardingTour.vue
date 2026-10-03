<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CodeSandboxOutlined, ShoppingCartOutlined, ClusterOutlined, WalletOutlined } from '@ant-design/icons-vue'
import { useI18n } from '../i18n'

const STORAGE_KEY = 'proxyhub.onboarding.dismissed'
const router = useRouter()
const { t } = useI18n()
const open = ref(false)
const step = ref(0)

const steps = [
  { icon: CodeSandboxOutlined,  titleKey: 'onboard.s1.title', bodyKey: 'onboard.s1.body' },
  { icon: ShoppingCartOutlined, titleKey: 'onboard.s2.title', bodyKey: 'onboard.s2.body' },
  { icon: ClusterOutlined,      titleKey: 'onboard.s3.title', bodyKey: 'onboard.s3.body' },
  { icon: WalletOutlined,       titleKey: 'onboard.s4.title', bodyKey: 'onboard.s4.body' }
]

function dismiss() {
  try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  open.value = false
}
function next() { if (step.value < steps.length - 1) step.value += 1; else dismiss() }
function goBuy() { dismiss(); router.push({ name: 'buy' }) }

onMounted(() => {
  let seen = false
  try { seen = !!localStorage.getItem(STORAGE_KEY) } catch { /* ignore */ }
  if (!seen) open.value = true
})
</script>

<template>
  <a-modal :open="open" :footer="null" :width="480" centered @cancel="dismiss">
    <a-result :title="t(steps[step].titleKey)" :sub-title="t(steps[step].bodyKey)">
      <template #icon>
        <component :is="steps[step].icon" class="onb-icon" />
      </template>
      <template #extra>
        <a-steps :current="step" size="small" :items="steps.map(() => ({ title: '' }))" class="onb-steps" @change="(v) => (step = v)" />
        <a-space>
          <a-button @click="dismiss">{{ t('onboard.skip') }}</a-button>
          <a-button v-if="step < steps.length - 1" type="primary" @click="next">
            {{ t('onboard.next') }} <ArrowRightOutlined />
          </a-button>
          <a-button v-else type="primary" @click="goBuy">
            <template #icon><CheckCircleOutlined /></template>
            {{ t('onboard.start') }}
          </a-button>
        </a-space>
      </template>
    </a-result>
  </a-modal>
</template>

<style scoped>
.onb-icon { font-size: 56px; color: var(--pb-primary); }
.onb-steps { margin-bottom: 20px; }
</style>
