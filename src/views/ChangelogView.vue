<script setup>
import { computed } from 'vue'
import {
  BulbOutlined, RocketOutlined, SafetyCertificateOutlined, ToolOutlined, WarningOutlined
} from '@ant-design/icons-vue'
import { useI18n } from '../i18n'
import PublicTopNav from '../components/PublicTopNav.vue'

const { t, locale } = useI18n()
const appVersion = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const year = new Date().getFullYear()

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
    version: '1.6.41', date: '2026-08-22', tag: 'fix',
    titleEn: 'Redesigned the wallet top-up panel — method tiles + a single pay button',
    titleVi: 'Thiết kế lại ô nạp tiền — thẻ chọn phương thức + một nút thanh toán',
    items: [
      { en: 'The passive method list and the row of coloured buttons are replaced by selectable method tiles and one primary pay button that adapts to the chosen method.',
        vi: 'Danh sách phương thức thụ động và hàng nút nhiều màu được thay bằng thẻ chọn phương thức và một nút thanh toán duy nhất tự đổi theo phương thức đã chọn.' },
    ],
  },
  {
    version: '1.6.40', date: '2026-08-22', tag: 'feature',
    titleEn: 'In-place card checkout (Stripe Payment Element); card management; provider name hidden',
    titleVi: 'Thanh toán thẻ ngay tại trang (Stripe Payment Element); quản lý thẻ; ẩn tên nhà cung cấp',
    items: [
      { en: 'Card top-ups and add-card run inline via the Stripe Payment Element (cards + Apple/Google Pay) — no redirect to a hosted page; 3DS handled in-modal. Requires script-src/frame-src for js.stripe.com in your CSP.',
        vi: 'Nạp thẻ và thêm thẻ chạy ngay tại trang qua Stripe Payment Element (thẻ + Apple/Google Pay) — không chuyển trang; 3DS xử lý trong hộp thoại. Cần thêm js.stripe.com vào script-src/frame-src trong CSP.' },
    ],
  },
  {
    version: '1.6.39', date: '2026-08-22', tag: 'feature',
    titleEn: 'Saved card + auto-recharge: top up automatically when the wallet runs low',
    titleVi: 'Lưu thẻ + tự động nạp: tự nạp tiền khi ví sắp hết',
    items: [
      { en: 'Customers can save a card (Stripe SetupIntent) and opt into auto-recharge. A background sweep tops up off-session when the wallet falls below the admin threshold; a short purchase/renewal also triggers a top-up-to-cover. Off-session charges carry the customer-borne fee; failures notify the customer. Admin sets threshold/amount/daily-cap.',
        vi: 'Khách lưu thẻ (Stripe SetupIntent) và bật tự động nạp. Sweep nền trừ thẻ off-session khi ví dưới ngưỡng admin; đơn mua/gia hạn thiếu tiền cũng nạp bù. Trừ off-session kèm phí khách chịu; lỗi sẽ báo khách. Admin đặt ngưỡng/số tiền/giới hạn ngày.' },
    ],
  },
  {
    version: '1.6.38', date: '2026-08-22', tag: 'feature',
    titleEn: 'Stripe card payments: minimum 5 USD, customer-borne fee, webhook-independent crediting',
    titleVi: 'Thanh toán thẻ Stripe: tối thiểu 5 USD, phí khách chịu, cộng ví không cần webhook',
    items: [
      { en: 'Stripe checkout enforces a minimum top-up (default 5 USD) and grosses-up the charge so the gateway fee (default 3.9% + $0.30) is paid by the customer; the wallet is credited the exact net amount. Knobs at /admin/payment.',
        vi: 'Thanh toán Stripe có mức nạp tối thiểu (mặc định 5 USD) và cộng phí cổng (mặc định 3.9% + $0.30) vào số tiền — khách chịu phí, ví cộng đúng số net. Chỉnh ở /admin/payment.' },
      { en: 'Wallet is credited via confirm-on-return (retrieve the Checkout Session) so top-ups work even before a dashboard webhook secret is configured, with shared dedup so a session is never credited twice.',
        vi: 'Ví được cộng qua xác nhận-khi-quay-lại (truy vấn Checkout Session) nên hoạt động ngay cả khi chưa cấu hình webhook secret, chống trùng để không cộng 2 lần.' },
    ],
  },
  {
    version: '1.6.37', date: '2026-08-22', tag: 'security',
    titleEn: 'Affiliate kickback is deposit-gated; fixed a bug that paid it even when set to 0',
    titleVi: 'Hoa hồng giới thiệu chỉ trả khi có nạp tiền thật; sửa lỗi vẫn trả dù đặt 0',
    items: [
      { en: 'A signup farm mass-registered accounts with a referral code to mint the affiliate bonus. Kickback is now paid ONCE per referred user and ONLY after they make a real deposit — never at signup.',
        vi: 'Một farm đăng ký hàng loạt tài khoản kèm mã giới thiệu để lấy hoa hồng. Hoa hồng giờ chỉ trả MỘT lần cho mỗi người được giới thiệu và CHỈ sau khi họ nạp tiền thật — không trả lúc đăng ký.' },
      { en: 'Fixed: affiliateKickback used `|| 20000`, so setting it to 0 still paid 20,000đ. It now respects 0. Also rejects forged Gmail addresses (underscore/special chars in the local part).',
        vi: 'Sửa: affiliateKickback dùng `|| 20000` nên đặt 0 vẫn trả 20.000đ. Giờ tôn trọng giá trị 0. Đồng thời từ chối địa chỉ Gmail giả (có underscore/ký tự lạ trong tên).' },
    ],
  },
  {
    version: '1.6.36', date: '2026-08-22', tag: 'security',
    titleEn: 'Registration anti-fraud: per-IP/subnet rate limits, gmail-alias dedup, disposable-email blocklist',
    titleVi: 'Chống gian lận đăng ký: giới hạn theo IP/subnet, chặn alias Gmail, chặn email dùng một lần',
    items: [
      { en: 'Signups are now rate-limited per IP (2/10min, 3/day) AND per subnet (/24 IPv4, /48 IPv6 — 10/day), with counters stored in SQLite so restarts never reset them. Limits are config-overridable (config.security), loopback is exempt for local QA.',
        vi: 'Đăng ký giờ bị giới hạn theo IP (2/10 phút, 3/ngày) VÀ theo subnet (/24 IPv4, /48 IPv6 — 10/ngày), bộ đếm lưu SQLite nên restart không reset. Có thể chỉnh qua config.security, loopback được miễn cho QA nội bộ.' },
      { en: 'Emails are normalized before uniqueness checks (gmail dots + "+tag" aliases collapse to one mailbox) and ~45 disposable-email domains are rejected (extendable via config.security.blockedEmailDomains). The promo claim endpoint gets the same per-IP/subnet gate.',
        vi: 'Email được chuẩn hóa trước khi kiểm tra trùng (dấu chấm Gmail + alias "+tag" quy về một hộp thư) và ~45 domain email dùng một lần bị từ chối (mở rộng qua config.security.blockedEmailDomains). Endpoint nhận ưu đãi cũng bị giới hạn IP/subnet tương tự.' },
    ],
  },
  {
    version: '1.6.35', date: '2026-08-19', tag: 'feature',
    titleEn: 'USDT: "I have sent the payment" button + reload-proof awaiting banner',
    titleVi: 'USDT: nút "Tôi đã chuyển tiền" + banner chờ xác nhận sống sót qua reload',
    items: [
      { en: 'The USDT modal gets an "I have sent the payment" button: the top-up switches to an awaiting-confirmation state that is kept for 24 hours (instead of 2) so congested chains or slow Binance crediting cannot orphan a real payment.',
        vi: 'Modal USDT có nút "Tôi đã chuyển tiền": lượt nạp chuyển sang trạng thái chờ xác nhận và được giữ 24 giờ (thay vì 2) — mạng nghẽn hay Binance cộng chậm cũng không mất lượt nạp.' },
      { en: 'The awaiting state survives page reloads: a banner on the Billing page shows the open top-up with a reopen button, keeps polling in the background, and flips to success by itself once the deposit is confirmed.',
        vi: 'Trạng thái chờ sống sót qua reload: banner ở trang Nạp tiền hiển thị lượt nạp đang mở kèm nút xem chi tiết, tự poll nền và tự báo thành công khi giao dịch được xác nhận.' },
    ],
  },
  {
    version: '1.6.34', date: '2026-08-19', tag: 'feature',
    titleEn: 'USDT modal: QR scanning for the Binance app + on-chain wallets; top-up defaults to the minimum',
    titleVi: 'Modal USDT: quét QR bằng app Binance + ví on-chain; ô nạp mặc định bằng mức tối thiểu',
    items: [
      { en: 'The USDT deposit modal now renders a QR code locally (vendored MIT encoder, no third-party QR service). Two modes: plain-address QR for the Binance app scanner, and an EIP-681 QR that prefills the USDT contract, BSC chain and exact amount in on-chain wallets (Trust, MetaMask, SafePal…).',
        vi: 'Modal nạp USDT giờ render QR ngay tại máy (thư viện MIT vendored, không gọi dịch vụ QR bên thứ ba). Hai chế độ: QR địa chỉ thuần cho trình quét của app Binance, và QR EIP-681 điền sẵn contract USDT, mạng BSC và đúng số tiền cho ví on-chain (Trust, MetaMask, SafePal…).' },
      { en: 'The top-up amount field now defaults to the highest minimum among enabled gateways, so the pre-filled amount is always accepted.',
        vi: 'Ô số tiền nạp giờ mặc định bằng mức tối thiểu cao nhất của các cổng đang bật, nên số tiền điền sẵn luôn hợp lệ.' },
    ],
  },
  {
    version: '1.6.33', date: '2026-08-19', tag: 'feature',
    titleEn: 'USDT top-ups via Binance (BEP20), minimum 5 USDT',
    titleVi: 'Nạp tiền bằng USDT qua Binance (BEP20), tối thiểu 5 USDT',
    items: [
      { en: 'New crypto top-up channel: customers send USDT (BEP20) to the operator Binance deposit address. Each top-up gets a unique 4-decimal amount; the panel polls the Binance deposit-history API (HMAC-signed, read-only key) and credits the wallet automatically with txId-level dedup.',
        vi: 'Kênh nạp crypto mới: khách gửi USDT (BEP20) vào địa chỉ nạp Binance của nhà vận hành. Mỗi lượt nạp được cấp một số tiền duy nhất 4 số lẻ; hệ thống poll Binance deposit-history API (ký HMAC, key chỉ đọc) và tự cộng ví, chống trùng theo txId.' },
      { en: 'Minimum 5 USDT per top-up (admin-configurable, like the exchange rate and network). New USDT section at /admin/payment; the billing page gets a USDT button + modal with address, exact amount, countdown and auto-detection.',
        vi: 'Tối thiểu 5 USDT mỗi lượt nạp (admin chỉnh được, cùng với tỉ giá và mạng). Mục USDT mới ở /admin/payment; trang nạp tiền có nút USDT + modal hiển thị địa chỉ, số tiền chính xác, đếm ngược và tự nhận diện.' },
    ],
  },
  {
    version: '1.6.32', date: '2026-08-19', tag: 'feature',
    titleEn: 'PayPal: minimum top-up + gateway fee borne by the payer',
    titleVi: 'PayPal: nạp tối thiểu + phí cổng do người nạp chịu',
    items: [
      { en: 'PayPal top-ups now enforce an admin-configurable minimum (default 5 USD) and gross-up the charge so the PayPal fee (default 4.4% + $0.30) is paid by the payer — the wallet is still credited the exact top-up amount.',
        vi: 'Nạp qua PayPal giờ có mức tối thiểu do admin cấu hình (mặc định 5 USD) và cộng phí cổng (mặc định 4.4% + $0.30) vào số tiền thanh toán — người nạp chịu phí, ví vẫn được cộng đúng số nạp.' },
      { en: 'The customer billing page shows the minimum, the fee policy, and a live charge estimate including the fee; admins tune all three knobs at /admin/payment.',
        vi: 'Trang nạp tiền hiển thị mức tối thiểu, chính sách phí và ước tính số tiền charge gồm phí; admin chỉnh cả ba thông số ở /admin/payment.' },
    ],
  },
  {
    version: '1.6.27', date: '2026-06-29', tag: 'feature',
    titleEn: 'Admin can log in as a user; users list paginated + newest-first',
    titleVi: 'Admin đăng nhập vào tài khoản khách; danh sách user phân trang + mới nhất lên đầu',
    items: [
      { en: 'New "Login" action on /admin/users mints a session for the customer and switches the admin into their portal. A persistent banner shows who you are impersonating and returns you to admin in one click. Every impersonation is audited.',
        vi: 'Nút "Login" mới ở /admin/users tạo phiên cho khách và đưa admin vào giao diện của họ. Một thanh cảnh báo luôn hiện cho biết đang đăng nhập hộ ai và cho quay lại admin bằng một cú nhấp. Mọi lần đăng nhập hộ đều được ghi audit.' },
      { en: 'The users list is now paginated at 25 per page and sorted newest-registered first, with a registration date shown under each email.',
        vi: 'Danh sách user giờ phân trang 25 user/trang và sắp xếp mới đăng ký lên đầu, kèm ngày đăng ký dưới mỗi email.' },
    ],
  },
  {
    version: '1.6.14', date: '2026-06-25', tag: 'fix',
    titleEn: 'Leaner telemetry storage',
    titleVi: 'Lưu telemetry gọn hơn',
    items: [
      { en: 'SLA uptime stored as an hourly rollup instead of one row per health check (~12× fewer rows + now pruned). Connection event log retention cut 30d → 14d. Keeps the SQLite file from growing unbounded on busy nodes.',
        vi: 'Uptime SLA lưu dạng tổng hợp theo giờ thay vì 1 dòng mỗi lần check (~12× ít dòng + có dọn). Log kết nối giảm 30 ngày → 14 ngày. Tránh file SQLite phình vô hạn trên node nhiều traffic.' },
    ],
  },
  {
    version: '1.6.13', date: '2026-06-25', tag: 'fix',
    titleEn: 'In-order proxy list paginated; tool tabs use a proxy dropdown',
    titleVi: 'Danh sách proxy trong đơn có phân trang; tab công cụ dùng dropdown chọn proxy',
    items: [
      { en: 'The proxy list inside an order is now paginated at 10 rows/page; the Copy/Export credential list paginates the same way.',
        vi: 'Danh sách proxy bên trong một đơn giờ phân trang 10 dòng/trang; danh sách credential ở tab Copy/Xuất cũng phân trang tương tự.' },
      { en: 'Tool tabs (Test / Speed test / Blacklist / IP info / Ping) pick a proxy from a dropdown instead of a chip per proxy.',
        vi: 'Các tab công cụ (Test / Kiểm tra tốc độ / Blacklist / Thông tin IP / Ping) chọn proxy bằng dropdown thay vì một chip cho mỗi proxy.' },
    ],
  },
  {
    version: '1.6.12', date: '2026-06-25', tag: 'fix',
    titleEn: 'Proxies & Usage pages paginated — instant load for large accounts',
    titleVi: 'Trang Proxy & Usage có phân trang — tải tức thì cho tài khoản lớn',
    items: [
      { en: 'The Proxies page now loads lightweight per-order group summaries instantly, then fetches each group\'s proxies on expand (server-side /proxies/groups + ?orderId=), instead of downloading every proxy upfront.',
        vi: 'Trang Proxy giờ tải tóm tắt nhóm theo đơn (nhẹ) tức thì, rồi lấy proxy của từng nhóm khi mở rộng (server-side /proxies/groups + ?orderId=), thay vì tải toàn bộ proxy ngay từ đầu.' },
      { en: 'Usage page: per-proxy table paginated at 10 rows/page.',
        vi: 'Trang Usage: bảng từng-proxy phân trang 10 dòng/trang.' },
      { en: 'Per-group quick-stats sample up to 30 proxies instead of one request per proxy.',
        vi: 'Quick-stats của nhóm lấy mẫu tối đa 30 proxy thay vì 1 request mỗi proxy.' },
    ],
  },
  {
    version: '1.6.11', date: '2026-06-25', tag: 'fix',
    titleEn: 'Usage/bandwidth page + connections load fast for large accounts',
    titleVi: 'Trang Usage/băng thông + Kết nối tải nhanh cho tài khoản nhiều proxy',
    items: [
      { en: 'Customer Usage/Bandwidth summary now reads the per-hour rollup scoped by owner instead of summing the raw event log per-proxy over 30 days (was ~12s for a 1000-proxy account).',
        vi: 'Trang Usage/Băng thông của khách giờ đọc bảng tổng hợp theo giờ (lọc theo chủ) thay vì cộng log thô theo từng proxy suốt 30 ngày (trước ~12s với tài khoản 1000 proxy).' },
      { en: 'Connections page no longer downloads the full proxy list just to fill a filter dropdown — paints immediately on refresh.',
        vi: 'Trang Kết nối không còn tải toàn bộ danh sách proxy chỉ để đổ vào dropdown lọc — hiện ngay khi F5.' },
      { en: 'Admin node-detail / compare / owner-drilldown bandwidth now read the rollup too.',
        vi: 'Băng thông ở trang admin node-detail / so sánh / drilldown theo chủ cũng đọc rollup.' },
    ],
  },
  {
    version: '1.6.10', date: '2026-06-24', tag: 'fix',
    titleEn: 'Connections & bandwidth pages load instantly (no more 1–35s wait)',
    titleVi: 'Trang Kết nối & Băng thông hiển thị tức thì (hết chờ 1–35s)',
    items: [
      { en: 'Window totals (1h/24h/30d) on the Connections/Usage pages now read from the per-hour rollup instead of summing the multi-million-row event log live.',
        vi: 'Tổng lưu lượng (1h/24h/30d) ở trang Kết nối/Băng thông giờ đọc từ bảng tổng hợp theo giờ thay vì cộng trực tiếp log nhiều triệu dòng.' },
      { en: 'Admin bandwidth ranking reads from the rollup too (30-day view no longer takes tens of seconds).',
        vi: 'Bảng xếp hạng băng thông admin cũng đọc từ rollup (chế độ 30 ngày không còn mất hàng chục giây).' },
      { en: 'Switched SQLite to WAL mode so dashboard reads no longer block (or get blocked by) the constant connection-log writes.',
        vi: 'Chuyển SQLite sang chế độ WAL để truy vấn đọc dashboard không còn bị chặn bởi việc ghi log kết nối liên tục.' },
    ],
  },
  {
    version: '1.6.9', date: '2026-06-24', tag: 'fix',
    titleEn: 'i18n polish — customer & public UI fully bilingual',
    titleVi: 'Chuẩn hoá i18n — giao diện khách & public song ngữ đầy đủ',
    items: [
      { en: 'Translated ~30 customer/public labels that were stuck in English in Vietnamese mode (theme, proxy tools, volume discount, free credit, affiliate share, API docs, product categories).',
        vi: 'Dịch ~30 nhãn khách/public bị kẹt tiếng Anh khi ở chế độ tiếng Việt (theme, công cụ proxy, giảm giá số lượng, tín dụng miễn phí, chia sẻ affiliate, tài liệu API, danh mục sản phẩm).' },
      { en: 'Wired hardcoded labels through i18n in Connections, Dashboard, Affiliate, Nodes and Node-detail views (table headers, KPI cards, node stats, token actions, no-payment notice) so they switch language correctly.',
        vi: 'Đưa các nhãn hardcode qua i18n ở các trang Kết nối, Dashboard, Affiliate, Nodes và chi tiết Node (tiêu đề bảng, thẻ KPI, thống kê node, thao tác token, thông báo chưa có thanh toán) để đổi ngôn ngữ đúng.' },
      { en: 'Fixed admin page headers showing raw keys (e.g. page.nodes-compare).',
        vi: 'Sửa tiêu đề trang admin hiển thị key thô (vd page.nodes-compare).' },
    ],
  },
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

