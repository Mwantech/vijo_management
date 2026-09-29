import { Router, raw, json } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { parse as parseLossless } from 'lossless-json'
import { digest, fail, parse, paymentSchema, refundSchema, publicId, keySchema } from './domain.js'
import { equal, verifyWhop } from './crypto.js'
import { acceptPayment, getPayment, requestRefund } from './services/payments.js'
import { authenticateSignedApplication } from './managementAuth.js'

export function paymentError(error, req, res, _next) {
  void _next
  const status = error.status && error.status >= 400 && error.status <= 599 ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 503
  const code = typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : status === 400 ? 'VALIDATION_ERROR' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'PAYMENTS_UNAVAILABLE'
  console.error(JSON.stringify({ level: 'error', event: 'payment_request_failed', requestId: req.id, errorCode: code, statusCode: status }))
  res.status(status).json({ success: false, error: { code, message: code === 'PAYMENTS_UNAVAILABLE' ? 'Payment service is unavailable.' : error.message }, requestId: req.id })
}
function ready(ctx) {
  if (!ctx.ready || ctx.connection.readyState !== 1) fail('PAYMENTS_UNAVAILABLE', 'Payment service is unavailable.', 503)
  if (ctx.providerReady === false) fail('PAYMENTS_CONFIGURATION', 'Payment provider is not configured or is unavailable.', 503)
}
export function webhookRouter(ctx) {
  const router = Router()
  router.post('/whop/webhook', rateLimit({ windowMs: 60000, limit: 600 }), raw({ type: 'application/json', limit: '256kb', inflate: false }), async (req, res) => {
    ready(ctx)
    const providerEventId = verifyWhop(req.body, req.headers, ctx.config)
    let body
    try { body = parseLossless(req.body.toString('utf8')) } catch { fail('INVALID_EVENT', 'Invalid webhook body.', 400) }
    if (body.id !== providerEventId || body.account_id !== ctx.config.accountId || body.api_version_date !== ctx.config.apiVersion || typeof body.type !== 'string') fail('INVALID_EVENT', 'Webhook account, ID or version does not match.', 400)
    const supported = ['payment.succeeded', 'payment.failed', 'payment.pending', 'payment.created', 'payment.canceled', 'payment.authorized', 'refund.created', 'refund.updated']
    if (ctx.memberships?.enabled && ctx.memberships.productId && ctx.memberships.planIds?.length) supported.push('membership.activated', 'membership.deactivated', 'membership.cancel_at_period_end_changed')
    if (!supported.includes(body.type)) return res.json({ success: true })
    const isMembership = body.type.startsWith('membership.')
    const providerMembershipId = isMembership ? body.data?.id : undefined
    const providerPaymentId = isMembership ? undefined : body.type.startsWith('refund.') ? body.data?.payment_id : body.data?.id
    if (isMembership ? !/^mem_[A-Za-z0-9]+$/.test(providerMembershipId || '') : !/^pay_[A-Za-z0-9]+$/.test(providerPaymentId || '')) fail('INVALID_EVENT', 'Provider reference missing.', 400)
    const payloadHash = digest(req.body)
    try {
      const providerRefundId = body.type.startsWith('refund.') ? body.data?.id : undefined
      if (providerRefundId && !/^rf_[A-Za-z0-9]+$/.test(providerRefundId)) fail('INVALID_EVENT', 'Invalid refund reference.', 400)
      await ctx.models.Inbox.create([{ accountId: ctx.config.accountId, providerEventId, providerPaymentId, providerMembershipId, providerRefundId,
        type: body.type, payloadHash, status: 'PENDING', environment: ctx.config.environment }], { writeConcern: { w: 'majority' } })
    } catch (error) {
      if (error.code !== 11000) throw error
      const existing = await ctx.models.Inbox.findOne({ accountId: ctx.config.accountId, environment: ctx.config.environment, providerEventId })
      if (existing?.payloadHash !== payloadHash) fail('EVENT_CONFLICT', 'Duplicate event differs from stored event.')
    }
    res.json({ success: true })
  })
  router.use(paymentError)
  return router
}
export function paymentRouter(ctx) {
  const router = Router()
  router.use(rateLimit({ windowMs: 60000, limit: 120 }))
  router.use(json({ limit: '16kb', inflate: false, verify: (req, _res, buffer) => { req.paymentRawBody = Buffer.from(buffer) } }))
  router.use(async (req, res, next) => {
    ready(ctx)
    let app
    const signed = ['X-Management-Platform', 'X-Management-Key', 'X-Management-Timestamp', 'X-Management-Nonce', 'X-Management-Signature'].some(header => req.get(header) !== undefined)
    if (signed) app = await authenticateSignedApplication(ctx, req)
    else {
      // Preserve non-platform clients. Bound platforms cannot downgrade to API-key-only authentication.
      const clientId = req.get('X-Client-ID'), secret = req.get('X-API-Key')
      if (!clientId || clientId.length > 128 || !secret || secret.length > 256) fail('UNAUTHORIZED', 'Application credentials required.', 401)
      app = await ctx.models.Application.findOne({ clientId, environment: ctx.config.environment })
      const hash = digest(secret), now = Date.now()
      if (!app || app.managementPlatform || !app.credentials.some(c => !c.revokedAt && (!c.expiresAt || c.expiresAt.getTime() > now) && equal(c.secretHash, hash))) fail('UNAUTHORIZED', 'Invalid application credentials.', 401)
    }
    if (app.status !== 'ACTIVE') fail('FORBIDDEN', 'Application is disabled.', 403)
    const window = Math.floor(Date.now() / 60000)
    let bucket
    try {
      bucket = await ctx.models.RateBucket.findOneAndUpdate({ applicationId: app._id, window },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 120000), environment: ctx.config.environment } }, { upsert: true, new: true })
    } catch (error) {
      if (error.code !== 11000) throw error
      bucket = await ctx.models.RateBucket.findOneAndUpdate({ applicationId: app._id, window }, { $inc: { count: 1 } }, { new: true })
    }
    if (!bucket || bucket.count > 120) fail('RATE_LIMITED', 'Application request limit exceeded.', 429)
    req.paymentApplication = app
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  const scope = name => (req, _res, next) => { if (!req.paymentApplication.scopes.includes(name)) fail('FORBIDDEN', 'Application scope is required.', 403); next() }
  const send = (req, res, data) => res.json({ success: true, data, requestId: req.id })
  router.get('/payments/health', scope('payments:read'), async (req, res) => {
    const review = await ctx.models.Job.countDocuments({ applicationId: req.paymentApplication._id, status: 'REVIEW_REQUIRED' })
    const dead = await ctx.models.Delivery.countDocuments({ applicationId: req.paymentApplication._id, status: 'DEAD' })
    send(req, res, { status: review || dead ? 'degraded' : 'unknown', database: 'connected', provider: 'unknown', reviewRequired: review, failedDeliveries: dead,
      newPaymentsEnabled: ctx.config.creationEnabled && (ctx.config.providerEnvironment !== 'production' || ctx.config.liveCheckoutSupported) })
  })
  router.post('/payments', scope('payments:create'), async (req, res) => {
    const result = await acceptPayment(ctx, req.paymentApplication, parse(paymentSchema, req.body), parse(keySchema, req.get('Idempotency-Key')))
    res.status(202).set('Location', `/api/v1/payments/${result.data.paymentId}`)
    if (result.replayed) res.set('Idempotent-Replayed', 'true')
    send(req, res, result.data)
  })
  router.get('/payments/reference/:reference', scope('payments:read'), async (req, res) => send(req, res, await getPayment(ctx, req.paymentApplication, { reference: parse(paymentSchema.shape.reference, req.params.reference) })))
  router.get('/payments/:paymentId', scope('payments:read'), async (req, res) => send(req, res, await getPayment(ctx, req.paymentApplication, { paymentId: parse(publicId, req.params.paymentId) })))
  router.post('/payments/:paymentId/attempts', scope('payments:create'), async (req, _res) => {
    void _res
    await getPayment(ctx, req.paymentApplication, { paymentId: parse(publicId, req.params.paymentId) })
    fail('PAYMENT_NOT_RETRYABLE', 'Reuse the existing checkout. A new checkout requires verified closure of the previous attempt.')
  })
  router.post('/payments/:paymentId/refunds', scope('refunds:create'), async (req, res) => {
    const result = await requestRefund(ctx, req.paymentApplication, parse(publicId, req.params.paymentId), parse(refundSchema, req.body), parse(keySchema, req.get('Idempotency-Key')), req.id)
    res.status(202)
    if (result.replayed) res.set('Idempotent-Replayed', 'true')
    send(req, res, result.data)
  })
  router.get('/payments/:paymentId/refunds/:refundId', scope('refunds:read'), async (req, res) => {
    const payment = await ctx.models.Payment.findOne({ paymentId: parse(publicId, req.params.paymentId), applicationId: req.paymentApplication._id })
    const refund = payment && await ctx.models.Refund.findOne({ refundId: parse(publicId, req.params.refundId), paymentId: payment._id, applicationId: req.paymentApplication._id })
    if (!refund) fail('RESOURCE_NOT_FOUND', 'Refund not found.', 404)
    send(req, res, { refundId: refund.refundId, paymentId: payment.paymentId, amount: refund.amount.toString(), currency: refund.currency, status: refund.status })
  })
  router.get('/transactions', scope('transactions:read'), async (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().regex(/^[a-f0-9]{24}$/).optional(),
      paymentId: publicId.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), type: z.enum(['PAYMENT', 'REFUND', 'REVERSAL', 'FEE']).optional(),
      from: z.string().datetime().optional(), to: z.string().datetime().optional(),
    }).strict().refine(v => !v.from || !v.to || v.from < v.to), req.query)
    const filter = { applicationId: req.paymentApplication._id }
    if (q.cursor) filter._id = { $lt: q.cursor }
    if (q.currency) filter.currency = q.currency
    if (q.type) filter.type = q.type
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lt: new Date(q.to) } : {}) }
    if (q.paymentId) {
      const payment = await ctx.models.Payment.findOne({ paymentId: q.paymentId, applicationId: filter.applicationId })
      if (!payment) fail('RESOURCE_NOT_FOUND', 'Payment not found.', 404)
      filter.paymentId = payment._id
    }
    const rows = await ctx.models.Transaction.find(filter).sort({ _id: -1 }).limit(q.limit + 1)
    const visible = rows.slice(0, q.limit)
    res.json({ success: true, data: visible.map(row => ({ transactionId: row.transactionId, amount: row.amount.toString(), currency: row.currency, type: row.type, status: row.status, createdAt: row.createdAt })),
      pagination: { limit: q.limit, nextCursor: rows.length > q.limit ? visible.at(-1)._id.toString() : null }, requestId: req.id })
  })
  router.use(paymentError)
  return router
}
