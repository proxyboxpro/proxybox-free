<script setup>
import { BookOpen, Plus } from 'lucide-vue-next'
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
]
</script>

<template>
  <section class="page-stack">
    <section class="surface api-panel">
      <div class="section-head">
        <h2>{{ t('api.keys') }}</h2>
        <button class="primary-action small" type="button"><Plus :size="16" /> {{ t('api.createKey') }}</button>
      </div>
      <div class="credential-box"><code>pk_live_proxyhub_8f42****************</code></div>
      <div class="detail-grid">
        <div><span>{{ t('api.rateLimit') }}</span><strong>600 req/min</strong></div>
        <div><span>{{ t('api.webhook') }}</span><strong>https://domain.com/proxyhook</strong></div>
        <div><span>{{ t('api.lastUsed') }}</span><strong>2026-05-12 09:40</strong></div>
      </div>
    </section>

    <section class="surface">
      <div class="section-head">
        <h2>{{ t('api.endpoints') }}</h2>
        <span class="eyebrow">docs/API.md</span>
      </div>
      <div class="data-table">
        <div v-for="row in endpoints" :key="row[1]" class="table-row" style="grid-template-columns: 70px 1.4fr 2fr;">
          <span class="tag">{{ row[0] }}</span>
          <span class="cell-mono">{{ row[1] }}</span>
          <span style="color: var(--muted);">{{ row[2] }}</span>
        </div>
      </div>
    </section>

    <section class="surface">
      <div class="section-head">
        <h2>{{ t('api.quick') }}</h2>
        <BookOpen :size="18" />
      </div>
      <pre><code># Auth header on every call
Authorization: Bearer &lt;token&gt;     # or:   X-API-Key: &lt;api.apiKey&gt;

# IPv4 proxy → exits via its own bindIp
curl -x http://USER:PASS@HOST:PORT https://api.ipify.org

# IPv6 proxy → connect over IPv4, exit is IPv6-only
curl -x http://USER:PASS@HOST:PORT https://api64.ipify.org
#   ...with rotation on, each call exits from a different IPv6 in the /48</code></pre>
    </section>
  </section>
</template>
