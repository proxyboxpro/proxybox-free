<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { Box, Activity, Server, CheckCircle, AlertTriangle } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { publicStatus } from '../api'

const { t } = useI18n()
const status = ref(null)
const loading = ref(true)
let timer = null

async function load() {
  try { status.value = await publicStatus() } catch { status.value = null }
  loading.value = false
}
onMounted(() => { load(); timer = setInterval(load, 30_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

function fmtUptime(s) {
  if (!s) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h ${m}m` : (h > 0 ? `${h}h ${m}m` : `${m}m`)
}
</script>

<template>
  <main class="status-shell">
    <header class="status-header">
      <div class="logo-block"><span class="logo-mark"><Box :size="22" /></span><strong>ProxyBox</strong></div>
      <h1>{{ t('status.pageTitle') }}</h1>
      <p class="muted">{{ t('status.pageHelp') }}</p>
    </header>

    <div v-if="loading" class="empty-state">{{ t('status.loading') }}</div>
    <div v-else-if="!status" class="empty-state error-text">{{ t('status.unreachable') }}</div>
    <template v-else>
      <div class="banner" :class="status.maintenance ? 'warn' : 'ok'">
        <component :is="status.maintenance ? AlertTriangle : CheckCircle" :size="20" />
        <strong v-if="status.maintenance">{{ t('status.maintenance') }}</strong>
        <strong v-else>{{ t('status.allSystems') }}</strong>
      </div>

      <div class="metric-cards" style="margin-top:18px">
        <div class="metric-card">
          <span class="metric-label"><Activity :size="14" /> {{ t('status.uptime') }}</span>
          <strong>{{ fmtUptime(status.uptimeSeconds) }}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label"><Server :size="14" /> {{ t('status.nodesOnline') }}</span>
          <strong>{{ status.nodes.online }} / {{ status.nodes.total }}</strong>
          <span class="metric-foot" v-if="status.nodes.offline > 0">
            <AlertTriangle :size="11" /> {{ status.nodes.offline }} offline
          </span>
        </div>
        <div class="metric-card">
          <span class="metric-label">{{ t('status.activeProxies') }}</span>
          <strong>{{ status.proxies.toLocaleString() }}</strong>
        </div>
      </div>

      <section v-if="status.announcements && status.announcements.length" class="announcement-stack" style="margin-top:24px">
        <h3>{{ t('status.announcements') }}</h3>
        <div v-for="(a, i) in status.announcements" :key="i" class="ann-row" :class="`sev-${a.severity}`">
          <p>{{ a.text }}</p>
          <span class="muted">{{ a.createdAt?.slice(0, 16).replace('T', ' ') }}</span>
        </div>
      </section>
    </template>

    <footer class="status-foot">
      <a href="/">← Quay về ProxyBox</a>
    </footer>
  </main>
</template>

<style scoped>
.status-shell { max-width: 880px; margin: 40px auto; padding: 24px; }
.status-header { text-align: center; margin-bottom: 24px; }
.status-header h1 { margin: 12px 0 4px; font-size: 28px; }
.status-header .muted { color: var(--muted); font-size: 14px; }
.banner { display: flex; gap: 10px; align-items: center; padding: 16px 20px; border-radius: 10px; }
.banner.ok { background: rgba(16, 185, 129, 0.1); color: var(--green); }
.banner.warn { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
.empty-state { text-align: center; padding: 40px; color: var(--muted); }
.ann-row { padding: 12px 14px; background: var(--surface-2); border-radius: 8px; margin: 8px 0; }
.ann-row.sev-warning { border-left: 3px solid #f59e0b; }
.ann-row.sev-error { border-left: 3px solid var(--red); }
.ann-row.sev-info { border-left: 3px solid var(--blue); }
.ann-row.sev-success { border-left: 3px solid var(--green); }
.ann-row p { margin: 0 0 4px; }
.ann-row .muted { font-size: 11px; color: var(--muted); }
.status-foot { text-align: center; margin-top: 32px; }
.status-foot a { color: var(--blue); text-decoration: none; font-size: 13px; }
</style>
