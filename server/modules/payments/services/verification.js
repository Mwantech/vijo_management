import { canTransition, fail, id } from '../domain.js'
import { transaction } from '../database.js'
import { emit } from './events.js'

export async function applyVerifiedPayment(ctx, evidence) {
  return transaction(ctx.connection, async session => {
    const payment = await ctx.models.Payment.findOne({ paymentId: evidence.paymentId }).session(session)
    const attempt = payment && await ctx.models.Attempt.findOne({ attemptId: evidence.attemptId, paymentId: payment._id }).session(session)
    if (!payment || !attempt || evidence.accountId !== payment.providerAccountId || payment.environment !== ctx.config.environment) fail('PROVIDER_CORRELATION_FAILED', 'Payment correlation requires review.', 422)
    if (evidence.amount !== payment.amount.toString() || evidence.currency !== payment.currency || evidence.method !== 'card' || (attempt.checkoutId && attempt.checkoutId !== evidence.checkoutId)) {
      await ctx.models.Payment.updateOne({ _id: payment._id }, { $set: { verificationStatus: 'REVIEW_REQUIRED' } }, { session })
      return { review: true }
    }
    if (evidence.status === 'UNKNOWN') return { review: true }
    if (evidence.status === 'SUCCEEDED') {
      await ctx.models.Transaction.updateOne({ providerReference: evidence.providerId, type: 'PAYMENT', providerAccountId: evidence.accountId, environment: ctx.config.environment }, { $setOnInsert: {
        transactionId: id('txn'), paymentId: payment._id, applicationId: payment.applicationId, providerReference: evidence.providerId,
        providerAccountId: evidence.accountId, amount: evidence.amount, currency: evidence.currency, type: 'PAYMENT', status: 'POSTED', occurredAt: evidence.occurredAt,
        environment: ctx.config.environment,
      } }, { upsert: true, session, runValidators: true })
      if (payment.winningProviderId && payment.winningProviderId !== evidence.providerId) {
        await ctx.models.Payment.updateOne({ _id: payment._id }, { $set: { verificationStatus: 'REVIEW_REQUIRED' } }, { session })
        return { review: true }
      }
    } else if (attempt.attemptId !== payment.activeAttemptId) return { ignored: true }
    const changes = { lastVerifiedAt: new Date(), verificationStatus: 'CURRENT' }
    if (evidence.status === 'SUCCEEDED') changes.winningProviderId = evidence.providerId
    const transitions = canTransition(payment.status, evidence.status)
    if (transitions) {
      changes.status = evidence.status
      if (evidence.status === 'SUCCEEDED') changes.completedAt = evidence.occurredAt
      if (evidence.status === 'FAILED') changes.failedAt = new Date()
    }
    // Refunded totals need refund identifiers, not guesses from a cumulative amount.
    if (BigInt(evidence.refunded) !== BigInt(payment.refundedAmount.toString())) changes.verificationStatus = 'REVIEW_REQUIRED'
    const updated = await ctx.models.Payment.findOneAndUpdate({ _id: payment._id, version: payment.version },
      { $set: changes, $inc: { version: 1 } }, { new: true, session, runValidators: true })
    if (!updated) fail('REQUEST_CONFLICT', 'Payment changed during verification.')
    if (attempt.status !== 'SUCCEEDED') await ctx.models.Attempt.updateOne({ _id: attempt._id }, { $set: { status: evidence.status, providerPaymentId: evidence.providerId, checkoutId: evidence.checkoutId || attempt.checkoutId } }, { session })
    if (transitions) await emit(ctx, session, updated, `payment.${evidence.status.toLowerCase()}`)
    return { review: changes.verificationStatus === 'REVIEW_REQUIRED' }
  })
}
