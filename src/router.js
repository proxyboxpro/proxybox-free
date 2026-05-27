import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { token, currentUser } from './api'
import { translate, locale } from './i18n'
import AppLayout from './layouts/AppLayout.vue'
import AuthView from './views/AuthView.vue'
import DashboardView from './views/DashboardView.vue'
import NodesView from './views/NodesView.vue'
import NodeDetailView from './views/NodeDetailView.vue'
import OrderDetailView from './views/OrderDetailView.vue'
import ApiView from './views/ApiView.vue'
import ProfileView from './views/ProfileView.vue'
import SettingsView from './views/SettingsView.vue'
import CustomerLayout from './layouts/CustomerLayout.vue'
import CustomerDashboard from './views/customer/CustomerDashboard.vue'
import CustomerBuy from './views/customer/CustomerBuy.vue'
import CustomerProxies from './views/customer/CustomerProxies.vue'
import CustomerBilling from './views/customer/CustomerBilling.vue'
import CustomerAccount from './views/customer/CustomerAccount.vue'
import CustomerAffiliate from './views/customer/CustomerAffiliate.vue'
import CustomerUsage from './views/customer/CustomerUsage.vue'
import AdminPaymentView from './views/admin/AdminPaymentView.vue'
import AdminOrdersView from './views/admin/AdminOrdersView.vue'
import AdminUserDetailView from './views/admin/AdminUserDetailView.vue'
// AdminRevenueView is lazy-imported below so ApexCharts (1MB) only loads on /admin/billing/revenue
import AdminEmailTemplatesView from './views/admin/AdminEmailTemplatesView.vue'
import AdminAuditView from './views/admin/AdminAuditView.vue'
import AdminUsersView from './views/admin/AdminUsersView.vue'
import AdminFeaturesView from './views/admin/AdminFeaturesView.vue'
import AdminOauthView from './views/admin/AdminOauthView.vue'
import AdminWebhookView from './views/admin/AdminWebhookView.vue'
import AdminZonesView from './views/admin/AdminZonesView.vue'
import AdminPricingView from './views/admin/AdminPricingView.vue'
import AdminCouponsView from './views/admin/AdminCouponsView.vue'
import AdminCreditCodesView from './views/admin/AdminCreditCodesView.vue'
import AdminApiKeyRotateView from './views/admin/AdminApiKeyRotateView.vue'
import AdminSmtpView from './views/admin/AdminSmtpView.vue'
import AdminAnnouncementsView from './views/admin/AdminAnnouncementsView.vue'

