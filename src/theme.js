import { computed, ref, watch } from 'vue'
import { theme as antdThemeApi } from 'ant-design-vue'

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
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', value === 'dark' ? DARK_BG : LIGHT_BG)
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

export const isDark = computed(() => theme.value === 'dark')

// ── Ant Design (ant-design-vue 4) theme ────────────────────────────────────
// Brand seed shared by both modes; the dark/light algorithms derive the rest
// of the palette. Dark mode keeps the original "NetOps console" surfaces.
const DARK_BG = '#0a0e14'
const LIGHT_BG = '#f5f7fa'

export const FONT_SANS = "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
export const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

const seed = {
  colorPrimary: '#16a34a',
  colorSuccess: '#22c55e',
  colorWarning: '#f59e0b',
  colorError: '#ef4444',
  colorInfo: '#3b82f6',
  colorLink: '#3b82f6',
  borderRadius: 8,
  fontFamily: FONT_SANS,
  fontFamilyCode: FONT_MONO,
  fontSize: 14,
  wireframe: false
}

const darkTokens = {
  ...seed,
  colorBgBase: DARK_BG,
  colorBgLayout: DARK_BG,
  colorBgContainer: '#11161d',
  colorBgElevated: '#161c25',
  colorBorder: '#2a3240',
  colorBorderSecondary: '#1f2631',
  colorLink: '#58a6ff'
}

const lightTokens = {
  ...seed,
  colorBgLayout: LIGHT_BG
}

export const antdTheme = computed(() => (theme.value === 'dark'
  ? {
      algorithm: antdThemeApi.darkAlgorithm,
      token: darkTokens,
      components: {
        Layout: { colorBgHeader: '#0d1219', colorBgBody: DARK_BG, colorBgTrigger: '#161c25' },
        Menu: { colorItemBg: 'transparent', colorSubItemBg: 'transparent' },
        Table: { colorFillAlter: '#151b24' }
      }
    }
  : {
      algorithm: antdThemeApi.defaultAlgorithm,
      token: lightTokens,
      components: {
        Layout: { colorBgHeader: '#ffffff', colorBgBody: LIGHT_BG, colorBgTrigger: '#f0f2f5' },
        Menu: { colorItemBg: 'transparent', colorSubItemBg: 'transparent' }
      }
    }))
