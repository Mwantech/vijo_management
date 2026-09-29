import { id } from './domain.js'
import { encrypt } from './crypto.js'
import { transaction } from './database.js'
import { emit } from './services/events.js'
import { applyVerifiedPayment } from './services/verification.js'
import { applyVerifiedRefund } from './services/refunds.js'
import { deliver } from './webhooks.js'
import { scheduleVerification } from './reconciliation.js'
import { processMembershipEvent } from '../memberships/fulfillment.js'
import { scheduleMembershipVerification } from '../memberships/reconciliation.js'

const delays = [30000, 120000, 600000, 3600000, 21600000, 43200000, 86400000]
export async function claim(model) {
  const now = new Date()
  return model.findOneAndUpdate({ $or: [{ status: { $in: ['PENDING', 'RETRY'] }, nextRunAt: { $lte: now } }, { status: 'IN_FLIGHT', leaseUntil: { $lte: now } }] },
    { $set: { status: 'IN_FLIGHT', leaseToken: id('lease'), leaseUntil: new Date(Date.now() + 60000) }, $inc: { count: 1 } }, { new: true, sort: { nextRunAt: 1 } })
}
const owned = job => ({ _id: job._id, leaseToken: job.leaseToken, status: 'IN_FLIGHT' })
async function finish(model, job, status, extra = {}) {
  await model.updateOne(owned(job), { $set: { status, ...extra }, $unset: { leaseToken: 1, leaseUntil: 1 } })
}
async function providerJob(ctx, job) {
  const payment = await ctx.models.Payment.findById(job.paymentId)
  if (job.operation === 'VERIFY') {
    const attempt = await ctx.models.Attempt.findOne({ attemptId: payment.activeAttemptId })
    const providerId = payment.winningProviderId || attempt?.providerPaymentId
    if (!providerId) return finish(ctx.models.Job, job, 'REVIEW_REQUIRED', { lastError: 'PROVIDER_REFERENCE_UNKNOWN' })
    const result = await applyVerifiedPayment(ctx, await ctx.provider.getPaymentStatus(providerId))
    return finish(ctx.models.Job, job, result.review ? 'REVIEW_REQUIRED' : 'DONE')
  }
  const attempt = await ctx.models.Attempt.findOne({ attemptId: job.attemptId })
  const app = await ctx.models.Application.findById(payment.applicationId)
  if (job.operation === 'CREATE_CHECKOUT' && ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) return finish(ctx.models.Job, job, 'DONE')
  // Never reuse Whop's expired 24-hour idempotency window, even after a worker crash.
  if (job.firstSubmittedAt && Date.now() - job.firstSubmittedAt.getTime() >= 23 * 3600000) return finish(ctx.models.Job, job, 'REVIEW_REQUIRED', { lastError: 'PROVIDER_IDEMPOTENCY_WINDOW_EXPIRED' })
  if (job.operation === 'REFUND') {
    const refund = await ctx.models.Refund.findOne({ refundId: job.refundId })
    const body = job.providerRequest || ctx.provider.refundBody(refund.amount.toString(), refund.currency)
    const fence = await ctx.models.Job.updateOne(owned(job), { $set: { providerRequest: body, firstSubmittedAt: job.firstSubmittedAt || new Date() } })
    if (!fence.modifiedCount) return
    await ctx.provider.refund(payment.winningProviderId, body, refund.providerKey)
    await ctx.models.Refund.updateOne({ _id: refund._id, status: { $in: ['REQUESTED', 'UNKNOWN'] } }, { $set: { status: 'PENDING' } })
    return finish(ctx.models.Job, job, 'DONE')
  }
  if (!ctx.config.creationEnabled || app.status !== 'ACTIVE') return finish(ctx.models.Job, job, 'RETRY', { nextRunAt: new Date(Date.now() + 60000) })
  if (ctx.config.providerEnvironment === 'production' && !ctx.config.liveCheckoutSupported) return finish(ctx.models.Job, job, 'REVIEW_REQUIRED', { lastError: 'CHECKOUT_SAFETY_UNVERIFIED' })
  const body = job.providerRequest || ctx.provider.checkoutBody(payment, attempt, app)
  const fence = await ctx.models.Job.updateOne(owned(job), { $set: { providerRequest: body, firstSubmittedAt: job.firstSubmittedAt || new Date() } })
  if (!fence.modifiedCount) return
  const checkout = await ctx.provider.createPayment(body, attempt.providerKey)
  await transaction(ctx.connection, async session => {
    const lock = await ctx.models.Job.updateOne(owned(job), { $set: { status: 'DONE' } }, { session })
    if (!lock.modifiedCount) return
    await ctx.models.Attempt.updateOne({ _id: attempt._id }, { $set: { checkoutId: checkout.checkoutId, encryptedUrl: encrypt(checkout.url, ctx.config.encryptionKey) } }, { session })
    const updated = await ctx.models.Payment.findOneAndUpdate({ _id: payment._id, status: 'CREATED' }, { $set: { status: 'PENDING' }, $inc: { version: 1 } }, { new: true, session })
    if (updated) {
      await ctx.models.Attempt.updateOne({ _id: attempt._id, status: 'CREATED' }, { $set: { status: 'PENDING' } }, { session })
      await emit(ctx, session, updated, 'payment.pending')
    }
  })
}
async function inboxJob(ctx, job) {
  if (await processMembershipEvent(ctx, job)) return finish(ctx.models.Inbox, job, 'DONE')
  if (job.providerMembershipId) return finish(ctx.models.Inbox, job, 'DONE')
  const evidence = await ctx.provider.getPaymentStatus(job.providerPaymentId)
  let result = await applyVerifiedPayment(ctx, evidence)
  if (job.providerRefundId) result = await applyVerifiedRefund(ctx, await ctx.provider.getRefundStatus(job.providerRefundId))
  await finish(ctx.models.Inbox, job, result.review ? 'REVIEW_REQUIRED' : 'DONE')
}
async function deliveryJob(ctx, job) {
  const app = await ctx.models.Application.findById(job.applicationId)
  if (!app?.webhook.enabled || app.webhook.version !== job.destinationVersion) return finish(ctx.models.Delivery, job, 'PAUSED')
  const event = await ctx.models.Event.findById(job.eventId)
  await ctx.models.DeliveryAttempt.create({ deliveryId: job._id, attemptNumber: job.count, outcome: 'STARTED', environment: ctx.config.environment })
  let status
  try { status = await deliver(ctx, app, event) } catch { status = 0 }
  const ok = status >= 200 && status < 300
  await ctx.models.DeliveryAttempt.updateOne({ deliveryId: job._id, attemptNumber: job.count }, { $set: { outcome: ok ? 'DELIVERED' : 'FAILED', httpStatus: status, finishedAt: new Date() } })
  await finish(ctx.models.Delivery, job, ok ? 'DELIVERED' : job.count >= 8 ? 'DEAD' : 'RETRY', {
    lastHttpStatus: status, ...(ok ? { deliveredAt: new Date() } : { nextRunAt: new Date(Date.now() + delays[Math.min(job.count - 1, 6)]), lastError: 'DELIVERY_FAILED' }),
  })
}
export async function tick(ctx) {
  for (const [model, handle] of [[ctx.models.Inbox, inboxJob], [ctx.models.Job, providerJob], [ctx.models.Delivery, deliveryJob]]) {
    const job = await claim(model)
    if (!job) continue
    try { await handle(ctx, job) }
    catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : 'PAYMENT_WORK_FAILED'
      console.error(JSON.stringify({ level: 'error', event: 'payment_work_failed', jobId: String(job._id), errorCode: code }))
      const permanent = ['PROVIDER_CORRELATION_FAILED', 'PROVIDER_INVALID_RESPONSE', 'PROVIDER_INVALID_MONEY'].includes(code)
      await finish(model, job, permanent || job.count >= 8 ? (model === ctx.models.Delivery ? 'DEAD' : 'REVIEW_REQUIRED') : 'RETRY', { lastError: code, nextRunAt: new Date(Date.now() + delays[Math.min(job.count - 1, 6)]) })
    }
  }
}
export function startWorker(ctx) {
  let stopped = false, running = Promise.resolve(), timer, lastScheduled = 0
  const run = () => {
    running = (async () => {
      if (Date.now() - lastScheduled > 60000) { await scheduleVerification(ctx); await scheduleMembershipVerification(ctx); lastScheduled = Date.now() }
      await tick(ctx)
    })().catch(() => console.error(JSON.stringify({ level: 'error', event: 'payment_worker_unavailable' }))).finally(() => {
      if (!stopped) { timer = setTimeout(run, 2000); timer.unref() }
    })
  }
  run()
  return async () => { stopped = true; clearTimeout(timer); await running }
}
