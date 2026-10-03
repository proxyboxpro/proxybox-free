<script setup>
import { useI18n } from '../i18n'
import { profile } from '../store/profile'

const { t } = useI18n()
</script>

<template>
  <div class="page">
    <a-card>
      <a-flex align="center" gap="middle" class="profile-head">
        <a-avatar :size="64" class="avatar">{{ (profile.name || 'U').slice(0, 1).toUpperCase() }}</a-avatar>
        <div class="who">
          <a-typography-title :level="4" :style="{ margin: 0 }">{{ profile.name }}</a-typography-title>
          <a-typography-text type="secondary">{{ profile.email }}</a-typography-text>
        </div>
      </a-flex>

      <a-form :model="profile" layout="vertical">
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('field.fullName')" name="name"><a-input v-model:value="profile.name" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item label="Email" name="email"><a-input v-model:value="profile.email" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('field.phone')" name="phone"><a-input v-model:value="profile.phone" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('field.company')" name="company"><a-input v-model:value="profile.company" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('field.timezone')" name="timezone"><a-input v-model:value="profile.timezone" /></a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item :label="t('field.language')" name="language"><a-input v-model:value="profile.language" /></a-form-item>
          </a-col>
        </a-row>
        <a-button type="primary">
          <template #icon><CheckOutlined /></template>
          {{ t('common.saveProfile') }}
        </a-button>
      </a-form>
    </a-card>
  </div>
</template>

<style scoped>
.profile-head { margin-bottom: 24px; }
.avatar { flex-shrink: 0; background: var(--pb-primary); font-size: 28px; }
.who { min-width: 0; }
</style>
