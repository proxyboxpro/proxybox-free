<script setup>
import { Check } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { profile } from '../store/profile'

const { t } = useI18n()
</script>

<template>
  <section class="profile-layout">
    <section class="surface">
      <div class="profile-head">
        <div class="avatar large">{{ (profile.name || 'U').slice(0, 1).toUpperCase() }}</div>
        <div><h2>{{ profile.name }}</h2><p>{{ profile.email }}</p></div>
      </div>
      <div class="form-grid">
        <label class="input-field"><span>{{ t('field.fullName') }}</span><input v-model="profile.name" /></label>
        <label class="input-field"><span>Email</span><input v-model="profile.email" /></label>
        <label class="input-field"><span>{{ t('field.phone') }}</span><input v-model="profile.phone" /></label>
        <label class="input-field"><span>{{ t('field.company') }}</span><input v-model="profile.company" /></label>
        <label class="input-field"><span>{{ t('field.timezone') }}</span><input v-model="profile.timezone" /></label>
        <label class="input-field"><span>{{ t('field.language') }}</span><input v-model="profile.language" /></label>
      </div>
      <button class="primary-action small" type="button"><Check :size="17" /> {{ t('common.saveProfile') }}</button>
    </section>
  </section>
</template>
