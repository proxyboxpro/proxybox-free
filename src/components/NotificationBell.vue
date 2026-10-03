<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../i18n'
import { token, listNotifications, markNotificationRead, markAllNotificationsRead, clearNotifications } from '../api'
import { confirmAsync } from '../ui/feedback'

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
  if (!n.read) { try { await markNotificationRead(n.id); n.read = true; unread.value = Math.max(0, unread.value - 1) } catch { /* ignore */ } }
  if (n.link) router.push(n.link)
  open.value = false
}
async function readAll() {
  try { await markAllNotificationsRead(); items.value.forEach((n) => { n.read = true }); unread.value = 0 } catch { /* ignore */ }
}
async function clearAll() {
  open.value = false
  if (!(await confirmAsync({ title: t('notif.clearConfirm'), danger: true }))) return
  try { await clearNotifications(); items.value = []; unread.value = 0 } catch { /* ignore */ }
}
function timeAgo(iso) {
  const ts = new Date(iso).getTime(); if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
const SEV_STATUS = { info: 'processing', success: 'success', warning: 'warning', error: 'error' }

onMounted(() => { load(); timer = setInterval(load, 30_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <a-popover v-model:open="open" trigger="click" placement="bottomRight" :arrow="false" overlay-class-name="notif-popover">
    <template #title>
      <a-flex align="center" justify="space-between" gap="small">
        <span>{{ t('notif.title') }}</span>
        <a-space :size="4">
          <a-button v-if="unread > 0" size="small" type="link" @click="readAll">
            <template #icon><CheckOutlined /></template>
            {{ t('notif.readAll') }}
          </a-button>
          <a-button v-if="items.length > 0" size="small" type="link" danger @click="clearAll">
            <template #icon><DeleteOutlined /></template>
            {{ t('notif.clear') }}
          </a-button>
        </a-space>
      </a-flex>
    </template>
    <template #content>
      <div class="notif-list">
        <a-empty v-if="items.length === 0" :image="null" :description="t('notif.empty')" />
        <a-list v-else :data-source="items" size="small" item-layout="horizontal">
          <template #renderItem="{ item: n }">
            <a-list-item :class="['notif-item', { unread: !n.read }]" @click="readOne(n)">
              <a-list-item-meta>
                <template #avatar><a-badge :status="SEV_STATUS[n.severity] || 'default'" /></template>
                <template #title><span class="notif-text">{{ n.text }}</span></template>
                <template #description>{{ timeAgo(n.createdAt) }} {{ t('notif.ago') }}</template>
              </a-list-item-meta>
              <template v-if="!n.read" #extra><a-badge status="processing" /></template>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </template>
    <a-badge :count="unread" :overflow-count="99" size="small">
      <a-button shape="circle" :aria-label="t('notif.title')">
        <template #icon><BellOutlined /></template>
      </a-button>
    </a-badge>
  </a-popover>
</template>

<style>
.notif-popover { width: 360px; max-width: calc(100vw - 24px); }
.notif-popover .notif-list { max-height: 420px; overflow-y: auto; margin: 0 -12px; }
.notif-popover .notif-item { cursor: pointer; padding-inline: 12px !important; }
.notif-popover .notif-item:hover { background: var(--pb-surface-2); }
.notif-popover .notif-item.unread { background: rgba(59, 130, 246, 0.08); }
.notif-popover .notif-text { font-weight: 400; font-size: 13px; white-space: normal; }
</style>
