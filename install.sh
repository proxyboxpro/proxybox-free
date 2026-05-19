#!/usr/bin/env bash
# ProxyBox Free — one-shot installer for Ubuntu/Debian.
#
# Usage:
#   curl -fsSL https://YOUR-DOMAIN/install.sh | bash
#   OR
#   ./install.sh                       # interactive
#   ./install.sh --domain example.com --ssl letsencrypt --admin-pass mypw
#
# What it does:
#   1. Installs Node.js 22 + nginx + certbot (if missing)
#   2. Clones / copies ProxyBox source to /opt/proxyhub-free
#   3. Asks for your domain + SSL preference
#   4. Seeds config.json with a default admin@admin.com / admin user
#      (the operator MUST change this password on first login)
#   5. Configures nginx as TLS-terminating reverse proxy → 127.0.0.1:8787
#   6. Optionally issues a Let's Encrypt cert via certbot
#   7. Creates a systemd unit `proxyhub.service` and enables auto-start
#   8. Prints the panel URL + admin credentials
#
# Re-runnable: detects existing install + offers in-place upgrade
# (won't overwrite config.json unless --force-reseed is passed).

set -euo pipefail

# ────────────────────────────────────────────────────────────────────────────
# CONFIG / DEFAULTS
# ────────────────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/proxyhub-free}"
SERVICE_USER="${SERVICE_USER:-proxyhub}"
SERVICE_NAME="proxyhub"
NODE_VERSION_MIN="22"
DOMAIN=""
SSL_MODE="auto"          # auto | letsencrypt | selfsigned | none
ADMIN_EMAIL="admin@admin.com"
ADMIN_PASSWORD="admin"
FORCE_RESEED=0
SKIP_RUST=0              # 1 = don't build rust agent (use node fallback only)
ASSUME_YES=0
SOURCE_DIR=""            # optional: copy from a local path instead of git clone
GIT_REPO="${GIT_REPO:-}"

# ────────────────────────────────────────────────────────────────────────────
# Colour output helpers (TTY-aware so piped logs don't get escape codes).
# ────────────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'
else C_RESET=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; fi
say()   { printf "${C_BLUE}[install]${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}[ok]${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
fail()  { printf "${C_RED}[fail]${C_RESET} %s\n" "$*" >&2; exit 1; }
header(){ printf "\n${C_BOLD}══ %s ══${C_RESET}\n" "$*"; }

# ────────────────────────────────────────────────────────────────────────────
# CLI flag parsing
# ────────────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)           DOMAIN="$2"; shift 2;;
    --ssl)              SSL_MODE="$2"; shift 2;;
    --admin-email)      ADMIN_EMAIL="$2"; shift 2;;
    --admin-pass)       ADMIN_PASSWORD="$2"; shift 2;;
    --install-dir)      INSTALL_DIR="$2"; shift 2;;
    --source-dir)       SOURCE_DIR="$2"; shift 2;;
    --git-repo)         GIT_REPO="$2"; shift 2;;
    --force-reseed)     FORCE_RESEED=1; shift;;
    --skip-rust)        SKIP_RUST=1; shift;;
    --yes|-y)           ASSUME_YES=1; shift;;
    --help|-h)
      cat <<EOF
ProxyBox Free installer.

Options:
  --domain DOMAIN        Hostname the panel will be served at.
  --ssl MODE             auto | letsencrypt | selfsigned | none (default: auto)
  --admin-email EMAIL    Admin login email (default: admin@admin.com)
  --admin-pass PASSWORD  Admin login password (default: admin)
  --install-dir PATH     Where to put the source (default: /opt/proxyhub-free)
  --source-dir PATH      Copy source from this local dir (instead of git clone)
  --git-repo URL         Git URL to clone from (overrides default)
  --skip-rust            Don't build rust agent binary (Node fallback always works)
  --force-reseed         Overwrite existing config.json with a fresh admin user
  --yes, -y              Non-interactive: accept all prompts with defaults
EOF
      exit 0;;
    *) fail "Unknown flag: $1 (use --help)";;
  esac
done

