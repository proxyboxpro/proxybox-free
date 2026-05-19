# ProxyBox — Hướng dẫn người dùng (Customer)

> Tài liệu mô tả dịch vụ và các trang chức năng dành cho **khách hàng** (role = `customer`).
> Admin console (role ≠ `customer`) có tài liệu riêng — xem `README.md`.

URL: `https://your-panel.example.com/` (production). Local dev: `http://127.0.0.1:5173/` proxied tới backend.

---

## 1. Tổng quan dịch vụ

ProxyBox là nền tảng cho thuê **proxy IPv4 + IPv6** theo giờ với hạ tầng multi-node toàn cầu.

**Đặc điểm chính**

| Thuộc tính            | Mô tả                                                                           |
|-----------------------|---------------------------------------------------------------------------------|
| Loại proxy            | IPv4 (1 IP / 1 port / sticky) hoặc IPv6 (sticky hoặc rotating /48)              |
| Đơn vị bán            | Theo giờ — tối thiểu 1h, tối đa giá trị `pricing.maxHours` (mặc định 8760h/1 năm) |
| Giao thức             | HTTP/HTTPS proxy **và** SOCKS5 chia chung 1 port (sniff first byte)             |
| Auth proxy            | `user:pass` (mỗi proxy có user/pass riêng) hoặc IP whitelist (tuỳ feature flag) |
| Sticky session        | Username dạng `user-session-<random>` giữ cùng exit IPv6 trong session          |
| Zone địa lý           | Khách chọn khu vực; hệ thống auto-balance node phù hợp                          |
| Auto-renew            | Tuỳ chọn; tự trừ ví khi proxy gần hết hạn                                       |
| Thanh toán            | Stripe (credit card, Apple Pay, Google Pay) — nạp vào ví VND                    |
| Affiliate             | Mỗi user có referral code; người mới đăng ký qua link → cộng tiền vào ví        |
| Bảo mật               | 2FA TOTP (Authenticator app), API key cá nhân, webhook ký HMAC                  |

**Stack kỹ thuật (tham khảo)**

- Frontend: Vue 3 + Vite, đa ngôn ngữ vi/en (persist localStorage).
- Backend: Node.js 22 control plane (`server/index.js`), agent Rust+Tokio chạy proxy listeners.
- API customer: tất cả namespace `/api/v1/user/*`, header `Authorization: Bearer <token>` hoặc `X-Customer-Key: <apiKey>`.

---

## 2. Đăng ký tài khoản (Register)

### Đường dẫn
`/register` (UI). Backend: `POST /api/auth/register`.

### Form

| Field            | Bắt buộc | Validation                                                            |
|------------------|----------|-----------------------------------------------------------------------|
| `name`           | có       | 2–80 ký tự; trim                                                      |
| `email`          | có       | Format email hợp lệ; unique (không trùng user có sẵn)                 |
| `password`       | có       | ≥ 8 ký tự, phải có **chữ hoa + chữ thường + số** (regex enforce ở backend) |
| `acceptedTos`    | có       | Checkbox "Đồng ý điều khoản" — bắt buộc `true` mới qua                |
| `referralCode`   | không    | Mã giới thiệu của bạn bè — cộng kickback cho cả 2 (nếu feature bật)   |

### Flow

1. User mở `/register`, điền form.
2. Bấm "Tạo tài khoản" → frontend gọi `POST /api/auth/register` với body `{ name, email, password, acceptedTos, referralCode }`.
3. Backend tạo user mới với:
   - `role = 'customer'` (mặc định cho register tự nguyện)
   - `plan = 'free'` (gói khởi tạo, admin có thể đổi)
   - `balance = 0` (ví VND, nạp sau)
   - `apiKey` ngẫu nhiên 40 ký tự hex
   - `referralCode` ngẫu nhiên 8 ký tự để chia sẻ cho người khác
   - Mật khẩu hash scrypt + salt riêng
4. Nếu `referralCode` hợp lệ → cộng `kickbackPerSignup` VND vào ví **người giới thiệu** + ghi nhận lượt referral.
5. Backend trả `{ token, user }`; frontend lưu token vào `localStorage['proxyhub.token']` và chuyển hướng tới `/customer/dashboard`.

### Tắt chức năng đăng ký

