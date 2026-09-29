import { z } from 'zod'
import { transaction } from '../payments/database.js'
import { digest, id, parse } from '../payments/domain.js'
import { emailSchema } from './domain.js'

const schema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(100),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v),
  actor: z.string().min(1).max(100), reason: z.string().min(10).max(500),
}).strict()
// Explicit owner attestation. This is not a simulated provider response or a production mock.
export async function grantOwnerVerifiedPurchase(ctx, input) {
  const dto = parse(schema, input), environment = ctx.config.environment
  const manualPurchaseKey = digest(`${dto.email}:premium_blog:${dto.purchasedOn}`)
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction(ctx.connection, async session => {
        const existing = await ctx.models.Membership.findOne({ environment, manualPurchaseKey }).session(session)
        if (existing) return existing // Repeated commands cannot undo a later revocation.
        const customer = await ctx.models.Customer.findOneAndUpdate({ email: dto.email, environment },
          { $setOnInsert: { customerId: id('cus'), name: dto.name }, $set: { updatedAt: new Date() } }, { upsert: true, new: true, session })
        const [membership] = await ctx.models.Membership.create([{ environment, membershipId: id('mem'), manualPurchaseKey,
          email: dto.email, provider: 'whop', plan: 'premium_blog', paymentStatus: 'owner_verified', amount: '5000', currency: 'USD',
          purchasedOn: dto.purchasedOn, status: 'active', startedAt: new Date(), overrideReason: dto.reason,
          ...(customer.emailVerifiedAt ? { customerId: customer._id } : {}),
        }], { session })
        await ctx.models.MembershipEvent.create([{ environment, eventId: id('evt'), membershipId: membership._id,
          effectKey: `owner:${manualPurchaseKey}`, type: 'OWNER_VERIFIED_PURCHASE_ACCESS_GRANTED', actor: dto.actor, reason: dto.reason }], { session })
        return membership
      })
    } catch (e) { if (e.code !== 11000 || attempt >= 2) throw e }
  }
}
