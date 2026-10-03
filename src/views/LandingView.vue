<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Grid } from 'ant-design-vue'
import {
  ApiOutlined, CloudOutlined, CloudServerOutlined, ClusterOutlined, CodeOutlined, GlobalOutlined,
  LockOutlined, SafetyCertificateOutlined, ShopOutlined, TeamOutlined, ThunderboltOutlined, WalletOutlined
} from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import { token } from '../api'
import PublicTopNav from '../components/PublicTopNav.vue'
import BrandLogo from '../components/ui/BrandLogo.vue'

const router = useRouter()
const { t, locale } = useI18n()
const screens = Grid.useBreakpoint()

const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

onMounted(() => {
  if (token.value) router.push('/dashboard')
})

const installCmd = 'curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash'
const copied = ref(false)
async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCmd)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch (e) { /* ignore */ }
}

const features = [
  { icon: ClusterOutlined,           titleKey: 'landing.feat.proto.title', bodyKey: 'landing.feat.proto.body' },
  { icon: GlobalOutlined,            titleKey: 'landing.feat.ipv6.title',  bodyKey: 'landing.feat.ipv6.body'  },
  { icon: CloudServerOutlined,       titleKey: 'landing.feat.byon.title',  bodyKey: 'landing.feat.byon.body'  },
  { icon: CloudOutlined,             titleKey: 'landing.feat.hub.title',   bodyKey: 'landing.feat.hub.body'   },
  { icon: WalletOutlined,            titleKey: 'landing.feat.bill.title',  bodyKey: 'landing.feat.bill.body'  },
  { icon: SafetyCertificateOutlined, titleKey: 'landing.feat.sec.title',   bodyKey: 'landing.feat.sec.body'   },
  { icon: CodeOutlined,              titleKey: 'landing.feat.rust.title',  bodyKey: 'landing.feat.rust.body'  },
  { icon: ThunderboltOutlined,       titleKey: 'landing.feat.ops.title',   bodyKey: 'landing.feat.ops.body'   }
]

const useCases = [
  { icon: ShopOutlined, titleKey: 'landing.use.reseller.title', bodyKey: 'landing.use.reseller.body' },
  { icon: TeamOutlined, titleKey: 'landing.use.team.title',     bodyKey: 'landing.use.team.body'     },
  { icon: LockOutlined, titleKey: 'landing.use.privacy.title',  bodyKey: 'landing.use.privacy.body'  },
  { icon: ApiOutlined,  titleKey: 'landing.use.api.title',      bodyKey: 'landing.use.api.body'      }
]

// Architecture flow cards (technical copy, English in both locales).
const flows = [
  {
    tag: 'A', color: 'blue', title: 'Pool — Customer buys hourly proxy',
    code: `1. Customer logs in + tops up wallet
2. POST /api/v1/user/orders
   { type: ipv6, qty: 5, zone: vn-hcm }
3. Master picks zone node + pushes config
4. Returns credentials (host:port + user:pass)
5. Customer connects → egress IPv6 from /48`
  },
  {
    tag: 'B', color: 'orange', title: 'Hub — Customer rents VPS by the hour',
    code: `1. Customer picks plan + zone (Virtualizor)
2. Master calls addvs → poll vsDetail
3. SSH bootstrap: curl install.sh on new VPS
4. Agent enrolls + claims placeholder node
5. Customer creates proxies on their hub
   (billing already paid hourly)`
  },
  {
    tag: 'C', color: 'green', title: 'BYON — Customer brings own VPS',
    code: `1. Customer SSH into their own VPS
2. Paste: curl panel/api/agent/install/<tok>
   | sudo bash -s v4
3. Agent downloads + enrols (tag=byon)
4. Node shows up under /my-nodes
5. Customer creates FREE proxies
   (slot-based, no wallet charge)`
  },
  {
    tag: 'S', color: 'red', title: 'Security & at-rest encryption',
    code: `• Browser ↔ nginx :443 (LE cert, HSTS)
• Agent ↔ master mTLS :8788 (1 cert/node)
• Password: scrypt (16-byte salt, 64-byte derive)
• Secrets in config.json: AES-256-GCM
   (SSH pw · VZ key · OAuth client_secret)
• master.key: 32 bytes, chmod 600
• Audit + conn_events in SQLite`
  }
]

