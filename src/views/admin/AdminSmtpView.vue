<script setup>
import { onMounted, ref } from 'vue'
import { CheckCircle2, Mail, RefreshCw, Send, Settings2 } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const cfg = ref({ host: '', port: 587, user: '', pass: '', from: '', secure: false, starttls: true })
const testTo = ref('')
const busy = ref(false)
const testing = ref(false)
const err = ref('')
const flash = ref('')
const testResult = ref(null)

async function refresh() {
  err.value = ''
  try {
    const r = await apiFetch('/api/admin/smtp')
    if (r) Object.assign(cfg.value, r)
  } catch (e) { err.value = e.message }
}

async function save() {
  if (busy.value) return
  busy.value = true; err.value = ''; flash.value = ''
  try {
    await apiFetch('/api/admin/smtp', { method: 'PATCH', body: cfg.value })
    flash.value = t('admin.smtp.saved')
  } catch (e) { err.value = e.message }
  finally { busy.value = false }
}

async function sendTest() {
  if (!testTo.value || testing.value) return
  testing.value = true; err.value = ''; testResult.value = null
  try {
    const r = await apiFetch('/api/admin/smtp/test', { method: 'POST', body: { to: testTo.value } })
    testResult.value = { ok: r.ok !== false, message: r.message || r.error || t('admin.smtp.testSentOk') }
  } catch (e) { testResult.value = { ok: false, message: e.message } }
  finally { testing.value = false }
}

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow"><Mail :size="13" style="vertical-align:-2px" /> {{ t('admin.smtp.title') }}</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="14" /></button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color: var(--green); font-size: 13px">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2><Settings2 :size="14" style="vertical-align:-2px" /> {{ t('admin.smtp.serverConfig') }}</h2></div>
      <p style="font-size: 12.5px; color: var(--muted); margin-bottom: 14px">{{ t('admin.smtp.serverDesc') }}</p>

      <div class="form-grid" style="grid-template-columns: 1.4fr 0.6fr; gap: 14px">
        <label class="input-field">
          <span>{{ t('admin.smtp.host') }}</span>
          <input v-model="cfg.host" placeholder="smtp.gmail.com" />
        </label>
        <label class="input-field">
          <span>{{ t('admin.smtp.port') }}</span>
          <input v-model.number="cfg.port" type="number" min="1" max="65535" placeholder="587" />
        </label>
      </div>

      <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 14px">
        <label class="input-field">
          <span>{{ t('admin.smtp.user') }}</span>
          <input v-model="cfg.user" autocomplete="off" placeholder="noreply@proxyhub.vn" />
        </label>
        <label class="input-field">
          <span>{{ t('admin.smtp.pass') }}</span>
          <input v-model="cfg.pass" type="password" autocomplete="new-password" placeholder="••••••••" />
        </label>
      </div>

      <label class="input-field" style="max-width: 480px; margin-bottom: 12px">
        <span>{{ t('admin.smtp.from') }}</span>
        <input v-model="cfg.from" placeholder="ProxyBox &lt;noreply@proxyhub.vn&gt;" />
      </label>

      <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 14px">
        <label class="check-line">
          <input v-model="cfg.secure" type="checkbox" />
          <span><strong style="color: var(--text)">SMTPS (port 465)</strong> &mdash; {{ t('admin.smtp.secureDesc') }}</span>
        </label>
        <label class="check-line">
          <input v-model="cfg.starttls" type="checkbox" />
          <span><strong style="color: var(--text)">STARTTLS</strong> &mdash; {{ t('admin.smtp.starttlsDesc') }}</span>
        </label>
      </div>

      <div class="action-row">
        <button class="primary-action" type="button" :disabled="busy" @click="save">
          <CheckCircle2 :size="15" /> {{ busy ? t('common.loading') : t('admin.smtp.save') }}
        </button>
      </div>
    </section>

    <section class="surface">
      <div class="section-head"><h2><Send :size="14" style="vertical-align:-2px" /> {{ t('admin.smtp.testTitle') }}</h2></div>
      <p style="font-size: 12.5px; color: var(--muted); margin-bottom: 12px">{{ t('admin.smtp.testDesc') }}</p>
      <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; max-width: 560px">
        <label class="input-field" style="flex: 1; min-width: 240px">
          <span>{{ t('admin.smtp.testTo') }}</span>
          <input v-model="testTo" type="email" placeholder="you@example.com" />
        </label>
        <button class="ghost-button" type="button" :disabled="!testTo || testing" @click="sendTest">
          <Send :size="14" /> {{ testing ? t('common.loading') : t('admin.smtp.sendTest') }}
        </button>
      </div>

      <div v-if="testResult" :style="{ marginTop: '12px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (testResult.ok ? 'var(--green)' : 'var(--red)'), background: testResult.ok ? 'var(--green-soft)' : 'var(--red-soft)', color: testResult.ok ? 'var(--green)' : 'var(--red)', fontSize: '12.5px', fontFamily: 'var(--mono)' }">
        {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
      </div>
    </section>
  </section>
</template>
