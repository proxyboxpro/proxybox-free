<script setup>
import { onMounted } from 'vue'
import { fetchMe, adminBackup, currentUser, stopImpersonation } from './api'

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
  <div v-if="adminBackup" class="impersonation-bar">
    <span class="imp-text">
      Đang đăng nhập với tư cách
      <strong>{{ currentUser?.email || 'khách hàng' }}</strong>
      <span v-if="adminBackup.user?.email" class="imp-admin">· admin: {{ adminBackup.user.email }}</span>
    </span>
    <button type="button" class="imp-return" @click="returnToAdmin">↩ Thoát &amp; quay lại admin</button>
  </div>
  <div :class="{ 'has-impersonation-bar': adminBackup }">
    <RouterView />
  </div>
</template>

<style>
.impersonation-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 40px;
  padding: 0 16px;
  background: #f59e0b;
  color: #1a1205;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.impersonation-bar .imp-text { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.impersonation-bar .imp-admin { font-weight: 500; opacity: 0.8; font-size: 12px; }
.impersonation-bar .imp-return {
  background: #1a1205;
  color: #fbbf24;
  border: none;
  border-radius: 7px;
  padding: 5px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.impersonation-bar .imp-return:hover { background: #000; }
/* Push the app down so the fixed bar never overlaps the layout chrome. */
.has-impersonation-bar { padding-top: 40px; }
</style>
