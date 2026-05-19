# 🚀 Giới thiệu ProxyBox — Hệ thống bán proxy IPv4 / IPv6 self-host miễn phí mã nguồn mở

Chào cả nhà 👋

Mình vừa hoàn thiện **ProxyBox** — 1 platform proxy SaaS đầy đủ tính năng, **mã nguồn mở miễn phí**, ai cũng có thể tự host trên VPS riêng để bán proxy IPv4/IPv6 cho khách hoặc dùng nội bộ team.

Suốt 2 tháng dev, ban đầu mình build cho team mình dùng — sau đó thấy hệ thống đủ ổn định để chia sẻ. Giờ là lúc public ra cộng đồng để ai cũng có cơ hội tự vận hành 1 panel proxy của riêng mình mà không phải code lại từ đầu.

---

## 🎯 ProxyBox giải quyết bài toán gì?

Bạn muốn bán proxy IPv4 / IPv6 cho khách nhưng:
- ❌ Không muốn dùng panel của bên thứ 3 (data của bạn nằm trên server người khác).
- ❌ Không muốn code lại từ con số 0 (auth, billing, dashboard, agent, rotation, anti-abuse... rất nhiều).
- ❌ Không có budget thuê dev team xây hệ thống nội bộ.

ProxyBox là **lời giải** — 1 panel hoàn chỉnh, install 1 lệnh, tự host trên VPS của bạn, customer của bạn enroll vào panel của BẠN (không bao giờ data gửi sang server khác).

---

## 🗺 Luồng hoạt động tổng thể

```
                         ┌──────────────────────────────────────┐
                         │       VPS của BẠN (Panel admin)      │
                         │     Ubuntu + Node 22 + nginx + SSL   │
                         │                                      │
                         │  ┌──────────────┐  ┌──────────────┐  │
   👤 Customer           │  │  Vue 3 SPA   │  │  REST API    │  │
       │                 │  │ (dashboard)  │  │ /api/v1/user │  │
       │   HTTPS         │  └──────┬───────┘  └──────┬───────┘  │
       └──────────────►  │         │ same Node.js   │           │
                         │         └─────process────┘           │
                         │                 │                    │
                         │     ┌───────────▼────────────┐       │
                         │     │   config.json (state)  │       │
                         │     │   SQLite (billing+log) │       │
                         │     │   master.key (AES-GCM) │       │
                         │     └───────────┬────────────┘       │
                         │                 │                    │
                         │      Long-poll + mTLS port 8788      │
                         └─────────────────┼────────────────────┘
                                           │
              ┌────────────────────────────┼───────────────────────────┐
              │                            │                           │
       ┌──────▼──────┐            ┌────────▼────────┐         ┌────────▼────────┐
       │  Node A     │            │   Node B        │         │  Node C (Hub)   │
       │ (admin pool)│            │   (BYON)        │         │ (VPS thuê giờ)  │
       │ Rust agent  │            │  Rust agent     │         │  Rust agent     │
       │             │            │ owned by user X │         │  auto-installed │
       │ IPv4 + /48v6│            │  IPv6 /64       │         │ via Virtualizor │
       └──────┬──────┘            └────────┬────────┘         └────────┬────────┘
              │                            │                           │
              │   listener :20000-29999    │     listener :20000+      │
              │   HTTP/SOCKS5/Trojan/TLS   │                           │
              ▼                            ▼                           ▼
       🌐 Internet                  🌐 Internet                  🌐 Internet
       (egress IPv4 hoặc            (egress IPv6 từ              (egress theo
        IPv6 từ /48 pool)            customer's pool)             plan family)
```

---

## 🔄 3 luồng kiếm tiền — minh họa

### A. Customer mua proxy từ pool (admin pool)

```
   👤 Customer            🏢 Panel (admin)         🖥 Node admin
       │                       │                       │
       │  1. Login + topup ví  │                       │
       ├──────────────────────►│                       │
       │                       │                       │
       │  2. POST /orders      │                       │
       │     type=ipv6, qty=5  │                       │
       ├──────────────────────►│                       │
       │                       │  3. pickZoneNode      │
       │                       ├──────────────────────►│
       │                       │  4. push proxy config │
       │                       │   (port + user + pass)│
       │                       │                       │
       │  5. Trả về creds      │                       │
       │◄──────────────────────┤                       │
       │                                               │
       │  6. Connect proxy:                            │
       │     curl -x http://user:pass@node-ip:port     │
       ├──────────────────────────────────────────────►│
       │                                       7. egress IPv6 từ /48
       │                                               │
       │                              🌐 ─────────────►│ target.com
```

