import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { fetchMe, token } from './api'
import { initTheme } from './theme'
import './styles.css'

// Apply saved theme synchronously to avoid flash-of-wrong-theme.
initTheme()

;(async () => {
  // Hydrate user identity before mounting so the router's role-based redirect
  // (admin → /admin/dashboard, customer → /dashboard) has the right info on first nav.
  if (token.value) {
    try { await fetchMe() } catch { /* ignore — router will bounce to /login on next 401 */ }
  }
  createApp(App).use(router).mount('#app')
})()
