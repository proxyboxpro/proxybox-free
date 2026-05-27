<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'

const codes = ref([])
const form = ref({ code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' })
const err = ref(''); const flash = ref(''); const busy = ref(false)

const groups = [
  { id: 'all',  label: 'Tất cả' },
  { id: 'ipv4', label: 'IPv4' },
  { id: 'ipv6', label: 'IPv6' },
  { id: 'hub',  label: 'Hub' }
]
function groupLabel(g) { return (groups.find((x) => x.id === g) || groups[0]).label }
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
    flash.value = `Đã tạo mã ${c.code} (+${fmt(c.amount)} ${c.currency}).`
    form.value = { code: '', amount: 50000, productGroup: 'all', validUntil: '', usageLimit: 0, note: '' }
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}
async function toggleCode(c) {
  try { const u = await apiFetch(`/api/admin/credit-codes/${c.code}`, { method: 'PATCH', body: { enabled: !c.enabled } }); c.enabled = u.enabled }
  catch (e) { err.value = e.message }
}
async function deleteCode(code) {
  if (!confirm(`Xoá mã ${code}?`)) return
  try { await apiFetch(`/api/admin/credit-codes/${code}`, { method: 'DELETE' }); codes.value = codes.value.filter((c) => c.code !== code) }
  catch (e) { err.value = e.message }
}
onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Mã Free Credit ({{ codes.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p style="color:var(--muted); font-size:12.5px; margin:-4px 0 0; max-width:760px">
      Khách nhập mã ở trang <strong>Nạp tiền</strong> để nhận free credit. Credit <strong>chỉ dùng mua đúng nhóm sản phẩm</strong>
      của mã (tự trừ khi mua, trước ví) và <strong>hết hạn vào ngày Hết hạn</strong>. Mỗi khách dùng 1 lần / mã.
    </p>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:var(--green)">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2>Danh sách</h2></div>
      <div v-if="codes.length" class="data-table">
        <div class="table-head" style="grid-template-columns: 1.2fr 1.1fr 0.8fr 1fr 0.8fr 0.7fr auto auto">
          <span>Code</span><span>Số tiền</span><span>Nhóm</span><span>Hết hạn</span><span>Đã dùng</span><span>Trạng thái</span><span></span><span></span>
        </div>
        <div v-for="c in codes" :key="c.code" class="table-row" style="grid-template-columns: 1.2fr 1.1fr 0.8fr 1fr 0.8fr 0.7fr auto auto">
          <span class="cell-mono">{{ c.code }}</span>
          <span class="cell-mono" style="color:var(--green)">+{{ fmt(c.amount) }} {{ c.currency }}</span>
          <span><span class="tag-soft">{{ groupLabel(c.productGroup) }}</span></span>
          <span>{{ c.validUntil || '∞' }}</span>
          <span>{{ usedCount(c) }}/{{ c.usageLimit || '∞' }}</span>
          <span class="tag-soft" :style="{ color: c.enabled === false ? '#f87171' : 'var(--green)' }">{{ c.enabled === false ? 'tắt' : 'bật' }}</span>
          <button class="ghost-button" type="button" @click="toggleCode(c)">{{ c.enabled === false ? 'bật' : 'tắt' }}</button>
          <button class="ghost-button" type="button" @click="deleteCode(c.code)">xoá</button>
        </div>
      </div>
      <p v-else class="empty-text">Chưa có mã nào.</p>
    </section>

    <section class="surface">
      <div class="section-head"><h2>Tạo mã mới</h2></div>
      <div class="form-grid">
        <label class="input-field"><span>Code</span><input v-model="form.code" placeholder="WELCOME50" /></label>
        <label class="input-field"><span>Số tiền (cộng vào ví)</span><input v-model.number="form.amount" type="number" min="1000" step="1000" /></label>
        <label class="input-field"><span>Nhóm sản phẩm</span>
          <select v-model="form.productGroup">
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.label }}</option>
          </select>
        </label>
        <label class="input-field"><span>Hết hạn credit (trống = vô hạn)</span><input v-model="form.validUntil" type="date" /></label>
        <label class="input-field"><span>Giới hạn lượt (0 = ∞)</span><input v-model.number="form.usageLimit" type="number" min="0" /></label>
        <label class="input-field"><span>Ghi chú</span><input v-model="form.note" placeholder="Campaign…" /></label>
      </div>
      <button class="primary-action small" type="button" :disabled="busy" @click="addCode">+ Tạo mã</button>
    </section>
  </section>
</template>
