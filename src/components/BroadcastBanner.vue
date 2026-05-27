<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Wrench, X } from 'lucide-vue-next'
import { useI18n } from '../i18n'

const { t } = useI18n()
const features = ref(null)
const announcements = ref([])
const dismissed = ref(new Set(JSON.parse(localStorage.getItem('proxyhub.dismissed') || '[]')))

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

function iconOf(sev) {
  if (sev === 'error') return AlertOctagon
  if (sev === 'warning') return AlertTriangle
  if (sev === 'success') return CheckCircle2
  return Info
}
function bgOf(sev) {
  if (sev === 'error')   return 'var(--red-soft)'
  if (sev === 'warning') return 'var(--yellow-soft)'
  if (sev === 'success') return 'var(--green-soft)'
  return 'var(--blue-soft)'
}
function colorOf(sev) {
  if (sev === 'error')   return 'var(--red)'
  if (sev === 'warning') return 'var(--yellow)'
  if (sev === 'success') return 'var(--green)'
  return 'var(--blue)'
}

onMounted(load)
// poll every 60s for fresh maintenance/announcements without page reload
let intv = null
onMounted(() => { intv = setInterval(load, 60_000) })
import { onUnmounted } from 'vue'
onUnmounted(() => { if (intv) clearInterval(intv) })
</script>

<template>
  <div v-if="maintenance || visibleAnn.length" class="broadcast-stack">
    <div v-if="maintenance" class="broadcast-row" style="background: var(--yellow-soft); border-color: var(--yellow); color: var(--yellow)">
      <Wrench :size="16" />
      <strong style="text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px">{{ t('broadcast.maintenanceLabel') }}</strong>
      <span style="color: var(--text); font-size: 13px">{{ t('broadcast.maintenance') }}</span>
    </div>
    <div
      v-for="a in visibleAnn" :key="a.id"
      class="broadcast-row"
      :style="{ background: bgOf(a.severity), borderColor: colorOf(a.severity), color: colorOf(a.severity) }"
    >
      <component :is="iconOf(a.severity)" :size="16" />
      <span style="color: var(--text); font-size: 13px; flex: 1">{{ a.text }}</span>
      <button v-if="a.dismissible !== false" class="broadcast-x" type="button" :aria-label="'Dismiss'" @click="dismiss(a.id)">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.broadcast-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 22px;
  border-bottom: 1px solid var(--border-soft);
}
.broadcast-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 1px solid;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.broadcast-x {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  opacity: 0.6;
  border-radius: 4px;
  display: grid;
  place-items: center;
}
.broadcast-x:hover { opacity: 1; background: rgba(255,255,255,0.06); }
@media (max-width: 720px) {
  .broadcast-stack { padding: 6px 12px; }
  .broadcast-row { padding: 8px 10px; font-size: 12px; }
}
</style>
