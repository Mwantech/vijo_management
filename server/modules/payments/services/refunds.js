import { transaction } from '../database.js'
import { fail, id } from '../domain.js'
import { emit } from './events.js'

export async function applyVerifiedRefund(ctx, evidence) {
  return transaction(ctx.connection, async session => {
    const payment = await ctx.models.Payment.findOne({ winningProviderId: evidence.providerPaymentId, providerAccountId: evidence.accountId }).session(session)
    if (!payment || payment.currency !== evidence.currency) fail('PROVIDER_CORRELATION_FAILED', 'Refund requires review.', 422)
    const refund = await ctx.models.Refund.findOne({ paymentId: payment._id, providerRefundId: evidence.providerId }).session(session)
    if (refund && refund.amount.toString() !== evidence.amount) fail('PROVIDER_CORRELATION_FAILED', 'Refund amount requires review.', 422)
    if (!['succeeded', 'failed', 'canceled'].includes(evidence.status)) return { pending: true }
    const prior = await ctx.models.Transaction.findOne({ providerAccountId: evidence.accountId, providerReference: evidence.providerId, type: 'REFUND', environment: ctx.config.environment }).session(session)
    if (prior) return { duplicate: true }
    const release = refund && !['SUCCEEDED', 'FAILED'].includes(refund.status) ? BigInt(refund.amount.toString()) : 0n
    const total = BigInt(payment.refundedAmount.toString()) + (evidence.status === 'succeeded' ? BigInt(evidence.amount) : 0n)
    if (total > BigInt(payment.amount.toString()) || release > BigInt(payment.reservedAmount.toString())) fail('PROVIDER_CORRELATION_FAILED', 'Refund totals require review.', 422)
    if (refund) await ctx.models.Refund.updateOne({ _id: refund._id }, { $set: { status: evidence.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED' } }, { session })
    const changes = { refundedAmount: total.toString(), reservedAmount: (BigInt(payment.reservedAmount.toString()) - release).toString(),
      verificationStatus: refund || payment.reservedAmount.toString() === '0' ? 'CURRENT' : 'REVIEW_REQUIRED' }
    if (evidence.status === 'succeeded') {
      changes.status = total === BigInt(payment.amount.toString()) ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
      await ctx.models.Transaction.create([{ transactionId: id('txn'), paymentId: payment._id, applicationId: payment.applicationId,
        providerReference: evidence.providerId, providerAccountId: evidence.accountId, type: 'REFUND', amount: evidence.amount,
        currency: evidence.currency, occurredAt: evidence.occurredAt, environment: ctx.config.environment }], { session })
    }
    const updated = await ctx.models.Payment.findOneAndUpdate({ _id: payment._id, version: payment.version }, { $set: changes, $inc: { version: 1 } }, { new: true, session })
    if (!updated) fail('REQUEST_CONFLICT', 'Payment changed during refund verification.')
    if (evidence.status === 'succeeded') await emit(ctx, session, updated, `payment.${updated.status.toLowerCase()}`)
    return { review: changes.verificationStatus === 'REVIEW_REQUIRED' }
  })
}