const archAscii = `┌────────────────────────────────────────────────────────────┐
│  Customer browser / API client                             │
│       ↓ (HTTP / SOCKS5 :port + user:pass)                  │
│  Edge node (Rust+Tokio agent, IPv4 host : port)            │
│       ↓ strict-family resolve + dial via bind-IP           │
│  Internet (IPv6 /48 pool, no A record leak)                │
└────────────────────────────────────────────────────────────┘
        ↑ mTLS long-poll  ↑ enroll token  ↑ telemetry
┌────────────────────────────────────────────────────────────┐
│  Control plane (Node.js 22 monolith, AES-256-GCM at rest)  │
│  - auth + scrypt password + TOTP                           │
│  - billing (wallet, auto-renew, credit, tier)              │
│  - admin & customer REST API + webhook                     │
│  - PKI (node-forge), SQLite (audit, billing_tx)            │
└────────────────────────────────────────────────────────────┘`
</script>

<template>
  <a-layout class="landing">
    <PublicTopNav sub-label="Box Proxy" :anchor-links="[
      { href: '#features', key: 'landing.nav.features' },
      { href: '#self-host', key: 'landing.nav.selfHost' }
    ]" />

    <a-layout-content>
      <!-- Hero -->
      <section class="container hero">
        <a-row :gutter="[56, 32]" align="middle">
          <a-col :xs="24" :lg="13">
            <a-tag color="success" class="hero-pill">{{ t('landing.hero.eyebrow') }}</a-tag>
            <a-typography-title class="hero-title">
              {{ t('landing.hero.titlePre') }}
              <span class="accent">{{ t('landing.hero.titleAccent') }}</span>
            </a-typography-title>
            <a-typography-paragraph type="secondary" class="hero-sub">{{ t('landing.hero.sub') }}</a-typography-paragraph>
            <a-flex wrap="wrap" gap="middle" class="hero-cta">
              <RouterLink v-slot="{ href, navigate }" to="/register" custom>
                <a-button type="primary" size="large" :href="href" @click="navigate">
                  {{ t('landing.hero.ctaPrimary') }} <ArrowRightOutlined />
                </a-button>
              </RouterLink>
              <RouterLink v-slot="{ href, navigate }" :to="{ hash: '#self-host' }" custom>
                <a-button size="large" :href="href" @click="navigate">{{ t('landing.hero.ctaSecondary') }}</a-button>
              </RouterLink>
            </a-flex>
            <a-space wrap :size="[18, 8]">
              <a-typography-text type="secondary"><LockOutlined /> {{ t('landing.hero.metaSec') }}</a-typography-text>
              <a-typography-text type="secondary"><GlobalOutlined /> {{ t('landing.hero.metaIpv6') }}</a-typography-text>
              <a-typography-text type="secondary"><CodeOutlined /> {{ t('landing.hero.metaRust') }}</a-typography-text>
              <a-typography-text type="secondary"><TeamOutlined /> {{ t('landing.hero.metaMulti') }}</a-typography-text>
            </a-space>
          </a-col>

          <a-col :xs="24" :lg="11">
            <a-card size="small" class="term-card">
              <template #title>
                <a-flex align="center" gap="small">
                  <span class="dots" aria-hidden="true"><i /><i /><i /></span>
                  <a-typography-text type="secondary" class="mono term-title" :ellipsis="{ tooltip: t('landing.hero.cardTitle') }" :content="t('landing.hero.cardTitle')" />
                </a-flex>
              </template>
              <template #extra>
                <a-button size="small" :aria-label="t('landing.hero.copy')" @click="copyInstall">
                  <template #icon><CheckOutlined v-if="copied" /><CopyOutlined v-else /></template>
                  <span v-if="screens.sm">{{ copied ? t('landing.hero.copied') : t('landing.hero.copy') }}</span>
                </a-button>
              </template>
              <pre class="mono term-code"><span class="prompt">$</span> {{ installCmd }}</pre>
              <a-row :gutter="[8, 8]" class="term-actions">
                <a-col :xs="24" :sm="12">
                  <a-button block href="https://github.com/proxyboxpro/proxybox-free" target="_blank" rel="noopener">
                    <template #icon><GithubOutlined /></template>
                    {{ locale === 'vi' ? 'Mã nguồn trên GitHub' : 'Source on GitHub' }}
                  </a-button>
                </a-col>
                <a-col :xs="24" :sm="12">
                  <RouterLink v-slot="{ href, navigate }" to="/login" custom>
                    <a-button block type="primary" ghost :href="href" @click="navigate">
                      <template #icon><PlayCircleOutlined /></template>
                      {{ locale === 'vi' ? 'Demo · Đăng nhập thử' : 'Demo · Try sign-in' }}
                    </a-button>
                  </RouterLink>
                </a-col>
              </a-row>
              <a-typography-text type="secondary" class="term-foot">{{ t('landing.hero.cardFoot') }}</a-typography-text>
            </a-card>
          </a-col>
        </a-row>
      </section>

      <!-- Demo screenshot — what the panel actually looks like -->
      <section class="container demo">
        <a-card size="small" class="demo-frame">
          <template #title>
            <a-flex align="center" gap="small">
              <span class="dots" aria-hidden="true"><i /><i /><i /></span>
              <a-typography-text type="secondary" class="demo-label">ProxyBox admin · live preview</a-typography-text>
            </a-flex>
          </template>
          <img class="demo-img" src="/demo-panel.png" alt="ProxyBox admin panel — live demo" loading="lazy" />
        </a-card>
        <a-typography-paragraph type="secondary" class="demo-caption">
          {{ locale === 'vi'
            ? 'Demo panel ProxyBox đang chạy live — dark theme, dashboard, billing, agent management, customer portal đầy đủ.'
            : 'Live ProxyBox panel demo — dark-theme dashboard, billing, agent management and the full customer portal.' }}
        </a-typography-paragraph>
      </section>

      <!-- Features -->
      <section id="features" class="container section">
        <div class="section-head">
          <a-typography-title :level="2">{{ t('landing.feat.title') }}</a-typography-title>
          <a-typography-paragraph type="secondary">{{ t('landing.feat.sub') }}</a-typography-paragraph>
        </div>
        <a-row :gutter="[16, 16]">
          <a-col v-for="f in features" :key="f.titleKey" :xs="24" :sm="12" :xl="6">
            <a-card hoverable class="tile">
              <a-avatar shape="square" :size="40" class="tile-ico"><template #icon><component :is="f.icon" /></template></a-avatar>
              <a-typography-title :level="3" class="tile-h">{{ t(f.titleKey) }}</a-typography-title>
              <a-typography-paragraph type="secondary" class="tile-p">{{ t(f.bodyKey) }}</a-typography-paragraph>
            </a-card>
          </a-col>
        </a-row>
      </section>

      <!-- Architecture -->
      <section class="container section">
        <div class="section-head">
          <a-typography-title :level="2">{{ t('landing.arch.title') }}</a-typography-title>
          <a-typography-paragraph type="secondary">{{ t('landing.arch.sub') }}</a-typography-paragraph>
        </div>

        <!-- Visual SVG diagram -->
        <a-card class="arch-card">
          <div class="arch-svg-wrap">
            <svg viewBox="0 0 1100 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ProxyBox architecture diagram">
              <defs>
                <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" class="mk mk-blue" />
                </marker>
                <marker id="ah-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" class="mk mk-green" />
                </marker>
              </defs>

              <!-- Top row: 3 customer personas -->
              <g transform="translate(0, 12)">
                <text x="40" y="14" class="arch-tier-label">CUSTOMERS · ENTRY POINTS</text>
                <g transform="translate(40, 30)">
                  <rect width="270" height="74" rx="10" class="box box-customer" />
                  <text x="20" y="28" class="box-title">Browser (admin / customer)</text>
                  <text x="20" y="50" class="box-sub">Vue 3 SPA · dashboard + buy / wallet flow</text>
                  <text x="20" y="66" class="box-meta">HTTPS · 60-min session token</text>
                </g>
                <g transform="translate(415, 30)">
                  <rect width="270" height="74" rx="10" class="box box-customer" />
                  <text x="20" y="28" class="box-title">API client / CLI</text>
                  <text x="20" y="50" class="box-sub">REST + JSON · automated provisioning</text>
                  <text x="20" y="66" class="box-meta">X-Customer-Key (160-bit)</text>
                </g>
                <g transform="translate(790, 30)">
                  <rect width="270" height="74" rx="10" class="box box-customer" />
                  <text x="20" y="28" class="box-title">Proxy consumer</text>
                  <text x="20" y="50" class="box-sub">HTTP · SOCKS5 · HTTPS-proxy · Trojan</text>
                  <text x="20" y="66" class="box-meta">user:pass @ node-ip:port</text>
                </g>
              </g>

              <!-- Arrows: customer → control plane / agent -->
              <line x1="175" y1="118" x2="175" y2="218" class="arrow blue" marker-end="url(#ah)" />
              <text x="185" y="170" class="arrow-label">REST</text>
              <line x1="550" y1="118" x2="550" y2="218" class="arrow blue" marker-end="url(#ah)" />
              <text x="560" y="170" class="arrow-label">REST</text>
              <line x1="925" y1="118" x2="925" y2="320" class="arrow green" marker-end="url(#ah-green)" />
              <text x="935" y="200" class="arrow-label green">HTTP /</text>
              <text x="935" y="216" class="arrow-label green">SOCKS5</text>

              <!-- Middle: Control plane (left + center) + Edge agents (right) -->
              <g transform="translate(0, 230)">
                <text x="40" y="-4" class="arch-tier-label">CONTROL PLANE · single Node.js 22 process · /home/proxyhub/proxybox</text>

                <!-- Control plane box -->
                <rect x="40" y="10" width="680" height="290" rx="12" class="box box-cp" />
                <text x="60" y="38" class="box-title">ProxyBox master · ~10k LOC monolith</text>
                <text x="60" y="56" class="box-meta">zero npm framework · only node:* builtins + ssh2 + node-forge</text>

                <!-- subsystems inside control plane -->
                <g transform="translate(60, 78)">
                  <rect width="200" height="88" rx="8" class="sub sub-blue" />
                  <text x="14" y="22" class="sub-title">Auth + sessions</text>
                  <text x="14" y="42" class="sub-line">scrypt password hash</text>
                  <text x="14" y="58" class="sub-line">TOTP 2FA (optional)</text>
                  <text x="14" y="74" class="sub-line">Bearer 60min · OAuth providers</text>
                </g>
                <g transform="translate(280, 78)">
                  <rect width="200" height="88" rx="8" class="sub sub-green" />
                  <text x="14" y="22" class="sub-title">Billing</text>
                  <text x="14" y="42" class="sub-line">Stripe + PayPal · wallet</text>
                  <text x="14" y="58" class="sub-line">auto-renew · credit · tier</text>
                  <text x="14" y="74" class="sub-line">audit trail per tx</text>
                </g>
                <g transform="translate(500, 78)">
                  <rect width="200" height="88" rx="8" class="sub sub-yellow" />
                  <text x="14" y="22" class="sub-title">REST API</text>
                  <text x="14" y="42" class="sub-line">admin · customer · public</text>
                  <text x="14" y="58" class="sub-line">webhook fan-out</text>
                  <text x="14" y="74" class="sub-line">rate-limit + audit</text>
                </g>

                <g transform="translate(60, 178)">
                  <rect width="200" height="88" rx="8" class="sub sub-red" />
                  <text x="14" y="22" class="sub-title">PKI (node-forge)</text>
                  <text x="14" y="42" class="sub-line">self-signed CA</text>
                  <text x="14" y="58" class="sub-line">1 client cert / agent</text>
                  <text x="14" y="74" class="sub-line">mTLS listener :8788</text>
                </g>
                <g transform="translate(280, 178)">
                  <rect width="200" height="88" rx="8" class="sub sub-blue" />
                  <text x="14" y="22" class="sub-title">Storage</text>
                  <text x="14" y="42" class="sub-line">config.json (state)</text>
                  <text x="14" y="58" class="sub-line">SQLite: audit · billing_tx</text>
                  <text x="14" y="74" class="sub-line">master.key AES-256-GCM</text>
                </g>
                <g transform="translate(500, 178)">
                  <rect width="200" height="88" rx="8" class="sub sub-green" />
                  <text x="14" y="22" class="sub-title">Hub orchestrator</text>
                  <text x="14" y="42" class="sub-line">Virtualizor API · addvs</text>
                  <text x="14" y="58" class="sub-line">SSH bootstrap installer</text>
                  <text x="14" y="74" class="sub-line">poll vsDetail + claim</text>
                </g>

                <!-- Edge agents on the right side -->
                <text x="765" y="-4" class="arch-tier-label">EDGE AGENTS · 3 node types</text>

                <g transform="translate(760, 10)">
                  <rect width="300" height="88" rx="10" class="box box-agent" />
                  <text x="16" y="26" class="box-title">Admin pool (A)</text>
                  <text x="16" y="44" class="box-sub">VPS run by operator · paid hourly</text>
                  <text x="16" y="62" class="box-meta">Rust agent · IPv4 + IPv6 /48 routed</text>
                  <text x="16" y="78" class="box-meta">listeners :20000-29999</text>
                </g>
                <g transform="translate(760, 110)">
                  <rect width="300" height="88" rx="10" class="box box-agent box-agent-amber" />
                  <text x="16" y="26" class="box-title">Hub Proxy (B)</text>
                  <text x="16" y="44" class="box-sub">Customer rents VPS by the hour</text>
                  <text x="16" y="62" class="box-meta">addvs → poll → SSH bootstrap</text>
                  <text x="16" y="78" class="box-meta">agent claims placeholder node</text>
                </g>
                <g transform="translate(760, 210)">
                  <rect width="300" height="88" rx="10" class="box box-agent box-agent-green" />
                  <text x="16" y="26" class="box-title">BYON (C)</text>
                  <text x="16" y="44" class="box-sub">Customer's own VPS · free proxies</text>
                  <text x="16" y="62" class="box-meta">1-command install · usr_&lt;id&gt;_token</text>
                  <text x="16" y="78" class="box-meta">tag=byon · ownerId set</text>
                </g>
              </g>

              <!-- mTLS arrows between control plane and edge agents -->
              <line x1="720" y1="262" x2="760" y2="262" class="arrow red dash" marker-end="url(#ah)" />
              <text x="725" y="252" class="arrow-label">mTLS</text>
              <text x="725" y="278" class="arrow-label">:8788</text>

              <line x1="760" y1="362" x2="720" y2="362" class="arrow red dash" marker-end="url(#ah)" />
              <text x="725" y="352" class="arrow-label">heartbeat</text>
              <text x="725" y="378" class="arrow-label">10s</text>

              <line x1="720" y1="462" x2="760" y2="462" class="arrow red dash" marker-end="url(#ah)" />
              <text x="725" y="452" class="arrow-label">long-poll</text>
              <text x="725" y="478" class="arrow-label">25s</text>

              <!-- Bottom: Internet egress -->
              <g transform="translate(0, 555)">
                <rect x="760" y="0" width="300" height="64" rx="10" class="box box-internet" />
                <text x="776" y="24" class="box-title">Internet · target host</text>
                <text x="776" y="44" class="box-sub">egress IPv6 /48 · strict-family resolve</text>
                <text x="776" y="58" class="box-meta">A records ignored · no IPv4 leak</text>

                <line x1="910" y1="0" x2="910" y2="-50" class="arrow green" marker-end="url(#ah-green)" />
                <text x="920" y="-20" class="arrow-label green">egress</text>
              </g>

              <!-- Arrows from buy/wallet customer → CP (left/middle) -->
              <line x1="175" y1="218" x2="175" y2="240" class="arrow blue" marker-end="url(#ah)" />
              <line x1="550" y1="218" x2="550" y2="240" class="arrow blue" marker-end="url(#ah)" />
            </svg>
          </div>
        </a-card>

        <!-- Four flow detail cards -->
        <a-row :gutter="[16, 16]" class="arch-flows">
          <a-col v-for="f in flows" :key="f.tag" :xs="24" :md="12">
            <a-card size="small" class="flow-card">
              <a-flex align="center" gap="small" class="flow-head">
                <a-tag :color="f.color" class="mono flow-tag">{{ f.tag }}</a-tag>
                <a-typography-title :level="4" class="flow-h">{{ f.title }}</a-typography-title>
              </a-flex>
              <pre class="mono code-block">{{ f.code }}</pre>
            </a-card>
          </a-col>
        </a-row>

        <!-- Original concise ASCII for cmd-line readers -->
        <a-card size="small" class="arch-ascii">
          <pre class="mono">{{ archAscii }}</pre>
        </a-card>
      </section>

      <!-- Use cases -->
      <section class="container section">
        <div class="section-head">
          <a-typography-title :level="2">{{ t('landing.use.title') }}</a-typography-title>
        </div>
        <a-row :gutter="[16, 16]">
          <a-col v-for="u in useCases" :key="u.titleKey" :xs="24" :sm="12" :xl="6">
            <a-card class="tile">
              <a-avatar shape="square" :size="40" class="tile-ico tile-ico-info"><template #icon><component :is="u.icon" /></template></a-avatar>
              <a-typography-title :level="3" class="tile-h">{{ t(u.titleKey) }}</a-typography-title>
              <a-typography-paragraph type="secondary" class="tile-p">{{ t(u.bodyKey) }}</a-typography-paragraph>
            </a-card>
          </a-col>
        </a-row>
      </section>

      <!-- Self-host -->
      <section id="self-host" class="self-host">
        <div class="container section">
          <div class="section-head">
            <a-typography-title :level="2">{{ t('landing.host.title') }}</a-typography-title>
            <a-typography-paragraph type="secondary">{{ t('landing.host.sub') }}</a-typography-paragraph>
          </div>
          <a-row :gutter="[24, 24]">
            <a-col :xs="24" :lg="16">
              <a-card>
                <a-steps direction="vertical" class="host-steps">
                  <a-step status="process">
                    <template #title><a-typography-title :level="4" class="step-h">{{ t('landing.host.s1.title') }}</a-typography-title></template>
                    <template #description>{{ t('landing.host.s1.body') }}</template>
                  </a-step>
                  <a-step status="process">
                    <template #title><a-typography-title :level="4" class="step-h">{{ t('landing.host.s2.title') }}</a-typography-title></template>
                    <template #description>
                      {{ t('landing.host.s2.body') }}
                      <pre class="mono code-block step-code">curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash</pre>
                    </template>
                  </a-step>
                  <a-step status="process">
                    <template #title><a-typography-title :level="4" class="step-h">{{ t('landing.host.s3.title') }}</a-typography-title></template>
                    <template #description>{{ t('landing.host.s3.body') }}</template>
                  </a-step>
                </a-steps>
              </a-card>
            </a-col>
            <a-col :xs="24" :lg="8">
              <a-card class="host-cta">
                <a-flex vertical gap="middle">
                  <RouterLink v-slot="{ href, navigate }" to="/faq#self-host-panel" custom>
                    <a-button type="primary" size="large" block :href="href" @click="navigate">
                      {{ t('landing.host.cta1') }} <ArrowRightOutlined />
                    </a-button>
                  </RouterLink>
                  <RouterLink v-slot="{ href, navigate }" to="/faq#self-host-trust" custom>
                    <a-button size="large" block :href="href" @click="navigate">
                      <template #icon><ExportOutlined /></template>
                      {{ t('landing.host.cta2') }}
                    </a-button>
                  </RouterLink>
                  <RouterLink v-slot="{ href, navigate }" to="/api-docs" custom>
                    <a-button size="large" block :href="href" @click="navigate">
                      <template #icon><FileTextOutlined /></template>
                      {{ t('landing.nav.api') }}
                    </a-button>
                  </RouterLink>
                  <a-divider class="host-divider" />
                  <a-typography-text type="secondary"><ClockCircleOutlined /> {{ t('landing.hero.cardFoot') }}</a-typography-text>
                </a-flex>
              </a-card>
            </a-col>
          </a-row>
        </div>
      </section>
    </a-layout-content>

    <a-layout-footer class="landing-foot">
      <div class="container">
        <a-row :gutter="[32, 24]">
          <a-col :xs="24" :md="9">
            <BrandLogo :size="30" />
            <a-typography-paragraph type="secondary" class="foot-tag">{{ t('landing.foot.tag') }}</a-typography-paragraph>
          </a-col>
          <a-col :xs="12" :sm="8" :md="5">
            <a-typography-title :level="5" class="foot-h">{{ t('landing.foot.product') }}</a-typography-title>
            <a-flex vertical gap="small">
              <RouterLink class="foot-link" :to="{ hash: '#features' }">{{ t('landing.nav.features') }}</RouterLink>
              <RouterLink class="foot-link" to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink>
              <RouterLink class="foot-link" to="/api-docs">{{ t('landing.foot.apiDocs') }}</RouterLink>
              <RouterLink class="foot-link" to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
              <RouterLink class="foot-link" to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
            </a-flex>
          </a-col>
          <a-col :xs="12" :sm="8" :md="5">
            <a-typography-title :level="5" class="foot-h">{{ t('landing.foot.host') }}</a-typography-title>
            <a-flex vertical gap="small">
              <RouterLink class="foot-link" to="/faq#self-host-panel">{{ t('landing.foot.docsInstall') }}</RouterLink>
              <RouterLink class="foot-link" to="/faq#self-host-troubleshoot">{{ t('landing.foot.docsTrouble') }}</RouterLink>
              <RouterLink class="foot-link" to="/faq#self-host-trust">{{ t('landing.foot.docsTrust') }}</RouterLink>
            </a-flex>
          </a-col>
          <a-col :xs="12" :sm="8" :md="5">
            <a-typography-title :level="5" class="foot-h">{{ t('landing.foot.community') }}</a-typography-title>
            <a-flex vertical gap="small">
              <RouterLink class="foot-link" to="/login">{{ t('landing.nav.login') }}</RouterLink>
              <RouterLink class="foot-link" to="/register">{{ t('landing.nav.register') }}</RouterLink>
              <RouterLink class="foot-link" to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
            </a-flex>
          </a-col>
        </a-row>
        <a-divider />
        <a-flex justify="space-between" wrap="wrap" gap="small">
          <a-typography-text type="secondary">{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</a-typography-text>
          <a-typography-text type="secondary">
            {{ t('landing.foot.publishedBy') }}
            <a-typography-link href="https://proxybox.pro" target="_blank" rel="noopener" strong>{{ t('landing.foot.onieName') }}</a-typography-link>
            · <a-typography-link href="https://proxybox.pro" target="_blank" rel="noopener" strong>proxybox.pro</a-typography-link>
          </a-typography-text>
        </a-flex>
      </div>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped>
.landing.ant-layout {
  min-height: 100vh;
  overflow-x: clip;
  background:
    radial-gradient(1100px 600px at 80% -10%, color-mix(in srgb, var(--pb-info) 12%, transparent), transparent 70%),
    radial-gradient(900px 500px at -10% 20%, color-mix(in srgb, var(--pb-primary) 9%, transparent), transparent 70%),
    var(--pb-bg);
}
.container { width: 100%; max-width: 1240px; margin: 0 auto; padding-inline: 32px; }
.section { padding-block: 64px; }
.section-head { margin-bottom: 28px; max-width: 680px; }
.section-head :deep(.ant-typography) { margin-bottom: 8px; }
.section-head :deep(div.ant-typography) { font-size: 15px; line-height: 1.6; margin-bottom: 0; }
#features, #self-host { scroll-margin-top: 72px; }

/* Hero */
.hero { padding-block: 80px 56px; }
.hero-pill { margin-bottom: 18px; font-weight: 600; letter-spacing: 0.3px; border-radius: 999px; }
.hero-title.ant-typography {
  font-size: clamp(30px, 4.4vw, 50px);
  line-height: 1.12;
  letter-spacing: -0.5px;
  margin: 0 0 18px;
}
.accent {
  background: linear-gradient(120deg, var(--pb-info), var(--pb-success));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-sub.ant-typography { font-size: 16px; line-height: 1.65; max-width: 580px; margin-bottom: 28px; }
.hero-cta { margin-bottom: 28px; }

/* Terminal-style card (hero install command) */
.term-card { box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18); }
.term-card :deep(.ant-card-body) { padding: 0; }
.term-title { font-size: 12px; min-width: 0; flex: 1; }
.dots { display: inline-flex; gap: 6px; flex-shrink: 0; }
.dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--pb-error); }
.dots i:nth-child(2) { background: var(--pb-warning); }
.dots i:nth-child(3) { background: var(--pb-success); }
.term-code {
  margin: 0;
  padding: 18px 16px;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
  word-break: normal;
}
.prompt { color: var(--pb-success); margin-right: 8px; user-select: none; }
.term-actions { padding: 12px; border-top: 1px solid var(--pb-border-soft); }
.term-foot { display: block; padding: 12px 16px; font-size: 12px; border-top: 1px solid var(--pb-border-soft); }

