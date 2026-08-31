import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createManagementApp } from './app.js'
import { cache } from './services/cache.service.js'
import { createSessionCookie } from './middleware/auth.js'

const summary = (platform, users, currency = 'KES') => ({
  success: true,
  data: {
    platform,
    users: { total: users, new: 2, active: 3, paying: 1 },
    revenue: { amount: users * 10, currency },
    transactions: 2,
    status: 'healthy',
    lastUpdatedAt: '2026-08-31T09:30:00.000Z',
  },
})

describe('Vijo Management API routes', () => {
  beforeEach(() => {
    cache.clear()
    process.env.MANAGEMENT_ADMIN_EMAIL = 'admin@nexvijo.com'
    process.env.MANAGEMENT_ADMIN_PASSWORD = 'secure-password'
    process.env.MANAGEMENT_ADMIN_ROLE = 'super_admin'
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'getgoodscenes.onrender.com') throw new TypeError('upstream unavailable')
      const platform = url.hostname.startsWith('gradepoa') ? 'gradepoa' : url.hostname.startsWith('bensmma') ? 'hms' : 'pos'
      if (url.pathname.endsWith('/summary')) return new Response(JSON.stringify(summary(platform, platform === 'gradepoa' ? 10 : 5)), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.pathname.endsWith('/health')) return new Response(JSON.stringify({ success: true, data: { platform, status: 'healthy' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('requires authentication for dashboard data', async () => {
    const response = await request(createManagementApp()).get('/api/management/dashboard')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('serves the compiled frontend and SPA routes from the production server', async () => {
    const root = await request(createManagementApp()).get('/')
    const dashboard = await request(createManagementApp()).get('/dashboard')
    expect(root.status).toBe(200)
    expect(root.type).toContain('html')
    expect(dashboard.status).toBe(200)
    expect(dashboard.text).toContain('<div id="root"></div>')
  })

  it('authenticates an administrator with an HTTP-only session', async () => {
    const response = await request(createManagementApp()).post('/api/management/auth/login').send({ email: 'admin@nexvijo.com', password: 'secure-password' })
    expect(response.status).toBe(200)
    expect(response.body.data.user.role).toBe('super_admin')
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
  })

  it('returns aggregate data while isolating one failed platform', async () => {
    const cookie = createSessionCookie({ id: 'admin', name: 'Admin', email: 'admin@nexvijo.com', role: 'super_admin' })
    const response = await request(createManagementApp()).get('/api/management/dashboard?from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z').set('Cookie', cookie)
    expect(response.status).toBe(200)
    expect(response.body.data.summary.totalUsers).toBe(20)
    expect(response.body.data.platformResults.goodscenes.status).toBe('failed')
    expect(response.body.data.platformResults.gradepoa.status).toBe('fulfilled')
  })

  it('rejects excessive pagination limits before calling a platform', async () => {
    const cookie = createSessionCookie({ id: 'admin', name: 'Admin', email: 'admin@nexvijo.com', role: 'super_admin' })
    const response = await request(createManagementApp()).get('/api/management/users?limit=1000').set('Cookie', cookie)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('enforces backend RBAC for finance users', async () => {
    const cookie = createSessionCookie({ id: 'finance', name: 'Finance', email: 'finance@nexvijo.com', role: 'finance' })
    const response = await request(createManagementApp()).get('/api/management/users').set('Cookie', cookie)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })
})
