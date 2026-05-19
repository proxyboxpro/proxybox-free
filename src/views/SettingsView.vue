<script setup>
import { onMounted, ref } from 'vue'
import { Download, LockKeyhole, RefreshCw, Terminal } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { apiFetch } from '../api'
import { profile } from '../store/profile'

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

async function loadVersion() {
  try { systemInfo.value = await apiFetch('/api/admin/system/version') }
  catch (e) { upgradeErr.value = e.message }
}
async function refreshLog() {
  try { const r = await apiFetch('/api/admin/system/upgrade/log'); upgradeLog.value = r.log || '' }
  catch (e) { /* tolerate transient failures during restart */ }
}
async function startUpgrade() {
  if (upgrading.value) return
  if (!confirm('Nâng cấp ProxyBox lên phiên bản mới nhất?\n\nQuá trình mất ~1 phút và sẽ restart service. Truy cập của customer trên proxy KHÔNG bị ảnh hưởng (agent giữ kết nối tới listener). Admin panel sẽ mất kết nối trong ~30 giây.')) return
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
    setTimeout(() => {
      if (upgrading.value) {
        clearInterval(pollHandle); pollHandle = null
        upgrading.value = false
        upgradeErr.value = 'Upgrade chạy quá 5 phút — kiểm tra log thủ công.'
      }
    }, 5 * 60_000)
  } catch (e) { upgradeErr.value = e.message; upgrading.value = false }
}

onMounted(() => { loadVersion() })
</script>

<template>
  <section class="page-stack">
    <!-- ── System upgrade (HUBFREE-only) ──────────────────────────────── -->
    <section v-if="systemInfo" class="surface settings-list">
      <div class="section-head">
        <h2>System</h2>
        <Download :size="20" />
      </div>
      <div class="kv-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px 14px; padding:8px 0">
        <div><small>Version</small><strong class="cell-mono">v{{ systemInfo.version }}</strong></div>
        <div v-if="systemInfo.gitRev"><small>Git rev</small><strong class="cell-mono">{{ systemInfo.gitRev }}</strong></div>
        <div><small>Node</small><strong class="cell-mono">{{ systemInfo.node }}</strong></div>
        <div><small>Uptime</small><strong class="cell-mono">{{ Math.floor(systemInfo.uptimeSec / 60) }}m</strong></div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; padding:8px 0; align-items:center">
        <button class="primary-action" type="button" :disabled="upgrading" @click="startUpgrade">
          <RefreshCw :size="14" :class="{ spin: upgrading }" />
          {{ upgrading ? 'Đang nâng cấp…' : 'Nâng cấp lên phiên bản mới' }}
        </button>
        <button class="ghost-button" type="button" @click="refreshLog">
          <Terminal :size="12" /> Xem log
        </button>
        <button class="ghost-button" type="button" @click="loadVersion">
          <RefreshCw :size="12" /> Reload
        </button>
      </div>

      <p v-if="upgradeFlash" style="color:var(--green); font-size:13px; margin:6px 0 0">{{ upgradeFlash }}</p>
      <p v-if="upgradeErr" style="color:var(--red); font-size:13px; margin:6px 0 0">{{ upgradeErr }}</p>
      <pre v-if="upgradeLog" style="margin-top:10px; padding:10px 12px; background:#0a0e14; border:1px solid var(--border); border-radius:8px; font-family:var(--mono); font-size:11px; color:#9bb8b1; max-height:280px; overflow:auto; white-space:pre-wrap">{{ upgradeLog }}</pre>
    </section>

    <!-- ── Existing security toggles ──────────────────────────────────── -->
    <section class="surface settings-list">
      <div class="section-head">
        <h2>{{ t('settings.security') }}</h2>
        <LockKeyhole :size="20" />
      </div>
      <label class="switch-row">
        <span><strong>{{ t('settings.2fa') }}</strong><small>{{ t('settings.2faHelp') }}</small></span>
        <input v-model="profile.twoFactor" type="checkbox" />
      </label>
      <label class="switch-row">
        <span><strong>{{ t('settings.emailAlerts') }}</strong><small>{{ t('settings.emailHelp') }}</small></span>
        <input v-model="profile.emailAlerts" type="checkbox" />
      </label>
      <label class="switch-row">
        <span><strong>{{ t('settings.balanceAlerts') }}</strong><small>{{ t('settings.balanceHelp') }}</small></span>
        <input v-model="profile.lowBalanceAlerts" type="checkbox" />
      </label>
    </section>
  </section>
</template>

<style scoped>
.spin { animation: spin 1.2s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.kv-grid small { display: block; font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kv-grid strong { display: block; font-size: 13px; color: var(--text); margin-top: 2px; }
</style>