Admin có thể tắt mục đăng ký mới (feature flag `registration`). Khi tắt, `POST /api/auth/register` trả 403 `{ error: 'registration disabled by admin' }` và nút "Sign up" trên UI ẩn đi.

### Lỗi thường gặp

| Status | Body                                          | Ý nghĩa                                |
|--------|-----------------------------------------------|----------------------------------------|
| 400    | `{ error: 'invalid email' }`                  | Format email không hợp lệ              |
| 400    | `{ error: 'password too weak' }`              | Mật khẩu không đạt yêu cầu phức tạp    |
| 409    | `{ error: 'email already registered' }`       | Email đã có tài khoản                  |
| 403    | `{ error: 'registration disabled by admin' }` | Admin đã tắt registration              |

---

## 3. Đăng nhập (Login)

### Đường dẫn
`/login` (UI). Backend: `POST /api/auth/login`.

### Form (bước 1)

| Field      | Bắt buộc | Mô tả                                |
|------------|----------|--------------------------------------|
| `email`    | có       | Email đã đăng ký                     |
| `password` | có       | Mật khẩu raw, gửi qua HTTPS          |
| `totpCode` | tuỳ trường hợp | Chỉ hiện khi backend yêu cầu (bước 2) |

### Flow chuẩn (chưa bật 2FA)

1. User mở `/login`, điền email + password, bấm "Đăng nhập".
2. Frontend gọi `POST /api/auth/login` body `{ email, password }`.
3. Backend tìm user theo email (lowercase), verify mật khẩu bằng scrypt timing-safe.
4. Nếu OK + user **không enroll 2FA** → trả `{ token, user }` ngay. Frontend lưu token + redirect:
   - `user.role === 'customer'` → `/customer/dashboard`
   - `user.role !== 'customer'` → `/dashboard` (admin layout)

### Flow có 2FA

Nếu user đã enroll TOTP (`user.totp.secret` đã được set qua trang Account):

1. Frontend gửi lần đầu chỉ có email + password.
2. Backend phát hiện `user.totp.secret` tồn tại + body **không có** `totpCode` → trả `401 { error: 'totp code required', totpRequired: true }`.
3. Frontend bắt error này (qua `ApiError.data.totpRequired`), hiện thêm field "Mã 2FA (6 số)" với autofocus.
4. User mở Authenticator app (Google Authenticator / Authy / 1Password), copy mã 6 số đang hiển thị.
5. User bấm "Đăng nhập" lại — frontend gửi `{ email, password, totpCode }`.
6. Backend verify mã (cửa sổ TOTP ±1 chu kỳ 30s để tránh trôi thời gian) → trả `{ token, user }` hoặc `401 { error: 'invalid totp code', totpRequired: true }` nếu mã sai.

### Đăng nhập qua mạng xã hội (OAuth)

Nếu admin đã cấu hình Google/GitHub OAuth + bật feature flag `oauth`:

1. Trên `/login`, dưới form xuất hiện nút "Đăng nhập qua Google" / "Đăng nhập qua GitHub".
2. Click → redirect tới `/api/auth/oauth/<provider>/start` → consent screen của provider.
3. Provider gọi callback `/api/auth/oauth/<provider>/callback?code=…`.
4. Backend exchange code lấy thông tin user, **tự động link** với account ProxyBox cùng email (hoặc tạo mới nếu chưa có).
5. Redirect về `/login?oauth_token=<token>&dest=<destination>`.
6. Frontend đọc `oauth_token` từ query, gọi `setToken()` rồi `router.replace({ name: dest })`.

### Cơ chế khoá tạm thời (lockout)

- 5 lần login fail liên tiếp (theo cặp IP + email) → khoá 5 phút.
- Trong thời gian khoá: backend trả `429 { error: 'too many failed logins — try again in a few minutes' }`.
- Login thành công → clear bộ đếm.

### Đổi mật khẩu / quên mật khẩu

- **Đổi mật khẩu** khi đã đăng nhập: trang `/customer/account` → mục "Đổi mật khẩu" (xem §11).
- **Quên mật khẩu** (chưa đăng nhập): hiện chưa có self-service reset. Liên hệ admin để reset thủ công.

---

## 4. Dashboard — `/customer/dashboard`

Trang đầu tiên sau khi login. Trình bày theo phong cách "security console" với shield-hero làm trung tâm.

**Khối chính**

