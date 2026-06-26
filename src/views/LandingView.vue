<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Box, Cloud, Globe, Lock, Network, Server, ShieldCheck, Cpu,
  ExternalLink, Copy, Check, ArrowRight, Zap, Wallet, Users, FileCode,
  Github, Play
} from 'lucide-vue-next'
import { useI18n } from '../i18n'
import { token } from '../api'
import PublicTopNav from '../components/PublicTopNav.vue'

const router = useRouter()
const { t, locale, setLocale } = useI18n()

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

const features = computed(() => ([
  { icon: Network,      titleKey: 'landing.feat.proto.title', bodyKey: 'landing.feat.proto.body' },
  { icon: Globe,        titleKey: 'landing.feat.ipv6.title',  bodyKey: 'landing.feat.ipv6.body'  },
  { icon: Server,       titleKey: 'landing.feat.byon.title',  bodyKey: 'landing.feat.byon.body'  },
  { icon: Cloud,        titleKey: 'landing.feat.hub.title',   bodyKey: 'landing.feat.hub.body'   },
  { icon: Wallet,       titleKey: 'landing.feat.bill.title',  bodyKey: 'landing.feat.bill.body'  },
  { icon: ShieldCheck,  titleKey: 'landing.feat.sec.title',   bodyKey: 'landing.feat.sec.body'   },
  { icon: Cpu,          titleKey: 'landing.feat.rust.title',  bodyKey: 'landing.feat.rust.body'  },
  { icon: Zap,          titleKey: 'landing.feat.ops.title',   bodyKey: 'landing.feat.ops.body'   }
]))

const useCases = computed(() => ([
  { titleKey: 'landing.use.reseller.title', bodyKey: 'landing.use.reseller.body' },
  { titleKey: 'landing.use.team.title',     bodyKey: 'landing.use.team.body'     },
  { titleKey: 'landing.use.privacy.title',  bodyKey: 'landing.use.privacy.body'  },
  { titleKey: 'landing.use.api.title',      bodyKey: 'landing.use.api.body'      }
]))
</script>

