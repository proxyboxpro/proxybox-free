<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const pricing = ref(null)
const newTier = ref({ min: 10, discount: 0.1 })
const err = ref(''); const flash = ref('')

async function refresh() {
  err.value = ''
  try { pricing.value = await apiFetch('/api/admin/pricing') }
  catch (e) { err.value = e.message }
}
async function save() {
  try { pricing.value = await apiFetch('/api/admin/pricing', { method: 'PATCH', body: pricing.value }); flash.value = t('admin.pricing.saved') }
  catch (e) { err.value = e.message }
}
function addTier() {
  pricing.value.tiers = pricing.value.tiers || []
  pricing.value.tiers.push({ ...newTier.value })
  newTier.value = { min: 10, discount: 0.1 }
}
function removeTier(i) { pricing.value.tiers.splice(i, 1) }
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">{{ t('admin.pricing.eyebrow') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">{{ t('admin.common.refresh') }}</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section v-if="pricing" class="surface">
      <div class="section-head"><h2>{{ t('admin.pricing.hourlyTitle') }}</h2></div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">{{ t('admin.pricing.hourlyHint') }}</p>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.pricing.ipv4PerHour') }}</span><input v-model.number="pricing.ipv4.perHour" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.ipv6PerHour') }}</span><input v-model.number="pricing.ipv6.perHour" type="number" min="0" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.currency') }}</span><input v-model="pricing.currency" maxlength="8" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.minHours') }}</span><input v-model.number="pricing.minHours" type="number" min="1" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.maxHours') }}</span><input v-model.number="pricing.maxHours" type="number" min="1" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.bandwidthQuota') }}</span><input v-model.number="pricing.bandwidthQuotaGB" type="number" min="0" /></label>
      </div>
    </section>

    <section v-if="pricing" class="surface">
      <div class="section-head"><h2>{{ t('admin.pricing.tiersTitle') }}</h2></div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">{{ t('admin.pricing.tiersHint') }}</p>
      <div v-if="pricing.tiers?.length" class="data-table" style="margin-bottom:10px">
        <div v-for="(tier, i) in pricing.tiers" :key="i" class="table-row" style="grid-template-columns: 1fr 1fr auto">
          <span>quantity ≥ <strong>{{ tier.min }}</strong></span>
          <span>-{{ ((tier.discount || 0) * 100).toFixed(0) }}%</span>
          <button class="ghost-button" type="button" @click="removeTier(i)">{{ t('admin.pricing.tierRemove') }}</button>
        </div>
      </div>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('admin.pricing.tierMin') }}</span><input v-model.number="newTier.min" type="number" min="2" /></label>
        <label class="input-field"><span>{{ t('admin.pricing.tierDiscount') }}</span><input v-model.number="newTier.discount" type="number" min="0" max="0.9" step="0.05" /></label>
        <button class="ghost-button" type="button" @click="addTier">{{ t('admin.pricing.tierAdd') }}</button>
      </div>
    </section>

    <div class="action-row">
      <button class="primary-action" type="button" @click="save">{{ t('admin.pricing.saveChanges') }}</button>
    </div>
  </section>
</template>
