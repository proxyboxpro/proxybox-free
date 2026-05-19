#!/usr/bin/env node
// Seed a brand-new ProxyBox installation. Creates:
//   server/master.key          — 32-byte AES-256-GCM key (mode 600)
//   server/config.json         — minimal config + admin@admin.com user
//   server/orders.json         — empty array
//
// Idempotent: if config.json already exists this script bails so it never
// overwrites a running deployment. Pass --force to recreate from scratch
// (DESTRUCTIVE — wipes all users + nodes + proxies).

import crypto from 'node:crypto'
import { existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const ROOT = path.resolve(SCRIPT_DIR, '..')
const SERVER = path.join(ROOT, 'server')

const force = process.argv.includes('--force')
const cfgPath  = path.join(SERVER, 'config.json')
const ordPath  = path.join(SERVER, 'orders.json')
const keyPath  = path.join(SERVER, 'master.key')

if (!force && existsSync(cfgPath)) {
  console.log(`[seed] config.json already exists at ${cfgPath} — refusing to overwrite. Pass --force to wipe.`)
  process.exit(0)
}

mkdirSync(SERVER, { recursive: true })

// 1) master.key — 32 bytes random, mode 600
if (force || !existsSync(keyPath)) {
  writeFileSync(keyPath, crypto.randomBytes(32))
  chmodSync(keyPath, 0o600)
  console.log(`[seed] wrote ${keyPath} (mode 600, 32 bytes)`)
}

// 2) Default admin user (admin@admin.com / admin). Operator MUST change pw on first login.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}
function makeUserId() { return 'u-' + crypto.randomBytes(5).toString('base64url').toLowerCase() }
function makeApiKey(uid) { return `usr_${uid.replace(/[^a-z0-9]/gi, '')}_${crypto.randomBytes(20).toString('hex')}` }

const adminId = 'u-admin'
const apiKey = makeApiKey(adminId)
const adminEmail = process.env.PROXYHUB_ADMIN_EMAIL || 'admin@admin.com'
const adminPw    = process.env.PROXYHUB_ADMIN_PASSWORD || 'admin'

const config = {
  api: {
    host: '127.0.0.1',
    port: 8787,
    apiKey: crypto.randomBytes(24).toString('hex'),
    fleetEnrollToken: crypto.randomBytes(24).toString('hex'),
    publicUrl: process.env.PROXYHUB_PUBLIC_URL || '',
    corsOrigins: process.env.PROXYHUB_PUBLIC_URL ? [process.env.PROXYHUB_PUBLIC_URL] : [],
    zone: process.env.PROXYHUB_ZONE || 'vn-hcm',
    mtlsHost: '0.0.0.0'
  },
  network: { interface: 'eth0', extraIPv4: [], extraIPv6: [] },
  proxyDefaults: {
    listenHost: '0.0.0.0',
    portStart: 20000,
    expiresDays: 30,
    allowPrivateTargets: false,
    region: process.env.PROXYHUB_REGION || 'VN',
    maxConnsPerProxy: 100,
    maxConnsPerSrcIp: 60,
    newConnsPerSecPerIp: 30
  },
  users: [{
    id: adminId,
    name: 'Administrator',
    email: adminEmail.toLowerCase(),
    passwordHash: hashPassword(adminPw),
    role: 'admin',
    apiKey,
    referralCode: crypto.randomBytes(4).toString('hex'),
    referredBy: null,
    tosAcceptedAt: new Date().toISOString(),
    emailVerified: true,
    forcePasswordChange: false
  }],
  proxies: [],
  nodes: [],
  hubPlans: [],
  virtualizors: [],
  zones: [
    { id: 'vn-hcm', name: 'Vietnam · Ho Chi Minh', flag: 'VN', timezone: 'Asia/Ho_Chi_Minh' }
  ],
  pricing: {
    currency: 'VND',
    ipv4: { perHour: 100 },
    ipv6: { perHour: 50 },
    minHours: 1, maxHours: 8760,
    tiers: [
      { min: 10, discount: 0.05 },
      { min: 50, discount: 0.10 },
      { min: 100, discount: 0.15 }
    ]
  },
  coupons: [],
  features: {
    oauth: false,
    affiliate: false,
    totp: true,
    billing: true,
    customerWebhook: false,
    autoRenew: true,
    ipWhitelist: true,
    stickySession: true,
    registration: true
  },
  operations: {
    sweepExpiredIntervalMin: 5,
    sweepAutoRotateIntervalSec: 60,
    nodeAutoDisableAfterMin: 10
  },
  alerts: {},
  announcements: []
}

writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n')
chmodSync(cfgPath, 0o600)
writeFileSync(ordPath, '[]\n')
chmodSync(ordPath, 0o600)

console.log(`[seed] wrote ${cfgPath}`)
console.log(`[seed] wrote ${ordPath}`)
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(' ProxyBox Free — seeded successfully')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  Admin email:    ${adminEmail}`)
console.log(`  Admin password: ${adminPw}`)
console.log(`  Admin API key:  ${apiKey}`)
console.log(`  Master API key: ${config.api.apiKey}`)
console.log('')
console.log('  ⚠️  CHANGE the admin password immediately after first login.')
console.log('═══════════════════════════════════════════════════════════════')