[ "$(id -u)" = "0" ] || fail "Run as root (use sudo)."

# ────────────────────────────────────────────────────────────────────────────
# Interactive prompts (skipped when --yes or all values already set)
# ────────────────────────────────────────────────────────────────────────────
ask() {
  # $1=label  $2=var-name  $3=default
  local v
  if [ "$ASSUME_YES" = "1" ]; then v="${!2:-$3}"; eval "$2=\"$v\""; return; fi
  read -rp "  ${1} [${3}]: " v || true
  v="${v:-${!2:-$3}}"
  eval "$2=\"$v\""
}

header "ProxyBox Free — Installer"

if [ -z "$DOMAIN" ]; then
  say "Nhập domain panel sẽ chạy. Bỏ trống để dùng IP của server."
  ask "Domain" DOMAIN ""
fi
if [ -z "$DOMAIN" ]; then
  DOMAIN="$(hostname -I 2>/dev/null | awk '{print $1}')"
  warn "Không có domain — dùng IP $DOMAIN (SSL sẽ tắt)."
  SSL_MODE="none"
fi

if [ "$SSL_MODE" = "auto" ]; then
  if [ "$ASSUME_YES" = "1" ]; then
    SSL_MODE="letsencrypt"
  else
    echo
    say "SSL cho ${DOMAIN}:"
    echo "    1) Let's Encrypt (free, auto-renew, cần domain trỏ DNS đúng)"
    echo "    2) Self-signed (cảnh báo browser, dùng tạm)"
    echo "    3) Không SSL — HTTP only (cho test trên LAN)"
    ask "Chọn 1/2/3" _ssl_choice "1"
    case "$_ssl_choice" in
      1) SSL_MODE="letsencrypt";;
      2) SSL_MODE="selfsigned";;
      3) SSL_MODE="none";;
      *) fail "Lựa chọn không hợp lệ";;
    esac
  fi
fi

if [ "$ASSUME_YES" != "1" ]; then
  echo
  say "Tài khoản admin mặc định: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
  ask "Email admin"    ADMIN_EMAIL    "$ADMIN_EMAIL"
  ask "Mật khẩu admin" ADMIN_PASSWORD "$ADMIN_PASSWORD"
fi

PUBLIC_URL=""
if [ "$SSL_MODE" = "none" ]; then PUBLIC_URL="http://${DOMAIN}"
else PUBLIC_URL="https://${DOMAIN}"; fi

echo
say "Sẽ cài với:"
echo "    domain        = $DOMAIN"
echo "    SSL mode      = $SSL_MODE"
echo "    public URL    = $PUBLIC_URL"
echo "    install dir   = $INSTALL_DIR"
echo "    admin email   = $ADMIN_EMAIL"
echo "    skip rust     = $SKIP_RUST"
if [ "$ASSUME_YES" != "1" ]; then
  read -rp "  Tiếp tục? (y/N) " _ok
  [[ "${_ok:-N}" =~ ^[yY]$ ]] || fail "Aborted by operator."
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 1: OS deps
# ────────────────────────────────────────────────────────────────────────────
header "Step 1/7 — Cài system dependencies"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Node.js 22 if missing or too old
need_node=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$NODE_MAJ" -ge "$NODE_VERSION_MIN" ]; then
    ok "Node.js v$(node -v | tr -d v) đã có (>= ${NODE_VERSION_MIN})"
    need_node=0
  fi
fi
if [ "$need_node" = "1" ]; then
  say "Cài Node.js ${NODE_VERSION_MIN}.x từ NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_MIN}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) đã cài"
fi

for pkg in nginx git curl jq; do
  if ! command -v "$pkg" >/dev/null 2>&1; then
    say "Cài $pkg…"; apt-get install -y -qq "$pkg" >/dev/null
  fi
done
if [ "$SSL_MODE" = "letsencrypt" ] && ! command -v certbot >/dev/null 2>&1; then
  say "Cài certbot…"; apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
fi
if [ "$SSL_MODE" = "selfsigned" ] && ! command -v openssl >/dev/null 2>&1; then
  apt-get install -y -qq openssl >/dev/null
