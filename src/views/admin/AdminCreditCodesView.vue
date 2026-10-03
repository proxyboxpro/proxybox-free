<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch, token } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'

const { t } = useI18n()
const codes = ref([])
const form = ref({ code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' })
const batch = ref({ count: 10, prefix: 'PROMO', amount: 50000, productGroup: 'ipv6', validUntil: '', usageLimit: 1 })
const stats = ref(null)
const err = ref('')
const busy = ref(false)
const loading = ref(false)

const groups = computed(() => [
  { id: 'all',  label: t('admin.cc.groupAll') },
  { id: 'ipv4', label: t('admin.cc.groupIpv4') },
  { id: 'ipv6', label: t('admin.cc.groupIpv6') },
  { id: 'hub',  label: t('admin.cc.groupHub') }
])
const groupOptions = computed(() => groups.value.map((g) => ({ value: g.id, label: g.label })))
function groupLabel(g) { return (groups.value.find((x) => x.id === g) || groups.value[0]).label }
function fmt(n) { return Number(n || 0).toLocaleString('vi-VN') }
function usedCount(c) { return Array.isArray(c.redeemedBy) ? c.redeemedBy.length : (c.usageCount || 0) }

const columns = computed(() => [
  { key: 'code', title: t('admin.cc.colCode') },
  { key: 'amount', title: t('admin.cc.colAmount'), align: 'right' },
  { key: 'group', title: t('admin.cc.colGroup') },
  { key: 'expiry', title: t('admin.cc.colExpiry') },
  { key: 'used', title: t('admin.cc.colUsed'), align: 'right' },
  { key: 'status', title: t('admin.cc.colStatus') },
  { key: 'actions', width: 210, fixed: 'right' }
])

async function refresh() {
  err.value = ''
  loading.value = true
  try { codes.value = await apiFetch('/api/admin/credit-codes') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function addCode() {
  if (busy.value) return
  busy.value = true
  try {
    const c = await apiFetch('/api/admin/credit-codes', { method: 'POST', body: { ...form.value, validUntil: form.value.validUntil || '' } })
    codes.value.unshift(c)
    message.success(t('admin.cc.created', { code: c.code, amount: fmt(c.amount), currency: c.currency }))
    form.value = { code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' }
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}
async function addBatch() {
  if (busy.value) return
  busy.value = true
  try {
    const r = await apiFetch('/api/admin/credit-codes/batch', { method: 'POST', body: { ...batch.value, validUntil: batch.value.validUntil || '' } })
    message.success(t('admin.cc.batchCreated', { n: r.created }))
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}
async function exportCsv() {
  try {
    const res = await fetch('/api/admin/credit-codes/export', { headers: { Authorization: `Bearer ${token.value}` } })
    if (!res.ok) throw new Error('export failed')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'credit-codes.csv'; a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) { message.error(e.message) }
}
async function viewStats(code) {
  try { stats.value = await apiFetch(`/api/admin/credit-codes/${code}/analytics`) }
  catch (e) { message.error(e.message) }
}
async function toggleCode(c) {
  try { const u = await apiFetch(`/api/admin/credit-codes/${c.code}`, { method: 'PATCH', body: { enabled: !c.enabled } }); c.enabled = u.enabled }
  catch (e) { message.error(e.message) }
}
async function deleteCode(code) {
  if (!(await confirmAsync({ title: t('admin.cc.confirmDel', { code }), danger: true }))) return
  try { await apiFetch(`/api/admin/credit-codes/${code}`, { method: 'DELETE' }); codes.value = codes.value.filter((c) => c.code !== code) }
  catch (e) { message.error(e.message) }
}
onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.cc.eyebrow') }} ({{ codes.length }})</a-typography-text>
      <a-space wrap>
        <a-button @click="exportCsv">
          <template #icon><DownloadOutlined /></template>
          {{ t('admin.cc.exportCsv') }}
        </a-button>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.common.refresh') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-alert type="info" show-icon>
      <!-- eslint-disable-next-line vue/no-v-html -- trusted i18n dictionary HTML -->
      <template #message><span v-html="t('admin.cc.intro')"></span></template>
    </a-alert>
    <a-alert v-if="err" type="error" show-icon :message="err" />

    <a-card v-if="stats" size="small" :title="t('admin.cc.statsTitle', { code: stats.code })">
      <template #extra>
        <a-button size="small" type="text" @click="stats = null">
          <template #icon><CloseOutlined /></template>
          {{ t('admin.common.close') }}
        </a-button>
      </template>
      <a-row :gutter="[16, 16]">
        <a-col :xs="12" :sm="8" :lg="5">
          <a-statistic :title="t('admin.cc.statsRedeemed')" :value="`${stats.redeemed}/${stats.usageLimit || '∞'}`" />
        </a-col>
        <a-col :xs="12" :sm="8" :lg="5">
          <a-statistic :title="t('admin.cc.statsGranted')" :value="fmt(stats.granted)" class="mono-stat" />
        </a-col>
        <a-col :xs="12" :sm="8" :lg="5">
          <a-statistic :title="t('admin.cc.statsSpent')" :value="fmt(stats.spent)" :value-style="{ color: 'var(--pb-success)' }" class="mono-stat" />
        </a-col>
        <a-col :xs="12" :sm="12" :lg="5">
          <a-statistic :title="t('admin.cc.statsRemaining')" :value="fmt(stats.remaining)" class="mono-stat" />
        </a-col>
        <a-col :xs="24" :sm="12" :lg="4">
          <a-statistic :title="t('admin.cc.statsGroup')" :value="groupLabel(stats.group)" />
        </a-col>
      </a-row>
    </a-card>

    <a-card :title="t('admin.cc.listTitle')" :body-style="{ padding: 0 }">
      <a-table
        :columns="columns"
        :data-source="codes"
        :loading="loading"
        row-key="code"
        size="middle"
        :scroll="{ x: 860 }"
        :pagination="{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }"
        :locale="{ emptyText: t('admin.cc.empty') }"
      >
        <template #bodyCell="{ column, record: c }">
          <template v-if="column.key === 'code'">
            <a-typography-text :copyable="{ text: c.code }" class="mono" strong>{{ c.code }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'amount'">
            <a-typography-text type="success" class="mono nowrap">+{{ fmt(c.amount) }} {{ c.currency }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'group'">
            <a-tag :bordered="false">{{ groupLabel(c.productGroup) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'expiry'">
            <span class="mono nowrap">{{ c.validUntil || '∞' }}</span>
          </template>
          <template v-else-if="column.key === 'used'">
            <span class="mono">{{ usedCount(c) }}/{{ c.usageLimit || '∞' }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="c.enabled === false ? 'error' : 'success'" :bordered="false">
              {{ c.enabled === false ? t('admin.cc.statusOff') : t('admin.cc.statusOn') }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space :size="4">
              <a-button size="small" @click="viewStats(c.code)">
                <template #icon><BarChartOutlined /></template>
                {{ t('admin.cc.btnStats') }}
              </a-button>
              <a-button size="small" @click="toggleCode(c)">{{ c.enabled === false ? t('admin.cc.statusOn') : t('admin.cc.statusOff') }}</a-button>
              <a-button size="small" danger @click="deleteCode(c.code)">
                <template #icon><DeleteOutlined /></template>
                {{ t('admin.cc.btnDel') }}
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :xl="12">
        <a-card :title="t('admin.cc.createTitle')" class="full-height">
          <a-form layout="vertical" :model="form" @finish="addCode">
            <a-row :gutter="16">
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldCode')">
                  <a-input v-model:value="form.code" placeholder="WELCOME50" class="mono" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldAmount')">
                  <a-input-number v-model:value="form.amount" :min="1000" :step="1000" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldGroup')">
                  <a-select v-model:value="form.productGroup" :options="groupOptions" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldExpiry')">
                  <a-date-picker v-model:value="form.validUntil" value-format="YYYY-MM-DD" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldUsageLimit')">
                  <a-input-number v-model:value="form.usageLimit" :min="0" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldNote')">
                  <a-input v-model:value="form.note" :placeholder="t('admin.cc.notePh')" />
                </a-form-item>
              </a-col>
            </a-row>
            <a-button type="primary" html-type="submit" :loading="busy">{{ t('admin.cc.btnCreate') }}</a-button>
          </a-form>
        </a-card>
      </a-col>

      <a-col :xs="24" :xl="12">
        <a-card :title="t('admin.cc.batchTitle')" class="full-height">
          <a-typography-paragraph type="secondary">{{ t('admin.cc.batchHint') }}</a-typography-paragraph>
          <a-form layout="vertical" :model="batch" @finish="addBatch">
            <a-row :gutter="16">
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldBatchCount')">
                  <a-input-number v-model:value="batch.count" :min="1" :max="500" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldPrefix')">
                  <a-input v-model:value="batch.prefix" placeholder="PROMO" class="mono" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldBatchAmount')">
                  <a-input-number v-model:value="batch.amount" :min="1000" :step="1000" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldGroup')">
                  <a-select v-model:value="batch.productGroup" :options="groupOptions" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldBatchExpiry')">
                  <a-date-picker v-model:value="batch.validUntil" value-format="YYYY-MM-DD" class="full-width" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :sm="12">
                <a-form-item :label="t('admin.cc.fieldBatchUsage')">
                  <a-input-number v-model:value="batch.usageLimit" :min="1" class="full-width" />
                </a-form-item>
              </a-col>
            </a-row>
            <a-button type="primary" html-type="submit" :loading="busy">{{ t('admin.cc.btnBatch', { n: batch.count }) }}</a-button>
          </a-form>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.full-height { height: 100%; }
.mono-stat :deep(.ant-statistic-content) { font-family: var(--pb-mono); }
</style>
