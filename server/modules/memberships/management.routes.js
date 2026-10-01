import { Router } from 'express'
import { z } from 'zod'
import { authenticateManagementUser, authorizeRoles } from '../../middleware/auth.js'
import { managementConfig } from '../../config/index.js'
import { fail, parse, id } from '../payments/domain.js'
import { paymentError } from '../payments/routes.js'
import { transaction } from '../payments/database.js'
import { ready, scoped } from './routes.js'
import { pageSchema, postSchema, publicMembership, emailSchema } from './domain.js'
import { membershipStatus } from './status.js'
import { products, planSchema } from './products.js'
import { membershipEmailRouter } from './email.routes.js'

export function membershipManagementRouter(ctx) {
  const router = Router()
  router.use(authenticateManagementUser, authorizeRoles('super_admin', 'admin', 'finance'))
  router.get('/memberships/status', (_req, res) => res.set('Cache-Control', 'private, no-store').json({ success: true, data: membershipStatus(ctx) }))
  router.use((req, res, next) => {
    ready(ctx); res.set('Cache-Control', 'private, no-store')
    if (req.path.startsWith('/content/') && !['admin', 'super_admin'].includes(req.managementUser.role)) fail('FORBIDDEN', 'Content management requires an administrator.', 403)
    if (req.method !== 'GET') {
      if (!['admin', 'super_admin'].includes(req.managementUser.role) || req.managementUser.authType !== 'session') fail('FORBIDDEN', 'An administrator session is required.', 403)
      const origin = req.get('Origin'), own = `${req.protocol}://${req.get('host')}`
      if (!origin || (origin !== own && !managementConfig.allowedOrigins.includes(origin))) fail('FORBIDDEN', 'Invalid administrator origin.', 403)
    }
    next()
  })
  const send = (res, data) => res.json({ success: true, data })
  router.use('/memberships/email', membershipEmailRouter(ctx))
  router.get('/content/products', (_req, res) => send(res, products))
  router.get('/memberships', async (req, res) => {
    const q = parse(pageSchema, req.query), filter = scoped(ctx)
    if (q.search) filter.email = { $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    const [rows, total] = await Promise.all([ctx.models.Membership.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit), ctx.models.Membership.countDocuments(filter)])
    send(res, { items: rows.map(m => ({ ...publicMembership(m), email: m.email, amount: m.amount, currency: m.currency })), page: q.page, total, totalPages: Math.ceil(total / q.limit) })
  })
  router.get('/memberships/:id', async (req, res) => {
    const key = parse(z.string().regex(/^mem_[A-Za-z0-9_-]{24}$/), req.params.id)
    const m = await ctx.models.Membership.findOne({ ...scoped(ctx), membershipId: key })
    if (!m) fail('RESOURCE_NOT_FOUND', 'Membership not found.', 404)
    const [events, receipts] = await Promise.all([
      ctx.models.MembershipEvent.find({ membershipId: m._id }).select('eventId type actor reason createdAt -_id').sort({ createdAt: -1 }).limit(100).lean(),
      ctx.models.MembershipReceipt.find({ membershipId: m._id }).select('providerPaymentId amount currency paidAt refundedAmount -_id').limit(100).lean(),
    ])
    send(res, { ...publicMembership(m), email: m.email, amount: m.amount, currency: m.currency, providerMembershipId: m.providerMembershipId, productId: m.productId, events, receipts })
  })
  router.post('/memberships', async (req, res) => {
    const dto = parse(z.object({ email: emailSchema, plan: planSchema.default('premium_blog'), reason: z.string().trim().min(10).max(500) }).strict(), req.body)
    let created
    await transaction(ctx.connection, async session => {
      const customer = await ctx.models.Customer.findOne({ ...scoped(ctx), email: dto.email }).session(session)
      ;[created] = await ctx.models.Membership.create([{ ...scoped(ctx), membershipId: id('mem'), email: dto.email, provider: 'manual',
        plan: dto.plan, status: 'active', paymentStatus: 'manual', startedAt: new Date(), overrideReason: dto.reason,
        ...(customer?.emailVerifiedAt ? { customerId: customer._id } : {}) }], { session })
      await ctx.models.MembershipEvent.create([{ ...scoped(ctx), eventId: id('evt'), membershipId: created._id, effectKey: `manual:${created.membershipId}`, type: 'ACCESS_GRANTED', actor: req.managementUser.id, reason: dto.reason }], { session })
    })
    send(res.status(201), publicMembership(created))
  })
  router.post('/memberships/:id/:action', async (req, res) => {
    const key = parse(z.string().regex(/^mem_[A-Za-z0-9_-]{24}$/), req.params.id)
    const action = parse(z.enum(['grant', 'revoke']), req.params.action)
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(500) }).strict(), req.body)
    await transaction(ctx.connection, async session => {
      const update = action === 'revoke' ? { $set: { revokedAt: new Date(), overrideReason: reason }, $inc: { version: 1 } } :
        { $unset: { revokedAt: 1 }, $set: { status: 'active', paymentStatus: 'manual', overrideReason: reason }, $inc: { version: 1 } }
      const m = await ctx.models.Membership.findOneAndUpdate({ ...scoped(ctx), membershipId: key }, update, { new: true, session })
      if (!m) fail('RESOURCE_NOT_FOUND', 'Membership not found.', 404)
      await ctx.models.MembershipEvent.create([{ ...scoped(ctx), eventId: id('evt'), membershipId: m._id, effectKey: `admin:${m.membershipId}:${m.version}`, type: action === 'grant' ? 'ACCESS_GRANTED' : 'ACCESS_REVOKED', actor: req.managementUser.id, reason }], { session })
    })
    send(res, { updated: true })
  })
  router.get('/content/posts', async (req, res) => {
    const q = parse(pageSchema, req.query)
    send(res, await ctx.models.Post.find(scoped(ctx)).select('slug title excerpt content visibility category published requiredEntitlement -_id').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean())
  })
  router.put('/content/posts/:slug', async (req, res) => {
    const dto = parse(postSchema, { ...req.body, slug: req.params.slug })
    const post = await ctx.models.Post.findOneAndUpdate({ ...scoped(ctx), slug: dto.slug }, { $set: { ...dto, ...(dto.published ? { publishedAt: new Date() } : {}) } }, { upsert: true, new: true })
    console.log(JSON.stringify({ level: 'info', event: 'management_audit', action: 'CONTENT_UPDATED', managementUserId: req.managementUser.id, requestId: req.id, targetId: post.slug }))
    send(res, { slug: post.slug })
  })
  router.use(paymentError)
  return router
}
