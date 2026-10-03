<script setup>
import { onMounted, ref, computed, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch, currentUser, adminDeleteUser, adminImpersonate } from '../../api'
import { message, confirmAsync, promptAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const router = useRouter()
const users = ref([])
const loading = ref(false)
const search = ref('')
const filterRole = ref('all') // all | admin | customer
const filterStatus = ref('all') // all | active | suspended | unverified | 2faEnforced
const filterTag = ref()
const err = ref('')

async function refresh() {
  loading.value = true
  try {
    users.value = await apiFetch('/api/admin/users')
    err.value = ''
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}

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

// Pagination — 25 users per page; any filter/search change resets to page 1.
const pagination = reactive({
  current: 1,
  pageSize: 25,
  showSizeChanger: true,
  pageSizeOptions: ['25', '50', '100'],
  showTotal: (total) => `${total} user`
})
watch([search, filterRole, filterStatus, filterTag], () => { pagination.current = 1 })
function onTableChange(p) {
  pagination.current = p.current
  pagination.pageSize = p.pageSize
}

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

const columns = [
  { title: 'Email', key: 'email', dataIndex: 'email' },
  { title: 'Role', key: 'role', dataIndex: 'role', width: 110 },
  { title: 'Balance', key: 'balance', dataIndex: 'balance', width: 140, align: 'right', sorter: (a, b) => (Number(a.balance) || 0) - (Number(b.balance) || 0) },
  { title: 'Proxies', key: 'ownedProxies', dataIndex: 'ownedProxies', width: 100, align: 'right', sorter: (a, b) => (a.ownedProxies || 0) - (b.ownedProxies || 0) },
  { title: 'Actions', key: 'actions', width: 280, fixed: 'right' }
]

function view(u) { router.push({ name: 'admin-user-detail', params: { userId: u.id } }) }
async function loginAsUser(u) {
  const ok = await confirmAsync({
    title: `Đăng nhập vào tài khoản "${u.email}"?`,
    content: 'Bạn sẽ chuyển sang giao diện khách hàng. Một thanh cảnh báo sẽ cho phép quay lại admin.'
  })
  if (!ok) return
  try {
    await adminImpersonate(u.id)
    // Full reload into the customer portal so all admin-scoped stores reset.
    window.location.assign('/dashboard')
  } catch (e) { message.error(e.message) }
}
async function suspend(u, action) {
  try {
    await apiFetch(`/api/admin/users/${u.id}/${action}`, { method: 'POST' })
    message.success(`${u.email} ${action}ed.`)
    await refresh()
  } catch (e) { message.error(e.message) }
}
async function credit(u) {
  const a = await promptAsync({ title: `Credit (+) / debit (-) for ${u.email}`, defaultValue: 50000, inputType: 'number', required: true })
  if (!a) return
  const note = await promptAsync({ title: 'Note (optional)', defaultValue: 'admin adjustment' })
  if (note === null) return
  try {
    const r = await apiFetch(`/api/admin/users/${u.id}/credit`, { method: 'POST', body: { amount: Number(a), note } })
    message.success(`Balance now ${Number(r.balance).toLocaleString()}`)
    await refresh()
  } catch (e) { message.error(e.message) }
}
async function removeUser(u) {
  const typed = await promptAsync({
    title: `Xoá VĨNH VIỄN user "${u.email}"?`,
    label: 'Gõ chính xác email để xác nhận:',
    placeholder: u.email,
    danger: true
  })
  if (typed === null) return
  if (!typed || typed.trim().toLowerCase() !== u.email.toLowerCase()) { message.warning('Huỷ — email không khớp'); return }
  try {
    await adminDeleteUser(u.id)
    message.success(`Đã xoá ${u.email}`)
    await refresh()
  } catch (e) {
    if (e.status === 409 && e.data?.hint && (e.data.proxies > 0 || e.data.orders > 0)) {
      const force = await confirmAsync({
        title: `${u.email} còn ${e.data.proxies} proxy + ${e.data.orders} order. Xoá luôn (cascade)?`,
        danger: true,
        type: 'warning'
      })
      if (!force) { message.info('Huỷ — user còn proxy/order'); return }
      try { await adminDeleteUser(u.id, { force: true }); message.success(`Đã xoá ${u.email} (cascade)`); await refresh() }
      catch (e2) { message.error(e2.message) }
    } else { message.error(e.message) }
  }
}
const selfEmail = computed(() => (currentUser.value?.email || '').toLowerCase())
const isSelf = (u) => (u.email || '').toLowerCase() === selfEmail.value

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">Quản lý user</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        Refresh
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-row :gutter="[12, 12]">
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="Tổng" :value="stats.total" /></a-card></a-col>
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="Admin" :value="stats.admins" /></a-card></a-col>
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="Customer" :value="stats.customers" /></a-card></a-col>
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="Suspended" :value="stats.suspended" :value-style="stats.suspended ? { color: '#ef4444' } : undefined" /></a-card></a-col>
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="2FA enabled" :value="stats.totp" /></a-card></a-col>
      <a-col :xs="12" :sm="8" :xl="4"><a-card size="small"><a-statistic title="Total wallet" :value="stats.totalBalance" /></a-card></a-col>
    </a-row>

    <a-card :body-style="{ padding: 0 }">
      <template #title>
        <a-flex wrap="wrap" gap="small" align="center" class="filters">
          <a-segmented
            v-model:value="filterRole"
            :options="[{ label: 'All', value: 'all' }, { label: 'Admin', value: 'admin' }, { label: 'Customer', value: 'customer' }]"
          />
          <a-select v-model:value="filterStatus" style="width: 160px">
            <a-select-option value="all">Any status</a-select-option>
            <a-select-option value="active">Active</a-select-option>
            <a-select-option value="suspended">Suspended</a-select-option>
            <a-select-option value="unverified">Unverified</a-select-option>
            <a-select-option value="2faEnforced">2FA enforced</a-select-option>
          </a-select>
          <a-select
            v-if="allTags.length"
            v-model:value="filterTag"
            allow-clear
            placeholder="Any tag"
            style="width: 160px"
            :options="allTags.map((t) => ({ label: t, value: t }))"
          />
          <a-input-search v-model:value="search" allow-clear placeholder="Search email, name, id, ref, tag, note..." style="width: 300px; max-width: 100%" />
        </a-flex>
      </template>

      <a-table
        :columns="columns"
        :data-source="sorted"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        size="middle"
        :scroll="{ x: 900 }"
        :locale="{ emptyText: 'Không user nào match filter.' }"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record: u }">
          <template v-if="column.key === 'email'">
            <a-space direction="vertical" :size="2">
              <a-space wrap :size="4">
                <a class="mono" @click="view(u)">{{ u.email }}</a>
                <a-tag v-if="u.totpEnabled" color="success" :bordered="false">2FA</a-tag>
                <a-tag v-if="u.require2FA && !u.totpEnabled" color="warning" :bordered="false">2FA-REQ</a-tag>
                <StatusTag v-if="u.suspended" status="suspended" />
                <a-tooltip v-if="!u.emailVerified" title="Email not verified"><a-tag :bordered="false">UNVERIFIED</a-tag></a-tooltip>
                <a-tag v-for="t in (u.tags || [])" :key="t" color="blue" :bordered="false">{{ t }}</a-tag>
                <a-tooltip v-if="u.notes" :title="u.notes"><a-tag color="orange" :bordered="false"><FileTextOutlined /></a-tag></a-tooltip>
              </a-space>
              <a-typography-text v-if="regLabel(u)" type="secondary" style="font-size: 12px">ĐK: {{ regLabel(u) }}</a-typography-text>
            </a-space>
          </template>
          <template v-else-if="column.key === 'role'">
            <a-tag :color="u.role === 'admin' ? 'purple' : 'default'">{{ u.role }}</a-tag>
          </template>
          <template v-else-if="column.key === 'balance'">
            <span class="mono">{{ Number(u.balance).toLocaleString() }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space wrap :size="4">
              <a-tooltip v-if="!isSelf(u) && !u.suspended" title="Đăng nhập vào tài khoản này">
                <a-button size="small" type="primary" ghost @click="loginAsUser(u)">
                  <template #icon><LoginOutlined /></template>Login
                </a-button>
              </a-tooltip>
              <a-button size="small" @click="view(u)">Chi tiết</a-button>
              <a-button size="small" @click="credit(u)">Nạp/trừ</a-button>
              <a-button v-if="!u.suspended" size="small" @click="suspend(u, 'suspend')">Khoá</a-button>
              <a-button v-else size="small" @click="suspend(u, 'unsuspend')">Mở khoá</a-button>
              <a-button v-if="!isSelf(u)" size="small" danger @click="removeUser(u)">
                <template #icon><DeleteOutlined /></template>Xoá
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.filters { padding: 12px 0; font-weight: 400; }
</style>
