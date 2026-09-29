import { z } from 'zod'
import { fail } from '../payments/domain.js'
export function membershipConfig(env = process.env) {
  if (env.MEMBERSHIPS_ENABLED !== 'true') return { enabled: false }
  const result = z.object({
    MEMBERSHIP_WEBSITE_ORIGIN: z.string().url(), MEMBERSHIP_OTP_PEPPER: z.string().min(32),
    RESEND_API_KEY: z.string().min(10), RESEND_FROM_EMAIL: z.string().min(5),
  }).safeParse(env)
  if (!result.success) fail('MEMBERSHIP_CONFIGURATION', 'Membership configuration is incomplete.', 503)
  const v = result.data, origin = new URL(v.MEMBERSHIP_WEBSITE_ORIGIN).origin
  const productId = env.WHOP_PREMIUM_BLOG_PRODUCT_ID || ''
  const planIds = (env.WHOP_PREMIUM_BLOG_PLAN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  const syncEnabled = Boolean(productId && planIds.length)
  if ((productId || planIds.length) && (!syncEnabled || !/^prod_[A-Za-z0-9]+$/.test(productId))) fail('MEMBERSHIP_CONFIGURATION', 'Configure both premium product and plan IDs.', 503)
  if (planIds.some(s => !/^plan_[A-Za-z0-9]+$/.test(s)) || (env.NODE_ENV === 'production' && !origin.startsWith('https://'))) fail('MEMBERSHIP_CONFIGURATION', 'Invalid membership origin or plan IDs.', 503)
  return { enabled: true, origin, pepper: v.MEMBERSHIP_OTP_PEPPER, resendKey: v.RESEND_API_KEY,
    from: v.RESEND_FROM_EMAIL, productId, planIds, syncEnabled,
    secure: env.NODE_ENV === 'production', sameSite: env.MEMBERSHIP_COOKIE_SAME_SITE === 'none' ? 'None' : 'Lax' }
}
