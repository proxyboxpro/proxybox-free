<script setup>
// Theme (dark/light) toggle + VI/EN language segmented control.
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import { theme, toggleTheme } from '../../theme'

defineProps({ showLang: { type: Boolean, default: true } })
const { t, locale, setLocale } = useI18n()
const lang = computed({ get: () => locale.value, set: (v) => setLocale(v) })
</script>

<template>
  <a-space :size="8">
    <a-tooltip :title="theme === 'dark' ? t('app.themeLight') : t('app.themeDark')">
      <a-button shape="circle" :aria-label="theme === 'dark' ? t('app.themeLight') : t('app.themeDark')" @click="toggleTheme">
        <template #icon>
          <BulbFilled v-if="theme === 'dark'" />
          <BulbOutlined v-else />
        </template>
      </a-button>
    </a-tooltip>
    <a-segmented v-if="showLang" v-model:value="lang" size="small" :options="[{ label: 'VI', value: 'vi' }, { label: 'EN', value: 'en' }]" />
  </a-space>
</template>
