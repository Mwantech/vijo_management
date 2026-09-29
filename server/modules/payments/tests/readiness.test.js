import { it, expect, vi, afterEach } from 'vitest'
import { initializePayments } from '../index.js'
import { membershipStatus } from '../../memberships/status.js'

const env = { PAYMENTS_MONGODB_URI: 'mongodb://localhost/members_test', PAYMENTS_MONGODB_DB_NAME: 'members_test', PAYMENTS_ENVIRONMENT: 'test' }
function dependencies() {
  const connection = { readyState: 1, close: vi.fn(async () => {}) }
  return { connectPayments: vi.fn(async () => ({ connection, models: {} })), checkIndexes: vi.fn(async () => {}), startWorker: vi.fn() }
}
afterEach(() => vi.restoreAllMocks())
it('opens stored records with checkout and customer login disabled', async () => {
  const deps = dependencies(), ctx = await initializePayments(env, deps)
  expect(membershipStatus(ctx)).toMatchObject({ databaseReady: true, customerLoginReady: false, automaticWhopSyncReady: false })
  expect(deps.startWorker).not.toHaveBeenCalled()
  await ctx.close()
  expect(ctx.ready).toBe(false)
})
it('missing email settings do not disable the database or configured public origin', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = await initializePayments({ ...env, MEMBERSHIPS_ENABLED: 'true', MEMBERSHIP_WEBSITE_ORIGIN: 'https://nexvijo.com' }, dependencies())
  expect(ctx.ready).toBe(true)
  expect(ctx.memberships.origin).toBe('https://nexvijo.com')
  expect(membershipStatus(ctx).loginIssue.fields).toContain('RESEND_API_KEY')
})
it('invalid Whop configuration disables provider operations but not database access', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = await initializePayments({ ...env, PAYMENTS_ENABLED: 'true' }, dependencies())
  expect(ctx.ready).toBe(true)
  expect(ctx.providerReady).toBe(false)
  expect(membershipStatus(ctx).providerIssue.fields).toContain('WHOP_API_KEY')
})
it('reports missing database variable names without leaking credential values', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = await initializePayments({ PAYMENTS_MONGODB_URI: 'secret-invalid-uri' }, dependencies())
  expect(ctx.ready).toBe(false)
  expect(membershipStatus(ctx).databaseIssue.fields).toContain('PAYMENTS_MONGODB_URI')
  expect(JSON.stringify(membershipStatus(ctx))).not.toContain('secret-invalid-uri')
})
it('does not serve data when database index verification fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const deps = dependencies()
  deps.checkIndexes.mockRejectedValue(new Error('index missing'))
  const ctx = await initializePayments(env, deps)
  expect(ctx.ready).toBe(false)
  expect(ctx.connection.close).toHaveBeenCalled()
})