// `color` → a-tag preset, `dot` → timeline dot colour (theme CSS vars).
const tagMeta = {
  release:  { icon: RocketOutlined,            color: 'success',    dot: 'var(--pb-success)', label: { en: 'Release',  vi: 'Bản phát hành' } },
  feature:  { icon: BulbOutlined,              color: 'processing', dot: 'var(--pb-info)',    label: { en: 'Feature',  vi: 'Tính năng' } },
  fix:      { icon: ToolOutlined,              color: 'warning',    dot: 'var(--pb-warning)', label: { en: 'Fix',      vi: 'Sửa lỗi' } },
  security: { icon: SafetyCertificateOutlined, color: 'error',      dot: 'var(--pb-error)',   label: { en: 'Security', vi: 'Bảo mật' } },
  breaking: { icon: WarningOutlined,           color: 'error',      dot: 'var(--pb-error)',   label: { en: 'Breaking', vi: 'Phá vỡ tương thích' } }
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
  <a-layout class="pub-page">
    <PublicTopNav sub-label="Changelog" />

    <a-layout-content class="pub-shell">
      <header class="pub-head">
        <a-tag color="success" :bordered="false" class="kicker-tag">{{ locale === 'vi' ? 'Nhật ký phát hành' : 'Release log' }}</a-tag>
        <a-typography-title :level="1" class="page-title">Changelog</a-typography-title>
        <a-typography-paragraph type="secondary" class="page-sub">
          {{ locale === 'vi'
            ? 'Lịch sử các phiên bản ProxyBox + những gì thay đổi. Bản hiện tại của panel này: ' + appVersion + '. Self-host operators có thể tự nâng cấp ở /admin/settings → Upgrade.'
            : 'Every ProxyBox release and what changed. This panel currently runs v' + appVersion + '. Self-host operators upgrade from /admin/settings → Upgrade.' }}
        </a-typography-paragraph>
      </header>

      <a-timeline class="release-timeline">
        <a-timeline-item v-for="r in items" :key="r.version" :color="tagOf(r.tag).dot">
          <template #dot><component :is="tagOf(r.tag).icon" class="release-dot" /></template>
          <a-card size="small" class="release-card">
            <a-flex align="center" gap="small" wrap="wrap" class="release-meta">
              <a-tag :color="tagOf(r.tag).color" :bordered="false">
                <template #icon><component :is="tagOf(r.tag).icon" /></template>
                {{ tagOf(r.tag).label[locale] || tagOf(r.tag).label.en }}
              </a-tag>
              <a-tag class="mono">v{{ r.version }}</a-tag>
              <a-typography-text type="secondary" class="release-date">{{ dateFmt(r.date) }}</a-typography-text>
            </a-flex>
            <a-typography-title :level="2" class="release-title">{{ r.title }}</a-typography-title>
            <a-typography>
              <ul class="release-bullets">
                <li v-for="(b, i) in r.bullets" :key="i">{{ b }}</li>
              </ul>
            </a-typography>
          </a-card>
        </a-timeline-item>
      </a-timeline>

      <a-divider class="cta-divider" />
      <a-flex gap="small" wrap="wrap">
        <RouterLink v-slot="{ href, navigate }" to="/faq#self-host-panel" custom>
          <a-button type="primary" size="large" :href="href" @click="navigate">
            {{ locale === 'vi' ? 'Hướng dẫn tự host' : 'Self-host guide' }} <ArrowRightOutlined />
          </a-button>
        </RouterLink>
        <RouterLink v-slot="{ href, navigate }" to="/api-docs" custom>
          <a-button size="large" :href="href" @click="navigate">
            <template #icon><ApiOutlined /></template>
            {{ locale === 'vi' ? 'Xem API docs' : 'Read API docs' }}
          </a-button>
        </RouterLink>
      </a-flex>
    </a-layout-content>

    <a-layout-footer class="pub-foot">
      <a-flex justify="space-between" align="center" wrap="wrap" gap="small" class="pub-foot-inner">
        <span>{{ t('landing.foot.copyright', { year, ver: appVersion }) }}</span>
        <span>
          {{ t('landing.foot.publishedBy') }}
          <a href="https://proxybox.pro" target="_blank" rel="noopener" class="foot-strong">{{ t('landing.foot.onieName') }}</a>
          · <a href="https://proxybox.pro" target="_blank" rel="noopener">proxybox.pro</a>
        </span>
        <span>
          <RouterLink to="/faq">{{ t('landing.nav.faq') }}</RouterLink> ·
          <RouterLink to="/api-docs">{{ t('landing.nav.api') }}</RouterLink>
        </span>
      </a-flex>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped>
.pub-page { min-height: 100vh; }
.pub-shell {
  width: 100%; max-width: 880px; margin: 0 auto;
  padding: 48px 24px 56px;
}

/* Hero */
.pub-head { margin-bottom: 32px; }
.kicker-tag { font-weight: 600; letter-spacing: 0.04em; }
.page-title { margin: 14px 0 10px !important; font-size: 36px !important; letter-spacing: -0.5px; }
.page-sub { margin: 0 !important; font-size: 15px; line-height: 1.6; }

/* Releases */
.release-timeline { padding-top: 8px; }
.release-dot { font-size: 16px; }
.release-meta { margin-bottom: 8px; }
.release-meta :deep(.ant-tag) { margin-inline-end: 0; }
.release-date { font-size: 12.5px; }
.release-title { margin: 0 0 10px !important; font-size: 18px !important; line-height: 1.4 !important; }
.release-bullets { margin-bottom: 0 !important; font-size: 14px; line-height: 1.7; }
.release-bullets li { margin-bottom: 4px; }

.cta-divider { margin: 8px 0 24px; }

/* Footer */
.pub-foot { padding: 20px 24px; border-top: 1px solid var(--pb-border-soft); }
.pub-foot-inner { max-width: 1232px; margin: 0 auto; font-size: 12.5px; color: var(--pb-text-3); }
.pub-foot a { color: var(--pb-text-2); }
.pub-foot a:hover { color: var(--pb-primary); }
.pub-foot .foot-strong { font-weight: 600; color: var(--pb-text); }

@media (max-width: 767px) {
  .pub-shell { padding: 28px 16px 40px; }
  .page-title { font-size: 26px !important; }
  .page-sub { font-size: 14px; }
  .release-title { font-size: 16px !important; }
  .release-bullets { font-size: 13.5px; }
  .pub-foot { padding: 18px 16px; }
  .pub-foot-inner { flex-direction: column; align-items: flex-start !important; }
}
</style>
