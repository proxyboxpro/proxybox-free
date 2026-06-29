<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch, currentUser, adminDeleteUser, adminImpersonate } from '../../api'

const router = useRouter()
const users = ref([])
const search = ref('')
const filterRole = ref('all') // all | admin | customer
const filterStatus = ref('all') // all | active | suspended
const err = ref(''); const flash = ref('')

async function refresh() {
  try {
    users.value = await apiFetch('/api/admin/users')
  } catch (e) { err.value = e.message }
}

const filterTag = ref('')

const filtered = computed(() => users.value.filter((u) => {
  if (filterRole.value !== 'all' && u.role !== filterRole.value) return false
  if (filterStatus.value === 'active' && u.suspended) return false
  if (filterStatus.value === 'suspended' && !u.suspended) return false
  if (filterStatus.value === 'unverified' && u.emailVerified) return false
  if (filterStatus.value === '2faEnforced' && !u.require2FA) return false
  if (filterTag.value && !(u.tags || []).includes(filterTag.value)) return false
  if (search.value) {
    const q = search.value.toLowerCase()
    return `${u.id} ${u.email} ${u.name} ${u.referralCode || ''} ${(u.tags || []).join(' ')} ${u.notes || ''}`.toLowerCase().includes(q)
  }
  return true
}))

// Registration time. New users carry createdAt; legacy ones are dated by
// decoding the id (u-<base36 Date.now()>). Used for newest-first sorting.
function regTime(u) {
  if (u.createdAt) { const t = Date.parse(u.createdAt); if (t) return t }
  const m = /^u-([0-9a-z]+)$/.exec(u.id || '')
  if (m) { const t = parseInt(m[1], 36); if (t > 1577836800000 && t < 4102444800000) return t }
  return 0
}
function regLabel(u) {
  const t = regTime(u)
  if (!t) return ''
  return new Date(t).toISOString().slice(0, 10)
}

// Newest-registered users on top.
const sorted = computed(() => filtered.value.slice().sort((a, b) => regTime(b) - regTime(a)))

// Pagination — 25 users per page.
const pageSize = 25
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize)))
const paged = computed(() => sorted.value.slice((page.value - 1) * pageSize, page.value * pageSize))
// Any filter/search change resets to the first page; keep page in range when the list shrinks.
watch([search, filterRole, filterStatus, filterTag], () => { page.value = 1 })
watch(totalPages, (n) => { if (page.value > n) page.value = n })
function goPage(p) { page.value = Math.min(Math.max(1, p), totalPages.value) }

// Aggregate all tags for the filter dropdown
const allTags = computed(() => {
  const set = new Set()
  for (const u of users.value) for (const t of (u.tags || [])) set.add(t)
  return [...set].sort()
})

const stats = computed(() => ({
  total: users.value.length,
  admins: users.value.filter((u) => u.role === 'admin').length,
  customers: users.value.filter((u) => u.role === 'customer').length,
  suspended: users.value.filter((u) => u.suspended).length,
  totp: users.value.filter((u) => u.totpEnabled).length,
  totalBalance: users.value.reduce((a, u) => a + (Number(u.balance) || 0), 0)
}))

