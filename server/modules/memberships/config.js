import { z } from 'zod'
import { fail } from '../payments/domain.js'
import { ApiError } from '../../errors.js'
export const DEFAULT_MEMBERSHIP_ORIGIN = 'https://nexvijo.com'
export function membershipConfig(env = process.env) {
  // Membership access is a normal server feature; only an explicit false disables it.
  if (env.MEMBERSHIPS_ENABLED === 'false') return { enabled: false }
  const result = z.object({
    MEMBERSHIPS_ENABLED: z.enum(['true', 'false']).default('true'),
    MEMBERSHIP_WEBSITE_ORIGIN: z.string().url().default(DEFAULT_MEMBERSHIP_ORIGIN), MEMBERSHIP_OTP_PEPPER: z.string().min(32),
    RESEND_API_KEY: z.string().min(10), RESEND_FROM_EMAIL: z.string().min(5),
  }).safeParse(env)
  if (!result.success) throw new ApiError('MEMBERSHIP_CONFIGURATION', 'Membership configuration is incomplete.', 503,
    { fields: result.error.issues.map(issue => issue.path[0]) })
  const v = result.data, origin = new URL(v.MEMBERSHIP_WEBSITE_ORIGIN).origin
  const productId = env.WHOP_PREMIUM_BLOG_PRODUCT_ID || ''
  const planIds = (env.WHOP_PREMIUM_BLOG_PLAN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  const syncEnabled = Boolean(productId && planIds.length)
  if ((productId || planIds.length) && (!syncEnabled || !/^prod_[A-Za-z0-9]+$/.test(productId))) fail('MEMBERSHIP_CONFIGURATION', 'Configure both premium product and plan IDs.', 503)
  if (planIds.some(s => !/^plan_[A-Za-z0-9]+$/.test(s)) || !/^https?:\/\//.test(origin) || (env.NODE_ENV === 'production' && !origin.startsWith('https://'))) fail('MEMBERSHIP_CONFIGURATION', 'Invalid membership origin or plan IDs.', 503)
  return { enabled: true, origin, pepper: v.MEMBERSHIP_OTP_PEPPER, resendKey: v.RESEND_API_KEY,
    from: v.RESEND_FROM_EMAIL, productId, planIds, syncEnabled,
    secure: env.NODE_ENV === 'production', sameSite: env.MEMBERSHIP_COOKIE_SAME_SITE === 'none' ? 'None' : 'Lax' }
}
