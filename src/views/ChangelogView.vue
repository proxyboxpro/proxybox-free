<script setup>
import { computed } from 'vue'
import { Box, ArrowRight, Sparkles, Wrench, AlertTriangle, ShieldCheck, Rocket } from 'lucide-vue-next'
import { useI18n } from '../i18n'
import PublicTopNav from '../components/PublicTopNav.vue'

const { t, locale, setLocale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')

// Version history. Newest first. `tag` drives the colour pill.
//   feature  → blue/green   new capability
//   fix      → yellow       bug fix / polish
//   security → red/orange   security-relevant
//   breaking → red          requires migration
//   release  → green        major coordinated release
//
// Items use { vi, en } pairs so a single source covers both locales.
const releases = [
  {
    version: '1.6.8', date: '2026-06-24', tag: 'fix',
    titleEn: 'PayPal currency conversion — wallet currency ↔ PayPal charge currency',
    titleVi: 'Chuyển đổi tiền tệ PayPal — tiền tệ ví ↔ tiền tệ charge PayPal',
    items: [
      { en: 'Fixed: when PayPal charges a different currency than the wallet (e.g. USD charge into a VND wallet), the payment was credited 1:1, so a $1 top-up became 1₫. PayPal now converts both ways using an admin-set exchange rate — the customer is charged amount ÷ rate and credited the full requested amount in the wallet currency.',
        vi: 'Đã sửa: khi PayPal charge tiền tệ khác với ví (vd charge USD vào ví VND), thanh toán bị cộng 1:1 nên nạp $1 thành 1₫. Giờ PayPal quy đổi hai chiều theo tỉ giá admin đặt — khách bị charge (số tiền ÷ tỉ giá) và được cộng đúng số tiền yêu cầu theo tiền tệ của ví.' },
      { en: 'New admin setting under Payment → PayPal: exchange rate (default 25,000, i.e. 1 USD = 25,000 VND). The customer top-up screen shows the live charge amount in the PayPal currency.',
        vi: 'Thêm cài đặt admin ở Thanh toán → PayPal: tỉ giá (mặc định 25.000, tức 1 USD = 25.000 VND). Màn nạp tiền của khách hiển thị số tiền sẽ bị charge theo tiền tệ PayPal.' },
    ],
  },
  {
    version: '1.2.0', date: '2026-05-19', tag: 'release',
    titleEn: 'PayPal, English-default UI, public API docs',
    titleVi: 'PayPal, mặc định tiếng Anh, public API docs',
    items: [
      { en: 'PayPal payment method — admin configures in /admin/payment (sandbox or live), customers top-up via PayPal redirect flow with wallet credit on capture.',
        vi: 'Phương thức thanh toán PayPal — admin cấu hình ở /admin/payment (sandbox hoặc live), customer topup qua PayPal redirect, ví được credit khi capture.' },
      { en: 'Default UI language switched to English; browser-language sniffer falls back to Vietnamese only when navigator.language starts with vi-.',
        vi: 'Mặc định UI là tiếng Anh; auto-detect ngôn ngữ trình duyệt, chỉ fallback tiếng Việt khi navigator.language bắt đầu với vi-.' },
      { en: 'Public /api-docs page — Gitbook-style 2-column layout, no login required, full reference for auth + account + orders + proxies + webhook endpoints.',
        vi: 'Trang public /api-docs — layout 2-cột kiểu Gitbook, không cần login, đầy đủ tài liệu auth + account + orders + proxies + webhook.' },
      { en: 'FAQ rebuilt as Gitbook layout — top nav + sidebar drawer (mobile) + backdrop overlay + proper footer. Docs are bilingual: backend serves localized title/category/body via ?lang query.',
        vi: 'FAQ build lại theo layout Gitbook — top nav + sidebar drawer (mobile) + backdrop overlay + footer chỉn chu. Docs song ngữ: backend trả title/category/body theo ?lang.' },
      { en: 'Mobile UX overhaul — hero copy button moved out of absolute-position overlap into the terminal card header bar; install command scrolls horizontally instead of breaking mid-word; phone breakpoints across all public pages.',
        vi: 'Tối ưu giao diện mobile — nút copy lệnh cài đặt chuyển vào thanh header terminal, không còn đè lên text; lệnh cài scroll ngang thay vì cắt giữa từ; breakpoints riêng cho điện thoại trên mọi page public.' },
      { en: 'SEO: robots.txt, sitemap.xml, og-cover.svg (1200×630), JSON-LD Organization + WebSite + SoftwareApplication + FAQPage schemas (all in English).',
        vi: 'SEO: robots.txt, sitemap.xml, og-cover.svg (1200×630), JSON-LD Organization + WebSite + SoftwareApplication + FAQPage (toàn bộ tiếng Anh).' },
      { en: 'Locale toggle is silent — no ?lang= query string in user-facing URLs; preference stored in localStorage only.',
        vi: 'Chuyển ngôn ngữ ngầm — không còn ?lang= trên URL, preference chỉ lưu localStorage.' }
    ]
  },
  {
    version: '1.1.0', date: '2026-05-19', tag: 'release',
    titleEn: 'Rebrand ProxyHub → ProxyBox, domain → proxybox.pro',
    titleVi: 'Đổi thương hiệu ProxyHub → ProxyBox, domain → proxybox.pro',
    items: [
      { en: 'Brand rename to ProxyBox (Vietnamese colloquial "Box Proxy") across UI, docs, install scripts, README.',
        vi: 'Đổi thương hiệu thành ProxyBox (tên gọi tiếng Việt "Box Proxy") trên UI, docs, install scripts, README.' },
      { en: 'Primary domain proxybox.pro live with Let\'s Encrypt SSL via Cloudflare wildcard; my.vcore.vn still serves as legacy alias.',
        vi: 'Domain chính proxybox.pro đã live với Let\'s Encrypt SSL qua Cloudflare wildcard; my.vcore.vn vẫn hoạt động làm alias.' },
      { en: 'systemd unit renamed proxyhub.service → proxybox.service (+ proxybox-ips.service for IPv6 aliases); source dirs /home/proxyhub/proxybox + /home/proxyhub/proxybox-free.',
        vi: 'Đổi tên systemd unit proxyhub.service → proxybox.service (+ proxybox-ips.service cho IPv6 aliases); thư mục source /home/proxyhub/proxybox + /home/proxyhub/proxybox-free.' },
      { en: 'Agent binary renamed proxyhub-agent → proxybox-agent (Cargo crate proxybox-core). Config path now /etc/proxybox-agent.json with legacy fallback. SSH admin commands use dual-name fallback so existing customer agents keep working.',
        vi: 'Đổi tên agent binary proxyhub-agent → proxybox-agent (Cargo crate proxybox-core). Đường dẫn config mới /etc/proxybox-agent.json, fallback đường dẫn cũ. Lệnh SSH admin try cả 2 tên service nên agent đang chạy của customer không bị ảnh hưởng.' },
      { en: 'New landing page at / for anonymous visitors; authed users still redirect to dashboard.',
        vi: 'Trang landing mới tại / cho khách chưa login; user đã login vẫn redirect về dashboard.' },
      { en: 'Version chip in sidebar shows current build (__APP_VERSION__ from package.json).',
        vi: 'Chip version trong sidebar hiện build hiện tại (__APP_VERSION__ từ package.json).' }
    ]
  },
  {
    version: '1.0.0', date: '2026-05-14', tag: 'release',
    titleEn: 'OSS panel public release — install-on-your-own-VPS',
    titleVi: 'OSS panel public — cài trên VPS của bạn',
    items: [
      { en: 'install.sh one-command installer (Ubuntu / Debian) — Node 22 + Nginx + Certbot + Rust agent build + systemd unit + SSL.',
        vi: 'install.sh installer 1 lệnh (Ubuntu / Debian) — Node 22 + Nginx + Certbot + build Rust agent + systemd unit + SSL.' },
      { en: 'Self-upgrade endpoint POST /api/admin/system/upgrade (git pull + npm install + build + restart).',
        vi: 'Endpoint tự nâng cấp POST /api/admin/system/upgrade (git pull + npm install + build + restart).' },
      { en: 'Download tracker (SQLite oss_downloads table) + admin /admin/system/downloads dashboard with 30-day chart + breakdown.',
        vi: 'Tracker lượt download (SQLite oss_downloads) + dashboard admin /admin/system/downloads với biểu đồ 30 ngày + phân loại.' },
      { en: 'BYON (Bring Your Own Node): customer pastes a single curl command on their VPS → agent enrols, free proxies live.',
        vi: 'BYON (Bring Your Own Node): customer paste 1 lệnh curl trên VPS → agent enroll, proxy miễn phí chạy.' },
      { en: 'Hub Proxy via Virtualizor: admin wires up Virtualizor credentials, customers rent hub VPS by the hour with auto SSH bootstrap.',
        vi: 'Hub Proxy qua Virtualizor: admin cấu hình Virtualizor, customer thuê VPS theo giờ, agent tự cài qua SSH bootstrap.' }
    ]
  }
]

const tagMeta = {
  release:  { icon: Rocket,        cls: 't-release',  label: { en: 'Release',     vi: 'Bản phát hành' } },
  feature:  { icon: Sparkles,      cls: 't-feature',  label: { en: 'Feature',     vi: 'Tính năng'      } },
  fix:      { icon: Wrench,        cls: 't-fix',      label: { en: 'Fix',         vi: 'Sửa lỗi'        } },
  security: { icon: ShieldCheck,   cls: 't-security', label: { en: 'Security',    vi: 'Bảo mật'        } },
  breaking: { icon: AlertTriangle, cls: 't-breaking', label: { en: 'Breaking',    vi: 'Phá vỡ tương thích' } }
}

function tagOf(t) { return tagMeta[t] || tagMeta.feature }
function dateFmt(s) {
  if (!s) return ''
  try { return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(s)) }
  catch { return s }
}