<template>
  <div class="landing">
    <PublicTopNav sub-label="Box Proxy" :anchor-links="[
      { href: '#features',  key: 'landing.nav.features' },
      { href: '#self-host', key: 'landing.nav.selfHost' }
    ]" />

    <section class="hero">
      <div class="hero-inner">
        <span class="hero-eyebrow">{{ t('landing.hero.eyebrow') }}</span>
        <h1>
          {{ t('landing.hero.titlePre') }}
          <span class="accent">{{ t('landing.hero.titleAccent') }}</span>
        </h1>
        <p class="hero-sub">{{ t('landing.hero.sub') }}</p>
        <div class="hero-cta">
          <RouterLink class="btn primary lg" to="/register">{{ t('landing.hero.ctaPrimary') }} <ArrowRight :size="16" /></RouterLink>
          <a class="btn ghost lg" href="#self-host">{{ t('landing.hero.ctaSecondary') }}</a>
        </div>
        <div class="hero-meta">
          <span><Lock :size="14" /> {{ t('landing.hero.metaSec') }}</span>
          <span><Globe :size="14" /> {{ t('landing.hero.metaIpv6') }}</span>
          <span><Cpu :size="14" /> {{ t('landing.hero.metaRust') }}</span>
          <span><Users :size="14" /> {{ t('landing.hero.metaMulti') }}</span>
        </div>
      </div>
      <div class="hero-card">
        <div class="hero-card-head">
          <span class="hero-card-dots">
            <span class="hero-card-dot red"></span>
            <span class="hero-card-dot yellow"></span>
            <span class="hero-card-dot green"></span>
          </span>
          <span class="hero-card-title">{{ t('landing.hero.cardTitle') }}</span>
          <button class="copy-btn" type="button" @click="copyInstall" :aria-label="t('landing.hero.copy')">
            <component :is="copied ? Check : Copy" :size="13" />
            <span class="copy-label">{{ copied ? t('landing.hero.copied') : t('landing.hero.copy') }}</span>
          </button>
        </div>
        <pre class="hero-code"><code><span class="prompt">$</span> {{ installCmd }}</code></pre>
        <div class="hero-card-actions">
          <a class="hero-action" href="https://github.com/proxyboxpro/proxybox-free" target="_blank" rel="noopener">
            <Github :size="14" />
            <span>{{ locale === 'vi' ? 'Mã nguồn trên GitHub' : 'Source on GitHub' }}</span>
          </a>
          <RouterLink class="hero-action demo" to="/login">
            <Play :size="13" />
            <span>{{ locale === 'vi' ? 'Demo · Đăng nhập thử' : 'Demo · Try sign-in' }}</span>
          </RouterLink>
        </div>
        <p class="hero-card-foot">{{ t('landing.hero.cardFoot') }}</p>
      </div>
    </section>

    <!-- Demo screenshot — what the panel actually looks like -->
    <section class="demo-preview">
      <div class="demo-frame">
        <div class="demo-frame-head">
          <span class="hero-card-dots">
            <span class="hero-card-dot red"></span>
            <span class="hero-card-dot yellow"></span>
            <span class="hero-card-dot green"></span>
          </span>
          <span class="demo-frame-label">ProxyBox admin · live preview</span>
        </div>
        <img class="demo-img" src="/demo-panel.png" alt="ProxyBox admin panel — live demo" loading="lazy" />
      </div>
      <p class="demo-caption">
        {{ locale === 'vi'
            ? 'Demo panel ProxyBox đang chạy live — dark theme, dashboard, billing, agent management, customer portal đầy đủ.'
            : 'Live ProxyBox panel demo — dark-theme dashboard, billing, agent management and the full customer portal.' }}
      </p>
    </section>

    <section id="features" class="section">
      <div class="section-head">
        <h2>{{ t('landing.feat.title') }}</h2>
        <p>{{ t('landing.feat.sub') }}</p>
      </div>
      <div class="feature-grid">
        <div v-for="f in features" :key="f.titleKey" class="feature">
          <div class="feature-icon"><component :is="f.icon" :size="20" /></div>
          <h3>{{ t(f.titleKey) }}</h3>
          <p>{{ t(f.bodyKey) }}</p>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>{{ t('landing.arch.title') }}</h2>
        <p>{{ t('landing.arch.sub') }}</p>
      </div>

      <!-- Visual SVG diagram -->
      <div class="arch-svg-wrap">
        <svg viewBox="0 0 1100 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ProxyBox architecture diagram">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#58a6ff"/>
            </marker>
            <marker id="ah-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3fb950"/>
            </marker>
            <marker id="ah-yellow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#d29922"/>
            </marker>
            <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#58a6ff"/>
              <stop offset="1" stop-color="#3fb950"/>
            </linearGradient>
          </defs>

          <!-- Top row: 3 customer personas -->
          <g class="arch-tier" transform="translate(0, 12)">
            <text x="40" y="14" class="arch-tier-label">CUSTOMERS · ENTRY POINTS</text>
            <g transform="translate(40, 30)">
              <rect width="270" height="74" rx="10" class="box box-customer"/>
              <text x="20" y="28" class="box-title">Browser (admin / customer)</text>
              <text x="20" y="50" class="box-sub">Vue 3 SPA · dashboard + buy / wallet flow</text>
              <text x="20" y="66" class="box-meta">HTTPS · 60-min session token</text>
            </g>
            <g transform="translate(415, 30)">
              <rect width="270" height="74" rx="10" class="box box-customer"/>
              <text x="20" y="28" class="box-title">API client / CLI</text>
              <text x="20" y="50" class="box-sub">REST + JSON · automated provisioning</text>
              <text x="20" y="66" class="box-meta">X-Customer-Key (160-bit)</text>
            </g>
            <g transform="translate(790, 30)">
              <rect width="270" height="74" rx="10" class="box box-customer"/>
              <text x="20" y="28" class="box-title">Proxy consumer</text>
              <text x="20" y="50" class="box-sub">HTTP · SOCKS5 · HTTPS-proxy · Trojan</text>
              <text x="20" y="66" class="box-meta">user:pass @ node-ip:port</text>
            </g>
          </g>

          <!-- Arrows: customer → control plane / agent -->
          <line x1="175" y1="118" x2="175" y2="218" class="arrow blue" marker-end="url(#ah)"/>
          <text x="185" y="170" class="arrow-label">REST</text>
          <line x1="550" y1="118" x2="550" y2="218" class="arrow blue" marker-end="url(#ah)"/>
          <text x="560" y="170" class="arrow-label">REST</text>
          <line x1="925" y1="118" x2="925" y2="320" class="arrow green" marker-end="url(#ah-green)"/>
          <text x="935" y="200" class="arrow-label green">HTTP /</text>
          <text x="935" y="216" class="arrow-label green">SOCKS5</text>

          <!-- Middle: Control plane (left + center) + Edge agents (right) -->
          <g transform="translate(0, 230)">
            <text x="40" y="-4" class="arch-tier-label">CONTROL PLANE · single Node.js 22 process · /home/proxyhub/proxybox</text>

            <!-- Control plane box -->
            <rect x="40" y="10" width="680" height="290" rx="12" class="box box-cp"/>
            <text x="60" y="38" class="box-title">ProxyBox master · ~10k LOC monolith</text>
            <text x="60" y="56" class="box-meta">zero npm framework · only node:* builtins + ssh2 + node-forge</text>

            <!-- subsystems inside control plane -->
            <g transform="translate(60, 78)">
              <rect width="200" height="88" rx="8" class="sub sub-blue"/>
              <text x="14" y="22" class="sub-title">Auth + sessions</text>
              <text x="14" y="42" class="sub-line">scrypt password hash</text>
              <text x="14" y="58" class="sub-line">TOTP 2FA (optional)</text>
              <text x="14" y="74" class="sub-line">Bearer 60min · OAuth providers</text>
            </g>
            <g transform="translate(280, 78)">
              <rect width="200" height="88" rx="8" class="sub sub-green"/>
              <text x="14" y="22" class="sub-title">Billing</text>
              <text x="14" y="42" class="sub-line">Stripe + PayPal · wallet</text>
              <text x="14" y="58" class="sub-line">auto-renew · credit · tier</text>
              <text x="14" y="74" class="sub-line">audit trail per tx</text>
            </g>
            <g transform="translate(500, 78)">
              <rect width="200" height="88" rx="8" class="sub sub-yellow"/>
              <text x="14" y="22" class="sub-title">REST API</text>
              <text x="14" y="42" class="sub-line">admin · customer · public</text>
              <text x="14" y="58" class="sub-line">webhook fan-out</text>
              <text x="14" y="74" class="sub-line">rate-limit + audit</text>
            </g>

            <g transform="translate(60, 178)">
              <rect width="200" height="88" rx="8" class="sub sub-red"/>
              <text x="14" y="22" class="sub-title">PKI (node-forge)</text>
              <text x="14" y="42" class="sub-line">self-signed CA</text>
              <text x="14" y="58" class="sub-line">1 client cert / agent</text>
              <text x="14" y="74" class="sub-line">mTLS listener :8788</text>
            </g>
            <g transform="translate(280, 178)">
              <rect width="200" height="88" rx="8" class="sub sub-blue"/>
              <text x="14" y="22" class="sub-title">Storage</text>
              <text x="14" y="42" class="sub-line">config.json (state)</text>
              <text x="14" y="58" class="sub-line">SQLite: audit · billing_tx</text>
              <text x="14" y="74" class="sub-line">master.key AES-256-GCM</text>
            </g>
            <g transform="translate(500, 178)">
              <rect width="200" height="88" rx="8" class="sub sub-green"/>
              <text x="14" y="22" class="sub-title">Hub orchestrator</text>
              <text x="14" y="42" class="sub-line">Virtualizor API · addvs</text>
              <text x="14" y="58" class="sub-line">SSH bootstrap installer</text>
              <text x="14" y="74" class="sub-line">poll vsDetail + claim</text>
            </g>

            <!-- Edge agents on the right side -->
            <text x="765" y="-4" class="arch-tier-label">EDGE AGENTS · 3 node types</text>

            <g transform="translate(760, 10)">
              <rect width="300" height="88" rx="10" class="box box-agent"/>
              <text x="16" y="26" class="box-title">Admin pool (A)</text>
              <text x="16" y="44" class="box-sub">VPS run by operator · paid hourly</text>
              <text x="16" y="62" class="box-meta">Rust agent · IPv4 + IPv6 /48 routed</text>
              <text x="16" y="78" class="box-meta">listeners :20000-29999</text>
            </g>
            <g transform="translate(760, 110)">
              <rect width="300" height="88" rx="10" class="box box-agent box-agent-amber"/>
              <text x="16" y="26" class="box-title">Hub Proxy (B)</text>
              <text x="16" y="44" class="box-sub">Customer rents VPS by the hour</text>
              <text x="16" y="62" class="box-meta">addvs → poll → SSH bootstrap</text>
              <text x="16" y="78" class="box-meta">agent claims placeholder node</text>
            </g>
            <g transform="translate(760, 210)">
              <rect width="300" height="88" rx="10" class="box box-agent box-agent-green"/>
              <text x="16" y="26" class="box-title">BYON (C)</text>
              <text x="16" y="44" class="box-sub">Customer's own VPS · free proxies</text>
              <text x="16" y="62" class="box-meta">1-command install · usr_&lt;id&gt;_token</text>
              <text x="16" y="78" class="box-meta">tag=byon · ownerId set</text>
            </g>
          </g>

          <!-- mTLS arrows between control plane and edge agents -->
          <line x1="720" y1="262" x2="760" y2="262" class="arrow red dash" marker-end="url(#ah)"/>
          <text x="725" y="252" class="arrow-label">mTLS</text>
          <text x="725" y="278" class="arrow-label">:8788</text>

          <line x1="760" y1="362" x2="720" y2="362" class="arrow red dash" marker-end="url(#ah)"/>
          <text x="725" y="352" class="arrow-label">heartbeat</text>
          <text x="725" y="378" class="arrow-label">10s</text>

          <line x1="720" y1="462" x2="760" y2="462" class="arrow red dash" marker-end="url(#ah)"/>
          <text x="725" y="452" class="arrow-label">long-poll</text>
          <text x="725" y="478" class="arrow-label">25s</text>

          <!-- Bottom: Internet egress -->
          <g transform="translate(0, 555)">
            <rect x="760" y="0" width="300" height="64" rx="10" class="box box-internet"/>
            <text x="776" y="24" class="box-title">Internet · target host</text>
            <text x="776" y="44" class="box-sub">egress IPv6 /48 · strict-family resolve</text>
            <text x="776" y="58" class="box-meta">A records ignored · no IPv4 leak</text>

            <line x1="910" y1="0" x2="910" y2="-50" class="arrow green" marker-end="url(#ah-green)"/>
            <text x="920" y="-20" class="arrow-label green">egress</text>
          </g>

          <!-- Arrows from buy/wallet customer → CP (left/middle) -->
          <line x1="175" y1="218" x2="175" y2="240" class="arrow blue" marker-end="url(#ah)"/>
          <line x1="550" y1="218" x2="550" y2="240" class="arrow blue" marker-end="url(#ah)"/>
        </svg>
      </div>

      <!-- Three flow detail cards -->
      <div class="arch-flows">
        <div class="arch-flow">
          <h4><span class="flow-tag a">A</span> Pool — Customer buys hourly proxy</h4>
          <pre><code>1. Customer logs in + tops up wallet