fi
ok "Dependencies xong"

# Service user
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Tạo system user '$SERVICE_USER'…"
  useradd -r -m -s /bin/bash -d "/home/$SERVICE_USER" "$SERVICE_USER"
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 2: source code
# ────────────────────────────────────────────────────────────────────────────
header "Step 2/7 — Đặt source code vào $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"
if [ -n "$SOURCE_DIR" ]; then
  say "Copy từ $SOURCE_DIR…"
  rsync -a --delete \
    --exclude='node_modules' --exclude='dist' --exclude='.git' \
    --exclude='rust-core/target' \
    --exclude='server/config.json' --exclude='server/master.key' \
    --exclude='server/orders.json' --exclude='server/data.db' --exclude='server/state.db' \
    --exclude='server/pki' \
    "$SOURCE_DIR/" "$INSTALL_DIR/"
elif [ -n "$GIT_REPO" ]; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    say "Repo đã có — git pull…"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    say "Clone từ $GIT_REPO…"
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$GIT_REPO" "$INSTALL_DIR"
  fi
elif [ -f "$INSTALL_DIR/package.json" ]; then
  ok "Source đã có sẵn ở $INSTALL_DIR — bỏ qua copy"
else
  fail "Không có --source-dir lẫn --git-repo, và $INSTALL_DIR rỗng. Truyền 1 trong 2 hoặc copy source vào đó trước."
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ────────────────────────────────────────────────────────────────────────────
# Step 3: npm install + build SPA
# ────────────────────────────────────────────────────────────────────────────
header "Step 3/7 — npm install + build SPA"

cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" npm install --no-audit --no-fund --silent
sudo -u "$SERVICE_USER" npm run build
ok "SPA built (dist/)"

# ────────────────────────────────────────────────────────────────────────────
# Step 4: seed config + master.key
# ────────────────────────────────────────────────────────────────────────────
header "Step 4/7 — Seed config + admin user"

seed_args=()
[ "$FORCE_RESEED" = "1" ] && seed_args+=(--force)

# Pass domain → seed script via env so config.api.publicUrl is correct.
# CRITICAL: customer-installed agents read this from the panel; without it
# they'd try to enroll back to whatever default was hardcoded → never reach
# the operator's panel.
sudo -u "$SERVICE_USER" -E env \
  PROXYHUB_PUBLIC_URL="$PUBLIC_URL" \
  PROXYHUB_ADMIN_EMAIL="$ADMIN_EMAIL" \
  PROXYHUB_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node "$INSTALL_DIR/scripts/seed-config.mjs" "${seed_args[@]}"

# ────────────────────────────────────────────────────────────────────────────
# Step 5: build Rust agent binaries (Linux + Windows) — both shipped from the
# operator's own panel so customer install scripts never round-trip to any
# external host. Binary endpoints:
#   /api/agent/claim-binary       → target/release/proxybox-agent (Linux)
#   /api/agent/claim-binary-win   → target/x86_64-pc-windows-gnu/release/*.exe
# ────────────────────────────────────────────────────────────────────────────
if [ "$SKIP_RUST" = "1" ]; then
  warn "Bỏ qua build Rust agent (--skip-rust). Node fallback agent sẽ phục vụ customer."
  warn "  → /api/agent/claim-binary* sẽ 503 cho đến khi build. Customer Linux vẫn cài được qua Node fallback."
