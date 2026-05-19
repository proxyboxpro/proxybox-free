# ProxyBox Free

Open-source proxy SaaS control plane. Self-host trên VPS riêng để bán proxy IPv4 / IPv6, cấp BYON cho customer, hoặc thuê VPS hub qua Virtualizor.

- **Protocols**: HTTP / SOCKS5 / HTTPS-proxy / Trojan trên cùng 1 cặp port
- **IPv4** datacenter + **IPv6** /48 routed (strict family egress, không leak)
- **BYON**: customer chạy 1 lệnh agent trên VPS của họ → tạo proxy miễn phí
- **Hub Proxy**: admin cấu hình Virtualizor → customer thuê VPS theo giờ, agent auto-cài qua SSH bootstrap
- **Wallet billing** VND/USD, auto-renew, coupon, tier discount
- **Admin remote control**: reboot, restart-agent, diagnose, install-package, drain, force-upgrade
- **mTLS** agent ↔ master, scrypt password, AES-256-GCM at-rest secrets
- Vue 3 dark-theme SPA + Rust+Tokio agent (cross-platform glibc binary)

## Quick install (Ubuntu / Debian)

```bash
git clone https://github.com/<owner>/proxyhub-free.git
cd proxyhub-free
sudo ./install.sh
```

Installer hỏi:
1. **Domain** — hostname panel (vd `proxy.example.com`). Bỏ trống → dùng IP server.
2. **SSL mode** — Let's Encrypt (khuyến nghị) / Self-signed / HTTP only.
3. **Admin email + password** — mặc định `admin@admin.com` / `admin`.

Sau ~3-5 phút (build SPA + Rust agent), truy cập `https://your-domain` → login → **đổi password ngay**.

### Non-interactive

```bash
sudo ./install.sh \
  --domain proxy.example.com \
  --ssl letsencrypt \
  --admin-email me@example.com \
  --admin-pass 'StrongPw_1234!' \
  --yes
```

### Tất cả flag

| Flag | Mô tả |
|---|---|
| `--domain DOMAIN` | Hostname panel |
| `--ssl auto\|letsencrypt\|selfsigned\|none` | SSL mode (default `auto` = prompt) |
| `--admin-email EMAIL` | Email admin (default `admin@admin.com`) |
| `--admin-pass PASS` | Mật khẩu admin (default `admin`) |
| `--install-dir PATH` | Thư mục cài (default `/opt/proxyhub-free`) |
| `--source-dir PATH` | Copy source từ local dir thay vì git clone |
| `--git-repo URL` | Repo Git để clone |
| `--skip-rust` | Bỏ build Rust agent (Node fallback vẫn chạy) |
| `--force-reseed` | Ghi đè config.json + admin user (DESTRUCTIVE) |
| `--yes`, `-y` | Non-interactive, accept defaults |

## Yêu cầu

| | Tối thiểu | Khuyến nghị |
|---|---|---|
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |
| RAM | 1 GB | 2 GB+ |
| Disk | 10 GB | 20 GB SSD |
| Network | IPv4 public | IPv4 + IPv6 (/48 routed) |
| Ports | 80, 443, 8788 (mTLS) | + 20000-29999 nếu phục vụ proxy local |

Installer tự cài: Node.js 22, nginx, certbot (nếu chọn LE), rustup (nếu cần Rust agent), git, jq, openssl.

## Cấu trúc

```
/opt/proxyhub-free/
  server/index.js              control plane monolith (~10k LOC)
  server/agent.js              Node fallback agent
  server/oauth.js              Google + GitHub OAuth
  server/virtualizor.js        Virtualizor admin API client
  server/config.json           live state (chmod 600)
  server/master.key            AES-256-GCM key (chmod 600)
  server/data.db               SQLite: billing_tx, audit, conn_events
  server/pki/                  mTLS CA + server cert
  src/                         Vue 3 SPA source
  dist/                        SPA built bundle
  rust-core/                   Rust+Tokio agent source
  scripts/seed-config.mjs      first-install seeder
```

## Sau khi cài

### Login lần đầu
1. `https://your-domain` → login mặc định.
2. **Settings → Security** → đổi password admin + bật 2FA.
3. **Admin → Zones** → thêm zone.
4. **Admin → Pricing** → set giá IPv4/IPv6.
5. **Admin → Features** → tắt registration nếu chỉ team nội bộ.

### Customer add agent của họ (BYON)

Customer login → `/my-nodes` → copy lệnh:
```bash
curl -fsSL https://YOUR-DOMAIN/api/agent/claim/<usr-token> | sudo bash -s v4
```
URL trong lệnh **tự động** là domain của panel của bạn (đọc từ `config.api.publicUrl`) → agent của customer chỉ enroll về panel của bạn, không lung tung.

### Add hub VPS (Virtualizor)
1. Admin → **Hubs → Virtualizor instances** → thêm panel (URL, adminapikey, adminapipass).
2. Tab **Hub plans → New plan** → chọn instance → dropdown auto-list servers / plans / OS / IP pools từ panel.
3. Customer `/buy?source=hub` → master gọi `addvs` → SSH bootstrap install agent → node tự enroll + adopt placeholder.

### One-click upgrade

Khi có version mới (`git pull` available trên repo):
- Admin → **Settings → System** → click **Nâng cấp lên phiên bản mới**.
- Server tự `git pull` + `npm install` + `npm run build` + `systemctl restart proxyhub`.
- Customer proxy traffic KHÔNG bị ảnh hưởng (TCP listener giữ nguyên). Admin panel mất kết nối ~30s.

## Quản trị

```bash
# Service control
sudo systemctl status proxyhub
sudo systemctl restart proxyhub
sudo journalctl -u proxyhub -f

# Manual update SPA
cd /opt/proxyhub-free
sudo -u proxyhub git pull && sudo -u proxyhub npm install && sudo -u proxyhub npm run build
sudo systemctl restart proxyhub

# Re-seed admin (mất hết user/proxy data!)
sudo /opt/proxyhub-free/install.sh --force-reseed --domain your-domain --yes

# Backup
sudo tar czf proxyhub-backup-$(date +%F).tgz \
  /opt/proxyhub-free/server/{config.json,master.key,orders.json,data.db,pki}
```

## Security checklist

- [ ] Đổi mật khẩu admin mặc định (`admin` → strong password) ngay sau cài.
- [ ] Bật 2FA (TOTP) cho admin account: **Settings → Security**.
- [ ] `config.api.adminIpWhitelist[]` nếu admin chỉ login từ IP cố định.
- [ ] Backup `server/master.key` offsite — mất file = mất hết secrets encrypted.
- [ ] Firewall: chỉ mở 80 / 443 / 8788 ra internet. Port 8787 (master HTTP) chỉ localhost — nginx forward.

## License

MIT — xem [LICENSE](LICENSE).

## Liên kết
- Issues: https://github.com/&lt;owner&gt;/proxyhub-free/issues
- Docs đầy đủ: [`docs/install.md`](docs/install.md)