- **Shield hero**: huy hiệu màu green/yellow/red tuỳ trạng thái:
  - Green "Hệ thống an toàn" khi không có proxy hết hạn + ví đủ tiền.
  - Yellow "Có cảnh báo" khi có proxy hết hạn trong 24h.
  - Red "Cần xử lý ngay" khi có proxy đã expired.
  - Bên phải hero: sparkline 24h băng thông `download` (lấy từ `usage.history`).
- **KPI cards** (5 card): Balance VND, Active proxies, Expiring 24h, Used this month, Quick actions.
- **My proxies** (left column): danh sách top 8 proxy với avatar màu (v4/v6), endpoint, connection count + progress bar share theo monthBytes.
- **Alerts** (right column): cảnh báo gia hạn, ví thấp (<10.000 VND), proxy lỗi.
- **Recent order groups**: 6 đơn gần nhất ở dạng connection-row (dot, id, zone, item, ngày, amount).

**Dữ liệu fetch khi load**

```
GET /api/v1/user/account     → { name, email, plan, balance, totpEnabled, ... }
GET /api/v1/user/proxies     → mảng proxy (nếu fail thì rỗng)
GET /api/v1/user/orders      → mảng order
GET /api/v1/user/usage       → { history } cho sparkline (optional)
```

---

## 5. Mua proxy — `/customer/buy`

Trang đặt mua proxy mới với tính phí theo giờ.

### Cấu hình

| Field         | Mô tả                                                                            |
|---------------|----------------------------------------------------------------------------------|
| `type`        | Segment tab `IPv4` / `IPv6` (giá per-hour khác nhau, hiển thị inline)           |
| `quantity`    | Số proxy muốn mua (1 – 50, plan free giới hạn `maxOrderQty`)                    |
| `zone`        | Dropdown zone địa lý (cờ + tên + số node online); để trống = auto-balance       |
| `hours`       | Số giờ (giới hạn `pricing.minHours` – `pricing.maxHours`)                       |
| `rotate`      | Toggle "Xoay IPv6" (chỉ enable khi `type === 'ipv6'`)                           |
| `autoRenew`   | Toggle auto-renew khi hết hạn (trừ ví, tạo đơn mới tự động)                     |
| `coupon`      | Mã giảm giá (apply sau tier discount)                                            |

### Preset thời gian

Chips bấm nhanh: 1h, 6h, 24h, 3d (72h), 7d (168h), 30d (720h).

### Tính giá

```
base       = perHour(type) × hours × quantity
tier       = pricing.tiers.filter(t => quantity >= t.min).sort(desc by min)[0]
discount   = tier?.discount || 0  + coupon.discount (nếu valid)
total      = round(base × (1 - discount))
canAfford  = balance >= total
```

Volume tier discount hiển thị inline để khách thấy mua nhiều giảm bao nhiêu.

### Đặt mua

1. Bấm "Đặt mua N VND" → `POST /api/v1/user/orders` body `{ type, quantity, hours, zone, rotate, autoRenew, coupon }`.
2. Backend:
   - Verify balance đủ.
   - Tạo order mới: `id = ORD-<timestamp-suffix>`, `proxyIds: [...]`.
   - Tạo N proxy: pick bindIp + port theo zone & node, sinh user/pass random, gán `ownerId = currentUser.id`.
   - Trừ ví: `balance -= total`, ghi tx vào ledger.
   - Khởi động listener proxy trên node tương ứng (cho IPv4 local) hoặc đẩy reconcile tới agent.
3. Trả `{ order, proxies, balance }`.
4. Frontend hiển thị flash success + redirect `/customer/orders/<orderId>` sau 1.2s.

### Lỗi thường gặp

| Status | Body                                       | Xử lý                                              |
|--------|--------------------------------------------|----------------------------------------------------|
| 402    | `{ error: 'insufficient balance' }`        | Hiện nút "Nạp ngay" → redirect `/customer/billing` |
| 400    | `{ error: 'invalid quantity for plan' }`   | Plan free giới hạn — gợi ý upgrade                 |
| 503    | `{ error: 'no nodes available in zone' }`  | Chọn zone khác hoặc để auto                         |

---

## 6. Quản lý proxy — `/customer/proxies`

Trang xem + thao tác proxy đã mua.

**Toolbar**