### B. Hub VPS theo giờ (qua Virtualizor)

```
   👤 Customer         🏢 Panel             🖥 Virtualizor        🖥 New VPS
       │                  │                     │                    │
       │ 1. Buy hub plan  │                     │                    │
       ├─────────────────►│                     │                    │
       │                  │ 2. addvs API        │                    │
       │                  │   (uid, RAM, OS,    │                    │
       │                  │    IP pool)         │                    │
       │                  ├────────────────────►│                    │
       │                  │                     │ 3. Create VM       │
       │                  │                     ├───────────────────►│
       │                  │ 4. Wait unlock      │                    │
       │                  │   (poll vsDetail)   │                    │
       │                  │                     │                    │
       │                  │ 5. SSH bootstrap    │                    │
       │                  │   curl install.sh   │                    │
       │                  ├──────────────────────────────────────────►│
       │                  │                                          │
       │                  │ 6. Agent enrolls    ◄────────────────────│
       │                  │   (claim placeholder)                    │
       │                  │                                          │
       │ 7. "Hub online"  │                                          │
       │◄─────────────────┤                                          │
       │                                                             │
       │ 8. Tạo proxy trên hub (miễn phí, billing đã trừ)            │
       ├────────────────────────────────────────────────────────────►│
```

### C. BYON — Customer mang VPS riêng

```
   👤 Customer's VPS                    🏢 Panel của BẠN
        │                                     │
        │  1. SSH vào VPS rồi paste:          │
        │     curl https://your-panel/        │
        │       api/agent/install/usr_xxx     │
        │       | sudo bash -s v4             │
        │                                     │
        │  2. Tải binary từ panel của bạn     │
        │      (KHÔNG về server bên thứ 3)    │
        ├────────────────────────────────────►│
        │                                     │
        │  3. Agent enroll                    │
        │     ownerId = customer.id           │
        │     tag = 'byon'                    │
        ├────────────────────────────────────►│
        │                                     │
        │  4. Customer thấy node ở /my-nodes  │
        │◄────────────────────────────────────┤
        │                                     │
        │  5. /buy → tab "Từ node của tôi"    │
        │     tạo proxy MIỄN PHÍ              │
        │     (chỉ trừ slot, không trừ ví)    │
        │                                     │
        │  6. Proxy chạy trên VPS của customer│
```

---

## 🔐 Luồng bảo mật

```
   ┌──────────────┐    HTTPS (LE cert)    ┌──────────────┐
   │   Browser    │ ─────────────────────►│    nginx     │
   │   (admin /   │                       │  TLS 1.2/1.3 │
   │   customer)  │                       │  :443        │
   └──────────────┘                       └──────┬───────┘
                                                 │ proxy_pass
                                                 ▼ 127.0.0.1:8787
   ┌────────────────────────────────────────────────────────────┐
   │                  ProxyBox master process                   │
   │                                                            │
   │  Auth:                                                     │
   │   • scrypt password hash                                   │
   │   • Bearer token (60-min session)                          │
   │   • Customer key `usr_<id>_<hex>` (160-bit, timing-safe)   │
   │   • TOTP 2FA optional                                      │
   │   • Admin IP whitelist                                     │
   │                                                            │
   │  Secrets at rest:                                          │
   │   • master.key (32 bytes, chmod 600)                       │
   │   • config.json secrets → AES-256-GCM v1: prefix           │
   │     (SSH pw, Virtualizor key, OAuth client_secret)         │
   │                                                            │
   │  Audit:                                                    │
   │   • SQLite `audit` table (every admin action)              │
   │   • SQLite `conn_events` (30-day retention)                │
   │   • Webhook fan-out (customer-defined)                     │
   └────────────────────────────────────────────────────────────┘
                              │
                       mTLS  │  port 8788 (client cert auth)
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │              Rust agent (each node, separate VPS)          │
   │                                                            │
   │  • Long-poll /api/agent/proxies?rev=N (25s)                │
   │  • Heartbeat /api/agent/heartbeat (10s)                    │
   │  • Strict family egress (IPv6 proxy = AAAA only)           │
   │  • Per-proxy: bind IP, listen port, user/pass, rotation    │
   │  • Anti-abuse: max-conn, bytes/sec, monthly quota          │
   │  • Admin commands via heartbeat (BYON path, no SSH needed) │
   └────────────────────────────────────────────────────────────┘
```

