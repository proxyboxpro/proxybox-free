<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch, adminListUserSessions, adminRevokeUserSessions, adminForcePasswordReset, adminUpdateUserNotes, adminEnforce2FA } from '../../api'

const route = useRoute(); const router = useRouter()
const detail = ref(null), err = ref(''), flash = ref('')
const sessionsList = ref([])
const notes = ref('')
const tagsText = ref('')
const savingNotes = ref(false)

async function refresh() {
  err.value = ''
  try {
    detail.value = await apiFetch(`/api/admin/users/${route.params.userId}/detail`)
    notes.value = detail.value?.account?.notes || ''
    tagsText.value = (detail.value?.account?.tags || []).join(', ')
    await loadSessions()
  } catch (e) { err.value = e.message }
}
async function loadSessions() {
  try { sessionsList.value = await adminListUserSessions(route.params.userId) }
  catch { sessionsList.value = [] }
}
async function suspend(action) {
  try { await apiFetch(`/api/admin/users/${route.params.userId}/${action}`, { method: 'POST' }); await refresh() }
  catch (e) { err.value = e.message }
}
async function credit() {
  const a = prompt('Credit (positive) or debit (negative) — amount VND:', '50000')
  if (!a) return
  const note = prompt('Note:', 'admin adjustment') || ''
  try { await apiFetch(`/api/admin/users/${route.params.userId}/credit`, { method: 'POST', body: { amount: Number(a), note } }); await refresh() }
  catch (e) { err.value = e.message }
}
async function revokeAllSessions() {
  if (!confirm('Revoke all active sessions for this user? They will be logged out everywhere.')) return
  try { const r = await adminRevokeUserSessions(route.params.userId); flash.value = `Revoked ${r.revoked} sessions`; await loadSessions() }
  catch (e) { err.value = e.message }
}
async function forceReset() {
  if (!confirm('Force password reset? User will receive email + all sessions revoked.')) return
  try { await adminForcePasswordReset(route.params.userId); flash.value = 'Password reset email sent.'; await refresh() }
  catch (e) { err.value = e.message }
}
async function saveNotes() {
  savingNotes.value = true
  try {
    const tags = tagsText.value.split(',').map((s) => s.trim()).filter(Boolean)
    await adminUpdateUserNotes(route.params.userId, { notes: notes.value, tags })
    flash.value = 'Notes saved.'
  } catch (e) { err.value = e.message }
  finally { savingNotes.value = false }
}
async function toggle2FAEnforce() {
  const next = !(detail.value?.account?.require2FA)
  try { await adminEnforce2FA(route.params.userId, next); flash.value = next ? '2FA enforcement enabled.' : '2FA enforcement disabled.'; await refresh() }
  catch (e) { err.value = e.message }
}
function back() { router.push({ name: 'admin-users' }) }
function viewOrder(o) { router.push({ name: 'admin-orders' }); void o }