// URL strategy
//   /admin/*         → admin console (requires admin role)
//   /dashboard, ...  → customer portal (any authenticated user)
//   /login /register → public (redirect to dashboard if already authed)
// Locale lives in localStorage; URLs never carry /en or /vi.

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    // Support hash anchors (e.g. /account#security) — scroll to the element.
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 70 }
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('./views/LandingView.vue'),
      meta: { public: true },
      beforeEnter: (to, from, next) => {
        if (token.value) next(roleRedirect())
        else next()
      }
    },
    // meta.anonOnly = redirect logged-in users away (login, register, forgot-password).
    // meta.public   = accessible to anyone (logged in or out, no redirect).
    { path: '/login',    name: 'login',    component: AuthView, meta: { public: true, anonOnly: true, mode: 'login' } },
    { path: '/register', name: 'register', component: AuthView, meta: { public: true, anonOnly: true, mode: 'register' } },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('./views/ForgotPasswordView.vue'), meta: { public: true, anonOnly: true } },
    { path: '/reset-password',  name: 'reset-password',  component: () => import('./views/ResetPasswordView.vue'),  meta: { public: true } },
    { path: '/verify-email',    name: 'verify-email',    component: () => import('./views/VerifyEmailView.vue'),    meta: { public: true } },
    { path: '/status',          name: 'status',          component: () => import('./views/StatusView.vue'),         meta: { public: true } },
    { path: '/faq',             name: 'faq',             component: () => import('./views/FaqView.vue'),            meta: { public: true } },
    { path: '/api-docs',        name: 'public-api-docs', component: () => import('./views/PublicApiDocsView.vue'),  meta: { public: true } },
    { path: '/pricing',         name: 'public-pricing',  component: () => import('./views/PublicPricingView.vue'),  meta: { public: true } },
    { path: '/changelog',       name: 'changelog',       component: () => import('./views/ChangelogView.vue'),      meta: { public: true } },

    // ─── ADMIN CONSOLE ───────────────────────────────────────────────
    { path: '/admin', component: AppLayout, meta: { admin: true }, children: [
      { path: '',                              redirect: { name: 'admin-dashboard' } },
      { path: 'dashboard',                     name: 'admin-dashboard',     component: DashboardView },

      // Infrastructure
      { path: 'nodes',                         name: 'admin-nodes',         component: NodesView },
      { path: 'nodes/:nodeId',                 name: 'admin-node-detail',   component: NodeDetailView },
      { path: 'hubs',                          name: 'admin-hubs',          component: () => import('./views/admin/AdminHubsView.vue') },
      { path: 'zones',                         name: 'admin-zones',         component: AdminZonesView },
      { path: 'connections',                   name: 'admin-connections',        component: () => import('./views/admin/AdminConnectionsView.vue') },
      { path: 'connections/:proxyId',          name: 'admin-connection-detail',  component: () => import('./views/admin/AdminConnectionDetailView.vue') },

      // Users
      { path: 'users',                         name: 'admin-users',         component: AdminUsersView },
      { path: 'users/:userId',                 name: 'admin-user-detail',   component: AdminUserDetailView },
      { path: 'users/oauth',                   name: 'admin-oauth',         component: AdminOauthView },

      // Billing
      { path: 'billing',                       redirect: { name: 'admin-orders' } },
      { path: 'billing/orders',                name: 'admin-orders',        component: AdminOrdersView },
      { path: 'billing/orders/:orderId',       name: 'admin-order-detail',  component: OrderDetailView },
      { path: 'billing/pricing',               name: 'admin-pricing',       component: AdminPricingView },
      { path: 'billing/coupons',               name: 'admin-coupons',       component: AdminCouponsView },
      { path: 'billing/credit-codes',          name: 'admin-credit-codes',  component: AdminCreditCodesView },
      { path: 'billing/revenue',               name: 'admin-revenue',       component: () => import('./views/admin/AdminRevenueView.vue') },
      { path: 'billing/payment',               name: 'admin-payment',       component: AdminPaymentView },

      // System
      { path: 'system',                        redirect: { name: 'admin-features' } },
      { path: 'system/features',               name: 'admin-features',      component: AdminFeaturesView },
      { path: 'system/email',                  name: 'admin-email',         component: AdminEmailTemplatesView },
      { path: 'system/audit',                  name: 'admin-audit',         component: AdminAuditView },
      { path: 'system/webhook',                name: 'admin-webhook',       component: AdminWebhookView },
      { path: 'system/api',                    name: 'admin-api',           component: ApiView },
      { path: 'system/api-key',                name: 'admin-apikey',        component: AdminApiKeyRotateView },
      { path: 'system/smtp',                   name: 'admin-smtp',          component: AdminSmtpView },
      { path: 'system/announcements',          name: 'admin-announcements', component: AdminAnnouncementsView },
      { path: 'system/docs',                   name: 'admin-docs',          component: () => import('./views/admin/AdminDocsView.vue') },
      { path: 'system/downloads',              name: 'admin-downloads',     component: () => import('./views/admin/AdminDownloadsView.vue') },

      { path: 'profile',                       name: 'admin-profile',       component: ProfileView },
      { path: 'settings',                      name: 'admin-settings',      component: SettingsView }
    ] },

    // ─── CUSTOMER PORTAL (flat URLs) ─────────────────────────────────
    { path: '/', component: CustomerLayout, meta: { customer: true }, children: [
      { path: 'dashboard',         name: 'dashboard',             component: CustomerDashboard },
      { path: 'buy',               name: 'buy',                   component: CustomerBuy },
      { path: 'proxies',                  name: 'proxies',         component: CustomerProxies },
      { path: 'proxies/:orderId',         name: 'proxy-order',     component: CustomerProxies },
      // Orders page removed — proxy groups now live inside /proxies (grouped by order).
      { path: 'orders',            redirect: '/proxies' },
      { path: 'orders/:orderId',   redirect: (to) => `/proxies?order=${to.params.orderId}` },
      { path: 'billing',           name: 'billing',               component: CustomerBilling },
      { path: 'affiliate',         name: 'affiliate',             component: CustomerAffiliate },
      { path: 'usage',             name: 'usage',                 component: CustomerUsage },
      { path: 'my-nodes',          name: 'my-nodes',              component: () => import('./views/customer/CustomerNodes.vue') },
      { path: 'my-nodes/:id',      name: 'my-node-detail',        component: () => import('./views/customer/CustomerNodeDetail.vue') },
      { path: 'connections',       name: 'connections',           component: () => import('./views/customer/CustomerConnections.vue') },
      { path: 'account',           name: 'account',               component: CustomerAccount },
      { path: 'api-docs',          name: 'api-docs',              component: () => import('./views/customer/CustomerApiDocsView.vue') },
      { path: 'tools',             name: 'tools',                 component: () => import('./views/customer/CustomerToolsIndex.vue') },
      { path: 'tools/ping',        name: 'tools-ping',            component: () => import('./views/customer/CustomerToolsPing.vue') },
      { path: 'tools/bulk-check',  name: 'tools-bulk-check',      component: () => import('./views/customer/CustomerToolsBulkCheck.vue') },
      { path: 'tools/ip-info',     name: 'tools-ip-info',         component: () => import('./views/customer/CustomerToolsIpInfo.vue') },
      { path: 'tools/blacklist',   name: 'tools-blacklist',       component: () => import('./views/customer/CustomerToolsBlacklist.vue') },
      { path: 'tools/speed-test',  name: 'tools-speed-test',      component: () => import('./views/customer/CustomerToolsSpeedTest.vue') },
      { path: 'tools/check-proxy', redirect: '/tools/bulk-check' }
    ] },

    // ─── LEGACY REDIRECTS ────────────────────────────────────────────
    // Old /customer/* paths → flat URLs (drop the /customer/ prefix).
    { path: '/customer',                redirect: '/dashboard' },
    { path: '/customer/dashboard',      redirect: '/dashboard' },
    { path: '/customer/buy',            redirect: '/buy' },
    { path: '/customer/proxies',        redirect: '/proxies' },
    { path: '/customer/orders',         redirect: '/orders' },
    { path: '/customer/orders/:orderId', redirect: (to) => `/orders/${to.params.orderId}` },
    { path: '/customer/billing',        redirect: '/billing' },
    { path: '/customer/affiliate',      redirect: '/affiliate' },
    { path: '/customer/usage',          redirect: '/usage' },
    { path: '/customer/account',        redirect: '/account' },

    // Old flat admin URLs → new /admin/* paths.
    { path: '/dashboard-admin',  redirect: '/admin/dashboard' },
    { path: '/nodes',            redirect: '/admin/nodes' },
    { path: '/nodes/:nodeId',    redirect: (to) => `/admin/nodes/${to.params.nodeId}` },
    { path: '/billing-admin',    redirect: '/admin/billing/pricing' },
    { path: '/api',              redirect: '/admin/system/api' },
    // Legacy /en/* /vi/* — strip locale.
    { path: '/:legacyLocale(en|vi)/:rest(.*)?', redirect: (to) => '/' + (to.params.rest || 'dashboard') },

    { path: '/:pathMatch(.*)*', redirect: () => roleRedirect() }
  ]
})

