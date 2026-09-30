import { z } from 'zod'
import { planSchema, productFor } from './products.js'
export const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase())
export const postSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140), title: z.string().trim().min(3).max(180),
  excerpt: z.string().trim().min(10).max(600), content: z.string().trim().min(30).max(24000),
  visibility: z.enum(['public', 'premium']), category: z.string().trim().min(1).max(60), published: z.boolean(),
  requiredEntitlement: planSchema.default('premium_blog'),
}).strict()
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().max(254).optional() }).strict()
export function hasAccess(membership, now = new Date()) {
  return Boolean(membership && membership.status === 'active' && !membership.revokedAt &&
    membership.startedAt <= now && (!membership.expiresAt || membership.expiresAt > now) &&
    ['verified', 'owner_verified', 'manual'].includes(membership.paymentStatus))
}
export function publicMembership(m) {
  return { membershipId: m.membershipId, plan: m.plan, productName: productFor(m.plan)?.name || m.plan, accessUrl: productFor(m.plan)?.accessUrl, provider: m.provider, status: m.status,
    accessGranted: hasAccess(m), claimed: Boolean(m.customerId), startedAt: m.startedAt,
    expiresAt: m.expiresAt || null, lastPaymentAt: m.lastPaymentAt, paymentStatus: m.paymentStatus, purchasedOn: m.purchasedOn }
}
