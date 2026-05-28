<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftRight, Server } from 'lucide-vue-next'
import { apiFetch } from '../../api'
import { loadNodes, nodesState } from '../../store/nodes'
import { formatBytes } from '../../utils/format'

const route = useRoute()
const router = useRouter()

const a = ref(route.query.a || '')
const b = ref(route.query.b || '')
const result = ref(null)
const loading = ref(false)
const errorText = ref('')

const nodeOpts = computed(() => {
  const opts = [{ id: 'local', name: 'local (control plane)' }]
  for (const n of nodesState.list) opts.push({ id: n.id, name: `${n.name} — ${n.host}` })
  return opts
})

async function runCompare() {
  if (!a.value || !b.value || a.value === b.value) { result.value = null; return }
  loading.value = true; errorText.value = ''
  router.replace({ query: { a: a.value, b: b.value } }).catch(() => {})
  try { result.value = await apiFetch(`/api/admin/nodes/compare?a=${encodeURIComponent(a.value)}&b=${encodeURIComponent(b.value)}`) }
  catch (e) { errorText.value = e.message; result.value = null }
  finally { loading.value = false }
}

function diffClass(av, bv, lowerIsBetter = false) {
  if (av == null || bv == null || av === bv) return ''
  const aIsBetter = lowerIsBetter ? Number(av) < Number(bv) : Number(av) > Number(bv)
  return aIsBetter ? 'better' : 'worse'
}

watch(() => [a.value, b.value], runCompare)
onMounted(async () => { await loadNodes(); if (a.value && b.value) runCompare() })
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <h1 style="margin:0; font-size:18px"><ArrowLeftRight :size="16" style="vertical-align:-3px" /> So sánh node</h1>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="router.push({ name: 'admin-nodes' })">← Danh sách node</button>
    </div>

    <section class="surface">
      <div class="section-head"><h2>Chọn 2 node để so sánh</h2></div>
      <div class="detail-grid">
        <div>
          <span>Node A</span>
          <select v-model="a" style="width:100%; padding:6px 8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:var(--radius); font-family:var(--mono); font-size:12px">
            <option value="">— chọn —</option>
            <option v-for="o in nodeOpts" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
        <div>
          <span>Node B</span>
          <select v-model="b" style="width:100%; padding:6px 8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); border-radius:var(--radius); font-family:var(--mono); font-size:12px">
            <option value="">— chọn —</option>
            <option v-for="o in nodeOpts" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
      </div>
    </section>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>
    <p v-if="loading" class="empty-text">Đang tải…</p>

    <section v-if="result && result.a && result.b" class="surface">
      <div class="section-head"><h2><Server :size="16" style="vertical-align:-3px" /> So sánh trực tiếp</h2></div>
      <div class="data-table compare-table">
        <div class="table-head" style="grid-template-columns: 1.2fr 1fr 1fr">
          <span>Chỉ số</span>
          <span>{{ result.a.name }} <small style="color:var(--muted); font-size:11px">({{ result.a.id }})</small></span>
          <span>{{ result.b.name }} <small style="color:var(--muted); font-size:11px">({{ result.b.id }})</small></span>
        </div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Host</span><span class="cell-mono">{{ result.a.host || '—' }}</span><span class="cell-mono">{{ result.b.host || '—' }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Status</span><span><span :class="['status-pill', result.a.status === 'online' ? 'active' : 'pending']">{{ result.a.status }}</span></span><span><span :class="['status-pill', result.b.status === 'online' ? 'active' : 'pending']">{{ result.b.status }}</span></span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Family</span><span class="cell-mono">{{ result.a.family }}</span><span class="cell-mono">{{ result.b.family }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Version</span><span class="cell-mono">{{ result.a.version || '—' }}</span><span class="cell-mono">{{ result.b.version || '—' }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Tổng proxy</span><span class="cell-mono" :class="diffClass(result.a.proxies.total, result.b.proxies.total)">{{ result.a.proxies.total }}</span><span class="cell-mono" :class="diffClass(result.b.proxies.total, result.a.proxies.total)">{{ result.b.proxies.total }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Proxy active</span><span class="cell-mono" :class="diffClass(result.a.proxies.active, result.b.proxies.active)" style="color:var(--green)">{{ result.a.proxies.active }}</span><span class="cell-mono" :class="diffClass(result.b.proxies.active, result.a.proxies.active)" style="color:var(--green)">{{ result.b.proxies.active }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Proxy failing</span><span class="cell-mono" :class="diffClass(result.a.proxies.failing, result.b.proxies.failing, true)" style="color:var(--red)">{{ result.a.proxies.failing }}</span><span class="cell-mono" :class="diffClass(result.b.proxies.failing, result.a.proxies.failing, true)" style="color:var(--red)">{{ result.b.proxies.failing }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Khách</span><span class="cell-mono">{{ result.a.owners }}</span><span class="cell-mono">{{ result.b.owners }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Băng thông 30d ↑</span><span class="cell-mono">{{ formatBytes(result.a.bandwidth30d.up) }}</span><span class="cell-mono">{{ formatBytes(result.b.bandwidth30d.up) }}</span></div>
        <div class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Băng thông 30d ↓</span><span class="cell-mono">{{ formatBytes(result.a.bandwidth30d.down) }}</span><span class="cell-mono">{{ formatBytes(result.b.bandwidth30d.down) }}</span></div>
        <div v-if="result.a.metrics && result.b.metrics" class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>CPU %</span><span class="cell-mono" :class="diffClass(result.a.metrics.cpuPct, result.b.metrics.cpuPct, true)">{{ result.a.metrics.cpuPct }}%</span><span class="cell-mono" :class="diffClass(result.b.metrics.cpuPct, result.a.metrics.cpuPct, true)">{{ result.b.metrics.cpuPct }}%</span></div>
        <div v-if="result.a.metrics && result.b.metrics" class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>RAM %</span><span class="cell-mono" :class="diffClass(result.a.metrics.ramPct, result.b.metrics.ramPct, true)">{{ result.a.metrics.ramPct }}%</span><span class="cell-mono" :class="diffClass(result.b.metrics.ramPct, result.a.metrics.ramPct, true)">{{ result.b.metrics.ramPct }}%</span></div>
        <div v-if="result.a.metrics && result.b.metrics" class="table-row" style="grid-template-columns: 1.2fr 1fr 1fr"><span>Load 1m</span><span class="cell-mono" :class="diffClass(result.a.metrics.load1, result.b.metrics.load1, true)">{{ Number(result.a.metrics.load1).toFixed(2) }}</span><span class="cell-mono" :class="diffClass(result.b.metrics.load1, result.a.metrics.load1, true)">{{ Number(result.b.metrics.load1).toFixed(2) }}</span></div>
      </div>
      <div class="action-row" style="margin-top:14px; display:flex; gap:8px">
        <button class="ghost-button" type="button" @click="router.push({ name: 'admin-node-detail', params: { nodeId: result.a.id } })">Mở chi tiết {{ result.a.name }}</button>
        <button class="ghost-button" type="button" @click="router.push({ name: 'admin-node-detail', params: { nodeId: result.b.id } })">Mở chi tiết {{ result.b.name }}</button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.compare-table .better { color:var(--green) }
.compare-table .worse  { color:var(--red) }
</style>
