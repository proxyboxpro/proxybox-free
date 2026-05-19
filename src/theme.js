import { ref, watch } from 'vue'

const KEY = 'proxyhub.theme'
const VALID = ['dark', 'light']

export const theme = ref(loadInitial())

function loadInitial() {
  try {
    const saved = localStorage.getItem(KEY)
    if (VALID.includes(saved)) return saved
  } catch { /* localStorage unavailable */ }
  return 'dark'
}

function apply(value) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', value)
}

export function initTheme() {
  apply(theme.value)
  watch(theme, (next) => {
    apply(next)
    try { localStorage.setItem(KEY, next) } catch { /* ignore */ }
  })
}

export function setTheme(value) {
  if (!VALID.includes(value)) return
  theme.value = value
}

export function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}
