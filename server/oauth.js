// OAuth 2.0 integration (Google + GitHub). Zero-dep — raw HTTPS calls.
//
// Flow:
//   1. GET  /api/auth/oauth/:provider/start
//        → 302 to provider's consent screen with state + nonce in cookie
//   2. provider → GET /api/auth/oauth/:provider/callback?code=...&state=...
//        → exchange code for access token
//        → fetch /userinfo (Google) or /user (GitHub)
//        → find-or-create local user, issue session
//        → 302 to /dashboard (or /customer/dashboard for customer role)
//
// Config (in config.json, under config.oauth):
//   google: { clientId, clientSecret, callbackUrl }
//   github: { clientId, clientSecret, callbackUrl }
//
// Account linking: if local user with same email exists, link OAuth identity to
// that account; otherwise create new customer (role='customer', plan='free').

import crypto from 'node:crypto'
import https from 'node:https'

const PROVIDERS = {
  google: {
    authUrl:    'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:   'https://oauth2.googleapis.com/token',
    userInfoUrl:'https://openidconnect.googleapis.com/v1/userinfo',
    scope:      'openid email profile',
    parseUser:  (u) => ({ email: u.email, name: u.name || u.email, sub: u.sub, verified: u.email_verified })
  },
  github: {
    authUrl:    'https://github.com/login/oauth/authorize',
    tokenUrl:   'https://github.com/login/oauth/access_token',
    userInfoUrl:'https://api.github.com/user',
    userEmailsUrl:'https://api.github.com/user/emails',
    scope:      'read:user user:email',
    parseUser:  (u, emails) => ({
      email: u.email || (Array.isArray(emails) ? (emails.find((e) => e.primary && e.verified) || emails[0])?.email : ''),
      name:  u.name || u.login || `gh-${u.id}`,
      sub:   String(u.id),
      verified: Array.isArray(emails) ? Boolean((emails.find((e) => e.primary)?.verified)) : false
    })
  }
}

// Pending state map — short-lived, in-memory. State token correlates the
// initial /start call with the /callback redirect to defeat CSRF.
const pending = new Map() // state -> { provider, createdAt, returnUrl }
const PENDING_TTL_MS = 10 * 60_000

function httpsRequest({ method = 'GET', url, body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'ProxyBox-OAuth',
        ...headers
      }
    }
    const req = https.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* leave text as raw */ }
        resolve({ status: res.statusCode, headers: res.headers, body: json || text })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export function setupOauthRoutes({ getConfig, createOrLinkUser, createSession, audit, clientIp, isFeatureEnabled }) {
  return {
    // GET /api/auth/oauth/:provider/start
    async handleStart(req, res, url, provider) {
      if (!isFeatureEnabled('oauth')) return sendStatus(res, 403, 'oauth disabled')
      const cfg = getConfig().oauth?.[provider]
      if (!cfg?.clientId) return sendStatus(res, 503, `oauth.${provider}.clientId not configured`)
      const def = PROVIDERS[provider]
      if (!def) return sendStatus(res, 404, 'unknown oauth provider')
      const state = crypto.randomBytes(16).toString('hex')
      pending.set(state, { provider, createdAt: Date.now(), returnUrl: url.searchParams.get('returnUrl') || '/dashboard' })
      cleanupPending()
      const authUrl = new URL(def.authUrl)
      authUrl.searchParams.set('client_id', cfg.clientId)
      authUrl.searchParams.set('redirect_uri', cfg.callbackUrl)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', def.scope)
      authUrl.searchParams.set('state', state)
      audit({ actor: 'anon', ip: clientIp(req), method: 'GET', path: url.pathname, note: `start oauth ${provider}` })
      res.writeHead(302, { 'Location': authUrl.toString() })
      res.end()
    },

    // GET /api/auth/oauth/:provider/callback
    async handleCallback(req, res, url, provider) {
      if (!isFeatureEnabled('oauth')) return sendStatus(res, 403, 'oauth disabled')
      const cfg = getConfig().oauth?.[provider]
      if (!cfg?.clientId) return sendStatus(res, 503, `oauth.${provider} not configured`)
      const def = PROVIDERS[provider]
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const tracked = pending.get(state)
      if (!code || !state || !tracked || tracked.provider !== provider) {
        return sendStatus(res, 400, 'invalid oauth state or code')
      }
      pending.delete(state)

      try {
        // Exchange authorization code for access token.
        const tokenForm = new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: cfg.callbackUrl,
          grant_type: 'authorization_code'
        }).toString()
        const tokenResp = await httpsRequest({
          method: 'POST',
          url: def.tokenUrl,
          body: tokenForm,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
        })
        if (tokenResp.status >= 400 || !tokenResp.body?.access_token) {
          return sendStatus(res, 502, `oauth token exchange failed: ${JSON.stringify(tokenResp.body).slice(0, 200)}`)
        }
        const accessToken = tokenResp.body.access_token

        // Fetch profile.
        const profileResp = await httpsRequest({
          url: def.userInfoUrl,
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
        })
        if (profileResp.status >= 400) return sendStatus(res, 502, `oauth userinfo failed: ${profileResp.status}`)

        let emails = null
        if (def.userEmailsUrl) {
          const er = await httpsRequest({
            url: def.userEmailsUrl,
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
          })
          if (Array.isArray(er.body)) emails = er.body
        }

        const parsed = def.parseUser(profileResp.body, emails)
        if (!parsed.email) return sendStatus(res, 400, 'oauth profile missing email')

        const user = await createOrLinkUser({
          email: parsed.email,
          name: parsed.name,
          oauthProvider: provider,
          oauthSub: parsed.sub,
          ip: clientIp(req)
        })
        const sessionToken = createSession(user)
        audit({ actor: parsed.email, ip: clientIp(req), method: 'GET', path: url.pathname, note: `oauth ${provider} success` })
        const dest = user.role === 'customer' ? 'customer-dashboard' : 'dashboard'
        // Redirect to /login (where AuthView is mounted) carrying token + dest.
        // AuthView's onMounted hook saves the token then router-pushes to dest.
        res.writeHead(302, { 'Location': `/login?oauth_token=${encodeURIComponent(sessionToken)}&dest=${dest}` })
        res.end()
      } catch (e) {
        return sendStatus(res, 500, `oauth error: ${e.message}`)
      }
    }
  }
}

function cleanupPending() {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.createdAt > PENDING_TTL_MS) pending.delete(k)
}

function sendStatus(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text + '\n')
}
