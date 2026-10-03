<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message, confirmAsync } from '../../ui/feedback'

const { t } = useI18n()
const zones = ref([])
const newZone = ref({ id: '', name: '', flag: '', timezone: 'Asia/Ho_Chi_Minh' })
const err = ref('')
const loading = ref(false)
const adding = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try { zones.value = await apiFetch('/api/admin/zones') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function addZone() {
  if (!newZone.value.id) return
  adding.value = true
  try {
    zones.value = await apiFetch('/api/admin/zones', { method: 'POST', body: newZone.value })
    newZone.value = { id: '', name: '', flag: '', timezone: 'Asia/Ho_Chi_Minh' }
    message.success(t('admin.zones.added'))
  } catch (e) { message.error(e.message) }
  finally { adding.value = false }
}
async function deleteZone(id) {
  if (!(await confirmAsync({ title: t('admin.zones.confirmDel', { id }), danger: true }))) return
  try {
    await apiFetch(`/api/admin/zones/${id}`, { method: 'DELETE' })
    zones.value = zones.value.filter((z) => z.id !== id)
  } catch (e) { message.error(e.message) }
}

const columns = computed(() => [
  { title: t('admin.zones.colId'), key: 'id', dataIndex: 'id' },
  { title: t('admin.zones.colName'), key: 'name', dataIndex: 'name' },
  { title: t('admin.zones.colTimezone'), key: 'timezone', dataIndex: 'timezone', responsive: ['sm'] },
  { title: t('admin.zones.colOnline'), key: 'onlineNodes', dataIndex: 'onlineNodes', align: 'right', width: 130 },
  { title: '', key: 'actions', align: 'right', width: 110 }
])

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.zones.eyebrow') }} ({{ zones.length }})</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card :title="t('admin.zones.title')" :body-style="{ paddingTop: '12px' }">
      <a-typography-paragraph type="secondary">
        <span v-html="t('admin.zones.hint')"></span>
      </a-typography-paragraph>
      <a-table
        :columns="columns"
        :data-source="zones"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="middle"
        :locale="{ emptyText: t('admin.zones.empty') }"
      >
        <template #bodyCell="{ column, record: z }">
          <template v-if="column.key === 'id'">
            <span class="mono">{{ z.id }}</span>
          </template>
          <template v-else-if="column.key === 'name'">
            {{ z.flag }} {{ z.name }}
          </template>
          <template v-else-if="column.key === 'timezone'">
            <a-typography-text type="secondary" class="mono">{{ z.timezone }}</a-typography-text>
          </template>
          <template v-else-if="column.key === 'onlineNodes'">
            <a-badge :status="z.onlineNodes ? 'success' : 'default'" :text="String(z.onlineNodes ?? 0)" />
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-button size="small" danger @click="deleteZone(z.id)">
              <template #icon><DeleteOutlined /></template>
              {{ t('admin.common.delete') }}
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card :title="t('admin.zones.addTitle')">
      <a-form :model="newZone" layout="vertical" @finish="addZone">
        <a-row :gutter="[12, 0]">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.zones.fieldId')" name="id">
              <a-input v-model:value="newZone.id" class="mono" placeholder="vn-da-nang" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.zones.fieldName')" name="name">
              <a-input v-model:value="newZone.name" placeholder="Vietnam · Da Nang" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.zones.fieldFlag')" name="flag">
              <a-input v-model:value="newZone.flag" placeholder="VN" :maxlength="8" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-form-item :label="t('admin.zones.fieldTimezone')" name="timezone">
              <a-input v-model:value="newZone.timezone" class="mono" placeholder="Asia/Ho_Chi_Minh" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary" html-type="submit" :loading="adding" :disabled="!newZone.id">
          {{ t('admin.zones.add') }}
        </a-button>
      </a-form>
    </a-card>
  </div>
</template>
