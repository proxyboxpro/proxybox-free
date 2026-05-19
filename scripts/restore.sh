#!/usr/bin/env bash
# Restore a ProxyBox snapshot produced by scripts/backup.sh. Decrypts the
# tarball with the supplied passphrase and writes files BACK into /opt/proxyhub-free.
# WARNING: this overwrites the live config.json, master.key, and PKI. Stop the
# service first if you want a clean state. The script makes a `.bak.<stamp>`
# copy of every file it touches.
#
# Usage:
#   sudo BACKUP_PASS=secret bash /opt/proxyhub-free/scripts/restore.sh /var/backups/proxyhub/proxyhub-XXXX.tar.gz.enc
#
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi

SRC="${1:-}"
APP_DIR="${APP_DIR:-/opt/proxyhub-free}"
[[ -f "$SRC" ]] || { echo "usage: $0 <encrypted-tarball>" >&2; exit 1; }

PASS="${BACKUP_PASS:-}"
if [[ -z "$PASS" ]]; then
  read -r -s -p "decryption passphrase: " PASS; echo
fi
export PASS

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass env:PASS -in "$SRC" \
  | tar -xzf - -C "$STAGE"

STAMP=$(date +%Y%m%d-%H%M%S)
for rel in server/config.json server/orders.json server/master.key server/audit.log; do
  if [[ -f "$STAGE/$rel" ]]; then
    if [[ -e "$APP_DIR/$rel" ]]; then cp -a "$APP_DIR/$rel" "$APP_DIR/$rel.bak.$STAMP"; fi
    install -m 600 "$STAGE/$rel" "$APP_DIR/$rel"
    echo "restored $rel"
  fi
done
if [[ -d "$STAGE/server/pki" ]]; then
  if [[ -d "$APP_DIR/server/pki" ]]; then mv "$APP_DIR/server/pki" "$APP_DIR/server/pki.bak.$STAMP"; fi
  cp -a "$STAGE/server/pki" "$APP_DIR/server/pki"
  chmod 700 "$APP_DIR/server/pki"
  echo "restored server/pki"
fi

chown -R proxyhub:proxyhub "$APP_DIR/server" 2>/dev/null || true
echo "restore complete; restart with: systemctl restart proxyhub"
