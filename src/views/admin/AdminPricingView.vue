<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'
import { message } from '../../ui/feedback'

const { t } = useI18n()
const pricing = ref(null)
const newTier = ref({ min: 10, discount: 0.1 })
const err = ref('')
const loading = ref(false)
const saving = ref(false)

async function refresh() {
  err.value = ''
  loading.value = true
  try { pricing.value = await apiFetch('/api/admin/pricing') }
  catch (e) { err.value = e.message }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  try {
    pricing.value = await apiFetch('/api/admin/pricing', { method: 'PATCH', body: pricing.value })
    message.success(t('admin.pricing.saved'))
  } catch (e) { message.error(e.message) }
  finally { saving.value = false }
}
function addTier() {
  pricing.value.tiers = pricing.value.tiers || []
  pricing.value.tiers.push({ ...newTier.value })
  newTier.value = { min: 10, discount: 0.1 }
}
function removeTier(i) { pricing.value.tiers.splice(i, 1) }

const tierRows = computed(() => (pricing.value?.tiers || []).map((tier, i) => ({ ...tier, idx: i })))
const tierColumns = [
  { key: 'min' },
  { key: 'discount', align: 'right' },
  { key: 'actions', width: 110, align: 'right' }
]

onMounted(refresh)
</script>

<template>
  <div class="page">
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">{{ t('admin.pricing.eyebrow') }}</a-typography-text>
      <a-button :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        {{ t('admin.common.refresh') }}
      </a-button>
    </a-flex>

    <a-alert v-if="err" type="error" show-icon :message="err" />
    <a-card v-if="!pricing && loading" loading />

    <template v-if="pricing">
      <a-card :title="t('admin.pricing.hourlyTitle')">
        <a-typography-paragraph type="secondary">{{ t('admin.pricing.hourlyHint') }}</a-typography-paragraph>
        <a-form layout="vertical" :model="pricing">
          <a-row :gutter="16">
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.ipv4PerHour')">
                <a-input-number v-model:value="pricing.ipv4.perHour" :min="0" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.ipv6PerHour')">
                <a-input-number v-model:value="pricing.ipv6.perHour" :min="0" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.currency')">
                <a-input v-model:value="pricing.currency" :maxlength="8" class="mono" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.minHours')">
                <a-input-number v-model:value="pricing.minHours" :min="1" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.maxHours')">
                <a-input-number v-model:value="pricing.maxHours" :min="1" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="12" :lg="8">
              <a-form-item :label="t('admin.pricing.bandwidthQuota')">
                <a-input-number v-model:value="pricing.bandwidthQuotaGB" :min="0" class="full-width" />
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>
      </a-card>

      <a-card :title="t('admin.pricing.tiersTitle')">
        <a-typography-paragraph type="secondary">{{ t('admin.pricing.tiersHint') }}</a-typography-paragraph>
        <a-table
          v-if="tierRows.length"
          :columns="tierColumns"
          :data-source="tierRows"
          row-key="idx"
          :pagination="false"
          :show-header="false"
          size="small"
          class="tier-table"
        >
          <template #bodyCell="{ column, record: tier }">
            <template v-if="column.key === 'min'">quantity ≥ <strong class="mono">{{ tier.min }}</strong></template>
            <template v-else-if="column.key === 'discount'">
              <a-tag color="green" :bordered="false" class="mono">-{{ ((tier.discount || 0) * 100).toFixed(0) }}%</a-tag>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-button size="small" danger type="text" @click="removeTier(tier.idx)">
                <template #icon><DeleteOutlined /></template>
                {{ t('admin.pricing.tierRemove') }}
              </a-button>
            </template>
          </template>
        </a-table>

        <a-form layout="vertical" :model="newTier" @finish="addTier">
          <a-row :gutter="16" align="bottom">
            <a-col :xs="12" :sm="8" :lg="6">
              <a-form-item :label="t('admin.pricing.tierMin')">
                <a-input-number v-model:value="newTier.min" :min="2" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="12" :sm="8" :lg="6">
              <a-form-item :label="t('admin.pricing.tierDiscount')">
                <a-input-number v-model:value="newTier.discount" :min="0" :max="0.9" :step="0.05" class="full-width" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :sm="8" :lg="6">
              <a-form-item>
                <a-button html-type="submit">{{ t('admin.pricing.tierAdd') }}</a-button>
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>
      </a-card>

      <div>
        <a-button type="primary" :loading="saving" @click="save">
          <template #icon><SaveOutlined /></template>
          {{ t('admin.pricing.saveChanges') }}
        </a-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tier-table { margin-bottom: 16px; }
</style>
