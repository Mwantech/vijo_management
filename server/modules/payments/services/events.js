import { id } from '../domain.js'

export async function emit(ctx, session, payment, type) {
  const eventId = id('evt'), createdAt = new Date()
  const body = JSON.stringify({ id: eventId, type, schemaVersion: 1, createdAt, data: {
    paymentId: payment.paymentId, reference: payment.reference, amount: payment.amount.toString(),
    currency: payment.currency, provider: payment.provider, status: payment.status, paymentVersion: payment.version,
    refundedAmount: payment.refundedAmount.toString(),
  } })
  const [event] = await ctx.models.Event.create([{ eventId, paymentId: payment._id, applicationId: payment.applicationId,
    type, version: payment.version, body, environment: ctx.config.environment }], { session })
  const app = await ctx.models.Application.findById(payment.applicationId).session(session)
  if (!app.webhook?.enabled) return
  await ctx.models.Delivery.create([{ deliveryId: id('dlv'), eventId: event._id, applicationId: payment.applicationId,
    destinationVersion: app.webhook.version, status: app.webhook.enabled ? 'PENDING' : 'PAUSED',
    environment: ctx.config.environment }], { session })
}
export async function audit(ctx, actor, action, targetId, requestId, session) {
  await ctx.models.Audit.create([{ actor, action, targetId, requestId, environment: ctx.config.environment }], { session })
}
