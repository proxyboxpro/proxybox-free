<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { apiFetch, token } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const entries = ref([])
const filters = ref({ actor: '', path: '', ip: '', since: '', lines: 500, note: '' })
const err = ref('')
const loading = ref(false)
const quickFilter = ref('all')

async function refresh() {
  err.value = ''
  loading.value = true
  pagination.current = 1
  try {
    const qs = Object.entries(filters.value)
      .filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    const d = await apiFetch(`/api/admin/audit?${qs}`)
    entries.value = d.entries || []
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
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
  } catch (e) { message.error(`Export failed: ${e.message}`) }
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

function statusType(e) {
  if (e.status >= 500) return 'danger'
  if (e.status >= 400) return 'warning'
  return 'secondary'
}

const quickOptions = computed(() => [
  { value: 'all', label: t('admin.audit.qfAll') },
  { value: 'failedLogin', label: t('admin.audit.qfFailedLogin') },
  { value: 'totpFail', label: t('admin.audit.qfTotpFail') },
  { value: 'lockout', label: t('admin.audit.qfLockout') },
  { value: 'suspended', label: t('admin.audit.qfSuspend') },
  { value: 'adminOrders', label: t('admin.audit.qfAdminOrders') }
])

const columns = computed(() => [
  { title: t('admin.audit.ts'), key: 'ts', dataIndex: 'ts', width: 170 },
  { title: t('admin.audit.actor'), key: 'actor', dataIndex: 'actor', width: 200, ellipsis: true },
  { title: 'IP', key: 'ip', dataIndex: 'ip', width: 140 },
  { title: t('admin.audit.method'), key: 'method', dataIndex: 'method', width: 90 },
  { title: t('admin.audit.status'), key: 'status', dataIndex: 'status', width: 80 },
  { title: t('admin.audit.path'), key: 'path', dataIndex: 'path', width: 220, ellipsis: true },
  { title: t('admin.audit.note'), key: 'note', dataIndex: 'note' }
])
const rows = computed(() => display.value.map((e, i) => ({ ...e, _k: i })))
const pagination = reactive({
  current: 1,
  pageSize: 50,
  showSizeChanger: true,
  pageSizeOptions: ['50', '100', '200', '500']
})
function onTableChange(p) {
  pagination.current = p.current
  pagination.pageSize = p.pageSize
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">Audit log ({{ entries.length }})</a-typography-text>
      <a-space wrap>
        <a-button @click="clear">
          <template #icon><ClearOutlined /></template>
          {{ t('admin.audit.clearFilters') }}
        </a-button>
        <a-button @click="exportCsv">
          <template #icon><DownloadOutlined /></template>
          {{ t('admin.audit.exportCsv') }}
        </a-button>
        <a-button type="primary" :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.audit.apply') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <!-- KPI strip -->
    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.audit.totalEntries')" :value="counts.total">
            <template #prefix><SafetyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.audit.failedLogins')" :value="counts.failedLogin" :value-style="{ color: 'var(--pb-warning)' }">
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.audit.lockouts')" :value="counts.locked" :value-style="{ color: 'var(--pb-error)' }">
            <template #prefix><LockOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :md="6">
        <a-card size="small">
          <a-statistic :title="t('admin.audit.adminActions')" :value="counts.adminActions" :value-style="{ color: 'var(--pb-success)' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Quick filter + filter form -->
    <a-card size="small">
      <template #title><FilterOutlined /> {{ t('admin.audit.quickFilter') }}</template>
      <div class="quick-scroll">
        <a-segmented :value="quickFilter" :options="quickOptions" @change="applyQuick" />
      </div>
      <a-form :model="filters" layout="vertical" class="filter-form">
        <a-row :gutter="[12, 0]">
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item :label="t('admin.audit.actor')" name="actor">
              <a-input v-model:value="filters.actor" allow-clear @press-enter="refresh" placeholder="email@... / apiKey-prefix" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item :label="t('admin.audit.path')" name="path">
              <a-input v-model:value="filters.path" allow-clear @press-enter="refresh" placeholder="/api/orders" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item label="IP" name="ip">
              <a-input v-model:value="filters.ip" allow-clear @press-enter="refresh" placeholder="103.x.x.x" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item :label="t('admin.audit.note')" name="note">
              <a-input v-model:value="filters.note" allow-clear @press-enter="refresh" placeholder="bad creds / locked / suspended" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item :label="t('admin.audit.since')" name="since">
              <a-input v-model:value="filters.since" allow-clear @press-enter="refresh" placeholder="2026-05-13T00:00:00Z" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-form-item :label="t('admin.audit.lines')" name="lines">
              <a-input-number v-model:value="filters.lines" :min="10" :max="5000" class="full-width" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-card>

    <!-- Entries -->
    <a-card size="small" :body-style="{ padding: 0 }">
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="_k"
        size="small"
        :scroll="{ x: 1000 }"
        :locale="{ emptyText: t('admin.audit.empty') }"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record: e }">
          <template v-if="column.key === 'ts'">
            <span class="mono">{{ (e.ts || '').slice(0, 19).replace('T', ' ') }}</span>
          </template>
          <template v-else-if="column.key === 'actor'">
            <a-tooltip :title="e.actor"><span class="mono">{{ e.actor }}</span></a-tooltip>
          </template>
          <template v-else-if="column.key === 'ip'">
            <span class="mono">{{ e.ip }}</span>
          </template>
          <template v-else-if="column.key === 'method'">
            <a-tag :bordered="false" class="mono">{{ e.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-typography-text :type="statusType(e)" strong class="mono">{{ e.status || '—' }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'path'">
            <a-tooltip :title="e.path"><span class="mono">{{ e.path }}</span></a-tooltip>
          </template>
          <template v-else-if="column.key === 'note'">
            <a-typography-text type="secondary">{{ e.note }}</a-typography-text>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.quick-scroll { overflow-x: auto; max-width: 100%; padding-bottom: 2px; }
.filter-form { margin-top: 16px; }
.filter-form :deep(.ant-form-item) { margin-bottom: 12px; }
</style>
