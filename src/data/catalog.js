export const folders = [
  { id: 'active', labelKey: 'folder.active', count: 26 },
  { id: 'expiring', labelKey: 'folder.expiring', count: 6 },
  { id: 'expired', labelKey: 'folder.expired', count: 3 },
  { id: 'ipv4', labelKey: 'folder.ipv4', count: 18 },
  { id: 'ipv6', labelKey: 'folder.ipv6', count: 14 },
  { id: 'datacenter', labelKey: 'folder.datacenter', count: 12 },
  { id: 'residential', labelKey: 'folder.residential', count: 5 }
]

export const plans = [
  {
    id: 'v4-starter',
    type: 'ipv4',
    name: 'IPv4 Starter',
    price: 1.9,
    stock: 842,
    region: 'Asia',
    badgeKey: 'plan.private',
    featureKeys: ['feature.privateIp', 'feature.httpSocks', 'feature.whitelist', 'feature.manualReset']
  },
  {
    id: 'v4-growth',
    type: 'ipv4',
    name: 'IPv4 Growth',
    price: 2.7,
    stock: 496,
    region: 'United States',
    badgeKey: 'plan.popular',
    featureKeys: ['feature.cleanIp', 'feature.stableSession', 'feature.apiManage', 'feature.support']
  },
  {
    id: 'v6-scale',
    type: 'ipv6',
    name: 'IPv6 Scale',
    price: 0.46,
    stock: 8800,
    region: 'United States',
    badgeKey: 'plan.bulk',
    featureKeys: ['feature.largePool', 'feature.rotateApi', 'feature.highRate', 'feature.realtime']
  },
  {
    id: 'v6-private',
    type: 'ipv6',
    name: 'IPv6 Private',
    price: 0.78,
    stock: 3200,
    region: 'Europe',
    badgeKey: 'plan.sla',
    featureKeys: ['feature.privateSubnet', 'feature.priorityRouting', 'feature.slaReport', 'feature.dedicatedTech']
  }
]

export const tickets = [
  { id: 'TK-1180', subjectKey: 'ticket.region', status: 'open', updatedKey: 'time.minutesAgo' },
  { id: 'TK-1168', subjectKey: 'ticket.whitelist', status: 'waiting', updatedKey: 'time.hoursAgo' },
  { id: 'TK-1145', subjectKey: 'ticket.invoice', status: 'closed', updatedKey: 'time.daysAgo' }
]

export const demoProxies = [
  { id: 'px-1024', name: 'US Social Batch 01', type: 'IPv4', ip: '198.51.100.42', bindIp: '198.51.100.42', port: 8421, protocol: 'HTTP/SOCKS5', region: 'US', city: 'Los Angeles', status: 'active', latency: 48, traffic: '128 GB', expires: '2026-06-21', folder: 'active', username: 'pxhub_1024', password: 'r9c2k4' },
  { id: 'px-1025', name: 'Asia Ads Worker', type: 'IPv4', ip: '203.0.113.18', bindIp: '203.0.113.18', port: 9120, protocol: 'HTTP', region: 'SG', city: 'Singapore', status: 'active', latency: 34, traffic: '84 GB', expires: '2026-06-03', folder: 'ipv4', username: 'pxhub_1025', password: 'm4n8q1' },
  { id: 'px-2011', name: 'Crawler Pool A', type: 'IPv6', ip: '2001:db8:ac10:44::12', bindIp: '2001:db8:ac10:44::12', port: 1080, protocol: 'SOCKS5', region: 'EU', city: 'Frankfurt', status: 'active', latency: 71, traffic: '392 GB', expires: '2026-07-10', folder: 'ipv6', username: 'pxhub_v6a', password: 'v6-8821' },
  { id: 'px-2012', name: 'SEO Rotation Pool', type: 'IPv6', ip: '2001:db8:bc22:19::88', bindIp: '2001:db8:bc22:19::88', port: 1081, protocol: 'HTTP/SOCKS5', region: 'US', city: 'Dallas', status: 'warning', latency: 86, traffic: '611 GB', expires: '2026-05-18', folder: 'expiring', username: 'pxhub_v6seo', password: 'seo-7732' },
  { id: 'px-0902', name: 'Old Marketplace Test', type: 'IPv4', ip: '192.0.2.77', bindIp: '192.0.2.77', port: 7300, protocol: 'HTTP', region: 'JP', city: 'Tokyo', status: 'expired', latency: 0, traffic: '0 GB', expires: '2026-04-30', folder: 'expired', username: 'pxhub_old', password: 'old-003' }
]

export const demoOrders = [
  { id: 'ORD-4421', item: 'IPv4 Growth x 50', amount: 135, status: 'paid', date: '2026-05-11' },
  { id: 'ORD-4410', item: 'IPv6 Scale x 1000', amount: 414, status: 'paid', date: '2026-05-06' },
  { id: 'ORD-4398', item: 'IPv4 Starter x 20', amount: 38, status: 'pending', date: '2026-05-02' },
  { id: 'ORD-4330', item: 'IPv6 Private x 200', amount: 156, status: 'failed', date: '2026-04-20' }
]
