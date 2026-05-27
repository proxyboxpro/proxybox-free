<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'

const pricing = ref(null)
const newTier = ref({ min: 10, discount: 0.1 })
const err = ref(''); const flash = ref('')

async function refresh() {
  err.value = ''
  try { pricing.value = await apiFetch('/api/admin/pricing') }
  catch (e) { err.value = e.message }
}
async function save() {
  try { pricing.value = await apiFetch('/api/admin/pricing', { method: 'PATCH', body: pricing.value }); flash.value = 'Đã lưu pricing.' }
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
      <span class="eyebrow">Pricing</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section v-if="pricing" class="surface">
      <div class="section-head"><h2>Giá theo giờ</h2></div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Hệ thống bán proxy theo giờ. Khách chọn số giờ (1h–8760h).</p>
      <div class="form-grid">
        <label class="input-field"><span>IPv4 / giờ</span><input v-model.number="pricing.ipv4.perHour" type="number" min="0" /></label>
        <label class="input-field"><span>IPv6 / giờ</span><input v-model.number="pricing.ipv6.perHour" type="number" min="0" /></label>
        <label class="input-field"><span>Currency</span><input v-model="pricing.currency" maxlength="8" /></label>
        <label class="input-field"><span>Min hours</span><input v-model.number="pricing.minHours" type="number" min="1" /></label>
        <label class="input-field"><span>Max hours</span><input v-model.number="pricing.maxHours" type="number" min="1" /></label>
        <label class="input-field"><span>Quota băng thông / proxy (GB/tháng, 0 = ∞)</span><input v-model.number="pricing.bandwidthQuotaGB" type="number" min="0" /></label>
      </div>
    </section>

    <section v-if="pricing" class="surface">
      <div class="section-head"><h2>Volume tiers</h2></div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Khách mua nhiều thì giảm giá tự động.</p>
      <div v-if="pricing.tiers?.length" class="data-table" style="margin-bottom:10px">
        <div v-for="(t, i) in pricing.tiers" :key="i" class="table-row" style="grid-template-columns: 1fr 1fr auto">
          <span>quantity ≥ <strong>{{ t.min }}</strong></span>
          <span>-{{ ((t.discount || 0) * 100).toFixed(0) }}%</span>
          <button class="ghost-button" type="button" @click="removeTier(i)">remove</button>
        </div>
      </div>
      <div class="form-grid">
        <label class="input-field"><span>min qty</span><input v-model.number="newTier.min" type="number" min="2" /></label>
        <label class="input-field"><span>discount (0-0.9)</span><input v-model.number="newTier.discount" type="number" min="0" max="0.9" step="0.05" /></label>
        <button class="ghost-button" type="button" @click="addTier">+ Thêm tier</button>
      </div>
    </section>

    <div class="action-row">
      <button class="primary-action" type="button" @click="save">Lưu thay đổi</button>
    </div>
  </section>
</template>
