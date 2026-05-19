# ProxyBox API

Base URL: the API server (`http://<host>:8787` by default; in production it also serves the dashboard).

## Authentication

Every `/api/*` endpoint requires **one** of:

- `Authorization: Bearer <token>` — token from `POST /api/auth/login` (valid 7 days, stored in memory).
- `X-API-Key: <api.apiKey>` — the static key from `server/config.json` (for machine-to-machine use).

Public exceptions (no auth): `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/register`.

Errors are `{ "error": "<message>" }` with the matching HTTP status (`401` unauthorized, `404` not found, `409` conflict, `400` bad request, `500` server error).

CORS: only origins listed in `api.corsOrigins` are allowed (production dashboard is same-origin, so usually empty).

---

## Auth

### `POST /api/auth/login`
Body: `{ "email": "...", "password": "..." }` → `200 { "token": "<hex64>", "user": { "name", "email" } }` · `401` on bad credentials.

### `POST /api/auth/register`
Body: `{ "name"?: "...", "email": "...", "password": "..." }` (password ≥ 6 chars) → `201 { "token", "user" }` · `409` if email exists. New users are stored with a `scrypt` password hash.

### `POST /api/auth/logout`
Invalidates the bearer token. → `200 { "ok": true }`.

### `GET /api/auth/me`
→ `200 { "name", "email" }` (bearer session) or `{ "authenticatedVia": "apiKey" }`.

---

## System

### `GET /api/health` *(public)*
→ `200 { "ok": true, "uptimeSeconds", "proxies", "activeListeners" }`.

### `GET /api/network`
The server's auto-detected addressing.
→ `200`:
```json
{
  "ipv4": [{ "iface": "eth0", "address": "192.0.2.1", "cidr": "192.0.2.0/24" }, ...],
  "ipv6": [{ "iface": "eth0", "address": "2602:f9ca:59f::1", "cidr": "2602:f9ca:59f::1/48" }, ...],
  "ipv6Prefixes": [{ "iface": "eth0", "prefix": "2602:f9ca:59f::", "prefixLen": 48, "cidr": "2602:f9ca:59f::/48" }],
  "ipv4PoolSize": 30,
  "ipv6PoolSize": 101
}
```
`ipv4`/`ipv6` are the addresses usable as proxy bind IPs (assigned to an interface). `ipv6Prefixes` is informational. Re-detected every 5 minutes.

### `GET /api/config`
→ `200 { "api": { "host", "port" }, "network", "proxyDefaults", "detected": <same as /api/network> }`.

### `GET /api/metrics`
Prometheus text exposition (`text/plain; version=0.0.4`): `proxyhub_uptime_seconds`, `proxyhub_proxies_total`, `proxyhub_listeners_active`, `proxyhub_dns_cache_entries`, and per-proxy `proxyhub_proxy_{upload,download,month}_bytes{id,type}`, `proxyhub_proxy_{total,active}_connections{id,type}`.

---

## Proxies

A proxy object (returned by `GET /api/proxies`, `publicProxy`):

| field | meaning |
| --- | --- |
| `id` | `px-<port>` |
| `name` | display name |
| `type` | `"IPv4"` or `"IPv6"` |
| `family` | `"ipv4"` / `"ipv6"` |
| `rotate` | `true` for a rotating IPv6 proxy |
| `mode` | `"sticky"` or `"rotating"` |
| `listenHost` | interface the proxy port listens on (`0.0.0.0` = all) |
| `ip` / `bindIp` | outbound source address (the **exit IP** for sticky proxies; the "current"/seed address for rotating ones) |
| `port` | listener port |
| `protocol` | `"HTTP/SOCKS5"` |
| `status` | `active` · `warning` · `expired` · `error` |
| `traffic` | human-readable up+down bytes |
| `maxConnections` | concurrent-connection cap (0 = unlimited) |
| `bytesPerSec` | per-second bandwidth cap, bytes (0 = unlimited; coarse per-second throttle) |
| `monthlyQuotaBytes` | monthly traffic cap, bytes (0 = unlimited; over-quota connections are refused) |
| `expires` | `YYYY-MM-DD` |
| `lastCheckedAt` | ISO timestamp of the last `/check` |
| `stats` | `{ uploadBytes, downloadBytes, monthBytes, activeConnections, totalConnections, lastResetAt }` |