function isAdminRole() {
  const u = currentUser.value
  return u && (u.role || 'admin') !== 'customer'
}
function roleRedirect() {
  if (!token.value) return { name: 'login' }
  return isAdminRole() ? { name: 'admin-dashboard' } : { name: 'dashboard' }
}

// Route name → i18n key used for the browser tab title.
const ROUTE_TITLE_KEYS = {
  // Public / auth
  login: 'page.login',
  register: 'page.register',
  'forgot-password': 'page.forgotPassword',
  'reset-password': 'page.resetPassword',
  'verify-email': 'page.verifyEmail',
  status: 'page.status',
  faq: 'page.faq',
  // Admin
  'admin-dashboard':         'page.dashboard',
  'admin-nodes':             'page.nodes',
  'admin-node-detail':       'page.node-detail',
  'admin-hubs':              'page.hubs',
  'admin-zones':             'page.zones',
  'admin-connections':       'page.connections',
  'admin-connection-detail': 'page.connection-detail',
  'admin-users':             'page.users',
  'admin-user-detail':       'page.user-detail',
  'admin-oauth':             'page.oauth',
  'admin-orders':            'page.orders',
  'admin-order-detail':      'page.order-detail',
  'admin-pricing':           'page.pricing',
  'admin-coupons':           'page.coupons',
  'admin-credit-codes':      'page.credit-codes',
  'admin-revenue':           'page.revenue',
  'admin-payment':           'page.payment',
  'admin-features':          'page.features',
  'admin-email':             'page.email',
  'admin-audit':             'page.audit',
  'admin-webhook':           'page.webhook',
  'admin-api':               'page.api',
  'admin-apikey':            'page.apikey',
  'admin-smtp':              'page.smtp',
  'admin-announcements':     'page.announcements',
  'admin-docs':              'page.docs',
  'admin-downloads':         'page.downloads',
  'admin-profile':           'page.profile',
  'admin-settings':          'page.settings',
  // Customer
  dashboard:        'page.dashboard',
  buy:              'page.buy',
  proxies:          'page.proxies',
  'proxy-order':    'page.proxies',
  billing:          'page.billing',
  affiliate:        'page.affiliate',
  usage:            'page.usage',
  connections:      'page.connections',
  account:          'page.account',
  'api-docs':       'page.api-docs',
  tools:            'page.tools',
  'tools-ping':     'page.tools-ping',
  'tools-bulk-check':'page.tools-bulk-check',
  'tools-ip-info':  'page.tools-ip-info',
  'tools-blacklist':'page.tools-blacklist',
  'tools-speed-test':'page.tools-speed-test'
}
const APP_NAME = 'ProxyBox'
let currentRouteName = null
function applyTitle(name) {
  const key = ROUTE_TITLE_KEYS[name]
  const label = key ? translate(key) : ''
  const titleShort = translate('site.titleShort')
  const fullTitle = translate('site.title')
  document.title = label && label !== key ? `${label} — ${titleShort}` : fullTitle
  // Keep <meta name="description"> in sync so social-share previews +
  // crawlers see the user's locale. Updates on every route + locale
  // change. Cheap — DOM query is constant-time.
  const desc = document.querySelector('meta[name="description"]')
  if (desc) desc.setAttribute('content', translate('site.description'))
  const ogTitle = document.querySelector('meta[property="og:title"]')
  if (ogTitle) ogTitle.setAttribute('content', fullTitle)
  const ogDesc = document.querySelector('meta[property="og:description"]')
  if (ogDesc) ogDesc.setAttribute('content', translate('site.description'))
  const htmlLang = document.documentElement
  if (htmlLang) htmlLang.setAttribute('lang', locale.value || 'vi')
}
watch(locale, () => { if (currentRouteName) applyTitle(currentRouteName); else applyTitle(null) })

router.afterEach((to) => {
  currentRouteName = to.name
  applyTitle(currentRouteName)
})

router.beforeEach((to) => {
  // anonOnly: login/register-style routes — bounce logged-in users to their dashboard.
  if (to.meta.anonOnly && token.value) return roleRedirect()
  // public: anyone can view (status, faq, verify-email, reset-password) — no redirect.
  if (to.meta.public) return true
  // Everything else requires a session.
  if (!token.value) return { name: 'login' }
  // gate /admin/* routes to admin role
  if (to.matched.some((r) => r.meta?.admin) && !isAdminRole()) return { name: 'dashboard' }
  // customer routes — admin can still access (no role check needed)
  return true
})

export default router