/* Demo screenshot */
.demo { padding-bottom: 8px; }
.demo-frame { max-width: 1100px; margin: 0 auto; overflow: hidden; box-shadow: 0 20px 80px rgba(0, 0, 0, 0.22); }
.demo-frame :deep(.ant-card-body) { padding: 0; }
.demo-label { font-size: 12px; letter-spacing: 0.4px; }
.demo-img { display: block; width: 100%; height: auto; }
.demo-caption.ant-typography { text-align: center; font-size: 13px; max-width: 720px; margin: 14px auto 0; }

/* Feature / use-case tiles */
.tile { height: 100%; }
.tile-ico { background: var(--pb-primary-soft); color: var(--pb-primary); margin-bottom: 14px; font-size: 18px; }
.tile-ico-info { background: color-mix(in srgb, var(--pb-info) 14%, transparent); color: var(--pb-info); }
.tile-h.ant-typography { font-size: 16px; margin: 0 0 6px; }
.tile-p.ant-typography { font-size: 13px; line-height: 1.6; margin: 0; }

/* Architecture */
.arch-card :deep(.ant-card-body) { padding: 16px; }
.arch-svg-wrap { overflow-x: auto; }
.arch-svg-wrap svg { width: 100%; min-width: 720px; height: auto; display: block; }
.arch-tier-label { fill: var(--pb-text-3); font-family: var(--pb-mono); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; font-weight: 700; }
.box { fill: var(--pb-surface-2); stroke: var(--pb-border); stroke-width: 1; }
.box-customer { stroke: var(--pb-info); }
.box-cp { fill: color-mix(in srgb, var(--pb-info) 4%, var(--pb-surface)); stroke: var(--pb-info); stroke-width: 1.5; }
.box-agent { stroke: var(--pb-info); fill: color-mix(in srgb, var(--pb-info) 8%, var(--pb-surface)); }
.box-agent-amber { stroke: var(--pb-warning); fill: color-mix(in srgb, var(--pb-warning) 8%, var(--pb-surface)); }
.box-agent-green { stroke: var(--pb-success); fill: color-mix(in srgb, var(--pb-success) 8%, var(--pb-surface)); }
.box-internet { stroke: var(--pb-success); fill: color-mix(in srgb, var(--pb-success) 10%, var(--pb-surface)); }
.box-title { fill: var(--pb-text); font-family: var(--pb-sans); font-size: 14px; font-weight: 700; }
.box-sub { fill: var(--pb-text-2); font-family: var(--pb-sans); font-size: 11.5px; }
.box-meta { fill: var(--pb-text-3); font-family: var(--pb-mono); font-size: 10.5px; }
.sub { stroke-width: 1; }
.sub-blue   { fill: color-mix(in srgb, var(--pb-info) 14%, transparent);    stroke: var(--pb-info); }
.sub-green  { fill: color-mix(in srgb, var(--pb-success) 14%, transparent); stroke: var(--pb-success); }
.sub-yellow { fill: color-mix(in srgb, var(--pb-warning) 14%, transparent); stroke: var(--pb-warning); }
.sub-red    { fill: color-mix(in srgb, var(--pb-error) 14%, transparent);   stroke: var(--pb-error); }
.sub-title { fill: var(--pb-text); font-family: var(--pb-sans); font-size: 12.5px; font-weight: 700; }
.sub-line  { fill: var(--pb-text-2); font-family: var(--pb-mono); font-size: 10.5px; }
.arrow { stroke: var(--pb-info); stroke-width: 1.5; fill: none; }
.arrow.green { stroke: var(--pb-success); }
.arrow.red   { stroke: var(--pb-error); }
.arrow.dash  { stroke-dasharray: 4 3; }
.arrow-label { fill: var(--pb-text-3); font-family: var(--pb-mono); font-size: 10.5px; }
.arrow-label.green { fill: var(--pb-success); }
.mk-blue  { fill: var(--pb-info); }
.mk-green { fill: var(--pb-success); }

