<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  value:  { type: Number, default: 0 },
  // null = auto-scale (max = value × 1.25 rounded to nice number). Otherwise fixed.
  max:    { type: Number, default: null },
  label:  { type: String, default: '' },
  status: { type: String, default: 'idle' },   // idle | running | done | error
  size:   { type: Number, default: 300 }
})

// Smooth interpolated number
const displayValue = ref(0)
let raf = null
function animateTo(target) {
  cancelAnimationFrame(raf)
  const from = displayValue.value
  const t0 = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 380)
    const eased = 1 - Math.pow(1 - t, 3)
    displayValue.value = from + (target - from) * eased
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
watch(() => props.value, (v) => animateTo(Number(v) || 0), { immediate: true })

// Auto-scale max if not set: round up to nice number above 1.25× value, min 100.
const effectiveMax = computed(() => {
  if (props.max && props.max > 0) return props.max
  const v = Math.max(displayValue.value, props.value || 0)
  const target = Math.max(100, v * 1.25)
  // Round to a nice power-of-10 multiple
  const pow = Math.pow(10, Math.floor(Math.log10(target)))
  const m = Math.ceil(target / pow) * pow
  return m
})

// 220° arc: from 160° clockwise to 380° (= 20°)
const ARC_START = 160
const ARC_END = 380
const ARC_SWEEP = ARC_END - ARC_START

function deg2rad(d) { return (d * Math.PI) / 180 }
function polar(cx, cy, r, deg) {
  const rad = deg2rad(deg)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, startDeg)
  const e = polar(cx, cy, r, endDeg)
  const large = (endDeg - startDeg) > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

const CX = computed(() => props.size / 2)
const CY = computed(() => props.size / 2 + 6)   // shift down slightly so number sits high
const R  = computed(() => props.size / 2 - 30)

const ratio = computed(() => {
  const r = displayValue.value / (effectiveMax.value || 1)
  return Math.max(0, Math.min(1, r))
})
const needleDeg = computed(() => ARC_START + ARC_SWEEP * ratio.value)
const trackPath = computed(() => arcPath(CX.value, CY.value, R.value, ARC_START, ARC_END))

// Tick marks — 6 majors with labels, 5 minors between each
const majorTicks = computed(() => {
  const out = []
  for (let i = 0; i <= 5; i++) {
    const ratio = i / 5
    const deg = ARC_START + ARC_SWEEP * ratio
    const p1 = polar(CX.value, CY.value, R.value + 2, deg)
    const p2 = polar(CX.value, CY.value, R.value - 10, deg)
    const labelP = polar(CX.value, CY.value, R.value - 22, deg)
    const v = effectiveMax.value * ratio
    let lbl
    if (v >= 1000) lbl = `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}G`
    else if (v >= 1) lbl = String(Math.round(v))
    else lbl = '0'
    out.push({ p1, p2, labelP, lbl, deg })
  }
  return out
})
const minorTicks = computed(() => {
  const out = []
  for (let i = 0; i <= 25; i++) {
    if (i % 5 === 0) continue
    const ratio = i / 25
    const deg = ARC_START + ARC_SWEEP * ratio
    const p1 = polar(CX.value, CY.value, R.value + 1, deg)
    const p2 = polar(CX.value, CY.value, R.value - 5, deg)
    out.push({ p1, p2 })
  }
  return out
})

const needle = computed(() => {
  const tip  = polar(CX.value, CY.value, R.value - 4, needleDeg.value)
  const base = polar(CX.value, CY.value, 6,           needleDeg.value + 180)
  return { tip, base }
})