> `GET /api/proxies` never includes `username`/`password`. Use `GET /api/proxies/:id/credentials`.

### `GET /api/proxies`
→ `200 [ <proxy>, ... ]`.

### `POST /api/proxies`
Create one proxy. Body (all optional):
```json
{
  "name": "Customer A",
  "type": "IPv4" | "IPv6",
  "rotate": true,            // IPv6 only — exit IP rotates per connection
  "bindIp": "192.0.2.5",  // pin a specific address (else auto-allocated from the pool)
  "port": 20010,             // else next free port from proxyDefaults.portStart
  "username": "...",         // else "user_<port>"
  "password": "...",         // else random
  "durationDays": 30,
  "maxConnections": 0,       // 0 = unlimited
  "bytesPerSec": 0,          // 0 = unlimited
  "monthlyQuotaBytes": 0     // 0 = unlimited
}
```
→ `201 { ...<proxy>, "username", "password" }` (credentials returned **only** on create). The listener opens before the response returns.

### `POST /api/orders`
Create many proxies + an order record. Body:
```json
{ "type": "IPv4" | "IPv6", "rotate": true, "quantity": 50, "duration": 30, "amount": 135 }
```
`quantity` clamped to 1–254. → `201 { "order": {...}, "proxies": [ {...<proxy>, "username", "password"}, ... ] }`.

### `GET /api/proxies/:id/credentials`
→ `200 { "username", "password", "mode", "endpoint": "<ip>:<port>", "http": "http://user:pass@ip:port", "socks5": "socks5://user:pass@ip:port" }`.

### `GET /api/proxies/:id/stats`
→ `200 { uploadBytes, downloadBytes, activeConnections, totalConnections, lastResetAt }`.

### `POST /api/proxies/:id/check`
Health-checks the proxy by making an outbound HTTP request through its own egress path (same bindIp / family / rotation logic) to an echo endpoint. Updates `latency` and `lastCheckedAt`; if it succeeds and the proxy was `error`, status becomes `active`.
→ `200 { "proxy": <proxy>, "ok": true, "latencyMs": 142, "exitIp": "192.0.2.5", "error": null }`.

### `POST /api/proxies/:id/reset`
Clears traffic counters and sets status back to `active` (unless expired). → `200 <proxy>`.

### `POST /api/proxies/:id/rotate`
Assigns a new random `bindIp` from the same-family pool (rotate the exit IP now). → `200 <proxy>` · `409` if no usable address.

### `POST /api/proxies/:id/renew`
Body: `{ "days": 30 }` → extends `expires`, status `active`. → `200 <proxy>`.

### `PATCH /api/proxies/:id`
Body (any subset): `{ "name", "rotate", "durationDays", "maxConnections", "bytesPerSec", "monthlyQuotaBytes" }`. `rotate` only takes effect for IPv6 proxies. → `200 <proxy>`.

### `DELETE /api/proxies/:id`
Stops the listener and removes the proxy. → `200 { "ok": true, "id" }`.

---

## Orders

### `GET /api/orders`
→ `200 [ { "id": "ORD-...", "item", "amount", "status", "date", "proxyIds": [...] }, ... ]` (persisted to `server/orders.json`).

---

## Using a proxy

The proxy supports HTTP, HTTPS (`CONNECT`), and SOCKS5 — all with the proxy's own username/password.

```bash
# IPv4 proxy — exits via its bindIp
curl -x http://user_20010:PASS@SERVER:20010 https://api.ipify.org      # -> the bindIp
curl --socks5 user_20010:PASS@SERVER:20010 https://api.ipify.org

# IPv6 proxy — connect over IPv4, exit is IPv6-only (no IPv4 fallback)
curl -x http://user_20011:PASS@SERVER:20011 https://api64.ipify.org    # -> an IPv6 address
# if "rotate" is on, repeat the call -> a different IPv6 each time
```

Family is strict: an IPv4 proxy only resolves/connects A records; an IPv6 proxy only AAAA records (a target with no IPv6 → `502`). Targets pointing at the server's own / private / link-local / cloud-metadata ranges are blocked unless `proxyDefaults.allowPrivateTargets` is `true`.