---

## ✨ Tính năng nổi bật

### 🌐 Multi-protocol trên 1 cổng
- **HTTP CONNECT**, **HTTP GET-through**, **SOCKS5**, **HTTPS-proxy (TLS)**, **Trojan** — tất cả cùng 1 port pair.
- Customer chọn protocol thoải mái, không cần đổi cấu hình proxy.

### 🌍 IPv4 + IPv6 song hành
- **IPv4 datacenter**: 1 IP cố định cho mỗi proxy.
- **IPv6 /48 routed**: pool rotation, mỗi connection 1 IP egress (sticky hoặc rotate).
- **Strict family**: IPv6 proxy resolve AAAA only, không leak v4. IPv4 proxy resolve A only.

### 💼 3 cách kiếm tiền với ProxyBox
**A. Bán proxy pool** — bạn có VPS riêng, cài agent, customer mua proxy theo giờ.
**B. Hub VPS theo giờ** — tích hợp Virtualizor, customer thuê nguyên VPS riêng theo giờ, agent auto-cài qua SSH bootstrap.
**C. BYON (Bring Your Own Node)** — customer mang VPS riêng của họ, cài agent FREE từ panel của bạn, tự tạo proxy không trừ ví.

### 🔐 Bảo mật + Anti-abuse
- **mTLS** giữa agent ↔ master (tự ký CA, mỗi node 1 cert).
- **scrypt** hash password, **AES-256-GCM** mã hóa mọi secret at-rest (master.key 32 bytes).
- **2FA TOTP** + admin IP whitelist + audit log SQLite.
- **3-layer caps**: max conn/proxy, max conn/source IP, max new-conn/s/src.
- **Strict family egress** + **rate limit** + **monthly quota** + **bytes/sec cap**.

### 🛠 Admin có toàn quyền remote
Click 1 nút từ admin panel để:
- **Reboot** VPS customer (qua SSH hoặc Virtualizor power API).
- **Restart agent**, xem **diagnose** (uptime/RAM/disk/conn), tail logs.
- **Force upgrade** agent binary (Linux + Windows tự build từ panel).
- **Install package** (htop, iperf3, mtr...) qua whitelist apt-get.
- **Drain mode** + **rotate token** cho từng node.

### 💳 Wallet + Billing đầy đủ
- Ví VND/USD, auto-renew proxy, tier discount (>10 proxy −5%, >50 −10%, >100 −15%).
- Coupon code, refund partial/full, audit từng giao dịch.
- **Stripe** integration (webhook signature verify, idempotency).
- **SMTP** raw socket (STARTTLS) + **Telegram alert** + **Webhook** ra hệ thống ngoài.

### 🎨 UI/UX hiện đại
- Vue 3 + Vite SPA, dark theme mặc định.
- **Responsive mobile** đầy đủ (sidebar collapse, bottom-nav, FAB).
- Vietnamese + English (toggle in-app, persistent).
- Charts ApexCharts cho admin revenue + connections analytics.

### 🐧🪟 Agent cross-platform
- **Rust + Tokio** binary glibc Linux + Windows .exe (cross-compile từ panel của bạn).
- **Node.js fallback agent** (server/agent.js) cho mọi platform có Node 18+.
- Tự upgrade khi panel push version mới.

### 🔄 One-click self-upgrade
- Admin → Settings → System → click "Nâng cấp lên phiên bản mới".
- Server tự `git pull` + `npm install` + `npm run build` + restart.
- ~60 giây, customer traffic KHÔNG bị ảnh hưởng (TCP listener giữ nguyên).

---

## 📦 Install 1 lệnh

VPS Ubuntu 22.04 / Debian 12, quyền root:

```bash
curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash
```

Installer sẽ hỏi:
1. **Domain** — hostname panel sẽ chạy.
2. **SSL** — Let's Encrypt (auto) / Self-signed / HTTP-only.
3. **Admin** — mặc định `admin@admin.com` / `admin`.

Sau ~3-5 phút (build SPA + Rust agent Linux + Windows), panel của bạn live tại `https://your-domain` → đăng nhập → đổi password ngay.

**Yêu cầu**: 1 CPU / 1 GB RAM / 10 GB disk + domain. Production khuyến nghị 2 CPU / 2 GB RAM.

---

## 🏗 Tech stack (cho dev tò mò)

