<script setup>
import { computed, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/vi'
import viVN from 'ant-design-vue/es/locale/vi_VN'
import enUS from 'ant-design-vue/es/locale/en_US'
import { fetchMe, adminBackup, currentUser, stopImpersonation } from './api'
import { locale } from './i18n'
import { antdTheme } from './theme'
import { FeedbackBinder } from './ui/feedback'

const antLocale = computed(() => (locale.value === 'vi' ? viVN : enUS))
watch(locale, (l) => dayjs.locale(l === 'vi' ? 'vi' : 'en'), { immediate: true })

onMounted(() => {
  fetchMe()
})

function returnToAdmin() {
  stopImpersonation()
  // Full reload to /admin/users so customer-scoped stores are flushed cleanly.
  window.location.assign('/admin/users')
}
</script>

<template>
  <a-config-provider :theme="antdTheme" :locale="antLocale">
    <a-app>
      <FeedbackBinder />
      <a-alert v-if="adminBackup" type="warning" banner class="impersonation-bar">
        <template #message>
          <a-flex align="center" justify="center" gap="small" wrap="wrap">
            <span>
              Đang đăng nhập với tư cách
              <strong>{{ currentUser?.email || 'khách hàng' }}</strong>
              <a-typography-text v-if="adminBackup.user?.email" type="secondary"> · admin: {{ adminBackup.user.email }}</a-typography-text>
            </span>
            <a-button size="small" type="primary" danger @click="returnToAdmin">
              <template #icon><RollbackOutlined /></template>
              Thoát &amp; quay lại admin
            </a-button>
          </a-flex>
        </template>
      </a-alert>
      <RouterView />
    </a-app>
  </a-config-provider>
</template>

<style>
.impersonation-bar { position: sticky; top: 0; z-index: 1001; }
</style>