const items = computed(() => releases.map((r) => ({
  ...r,
  title: locale.value === 'vi' ? (r.titleVi || r.titleEn) : (r.titleEn || r.titleVi),
  bullets: (r.items || []).map((it) => locale.value === 'vi' ? (it.vi || it.en) : (it.en || it.vi))
})))
</script>

<template>
  <div class="changelog">
    <PublicTopNav sub-label="Changelog" />

    <main class="changelog-shell">
      <div class="changelog-hero">
        <span class="hero-eyebrow">{{ locale === 'vi' ? 'Nhật ký phát hành' : 'Release log' }}</span>
        <h1>{{ locale === 'vi' ? 'Changelog' : 'Changelog' }}</h1>
        <p>{{ locale === 'vi'
            ? 'Lịch sử các phiên bản ProxyBox + những gì thay đổi. Bản hiện tại của panel này: ' + appVersion + '. Self-host operators có thể tự nâng cấp ở /admin/settings → Upgrade.'
            : 'Every ProxyBox release and what changed. This panel currently runs v' + appVersion + '. Self-host operators upgrade from /admin/settings → Upgrade.' }}</p>
      </div>

      <ol class="timeline">
        <li v-for="r in items" :key="r.version" class="entry">
          <div class="entry-meta">
            <div :class="['tag', tagOf(r.tag).cls]">
              <component :is="tagOf(r.tag).icon" :size="13" />
              <span>{{ tagOf(r.tag).label[locale] || tagOf(r.tag).label.en }}</span>
            </div>
            <span class="ver">v{{ r.version }}</span>
            <span class="date">{{ dateFmt(r.date) }}</span>
          </div>
          <h2>{{ r.title }}</h2>
          <ul class="bullets">
            <li v-for="(b, i) in r.bullets" :key="i">{{ b }}</li>
          </ul>
        </li>
      </ol>

      <div class="changelog-foot-cta">
        <RouterLink to="/faq#self-host-panel" class="btn primary">
          {{ locale === 'vi' ? 'Hướng dẫn tự host' : 'Self-host guide' }} <ArrowRight :size="14" />
        </RouterLink>
        <RouterLink to="/api-docs" class="btn ghost">
          {{ locale === 'vi' ? 'Xem API docs' : 'Read API docs' }}
        </RouterLink>
      </div>
    </main>

    <footer class="changelog-foot">
      <span>{{ t('landing.foot.copyright', { year: new Date().getFullYear(), ver: appVersion }) }}</span>
      <span class="foot-onie">
        {{ t('landing.foot.publishedBy') }}
        <a href="https://proxybox.pro" target="_blank" rel="noopener">{{ t('landing.foot.onieName') }}</a>
        · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
      </span>
      <span>
        <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink>
        ·
        <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink>
        ·
        <RouterLink to="/status">{{ t('landing.nav.status') }}</RouterLink>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.changelog {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  overflow-x: hidden;
}
.changelog * { box-sizing: border-box; }
.changelog a { color: inherit; text-decoration: none; }

