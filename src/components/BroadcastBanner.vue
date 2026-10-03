<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from '../i18n'

const { t } = useI18n()
const features = ref(null)
const announcements = ref([])
const dismissed = ref(new Set(readDismissed()))

function readDismissed() {
  try { return JSON.parse(localStorage.getItem('proxyhub.dismissed') || '[]') } catch { return [] }
}

async function load() {
  // Public endpoints — no auth header needed. Failures are silent (banner hides).
  try {
    const r = await fetch('/api/public/features')
    if (r.ok) features.value = await r.json()
  } catch { /* offline */ }
  try {
    const r = await fetch('/api/public/announcements')
    if (r.ok) announcements.value = await r.json()
  } catch { /* offline */ }
}

const visibleAnn = computed(() => announcements.value.filter((a) => !dismissed.value.has(a.id)))
const maintenance = computed(() => !!features.value?.maintenance)

function dismiss(id) {
  const next = new Set(dismissed.value)
  next.add(id)
  dismissed.value = next
  try { localStorage.setItem('proxyhub.dismissed', JSON.stringify([...next])) } catch { /* ignore */ }
}

function alertType(sev) {
  return ['error', 'warning', 'success'].includes(sev) ? sev : 'info'
}

// poll every 60s for fresh maintenance/announcements without page reload
let intv = null
onMounted(() => { load(); intv = setInterval(load, 60_000) })
onUnmounted(() => { if (intv) clearInterval(intv) })
</script>

<template>
  <div v-if="maintenance || visibleAnn.length" class="broadcast-stack">
    <a-alert v-if="maintenance" type="warning" show-icon>
      <template #icon><ToolOutlined /></template>
      <template #message>
        <strong class="broadcast-label">{{ t('broadcast.maintenanceLabel') }}</strong>
        {{ t('broadcast.maintenance') }}
      </template>
    </a-alert>
    <a-alert
      v-for="a in visibleAnn" :key="a.id"
      :type="alertType(a.severity)"
      :message="a.text"
      show-icon
      :closable="a.dismissible !== false"
      @close="dismiss(a.id)"
    />
  </div>
</template>

<style scoped>
.broadcast-stack { display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 0; }
.broadcast-label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; margin-inline-end: 8px; }
@media (max-width: 575px) { .broadcast-stack { padding: 8px 12px 0; } }
</style>