2. POST /api/v1/user/orders
   { type: ipv6, qty: 5, zone: vn-hcm }
3. Master picks zone node + pushes config
4. Returns credentials (host:port + user:pass)
5. Customer connects → egress IPv6 from /48</code></pre>
        </div>
        <div class="arch-flow amber">
          <h4><span class="flow-tag b">B</span> Hub — Customer rents VPS by the hour</h4>
          <pre><code>1. Customer picks plan + zone (Virtualizor)
2. Master calls addvs → poll vsDetail
3. SSH bootstrap: curl install.sh on new VPS
4. Agent enrolls + claims placeholder node
5. Customer creates proxies on their hub
   (billing already paid hourly)</code></pre>
        </div>
        <div class="arch-flow green">
          <h4><span class="flow-tag c">C</span> BYON — Customer brings own VPS</h4>
          <pre><code>1. Customer SSH into their own VPS
2. Paste: curl panel/api/agent/install/&lt;tok&gt;
   | sudo bash -s v4
3. Agent downloads + enrols (tag=byon)
4. Node shows up under /my-nodes
5. Customer creates FREE proxies
   (slot-based, no wallet charge)</code></pre>
        </div>
        <div class="arch-flow red">
          <h4><span class="flow-tag s">S</span> Security &amp; at-rest encryption</h4>
          <pre><code>• Browser ↔ nginx :443 (LE cert, HSTS)
