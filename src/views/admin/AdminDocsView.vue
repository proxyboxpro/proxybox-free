<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { confirmAsync, message } from '../../ui/feedback'

const { t } = useI18n()
const docs = ref([])
const err = ref('')
const loading = ref(false)
const editing = ref(null)  // doc being edited (or new draft)
const creating = ref(false)
const saving = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try { docs.value = await apiFetch('/api/admin/docs') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}

function startNew() {
  creating.value = true
  editing.value = {
    id: '', slug: '', title: '', category: t('admin.docs.catFallback'), order: 99, published: true, body: ''
  }
}
function startEdit(d) {
  creating.value = false
  editing.value = { ...d }
}
function cancel() {
  editing.value = null
  creating.value = false
}

async function save() {
  if (!editing.value || saving.value) return
  saving.value = true
  try {
    if (creating.value) {
      const created = await apiFetch('/api/admin/docs', { method: 'POST', body: editing.value })
      docs.value.push(created)
      message.success(t('admin.docs.flashCreated', { title: created.title }))
    } else {
      const updated = await apiFetch(`/api/admin/docs/${editing.value.id}`, { method: 'PATCH', body: editing.value })
      const idx = docs.value.findIndex((d) => d.id === updated.id)
      if (idx >= 0) docs.value[idx] = updated
      message.success(t('admin.docs.flashUpdated', { title: updated.title }))
    }
    editing.value = null; creating.value = false
  } catch (e) { message.error(e.message) }
  finally { saving.value = false }
}

async function remove(d) {
  if (!(await confirmAsync({ title: t('admin.docs.confirmDel', { title: d.title }), danger: true }))) return
  try {
    await apiFetch(`/api/admin/docs/${d.id}`, { method: 'DELETE' })
    docs.value = docs.value.filter((x) => x.id !== d.id)
    message.success(t('admin.docs.flashDeleted'))
  } catch (e) { message.error(e.message) }
}

const grouped = computed(() => {
  const map = new Map()
  for (const d of docs.value) {
    const cat = d.category || t('admin.docs.catFallback')
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(d)
  }
  return [...map.entries()].map(([cat, items]) => ({
    cat, items: items.sort((a, b) => (a.order || 0) - (b.order || 0))
  }))
})

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.docs.eyebrow') }} ({{ docs.length }})</a-typography-text>
      <a-space wrap>
        <a-button :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          {{ t('admin.docs.refresh') }}
        </a-button>
        <a-button type="primary" @click="startNew">
          <template #icon><PlusOutlined /></template>
          {{ t('admin.docs.newDoc') }}
        </a-button>
      </a-space>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" closable @close="err = ''" />

    <a-card :title="t('admin.docs.listTitle')" :loading="loading && !docs.length">
      <a-empty v-if="!docs.length">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <template #description><span v-html="t('admin.docs.empty')" /></template>
      </a-empty>
      <template v-else>
        <div v-for="g in grouped" :key="g.cat" class="group">
          <a-divider orientation="left" orientation-margin="0" plain class="group-title">
            <a-typography-text type="secondary" strong>{{ g.cat }}</a-typography-text>
          </a-divider>
          <a-list :data-source="g.items" size="small" bordered :row-key="(d) => d.id">
            <template #renderItem="{ item: d }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>
                    <a-space wrap :size="[8, 2]">
                      <span>{{ d.title }}</span>
                      <a-tag :color="d.published ? 'success' : 'default'" :bordered="false">
                        {{ d.published ? t('admin.docs.statusPublished') : t('admin.docs.statusDraft') }}
                      </a-tag>
                    </a-space>
                  </template>
                  <template #description>
                    <a-space wrap :size="[12, 0]">
                      <span class="mono">{{ d.slug }}</span>
                      <span class="mono">order: {{ d.order }}</span>
                    </a-space>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-tooltip :title="t('admin.common.edit')">
                    <a-button size="small" @click="startEdit(d)"><template #icon><EditOutlined /></template></a-button>
                  </a-tooltip>
                  <a-tooltip :title="t('admin.common.delete')">
                    <a-button size="small" danger @click="remove(d)"><template #icon><DeleteOutlined /></template></a-button>
                  </a-tooltip>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </template>
    </a-card>

    <!-- Editor modal -->
    <a-modal
      :open="!!editing"
      :title="editing ? (creating ? t('admin.docs.editorNew') : t('admin.docs.editorEdit', { title: editing.title })) : ''"
      :width="820"
      :confirm-loading="saving"
      :ok-text="saving ? t('admin.docs.saving') : (creating ? t('admin.docs.btnCreate') : t('admin.docs.btnSave'))"
      :cancel-text="t('admin.docs.cancel')"
      destroy-on-close
      @ok="save"
      @cancel="cancel"
    >
      <a-form v-if="editing" :model="editing" layout="vertical" class="editor">
        <a-row :gutter="12">
          <a-col :xs="24" :md="11">
            <a-form-item :label="t('admin.docs.fieldTitle')" name="title">
              <a-input v-model:value="editing.title" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="7">
            <a-form-item :label="t('admin.docs.fieldCategory')" name="category">
              <a-input v-model:value="editing.category" :placeholder="t('admin.docs.categoryPh')" />
            </a-form-item>
          </a-col>
          <a-col :xs="12" :md="3">
            <a-form-item :label="t('admin.docs.fieldOrder')" name="order">
              <a-input-number v-model:value="editing.order" :min="0" class="full-width" />
            </a-form-item>
          </a-col>
          <a-col :xs="12" :md="3">
            <a-form-item :label="t('admin.docs.fieldPublished')" name="published">
              <a-switch v-model:checked="editing.published" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item :label="t('admin.docs.fieldSlug')" name="slug">
          <a-input v-model:value="editing.slug" :placeholder="t('admin.docs.slugPh')" />
        </a-form-item>
        <a-form-item :label="t('admin.docs.fieldBody')" name="body">
          <a-textarea v-model:value="editing.body" :rows="14" class="mono body-input" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.group + .group { margin-top: 8px; }
.group-title { margin: 0 0 8px; }
.editor { margin-top: 12px; }
.body-input { font-size: 12px; line-height: 1.55; }
</style>
