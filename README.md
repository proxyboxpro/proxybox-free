# ProxyBox Free

Open-source proxy SaaS control plane. Self-host on your own VPS to resell IPv4 / IPv6 proxies, hand out BYON (Bring Your Own Node) to customers, or rent hub VPS through Virtualizor.

Published by **[Onie Cloud](https://onie.net)** · live demo: **[proxybox.pro](https://proxybox.pro)**

- **Protocols** — HTTP / SOCKS5 / HTTPS-proxy / Trojan on a single port pair
- **IPv4** datacenter + **IPv6** /48 routed (strict family egress, no A/AAAA leak)
- **BYON** — customer pastes one command on their VPS → agent enrols, free proxies live
- **Hub Proxy** — admin wires up Virtualizor, customers rent VPS by the hour; agent auto-installs via SSH bootstrap
- **Wallet billing** — VND / USD, auto-renew, coupons, tier discounts, Stripe + PayPal
- **Admin remote control** — reboot, restart-agent, diagnose, install-package, drain, force-upgrade
- **mTLS** agent ↔ master, scrypt password hashing, AES-256-GCM at-rest secrets
- Vue 3 dark-theme SPA + Rust+Tokio agent (cross-platform glibc binary)

---

## Quick install (Ubuntu / Debian)

```bash
# One-command installer (Node 22 + Nginx + Certbot + Rust agent)
curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash

# Or clone + run the installer manually
git clone https://github.com/proxyboxpro/proxybox-free.git
cd proxybox-free
sudo ./install.sh
```

The installer prompts for:

1. **Domain** — panel hostname (e.g. `proxy.example.com`). Leave blank → bind to the server's public IP.
2. **SSL mode** — Let's Encrypt (recommended) / Self-signed / HTTP only.
3. **Admin email + password** — defaults to `admin@admin.com` / `admin`.

After ~3-5 minutes (SPA + Rust agent build), open `https://your-domain` → sign in → **rotate the admin password immediately**.

### Non-interactive

```bash
sudo ./install.sh \
  --domain proxy.example.com \
  --ssl letsencrypt \
  --admin-email me@example.com \
  --admin-pass 'StrongPw_1234!' \
  --yes
```

### Installer flags

| Flag | Description |
|---|---|
| `--domain DOMAIN` | Panel hostname |
| `--ssl auto\|letsencrypt\|selfsigned\|none` | SSL mode (default `auto` = prompt) |
| `--admin-email EMAIL` | Admin email (default `admin@admin.com`) |
| `--admin-pass PASS` | Admin password (default `admin`) |
| `--install-dir PATH` | Install directory (default `/opt/proxyhub-free`) |
| `--source-dir PATH` | Copy source from a local directory instead of `git clone` |
| `--git-repo URL` | Git repo to clone from |
| `--skip-rust` | Skip the Rust agent build (Node fallback still works) |
| `--force-reseed` | Overwrite `config.json` + admin user (DESTRUCTIVE) |
| `--yes`, `-y` | Non-interactive, accept defaults |

## Requirements

|  | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |
| RAM | 1 GB | 2 GB+ |
| Disk | 10 GB | 20 GB SSD |
| Network | Public IPv4 | IPv4 + IPv6 (/48 routed) |
| Ports | 80, 443, 8788 (mTLS) | + 20000-29999 if serving local proxies |

The installer auto-installs: Node.js 22, nginx, certbot (when LE is chosen), rustup (when the Rust agent is built), git, jq, openssl.

## Layout

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

## After install

### First login
1. Open `https://your-domain` → sign in with the installer credentials.
2. **Settings → Security** — rotate the admin password and enable 2FA.
3. **Admin → Zones** — add zones.
4. **Admin → Pricing** — set IPv4 / IPv6 prices.
5. **Admin → Features** — disable registration if it's an internal-only panel.

### Customer agent enrolment (BYON)

Each customer signs in → `/my-nodes` → copy the install command:

```bash
curl -fsSL https://YOUR-DOMAIN/api/agent/claim/<usr-token> | sudo bash -s v4
```

The URL in that command is **always** your own panel's domain (read from `config.api.publicUrl`) — customer agents only ever enrol back into your panel, never anyone else's.

### Add hub VPS (Virtualizor)

1. Admin → **Hubs → Virtualizor instances** — add a panel (URL, adminapikey, adminapipass).
2. Tab **Hub plans → New plan** — pick the instance → dropdowns auto-list servers / plans / OS / IP pools from the panel.
3. Customer goes to `/buy?source=hub` → master calls `addvs` → SSH bootstrap installs the agent → node enrols and adopts the placeholder.

### One-click upgrade

When a new version lands on the GitHub repo:

- Admin → **Settings → System** → click **Upgrade to the latest version**.
- The server runs `git pull` + `npm install` + `npm run build` + `systemctl restart proxybox`.
- Customer proxy traffic is **not** interrupted (the TCP listeners are kept). The admin panel disconnects for ~30s.

## Operations

```bash
# Service control
sudo systemctl status proxybox
sudo systemctl restart proxybox
sudo journalctl -u proxybox -f

# Manual update of SPA + server
cd /opt/proxyhub-free
sudo -u proxyhub git pull && sudo -u proxyhub npm install && sudo -u proxyhub npm run build
sudo systemctl restart proxybox

# Re-seed admin (DESTRUCTIVE — wipes users + proxies)
sudo /opt/proxyhub-free/install.sh --force-reseed --domain your-domain --yes

# Backup
sudo tar czf proxybox-backup-$(date +%F).tgz \
  /opt/proxyhub-free/server/{config.json,master.key,orders.json,data.db,pki}
```

## Security checklist

- [ ] Rotate the default admin password (`admin` → strong password) right after install.
- [ ] Enable 2FA (TOTP) on the admin account at **Settings → Security**.
- [ ] Populate `config.api.adminIpWhitelist[]` if admin only signs in from fixed IPs.
- [ ] Back up `server/master.key` off-site — losing it means every encrypted secret is unrecoverable.
- [ ] Firewall — only open 80 / 443 / 8788 to the internet. Port 8787 (master HTTP) binds to localhost; nginx terminates TLS and forwards.

## License

MIT — see [LICENSE](LICENSE).

## Links

- Live demo: https://proxybox.pro
- Pricing: https://proxybox.pro/pricing
- API docs: https://proxybox.pro/api-docs
- FAQ: https://proxybox.pro/faq
- Changelog: https://proxybox.pro/changelog
- Issues: https://github.com/proxyboxpro/proxybox-free/issues
- Full install guide: [`docs/install.md`](docs/install.md)

---

## Tiếng Việt — tóm tắt

ProxyBox là panel proxy SaaS mã nguồn mở để bạn tự host trên VPS riêng. Cài bằng 1 lệnh, customer của BẠN enroll agent thẳng về panel của BẠN — không bao giờ data lọt sang server bên thứ 3.

```bash
curl -fsSL https://proxybox.pro/install-panel.sh | sudo bash
```

Sau khi cài: mở `https://domain-cua-ban` → login → đổi password admin → vào **Admin → Pricing / Zones** để cấu hình. Đầy đủ docs tiếng Việt + tiếng Anh tại https://proxybox.pro/faq (toggle EN/VI ở góc trên).