• Agent ↔ master mTLS :8788 (1 cert/node)
• Password: scrypt (16-byte salt, 64-byte derive)
• Secrets in config.json: AES-256-GCM
   (SSH pw · VZ key · OAuth client_secret)
• master.key: 32 bytes, chmod 600
• Audit + conn_events in SQLite</code></pre>
        </div>
      </div>

      <!-- Original concise ASCII for cmd-line readers -->
      <pre class="arch-ascii"><code>┌────────────────────────────────────────────────────────────┐
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
└────────────────────────────────────────────────────────────┘</code></pre>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>{{ t('landing.use.title') }}</h2>
      </div>
      <div class="usecase-grid">
        <div v-for="u in useCases" :key="u.titleKey" class="usecase">
          <h3>{{ t(u.titleKey) }}</h3>
          <p>{{ t(u.bodyKey) }}</p>
        </div>
      </div>
    </section>

    <section id="self-host" class="section section-self-host">
      <div class="section-head">
        <h2>{{ t('landing.host.title') }}</h2>
        <p>{{ t('landing.host.sub') }}</p>
      </div>
      <div class="self-host-grid">
        <div class="self-host-step">
          <div class="step-num">1</div>
          <h4>{{ t('landing.host.s1.title') }}</h4>
          <p>{{ t('landing.host.s1.body') }}</p>
        </div>
        <div class="self-host-step">
          <div class="step-num">2</div>
          <h4>{{ t('landing.host.s2.title') }}</h4>
          <p>{{ t('landing.host.s2.body') }}</p>
          <pre class="step-code"><code>curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash</code></pre>
        </div>
        <div class="self-host-step">
          <div class="step-num">3</div>
          <h4>{{ t('landing.host.s3.title') }}</h4>
          <p>{{ t('landing.host.s3.body') }}</p>
        </div>
      </div>
      <div class="self-host-cta">
        <RouterLink class="btn primary" to="/faq#self-host-panel">{{ t('landing.host.cta1') }} <ArrowRight :size="14" /></RouterLink>
        <RouterLink class="btn ghost" to="/faq#self-host-trust">{{ t('landing.host.cta2') }} <ExternalLink :size="14" /></RouterLink>
        <RouterLink class="btn ghost" to="/api-docs"><FileCode :size="14" /> {{ t('landing.nav.api') }}</RouterLink>
      </div>
    </section>

    <footer class="landing-foot">
      <div class="foot-col">
        <div class="landing-brand">
          <span class="logo-mark"><Box :size="18" /></span>
          <strong>ProxyBox</strong>
        </div>
        <p class="foot-tag">{{ t('landing.foot.tag') }}</p>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.product') }}</h5>
        <a href="#features">{{ t('landing.nav.features') }}</a>
        <RouterLink to="/pricing">{{ t('landing.nav.pricing') }}</RouterLink>
        <RouterLink to="/api-docs">{{ t('landing.foot.apiDocs') }}</RouterLink>
        <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.host') }}</h5>
        <RouterLink to="/faq#self-host-panel">{{ t('landing.foot.docsInstall') }}</RouterLink>
        <RouterLink to="/faq#self-host-troubleshoot">{{ t('landing.foot.docsTrouble') }}</RouterLink>
        <RouterLink to="/faq#self-host-trust">{{ t('landing.foot.docsTrust') }}</RouterLink>
      </div>
      <div class="foot-col">
        <h5>{{ t('landing.foot.community') }}</h5>
        <RouterLink to="/login">{{ t('landing.nav.login') }}</RouterLink>
        <RouterLink to="/register">{{ t('landing.nav.register') }}</RouterLink>
        <RouterLink to="/changelog">{{ t('landing.nav.changelog') }}</RouterLink>
      </div>
      <div class="foot-bottom">
        <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
        <span class="foot-onie">
          {{ t('landing.foot.publishedBy') }}
          <a href="https://proxybox.pro" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background:
    radial-gradient(1100px 600px at 80% -10%, rgba(88,166,255,0.10), transparent 70%),
    radial-gradient(900px 500px at -10% 20%, rgba(63,185,80,0.07), transparent 70%),
    var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.landing * { box-sizing: border-box; }