.arch-flows { margin-top: 16px; }
.flow-card { height: 100%; }
.flow-head { margin-bottom: 10px; }
.flow-tag { margin: 0; font-weight: 700; }
.flow-h.ant-typography { font-size: 14px; margin: 0; }
.code-block {
  margin: 0;
  padding: 12px 14px;
  background: var(--pb-bg);
  border: 1px solid var(--pb-border-soft);
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
  word-break: normal;
}
.arch-ascii { margin-top: 16px; }
.arch-ascii pre { margin: 0; font-size: 12px; line-height: 1.55; overflow-x: auto; white-space: pre; word-break: normal; }

/* Self-host band */
.self-host {
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--pb-info) 7%, transparent), transparent);
  border-block: 1px solid var(--pb-border-soft);
}
.step-h.ant-typography { font-size: 16px; margin: 0; line-height: 32px; }
.host-steps :deep(.ant-steps-item-description) { padding-bottom: 20px !important; line-height: 1.6; }
.step-code { margin-top: 10px; color: var(--pb-success); font-size: 12px; }
.host-cta { height: 100%; }
.host-cta :deep(.ant-btn) { white-space: normal; height: auto; min-height: 40px; }
.host-divider { margin: 4px 0; }

/* Footer */
.landing-foot.ant-layout-footer { background: transparent; border-top: 1px solid var(--pb-border-soft); padding: 48px 0 24px; }
.foot-tag.ant-typography { margin: 12px 0 0; max-width: 300px; font-size: 13px; }
.foot-h.ant-typography { font-size: 13px; margin-bottom: 12px; letter-spacing: 0.3px; }
.foot-link { color: var(--pb-text-2); font-size: 13px; }
.foot-link:hover { color: var(--pb-text); }

@media (max-width: 991px) {
  .container { padding-inline: 20px; }
  .hero { padding-block: 40px 32px; }
  .section { padding-block: 48px; }
}
@media (max-width: 575px) {
  .container { padding-inline: 16px; }
  .hero { padding-block: 24px 24px; }
  .hero-sub.ant-typography { font-size: 14.5px; }
  .hero-cta :deep(.ant-btn) { flex: 1; min-width: 140px; }
  .term-code { font-size: 11.5px; padding: 14px; }
  .section { padding-block: 40px; }
  .section-head :deep(h2.ant-typography) { font-size: 24px; }
  .arch-ascii pre { font-size: 9.5px; line-height: 1.4; }
  .code-block { font-size: 10.5px; }
}
</style>