/* Top nav (mirror landing) */
.landing-nav {
  display: flex; align-items: center; gap: 24px;
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
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--surface); border-color: var(--blue); }
.btn.primary { background: linear-gradient(135deg, #58a6ff, #2f81f7); border-color: transparent; color: #0a0e14; }
.btn.ghost { background: transparent; }

/* Shell */
.changelog-shell {
  max-width: 880px; margin: 0 auto;
  padding: 56px 32px 80px;
}
.changelog-hero { margin-bottom: 40px; }
.hero-eyebrow {
  display: inline-block; padding: 4px 10px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  border: 1px solid var(--border); border-radius: 999px;
  color: var(--green); background: var(--green-soft);
  margin-bottom: 16px;
}
.changelog-hero h1 {
  margin: 0 0 12px;
  font-size: 36px; font-weight: 700; letter-spacing: -0.5px;
}
.changelog-hero p {
  margin: 0; color: var(--dim);
  font-size: 15px; line-height: 1.6;
}

/* Timeline of releases */
.timeline {
  list-style: none; padding: 0; margin: 0;
  position: relative;
}
.timeline::before {
  content: ''; position: absolute;
  top: 14px; bottom: 14px; left: 8px;
  width: 1px; background: var(--border);
}
.entry {
  position: relative;
  padding: 0 0 32px 32px;
}
.entry::before {
  content: ''; position: absolute;
  top: 10px; left: 3px;
  width: 11px; height: 11px; border-radius: 999px;
  background: var(--surface);
  border: 2px solid var(--blue);
  box-shadow: 0 0 0 3px var(--bg);
}
.entry-meta {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 8px;
  font-size: 12px;
}
.tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.3px;
}
.t-release  { background: var(--green-soft);  color: var(--green); }
.t-feature  { background: var(--blue-soft);   color: var(--blue); }
.t-fix      { background: var(--yellow-soft); color: var(--yellow); }
.t-security { background: var(--red-soft);    color: var(--red); }
.t-breaking { background: var(--red-soft);    color: var(--red); }
.ver {
  font-family: var(--mono); font-size: 12px;
  background: var(--surface-2); border: 1px solid var(--border-soft);
  padding: 2px 8px; border-radius: 4px; color: var(--text);
}
.date { color: var(--dim); font-size: 12px; }
.entry h2 {
  margin: 0 0 12px;
  font-size: 19px; font-weight: 700;
  letter-spacing: -0.2px;
}
.bullets {
  padding-left: 18px; margin: 0;
  color: var(--text); font-size: 14px; line-height: 1.7;
}
.bullets li {
  padding-left: 6px; margin-bottom: 6px;
  color: var(--text);
}
.bullets li::marker { color: var(--dim); }

.changelog-foot-cta {
  display: flex; gap: 10px; flex-wrap: wrap;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-soft);
}