.landing a { color: inherit; text-decoration: none; }

.landing-nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 32px;
  border-bottom: 1px solid var(--border-soft);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 50;
}
.landing-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 16px; flex-shrink: 0; }
.landing-brand .logo-mark {
  width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #58a6ff, #3fb950); color: #0a0e14;
}
.landing-brand .brand-sub {
  font-size: 11px; color: var(--dim); padding: 2px 6px;
  border: 1px solid var(--border); border-radius: 4px;
  margin-left: 2px; font-weight: 500; letter-spacing: 0.4px;
}
.landing-nav-links { display: flex; gap: 22px; margin-left: 18px; flex: 1; min-width: 0; }
.landing-nav-links a { color: var(--dim); font-size: 14px; white-space: nowrap; }
.landing-nav-links a:hover { color: var(--text); }
.landing-nav-actions { display: flex; gap: 8px; align-items: center; }
.lang-toggle, .theme-btn {
  display: inline-flex; align-items: center;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  overflow: hidden;
}
.lang-toggle button {
  border: 0; background: transparent; color: var(--dim);
  padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.lang-toggle button.active { background: var(--surface); color: var(--text); }
.theme-btn { border: 1px solid var(--border); padding: 6px 10px; color: var(--dim); cursor: pointer; }
.theme-btn:hover { color: var(--text); }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); cursor: pointer; transition: 0.15s;
  white-space: nowrap;
}
.btn:hover { background: var(--surface); border-color: var(--blue); }
.btn.primary {
  background: linear-gradient(135deg, #58a6ff, #2f81f7);
  border-color: transparent; color: #0a0e14;
}
.btn.primary:hover { filter: brightness(1.1); }
.btn.ghost { background: transparent; }
.btn.lg { padding: 12px 20px; font-size: 14px; }

.hero {
  display: grid; grid-template-columns: 1.2fr 1fr;
  gap: 56px; padding: 80px 32px 64px;
  max-width: 1240px; margin: 0 auto;
}
.hero-eyebrow {
  display: inline-block; padding: 4px 10px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  border: 1px solid var(--border); border-radius: 999px;
  color: var(--green); background: var(--green-soft);
  margin-bottom: 18px;
}
.hero h1 {
  font-size: clamp(30px, 4.4vw, 52px);
  line-height: 1.1;
  margin: 0 0 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.hero h1 .accent {
  background: linear-gradient(120deg, #58a6ff, #3fb950);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-sub { font-size: 16px; line-height: 1.6; color: var(--dim); margin: 0 0 28px; max-width: 580px; }
.hero-cta { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
.hero-meta {
  display: flex; flex-wrap: wrap; gap: 18px;
  color: var(--dim); font-size: 13px;
}
.hero-meta span { display: inline-flex; align-items: center; gap: 6px; }

.hero-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden;
  align-self: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  min-width: 0; max-width: 100%;
}
.hero-card-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.hero-card-dots { display: inline-flex; gap: 6px; flex-shrink: 0; }
.hero-card-dot { width: 10px; height: 10px; border-radius: 999px; }
.hero-card-dot.red { background: var(--red); }
.hero-card-dot.yellow { background: var(--yellow); }
.hero-card-dot.green { background: var(--green); }
.hero-card-title {
  flex: 1; min-width: 0;
  font-size: 12px; color: var(--dim); font-family: var(--mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hero-code {
  margin: 0; padding: 18px 16px;
  font-family: var(--mono); font-size: 13px; line-height: 1.6;
  color: var(--text);
  overflow-x: auto;
  white-space: pre; word-break: normal;
  -webkit-overflow-scrolling: touch;
}
.hero-code .prompt { color: var(--green); margin-right: 8px; }
.copy-btn {
  flex-shrink: 0;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--dim); padding: 5px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  transition: 0.15s;
}
.copy-btn:hover { color: var(--text); border-color: var(--blue); }
.hero-card-foot {
  margin: 0; padding: 12px 16px;
  font-size: 12px; color: var(--dim);
  border-top: 1px solid var(--border-soft);
}
.hero-card-actions {
  display: flex; gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border-soft);
  background: var(--surface-2);
}
.hero-action {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 12px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text); font-size: 12.5px; font-weight: 600;
  text-decoration: none;
  transition: 0.15s;
}
.hero-action:hover {
  border-color: var(--blue);
  background: color-mix(in srgb, var(--bg) 75%, var(--blue-soft) 25%);
  color: var(--blue);
}
.hero-action.demo {
  background: linear-gradient(135deg, var(--green-soft), color-mix(in srgb, var(--green-soft) 80%, transparent));
  border-color: color-mix(in srgb, var(--green) 35%, var(--border));
  color: var(--green);
}
.hero-action.demo:hover {
  border-color: var(--green);
  background: linear-gradient(135deg, color-mix(in srgb, var(--green-soft) 60%, var(--green) 5%), var(--green-soft));
}
.hero-action svg { flex-shrink: 0; }

.section {
  max-width: 1240px; margin: 0 auto;
  padding: 64px 32px;
}
.section-head { margin-bottom: 32px; }
.section-head h2 { font-size: 30px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.3px; }
.section-head p { font-size: 15px; color: var(--dim); margin: 0; max-width: 620px; line-height: 1.6; }

.feature-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.feature {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 18px;
}
.feature:hover { border-color: var(--blue); }
.feature-icon {
  width: 36px; height: 36px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--blue-soft); color: var(--blue);
  margin-bottom: 12px;
}
.feature h3 { font-size: 15px; margin: 0 0 6px; }
.feature p { font-size: 13px; color: var(--dim); margin: 0; line-height: 1.55; }

/* Demo screenshot frame (browser chrome look) */
.demo-preview {
  max-width: 1240px; margin: 0 auto;
  padding: 0 32px 24px;
}
.demo-frame {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 20px 80px rgba(0,0,0,0.45), 0 0 0 1px color-mix(in srgb, var(--blue) 8%, transparent);
  margin: 0 auto;
  max-width: 1100px;
}
.demo-frame-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.demo-frame-label {
  flex: 1; min-width: 0;
  text-align: center;
  font-size: 12px; color: var(--dim);
  letter-spacing: 0.4px;
  font-family: 'Inter', sans-serif; font-weight: 500;
}
.demo-img {
  display: block; width: 100%; height: auto;
}
.demo-caption {
  text-align: center; color: var(--dim); font-size: 13px;
  margin: 14px auto 0; max-width: 720px; line-height: 1.55;
}

.arch-ascii {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px; overflow-x: auto;
  font-family: var(--mono); font-size: 12px; line-height: 1.55;
  color: var(--text); margin: 24px 0 0;
}

/* SVG architecture diagram */
.arch-svg-wrap {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px;
  overflow-x: auto;
  margin-bottom: 18px;
}
.arch-svg-wrap svg {
  width: 100%; min-width: 720px;
  height: auto; display: block;
}
.arch-svg-wrap .arch-tier-label {
  fill: var(--dim); font-family: var(--mono); font-size: 11px;
  letter-spacing: 1px; text-transform: uppercase; font-weight: 700;
}
.arch-svg-wrap .box {
  fill: var(--surface-2); stroke: var(--border); stroke-width: 1;
}
.arch-svg-wrap .box-customer { stroke: var(--blue); }
.arch-svg-wrap .box-cp { fill: color-mix(in srgb, var(--surface) 95%, var(--blue) 5%); stroke: var(--blue); stroke-width: 1.5; }
.arch-svg-wrap .box-agent { stroke: var(--blue); fill: color-mix(in srgb, var(--surface) 92%, var(--blue) 8%); }
.arch-svg-wrap .box-agent-amber { stroke: var(--yellow); fill: color-mix(in srgb, var(--surface) 92%, var(--yellow) 8%); }
.arch-svg-wrap .box-agent-green { stroke: var(--green); fill: color-mix(in srgb, var(--surface) 92%, var(--green) 8%); }
.arch-svg-wrap .box-internet { stroke: var(--green); fill: color-mix(in srgb, var(--surface) 90%, var(--green) 10%); }
.arch-svg-wrap .box-title {
  fill: var(--text); font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700;
}
.arch-svg-wrap .box-sub {
  fill: var(--dim); font-family: 'Inter', sans-serif; font-size: 11.5px;
}
.arch-svg-wrap .box-meta {
  fill: var(--dim); font-family: var(--mono); font-size: 10.5px;
}
.arch-svg-wrap .sub { stroke-width: 1; }
.arch-svg-wrap .sub-blue   { fill: var(--blue-soft);   stroke: var(--blue);   }
.arch-svg-wrap .sub-green  { fill: var(--green-soft);  stroke: var(--green);  }
.arch-svg-wrap .sub-yellow { fill: var(--yellow-soft); stroke: var(--yellow); }
.arch-svg-wrap .sub-red    { fill: var(--red-soft);    stroke: var(--red);    }
.arch-svg-wrap .sub-title { fill: var(--text); font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 700; }
.arch-svg-wrap .sub-line  { fill: var(--dim);  font-family: var(--mono); font-size: 10.5px; }
.arch-svg-wrap .arrow { stroke: var(--blue); stroke-width: 1.5; fill: none; }
.arch-svg-wrap .arrow.green  { stroke: var(--green); }
.arch-svg-wrap .arrow.yellow { stroke: var(--yellow); }
.arch-svg-wrap .arrow.red    { stroke: var(--red); }
.arch-svg-wrap .arrow.dash   { stroke-dasharray: 4 3; }
.arch-svg-wrap .arrow-label  {
  fill: var(--dim); font-family: var(--mono); font-size: 10.5px;
}
.arch-svg-wrap .arrow-label.green { fill: var(--green); }

/* Detail flow cards (4-up) */
.arch-flows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0 0;
}
.arch-flow {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px;
}
.arch-flow h4 {
  margin: 0 0 10px; font-size: 14px; font-weight: 700;
  display: inline-flex; align-items: center; gap: 8px;
}
.arch-flow pre {
  margin: 0; padding: 12px 14px;
  background: var(--bg); border: 1px solid var(--border-soft);
  border-radius: 8px;
  overflow-x: auto;
}
.arch-flow pre code {
  font-family: var(--mono); font-size: 11.5px; line-height: 1.55;
  color: var(--text); white-space: pre;
}
.flow-tag {
  display: inline-grid; place-items: center;
  width: 22px; height: 22px; border-radius: 5px;
  font-family: var(--mono); font-size: 11px; font-weight: 700;
}
.flow-tag.a { background: var(--blue-soft);   color: var(--blue); }
.flow-tag.b { background: var(--yellow-soft); color: var(--yellow); }
.flow-tag.c { background: var(--green-soft);  color: var(--green); }
.flow-tag.s { background: var(--red-soft);    color: var(--red); }
.arch-flow.amber  { border-color: color-mix(in srgb, var(--yellow) 30%, var(--border)); }
.arch-flow.green  { border-color: color-mix(in srgb, var(--green) 30%, var(--border)); }
.arch-flow.red    { border-color: color-mix(in srgb, var(--red) 30%, var(--border)); }

.usecase-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.usecase {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px;
}
.usecase h3 { font-size: 15px; margin: 0 0 8px; color: var(--blue); }
.usecase p { font-size: 13px; color: var(--dim); margin: 0; line-height: 1.55; }

.section-self-host {
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--blue-soft) 40%, transparent), transparent);
  border-top: 1px solid var(--border-soft);
  border-bottom: 1px solid var(--border-soft);
  max-width: none; padding-left: 0; padding-right: 0;
}
.section-self-host > .section-head,
.section-self-host > .self-host-grid,
.section-self-host > .self-host-cta {
  max-width: 1240px; margin-left: auto; margin-right: auto;
  padding-left: 32px; padding-right: 32px;
}
.self-host-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 32px; }
.self-host-step {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px; position: relative;
}
.step-num {
  position: absolute; top: -14px; left: 20px;
  width: 32px; height: 32px; border-radius: 8px;
  background: linear-gradient(135deg, #58a6ff, #3fb950); color: #0a0e14;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px;
}
.self-host-step h4 { margin: 12px 0 8px; font-size: 15px; }
.self-host-step p { font-size: 13px; color: var(--dim); line-height: 1.55; margin: 0 0 12px; }
.self-host-step p:last-child { margin-bottom: 0; }
.step-code {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 10px 12px;
  font-family: var(--mono); font-size: 12px; color: var(--green);
  margin: 0; overflow-x: auto;
}
.self-host-cta { display: flex; flex-wrap: wrap; gap: 12px; }

.landing-foot {
  display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 32px; padding: 56px 32px 24px;
  max-width: 1240px; margin: 0 auto;
  border-top: 1px solid var(--border-soft);
}
.foot-col h5 { margin: 0 0 12px; font-size: 13px; color: var(--text); letter-spacing: 0.3px; }
.foot-col a { display: block; color: var(--dim); font-size: 13px; padding: 4px 0; }
.foot-col a:hover { color: var(--text); }
.foot-tag { color: var(--dim); font-size: 13px; margin: 12px 0 0; max-width: 280px; line-height: 1.5; }
.foot-bottom {
  grid-column: 1 / -1;
  border-top: 1px solid var(--border-soft);
  padding-top: 18px; margin-top: 8px;
  color: var(--dim); font-size: 12px;
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.foot-onie a { color: var(--text); text-decoration: none; font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

@media (max-width: 980px) {
  .hero { grid-template-columns: 1fr; gap: 32px; padding: 48px 20px; }
  .hero-card { order: -1; }
  .landing-nav { padding: 12px 16px; gap: 12px; }
  .landing-nav-links { display: none; }
  .section { padding: 48px 20px; }
  .feature-grid { grid-template-columns: repeat(2, 1fr); }
  .usecase-grid { grid-template-columns: 1fr 1fr; }
  .self-host-grid { grid-template-columns: 1fr; gap: 28px; }
  .section-self-host > .section-head,
  .section-self-host > .self-host-grid,
  .section-self-host > .self-host-cta {
    padding-left: 20px; padding-right: 20px;
  }
  .landing-foot { grid-template-columns: 1fr 1fr; padding: 40px 20px 20px; }
  .foot-bottom { flex-direction: column; gap: 8px; }
  .desktop-only { display: none; }
  .arch-flows { grid-template-columns: 1fr; }
  .arch-svg-wrap { padding: 12px; }
  .demo-preview { padding: 0 16px 20px; }
}
@media (max-width: 640px) {
  .landing-nav { padding: 10px 14px; gap: 8px; }
  .landing-brand strong { font-size: 15px; }
  .landing-brand .brand-sub { display: none; }
  .landing-nav-actions { gap: 6px; }
  .theme-btn { display: none; }
  .lang-toggle button { padding: 5px 8px; font-size: 11px; }
  .btn { padding: 7px 12px; font-size: 12px; }
  .btn.lg { padding: 11px 16px; font-size: 14px; }

  .hero { padding: 32px 16px 40px; gap: 24px; }
  .hero h1 { font-size: 28px; }
  .hero-sub { font-size: 14.5px; }
  .hero-eyebrow { font-size: 10px; padding: 3px 8px; }
  .hero-meta { gap: 10px; font-size: 12px; }
  .hero-cta { gap: 8px; }
  .hero-cta .btn.lg { flex: 1; justify-content: center; min-width: 140px; }
  .hero-card-head { padding: 8px 10px; gap: 8px; }
  .hero-card-dots { gap: 4px; }
  .hero-card-dot { width: 8px; height: 8px; }
  .hero-card-title { font-size: 10.5px; }
  .hero-code { padding: 14px 14px 14px 14px; font-size: 11.5px; }
  .copy-btn { padding: 4px 8px; font-size: 10px; }
  .copy-btn .copy-label { display: none; }
  .hero-card-actions { padding: 10px 12px; gap: 6px; }
  .hero-action { padding: 7px 10px; font-size: 11.5px; }

  .section { padding: 40px 16px; }
  .section-head h2 { font-size: 24px; }
  .section-head p { font-size: 14px; }
  .feature-grid, .usecase-grid { grid-template-columns: 1fr; gap: 12px; }
  .feature, .usecase { padding: 16px; }
  .arch-ascii { padding: 12px; font-size: 9.5px; line-height: 1.4; }
  .arch-flow pre code { font-size: 10.5px; }
  .arch-flow { padding: 12px; }
  .demo-frame-head { padding: 8px 10px; gap: 8px; }
  .demo-frame-label { font-size: 11px; }
  .demo-caption { font-size: 12.5px; }

  .section-self-host > .section-head,
  .section-self-host > .self-host-grid,
  .section-self-host > .self-host-cta {
    padding-left: 16px; padding-right: 16px;
  }
  .self-host-cta { flex-direction: column; align-items: stretch; }
  .self-host-cta .btn { justify-content: center; }

  .landing-foot { grid-template-columns: 1fr; padding: 32px 16px 20px; gap: 22px; }
}
</style>
