<script setup>
import { computed, ref } from 'vue'
import { Activity, Globe, Loader2, Network, Play, Server } from 'lucide-vue-next'
import { apiFetch, ApiError } from '../../api'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const input = ref('')
const count = ref(4)
const busy = ref(false)
const err = ref('')
const result = ref(null)

const trimmed = computed(() => input.value.trim())

// Pure client-side detection, mirrors server net.isIP() semantics so the badge
// updates as the user types. Server re-validates before any ping runs.
const detectedFamily = computed(() => {
  const v = trimmed.value
  if (!v) return null
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    const parts = v.split('.').map(Number)
    return parts.every((n) => n >= 0 && n <= 255) ? 4 : null
  }
  if (v.includes(':') && /^[0-9a-fA-F:]+$/.test(v.replace(/%.+$/, ''))) return 6
  return null
})

async function runPing() {
  err.value = ''
  result.value = null
  if (!detectedFamily.value) {
    err.value = t('cust.tools.ping.errInvalid')
    return
  }
  busy.value = true
  try {
    result.value = await apiFetch('/api/v1/user/tools/ping', {
      method: 'POST',
      body: { ip: trimmed.value, count: count.value }
    })
  } catch (e) {
    err.value = e instanceof ApiError ? (e.data?.error || e.message) : e.message
  } finally {
    busy.value = false
  }
}

function pasteFromClipboard() {
  if (!navigator.clipboard) return
  navigator.clipboard.readText().then((v) => { input.value = String(v || '').trim() }).catch(() => {})
}
</script>

