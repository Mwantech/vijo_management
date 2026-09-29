import { id, fail, minor } from '../payments/domain.js'
import { transaction } from '../payments/database.js'
import { emailSchema, hasAccess } from './domain.js'

export function normalizeMembership(ctx, value) {
  if ((value.account_id || value.company?.id) !== ctx.config.accountId ||
      value.product?.id !== ctx.memberships.productId || !ctx.memberships.planIds.includes(value.plan?.id)) return null
  if (!/^mem_[A-Za-z0-9]+$/.test(value.id || '') || !/^user_[A-Za-z0-9]+$/.test(value.user?.id || '')) fail('PROVIDER_INVALID_RESPONSE', 'Membership identity is invalid.', 502)
  const email = emailSchema.safeParse(value.user?.email)
  const updatedAt = new Date(value.updated_at), startedAt = new Date(value.joined_at || value.created_at)
  if (!email.success || !Number.isFinite(+updatedAt) || !Number.isFinite(+startedAt)) fail('PROVIDER_INVALID_RESPONSE', 'Membership identity or dates are unavailable.', 502)
  return { providerMembershipId: value.id, providerCustomerId: value.user.id, email: email.data,
    productId: value.product.id, accountId: ctx.config.accountId, providerUpdatedAt: updatedAt, startedAt,
    status: ['active', 'completed'].includes(value.status) ? 'active' : value.status === 'canceled' ? 'cancelled' : value.status === 'expired' ? 'expired' : 'suspended' }
}
export function normalizeReceipt(ctx, value, membershipId) {
  if ((value.account_id || value.company?.id) !== ctx.config.accountId || value.membership?.id !== membershipId ||
      !/^pay_[A-Za-z0-9]+$/.test(value.id || '')) fail('PROVIDER_CORRELATION_FAILED', 'Payment does not belong to membership.', 502)
  if (value.status !== 'paid') return null
  const currency = String(value.currency).toUpperCase()
  if (value.total && String(value.total.currency).toUpperCase() !== currency) fail('PROVIDER_INVALID_MONEY', 'Payment currency mismatch.', 502)
  const amount = minor(value.total?.amount ?? value.final_amount ?? value.subtotal, currency)
  const refundedAmount = minor(value.refunded_amount?.amount ?? value.refunded_amount ?? '0', currency)
  const paidAt = new Date(value.paid_at), providerUpdatedAt = new Date(value.updated_at)
  // This entitlement is specifically the USD 50 one-time plan. Discounts require an explicit policy change.
  if (currency !== 'USD' || amount !== '5000' || !Number.isFinite(+paidAt) || !Number.isFinite(+providerUpdatedAt)) fail('MEMBERSHIP_PAYMENT_REVIEW', 'Purchase amount requires review.', 409)
  return { providerPaymentId: value.id, amount, currency, refundedAmount, paidAt, providerUpdatedAt }
}
export async function fulfill(ctx, membershipValue, paymentValue, eventId) {
  for (let attempt = 0; ; attempt++) {
    try { return await applyFulfillment(ctx, membershipValue, paymentValue, eventId) }
    catch (e) { if (e.code !== 11000 || attempt >= 2) throw e }
  }
}
async function applyFulfillment(ctx, membershipValue, paymentValue, eventId) {
  const normalized = normalizeMembership(ctx, membershipValue)
  if (!normalized) return { ignored: true }
  const receipt = paymentValue ? normalizeReceipt(ctx, paymentValue, normalized.providerMembershipId) : null
  let result
  await transaction(ctx.connection, async session => {
    const effectKey = `whop:${eventId}`
    if (await ctx.models.MembershipEvent.exists({ effectKey, environment: ctx.config.environment }).session(session)) return
    let membership = await ctx.models.Membership.findOne({ provider: 'whop', providerMembershipId: normalized.providerMembershipId, environment: ctx.config.environment }).session(session)
    // Link a previously owner-verified purchase rather than creating a second entitlement.
    if (!membership && receipt) {
      const candidates = await ctx.models.Membership.find({ environment: ctx.config.environment, email: normalized.email, plan: 'premium_blog',
        paymentStatus: 'owner_verified', providerMembershipId: { $exists: false }, purchasedOn: receipt.paidAt.toISOString().slice(0, 10) }).limit(2).session(session)
      if (candidates.length === 1) {
        membership = candidates[0]
        await ctx.models.Membership.updateOne({ _id: membership._id }, { $set: { providerMembershipId: normalized.providerMembershipId,
          providerCustomerId: normalized.providerCustomerId, productId: normalized.productId, accountId: normalized.accountId } }, { session })
        membership.providerCustomerId = normalized.providerCustomerId
      }
    }
    if (!membership) {
      // This write serializes fulfillment against simultaneous email verification/claiming.
      const customer = await ctx.models.Customer.findOneAndUpdate({ email: normalized.email, environment: ctx.config.environment },
        { $set: { updatedAt: new Date() }, $setOnInsert: { customerId: id('cus') } }, { upsert: true, new: true, session })
      ;[membership] = await ctx.models.Membership.create([{ ...normalized, membershipId: id('mem'), provider: 'whop', plan: 'premium_blog',
        paymentStatus: 'unverified', ...(customer?.emailVerifiedAt ? { customerId: customer._id } : {}), environment: ctx.config.environment }], { session })
    }
    // Never transfer a claimed entitlement to a new email or replace its provider customer identity.
    if (membership.providerCustomerId !== normalized.providerCustomerId) fail('PROVIDER_CORRELATION_FAILED', 'Membership owner changed.', 409)
    if (receipt) {
      const old = await ctx.models.MembershipReceipt.findOne({ providerPaymentId: receipt.providerPaymentId, environment: ctx.config.environment }).session(session)
      if (old && String(old.membershipId) !== String(membership._id)) fail('PROVIDER_CORRELATION_FAILED', 'Receipt owner mismatch.', 409)
      if (!old || old.providerUpdatedAt <= receipt.providerUpdatedAt) await ctx.models.MembershipReceipt.updateOne({ providerPaymentId: receipt.providerPaymentId, environment: ctx.config.environment },
        { $setOnInsert: { membershipId: membership._id, amount: receipt.amount, currency: receipt.currency, paidAt: receipt.paidAt }, $set: { refundedAmount: receipt.refundedAmount, providerUpdatedAt: receipt.providerUpdatedAt } }, { upsert: true, session })
    }
    const paid = await ctx.models.MembershipReceipt.find({ membershipId: membership._id, environment: ctx.config.environment }).session(session)
    const qualifying = paid.find(p => BigInt(p.amount) > BigInt(p.refundedAmount))
    const update = { verifiedAt: new Date() }
    if (!membership.providerUpdatedAt || normalized.providerUpdatedAt >= membership.providerUpdatedAt) {
      update.providerUpdatedAt = normalized.providerUpdatedAt
      update.status = normalized.status
    }
    if (qualifying) Object.assign(update, { paymentStatus: 'verified', providerPaymentId: qualifying.providerPaymentId,
      amount: qualifying.amount, currency: qualifying.currency, lastPaymentAt: qualifying.paidAt })
    else if (paid.length) update.status = 'suspended'
    // Permanent access has no expiresAt; explicit revocation remains sticky across webhook deliveries.
    await ctx.models.Membership.updateOne({ _id: membership._id }, { $set: update, $inc: { version: 1 } }, { session })
    const before = hasAccess(membership), after = hasAccess({ ...membership.toObject(), ...update })
    if (before !== after) await ctx.models.MembershipEvent.create([{ eventId: id('evt'), membershipId: membership._id, effectKey: `${effectKey}:access`,
      type: after ? 'ACCESS_GRANTED' : 'ACCESS_REVOKED', actor: 'whop', providerEventId: eventId, environment: ctx.config.environment }], { session })
    await ctx.models.MembershipEvent.create([{ eventId: id('evt'), membershipId: membership._id, effectKey,
      type: receipt ? 'PAYMENT_RECEIVED' : 'MEMBERSHIP_SYNCHRONIZED', actor: 'whop', providerEventId: eventId, environment: ctx.config.environment }], { session })
    result = membership.membershipId
  })
  return { membershipId: result }
}
export async function processMembershipEvent(ctx, job) {
  if (!ctx.memberships?.enabled || !ctx.memberships.productId || !ctx.memberships.planIds?.length) return false
  let payment
  if (job.providerPaymentId) {
    payment = await ctx.provider.getMembershipPayment(job.providerPaymentId)
    if (payment.metadata?.vijo_payment_id) return false
  }
  const membershipId = job.providerMembershipId || payment?.membership?.id
  if (!membershipId) return false
  const membership = await ctx.provider.getMembership(membershipId)
  if (!normalizeMembership(ctx, membership)) return false
  // Always re-fetch the current purchase on membership cancellation/reactivation.
  if (!payment) {
    const existing = await ctx.models.Membership.findOne({ providerMembershipId: membershipId, environment: ctx.config.environment })
    if (existing?.providerPaymentId) payment = await ctx.provider.getMembershipPayment(existing.providerPaymentId)
  }
  await fulfill(ctx, membership, payment, job.providerEventId)
  return true
}
