<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch, adminCouponAnalytics } from '../../api'

const coupons = ref([])
const newCoupon = ref({ code: '', discount: 0.1, validUntil: '', usageLimit: 0 })
const err = ref(''); const flash = ref('')
const stats = ref(null)
const loadingStats = ref('')

async function refresh() {
  err.value = ''
  try { coupons.value = await apiFetch('/api/admin/coupons') }
  catch (e) { err.value = e.message }
}
async function addCoupon() {
  try {
    const c = await apiFetch('/api/admin/coupons', { method: 'POST', body: newCoupon.value })
    coupons.value.push(c); newCoupon.value = { code: '', discount: 0.1, validUntil: '', usageLimit: 0 }; flash.value = 'Đã thêm coupon.'
  } catch (e) { err.value = e.message }
}
async function deleteCoupon(code) {
  if (!confirm(`Xoá coupon ${code}?`)) return
  await apiFetch(`/api/admin/coupons/${code}`, { method: 'DELETE' })
  coupons.value = coupons.value.filter((c) => c.code !== code)
}
async function viewStats(code) {
  loadingStats.value = code
  try { stats.value = await adminCouponAnalytics(code) }
  catch (e) { err.value = e.message }
  finally { loadingStats.value = '' }
}
function closeStats() { stats.value = null }
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Coupons ({{ coupons.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2>Danh sách</h2></div>
      <div v-if="coupons.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1fr 1fr 1fr 1fr auto">
          <span>Code</span><span>Giảm</span><span>Hết hạn</span><span>Đã dùng</span><span></span>
        </div>
        <div v-for="c in coupons" :key="c.code" class="table-row" style="grid-template-columns: 1fr 1fr 1fr 1fr auto auto">
          <span class="cell-mono">{{ c.code }}</span>
          <span>-{{ (c.discount * 100).toFixed(0) }}%</span>
          <span>{{ c.validUntil || '∞' }}</span>
          <span>{{ c.usageCount || 0 }}/{{ c.usageLimit || '∞' }}</span>
          <button class="ghost-button" type="button" :disabled="loadingStats === c.code" @click="viewStats(c.code)">{{ loadingStats === c.code ? '...' : 'stats' }}</button>
          <button class="ghost-button" type="button" @click="deleteCoupon(c.code)">delete</button>
        </div>
      </div>
      <p v-else class="empty-text">Chưa có coupon nào.</p>
    </section>

    <section class="surface">
      <div class="section-head"><h2>Thêm coupon</h2></div>
      <div class="form-grid">
        <label class="input-field"><span>Code</span><input v-model="newCoupon.code" placeholder="LAUNCH10" /></label>
        <label class="input-field"><span>Discount (0-0.9)</span><input v-model.number="newCoupon.discount" type="number" min="0" max="0.9" step="0.05" /></label>
        <label class="input-field"><span>Valid until</span><input v-model="newCoupon.validUntil" type="date" /></label>
        <label class="input-field"><span>Usage limit (0 = ∞)</span><input v-model.number="newCoupon.usageLimit" type="number" min="0" /></label>
      </div>
      <button class="primary-action small" type="button" @click="addCoupon">+ Thêm coupon</button>
    </section>

    <div v-if="stats" class="modal-backdrop" @click="closeStats"></div>
    <div v-if="stats" class="modal-card" @click.stop>
      <header><strong>Coupon analytics: {{ stats.code }}</strong><button class="ghost-button" type="button" @click="closeStats">Close</button></header>
      <div class="metric-cards" style="padding:18px; grid-template-columns: repeat(4, 1fr)">
        <article><span>Uses</span><strong>{{ stats.usageCount }}</strong></article>
        <article><span>Unique buyers</span><strong>{{ stats.uniqueBuyers }}</strong></article>
        <article><span>Revenue</span><strong>{{ Number(stats.totalRevenue).toLocaleString() }}</strong></article>
        <article><span>Discount given</span><strong>{{ Number(stats.totalDiscount).toLocaleString() }}</strong></article>
      </div>
      <div v-if="stats.orders?.length" style="padding:0 18px 18px">
        <h4>Latest orders</h4>
        <div class="data-table">
          <div v-for="o in stats.orders" :key="o.id" class="table-row" style="grid-template-columns: 1.4fr 1fr 1fr 1.4fr">
            <span class="cell-mono">{{ o.id }}</span>
            <span class="cell-mono">{{ Number(o.totalCost).toLocaleString() }}</span>
            <span class="cell-mono" style="color:#15803d">-{{ Number(o.discountAmount).toLocaleString() }}</span>
            <span class="cell-mono" style="color:var(--muted)">{{ o.createdAt?.slice(0,16).replace('T',' ') }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; }
.modal-card { position: fixed; top: 5%; left: 50%; transform: translateX(-50%); width: min(720px, 95vw); max-height: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; z-index: 91; }
.modal-card header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
</style>
