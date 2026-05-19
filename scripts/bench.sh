#!/usr/bin/env bash
# Stress / throughput probe for ProxyBox proxies. Picks N active proxies, pumps
# K parallel downloads through each, measures total throughput and per-proxy
# Mbps. Designed to verify the 5-10 Gbps roadmap claim and surface limit issues
# (per-src cap, monthly quota, bytes/sec cap, etc).
#
# Usage:
#   API_KEY=xyz ./scripts/bench.sh                              # 5 proxies × 3 streams × 50MB
#   API_KEY=xyz N=20 K=5 SIZE_MB=100 ./scripts/bench.sh
#   API_KEY=xyz NODE_ID=node-abc ./scripts/bench.sh             # only proxies on that node
#
# Requires: bash, curl, python3.

set -uo pipefail

CONTROL="${CONTROL:-http://127.0.0.1:8787}"
if [[ -z "${API_KEY:-}" ]] && [[ -r /opt/proxyhub/server/config.json ]]; then
  API_KEY="$(python3 -c 'import json;print(json.load(open("/opt/proxyhub/server/config.json"))["api"]["apiKey"])' 2>/dev/null || true)"
fi
[[ -z "${API_KEY:-}" ]] && { echo "API_KEY required" >&2; exit 1; }

N="${N:-5}"           # number of proxies to test
K="${K:-3}"           # parallel streams per proxy
SIZE_MB="${SIZE_MB:-50}"
NODE_ID="${NODE_ID:-}"
URL="http://speed.cloudflare.com/__down?bytes=$((SIZE_MB * 1000 * 1000))"

echo "── ProxyBox bench: N=$N proxies × K=$K streams × ${SIZE_MB}MB ──"

# pick proxies (filter by node + status=active)
LIST=$(curl -sS -H "X-API-Key: $API_KEY" "$CONTROL/api/proxies" | python3 -c "
import json,sys
ps=json.load(sys.stdin)
node='$NODE_ID'
active=[p for p in ps if p.get('status')=='active' and (not node or p.get('nodeId')==node)]
for p in active[:$N]:
    cred=p['username']+':'+p['password']
    print(f\"{p['id']} http://{cred}@{p['bindIp']}:{p['port']}\")
")
COUNT=$(echo "$LIST" | wc -l)
if [[ -z "$LIST" || "$COUNT" -eq 0 ]]; then
  echo "no active proxies matched (N=$N, NODE_ID=$NODE_ID)" >&2; exit 1
fi
echo "selected $COUNT proxies"

START=$(date +%s.%N)
PIDS=()
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

I=0
while IFS=' ' read -r ID PURL; do
  for k in $(seq 1 "$K"); do
    OUT="$TMP/${ID}-${k}.size"
    (
      RES=$(curl -sS --max-time 60 --proxy "$PURL" -w '%{size_download} %{time_total}' -o /dev/null "$URL" || echo "0 0")
      echo "$RES" > "$OUT"
    ) &
    PIDS+=("$!")
  done
  I=$((I + 1))
done <<< "$LIST"

# wait all
for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
END=$(date +%s.%N)

# tally
TOTAL_BYTES=0
TOTAL_TIME=0
for f in "$TMP"/*.size; do
  read -r B T < "$f"
  TOTAL_BYTES=$((TOTAL_BYTES + B))
  TOTAL_TIME=$(python3 -c "print($TOTAL_TIME + $T)")
done
WALL=$(python3 -c "print($END - $START)")
MBPS_WALL=$(python3 -c "print(round($TOTAL_BYTES * 8 / 1000000 / $WALL, 1))")
MBPS_AVG=$(python3 -c "
ts=$TOTAL_TIME
n=$(ls $TMP/*.size 2>/dev/null | wc -l)
if n>0 and ts>0: print(round($TOTAL_BYTES * 8 / 1000000 / (ts/n), 1))
else: print(0)
")
echo
echo "  total bytes:   $(python3 -c "print(round($TOTAL_BYTES / 1024 / 1024, 1))") MB"
echo "  wall clock:    ${WALL}s"
echo "  aggregate:     ${MBPS_WALL} Mbps"
echo "  per-stream avg ${MBPS_AVG} Mbps"
