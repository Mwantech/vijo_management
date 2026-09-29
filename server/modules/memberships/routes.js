import { Router, json } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { fail, parse, digest } from '../payments/domain.js'
import { paymentError } from '../payments/routes.js'
import { requestCode, verifyCode, customerFor, memberCookie, sessionToken } from './auth.js'
import { emailSchema, publicMembership, hasAccess, pageSchema } from './domain.js'

export function ready(ctx) {
  if (!ctx?.ready || !ctx.memberships?.enabled || ctx.connection.readyState !== 1) fail('MEMBERSHIPS_UNAVAILABLE', 'Membership service is not configured or is temporarily unavailable.', 503)
}
export const scoped = ctx => ({ environment: ctx.config.environment })
export async function requireCustomer(ctx, req) {
  const customer = await customerFor(ctx, req)
  if (!customer) fail('UNAUTHORIZED', 'Sign in with your email access code.', 401)
  return customer
}
export async function requireEntitlement(ctx, customer) {
  const memberships = await ctx.models.Membership.find({ ...scoped(ctx), customerId: customer._id, plan: 'premium_blog' })
  if (!memberships.some(m => hasAccess(m))) fail('FORBIDDEN', 'An active Premium Blog Membership is required.', 403)
}
export function membershipRouter(ctx) {
  const router = Router()
  router.use((req, res, next) => { ready(ctx); res.set('Cache-Control', 'private, no-store'); next() })
  router.use(cors({ credentials: true, origin(origin, cb) { cb(null, !origin || origin === ctx.memberships.origin) } }))
  router.use(json({ limit: '8kb', inflate: false }))
  router.use((req, _res, next) => {
    if (req.method !== 'GET' && req.get('Origin') !== ctx.memberships.origin) fail('FORBIDDEN', 'Website origin is required.', 403)
    next()
  })
  const send = (res, data) => res.json({ success: true, data })
  router.post('/membership/auth/request-code', async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }).strict(), req.body)
    send(res, await requestCode(ctx, email, req.ip))
  })
  router.post('/membership/auth/verify-code', async (req, res) => {
    const body = parse(z.object({ challengeId: z.string().regex(/^challenge_[A-Za-z0-9_-]{24}$/), code: z.string().regex(/^\d{8}$/) }).strict(), req.body)
    const token = await verifyCode(ctx, body.challengeId, body.code, req.ip)
    res.set('Set-Cookie', memberCookie(ctx, token)); send(res, { authenticated: true })
  })
  router.post('/membership/auth/logout', async (req, res) => {
    await ctx.models.MemberSession.deleteOne({ ...scoped(ctx), tokenHash: digest(sessionToken(req)) })
    res.set('Set-Cookie', memberCookie(ctx, '')); send(res, { authenticated: false })
  })
  router.get('/membership/me', async (req, res) => {
    const customer = await requireCustomer(ctx, req)
    const memberships = await ctx.models.Membership.find({ ...scoped(ctx), customerId: customer._id })
    send(res, { email: customer.email, memberships: memberships.map(publicMembership), accessGranted: memberships.some(m => m.plan === 'premium_blog' && hasAccess(m)) })
  })
  router.get(['/content/posts', '/premium/content'], async (req, res) => {
    if (req.path.startsWith('/premium')) await requireEntitlement(ctx, await requireCustomer(ctx, req))
    const q = parse(pageSchema, req.query), filter = { ...scoped(ctx), published: true }
    const [data, total] = await Promise.all([
      ctx.models.Post.find(filter).select('slug title excerpt category visibility publishedAt -_id').sort({ publishedAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      ctx.models.Post.countDocuments(filter),
    ])
    send(res, { items: data, page: q.page, total, totalPages: Math.ceil(total / q.limit) })
  })
  router.get(['/content/posts/:slug', '/premium/posts/:slug'], async (req, res) => {
    const slug = parse(z.string().regex(/^[a-z0-9-]{1,140}$/), req.params.slug)
    const post = await ctx.models.Post.findOne({ ...scoped(ctx), slug, published: true }).select('slug title excerpt category visibility publishedAt requiredEntitlement -_id').lean()
    if (!post) fail('RESOURCE_NOT_FOUND', 'Article not found.', 404)
    if (post.visibility === 'premium' || req.path.startsWith('/premium')) await requireEntitlement(ctx, await requireCustomer(ctx, req))
    const full = await ctx.models.Post.findOne({ ...scoped(ctx), slug, published: true, visibility: post.visibility }).select('content -_id').lean()
    if (!full) fail('RESOURCE_NOT_FOUND', 'Article changed. Please refresh.', 404)
    send(res, { ...post, content: full?.content })
  })
  router.use(paymentError)
  return router
}
