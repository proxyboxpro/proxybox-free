import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const TOKEN_KEY = 'proxyhub.token'

export const token = ref(localStorage.getItem(TOKEN_KEY) || '')
export const currentUser = ref(null)

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
  try {
    const me = await apiFetch('/api/auth/me')
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
export async function publicStatus() { return apiFetch('/api/public/status') }