- Segment tabs lọc theo loại: `Tất cả` / `IPv4 · N` / `IPv6 · N`.
- Chips lọc theo trạng thái: `Tất cả` / `Active · N` / `Expired · N`.
- Search box: tìm theo IP / port / username / id.
- Nút `Copy all` (copy tất cả endpoint dạng `ip:port:user:pass` newline-separated).
- Nút `.txt` / `.csv` export — gọi `/api/v1/user/proxies/export?format={txt|csv}` → download.

**KPI strip**: tổng số, số active, kết nối live, băng thông tháng (↑/↓).

**Layout 2 cột**

- Bên trái: danh sách app-row.
  - Avatar màu xanh (v4) / tím (v6), tên proxy, endpoint, status pill, count-pill (live conns + progress bar share).
  - Click row → set selected.
- Bên phải: detail panel của proxy đang chọn.
  - Grid metadata: type, endpoint, user, pass, zone, hours còn lại, conns, monthBytes.
  - 3 ô credential-box copy-ready:
    - URL HTTP: `http://user:pass@ip:port`
    - URL SOCKS5: `socks5://user:pass@ip:port`
    - Format flat: `ip:port:user:pass`

**Fetch**

```
GET /api/v1/user/proxies
```

Mỗi proxy có `stats: { uploadBytes, downloadBytes, monthBytes, activeConnections }` để tính progress bar.

---

## 7. Đơn hàng nhóm — `/customer/orders` + `/customer/orders/:orderId`

ProxyBox gom mọi proxy mua cùng 1 lần thành **1 order group**. Quản lý theo nhóm thay vì từng proxy lẻ.

### List `/customer/orders`

- Segment tabs lọc theo loại đơn: Tất cả / IPv4 / IPv6.
- Chips trạng thái: Tất cả / Đang chạy (`paid`) / Đã huỷ (`cancelled`).
- KPI strip: tổng đơn, đang chạy, đã huỷ, tổng chi (VND).
- Mỗi row dạng connection-row: dot status, id, zone hoặc family, item, ngày, amount.
- Click row → detail.

### Detail `/customer/orders/:orderId`

- **Shield hero**: id nhóm + status pill + 4 badge (số proxy, amount, thời gian còn lại, auto-renew on/off).
- **Chi tiết**: type/zone/giá/hours/expires/autoRenew.
- **Actions**:
  - Toggle auto-renew → `PATCH /api/v1/user/orders/:id { autoRenew }`.
  - Tải hoá đơn PDF → `/api/v1/user/orders/:id/invoice` (open new tab).
  - Copy tất cả proxy của nhóm vào clipboard.
  - Huỷ + hoàn tiền (nếu đang `paid`) → `POST /api/v1/user/orders/:id/cancel`. Backend prorate refund theo giờ còn lại, cộng vào ví, mark order `cancelled` + expire mọi proxy thuộc nhóm.
- **Proxy trong nhóm**: liệt kê N proxy dạng connection-row (status dot, name, type, endpoint, user:pass, copy button).

---

## 8. Ví & Thanh toán — `/customer/billing`

Quản lý số dư + nạp tiền + xem lịch sử giao dịch.

**Wallet hero**

- Số dư VND lớn + plan đang dùng + số proxy đang active.

**Nạp tiền**

- Input số tiền (min 10.000 VND, step 10.000).
- Preset chips: 50k / 100k / 200k / 500k / 1M.
- Bấm "Nạp X VND qua Stripe" → `POST /api/v1/user/billing/checkout { amount }`.
- Backend tạo Stripe Checkout Session với `successUrl` + `cancelUrl` đã cấu hình sẵn (chỉ admin set được, không phụ thuộc Origin header — tránh open redirect).
- Frontend nhận `{ url }` → `window.location.href = url` chuyển tới Stripe.
- Stripe webhook → backend cộng tiền vào ví khi thanh toán confirmed (race-safe atomic SQL).

**Bảng giá hiện hành** (read-only, copy từ admin pricing)

- IPv4 / giờ, IPv6 / giờ, min/max hours, volume tiers.

**Lịch sử đơn hàng** (top 8) — link tới detail.

**Giao dịch ví** — dạng connection-row: timestamp, type (`topup` / `order` / `refund` / `bonus`), note, amount (+/-), balance after.

---

## 9. Băng thông — `/customer/usage`

