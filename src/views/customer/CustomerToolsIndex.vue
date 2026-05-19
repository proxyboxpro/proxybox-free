<script setup>
import { useRouter } from 'vue-router'
import { ChevronRight, Gauge, Globe, Layers, Radio, ShieldAlert, Wrench } from 'lucide-vue-next'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()

// Add new tools here. Each item routes to a child of /tools.
const tools = [
  { route: 'tools-speed-test',  labelKey: 'cust.tools.speed.title',     descKey: 'cust.tools.speed.subtitle',     icon: Gauge,       badge: 'NEW' },
  { route: 'tools-bulk-check',  labelKey: 'cust.tools.bulk.title',      descKey: 'cust.tools.bulk.subtitle',      icon: Layers },
  { route: 'tools-ping',        labelKey: 'cust.tools.ping.title',      descKey: 'cust.tools.ping.subtitle',      icon: Radio },
  { route: 'tools-ip-info',     labelKey: 'cust.tools.ipInfo.title',    descKey: 'cust.tools.ipInfo.subtitle',    icon: Globe },
  { route: 'tools-blacklist',   labelKey: 'cust.tools.blacklist.title', descKey: 'cust.tools.blacklist.subtitle', icon: ShieldAlert }
]

function open(item) { router.push({ name: item.route }) }
</script>

<template>
  <h1><Wrench :size="18" style="vertical-align:-3px; color:var(--green)" /> {{ t('cust.tools.hub.title') }}</h1>
  <p class="sub">{{ t('cust.tools.hub.subtitle') }}</p>

  <div class="tools-grid">
    <button
      v-for="item in tools"
      :key="item.route"
      type="button"
      class="tool-card"
      @click="open(item)"
    >
      <span class="tool-ico">
        <component :is="item.icon" :size="20" />
      </span>
      <div class="tool-body">
        <strong>
          {{ t(item.labelKey) }}
          <span v-if="item.badge" class="tool-badge">{{ item.badge }}</span>
        </strong>
        <span>{{ t(item.descKey) }}</span>
      </div>
      <ChevronRight :size="16" class="tool-chev" />
    </button>
  </div>
</template>

<style scoped>
.sub { color: var(--muted); margin: 2px 0 14px; }

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.tool-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--pxl-card, var(--bg));
  border: 1px solid var(--pxl-bd, var(--border));
  border-radius: 14px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.tool-card:hover {
  border-color: var(--green);
  transform: translateY(-1px);
}
.tool-ico {
  width: 38px;
  height: 38px;
  border-radius: var(--radius);
  background: var(--green-soft);
  color: var(--green);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tool-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tool-body strong { font-size: 14px; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.tool-badge {
  font-size: 9px; font-weight: 700; font-family: var(--mono);
  background: var(--green); color: #0a0e14; padding: 1px 5px; border-radius: 4px;
  letter-spacing: 0.05em;
}
.tool-body span { font-size: 12px; color: var(--muted); line-height: 1.45; }
.tool-chev { color: var(--muted); flex-shrink: 0; }
</style>
