import { Router } from 'express'
import { z } from 'zod'
import { parse, fail } from '../payments/domain.js'
import { emailPreview, sendVerificationEmail } from './email-service.js'
import { pageSchema, hasAccess } from './domain.js'

export function membershipEmailRouter(ctx) {
  const router = Router()
  router.use((req, _res, next) => {
    if (!['admin', 'super_admin'].includes(req.managementUser.role) || req.managementUser.authType !== 'session') fail('FORBIDDEN', 'An administrator session is required for membership emails.', 403)
    next()
  })
  const input = z.object({ membershipId: z.string().regex(/^mem_[A-Za-z0-9_-]{24}$/) }).strict()
  router.post('/preview', async (req, res) => {
    const { membershipId } = parse(input, req.body)
    const result = await emailPreview(ctx, membershipId)
    res.json({ success: true, data: { ...result.message, previewHash: result.previewHash } })
  })
  router.post('/send', async (req, res) => {
    const { membershipId, previewHash } = parse(input.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }), req.body)
    res.json({ success: true, data: await sendVerificationEmail(ctx, membershipId, previewHash, req.managementUser.id) })
  })
  router.get('/history', async (req, res) => {
    const q = parse(pageSchema, req.query)
    const filter = { environment: ctx.config.environment, type: { $in: ['VERIFICATION_EMAIL_RESERVED', 'VERIFICATION_EMAIL_ACCEPTED', 'COURSE_EMAIL_SENT'] } }
    const [events, total] = await Promise.all([
      ctx.models.MembershipEvent.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      ctx.models.MembershipEvent.countDocuments(filter),
    ])
    const members = await ctx.models.Membership.find({ environment: ctx.config.environment, _id: { $in: events.map(e => e.membershipId) } }).select('email plan customerId status startedAt expiresAt revokedAt paymentStatus').lean()
    const customers = await ctx.models.Customer.find({ environment: ctx.config.environment, _id: { $in: members.map(m => m.customerId).filter(Boolean) } }).select('emailVerifiedAt').lean()
    const byId = new Map(members.map(m => [String(m._id), m])), verified = new Set(customers.filter(c => c.emailVerifiedAt).map(c => String(c._id)))
    res.json({ success: true, data: { items: events.map(e => {
      const m = byId.get(String(e.membershipId))
      return { eventId: e.eventId, email: m?.email, plan: m?.plan, type: e.type, createdAt: e.createdAt,
        emailVerified: verified.has(String(m?.customerId)), accessGranted: hasAccess(m), emailId: e.type.endsWith('ACCEPTED') || e.type === 'COURSE_EMAIL_SENT' ? e.reason : undefined }
    }), total, totalPages: Math.ceil(total / q.limit) } })
  })
  return router
}
