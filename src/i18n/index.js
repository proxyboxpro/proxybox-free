import { computed, ref } from 'vue'
import vi from './vi.js'
import en from './en.js'

const dictionaries = { vi, en }
export const SUPPORTED_LOCALES = Object.keys(dictionaries)
export const DEFAULT_LOCALE = 'en'
const LOCALE_KEY = 'proxyhub.locale'

function detectInitialLocale() {
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem(LOCALE_KEY)
    if (s && SUPPORTED_LOCALES.includes(s)) return s
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const tag = String(navigator.language).toLowerCase()
    if (tag.startsWith('vi')) return 'vi'
  }
  return DEFAULT_LOCALE
}
const current = ref(detectInitialLocale())

export const locale = computed(() => current.value)

export function setLocale(value) {
  if (dictionaries[value] && value !== current.value) {
    current.value = value
    try { localStorage.setItem(LOCALE_KEY, value) } catch { /* ignore */ }
  }
}

export function translate(key, vars) {
  const raw = dictionaries[current.value]?.[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key
  if (!vars || typeof raw !== 'string') return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : `{${name}}`))
}

export function useI18n() {
  return { t: translate, locale, setLocale }
}