else
  header "Step 5/7 — Build Rust agent binaries (Linux + Windows)"

  # Install rustup if missing — service user's home, no root pollution.
  if ! sudo -u "$SERVICE_USER" bash -c 'command -v cargo' >/dev/null 2>&1; then
    say "Rust chưa có — cài rustup cho user '$SERVICE_USER'…"
    sudo -u "$SERVICE_USER" bash -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' >/dev/null
  fi

  # Cross-compile dependencies for Windows target.
  if ! dpkg -l | grep -q gcc-mingw-w64-x86-64; then
    say "Cài mingw-w64 cho cross-compile Windows…"
    apt-get install -y -qq gcc-mingw-w64-x86-64 >/dev/null
  fi
  sudo -u "$SERVICE_USER" bash -c 'source "$HOME/.cargo/env" 2>/dev/null; rustup target add x86_64-pc-windows-gnu' >/dev/null 2>&1 || true

  # Build Linux glibc binary.
  say "Build Linux agent (cargo build --release)…"
  if sudo -u "$SERVICE_USER" bash -c "source \"\$HOME/.cargo/env\" 2>/dev/null; cd '$INSTALL_DIR/rust-core' && cargo build --release" 2>&1 | tail -5; then
    LINUX_BIN="$INSTALL_DIR/rust-core/target/release/proxybox-agent"
    if [ -f "$LINUX_BIN" ]; then
      ok "Linux agent built: $LINUX_BIN ($(du -h "$LINUX_BIN" | cut -f1))"
    else warn "Linux agent build báo thành công nhưng không thấy binary"; fi
  else
    warn "Linux agent build failed — customer Linux sẽ dùng Node fallback (vẫn chạy)."
  fi

  # Build Windows .exe (cross-compile via mingw).
  say "Build Windows agent (target x86_64-pc-windows-gnu)…"
  if sudo -u "$SERVICE_USER" bash -c "source \"\$HOME/.cargo/env\" 2>/dev/null; cd '$INSTALL_DIR/rust-core' && cargo build --release --target x86_64-pc-windows-gnu" 2>&1 | tail -5; then
    WIN_BIN="$INSTALL_DIR/rust-core/target/x86_64-pc-windows-gnu/release/proxybox-agent.exe"
    if [ -f "$WIN_BIN" ]; then
      ok "Windows agent built: $WIN_BIN ($(du -h "$WIN_BIN" | cut -f1))"
    else warn "Windows agent build báo thành công nhưng không thấy binary"; fi
  else
    warn "Windows cross-compile failed — Windows customers sẽ thấy 503 ở /claim-binary-win."
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 6: nginx + SSL
# ────────────────────────────────────────────────────────────────────────────
header "Step 6/7 — nginx reverse proxy + SSL"

NGINX_SITE="/etc/nginx/sites-available/proxyhub-free"
write_nginx_http() {
  cat > "$NGINX_SITE" <<NGINX_HTTP
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 16M;

    # Long-poll endpoints — agent /api/agent/proxies holds 25s. Bump timeouts.
    location /api/agent/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_HTTP
}
write_nginx_https() {
  local cert="$1" key="$2"
  cat > "$NGINX_SITE" <<NGINX_HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 16M;

    location /api/agent/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_HTTPS
}

case "$SSL_MODE" in
  none)
    write_nginx_http
    ;;
  selfsigned)
    say "Tạo self-signed cert cho $DOMAIN…"
    mkdir -p /etc/ssl/proxyhub-free
    openssl req -x509 -nodes -newkey rsa:2048 -days 730 \
      -keyout "/etc/ssl/proxyhub-free/${DOMAIN}.key" \
      -out    "/etc/ssl/proxyhub-free/${DOMAIN}.crt" \
      -subj "/CN=${DOMAIN}" 2>/dev/null
    write_nginx_https "/etc/ssl/proxyhub-free/${DOMAIN}.crt" "/etc/ssl/proxyhub-free/${DOMAIN}.key"
    ;;
  letsencrypt)
    write_nginx_http
    ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/proxyhub-free
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    nginx -t && systemctl reload nginx
    say "Yêu cầu Let's Encrypt cert cho $DOMAIN (cần DNS đã trỏ về server này)…"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect 2>&1 | tail -8; then
      ok "Let's Encrypt cert đã cài + tự renew bật."
    else
      warn "Let's Encrypt thất bại — fallback self-signed."
      mkdir -p /etc/ssl/proxyhub-free
      openssl req -x509 -nodes -newkey rsa:2048 -days 730 \
        -keyout "/etc/ssl/proxyhub-free/${DOMAIN}.key" \
        -out    "/etc/ssl/proxyhub-free/${DOMAIN}.crt" \
        -subj "/CN=${DOMAIN}" 2>/dev/null
      write_nginx_https "/etc/ssl/proxyhub-free/${DOMAIN}.crt" "/etc/ssl/proxyhub-free/${DOMAIN}.key"
    fi
    ;;