onMounted(refresh)
</script>
<template>
  <section class="page-stack">
    <button class="ghost-button" type="button" @click="back">← Billing</button>
    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section v-if="detail" class="surface">
      <div class="section-head">
        <h2>{{ detail.account.email }} <span style="color:var(--muted); font-size:13px; margin-left:8px">{{ detail.account.id }}</span></h2>
        <div class="action-row">
          <button v-if="!detail.account.suspended" class="ghost-button" type="button" @click="suspend('suspend')">Suspend</button>
          <button v-else class="ghost-button" type="button" @click="suspend('unsuspend')">Unsuspend</button>
          <button class="ghost-button" type="button" @click="credit">Credit/Debit</button>
          <button class="ghost-button" type="button" @click="forceReset">Force password reset</button>
          <button class="ghost-button" type="button" @click="toggle2FAEnforce">{{ detail.account.require2FA ? 'Disable 2FA enforce' : 'Enforce 2FA' }}</button>
        </div>
      </div>
      <div class="detail-grid">
        <div><span>Name</span><strong>{{ detail.account.name }}</strong></div>
        <div><span>Role</span><strong>{{ detail.account.role }}</strong></div>
        <div><span>Balance</span><strong>{{ Number(detail.balance).toLocaleString() }}</strong></div>
        <div><span>2FA</span><strong>{{ detail.account.totpEnabled ? 'enabled' : 'disabled' }}<span v-if="detail.account.require2FA" style="margin-left:6px; color:#f59e0b">(enforced)</span></strong></div>
        <div><span>Email verified</span><strong :style="detail.account.emailVerified ? 'color:#15803d' : 'color:#b91c1c'">{{ detail.account.emailVerified ? 'yes' : 'no' }}</strong></div>
        <div><span>Status</span><strong :style="detail.account.suspended ? 'color:#b91c1c' : ''">{{ detail.account.suspended ? 'SUSPENDED' : 'active' }}</strong></div>
        <div><span>Referral code</span><strong class="cell-mono">{{ detail.account.referralCode }}</strong></div>
        <div><span>ToS accepted</span><strong>{{ detail.account.tosAcceptedAt || '—' }}</strong></div>
      </div>
    </section>

    <section v-if="detail" class="surface" style="margin-top:14px">
      <div class="section-head"><h2>Admin notes &amp; tags</h2></div>
      <div style="display:flex; flex-direction:column; gap:8px">
        <label class="input-field">
          <span>Tags (comma separated)</span>
          <input v-model="tagsText" type="text" placeholder="vip, abuse, paid-2x" />
        </label>
        <label class="input-field">
          <span>Notes</span>
          <textarea v-model="notes" rows="4" placeholder="Internal notes (visible to admin only)..."></textarea>
        </label>
        <div><button class="primary-action" type="button" :disabled="savingNotes" @click="saveNotes">{{ savingNotes ? 'Saving…' : 'Save notes' }}</button></div>
      </div>
    </section>

    <section v-if="detail" class="surface" style="margin-top:14px">
      <div class="section-head">
        <h2>Active sessions ({{ sessionsList.length }})</h2>
        <div class="action-row">
          <button class="ghost-button" type="button" :disabled="!sessionsList.length" @click="revokeAllSessions">Revoke all</button>
        </div>
      </div>
      <div v-if="!sessionsList.length" style="color:var(--muted); padding:12px">No active sessions.</div>
      <div v-else class="data-table">
        <div v-for="(s, i) in sessionsList" :key="i" class="table-row" style="grid-template-columns: 1fr 1fr">
          <span class="cell-mono">{{ s.token }}</span>
          <span class="cell-mono" style="color:var(--muted)">expires {{ s.expiresAt?.slice(0, 19).replace('T', ' ') }}</span>
        </div>
      </div>
    </section>

    <section v-if="detail && detail.orders.length" class="surface" style="margin-top:14px">
      <div class="section-head"><h2>Orders ({{ detail.orders.length }})</h2></div>
      <div class="data-table">
        <div v-for="o in detail.orders" :key="o.id" class="table-row" style="grid-template-columns: 1fr 2fr 1fr 1fr">
          <span class="cell-mono">{{ o.id }}</span>
          <span>{{ o.item }}</span>
          <span class="cell-mono">{{ Number(o.amount).toLocaleString() }}</span>
          <span><span class="tag">{{ o.status }}</span></span>
        </div>
      </div>
    </section>

    <section v-if="detail && detail.proxies.length" class="surface" style="margin-top:14px">
      <div class="section-head"><h2>Proxies ({{ detail.proxies.length }})</h2></div>
      <div class="data-table">
        <div v-for="p in detail.proxies" :key="p.id" class="table-row" style="grid-template-columns: 1fr 1.4fr 1fr 1fr">
          <span>{{ p.name }}</span>
          <span class="cell-mono">{{ p.ip || p.bindIp }}:{{ p.port }}</span>
          <span>{{ p.type }}</span>
          <span><span :class="['status-pill', p.status]">{{ p.status }}</span></span>
        </div>
      </div>
    </section>

    <section v-if="detail && detail.transactions.length" class="surface" style="margin-top:14px">
      <div class="section-head"><h2>Transactions ({{ detail.transactions.length }})</h2></div>
      <div class="data-table">
        <div v-for="(t, i) in detail.transactions" :key="i" class="table-row" style="grid-template-columns: 1.6fr .8fr 1fr 1fr 2fr">
          <span class="cell-mono">{{ t.ts.slice(0, 19).replace('T', ' ') }}</span>
          <span><span class="tag">{{ t.type }}</span></span>
          <span class="cell-mono" :style="{color: t.amount > 0 ? '#15803d' : '#b91c1c'}">{{ Number(t.amount).toLocaleString() }}</span>
          <span class="cell-mono">{{ Number(t.balanceAfter).toLocaleString() }}</span>
          <span style="color:var(--muted)">{{ t.note }}</span>
        </div>
      </div>
    </section>
  </section>
</template>