.changelog-foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24px 32px;
  max-width: 1240px; margin: 0 auto;
  border-top: 1px solid var(--border-soft);
  color: var(--dim); font-size: 12px; gap: 12px; flex-wrap: wrap;
}
.foot-onie a { color: var(--text); text-decoration: none; font-weight: 600; }
.foot-onie a:hover { color: var(--blue); }

/* Tablet */
@media (max-width: 980px) {
  .landing-nav { padding: 12px 16px; gap: 12px; }
  .landing-nav-links { display: none; }
  .desktop-only { display: none; }
  .changelog-shell { padding: 40px 20px 60px; }
  .changelog-hero h1 { font-size: 30px; }
}
/* Phone */
@media (max-width: 640px) {
  .landing-nav { padding: 10px 14px; gap: 8px; }
  .landing-brand strong { font-size: 15px; }
  .landing-brand .brand-sub { display: none; }
  .theme-btn { display: none; }
  .lang-toggle button { padding: 5px 8px; font-size: 11px; }
  .btn { padding: 7px 12px; font-size: 12px; }
  .changelog-shell { padding: 28px 16px 50px; }
  .changelog-hero h1 { font-size: 24px; }
  .changelog-hero p { font-size: 14px; }
  .entry { padding-left: 26px; }
  .entry h2 { font-size: 17px; }
  .bullets { font-size: 13.5px; }
  .changelog-foot { flex-direction: column; align-items: flex-start; padding: 20px 16px; }
}
</style>