esac

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/proxyhub-free
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t || fail "nginx config kiểm tra thất bại"
systemctl reload nginx
ok "nginx ready"

# ────────────────────────────────────────────────────────────────────────────
# Step 7: systemd unit
# ────────────────────────────────────────────────────────────────────────────
header "Step 7/7 — systemd unit + start"

cat > /etc/systemd/system/${SERVICE_NAME}.service <<SYSTEMD
[Unit]
Description=ProxyBox Free — control plane + proxy engine
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/server/index.js
Restart=on-failure
RestartSec=3
# Need CAP_NET_BIND_SERVICE for the proxy engine (binds 20000+, no need for <1024)
# but CAP_NET_ADMIN is required to manage IPv6 prefixes on the local node.
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_ADMIN
LimitNOFILE=131072

[Install]
WantedBy=multi-user.target
SYSTEMD

# sudoers entry: let the service user run `systemctl restart proxyhub` (and
# only that) without password. Powers the one-click "Upgrade" button in the
# admin Settings page — without this, `sudo systemctl restart` inside the
# upgrade script would prompt for password and stall forever.
SUDOERS_FILE="/etc/sudoers.d/proxyhub-free"
cat > "$SUDOERS_FILE" <<SUDOERS
${SERVICE_USER} ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}, /bin/systemctl restart ${SERVICE_NAME}.service, /usr/bin/systemctl restart ${SERVICE_NAME}, /usr/bin/systemctl restart ${SERVICE_NAME}.service
SUDOERS
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null || { rm -f "$SUDOERS_FILE"; fail "sudoers entry invalid"; }

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}.service >/dev/null
systemctl restart ${SERVICE_NAME}.service
sleep 2
if systemctl is-active --quiet ${SERVICE_NAME}.service; then
  ok "${SERVICE_NAME}.service is running"
else
  systemctl status ${SERVICE_NAME}.service --no-pager | tail -10
  fail "Service failed to start — xem log: journalctl -u ${SERVICE_NAME} -n 50"
fi

# Smoke test: hit /api/health through localhost
if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  ok "Master /api/health OK"
else
  warn "Master /api/health không trả OK — xem log: journalctl -u ${SERVICE_NAME} -n 50"
fi

# ────────────────────────────────────────────────────────────────────────────
# Done
# ────────────────────────────────────────────────────────────────────────────
echo
printf "${C_BOLD}${C_GREEN}══════════════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_BOLD}${C_GREEN} ProxyBox Free — cài đặt hoàn tất${C_RESET}\n"
printf "${C_BOLD}${C_GREEN}══════════════════════════════════════════════════════════════${C_RESET}\n"
echo "  Panel URL:       ${PUBLIC_URL}"
echo "  Admin email:     ${ADMIN_EMAIL}"
echo "  Admin password:  ${ADMIN_PASSWORD}"
echo "  Service:         systemctl {status,restart,stop} ${SERVICE_NAME}"
echo "  Logs:            journalctl -u ${SERVICE_NAME} -f"
echo "  Install dir:     ${INSTALL_DIR}"
echo "  Config file:     ${INSTALL_DIR}/server/config.json"
echo
printf "${C_YELLOW}  ⚠️  Đổi mật khẩu admin ngay sau lần login đầu tiên.${C_RESET}\n"
echo
echo "  Cài agent lên VPS khác (cho customer / hub node):"
echo "    curl -fsSL ${PUBLIC_URL}/api/agent/install/<fleet-token> | sudo bash -s v4"
echo
echo "  Lệnh hữu ích:"
echo "    Restart      sudo systemctl restart ${SERVICE_NAME}"
echo "    Update SPA   cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} git pull && sudo -u ${SERVICE_USER} npm install && sudo -u ${SERVICE_USER} npm run build && sudo systemctl restart ${SERVICE_NAME}"
echo "    Re-seed      sudo ${INSTALL_DIR}/install.sh --force-reseed --domain ${DOMAIN} --yes"
echo
