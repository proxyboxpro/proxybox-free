import { reactive, watch } from 'vue'
import { currentUser } from '../api'

// Default profile values shown until the signed-in account overrides them in
// the watcher below. Operators of a fresh install land on these placeholders
// for ~1 frame before the API call to /auth/me populates real data.
export const profile = reactive({
  name: 'Administrator',
  email: 'admin@example.com',
  phone: '',
  company: '',
  timezone: 'UTC',
  language: 'English',
  twoFactor: true,
  emailAlerts: true,
  lowBalanceAlerts: true
})

// Keep the displayed profile in sync with the signed-in account.
watch(currentUser, (user) => {
  if (user?.name) profile.name = user.name
  if (user?.email) profile.email = user.email
}, { immediate: true })
