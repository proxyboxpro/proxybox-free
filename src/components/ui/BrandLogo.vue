<script setup>
// ProxyBox logo mark + wordmark. `collapsed` hides the text (rail sider).
defineProps({
  collapsed: { type: Boolean, default: false },
  sub: { type: String, default: '' },
  size: { type: Number, default: 28 }
})
</script>

<template>
  <span class="brand-logo">
    <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="pbLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3fb950" />
          <stop offset="1" stop-color="#16a34a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#pbLogoGrad)" />
      <path fill="none" stroke="#0b1117" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" d="M16 6 L25 10.5 L25 21.5 L16 26 L7 21.5 L7 10.5 Z M7 10.5 L16 15 L25 10.5 M16 15 L16 26" />
    </svg>
    <span v-if="!collapsed" class="brand-text">
      <strong>ProxyBox<slot name="tag" /></strong>
      <small v-if="sub">{{ sub }}</small>
    </span>
  </span>
</template>

<style scoped>
.brand-logo { display: inline-flex; align-items: center; gap: 10px; min-width: 0; color: var(--pb-text); }
.brand-logo svg { flex-shrink: 0; }
.brand-text { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.brand-text strong { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; }
.brand-text small { font-size: 11px; color: var(--pb-text-3); white-space: nowrap; }
</style>
