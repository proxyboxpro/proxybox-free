import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const TOKEN_KEY = 'proxyhub.token'
// While impersonating a customer, the admin's own token + identity are stashed
// here so a banner can offer "return to admin" and restore the session.
const ADMIN_TOKEN_KEY = 'proxyhub.admin_token'
const ADMIN_USER_KEY = 'proxyhub.admin_user'

export const token = ref(localStorage.getItem(TOKEN_KEY) || '')
export const currentUser = ref(null)

function loadAdminBackup() {
  const t = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (!t) return null
  try { return { token: t, user: JSON.parse(localStorage.getItem(ADMIN_USER_KEY) || 'null') } }
  catch { return { token: t, user: null } }
}
// Non-null while an admin is impersonating someone. Drives the banner.
export const adminBackup = ref(loadAdminBackup())

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data || null
  }
}

export function setToken(value) {
  token.value = value || ''
  if (value) localStorage.setItem(TOKEN_KEY, value)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
    ...(options.headers || {})
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  })
  if (response.status === 204) return null
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    // Don't auto-clear token on the TOTP-challenge 401 — the user isn't logged
    // in yet (no token to clear), and AuthView needs to surface the totpRequired
    // flag from the response body to render the TOTP input.
    if (response.status === 401 && !data?.totpRequired) {
      setToken('')
      currentUser.value = null
    }
    throw new ApiError(data?.error || `API ${response.status}`, response.status, data)
  }
  return data
}

export async function login(email, password, totpCode) {
  const body = { email, password }
  if (totpCode) body.totpCode = totpCode
  const data = await apiFetch('/api/auth/login', { method: 'POST', body })
  setToken(data.token)
  currentUser.value = data.user
  return data.user
}

export async function register(name, email, password, acceptedTos = true, referralCode = '') {
  const data = await apiFetch('/api/auth/register', { method: 'POST', body: { name, email, password, acceptedTos, referralCode } })
  setToken(data.token)
  currentUser.value = data.user
  return data.user
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // ignore — clearing the local token is enough
  }
  setToken('')
  currentUser.value = null
}

export async function fetchMe() {
  if (!token.value) return null
  // Admin sessions resolve via /api/auth/me. Customer sessions are blocked there
  // by the admin-only gate, so fall back to the v1 user namespace — this also
  // populates currentUser (with role) while an admin is impersonating a customer.
  try {
    const me = await apiFetch('/api/auth/me')
    if (me?.email) { currentUser.value = me; return currentUser.value }
  } catch { /* fall through to the customer namespace */ }
  try {
    const me = await apiFetch('/api/v1/user/auth/me')
    currentUser.value = me?.email ? me : null
    return currentUser.value
  } catch {
    return null
  }
}

// ── Password recovery + email verification ──────────────────────────────────
export async function forgotPassword(email) {
  return apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } })
}
export async function resetPassword(resetToken, password) {
  return apiFetch('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password } })
}
export async function verifyEmail(verifyToken) {
  return apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
}
export async function resendVerifyEmail() {
  return apiFetch('/api/auth/resend-verify', { method: 'POST' })
}

// ── In-app notifications ────────────────────────────────────────────────────
export async function listNotifications() { return apiFetch('/api/v1/user/notifications') }
export async function markNotificationRead(id) { return apiFetch(`/api/v1/user/notifications/${id}/read`, { method: 'POST' }) }
export async function markAllNotificationsRead() { return apiFetch('/api/v1/user/notifications/read-all', { method: 'POST' }) }
export async function clearNotifications() { return apiFetch('/api/v1/user/notifications', { method: 'DELETE' }) }

// ── Admin impersonation ("login as user") ──────────────────────────────────
// Mints a customer session server-side, stashes the admin's own token/identity
// locally, then swaps the active token to the customer's. stopImpersonation()
// restores the admin session.
export async function adminImpersonate(userId) {
  const data = await apiFetch(`/api/admin/users/${userId}/impersonate`, { method: 'POST' })
  localStorage.setItem(ADMIN_TOKEN_KEY, token.value || '')
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(currentUser.value || null))
  adminBackup.value = { token: token.value || '', user: currentUser.value || null }
  setToken(data.token)
  currentUser.value = data.user
  return data.user
}
export function stopImpersonation() {
  const b = adminBackup.value
  localStorage.removeItem(ADMIN_TOKEN_KEY)
  localStorage.removeItem(ADMIN_USER_KEY)
  adminBackup.value = null
  if (b && b.token) {
    setToken(b.token)
    currentUser.value = b.user
    return true
  }
  return false
}

// ── Admin user management extensions ───────────────────────────────────────
export async function adminListUserSessions(userId) { return apiFetch(`/api/admin/users/${userId}/sessions`) }
export async function adminRevokeUserSessions(userId) { return apiFetch(`/api/admin/users/${userId}/sessions`, { method: 'DELETE' }) }
export async function adminForcePasswordReset(userId) { return apiFetch(`/api/admin/users/${userId}/force-reset`, { method: 'POST' }) }
export async function adminUpdateUserNotes(userId, body) { return apiFetch(`/api/admin/users/${userId}/notes`, { method: 'PATCH', body }) }
export async function adminEnforce2FA(userId, enforce) { return apiFetch(`/api/admin/users/${userId}/enforce-2fa`, { method: 'POST', body: { enforce } }) }
export async function adminDeleteUser(userId, { force = false } = {}) { return apiFetch(`/api/admin/users/${userId}${force ? '?force=1' : ''}`, { method: 'DELETE' }) }
export async function adminEmailPreview(key, sample) { return apiFetch('/api/admin/email-templates/preview', { method: 'POST', body: { key, sample } }) }
export async function adminSystemStatus() { return apiFetch('/api/admin/system/status') }
export async function adminAnalyticsHeatmap() { return apiFetch('/api/admin/analytics/heatmap') }
export async function adminAnalyticsChurn() { return apiFetch('/api/admin/analytics/churn') }
export async function adminRevenueBreakdown() { return apiFetch('/api/admin/revenue/breakdown') }

// ── Public ──────────────────────────────────────────────────────────────────
