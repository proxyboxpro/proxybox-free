<script setup>
import { Download } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { proxyState } from '../store/proxies'
import { formatUsd } from '../utils/format'

const { t } = useI18n()

function statusLabel(status) { return t(`status.${status}`) }
function detailLink(id) { return { name: 'order-detail', params: { orderId: id } } }
</script>

<template>
  <section class="surface">
    <div class="section-head">
      <h2>{{ t('orders.history') }}</h2>
      <button class="ghost-button" type="button"><Download :size="17" /> {{ t('common.export') }}</button>
    </div>
    <div class="data-table">
      <div class="table-head">
        <span>{{ t('orders.id') }}</span>
        <span>{{ t('orders.product') }}</span>
        <span>{{ t('orders.date') }}</span>
        <span>{{ t('orders.members') }}</span>
        <span>{{ t('orders.status') }}</span>
      </div>
      <RouterLink v-for="order in proxyState.orders" :key="order.id" :to="detailLink(order.id)" class="table-row order-row">
        <strong>{{ order.id }}</strong>
        <span>{{ order.item }}</span>
        <span>{{ order.date }}</span>
        <span>{{ (order.proxyIds || []).length || '—' }} · <span style="color:var(--muted)">{{ formatUsd(order.amount) }}</span></span>
        <span :class="['status-pill', order.status]">{{ statusLabel(order.status) }}</span>
      </RouterLink>
    </div>
    <p v-if="!proxyState.orders.length" class="empty-text">{{ t('common.empty') }}</p>
  </section>
</template>
