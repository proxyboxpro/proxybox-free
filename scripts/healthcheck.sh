#!/usr/bin/env bash
# Single-shot health probe for ProxyBox. Suitable for cron / external monitor.
#   - hits /api/health (control plane up?)
#   - lists /api/nodes (counts online / offline / total)
#   - exits non-zero (1) on any failure so cron-mail / Telegram alerts fire
#
# Usage:
#   API_KEY=xyz ./scripts/healthcheck.sh                          # localhost:8787
#   API_KEY=xyz CONTROL=https://hub.example.com ./scripts/healthcheck.sh
#
# Reads API_KEY from $API_KEY or /opt/proxyhub/server/config.json. Output is one
# line — green when healthy, red when not — so the cron mailer is succinct.

set -uo pipefail

CONTROL="${CONTROL:-http://127.0.0.1:8787}"
if [[ -z "${API_KEY:-}" ]] && [[ -r /opt/proxyhub/server/config.json ]]; then
  API_KEY="$(python3 -c 'import json;print(json.load(open("/opt/proxyhub/server/config.json"))["api"]["apiKey"])' 2>/dev/null || true)"
fi

PASS=true
DETAIL=()

# 1. control plane responding
H=$(curl -sS -m 5 -H "X-API-Key: ${API_KEY:-}" "$CONTROL/api/health" 2>&1 || true)
if echo "$H" | grep -q '"ok":true'; then
  UP=$(echo "$H" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("uptimeSeconds",0))')
  DETAIL+=("control: up uptime=${UP}s")
else
  PASS=false; DETAIL+=("control: DOWN")
fi

# 2. node fleet roll-call
N=$(curl -sS -m 5 -H "X-API-Key: ${API_KEY:-}" "$CONTROL/api/nodes" 2>&1 || true)
if echo "$N" | python3 -c 'import json,sys;json.load(sys.stdin)' >/dev/null 2>&1; then
  COUNTS=$(echo "$N" | python3 -c '
import json,sys
ns=json.load(sys.stdin)
tot=len(ns); on=sum(1 for n in ns if n.get("status")=="online")
off=sum(1 for n in ns if n.get("status")=="offline")
print(f"{on}/{tot} online ({off} offline)")')
  DETAIL+=("nodes: $COUNTS")
  # any offline triggers a soft fail (exit 2 = warning)
  if echo "$N" | python3 -c 'import json,sys
for n in json.load(sys.stdin):
  if n.get("status")=="offline": sys.exit(1)' 2>/dev/null; then :; else WARN=1; fi
else
  PASS=false; DETAIL+=("nodes: query failed")
fi

# 3. mTLS listener (when configured)
if [[ "$CONTROL" == http://* ]]; then
  if curl -sSk -m 3 "${CONTROL/http:/https:}:8788/" >/dev/null 2>&1 || curl -sSk -m 3 "${CONTROL%:8787}:8788/" >/dev/null 2>&1; then
    DETAIL+=("mtls: reachable")
  fi
fi

LINE="$(IFS=' | '; echo "${DETAIL[*]}")"
if [[ "$PASS" == true ]]; then
  echo "[OK] $LINE"
  exit "${WARN:-0}"
else
  echo "[FAIL] $LINE" >&2
  exit 1
fi
