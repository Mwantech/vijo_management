import { z } from 'zod'
import { transaction } from '../payments/database.js'
import { digest, id, parse, fail } from '../payments/domain.js'
import { emailSchema } from './domain.js'
import { productFor } from './products.js'

const schema = z.object({
  email: emailSchema, name: z.string().trim().min(1).max(100),
  plan: z.enum(['ai_training_premium', 'ai_visual_mastery']),
  providerPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v),
  total: z.string().regex(/^\d{1,10}$/), tax: z.string().regex(/^\d{1,10}$/),
  actor: z.string().min(1).max(100),
}).strict()

// Explicit owner-attested imports, not provider verification. Replays cannot restore revoked access.
export async function recordCoursePurchase(ctx, input) {
  const dto = parse(schema, input), product = productFor(dto.plan), environment = ctx.config.environment
  if (BigInt(dto.total) !== BigInt(product.amount) + BigInt(dto.tax)) fail('INVALID_PURCHASE_TOTAL', 'Course price plus tax must equal the supplied total.', 400)
  const manualPurchaseKey = digest(`owner-whop-payment:${dto.providerPaymentId}`)
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction(ctx.connection, async session => {
        const existing = await ctx.models.Membership.findOne({ environment, $or: [{ manualPurchaseKey }, { providerPaymentId: dto.providerPaymentId }] }).session(session)
        if (existing) {
          if (existing.email !== dto.email || existing.plan !== dto.plan || existing.amount !== dto.total) fail('PURCHASE_CONFLICT', 'Payment reference already belongs to a different purchase.', 409)
          return existing
        }
        const customer = await ctx.models.Customer.findOneAndUpdate({ environment, email: dto.email },
          { $setOnInsert: { customerId: id('cus'), name: dto.name }, $set: { updatedAt: new Date() } }, { upsert: true, returnDocument: 'after', session })
        const reason = `Owner supplied completed Whop purchase ${dto.providerPaymentId}. Product USD minor units ${product.amount}; tax ${dto.tax}; total ${dto.total}. Purchase date ${dto.purchasedOn}; exact payment timezone not supplied. Access starts when recorded. Not verified via provider API.`
        const [membership] = await ctx.models.Membership.create([{ environment, membershipId: id('mem'), email: dto.email,
          manualPurchaseKey, providerPaymentId: dto.providerPaymentId, provider: 'whop', plan: dto.plan, purchasedOn: dto.purchasedOn,
          amount: dto.total, currency: 'USD', status: 'active', paymentStatus: 'owner_verified', startedAt: new Date(), overrideReason: reason,
          ...(customer.emailVerifiedAt ? { customerId: customer._id } : {}),
        }], { session })
        await ctx.models.MembershipEvent.create([{ environment, eventId: id('evt'), membershipId: membership._id,
          effectKey: `owner:${manualPurchaseKey}`, type: 'OWNER_VERIFIED_PURCHASE_ACCESS_GRANTED', actor: dto.actor, reason }], { session })
        return membership
      })
    } catch (error) { if (error.code !== 11000 || attempt >= 2) throw error }
  }
}
