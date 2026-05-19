#!/usr/bin/env bash
# Encrypted snapshot of the ProxyBox control-plane state. Captures:
#   /opt/proxyhub-free/server/config.json   (proxies, users, nodes, apiKey)
#   /opt/proxyhub-free/server/orders.json
#   /opt/proxyhub-free/server/master.key    (AES-256 secret used to encrypt SSH creds)
#   /opt/proxyhub-free/server/pki/          (CA + server cert for mTLS agent channel)
#   /opt/proxyhub-free/server/audit.log     (optional)
#
# Output is an AES-256-CBC encrypted tarball; passphrase comes from $BACKUP_PASS
# or is prompted. Use scripts/restore.sh to roll it back.
#
# Usage:
#   sudo BACKUP_PASS=secret /opt/proxyhub-free/scripts/backup.sh /var/backups/proxyhub
#
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi

OUT_DIR="${1:-/var/backups/proxyhub}"
APP_DIR="${APP_DIR:-/opt/proxyhub-free}"
mkdir -p "$OUT_DIR"

STAMP=$(date +%Y%m%d-%H%M%S)
TARGET="$OUT_DIR/proxyhub-${STAMP}.tar.gz.enc"
SRC=()
for f in server/config.json server/orders.json server/master.key server/audit.log; do
  if [[ -e "$APP_DIR/$f" ]]; then SRC+=("$f"); fi
done
if [[ -d "$APP_DIR/server/pki" ]]; then SRC+=("server/pki"); fi

if [[ "${#SRC[@]}" -eq 0 ]]; then
  echo "nothing to back up under $APP_DIR" >&2
  exit 1
fi

PASS="${BACKUP_PASS:-}"
if [[ -z "$PASS" ]]; then
  read -r -s -p "encryption passphrase: " PASS; echo
  read -r -s -p "confirm passphrase:    " PASS2; echo
  if [[ "$PASS" != "$PASS2" ]]; then echo "passphrase mismatch" >&2; exit 1; fi
fi
export PASS

cd "$APP_DIR"
tar czf - "${SRC[@]}" | \
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass env:PASS -out "$TARGET"
chmod 600 "$TARGET"

echo "wrote $TARGET ($(du -h "$TARGET" | cut -f1))"
echo "to restore: BACKUP_PASS=... bash scripts/restore.sh $TARGET"
