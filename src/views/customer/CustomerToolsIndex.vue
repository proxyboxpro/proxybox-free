<script setup>
import { useRouter } from 'vue-router'
import { AppstoreOutlined, DashboardOutlined, GlobalOutlined, SafetyOutlined, WifiOutlined } from '@ant-design/icons-vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const router = useRouter()

// Add new tools here. Each item routes to a child of /tools.
const tools = [
  { route: 'tools-speed-test',  labelKey: 'cust.tools.speed.title',     descKey: 'cust.tools.speed.subtitle',     icon: DashboardOutlined, badge: 'NEW' },
  { route: 'tools-bulk-check',  labelKey: 'cust.tools.bulk.title',      descKey: 'cust.tools.bulk.subtitle',      icon: AppstoreOutlined },
  { route: 'tools-ping',        labelKey: 'cust.tools.ping.title',      descKey: 'cust.tools.ping.subtitle',      icon: WifiOutlined },
  { route: 'tools-ip-info',     labelKey: 'cust.tools.ipInfo.title',    descKey: 'cust.tools.ipInfo.subtitle',    icon: GlobalOutlined },
  { route: 'tools-blacklist',   labelKey: 'cust.tools.blacklist.title', descKey: 'cust.tools.blacklist.subtitle', icon: SafetyOutlined }
]

function open(item) { router.push({ name: item.route }) }
</script>

<template>
  <div class="page">
    <a-typography-text type="secondary">{{ t('cust.tools.hub.subtitle') }}</a-typography-text>

    <a-row :gutter="[12, 12]">
      <a-col v-for="item in tools" :key="item.route" :xs="24" :md="12" :xl="8">
        <a-card
          hoverable
          size="small"
          class="tool-card"
          role="link"
          tabindex="0"
          @click="open(item)"
          @keyup.enter="open(item)"
        >
          <a-flex align="center" gap="middle">
            <a-avatar shape="square" :size="40" class="tool-ico">
              <template #icon><component :is="item.icon" /></template>
            </a-avatar>
            <a-flex vertical :gap="4" class="tool-body">
              <a-space :size="6">
                <a-typography-text strong>{{ t(item.labelKey) }}</a-typography-text>
                <a-tag v-if="item.badge" color="green" :bordered="false" class="mono">{{ item.badge }}</a-tag>
              </a-space>
              <a-typography-text type="secondary" class="tool-desc">{{ t(item.descKey) }}</a-typography-text>
            </a-flex>
            <a-typography-text type="secondary"><RightOutlined /></a-typography-text>
          </a-flex>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.tool-card { height: 100%; }
.tool-body { flex: 1; min-width: 0; }
.tool-desc { font-size: 12px; line-height: 1.45; }
.tool-ico { flex-shrink: 0; background: var(--pb-primary-soft); color: var(--pb-primary); font-size: 20px; }
</style>
