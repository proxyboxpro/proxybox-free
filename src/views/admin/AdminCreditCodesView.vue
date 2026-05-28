<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch, token } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const codes = ref([])
const form = ref({ code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' })
const batch = ref({ count: 10, prefix: 'PROMO', amount: 50000, productGroup: 'ipv6', validUntil: '', usageLimit: 1 })
const stats = ref(null)
const err = ref(''); const flash = ref(''); const busy = ref(false)

const groups = computed(() => [
  { id: 'all',  label: t('admin.cc.groupAll') },
  { id: 'ipv4', label: t('admin.cc.groupIpv4') },
  { id: 'ipv6', label: t('admin.cc.groupIpv6') },
  { id: 'hub',  label: t('admin.cc.groupHub') }
])
function groupLabel(g) { return (groups.value.find((x) => x.id === g) || groups.value[0]).label }
function fmt(n) { return Number(n || 0).toLocaleString('vi-VN') }
function usedCount(c) { return Array.isArray(c.redeemedBy) ? c.redeemedBy.length : (c.usageCount || 0) }

async function refresh() {
  err.value = ''
  try { codes.value = await apiFetch('/api/admin/credit-codes') }
  catch (e) { err.value = e.message }
}
async function addCode() {
  if (busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const c = await apiFetch('/api/admin/credit-codes', { method: 'POST', body: form.value })
    codes.value.unshift(c)
    flash.value = t('admin.cc.created', { code: c.code, amount: fmt(c.amount), currency: c.currency })
    form.value = { code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' }
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}
async function addBatch() {
  if (busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    const r = await apiFetch('/api/admin/credit-codes/batch', { method: 'POST', body: batch.value })
    flash.value = t('admin.cc.batchCreated', { n: r.created })
    await refresh()
  } catch (e) { err.value = e.message }
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
  } catch (e) { err.value = e.message }
}
async function viewStats(code) {
  err.value = ''
  try { stats.value = await apiFetch(`/api/admin/credit-codes/${code}/analytics`) }
  catch (e) { err.value = e.message }
}
async function toggleCode(c) {
  try { const u = await apiFetch(`/api/admin/credit-codes/${c.code}`, { method: 'PATCH', body: { enabled: !c.enabled } }); c.enabled = u.enabled }
  catch (e) { err.value = e.message }
}
async function deleteCode(code) {
  if (!confirm(t('admin.cc.confirmDel', { code }))) return
  try { await apiFetch(`/api/admin/credit-codes/${code}`, { method: 'DELETE' }); codes.value = codes.value.filter((c) => c.code !== code) }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.cc.eyebrow') }} ({{ codes.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="exportCsv">{{ t('admin.cc.exportCsv') }}</button>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p style="color:var(--muted); font-size:12.5px; margin:-4px 0 0; max-width:760px" v-html="t('admin.cc.intro')">
    </p>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <div v-if="stats" class="surface" style="border-color:var(--green)">
      <div class="section-head"><h2>{{ t('admin.cc.statsTitle', { code: stats.code }) }}</h2><button class="ghost-button" type="button" style="margin-left:auto" @click="stats = null">{{ t('admin.common.close') }}</button></div>
      <div class="metric-grid" style="grid-template-columns: repeat(5, 1fr); gap:10px">
        <div><span class="desc-sub">{{ t('admin.cc.statsRedeemed') }}</span><strong>{{ stats.redeemed }}/{{ stats.usageLimit || '∞' }}</strong></div>
        <div><span class="desc-sub">{{ t('admin.cc.statsGranted') }}</span><strong class="cell-mono">{{ fmt(stats.granted) }}</strong></div>
        <div><span class="desc-sub">{{ t('admin.cc.statsSpent') }}</span><strong class="cell-mono" style="color:var(--green)">{{ fmt(stats.spent) }}</strong></div>
        <div><span class="desc-sub">{{ t('admin.cc.statsRemaining') }}</span><strong class="cell-mono">{{ fmt(stats.remaining) }}</strong></div>
        <div><span class="desc-sub">{{ t('admin.cc.statsGroup') }}</span><strong>{{ groupLabel(stats.group) }}</strong></div>
      </div>
    </div>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.cc.listTitle') }}</h2></div>
      <div v-if="codes.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.4fr 1.1fr 0.8fr 1fr 0.8fr 0.7fr auto auto auto">
          <span>{{ t('admin.cc.colCode') }}</span><span>{{ t('admin.cc.colAmount') }}</span><span>{{ t('admin.cc.colGroup') }}</span><span>{{ t('admin.cc.colExpiry') }}</span><span>{{ t('admin.cc.colUsed') }}</span><span>{{ t('admin.cc.colStatus') }}</span><span></span><span></span><span></span>
        </div>
        <div v-for="c in codes" :key="c.code" class="table-row" style="grid-template-columns: 1.4fr 1.1fr 0.8fr 1fr 0.8fr 0.7fr auto auto auto">
          <span class="cell-mono">{{ c.code }}</span>
          <span class="cell-mono" style="color:var(--green)">+{{ fmt(c.amount) }} {{ c.currency }}</span>
          <span><span class="tag-soft">{{ groupLabel(c.productGroup) }}</span></span>
          <span>{{ c.validUntil || '∞' }}</span>
          <span>{{ usedCount(c) }}/{{ c.usageLimit || '∞' }}</span>
          <span class="tag-soft" :style="{ color: c.enabled === false ? '#f87171' : 'var(--green)' }">{{ c.enabled === false ? t('admin.cc.statusOff') : t('admin.cc.statusOn') }}</span>
          <button class="ghost-button" type="button" @click="viewStats(c.code)">{{ t('admin.cc.btnStats') }}</button>
          <button class="ghost-button" type="button" @click="toggleCode(c)">{{ c.enabled === false ? t('admin.cc.statusOn') : t('admin.cc.statusOff') }}</button>
          <button class="ghost-button" type="button" @click="deleteCode(c.code)">{{ t('admin.cc.btnDel') }}</button>
        </div>
      </div>
      <p v-else class="empty-text">{{ t('admin.cc.empty') }}</p>
    </section>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.cc.createTitle') }}</h2></div>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.cc.fieldCode') }}</span><input v-model="form.code" placeholder="WELCOME50" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldAmount') }}</span><input v-model.number="form.amount" type="number" min="1000" step="1000" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldGroup') }}</span>
          <select v-model="form.productGroup"><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.label }}</option></select>
        </label>
        <label class="input-field"><span>{{ t('admin.cc.fieldExpiry') }}</span><input v-model="form.validUntil" type="date" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldUsageLimit') }}</span><input v-model.number="form.usageLimit" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldNote') }}</span><input v-model="form.note" :placeholder="t('admin.cc.notePh')" /></label>
      </div>
      <button class="primary-action small" type="button" :disabled="busy" @click="addCode">{{ t('admin.cc.btnCreate') }}</button>
    </section>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.cc.batchTitle') }}</h2></div>
      <p style="color:var(--muted); font-size:12px; margin:-6px 0 10px">{{ t('admin.cc.batchHint') }}</p>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.cc.fieldBatchCount') }}</span><input v-model.number="batch.count" type="number" min="1" max="500" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldPrefix') }}</span><input v-model="batch.prefix" placeholder="PROMO" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldBatchAmount') }}</span><input v-model.number="batch.amount" type="number" min="1000" step="1000" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldGroup') }}</span>
          <select v-model="batch.productGroup"><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.label }}</option></select>
        </label>
        <label class="input-field"><span>{{ t('admin.cc.fieldBatchExpiry') }}</span><input v-model="batch.validUntil" type="date" /></label>
        <label class="input-field"><span>{{ t('admin.cc.fieldBatchUsage') }}</span><input v-model.number="batch.usageLimit" type="number" min="1" /></label>
      </div>
      <button class="primary-action small" type="button" :disabled="busy" @click="addBatch">{{ t('admin.cc.btnBatch', { n: batch.count }) }}</button>
    </section>
  </section>
</template>
