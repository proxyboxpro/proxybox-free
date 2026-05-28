<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const zones = ref([])
const newZone = ref({ id: '', name: '', flag: '', timezone: 'Asia/Ho_Chi_Minh' })
const err = ref(''); const flash = ref('')

async function refresh() {
  err.value = ''
  try { zones.value = await apiFetch('/api/admin/zones') }
  catch (e) { err.value = e.message }
}
async function addZone() {
  if (!newZone.value.id) return
  try {
    zones.value = await apiFetch('/api/admin/zones', { method: 'POST', body: newZone.value })
    newZone.value = { id: '', name: '', flag: '', timezone: 'Asia/Ho_Chi_Minh' }
    flash.value = t('admin.zones.added')
  } catch (e) { err.value = e.message }
}
async function deleteZone(id) {
  if (!confirm(t('admin.zones.confirmDel', { id }))) return
  try {
    await apiFetch(`/api/admin/zones/${id}`, { method: 'DELETE' })
    zones.value = zones.value.filter((z) => z.id !== id)
  } catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.zones.eyebrow') }} ({{ zones.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.zones.title') }}</h2></div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px" v-html="t('admin.zones.hint')"></p>
      <div v-if="zones.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1fr 2fr 1fr 1fr auto">
          <span>{{ t('admin.zones.colId') }}</span><span>{{ t('admin.zones.colName') }}</span><span>{{ t('admin.zones.colTimezone') }}</span><span>{{ t('admin.zones.colOnline') }}</span><span></span>
        </div>
        <div v-for="z in zones" :key="z.id" class="table-row" style="grid-template-columns: 1fr 2fr 1fr 1fr auto">
          <span class="cell-mono">{{ z.id }}</span>
          <span>{{ z.flag }} {{ z.name }}</span>
          <span class="cell-mono" style="font-size:11.5px; color:var(--muted)">{{ z.timezone }}</span>
          <span>{{ z.onlineNodes ?? 0 }}</span>
          <button class="ghost-button" type="button" @click="deleteZone(z.id)">{{ t('admin.common.delete') }}</button>
        </div>
      </div>
      <p v-else class="empty-text">{{ t('admin.zones.empty') }}</p>
    </section>

    <section class="surface">
      <div class="section-head"><h2>{{ t('admin.zones.addTitle') }}</h2></div>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.zones.fieldId') }}</span><input v-model="newZone.id" placeholder="vn-da-nang" /></label>
        <label class="input-field"><span>{{ t('admin.zones.fieldName') }}</span><input v-model="newZone.name" placeholder="Vietnam · Da Nang" /></label>
        <label class="input-field"><span>{{ t('admin.zones.fieldFlag') }}</span><input v-model="newZone.flag" placeholder="VN" maxlength="8" /></label>
        <label class="input-field"><span>{{ t('admin.zones.fieldTimezone') }}</span><input v-model="newZone.timezone" placeholder="Asia/Ho_Chi_Minh" /></label>
      </div>
      <button class="primary-action small" type="button" @click="addZone">{{ t('admin.zones.add') }}</button>
    </section>
  </section>
</template>
