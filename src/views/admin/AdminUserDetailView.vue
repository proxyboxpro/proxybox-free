<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch, adminListUserSessions, adminRevokeUserSessions, adminForcePasswordReset, adminUpdateUserNotes, adminEnforce2FA } from '../../api'
import { message, confirmAsync } from '../../ui/feedback'
import StatusTag from '../../components/ui/StatusTag.vue'

const route = useRoute(); const router = useRouter()
const detail = ref(null), err = ref('')
const loading = ref(false)
const sessionsList = ref([])
const notes = ref('')
const tagsText = ref('')
const savingNotes = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try {
    detail.value = await apiFetch(`/api/admin/users/${route.params.userId}/detail`)
    notes.value = detail.value?.account?.notes || ''
    tagsText.value = (detail.value?.account?.tags || []).join(', ')
    await loadSessions()
  } catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function loadSessions() {
  try { sessionsList.value = await adminListUserSessions(route.params.userId) }
  catch { sessionsList.value = [] }
}
async function suspend(action) {
  try { await apiFetch(`/api/admin/users/${route.params.userId}/${action}`, { method: 'POST' }); await refresh() }
  catch (e) { message.error(e.message) }
}

// Credit / debit wallet — modal with amount + note (was two window.prompt calls).
const creditOpen = ref(false)
const creditBusy = ref(false)
const creditForm = reactive({ amount: 50000, note: 'admin adjustment' })
function credit() {
  creditForm.amount = 50000
  creditForm.note = 'admin adjustment'
  creditOpen.value = true
}
async function submitCredit() {
  if (creditForm.amount === null || creditForm.amount === undefined || creditForm.amount === '') return
  creditBusy.value = true
  try {
    await apiFetch(`/api/admin/users/${route.params.userId}/credit`, { method: 'POST', body: { amount: Number(creditForm.amount), note: creditForm.note || '' } })
    creditOpen.value = false
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { creditBusy.value = false }
}

// Gift product-locked free credit — modal with amount + group + expiry.
const giftOpen = ref(false)
const giftBusy = ref(false)
const giftForm = reactive({ amount: 50000, group: 'ipv6', validUntil: '' })
const giftGroups = ['all', 'ipv4', 'ipv6', 'hub'].map((g) => ({ value: g, label: g }))
function giftCredit() {
  giftForm.amount = 50000
  giftForm.group = 'ipv6'
  giftForm.validUntil = ''
  giftOpen.value = true
}
async function submitGift() {
  if (!(Number(giftForm.amount) > 0)) return
  giftBusy.value = true
  try {
    await apiFetch(`/api/admin/users/${route.params.userId}/grant-credit`, {
      method: 'POST',
      body: { amount: Number(giftForm.amount), productGroup: (giftForm.group || 'all').toLowerCase(), validUntil: giftForm.validUntil || '' }
    })
    giftOpen.value = false
    message.success('Đã tặng free credit.')
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { giftBusy.value = false }
}

async function revokeAllSessions() {
  if (!(await confirmAsync({ title: 'Revoke all active sessions for this user? They will be logged out everywhere.', danger: true }))) return
  try { const r = await adminRevokeUserSessions(route.params.userId); message.success(`Revoked ${r.revoked} sessions`); await loadSessions() }
  catch (e) { message.error(e.message) }
}
async function forceReset() {
  if (!(await confirmAsync({ title: 'Force password reset? User will receive email + all sessions revoked.', danger: true }))) return
  try { await adminForcePasswordReset(route.params.userId); message.success('Password reset email sent.'); await refresh() }
  catch (e) { message.error(e.message) }
}
async function saveNotes() {
  savingNotes.value = true
  try {
    const tags = tagsText.value.split(',').map((s) => s.trim()).filter(Boolean)
    await adminUpdateUserNotes(route.params.userId, { notes: notes.value, tags })
    message.success('Notes saved.')
  } catch (e) { message.error(e.message) }
  finally { savingNotes.value = false }
}
async function toggle2FAEnforce() {
  const next = !(detail.value?.account?.require2FA)
  try { await adminEnforce2FA(route.params.userId, next); message.success(next ? '2FA enforcement enabled.' : '2FA enforcement disabled.'); await refresh() }
  catch (e) { message.error(e.message) }
}
function back() { router.push({ name: 'admin-users' }) }
function viewOrder(o) { router.push({ name: 'admin-order-detail', params: { orderId: o.id } }) }

const freeCreditTotal = computed(() => (detail.value?.creditGrants || []).reduce((s, g) => s + Number(g.remaining || 0), 0))
const freeCreditBreakdown = computed(() => (detail.value?.creditGrants || [])
  .map((g) => g.group.toUpperCase() + ' ' + Number(g.remaining).toLocaleString() + (g.expiresAt ? (' →' + g.expiresAt) : ''))
  .join(' · '))
const transactionRows = computed(() => (detail.value?.transactions || []).map((tx, i) => ({ ...tx, rowKey: i })))
const sessionRows = computed(() => sessionsList.value.map((s, i) => ({ ...s, rowKey: i })))

const sessionColumns = [
  { key: 'token', title: 'Token' },
  { key: 'expires', title: 'Expires', align: 'right' }
]
const orderColumns = [
  { key: 'id', title: 'ID', width: 180 },
  { key: 'item', title: 'Item', dataIndex: 'item' },
  { key: 'amount', title: 'Amount', align: 'right', width: 140 },
  { key: 'status', title: 'Status', width: 120 }
]
const proxyColumns = [
  { key: 'name', title: 'Name', dataIndex: 'name' },
  { key: 'endpoint', title: 'Endpoint' },
  { key: 'type', title: 'Type', dataIndex: 'type', width: 100 },
  { key: 'status', title: 'Status', width: 120 }
]
const txColumns = [
  { key: 'ts', title: 'Time', width: 180 },
  { key: 'type', title: 'Type', width: 120 },
  { key: 'amount', title: 'Amount', align: 'right', width: 140 },
  { key: 'balanceAfter', title: 'Balance', align: 'right', width: 140 },
  { key: 'note', title: 'Note' }
]

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-button @click="back">
        <template #icon><ArrowLeftOutlined /></template>
        Billing
      </a-button>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        Refresh
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />
    <a-card v-if="!detail && loading" loading />

    <template v-if="detail">
      <a-card>
        <template #title>
          <a-space wrap :size="8" class="title-wrap">
            <span>{{ detail.account.email }}</span>
            <a-typography-text type="secondary" class="mono id-text" :copyable="{ text: detail.account.id }">{{ detail.account.id }}</a-typography-text>
          </a-space>
        </template>

        <a-flex wrap="wrap" gap="small" class="actions">
          <a-button v-if="!detail.account.suspended" danger @click="suspend('suspend')">
            <template #icon><StopOutlined /></template>Suspend
          </a-button>
          <a-button v-else @click="suspend('unsuspend')">
            <template #icon><CheckCircleOutlined /></template>Unsuspend
          </a-button>
          <a-button @click="credit">
            <template #icon><WalletOutlined /></template>Credit/Debit
          </a-button>
          <a-button @click="giftCredit">
            <template #icon><GiftOutlined /></template>Tặng free credit
          </a-button>
          <a-button @click="forceReset">
            <template #icon><KeyOutlined /></template>Force password reset
          </a-button>
          <a-button @click="toggle2FAEnforce">
            <template #icon><SafetyOutlined /></template>{{ detail.account.require2FA ? 'Disable 2FA enforce' : 'Enforce 2FA' }}
          </a-button>
        </a-flex>

        <a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">
          <a-descriptions-item label="Name">{{ detail.account.name }}</a-descriptions-item>
          <a-descriptions-item label="Role">
            <a-tag :color="detail.account.role === 'admin' ? 'purple' : 'default'">{{ detail.account.role }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="Balance">
            <span class="mono">{{ Number(detail.balance).toLocaleString() }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="detail.creditGrants?.length" label="Free credit">
            <a-space direction="vertical" :size="0">
              <a-typography-text type="success" strong class="mono">{{ freeCreditTotal.toLocaleString() }}</a-typography-text>
              <a-typography-text type="secondary" class="small">{{ freeCreditBreakdown }}</a-typography-text>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item label="2FA">
            <a-space :size="4" wrap>
              <StatusTag :status="detail.account.totpEnabled ? 'enabled' : 'disabled'" :label="detail.account.totpEnabled ? 'enabled' : 'disabled'" />
              <a-tag v-if="detail.account.require2FA" color="warning" :bordered="false">(enforced)</a-tag>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item label="Email verified">
            <a-tag :color="detail.account.emailVerified ? 'success' : 'error'" :bordered="false">{{ detail.account.emailVerified ? 'yes' : 'no' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="Status">
            <StatusTag v-if="detail.account.suspended" status="suspended" label="SUSPENDED" />
            <StatusTag v-else status="active" label="active" />
          </a-descriptions-item>
          <a-descriptions-item label="Referral code">
            <a-typography-text v-if="detail.account.referralCode" class="mono" :copyable="{ text: detail.account.referralCode }">{{ detail.account.referralCode }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="ToS accepted">
            <span class="mono">{{ detail.account.tosAcceptedAt || '—' }}</span>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <a-card title="Admin notes & tags">
        <a-form layout="vertical" @finish="saveNotes">
          <a-form-item label="Tags (comma separated)">
            <a-input v-model:value="tagsText" placeholder="vip, abuse, paid-2x" />
          </a-form-item>
          <a-form-item label="Notes">
            <a-textarea v-model:value="notes" :rows="4" placeholder="Internal notes (visible to admin only)..." />
          </a-form-item>
          <a-button type="primary" html-type="submit" :loading="savingNotes">
            <template #icon><SaveOutlined /></template>
            {{ savingNotes ? 'Saving…' : 'Save notes' }}
          </a-button>
        </a-form>
      </a-card>

      <a-card :title="`Active sessions (${sessionsList.length})`" :body-style="{ padding: 0 }">
        <template #extra>
          <a-button size="small" danger :disabled="!sessionsList.length" @click="revokeAllSessions">Revoke all</a-button>
        </template>
        <a-table
          :columns="sessionColumns"
          :data-source="sessionRows"
          row-key="rowKey"
          size="small"
          :show-header="false"
          :pagination="{ pageSize: 10, hideOnSinglePage: true }"
          :locale="{ emptyText: 'No active sessions.' }"
        >
          <template #bodyCell="{ column, record: s }">
            <template v-if="column.key === 'token'"><span class="mono">{{ s.token }}</span></template>
            <template v-else-if="column.key === 'expires'">
              <a-typography-text type="secondary" class="mono">expires {{ s.expiresAt?.slice(0, 19).replace('T', ' ') }}</a-typography-text>
            </template>
          </template>
        </a-table>
      </a-card>

      <a-card v-if="detail.orders.length" :title="`Orders (${detail.orders.length})`" :body-style="{ padding: 0 }">
        <a-table
          :columns="orderColumns"
          :data-source="detail.orders"
          row-key="id"
          size="small"
          :scroll="{ x: 640 }"
          :pagination="{ pageSize: 10, hideOnSinglePage: true }"
        >
          <template #bodyCell="{ column, record: o }">
            <template v-if="column.key === 'id'"><a class="mono" @click="viewOrder(o)">{{ o.id }}</a></template>
            <template v-else-if="column.key === 'amount'"><span class="mono">{{ Number(o.amount).toLocaleString() }}</span></template>
            <template v-else-if="column.key === 'status'"><StatusTag :status="o.status" /></template>
          </template>
        </a-table>
      </a-card>

      <a-card v-if="detail.proxies.length" :title="`Proxies (${detail.proxies.length})`" :body-style="{ padding: 0 }">
        <a-table
          :columns="proxyColumns"
          :data-source="detail.proxies"
          row-key="id"
          size="small"
          :scroll="{ x: 640 }"
          :pagination="{ pageSize: 10, hideOnSinglePage: true }"
        >
          <template #bodyCell="{ column, record: p }">
            <template v-if="column.key === 'endpoint'">
              <a-typography-text class="mono" :copyable="{ text: `${p.ip || p.bindIp}:${p.port}` }">{{ p.ip || p.bindIp }}:{{ p.port }}</a-typography-text>
            </template>
            <template v-else-if="column.key === 'status'"><StatusTag :status="p.status" /></template>
          </template>
        </a-table>
      </a-card>

      <a-card v-if="detail.transactions.length" :title="`Transactions (${detail.transactions.length})`" :body-style="{ padding: 0 }">
        <a-table
          :columns="txColumns"
          :data-source="transactionRows"
          row-key="rowKey"
          size="small"
          :scroll="{ x: 760 }"
          :pagination="{ pageSize: 20, hideOnSinglePage: true }"
        >
          <template #bodyCell="{ column, record: tx }">
            <template v-if="column.key === 'ts'"><span class="mono nowrap">{{ tx.ts.slice(0, 19).replace('T', ' ') }}</span></template>
            <template v-else-if="column.key === 'type'"><a-tag :bordered="false">{{ tx.type }}</a-tag></template>
            <template v-else-if="column.key === 'amount'">
              <a-typography-text :type="tx.amount > 0 ? 'success' : 'danger'" class="mono">{{ Number(tx.amount).toLocaleString() }}</a-typography-text>
            </template>
            <template v-else-if="column.key === 'balanceAfter'"><span class="mono">{{ Number(tx.balanceAfter).toLocaleString() }}</span></template>
            <template v-else-if="column.key === 'note'"><a-typography-text type="secondary">{{ tx.note }}</a-typography-text></template>
          </template>
        </a-table>
      </a-card>
    </template>

    <a-modal
      v-model:open="creditOpen"
      title="Credit/Debit"
      :confirm-loading="creditBusy"
      :ok-button-props="{ disabled: creditForm.amount === null || creditForm.amount === undefined }"
      @ok="submitCredit"
    >
      <a-form layout="vertical" :model="creditForm">
        <a-form-item label="Credit (positive) or debit (negative) — amount VND">
          <a-input-number v-model:value="creditForm.amount" class="full-width" autofocus />
        </a-form-item>
        <a-form-item label="Note">
          <a-input v-model:value="creditForm.note" @press-enter="submitCredit" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="giftOpen"
      title="Tặng free credit"
      :confirm-loading="giftBusy"
      :ok-button-props="{ disabled: !(Number(giftForm.amount) > 0) }"
      @ok="submitGift"
    >
      <a-form layout="vertical" :model="giftForm">
        <a-form-item label="Tặng FREE CREDIT (khoá theo loại) — số tiền">
          <a-input-number v-model:value="giftForm.amount" :min="1" class="full-width" autofocus />
        </a-form-item>
        <a-form-item label="Nhóm sản phẩm">
          <a-segmented v-model:value="giftForm.group" :options="giftGroups" />
        </a-form-item>
        <a-form-item label="Hết hạn (YYYY-MM-DD, trống = vô hạn)">
          <a-date-picker v-model:value="giftForm.validUntil" value-format="YYYY-MM-DD" class="full-width" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.title-wrap { font-weight: 600; }
.id-text { font-size: 12px; font-weight: 400; }
.actions { margin-bottom: 16px; }
.small { font-size: 12px; }
</style>
