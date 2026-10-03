<script setup>
// Status pill on top of <a-tag>. Maps the free-form status strings used by
// the API (active, pending, expired, error, suspended…) to antd tag colours.
//   <StatusTag status="active" />            → green "ACTIVE"
//   <StatusTag status="pending" label="Chờ" /> → orange "Chờ"
//   <StatusTag :status="s" dot />             → leading pulse dot
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, default: '' },
  label: { type: String, default: '' },
  dot: { type: Boolean, default: false },
  // Force an antd tag colour (success | processing | warning | error | default | any preset/hex)
  color: { type: String, default: '' }
})

const GROUPS = {
  success: ['active', 'online', 'ok', 'pass', 'passed', 'paid', 'success', 'succeeded', 'completed', 'complete', 'healthy', 'up', 'live', 'running', 'enabled', 'verified', 'approved', 'connected', 'alive', 'clean', 'done'],
  processing: ['processing', 'provisioning', 'syncing', 'in_progress', 'in-progress', 'checking', 'testing', 'info', 'new', 'open', 'queued'],
  warning: ['pending', 'warning', 'warn', 'grace', 'expiring', 'degraded', 'partial', 'slow', 'unpaid', 'awaiting', 'waiting', 'review', 'maintenance', 'listed'],
  error: ['error', 'failed', 'fail', 'blocked', 'down', 'offline', 'node-down', 'suspended', 'banned', 'rejected', 'refunded', 'dead', 'critical', 'timeout', 'denied', 'invalid', 'unhealthy'],
  default: ['expired', 'disabled', 'inactive', 'stopped', 'unknown', 'idle', 'cancelled', 'canceled', 'closed', 'archived', 'deleted', 'draft', 'none']
}
const LOOKUP = Object.fromEntries(Object.entries(GROUPS).flatMap(([color, list]) => list.map((s) => [s, color])))

const resolved = computed(() => props.color || LOOKUP[String(props.status || '').toLowerCase()] || 'default')
const text = computed(() => props.label || String(props.status || '—').toUpperCase())
const badgeStatus = computed(() => (resolved.value === 'default' ? 'default' : resolved.value))
</script>

<template>
  <a-tag :color="resolved" :bordered="false" class="status-tag">
    <a-badge v-if="dot" :status="badgeStatus" class="status-dot" />
    {{ text }}
  </a-tag>
</template>

<style scoped>
.status-tag { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; margin-inline-end: 0; }
.status-dot :deep(.ant-badge-status-dot) { width: 6px; height: 6px; }
.status-dot { margin-inline-end: 4px; }
</style>
