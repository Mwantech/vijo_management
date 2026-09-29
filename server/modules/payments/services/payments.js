import { id, digest, canonical, fail } from '../domain.js'
import { decrypt } from '../crypto.js'
import { transaction } from '../database.js'
import { emit, audit } from './events.js'

export function paymentDTO(ctx, payment, attempt) {
  return { paymentId: payment.paymentId, reference: payment.reference, amount: payment.amount.toString(),
    currency: payment.currency, status: payment.status, version: payment.version, verificationStatus: payment.verificationStatus,
    refundedAmount: payment.refundedAmount.toString(), createdAt: payment.createdAt, completedAt: payment.completedAt,
    checkout: attempt?.encryptedUrl && payment.status === 'PENDING' ? { url: decrypt(attempt.encryptedUrl, ctx.config.encryptionKey) } : null }
}
export async function getPayment(ctx, app, filter) {
  const payment = await ctx.models.Payment.findOne({ ...filter, applicationId: app._id })
  if (!payment) fail('RESOURCE_NOT_FOUND', 'Payment not found.', 404)
  const attempt = await ctx.models.Attempt.findOne({ attemptId: payment.activeAttemptId, applicationId: app._id })
  return paymentDTO(ctx, payment, attempt)
}
async function replay(ctx, app, key, hash) {
  const record = await ctx.models.Idempotency.findOne({ applicationId: app._id, key })
  if (!record) return null
  if (record.requestHash !== hash) fail('IDEMPOTENCY_CONFLICT', 'This key was used for a different request.')
  return { data: JSON.parse(record.response), replayed: true }
}
export async function idempotent(ctx, app, key, hash, operation) {
  const existing = await replay(ctx, app, key, hash)
  if (existing) return existing
  try { return { data: await transaction(ctx.connection, operation), replayed: false } }
  catch (error) {
    if (error.code !== 11000) throw error
    const winner = await replay(ctx, app, key, hash)
    if (winner) return winner
    fail('REQUEST_CONFLICT', 'A concurrent operation exists. Retry this same request and key.')
  }
}
export async function acceptPayment(ctx, app, dto, key) {
  const hash = digest(canonical({ operation: 'create:v1', ...dto }))
  // Replays must work even while new creation is paused.
  const existing = await replay(ctx, app, key, hash)
  if (existing) return existing
  if (!ctx.config.creationEnabled) fail('PAYMENT_CREATION_PAUSED', 'New payments are paused.', 503)
  if (ctx.config.providerEnvironment === 'production' && !ctx.config.liveCheckoutSupported) fail('CHECKOUT_SAFETY_UNVERIFIED', 'Live checkout requires a verified single-payment collection flow.', 503)
  if (!app.currencies.includes(dto.currency) || BigInt(dto.amount) > BigInt(app.maxAmount)) fail('PAYMENT_LIMIT', 'Currency or amount is not permitted.', 422)
  return idempotent(ctx, app, key, hash, async session => {
    let payment = await ctx.models.Payment.findOne({ applicationId: app._id, reference: dto.reference }).session(session)
    if (payment && payment.requestHash !== hash) fail('REFERENCE_CONFLICT', 'Reference already exists with different payment details.')
    if (!payment) {
      const attemptId = id('att')
      ;[payment] = await ctx.models.Payment.create([{ paymentId: id('pay'), applicationId: app._id, reference: dto.reference,
        requestHash: hash, amount: dto.amount, currency: dto.currency, customer: dto.customer, metadata: dto.metadata,
        status: 'CREATED', activeAttemptId: attemptId, providerAccountId: ctx.config.accountId, environment: ctx.config.environment }], { session })
      await ctx.models.Attempt.create([{ attemptId, applicationId: app._id, paymentId: payment._id, sequence: 1,
        status: 'CREATED', providerKey: id('op'), environment: ctx.config.environment }], { session })
      await ctx.models.Job.create([{ operationKey: `checkout:${attemptId}`, operation: 'CREATE_CHECKOUT', paymentId: payment._id,
        applicationId: app._id, attemptId, status: 'PENDING', environment: ctx.config.environment }], { session })
      await emit(ctx, session, payment, 'payment.created')
      await audit(ctx, app.applicationId, 'PAYMENT_CREATED', payment.paymentId, undefined, session)
    }
    const data = paymentDTO(ctx, payment)
    await ctx.models.Idempotency.create([{ applicationId: app._id, key, requestHash: hash, paymentId: payment.paymentId,
      response: JSON.stringify(data), environment: ctx.config.environment }], { session })
    return data
  })
}
export async function requestRefund(ctx, app, paymentId, dto, key, requestId) {
  const hash = digest(canonical({ operation: `refund:v1:${paymentId}`, ...dto }))
  const existing = await replay(ctx, app, key, hash)
  if (existing) return existing
  if (!ctx.config.refundsEnabled) fail('CAPABILITY_NOT_SUPPORTED', 'Refund requests are disabled.', 422)
  return idempotent(ctx, app, key, hash, async session => {
    const payment = await ctx.models.Payment.findOne({ paymentId, applicationId: app._id }).session(session)
    if (!payment) fail('RESOURCE_NOT_FOUND', 'Payment not found.', 404)
    if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status) || payment.verificationStatus !== 'CURRENT') fail('NOT_REFUNDABLE', 'Payment requires verification before refunding.')
    const reserved = BigInt(payment.reservedAmount.toString()), refunded = BigInt(payment.refundedAmount.toString())
    if (reserved + refunded + BigInt(dto.amount) > BigInt(payment.amount.toString())) fail('REFUND_LIMIT', 'Refund exceeds available captured funds.')
    const result = await ctx.models.Payment.updateOne({ _id: payment._id, version: payment.version }, { $set: { reservedAmount: (reserved + BigInt(dto.amount)).toString() }, $inc: { version: 1 } }, { session })
    if (!result.modifiedCount) fail('REQUEST_CONFLICT', 'Payment changed; retry the same request.')
    const refundId = id('ref')
    await ctx.models.Refund.create([{ refundId, paymentId: payment._id, applicationId: app._id, amount: dto.amount,
      currency: payment.currency, reason: dto.reason, status: 'REQUESTED', providerKey: id('op'), environment: ctx.config.environment }], { session })
    await ctx.models.Job.create([{ operationKey: `refund:${refundId}`, operation: 'REFUND', paymentId: payment._id,
      applicationId: app._id, refundId, status: 'PENDING', environment: ctx.config.environment }], { session })
    const data = { refundId, paymentId, amount: dto.amount, currency: payment.currency, status: 'REQUESTED' }
    await ctx.models.Idempotency.create([{ applicationId: app._id, key, requestHash: hash, paymentId,
      response: JSON.stringify(data), environment: ctx.config.environment }], { session })
    await audit(ctx, app.applicationId, 'REFUND_REQUESTED', refundId, requestId, session)
    return data
  })
}
