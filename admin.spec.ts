import { test, expect, type Page, type Route } from '@playwright/test'
import { products } from './src/catalog'
import { partnerFields, type Partner } from './src/partners'
import type { AdminPurchaseRequest } from './src/purchase'

test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: 'reduce' }, launchOptions: { executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' })
const origin = (process.env.TEST_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const idToken = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ iss: 'https://securetoken.google.com/forma-furniture-marketplace', aud: 'forma-furniture-marketplace', sub: 'admin-uid', user_id: 'admin-uid', email: 'ops@formivo3d.com', iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } })}.sig`

function order(id: string, status: AdminPurchaseRequest['status'], createdAt: string, name: string): AdminPurchaseRequest {
  return { id, projectId: `project-${id}`, projectName: `${name}'s living room`, customer: { name, email: `${name.toLowerCase()}@example.com`, phone: '+30 210 000 0000', city: 'Athens', notes: id === 'order-1' ? 'Please deliver after 5pm.' : '' }, items: [{ id: '["sofa-haven",""]', productId: 'sofa-haven', name: 'Haven sofa', retailer: 'Minoa Studio', sku: 'SOFA-1', quantity: 1, unitPrice: 899, catalogStatus: 'Sample', availability: status === 'pending' ? 'pending' : 'available', included: true }], estimatedTotal: 899, currency: 'EUR', status, createdAt, updatedAt: createdAt, history: [{ status: 'pending', at: createdAt, by: 'customer' }], adminNotes: [] }
}

/** Stateful stand-in for scripts/admin-server.ts so the dashboard can be driven without Firebase Admin credentials. */
async function mockBackend(page: Page, role = 'owner') {
  const calls: { method: string; path: string; body: unknown }[] = []
  const requests = [order('order-1', 'pending', '2026-11-01T10:00:00.000Z', 'Maria'), order('order-2', 'ready-to-place', '2026-11-02T10:00:00.000Z', 'Nikos'), order('order-3', 'delivered', '2026-10-20T10:00:00.000Z', 'Eleni')]
  const partners: Partner[] = []
  const edits = new Map<string, { hidden?: boolean; review?: string }>([['sofa-haven', { review: 'needs-work' }]])
  const catalog = () => ({ products: products.slice(0, 8).map((product) => ({ id: product.id, sku: product.sku, name: product.name, brand: product.brand, retailer: product.retailer, retailerId: product.retailerId || null, group: product.group, category: product.category, width: product.width, depth: product.depth, height: product.height, price: product.price, status: product.status, thumbnailPath: product.thumbnailPath || null, modelPath: product.modelPath || null, variantCount: product.variants?.length || 0, verification: null, hidden: Boolean(edits.get(product.id)?.hidden), review: edits.get(product.id)?.review || 'pending', updatedAt: null })) })
  await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('accounts:signInWithPassword')) return route.fulfill({ json: { kind: 'identitytoolkit#VerifyPasswordResponse', localId: 'admin-uid', email: 'ops@formivo3d.com', idToken, refreshToken: 'refresh', expiresIn: '3600', registered: true } })
    if (path.endsWith('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'admin-uid', email: 'ops@formivo3d.com', emailVerified: true, providerUserInfo: [{ providerId: 'password', email: 'ops@formivo3d.com', federatedId: 'ops@formivo3d.com', rawId: 'ops@formivo3d.com' }], lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] } })
    return route.fulfill({ json: {} })
  })
  await page.route(`${origin}/api/admin/**`, async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postDataJSON?.() ?? null
    calls.push({ method, path, body })
    expect(request.headers().authorization).toBe(`Bearer ${idToken}`)
    const at = new Date().toISOString()
    if (path === '/api/admin/me') return route.fulfill({ json: { uid: 'admin-uid', email: 'ops@formivo3d.com', role } })
    if (path === '/api/admin/jobs') return route.fulfill({ json: [] })
    if (path === '/api/admin/catalog' && method === 'GET') return route.fulfill({ json: catalog() })
    if (path === '/api/admin/users') return route.fulfill({ json: [{ uid: 'admin-uid', email: 'ops@formivo3d.com', role: 'owner', status: 'active' }] })
    if (path === '/api/admin/audit') return route.fulfill({ json: [] })
    if (path === '/api/admin/metrics') return route.fulfill({ json: { savedProjects: 12, requestsByStatus: {} } })
    if (path === '/api/admin/purchase-requests') return route.fulfill({ json: requests })
    if (path === '/api/admin/partners' && method === 'GET') return route.fulfill({ json: partners })
    if (path === '/api/admin/partners' && method === 'POST') {
      const result = partnerFields(body)
      if ('error' in result) return route.fulfill({ status: 400, json: { error: result.error } })
      const partner = { ...result.fields, id: `partner-${partners.length + 1}`, notes: [], stageHistory: [{ stage: result.fields.stage!, at, authorEmail: 'ops@formivo3d.com' }], createdAt: at, updatedAt: at } as Partner
      partners.unshift(partner); return route.fulfill({ status: 201, json: partner })
    }
    const partnerMatch = path.match(/^\/api\/admin\/partners\/([^/]+)(\/notes)?$/)
    if (partnerMatch) {
      const partner = partners.find((item) => item.id === partnerMatch[1])!
      if (partnerMatch[2]) partner.notes.push({ id: `n${partner.notes.length}`, text: body.text, at, authorEmail: 'ops@formivo3d.com' })
      else { if (body.stage !== partner.stage) partner.stageHistory.push({ stage: body.stage, at, authorEmail: 'ops@formivo3d.com' }); Object.assign(partner, body, { updatedAt: at }) }
      return route.fulfill({ json: partner })
    }
    const orderMatch = path.match(/^\/api\/admin\/purchase-requests\/([^/]+)\/(status|notes|availability)$/)
    if (orderMatch) {
      const target = requests.find((item) => item.id === orderMatch[1])!
      if (orderMatch[2] === 'status') { target.status = body.status; if (body.reason) target.cancelReason = body.reason; target.history!.push({ status: body.status, at, by: 'admin', ...(body.reason ? { note: body.reason } : {}) }) }
      if (orderMatch[2] === 'notes') target.adminNotes.push({ id: `note-${target.adminNotes.length}`, text: body.text, at, authorEmail: 'ops@formivo3d.com' })
      if (orderMatch[2] === 'availability') { target.items = target.items.map((item) => ({ ...item, availability: body.items.find((update: { id: string }) => update.id === item.id).availability })); target.status = target.items.some((item) => item.availability === 'unavailable') ? 'awaiting-user-decision' : 'ready-to-place' }
      return route.fulfill({ json: target })
    }
    const catalogMatch = path.match(/^\/api\/admin\/catalog\/([^/]+)$/)
    if (catalogMatch && method === 'PUT') { edits.set(catalogMatch[1], { ...edits.get(catalogMatch[1]), ...body }); return route.fulfill({ json: { id: catalogMatch[1], ...body } }) }
    return route.fulfill({ status: 404, json: { error: `Unmocked ${method} ${path}` } })
  })
  return calls
}