Trang thống kê băng thông sử dụng.

**Hero**

- Big total bytes (formatted GB/MB).
- Badges: ↑ upload, ↓ download, total conns, số proxy.
- Sparkline 24h dùng `usage.hourly` (mỗi cột 1h).

**Per-proxy**

- App-row list: tên, endpoint, zone, tốc độ live ↑/↓ B/s, tổng bytes + progress bar share.
- Click → tạm thời chỉ navigate tới `/customer/proxies` (chưa có detail riêng cho usage).

**Fetch**

```
GET /api/v1/user/usage/summary
→ {
    totals: { upload, download, conns, proxyCount },
    hourly: [{ uploadBytes, downloadBytes, ts }, ...],   // 24 entries
    perProxy: [{ id, name, type, bindIp, port, zone, uploadBytes, downloadBytes, bpsIn, bpsOut, totalConnections }]
  }
```

---

## 10. Affiliate — `/customer/affiliate`

Chương trình giới thiệu — mời người mới đăng ký → cộng tiền vào ví.

**Hero**: tổng kiếm được (VND) + số người đã giới thiệu + tỉ lệ kickback per signup.

**Link giới thiệu**

- Hiển thị URL đầy đủ: `<origin>/register?ref=<referralCode>`.
- Buttons: Copy link / Copy text+link / Share Telegram (mở `t.me/share/url`) / Share Facebook (mở `facebook.com/sharer`).

**Pre-formatted share text**: hiển thị template marketing cho user copy.

**Danh sách referrals**: bảng các email (masked) đã đăng ký qua link, ngày đăng ký, plan họ đang dùng.

**Fetch**

```
GET /api/v1/user/affiliate
→ { totalReferred, totalEarned, kickbackPerSignup, shareUrl, shareText, referrals: [...] }
```

Tắt được qua feature flag `affiliate` — khi tắt, sidebar ẩn entry này.

---

## 11. Tài khoản — `/customer/account`

Trang cá nhân: thông tin + bảo mật + API key + GDPR.

### Thông tin
- Name, email (read-only), plan, balance, referralCode (copy được), ngày accept TOS.

### 2FA (TOTP)
- Nếu **chưa bật**: nút "Bật 2FA" → `POST /api/v1/user/auth/totp/enroll` → backend trả `{ secret, otpauthUri }`.
  - UI hiện secret + URI (paste vào Authenticator app hoặc QR scan).
  - User nhập mã 6 số đầu tiên → `POST /api/v1/user/auth/totp/confirm { code }` để xác nhận → từ giờ login phải có TOTP.
- Nếu **đã bật**: nút "Tắt 2FA" → prompt nhập mã hiện tại → `POST /api/v1/user/auth/totp/disable { code }`.

### Đổi mật khẩu
- Mật khẩu hiện tại + mật khẩu mới (8+, hoa/thường/số).
- `POST /api/v1/user/account/change-password { oldPassword, newPassword }`.
- Thành công → flash + auto-redirect `/login` sau 1.5s (token cũ bị invalidate).

### API key + Webhook
- API key: hash hex 40 ký tự, dùng header `X-Customer-Key: <key>` để gọi mọi endpoint `/api/v1/user/*` ngoài UI (script, automation).
- Nút "Rotate" → `POST /api/v1/user/account/regenerate-api-key` → script đang dùng key cũ ngưng hoạt động.
- Webhook URL: nhận event JSON khi order/proxy/billing có thay đổi.
  - Lưu qua `PATCH /api/v1/user/account/webhook { url }`.
  - Payload event ký HMAC-SHA256 với customer apiKey, header `X-ProxyBox-Signature: sha256=<hex>`.
  - Bật/tắt feature qua flag `customerWebhook`.

### GDPR — Xuất dữ liệu cá nhân
- Nút "Tải xuống JSON" → `GET /api/v1/user/gdpr/export` → file JSON chứa toàn bộ user + orders + proxies + tx history + audit log liên quan tài khoản.

---

## 12. API cho khách hàng (programmatic access)

Khách hàng có thể gọi API trực tiếp ngoài UI để tự động hoá.

**Authentication**: chọn 1 trong 2

```
Authorization: Bearer <session-token>   # session từ /api/auth/login
X-Customer-Key: <apiKey>                # key cá nhân từ trang Account
```