function view(u) { router.push({ name: 'admin-user-detail', params: { userId: u.id } }) }
async function loginAsUser(u) {
  if (!confirm(`Đăng nhập vào tài khoản "${u.email}"?\nBạn sẽ chuyển sang giao diện khách hàng. Một thanh cảnh báo sẽ cho phép quay lại admin.`)) return
  try {
    await adminImpersonate(u.id)
    // Full reload into the customer portal so all admin-scoped stores reset.
    window.location.assign('/dashboard')
  } catch (e) { err.value = e.message }
}
async function suspend(u, action) {
  try { await apiFetch(`/api/admin/users/${u.id}/${action}`, { method: 'POST' }); flash.value = `${u.email} ${action}ed.`; await refresh() }
  catch (e) { err.value = e.message }
}
async function credit(u) {
  const a = prompt(`Credit (+) / debit (-) for ${u.email}:`, '50000')
  if (!a) return
  const note = prompt('Note (optional):', 'admin adjustment') || ''
  try { const r = await apiFetch(`/api/admin/users/${u.id}/credit`, { method: 'POST', body: { amount: Number(a), note } }); flash.value = `Balance now ${Number(r.balance).toLocaleString()}`; await refresh() }
  catch (e) { err.value = e.message }
}
async function removeUser(u) {
  const typed = prompt(`Xoá VĨNH VIỄN user "${u.email}"? Gõ chính xác email để xác nhận:`)
  if (!typed || typed.trim().toLowerCase() !== u.email.toLowerCase()) { err.value = 'Huỷ — email không khớp'; return }
  try {
    const r = await adminDeleteUser(u.id)
    flash.value = `Đã xoá ${u.email}`
    void r
    await refresh()
  } catch (e) {
    if (e.status === 409 && e.data?.hint && (e.data.proxies > 0 || e.data.orders > 0)) {
      const force = confirm(`${u.email} còn ${e.data.proxies} proxy + ${e.data.orders} order. Xoá luôn (cascade)?`)
      if (!force) { err.value = 'Huỷ — user còn proxy/order'; return }
      try { await adminDeleteUser(u.id, { force: true }); flash.value = `Đã xoá ${u.email} (cascade)`; await refresh() }
      catch (e2) { err.value = e2.message }
    } else { err.value = e.message }
  }
}
const selfEmail = computed(() => (currentUser.value?.email || '').toLowerCase())

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow">Quản lý user</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh">Refresh</button>
    </div>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <div class="metric-grid">
      <div class="metric-card"><div class="metric-label">Tổng</div><div class="metric-value">{{ stats.total }}</div></div>
      <div class="metric-card"><div class="metric-label">Admin</div><div class="metric-value">{{ stats.admins }}</div></div>
      <div class="metric-card"><div class="metric-label">Customer</div><div class="metric-value">{{ stats.customers }}</div></div>
      <div class="metric-card"><div class="metric-label">Suspended</div><div class="metric-value">{{ stats.suspended }}</div></div>
      <div class="metric-card"><div class="metric-label">2FA enabled</div><div class="metric-value">{{ stats.totp }}</div></div>
      <div class="metric-card"><div class="metric-label">Total wallet</div><div class="metric-value">{{ stats.totalBalance.toLocaleString() }}</div></div>
    </div>

    <div class="toolbar" style="margin-top:14px">
      <div class="segment-tabs">
        <button :class="{ active: filterRole === 'all' }" type="button" @click="filterRole = 'all'">All</button>
        <button :class="{ active: filterRole === 'admin' }" type="button" @click="filterRole = 'admin'">Admin</button>
        <button :class="{ active: filterRole === 'customer' }" type="button" @click="filterRole = 'customer'">Customer</button>
      </div>
      <div class="chips">
        <button :class="{ active: filterStatus === 'all' }" type="button" @click="filterStatus = 'all'">Any status</button>
        <button :class="{ active: filterStatus === 'active' }" type="button" @click="filterStatus = 'active'">Active</button>
        <button :class="{ active: filterStatus === 'suspended' }" type="button" @click="filterStatus = 'suspended'">Suspended</button>
        <button :class="{ active: filterStatus === 'unverified' }" type="button" @click="filterStatus = 'unverified'">Unverified</button>
        <button :class="{ active: filterStatus === '2faEnforced' }" type="button" @click="filterStatus = '2faEnforced'">2FA enforced</button>
      </div>
      <select v-if="allTags.length" v-model="filterTag" class="search-input" style="padding:6px 10px">
        <option value="">Any tag</option>
        <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
      </select>
      <input v-model="search" class="search-input" type="search" placeholder="Search email, name, id, ref, tag, note..." />
    </div>

    <div v-if="sorted.length" class="surface" style="margin-top:14px">
      <div class="data-table">
        <div class="table-row" style="grid-template-columns: 2fr 1fr 1fr 1fr 2.4fr; font-weight:600; background:var(--surface-2)">
          <span>Email</span><span>Role</span><span>Balance</span><span>Proxies</span><span>Actions</span>
        </div>
        <div v-for="u in paged" :key="u.id" class="table-row" style="grid-template-columns: 2fr 1fr 1fr 1fr 2.4fr">
          <span class="cell-mono" style="font-size:12.5px">
            {{ u.email }}
            <span v-if="u.totpEnabled" class="tag" style="margin-left:6px;background:rgba(34,197,94,0.16);color:#22c55e">2FA</span>
            <span v-if="u.require2FA && !u.totpEnabled" class="tag" style="margin-left:6px;background:rgba(245,158,11,0.16);color:#f59e0b">2FA-REQ</span>
            <span v-if="u.suspended" class="tag" style="margin-left:6px;background:rgba(239,68,68,0.16);color:#ef4444">SUSPENDED</span>
            <span v-if="!u.emailVerified" class="tag" style="margin-left:6px;background:rgba(148,163,184,0.16);color:var(--muted)" title="Email not verified">UNVERIFIED</span>
            <span v-for="t in (u.tags || [])" :key="t" class="tag" style="margin-left:4px;background:rgba(59,130,246,0.12);color:#60a5fa">{{ t }}</span>
            <span v-if="u.notes" class="tag" style="margin-left:6px;background:rgba(245,158,11,0.1);color:#f59e0b" :title="u.notes">📝</span>
            <span v-if="regLabel(u)" style="display:block;font-size:11px;color:var(--muted);margin-top:2px">ĐK: {{ regLabel(u) }}</span>
          </span>
          <span><span class="tag">{{ u.role }}</span></span>
          <span class="cell-mono" style="font-size:12.5px">{{ Number(u.balance).toLocaleString() }}</span>
          <span style="font-size:12.5px">{{ u.ownedProxies }}</span>
          <span class="action-row">
            <button v-if="(u.email || '').toLowerCase() !== selfEmail && !u.suspended" class="ghost-button" type="button" style="padding:2px 8px;color:var(--green);border-color:rgba(34,197,94,0.4)" @click="loginAsUser(u)" title="Đăng nhập vào tài khoản này">Login</button>
            <button class="ghost-button" type="button" style="padding:2px 8px" @click="view(u)">Chi tiết</button>
            <button class="ghost-button" type="button" style="padding:2px 8px" @click="credit(u)">Nạp/trừ</button>
            <button v-if="!u.suspended" class="ghost-button" type="button" style="padding:2px 8px" @click="suspend(u, 'suspend')">Khoá</button>
            <button v-else class="ghost-button" type="button" style="padding:2px 8px" @click="suspend(u, 'unsuspend')">Mở khoá</button>
            <button v-if="(u.email || '').toLowerCase() !== selfEmail" class="ghost-button" type="button" style="padding:2px 8px;color:var(--red);border-color:rgba(239,68,68,0.4)" @click="removeUser(u)">Xoá</button>
          </span>
        </div>
      </div>
      <div v-if="totalPages > 1" class="pager">
        <button class="ghost-button" type="button" :disabled="page <= 1" @click="goPage(1)">«</button>
        <button class="ghost-button" type="button" :disabled="page <= 1" @click="goPage(page - 1)">‹ Trước</button>
        <span class="pager-info">Trang {{ page }} / {{ totalPages }} · {{ sorted.length }} user</span>
        <button class="ghost-button" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">Sau ›</button>
        <button class="ghost-button" type="button" :disabled="page >= totalPages" @click="goPage(totalPages)">»</button>
      </div>
    </div>
    <p v-else class="empty-text" style="margin-top:14px">Không user nào match filter.</p>
  </section>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.pager .ghost-button { padding: 4px 10px; }
.pager .ghost-button:disabled { opacity: 0.4; cursor: default; }
.pager-info { font-size: 12.5px; color: var(--muted); margin: 0 6px; }
</style>
