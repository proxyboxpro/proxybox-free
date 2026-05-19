<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Check, CheckCheck, X } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { token } from '../api'
import { listNotifications, markNotificationRead, markAllNotificationsRead, clearNotifications } from '../api'

const router = useRouter()
const { t } = useI18n()
const items = ref([])
const unread = ref(0)
const open = ref(false)
let timer = null

async function load() {
  if (!token.value) { items.value = []; unread.value = 0; return }
  try {
    const r = await listNotifications()
    items.value = r.items || []
    unread.value = r.unread || 0
  } catch { /* silent */ }
}
async function readOne(n) {
  if (!n.read) { try { await markNotificationRead(n.id); n.read = true; unread.value = Math.max(0, unread.value - 1) } catch {} }
  if (n.link) router.push(n.link)
  open.value = false
}
async function readAll() {
  try { await markAllNotificationsRead(); items.value.forEach((n) => { n.read = true }); unread.value = 0 } catch {}
}
async function clearAll() {
  if (!confirm(t('notif.clearConfirm'))) return
  try { await clearNotifications(); items.value = []; unread.value = 0 } catch {}
}
function timeAgo(iso) {
  const t = new Date(iso).getTime(); if (!t) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

onMounted(() => { load(); timer = setInterval(load, 30_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="notif-bell">
    <button type="button" class="bell-btn" :aria-label="t('notif.title')" @click="open = !open">
      <Bell :size="18" />
      <span v-if="unread > 0" class="badge">{{ unread > 99 ? '99+' : unread }}</span>
    </button>
    <div v-if="open" class="bell-backdrop" @click="open = false"></div>
    <div v-if="open" class="bell-panel" @click.stop>
      <header>
        <strong>{{ t('notif.title') }}</strong>
        <div class="bell-actions">
          <button v-if="unread > 0" type="button" class="ghost-button mini" @click="readAll">
            <CheckCheck :size="13" /> {{ t('notif.readAll') }}
          </button>
          <button v-if="items.length > 0" type="button" class="ghost-button mini" @click="clearAll">
            <X :size="13" /> {{ t('notif.clear') }}
          </button>
        </div>
      </header>
      <div class="bell-list">
        <div v-if="items.length === 0" class="bell-empty">{{ t('notif.empty') }}</div>
        <button v-for="n in items" :key="n.id" type="button" class="bell-item" :class="{ unread: !n.read }" @click="readOne(n)">
          <span class="dot" :class="`sev-${n.severity}`"></span>
          <div class="bell-body">
            <p>{{ n.text }}</p>
            <span class="muted">{{ timeAgo(n.createdAt) }} {{ t('notif.ago') }}</span>
          </div>
          <Check v-if="!n.read" :size="12" class="unread-mark" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notif-bell { position: relative; }
.bell-btn { background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 8px; cursor: pointer; position: relative; display: inline-flex; align-items: center; }
.bell-btn:hover { background: var(--surface-2); }
.badge { position: absolute; top: -4px; right: -4px; background: #ef4444; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 8px; font-weight: 700; }
.bell-backdrop { position: fixed; inset: 0; z-index: 80; background: transparent; }
.bell-panel { position: absolute; top: calc(100% + 6px); right: 0; width: 340px; max-height: 480px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 81; display: flex; flex-direction: column; }
.bell-panel header { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.bell-actions { display: flex; gap: 6px; }
.ghost-button.mini { padding: 4px 8px; font-size: 11px; }
.bell-list { overflow-y: auto; max-height: 380px; }
.bell-empty { padding: 32px 16px; text-align: center; color: var(--muted); font-size: 13px; }
.bell-item { width: 100%; background: transparent; border: none; padding: 10px 14px; display: flex; align-items: flex-start; gap: 10px; cursor: pointer; text-align: left; color: var(--text); border-bottom: 1px solid var(--border-soft); font: inherit; }
.bell-item:hover { background: var(--surface-2); }
.bell-item.unread { background: rgba(59, 130, 246, 0.08); }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
.dot.sev-info { background: var(--blue); }
.dot.sev-success { background: var(--green); }
.dot.sev-warning { background: #f59e0b; }
.dot.sev-error { background: var(--red); }
.bell-body { flex: 1; min-width: 0; }
.bell-body p { margin: 0; font-size: 13px; line-height: 1.4; }
.bell-body .muted { font-size: 11px; color: var(--muted); }
.unread-mark { color: var(--blue); margin-top: 4px; }
@media (max-width: 600px) { .bell-panel { width: 92vw; right: -8px; } }
</style>