- **Backend**: Node.js 22 monolith (~10k LOC), ZERO npm framework (no express, no axios, no nodemailer). Chỉ dùng `node:*` builtins + `ssh2` + `node-forge`.
- **Frontend**: Vue 3 + Vite, lucide-vue-next icons, vue3-apexcharts. Không Tailwind / không Vuetify — pure CSS với token system riêng.
- **Agent**: Rust + Tokio (proxy engine, mTLS, IPv6 strict family). Cross-build Linux + Windows.
- **Storage**: `config.json` (single-file state, ~120KB) + SQLite (`billing_tx`, `audit`, `conn_events`). Atomic writes + WAL.
- **PKI**: self-signed CA via `node-forge`, mỗi agent 1 client cert.
- **Stripe / SMTP / OAuth**: raw HTTPS / raw socket / raw OAuth flow — không SDK.

---

## 🎁 Tại sao mình open source?

Trong khi build ProxyBox, mình search rất nhiều OSS proxy panels — phần lớn hoặc:
- ❌ Outdated (5+ năm không maintain).
- ❌ Không có wallet billing đầy đủ.
- ❌ Không multi-protocol (chỉ HTTP hoặc chỉ SOCKS5).
- ❌ Không IPv6 strict family egress.
- ❌ UI/UX cùi.

Mình muốn cộng đồng người Việt có 1 tool ngang tầm các panel thương mại nước ngoài, nhưng **free + tự host được**. Ai cần thì lấy về dùng, không cần xin license, không gửi data sang server khác.

---

## 🤝 Cộng đồng

📱 **Zalo group**: https://zalo.me/g/d5c4rwh4rxys0qyerfzs

Tham gia để:
- Trợ giúp cài đặt + debug realtime.
- Notify version mới + breaking change.
- Trao đổi best practices: pricing, VPS provider tốt, network IPv6 setup.
- Báo bug, đề xuất tính năng, beta test trước release.

📦 **GitHub**: https://github.com/proxyhub/free (đang public, welcome PR)

---

## 🚀 Demo + Docs

- **Panel demo**: https://proxybox.pro (login bằng tài khoản đăng ký)
- **Docs đầy đủ**: https://proxybox.pro/faq
- **Cài Panel riêng**: https://proxybox.pro/faq#self-host-panel
- **A→Z setup admin**: https://proxybox.pro/faq#self-host-first-login
- **Troubleshoot**: https://proxybox.pro/faq#self-host-troubleshoot

---

## ❓ FAQ ngắn

**Q: Tự host có khó không?**
A: 1 lệnh `curl install-panel.sh | bash` xong sau 5 phút. Cần Ubuntu 22.04+ và quyền root.

**Q: Customer của tôi enroll agent về đâu?**
A: Về domain của bạn. Mỗi panel có `controlBaseUrl` riêng, isolated 100% — agent KHÔNG bao giờ gửi data sang panel khác.

**Q: Có giới hạn số proxy / customer / hub không?**
A: KHÔNG. ProxyBox không có "license tier", không có "max proxies". Giới hạn duy nhất là RAM/CPU/network của VPS bạn cài lên.

**Q: Update phiên bản mới thế nào?**
A: Click 1 nút trong Settings → System. Tự git pull + rebuild + restart trong 60s. Customer traffic không ảnh hưởng.

**Q: Backup data thế nào?**
A: 1 file `config.json` + `master.key` + `data.db`. Tar lại upload Google Drive. Script `backup.sh` có sẵn (encrypted tarball với passphrase).

**Q: ProxyBox có safe để bán cho customer thật không?**
A: Mình đã chạy production 2 tháng với customer thật, traffic vài chục TB/tháng. Mọi bug đều fix kèm test e2e. mTLS + audit log + 2FA + anti-abuse — đủ cho ngành proxy.

---

## 🙏 Kết

Nếu bạn từng nghĩ "giá mà có 1 panel proxy free, đầy đủ tính năng, không phải code" — thì **ProxyBox là cái bạn cần**.

Test thử, share với bạn bè cùng ngành, đóng góp code/feedback, hoặc đơn giản là cho 1 ⭐ trên GitHub để encourage mình maintain dài hạn.

👇 **Bình luận:** Bạn đang dùng panel proxy nào? Có gì ProxyBox cần thêm để thay thế được?

Cảm ơn cả nhà — chúc cuối tuần vui vẻ 🎉

---

*#ProxyBox #SelfHost #OpenSource #Proxy #IPv6 #VPS #VietnameseTech*