<template>
  <h1>{{ t('cust.tools.ping.title') }}</h1>
  <p class="sub">{{ t('cust.tools.ping.subtitle') }}</p>

  <section class="surface" style="padding:18px; margin-bottom:14px">
    <div class="section-head">
      <h2><Network :size="14" /> {{ t('cust.tools.ping.inputHead') }}</h2>
    </div>

    <div class="ping-input-row">
      <div class="ping-input-wrap">
        <input
          v-model="input"
          type="text"
          class="ping-input"
          :placeholder="t('cust.tools.ping.placeholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="runPing"
        />
        <span v-if="detectedFamily === 4" class="family-badge fv4">
          <Server :size="11" /> IPv4
        </span>
        <span v-else-if="detectedFamily === 6" class="family-badge fv6">
          <Globe :size="11" /> IPv6
        </span>
        <span v-else-if="trimmed" class="family-badge finv">
          {{ t('cust.tools.ping.notIp') }}
        </span>
      </div>

      <label class="ping-count">
        <span>{{ t('cust.tools.ping.count') }}</span>
        <select v-model.number="count">
          <option :value="1">1</option>
          <option :value="4">4</option>
          <option :value="8">8</option>
          <option :value="10">10</option>
        </select>
      </label>

      <button type="button" class="btn-paste" @click="pasteFromClipboard">
        {{ t('cust.tools.ping.paste') }}
      </button>

      <button
        type="button"
        class="btn-run"
        :disabled="busy || !detectedFamily"
        @click="runPing"
      >
        <Loader2 v-if="busy" :size="14" class="spin" />
        <Play v-else :size="14" />
        {{ busy ? t('cust.tools.ping.running') : t('cust.tools.ping.run') }}
      </button>
    </div>

    <p v-if="err" class="error-text" style="margin-top:12px">{{ err }}</p>
    <p v-else class="hint-text">{{ t('cust.tools.ping.hint') }}</p>
  </section>

  <section v-if="result" class="surface" style="padding:18px">
    <div class="section-head">
      <h2><Activity :size="14" /> {{ t('cust.tools.ping.resultHead') }}</h2>
      <span :class="['status-pill', result.ok ? 'active' : 'expired']">
        {{ result.ok ? t('cust.tools.ping.reachable') : t('cust.tools.ping.unreachable') }}
      </span>
    </div>

    <div class="ping-stats-grid">
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.target') }}</span>
        <span class="cell-mono val">{{ result.target }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.family') }}</span>
        <span class="cell-mono val">{{ result.family.toUpperCase() }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.transmitted') }}</span>
        <span class="cell-mono val">{{ result.transmitted }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.received') }}</span>
        <span class="cell-mono val">{{ result.received }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.loss') }}</span>
        <span
          class="cell-mono val"
          :style="{ color: result.loss === 0 ? 'var(--green)' : result.loss < 100 ? 'var(--yellow)' : 'var(--red)' }"
        >{{ result.loss }}%</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.rttAvg') }}</span>
        <span class="cell-mono val">{{ result.rtt ? `${result.rtt.avg.toFixed(1)} ms` : '—' }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.rttMin') }}</span>
        <span class="cell-mono val">{{ result.rtt ? `${result.rtt.min.toFixed(1)} ms` : '—' }}</span>
      </div>
      <div class="stat-cell">
        <span class="lbl">{{ t('cust.tools.ping.rttMax') }}</span>
        <span class="cell-mono val">{{ result.rtt ? `${result.rtt.max.toFixed(1)} ms` : '—' }}</span>
      </div>
    </div>

    <div v-if="result.samples?.length" class="ping-samples">
      <div v-for="s in result.samples" :key="s.seq" class="sample-row">
        <span class="cell-mono">seq={{ s.seq }}</span>
        <span class="cell-mono">ttl={{ s.ttl }}</span>
        <span class="cell-mono" :style="{ color: s.time < 50 ? 'var(--green)' : s.time < 150 ? 'var(--yellow)' : 'var(--red)' }">
          {{ s.time.toFixed(1) }} ms
        </span>
        <span class="bar-track">
          <span class="bar-fill" :style="{ width: Math.min(100, s.time / 3) + '%' }"></span>
        </span>
      </div>
    </div>

    <details class="raw-details">
      <summary>{{ t('cust.tools.ping.rawOutput') }}</summary>
      <pre class="raw-output">{{ result.raw }}</pre>
    </details>
  </section>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }

.ping-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}
.ping-input-wrap {
  position: relative;
  flex: 1;
  min-width: 260px;
}
.ping-input {
  width: 100%;
  height: 38px;
  padding: 0 92px 0 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
}
.ping-input:focus { border-color: var(--green); }

.family-badge {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--mono);
  letter-spacing: 0.02em;
}
.family-badge.fv4 { background: var(--green-soft); color: var(--green); }
.family-badge.fv6 { background: var(--blue-soft); color: var(--blue); }
.family-badge.finv { background: var(--red-soft); color: var(--red); }

.ping-count {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.ping-count select {
  height: 34px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mono);
}

.btn-paste, .btn-run {
  height: 38px;
  padding: 0 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-paste:hover { border-color: var(--muted); }
.btn-run {
  background: var(--green);
  border-color: var(--green);
  color: #0a0e14;
  font-weight: 600;
}
.btn-run:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-run:not(:disabled):hover { filter: brightness(1.08); }

.spin { animation: ping-spin 0.9s linear infinite; }
@keyframes ping-spin { to { transform: rotate(360deg); } }

.hint-text { color: var(--muted); font-size: 12px; margin-top: 10px; }

.ping-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.stat-cell {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-cell .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.stat-cell .val { font-size: 14px; color: var(--text); }

.ping-samples { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.sample-row {
  display: grid;
  grid-template-columns: 80px 70px 90px 1fr;
  gap: 12px;
  align-items: center;
  font-size: 12px;
}
.bar-track {
  position: relative;
  height: 6px;
  background: var(--border-soft);
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--green); border-radius: 3px; }

.raw-details {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  background: var(--bg);
}
.raw-details summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
}
.raw-output {
  margin: 10px 0 0;
  padding: 10px;
  background: var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}

@media (max-width: 720px) {
  .ping-stats-grid { grid-template-columns: repeat(2, 1fr); }
  .sample-row { grid-template-columns: 60px 60px 80px 1fr; font-size: 11px; }
}
</style>
