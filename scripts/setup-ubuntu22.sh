#!/usr/bin/env bash
set -euo pipefail

IFACE="${IFACE:-ens18}"
SUBNET_CIDR="${SUBNET_CIDR:-103.10.20.0/24}"
FIRST_HOST="${FIRST_HOST:-10}"
LAST_HOST="${LAST_HOST:-254}"
ADDR_PREFIX="${ADDR_PREFIX:-32}"
# Optional: a routed IPv6 prefix (e.g. 2401:abcd:1234:5678::/64). When set, the
# whole prefix is marked local so the backend can bind any address inside it.
IPV6_PREFIX="${IPV6_PREFIX:-}"
APP_DIR="${APP_DIR:-/opt/proxyhub}"
SERVICE_USER="${SERVICE_USER:-proxyhub}"
NODE_MAJOR="${NODE_MAJOR:-22}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo IFACE=ens18 SUBNET_CIDR=103.x.x.0/24 bash scripts/setup-ubuntu22.sh"
  exit 1
fi

NETWORK="${SUBNET_CIDR%/*}"
BASE="${NETWORK%.*}"

echo "[1/6] Installing runtime packages"
apt-get update
apt-get install -y ca-certificates curl gnupg
if ! command -v node >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

echo "[2/6] Creating service user"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
mkdir -p "${APP_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

echo "[3/6] Applying kernel tuning"
cat >/etc/sysctl.d/99-proxyhub.conf <<SYSCTL
# connection / backlog limits
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 250000
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_fastopen = 3
net.ipv4.ip_nonlocal_bind = 1
net.ipv6.ip_nonlocal_bind = 1
fs.file-max = 10000000
# high-throughput: BBR + fair queueing + large socket buffers
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 131072 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_slow_start_after_idle = 0
SYSCTL
sysctl --system >/dev/null 2>&1 || true
modprobe tcp_bbr 2>/dev/null || true

cat >/etc/security/limits.d/proxyhub.conf <<LIMITS
${SERVICE_USER} soft nofile 1048576
${SERVICE_USER} hard nofile 1048576
root soft nofile 1048576
root hard nofile 1048576
LIMITS

echo "[4/6] Installing subnet apply script"
cat >/usr/local/bin/proxyhub-ips.sh <<IPS
#!/usr/bin/env bash
set -euo pipefail
IFACE="${IFACE}"
BASE="${BASE}"
FIRST_HOST="${FIRST_HOST}"
LAST_HOST="${LAST_HOST}"
ADDR_PREFIX="${ADDR_PREFIX}"
IPV6_PREFIX="${IPV6_PREFIX}"
for host in \$(seq "\${FIRST_HOST}" "\${LAST_HOST}"); do
  ip="\${BASE}.\${host}"
  if ! ip addr show dev "\${IFACE}" | grep -qw "\${ip}/${ADDR_PREFIX}"; then
    ip addr add "\${ip}/${ADDR_PREFIX}" dev "\${IFACE}" || true
  fi
done
if [ -n "\${IPV6_PREFIX}" ]; then
  ip -6 route replace local "\${IPV6_PREFIX}" dev "\${IFACE}" || true
fi
IPS
chmod +x /usr/local/bin/proxyhub-ips.sh

cat >/etc/systemd/system/proxyhub-ips.service <<UNIT
[Unit]
Description=ProxyBox routed subnet IP aliases
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/proxyhub-ips.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now proxyhub-ips.service

echo "[5/6] Installing ProxyBox service"
cat >/etc/systemd/system/proxyhub.service <<UNIT
[Unit]
Description=ProxyBox API and proxy engine
After=network-online.target proxyhub-ips.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PROXY_CONFIG=${APP_DIR}/server/config.json
Environment=UV_THREADPOOL_SIZE=64
ExecStart=/usr/bin/node ${APP_DIR}/server/index.js
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable proxyhub.service

echo "[6/6] Done"
echo "Copy this project to ${APP_DIR}, run npm install && npm run build, then:"
echo "  sudo systemctl restart proxyhub"
echo "  sudo journalctl -u proxyhub -f"
