import { reactive } from 'vue'
import { apiFetch } from '../api'
import { demoOrders, demoProxies } from '../data/catalog'

export const proxyState = reactive({
  proxies: demoProxies.map(normalizeProxy),
  orders: [...demoOrders],
  network: null,
  apiReady: false,
  apiError: ''
})

export function normalizeProxy(proxy) {
  return {
    id: proxy.id,
    name: proxy.name,
    type: proxy.type || 'IPv4',
    ip: proxy.ip || proxy.bindIp,
    bindIp: proxy.bindIp || proxy.ip,
    port: proxy.port,
    protocol: proxy.protocol || 'HTTP/SOCKS5',
    region: proxy.region || 'AUTO',
    city: proxy.city || 'Auto',
    status: proxy.status || 'active',
    latency: proxy.latency || 0,
    traffic: proxy.traffic || '0 B',
    expires: proxy.expires,
    folder: proxy.folder || proxy.type?.toLowerCase() || 'active',
    username: proxy.username,
    password: proxy.password,
    stats: proxy.stats || null
  }
}

export async function loadBackendData() {
  try {
    const [proxyRows, orderRows, network] = await Promise.all([
      apiFetch('/api/proxies'),
      apiFetch('/api/orders').catch(() => []),
      apiFetch('/api/network').catch(() => null)
    ])
    if (Array.isArray(proxyRows)) {
      proxyState.proxies = proxyRows.length > 0 ? proxyRows.map(normalizeProxy) : []
    }
    if (Array.isArray(orderRows) && orderRows.length > 0) proxyState.orders = orderRows
    proxyState.network = network
    proxyState.apiReady = true
    proxyState.apiError = ''
  } catch (error) {
    proxyState.apiReady = false
    proxyState.apiError = error.message
  }
}

export function replaceProxy(updated) {
  const normalized = normalizeProxy(updated)
  const index = proxyState.proxies.findIndex((item) => item.id === normalized.id)
  if (index === -1) proxyState.proxies.unshift(normalized)
  else proxyState.proxies[index] = { ...proxyState.proxies[index], ...normalized }
  return normalized
}

export function removeProxy(id) {
  const index = proxyState.proxies.findIndex((item) => item.id === id)
  if (index !== -1) proxyState.proxies.splice(index, 1)
}

export async function resetProxy(id) {
  const proxy = proxyState.proxies.find((item) => item.id === id)
  if (!proxy) return
  try {
    replaceProxy(await apiFetch(`/api/proxies/${id}/reset`, { method: 'POST' }))
  } catch {
    proxy.latency = Math.max(18, (proxy.latency || 30) - 7)
    if (proxy.status !== 'expired') proxy.status = 'active'
  }
}

export async function renewProxy(id, days = 30) {
  const proxy = proxyState.proxies.find((item) => item.id === id)
  if (!proxy) return
  try {
    replaceProxy(await apiFetch(`/api/proxies/${id}/renew`, { method: 'POST', body: { days } }))
  } catch {
    const date = new Date()
    date.setDate(date.getDate() + days)
    proxy.expires = date.toISOString().slice(0, 10)
    proxy.status = 'active'
  }
}

export async function fetchCredentials(id) {
  const local = proxyState.proxies.find((item) => item.id === id)
  try {
    return await apiFetch(`/api/proxies/${id}/credentials`)
  } catch {
    if (local?.username) {
      return {
        username: local.username,
        password: local.password,
        endpoint: `${local.ip}:${local.port}`,
        http: `http://${local.username}:${local.password}@${local.ip}:${local.port}`,
        socks5: `socks5://${local.username}:${local.password}@${local.ip}:${local.port}`
      }
    }
    return null
  }
}

export async function createProxyOrder(payload) {
  const result = await apiFetch('/api/orders', { method: 'POST', body: payload })
  if (result.order) proxyState.orders.unshift(result.order)
  if (Array.isArray(result.proxies)) {
    for (const proxy of result.proxies) replaceProxy(proxy)
  }
  return result
}

export async function rotateProxyIp(id) {
  return replaceProxy(await apiFetch(`/api/proxies/${id}/rotate`, { method: 'POST' }))
}

export async function patchProxy(id, body) {
  return replaceProxy(await apiFetch(`/api/proxies/${id}`, { method: 'PATCH', body }))
}

export async function deleteProxy(id) {
  await apiFetch(`/api/proxies/${id}`, { method: 'DELETE' })
  removeProxy(id)
}

export async function checkProxy(id) {
  const result = await apiFetch(`/api/proxies/${id}/check`, { method: 'POST' })
  if (result?.proxy) replaceProxy(result.proxy)
  return result // { proxy, ok, latencyMs, exitIp, error }
}

export async function fetchOrder(id) {
  return apiFetch(`/api/orders/${id}`)
}

export async function patchOrder(id, body) {
  const result = await apiFetch(`/api/orders/${id}`, { method: 'PATCH', body })
  if (Array.isArray(result?.proxies)) {
    for (const proxy of result.proxies) replaceProxy(proxy)
  }
  return result
}