async function signIn(page: Page) {
  await page.goto(`${origin}/admin`)
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('firebaseLocalStorageDb') })
  await page.reload()
  await page.getByLabel('Email').fill('ops@formivo3d.com')
  await page.getByLabel('Password').fill('secret-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
}

test('admin dashboard: overview routes to orders, and orders move through review, placement, notes and cancellation', async ({ page }) => {
  const calls = await mockBackend(page)
  await signIn(page)
  const nav = page.getByRole('navigation', { name: 'Admin sections' })
  await expect(nav.getByRole('button')).toHaveText(['Overview', /^Orders/, 'Partners', /^Catalogue/, 'Ingestion', 'Team & audit'])
  await expect(nav.getByRole('button', { name: /Orders/ })).toContainText('2')
  await expect(page.locator('.admin-kpi', { hasText: 'orders to check' })).toContainText('1')
  await expect(page.locator('.admin-kpi', { hasText: 'saved designs' })).toContainText('12')

  await page.getByRole('button', { name: /Maria's living room/ }).click()
  await expect(page).toHaveURL(/tab=orders/)
  const detail = page.getByRole('article', { name: "Order Maria's living room" })
  await expect(detail).toContainText('Please deliver after 5pm.')
  await detail.getByRole('button', { name: 'Save availability review' }).click()
  await expect(page.getByRole('alert')).toHaveText('Mark every item available or unavailable before saving.')
  await detail.getByLabel('Availability for Haven sofa').selectOption('available')
  await detail.getByRole('button', { name: 'Save availability review' }).click()
  await expect(detail.locator('.admin-card-head .admin-pill')).toHaveText('Ready to place')
  await detail.getByRole('button', { name: 'Mark order placed' }).click()
  await expect(detail.getByRole('button', { name: 'Mark delivered' })).toBeVisible()
  await detail.getByLabel('Add a note').fill('Retailer confirmed delivery in week 48.')
  await detail.getByRole('button', { name: 'Add note' }).click()
  await expect(detail.locator('.admin-timeline').first()).toContainText('Retailer confirmed delivery in week 48.')
  await expect(detail.getByLabel('Add a note')).toHaveValue('')
  await detail.getByRole('button', { name: 'Cancel request' }).click()
  await detail.getByLabel('Reason shown to the shopper').fill('Retailer discontinued the sofa.')
  await detail.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(detail.locator('.admin-card-head .admin-pill')).toHaveText('Cancelled')
  await expect(detail.getByRole('button', { name: /Mark|Cancel request/ })).toHaveCount(0)
  expect(calls.filter((call) => call.path.endsWith('/status')).map((call) => call.body)).toEqual([{ status: 'placed' }, { status: 'cancelled', reason: 'Retailer discontinued the sofa.' }])

  await page.getByRole('group', { name: 'Filter orders by status' }).getByRole('button', { name: /^Delivered/ }).click()
  await expect(page.locator('.admin-list-pane .admin-list-row')).toHaveCount(1)
  await page.getByRole('button', { name: /^All/ }).click()
  await page.getByLabel('Search orders').fill('nikos')
  await expect(page.locator('.admin-list-pane .admin-list-row')).toHaveCount(1)
  await page.getByLabel('Search orders').fill('')
  await page.getByRole('button', { name: /Nikos's living room/ }).click()
  await page.screenshot({ path: '/tmp/forma-admin-orders-desktop.png', fullPage: true })
})

test('admin dashboard: partners pipeline and catalogue visibility/review', async ({ page }) => {
  const calls = await mockBackend(page)
  await signIn(page)
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name: 'Partners' }).click()
  await page.getByRole('button', { name: 'Add partner' }).click()
  const form = page.getByRole('region', { name: 'New partner' })
  await form.getByLabel('Company').fill('Polihome')
  await form.getByLabel('Contact email').fill('b2b@polihome.example')
  await form.getByLabel('Catalogue retailer id').fill('polihome')
  await form.getByRole('button', { name: 'Create partner' }).click()
  const partner = page.getByRole('region', { name: 'Partner Polihome' })
  await expect(partner.locator('.admin-card-head .admin-pill')).toHaveText('Lead')
  await partner.getByLabel('Stage').selectOption('negotiating')
  await partner.getByRole('button', { name: 'Save changes' }).click()
  await expect(partner.locator('.admin-card-head .admin-pill')).toHaveText('Negotiating')
  await expect(partner.locator('.admin-timeline').last()).toContainText('Negotiating')
  await partner.getByLabel('Add a note').fill('Sent pilot terms.')
  await partner.getByRole('button', { name: 'Add note' }).click()
  await expect(partner.locator('.admin-timeline').first()).toContainText('Sent pilot terms.')
  await page.screenshot({ path: '/tmp/forma-admin-partners-desktop.png', fullPage: true })

  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name: /Catalogue/ }).click()
  await expect(page.locator('.admin-catalog-table tbody tr')).toHaveCount(8)
  await page.getByLabel('Filter by review').selectOption('needs-work')
  await expect(page.locator('.admin-catalog-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Filter by review').selectOption('all')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Hide Haven three-seat sofa' }).click()
  await expect(page.getByRole('button', { name: 'Show Haven three-seat sofa' })).toBeVisible()
  await page.getByLabel('Review state for Haven three-seat sofa').selectOption('approved')
  await expect(page.getByLabel('Review state for Haven three-seat sofa')).toHaveValue('approved')
  expect(calls.filter((call) => call.path.startsWith('/api/admin/catalog/')).map((call) => call.body)).toEqual([{ hidden: true }, { review: 'approved' }])
  await expect(page.locator('.admin-catalog-table')).not.toContainText('Edit')
  await page.screenshot({ path: '/tmp/forma-admin-catalogue-desktop.png', fullPage: true })
})

test('viewer accounts only see read-only sections', async ({ page }) => {
  await mockBackend(page, 'viewer')
  await signIn(page)
  await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button')).toHaveText(['Overview', /^Catalogue/, 'Ingestion'])
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name: /Catalogue/ }).click()
  await expect(page.locator('.admin-catalog-table select')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Hide / })).toHaveCount(0)
})

test.describe('compact admin', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  test('orders open as a full-width detail with a way back', async ({ page }) => {
    await mockBackend(page)
    await signIn(page)
    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('button', { name: /Orders/ }).click()
    await page.getByRole('button', { name: /Maria's living room/ }).click()
    await expect(page.locator('.admin-list-pane')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '/tmp/forma-admin-orders-375.png', fullPage: true })
    await page.getByRole('button', { name: '← All orders' }).click()
    await expect(page.locator('.admin-list-pane')).toBeVisible()
    await page.screenshot({ path: '/tmp/forma-admin-overview-375.png', fullPage: true })
  })
})

test('products hidden by an admin leave the planner catalogue', async ({ page }) => {
  await page.route(`${origin}/api/catalog/visibility`, (route) => route.fulfill({ json: { hidden: ['sofa-haven'] } }))
  await page.goto(`${origin}/planner`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Furnish step' }).click()
  await expect(page.locator('.product-card')).toHaveCount(products.length - 1)
  await page.getByPlaceholder('Search products').fill('Haven')
  await expect(page.getByText('No products found')).toBeVisible()
})
