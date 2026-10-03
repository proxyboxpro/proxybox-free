<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { profile } from '../store/profile'
import { confirmAsync } from '../ui/feedback'

const { t } = useI18n()

// ── HUBFREE: one-click self-upgrade ────────────────────────────────────────
// Calls /api/admin/system/upgrade which spawns a detached bash that git-pulls,
// rebuilds, and `systemctl restart proxyhub`. The HTTP response returns
// immediately; the service restart happens 30-90s later. UI polls
// /api/admin/system/upgrade/log to show progress.
const systemInfo = ref(null)
const upgrading = ref(false)
const upgradeLog = ref('')
const upgradeErr = ref('')
const upgradeFlash = ref('')
let pollHandle = null
let giveUpHandle = null

async function loadVersion() {
  try { systemInfo.value = await apiFetch('/api/admin/system/version'); upgradeErr.value = '' }
  catch (e) { upgradeErr.value = e.message }
}
async function refreshLog() {
  try { const r = await apiFetch('/api/admin/system/upgrade/log'); upgradeLog.value = r.log || '' }
  catch { /* tolerate transient failures during restart */ }
}
async function startUpgrade() {
  if (upgrading.value) return
  const ok = await confirmAsync({
    title: 'Nâng cấp ProxyBox lên phiên bản mới nhất?',
    content: 'Quá trình mất ~1 phút và sẽ restart service. Truy cập của customer trên proxy KHÔNG bị ảnh hưởng (agent giữ kết nối tới listener). Admin panel sẽ mất kết nối trong ~30 giây.',
    type: 'warning'
  })
  if (!ok) return
  upgrading.value = true; upgradeErr.value = ''; upgradeFlash.value = ''
  try {
    const r = await apiFetch('/api/admin/system/upgrade', { method: 'POST' })
    upgradeFlash.value = r.hint || 'Đang nâng cấp…'
    // Poll log every 5s until service comes back. The fetch will fail during
    // restart window — keep retrying until it succeeds + log shows "done".
    pollHandle = setInterval(async () => {
      await refreshLog()
      if (upgradeLog.value.includes('[upgrade] done')) {
        clearInterval(pollHandle); pollHandle = null
        upgrading.value = false
        upgradeFlash.value = 'Nâng cấp xong. Reload trang để dùng phiên bản mới.'
        loadVersion()
      }
    }, 5000)
    // Auto-give-up after 5 min so the UI doesn't hang forever if something deadlocks.
    giveUpHandle = setTimeout(() => {
      if (upgrading.value) {
        clearInterval(pollHandle); pollHandle = null
        upgrading.value = false
        upgradeErr.value = 'Upgrade chạy quá 5 phút — kiểm tra log thủ công.'
      }
    }, 5 * 60_000)
  } catch (e) { upgradeErr.value = e.message; upgrading.value = false }
}

onMounted(() => { loadVersion() })
onBeforeUnmount(() => {
  if (pollHandle) clearInterval(pollHandle)
  if (giveUpHandle) clearTimeout(giveUpHandle)
})
</script>

<template>
  <div class="page">
    <!-- ── System upgrade (HUBFREE-only) ──────────────────────────────── -->
    <a-card v-if="systemInfo" title="System">
      <template #extra><CloudDownloadOutlined /></template>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 4 }">
        <a-descriptions-item label="Version"><span class="mono">v{{ systemInfo.version }}</span></a-descriptions-item>
        <a-descriptions-item v-if="systemInfo.gitRev" label="Git rev">
          <a-typography-text :copyable="{ text: systemInfo.gitRev }" class="mono">{{ systemInfo.gitRev }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="Node"><span class="mono">{{ systemInfo.node }}</span></a-descriptions-item>
        <a-descriptions-item label="Uptime"><span class="mono">{{ Math.floor(systemInfo.uptimeSec / 60) }}m</span></a-descriptions-item>
      </a-descriptions>

      <a-space wrap class="actions">
        <!-- Upgrade + its log are hidden when the server reports no self-upgrade endpoint (selfUpgrade: false). -->
        <a-button v-if="systemInfo.selfUpgrade !== false" type="primary" :loading="upgrading" @click="startUpgrade">
          <template #icon><CloudDownloadOutlined /></template>
          {{ upgrading ? 'Đang nâng cấp…' : 'Nâng cấp lên phiên bản mới' }}
        </a-button>
        <a-button v-if="systemInfo.selfUpgrade !== false" @click="refreshLog">
          <template #icon><CodeOutlined /></template>
          Xem log
        </a-button>
        <a-button @click="loadVersion">
          <template #icon><ReloadOutlined /></template>
          Reload
        </a-button>
      </a-space>

      <a-alert v-if="upgradeFlash" type="success" show-icon :message="upgradeFlash" class="msg" />
      <a-alert v-if="upgradeErr" type="error" show-icon :message="upgradeErr" class="msg" />
      <a-typography-paragraph v-if="upgradeLog" class="log-wrap">
        <pre class="mono log">{{ upgradeLog }}</pre>
      </a-typography-paragraph>
    </a-card>
    <a-alert v-else-if="upgradeErr" type="error" show-icon :message="upgradeErr" />

    <!-- ── Existing security toggles ──────────────────────────────────── -->
    <a-card :title="t('settings.security')">
      <template #extra><LockOutlined /></template>
      <a-list item-layout="horizontal">
        <a-list-item>
          <a-list-item-meta :title="t('settings.2fa')" :description="t('settings.2faHelp')" />
          <a-switch v-model:checked="profile.twoFactor" />
        </a-list-item>
        <a-list-item>
          <a-list-item-meta :title="t('settings.emailAlerts')" :description="t('settings.emailHelp')" />
          <a-switch v-model:checked="profile.emailAlerts" />
        </a-list-item>
        <a-list-item>
          <a-list-item-meta :title="t('settings.balanceAlerts')" :description="t('settings.balanceHelp')" />
          <a-switch v-model:checked="profile.lowBalanceAlerts" />
        </a-list-item>
      </a-list>
    </a-card>
  </div>
</template>

<style scoped>
.actions { margin-top: 16px; }
.msg { margin-top: 12px; }
.log-wrap { margin: 12px 0 0; }
.log { max-height: 280px; overflow: auto; white-space: pre-wrap; font-size: 11px; margin: 0; }
</style>
