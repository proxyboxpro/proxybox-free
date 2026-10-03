<script setup>
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { confirmAsync, message } from '../../ui/feedback'

const { t } = useI18n()
const list = ref([])
const err = ref('')
const loading = ref(false)
const busy = ref(false)

const form = ref({
  text: '',
  severity: 'info',     // info | warning | error | success
  visibility: 'public', // public | customer | admin
  expiresAt: null,      // 'YYYY-MM-DDTHH:mm' (local time) or null
  dismissible: true
})

async function refresh() {
  err.value = ''
  loading.value = true
  try { list.value = await apiFetch('/api/admin/announcements') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

async function create() {
  if (!form.value.text.trim() || busy.value) return
  busy.value = true
  try {
    const body = {
      text: form.value.text.trim(),
      severity: form.value.severity,
      visibility: form.value.visibility,
      dismissible: form.value.dismissible,
      expiresAt: form.value.expiresAt ? new Date(form.value.expiresAt).toISOString() : null
    }
    await apiFetch('/api/admin/announcements', { method: 'POST', body })
    message.success(t('admin.ann.created'))
    form.value.text = ''; form.value.expiresAt = null
    await refresh()
  } catch (e) { message.error(e.message) }
  finally { busy.value = false }
}

async function remove(id) {
  if (!(await confirmAsync({ title: t('admin.ann.confirmDel'), danger: true }))) return
  try { await apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' }); await refresh() }
  catch (e) { message.error(e.message) }
}

function fmtTs(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—' }
// Severity values map 1:1 onto <a-alert type>.
function alertType(sev) {
  return ['error', 'warning', 'success'].includes(sev) ? sev : 'info'
}
function isExpired(a) {
  return a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <!-- admin.ann.title equals the layout header title (page.announcements) -->
      <a-typography-text type="secondary">{{ t('admin.ann.subtitle') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card>
      <template #title><PlusOutlined /> {{ t('admin.ann.createTitle') }}</template>
      <a-form :model="form" layout="vertical" @finish="create">
        <a-form-item :label="t('admin.ann.text')" name="text">
          <a-textarea
            v-model:value="form.text"
            :rows="3"
            :maxlength="600"
            show-count
            :placeholder="t('admin.ann.textPlaceholder')"
          />
        </a-form-item>

        <a-row :gutter="16">
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.ann.severity')" name="severity">
              <a-select v-model:value="form.severity">
                <a-select-option value="info">{{ t('admin.ann.sevInfoOpt') }}</a-select-option>
                <a-select-option value="success">{{ t('admin.ann.sevSuccessOpt') }}</a-select-option>
                <a-select-option value="warning">{{ t('admin.ann.sevWarningOpt') }}</a-select-option>
                <a-select-option value="error">{{ t('admin.ann.sevErrorOpt') }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="t('admin.ann.visibility')" name="visibility">
              <a-select v-model:value="form.visibility">
                <a-select-option value="public">{{ t('admin.ann.visPublicOpt') }}</a-select-option>
                <a-select-option value="customer">{{ t('admin.ann.visCustomerOpt') }}</a-select-option>
                <a-select-option value="admin">{{ t('admin.ann.visAdminOpt') }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item :label="`${t('admin.ann.expiresAt')} (${t('cust.buy.optional')})`" name="expiresAt">
              <a-date-picker
                v-model:value="form.expiresAt"
                show-time
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm"
                class="full-width"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item name="dismissible">
          <a-checkbox v-model:checked="form.dismissible">{{ t('admin.ann.dismissible') }}</a-checkbox>
        </a-form-item>

        <a-alert
          :type="alertType(form.severity)"
          show-icon
          :message="form.text || t('admin.ann.previewEmpty')"
          class="preview"
        />

        <a-button type="primary" html-type="submit" :loading="busy" :disabled="!form.text.trim()">
          <template #icon><PlusOutlined /></template>
          {{ t('admin.ann.create') }}
        </a-button>
      </a-form>
    </a-card>

    <a-card v-if="list.length" :title="`${t('admin.ann.active')} (${list.length})`">
      <a-flex vertical gap="small">
        <a-alert
          v-for="a in list"
          :key="a.id"
          :type="alertType(a.severity)"
          show-icon
          :class="{ expired: isExpired(a) }"
        >
          <template #message>{{ a.text }}</template>
          <template #description>
            <a-space wrap :size="[12, 2]" class="meta">
              <a-typography-text type="secondary" class="mono">{{ a.id }}</a-typography-text>
              <a-tag :bordered="false">{{ a.visibility }}</a-tag>
              <a-typography-text v-if="a.expiresAt" :type="isExpired(a) ? 'danger' : 'secondary'">
                {{ isExpired(a) ? t('admin.ann.expired') : t('admin.ann.expiresOn') }}: {{ fmtTs(a.expiresAt) }}
              </a-typography-text>
              <a-typography-text v-else type="secondary">{{ t('admin.ann.noExpiry') }}</a-typography-text>
              <a-typography-text v-if="!a.dismissible" type="warning">{{ t('admin.ann.notDismissible') }}</a-typography-text>
              <a-typography-text type="secondary" class="mono">{{ t('admin.ann.created') }}: {{ fmtTs(a.createdAt) }}</a-typography-text>
            </a-space>
          </template>
          <template #action>
            <a-button size="small" danger @click="remove(a.id)">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </template>
        </a-alert>
      </a-flex>
    </a-card>
    <a-card v-else>
      <a-empty :description="t('admin.ann.empty')" />
    </a-card>
  </div>
</template>

<style scoped>
.preview { margin-bottom: 16px; }
.meta { font-size: 12px; }
.expired { opacity: 0.5; }
</style>