**Endpoint quan trọng** (namespace `/api/v1/user/*`)

| Method | Path                                  | Mô tả                                |
|--------|---------------------------------------|--------------------------------------|
| GET    | `/api/v1/user/account`                | Thông tin tài khoản                  |
| GET    | `/api/v1/user/pricing`                | Bảng giá + tiers                     |
| GET    | `/api/v1/user/zones`                  | Danh sách zone địa lý                |
| POST   | `/api/v1/user/orders`                 | Đặt đơn proxy mới                    |
| GET    | `/api/v1/user/orders`                 | List đơn                             |
| GET    | `/api/v1/user/orders/:id`             | Chi tiết đơn + proxies               |
| PATCH  | `/api/v1/user/orders/:id`             | Toggle autoRenew                     |
| POST   | `/api/v1/user/orders/:id/cancel`      | Huỷ + refund                          |
| GET    | `/api/v1/user/proxies`                | List proxy của user                  |
| GET    | `/api/v1/user/proxies/export`         | Export TXT/CSV                       |
| POST   | `/api/v1/user/proxies/:id/rotate`     | Đổi exit IP (chỉ IPv6 rotating)      |
| GET    | `/api/v1/user/usage/summary`          | Thống kê băng thông                  |
| GET    | `/api/v1/user/billing`                | Wallet info                          |
| POST   | `/api/v1/user/billing/checkout`       | Tạo Stripe Checkout Session          |
| GET    | `/api/v1/user/billing/transactions`   | Lịch sử ví                            |
| GET    | `/api/v1/user/affiliate`              | Thông tin chương trình giới thiệu    |
| POST   | `/api/v1/user/account/change-password`| Đổi mật khẩu                          |
| POST   | `/api/v1/user/account/regenerate-api-key` | Rotate API key                   |
| GET    | `/api/v1/user/gdpr/export`            | Export toàn bộ data                  |

**Rate limit** mặc định: 60 request/phút per IP cho `/api/v1/user/*`. Plan trả phí có thể cao hơn (set qua admin).

**Response shape**: raw JSON (không có envelope `{ code, msg, data }`). HTTP 2xx = success; 4xx/5xx kèm `{ error: "..." }`.

---

## 13. Cảnh báo & Notifications

Khách hàng có thể nhận event qua 2 kênh:

1. **Webhook URL** (đã cấu hình ở §11) — JSON POST mỗi sự kiện, ký HMAC.
2. **Email alerts** (nếu admin đã cấu hình SMTP):
   - Order ready (sau khi mua, kèm danh sách proxy).
   - Sắp hết hạn (24h trước).
   - Đã hết hạn (sau expiry).
   - Số dư thấp (< ngưỡng cấu hình).
   - Invoice tháng / thanh toán.

Event payload mẫu:

```json
{
  "event": "order.created",
  "ts": "2026-05-13T...",
  "userId": "u-abc123",
  "orderId": "ORD-845712",
  "data": { "item": "IPv4 x 5", "amount": 60000, "proxies": [ ... ] }
}
```

---

## 14. FAQ ngắn

**Hết tiền giữa chừng có gì xảy ra?** Proxy chạy tiếp tới hết giờ đã trả. Nếu bật auto-renew nhưng ví < cost gia hạn → email + webhook báo "low balance"; proxy expire bình thường khi hết giờ.

**Đổi zone của proxy đang chạy được không?** Không — phải mua đơn mới ở zone khác. Có thể huỷ đơn hiện tại lấy refund prorate rồi mua lại.

**Bao nhiêu connection đồng thời / proxy?** Mặc định không giới hạn. Admin có thể set `maxConnections` per proxy hoặc cap qua plan. Vượt cap → request bị reject HTTP 429.

**Sticky session là gì?** Dùng username dạng `user-session-abc:pass` → trong session đó (mặc định 10 phút), backend route tất cả request ra cùng 1 IPv6 exit. Đổi `-session-xyz` để lấy IP khác.

**API key bị lộ thì sao?** Vào `/customer/account` → "Rotate" để sinh key mới ngay. Script dùng key cũ sẽ stop hoạt động ngay sau khi rotate.

---

*Doc version 1.0 — sync với `server/index.js` ở commit hiện tại. Khi backend đổi endpoint, cập nhật bảng ở §12.*
