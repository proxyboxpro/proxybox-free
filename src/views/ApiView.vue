<script setup>
import { useI18n } from '../i18n'

const { t } = useI18n()

const endpoints = [
  ['POST', '/api/auth/login', 'email + password → token'],
  ['GET', '/api/network', 'detected IPv4 / IPv6 addresses + pool sizes'],
  ['GET', '/api/metrics', 'Prometheus text exposition'],
  ['GET', '/api/proxies', 'list proxies (no credentials)'],
  ['POST', '/api/proxies', '{ type, rotate?, bindIp?, durationDays?, maxConnections?, bytesPerSec?, monthlyQuotaBytes? }'],
  ['GET', '/api/proxies/:id/credentials', 'username / password / http / socks5 strings'],
  ['GET', '/api/proxies/:id/stats', '{ uploadBytes, downloadBytes, monthBytes, activeConnections, ... }'],
  ['POST', '/api/proxies/:id/check', 'health-check via the proxy → { ok, latencyMs, exitIp }'],
  ['POST', '/api/proxies/:id/rotate', 'assign a new exit IP from the pool'],
  ['PATCH', '/api/proxies/:id', '{ name?, rotate?, durationDays?, maxConnections?, bytesPerSec?, monthlyQuotaBytes? }'],
  ['POST', '/api/proxies/:id/renew', '{ days }'],
  ['DELETE', '/api/proxies/:id', 'stop + remove'],
  ['POST', '/api/orders', '{ type, rotate?, quantity, duration } → many proxies']
].map(([method, path, desc]) => ({ key: `${method} ${path}`, method, path, desc }))

const columns = [
  { key: 'method', dataIndex: 'method', width: 90 },
  { key: 'path', dataIndex: 'path', width: 280 },
  { key: 'desc', dataIndex: 'desc' }
]
const METHOD_COLOR = { GET: 'blue', POST: 'green', PATCH: 'orange', DELETE: 'red' }

const quickSnippet = `# Auth header on every call
Authorization: Bearer <token>     # or:   X-API-Key: <api.apiKey>

# IPv4 proxy → exits via its own bindIp
curl -x http://USER:PASS@HOST:PORT https://api.ipify.org

# IPv6 proxy → connect over IPv4, exit is IPv6-only
curl -x http://USER:PASS@HOST:PORT https://api64.ipify.org
#   ...with rotation on, each call exits from a different IPv6 in the /48`
</script>

<template>
  <div class="page">
    <a-card :title="t('api.keys')">
      <template #extra>
        <a-button type="primary" size="small">
          <template #icon><PlusOutlined /></template>
          {{ t('api.createKey') }}
        </a-button>
      </template>
      <a-typography-paragraph>
        <a-typography-text code class="mono key">pk_live_proxyhub_8f42****************</a-typography-text>
      </a-typography-paragraph>
      <a-descriptions bordered size="small" :column="{ xs: 1, sm: 1, md: 3 }">
        <a-descriptions-item :label="t('api.rateLimit')"><span class="mono">600 req/min</span></a-descriptions-item>
        <a-descriptions-item :label="t('api.webhook')"><span class="mono">https://domain.com/proxyhook</span></a-descriptions-item>
        <a-descriptions-item :label="t('api.lastUsed')"><span class="mono">2026-05-12 09:40</span></a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card :title="t('api.endpoints')" :body-style="{ padding: 0 }">
      <template #extra><a-typography-text type="secondary" class="mono">docs/API.md</a-typography-text></template>
      <a-table
        :columns="columns"
        :data-source="endpoints"
        :pagination="false"
        :show-header="false"
        row-key="key"
        size="small"
        :scroll="{ x: 760 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'method'">
            <a-tag :color="METHOD_COLOR[record.method]" :bordered="false" class="mono">{{ record.method }}</a-tag>
          </template>
          <template v-else-if="column.key === 'path'">
            <span class="mono">{{ record.path }}</span>
          </template>
          <template v-else-if="column.key === 'desc'">
            <a-typography-text type="secondary">{{ record.desc }}</a-typography-text>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card :title="t('api.quick')">
      <template #extra><BookOutlined /></template>
      <a-typography-paragraph :copyable="{ text: quickSnippet }" class="snippet">
        <pre class="mono">{{ quickSnippet }}</pre>
      </a-typography-paragraph>
    </a-card>
  </div>
</template>

<style scoped>
.key { font-size: 14px; }
.snippet { position: relative; margin-bottom: 0; }
.snippet pre { margin: 0; overflow-x: auto; white-space: pre; }
.snippet :deep(.ant-typography-copy) { position: absolute; top: 8px; right: 8px; }
</style>
