import { it, expect } from 'vitest'
import { membershipConfig } from '../../memberships/config.js'
import { hasAccess } from '../../memberships/domain.js'
import { normalizeReceipt } from '../../memberships/fulfillment.js'

const env = { MEMBERSHIPS_ENABLED: 'true', MEMBERSHIP_WEBSITE_ORIGIN: 'https://nexvijo.com', MEMBERSHIP_OTP_PEPPER: 'p'.repeat(32), RESEND_API_KEY: 'test-only-key', RESEND_FROM_EMAIL: 'Nexvijo <sender@example.com>' }
it('supports owner-verified access without inventing provider configuration', () => {
  const config = membershipConfig(env)
  expect(config.enabled).toBe(true); expect(config.syncEnabled).toBe(false)
  expect(() => membershipConfig({ ...env, WHOP_PREMIUM_BLOG_PRODUCT_ID: 'prod_only' })).toThrow()
})
it('validates the exact provider product/plan allowlist and dedicated OTP secret', () => {
  expect(membershipConfig({ ...env, WHOP_PREMIUM_BLOG_PRODUCT_ID: 'prod_blog', WHOP_PREMIUM_BLOG_PLAN_IDS: 'plan_blog' }).syncEnabled).toBe(true)
  expect(() => membershipConfig({ ...env, MEMBERSHIP_OTP_PEPPER: '' })).toThrow()
})
it('enforces permanent access, future start, expiry, unverified payments and revocation', () => {
  const m = { status: 'active', paymentStatus: 'owner_verified', startedAt: new Date(0) }
  expect(hasAccess(m)).toBe(true)
  expect(hasAccess({ ...m, revokedAt: new Date() })).toBe(false)
  expect(hasAccess({ ...m, paymentStatus: 'unverified' })).toBe(false)
  expect(hasAccess({ ...m, expiresAt: new Date(0) })).toBe(false)
  expect(hasAccess({ ...m, startedAt: new Date(Date.now() + 100000) })).toBe(false)
})
it('does not accept a cross-currency total or an unpaid receipt', () => {
  const ctx = { config: { accountId: 'biz_test' } }
  const value = { id: 'pay_test', account_id: 'biz_test', membership: { id: 'mem_test' }, currency: 'usd', status: 'paid', total: { amount: '50', currency: 'kes' } }
  expect(() => normalizeReceipt(ctx, value, 'mem_test')).toThrow()
  expect(normalizeReceipt(ctx, { ...value, status: 'pending' }, 'mem_test')).toBeNull()
})
