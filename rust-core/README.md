# proxyhub-core — Rust + Tokio proxy agent

A from-scratch, async proxy engine in **Rust + Tokio**, the start of Phase 3 of `Proxy.md`. It is a **drop-in replacement for the Node agent** (`server/agent.js`): same control-plane protocol (`/api/agent/{enroll, register, heartbeat, proxies}` over HTTP + bearer), same config file (`/etc/proxyhub-agent.json`), same systemd unit semantics.

## What it does

- Listens for the proxies the control plane assigns to this node.
- Each proxy speaks **SOCKS5** (username/password) and **HTTP / HTTPS CONNECT** (Basic auth) on its port.
- **Per-proxy outbound bind IP** via `TcpSocket::bind`.
- **Family-strict egress**: an `IPv4` proxy resolves A only, `IPv6` resolves AAAA only.
- **SSRF block**: loopback / RFC1918 / link-local / CGNAT / cloud-metadata / multicast.
- Bidirectional `copy_bidirectional` relay.
- Reconciles every 10 s, heartbeats every 20 s.
- Reports the node's auto-detected IPv4/IPv6 (`if-addrs`) to the control plane.

## Status / scope (v0.1)

- Drop-in for the Node agent over **HTTP + bearer token**. mTLS for the agent channel (matching the Node agent's `/api/agent/*` on `:8788`) is **next** — `reqwest` will be configured with `Identity::from_pem(...)` and the CA verified against `caCert`.
- Stats reporting (upload/download/conns per proxy) **not yet wired** — the agent reports `stats: {}` in heartbeat for now. Adding it is a small `AtomicU64` per proxy + `copy_bidirectional` wrapper.
- IPv6 rotation, per-proxy bandwidth/connection limits, monthly quota: **not yet** (the Node agent has them; same shape will be ported).
- No `SO_REUSEPORT` yet (single accept loop per proxy — Phase 2 multiplies that across cores).

## Build

```bash
# install rustup if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
. "$HOME/.cargo/env"

cd rust-core
cargo build --release
# binary: target/release/proxyhub-agent
```

Cross-compile to a target architecture (e.g. for an `x86_64-unknown-linux-musl` static binary) with `cargo build --release --target x86_64-unknown-linux-musl` (needs `rustup target add x86_64-unknown-linux-musl` and `musl-tools`).

## Run / deploy

Drop the binary in place of the Node agent on a node:

```bash
# stop the Node agent
sudo systemctl stop proxyhub-agent

# replace the binary; keep /etc/proxyhub-agent.json and the systemd unit
sudo install -m 0755 target/release/proxyhub-agent /opt/proxyhub-agent/proxyhub-agent

# patch the unit to exec the Rust binary instead of `node agent.js`
sudo systemctl edit --full proxyhub-agent
#   ExecStartPre=
#   ExecStart=/opt/proxyhub-agent/proxyhub-agent

sudo systemctl daemon-reload
sudo systemctl start proxyhub-agent
journalctl -u proxyhub-agent -f
```

The same `/etc/proxyhub-agent.json` (containing `controlUrl` + `token` + `enrollToken`) works unchanged. The control plane sees the node come back online and resumes assigning proxies — clients won't notice the swap.

## What's next (Phase 3 step 2)

- mTLS client (`reqwest::Identity` from `clientCert` + `clientKey`, root store = `caCert`).
- Per-proxy stats (atomic counters) + report in heartbeat.
- IPv6 rotation + per-proxy limits (parity with the Node agent).
- `SO_REUSEPORT` accept fan-out (Phase 2).
- Optional: replace tokio's resolver with `hickory-resolver` for a shared async DNS cache.