const statusClass = computed(() => `st-${props.status || 'idle'}`)
const displayLabel = computed(() => {
  if (props.label) return props.label
  if (props.status === 'running') return 'Đang đo…'
  if (props.status === 'done') return 'Hoàn thành'
  if (props.status === 'error') return 'Lỗi'
  return 'Sẵn sàng'
})
function formattedValue() {
  const v = displayValue.value
  if (v >= 1000) return v.toFixed(0)
  if (v >= 100) return v.toFixed(1)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
</script>

<template>
  <div class="speed-gauge" :class="statusClass" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :viewBox="`0 0 ${size} ${size}`" :width="size" :height="size">
      <!-- Single faded background track. No filled colored arc. -->
      <path :d="trackPath" stroke="rgba(255,255,255,0.10)" :stroke-width="2" stroke-linecap="round" fill="none" />

      <!-- Minor tick marks -->
      <g stroke="rgba(148, 163, 184, 0.32)" stroke-width="1" stroke-linecap="round">
        <line v-for="(t, i) in minorTicks" :key="'mn'+i" :x1="t.p1.x" :y1="t.p1.y" :x2="t.p2.x" :y2="t.p2.y" />
      </g>

      <!-- Major tick marks + labels -->
      <g stroke="rgba(226, 232, 240, 0.6)" stroke-width="1.8" stroke-linecap="round">
        <line v-for="(t, i) in majorTicks" :key="'mj'+i" :x1="t.p1.x" :y1="t.p1.y" :x2="t.p2.x" :y2="t.p2.y" />
      </g>
      <g fill="#94a3b8" :font-size="size > 240 ? 11 : 9" font-family="ui-monospace, monospace" text-anchor="middle">
        <text v-for="(t, i) in majorTicks" :key="'lb'+i" :x="t.labelP.x" :y="t.labelP.y + 3">{{ t.lbl }}</text>
      </g>

      <!-- Just the needle. Thin white line, pivot hub. -->
      <line
        :x1="needle.base.x" :y1="needle.base.y"
        :x2="needle.tip.x"  :y2="needle.tip.y"
        stroke="#f1f5f9" stroke-width="2.5" stroke-linecap="round"
        style="transition: all 240ms cubic-bezier(.32,.72,.32,1)"
      />
      <circle :cx="CX" :cy="CY" r="8" fill="#1e293b" stroke="rgba(241,245,249,0.45)" stroke-width="1" />
      <circle :cx="CX" :cy="CY" r="3" fill="#f1f5f9" />

      <!-- Center digit -->
      <text
        :x="CX" :y="CY - size * 0.12"
        :font-size="size > 240 ? 44 : 32"
        font-weight="700"
        font-family="'JetBrains Mono', ui-monospace, monospace"
        fill="#f8fafc" text-anchor="middle"
        style="letter-spacing: -0.02em"
      >{{ formattedValue() }}</text>
      <text
        :x="CX" :y="CY - size * 0.04"
        :font-size="size > 240 ? 12 : 10"
        font-weight="500"
        font-family="ui-monospace, monospace"
        fill="#64748b" text-anchor="middle"
      >Mbps</text>
    </svg>
    <div class="sg-status" :class="statusClass">
      <span class="sg-dot"></span>
      <span class="sg-label">{{ displayLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.speed-gauge {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; user-select: none;
}
.speed-gauge svg { display: block; }
.sg-status {
  position: absolute;
  bottom: 4%;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  background: rgba(15, 20, 27, 0.7);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
  font-size: 11px; color: var(--muted, #94a3b8);
  font-family: ui-monospace, monospace;
}
.sg-dot { width: 5px; height: 5px; border-radius: 50%; background: #64748b; }
.st-running .sg-dot { background: #22d3ee; animation: sg-pulse 1.1s ease-in-out infinite; }
.st-done    .sg-dot { background: #22c55e; }
.st-error   .sg-dot { background: #ef4444; }
.st-running .sg-label { color: #22d3ee; }
.st-done    .sg-label { color: #22c55e; }
.st-error   .sg-label { color: #ef4444; }
@keyframes sg-pulse { 50% { opacity: 0.35; transform: scale(0.85); } }
</style>
