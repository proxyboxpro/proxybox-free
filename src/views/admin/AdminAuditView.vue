<script setup>
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Download, Filter, RefreshCw, Search, Shield, ShieldAlert, User } from 'lucide-vue-next'
import { apiFetch, token } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const entries = ref([])
const filters = ref({ actor: '', path: '', ip: '', since: '', lines: 500, note: '' })
const err = ref('')
const quickFilter = ref('all')

async function refresh() {
  err.value = ''
  try {
    const qs = Object.entries(filters.value)
      .filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    const d = await apiFetch(`/api/admin/audit?${qs}`)
    entries.value = d.entries || []
  } catch (e) { err.value = e.message }
}
function clear() { filters.value = { actor: '', path: '', ip: '', since: '', lines: 500, note: '' }; quickFilter.value = 'all'; refresh() }

async function exportCsv() {
  try {
    const qs = []
    if (filters.value.actor) qs.push(`actor=${encodeURIComponent(filters.value.actor)}`)
    if (filters.value.path)  qs.push(`path=${encodeURIComponent(filters.value.path)}`)
    if (filters.value.since) qs.push(`since=${encodeURIComponent(filters.value.since)}`)
    const r = await fetch(`/api/admin/audit/export?${qs.join('&')}`, { headers: { Authorization: `Bearer ${token.value}` } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) { err.value = `Export failed: ${e.message}` }
}

function applyQuick(kind) {
  quickFilter.value = kind
  if (kind === 'all') {
    filters.value.path = ''; filters.value.note = ''
  } else if (kind === 'failedLogin') {
    filters.value.path = '/api/auth/login'; filters.value.note = 'bad creds'
  } else if (kind === 'totpFail') {
    filters.value.path = '/api/auth/login'; filters.value.note = 'bad totp'
  } else if (kind === 'lockout') {
    filters.value.path = '/api/auth/login'; filters.value.note = 'locked'
  } else if (kind === 'suspended') {
    filters.value.path = '/suspend'; filters.value.note = ''
  } else if (kind === 'adminOrders') {
    filters.value.path = '/api/admin/orders'; filters.value.note = ''
  }
  refresh()
}

// Reversed for display (newest first)
const display = computed(() => entries.value.slice().reverse())
const counts = computed(() => ({
  total: entries.value.length,
  failedLogin: entries.value.filter((e) => e.path === '/api/auth/login' && (e.status === 401 || /bad creds|bad totp/i.test(e.note || ''))).length,
  locked: entries.value.filter((e) => /locked|too many/i.test(e.note || '')).length,
  adminActions: entries.value.filter((e) => String(e.path || '').startsWith('/api/admin/')).length
}))

function sevColor(e) {
  if (e.status >= 500) return 'var(--red)'
  if (e.status >= 400) return 'var(--yellow)'
  return 'var(--muted)'
}

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Audit log ({{ entries.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="clear">{{ t('admin.audit.clearFilters') }}</button>
      <button class="ghost-button" type="button" @click="exportCsv"><Download :size="13" /> {{ t('admin.audit.exportCsv') }}</button>
      <button class="primary-action small" type="button" @click="refresh"><RefreshCw :size="13" /> {{ t('admin.audit.apply') }}</button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>

    <!-- KPI strip -->
    <div class="metric-cards" style="grid-template-columns: repeat(4, 1fr)">
      <article>
        <Shield :size="20" />
        <span>{{ t('admin.audit.totalEntries') }}</span>
        <strong>{{ counts.total }}</strong>
      </article>
      <article>
        <AlertTriangle :size="20" />
        <span>{{ t('admin.audit.failedLogins') }}</span>
        <strong style="color: var(--yellow)">{{ counts.failedLogin }}</strong>
      </article>
      <article>
        <ShieldAlert :size="20" />
        <span>{{ t('admin.audit.lockouts') }}</span>
        <strong style="color: var(--red)">{{ counts.locked }}</strong>
      </article>
      <article>
        <User :size="20" />
        <span>{{ t('admin.audit.adminActions') }}</span>
        <strong style="color: var(--green)">{{ counts.adminActions }}</strong>
      </article>
    </div>

    <!-- Quick filter chips -->
    <div class="surface">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap">
        <span class="eyebrow"><Filter :size="12" style="vertical-align:-2px" /> {{ t('admin.audit.quickFilter') }}</span>
        <div class="chips">
          <button :class="{ active: quickFilter === 'all' }" type="button" @click="applyQuick('all')">{{ t('admin.audit.qfAll') }}</button>
          <button :class="{ active: quickFilter === 'failedLogin' }" type="button" @click="applyQuick('failedLogin')">{{ t('admin.audit.qfFailedLogin') }}</button>
          <button :class="{ active: quickFilter === 'totpFail' }" type="button" @click="applyQuick('totpFail')">{{ t('admin.audit.qfTotpFail') }}</button>
          <button :class="{ active: quickFilter === 'lockout' }" type="button" @click="applyQuick('lockout')">{{ t('admin.audit.qfLockout') }}</button>
          <button :class="{ active: quickFilter === 'suspended' }" type="button" @click="applyQuick('suspended')">{{ t('admin.audit.qfSuspend') }}</button>
          <button :class="{ active: quickFilter === 'adminOrders' }" type="button" @click="applyQuick('adminOrders')">{{ t('admin.audit.qfAdminOrders') }}</button>
        </div>
      </div>

      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.audit.actor') }}</span><input v-model="filters.actor" placeholder="email@... / apiKey-prefix" /></label>
        <label class="input-field"><span>{{ t('admin.audit.path') }}</span><input v-model="filters.path" placeholder="/api/orders" /></label>
        <label class="input-field"><span>IP</span><input v-model="filters.ip" placeholder="103.x.x.x" /></label>
        <label class="input-field"><span>{{ t('admin.audit.note') }}</span><input v-model="filters.note" placeholder="bad creds / locked / suspended" /></label>
        <label class="input-field"><span>{{ t('admin.audit.since') }}</span><input v-model="filters.since" placeholder="2026-05-13T00:00:00Z" /></label>
        <label class="input-field"><span>{{ t('admin.audit.lines') }}</span><input v-model.number="filters.lines" type="number" min="10" max="5000" /></label>
      </div>
    </div>

    <!-- Entries -->
    <section v-if="display.length" class="surface" style="padding: 0">
      <div style="overflow-x: auto">
        <div class="data-table" style="min-width: 800px">
          <div class="table-row" style="grid-template-columns: 1.3fr 1.4fr 1fr 0.7fr 0.7fr 1.4fr 2fr; background: var(--surface-2); font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10.5px">
            <span>{{ t('admin.audit.ts') }}</span>
            <span>{{ t('admin.audit.actor') }}</span>
            <span>IP</span>
            <span>{{ t('admin.audit.method') }}</span>
            <span>{{ t('admin.audit.status') }}</span>
            <span>{{ t('admin.audit.path') }}</span>
            <span>{{ t('admin.audit.note') }}</span>
          </div>
          <div v-for="(e, i) in display" :key="i" class="table-row" style="grid-template-columns: 1.3fr 1.4fr 1fr 0.7fr 0.7fr 1.4fr 2fr">
            <span class="cell-mono" style="font-size: 12px">{{ (e.ts || '').slice(0, 19).replace('T', ' ') }}</span>
            <span class="cell-mono" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ e.actor }}</span>
            <span class="cell-mono" style="font-size: 12px">{{ e.ip }}</span>
            <span><span class="tag">{{ e.method }}</span></span>
            <span class="cell-mono" :style="{ color: sevColor(e), fontWeight: 600 }">{{ e.status || '—' }}</span>
            <span class="cell-mono" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ e.path }}</span>
            <span style="color: var(--muted); font-size: 12px">{{ e.note }}</span>
          </div>
        </div>
      </div>
    </section>
    <p v-else class="empty-text">{{ t('admin.audit.empty') }}</p>
  </section>
</template>
