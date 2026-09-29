import { digest } from '../payments/domain.js'
export async function scheduleMembershipVerification(ctx) {
  if (!ctx.memberships?.enabled || !ctx.memberships.syncEnabled) return
  const interval = 6 * 3600000, now = Date.now()
  const rows = await ctx.models.Membership.find({ environment: ctx.config.environment, provider: 'whop', providerMembershipId: { $exists: true },
    $or: [{ verifiedAt: { $lt: new Date(now - interval) } }, { verifiedAt: { $exists: false } }] })
    .sort({ verifiedAt: 1, _id: 1 }).limit(50).select('providerMembershipId').lean()
  for (const row of rows) {
    const providerEventId = `reconcile:${row.providerMembershipId}:${Math.floor(now / interval)}`
    try { await ctx.models.Inbox.updateOne({ environment: ctx.config.environment, accountId: ctx.config.accountId, providerEventId },
      { $setOnInsert: { providerMembershipId: row.providerMembershipId, type: 'membership.reconcile', payloadHash: digest(providerEventId), status: 'PENDING' } }, { upsert: true }) }
    catch (e) { if (e.code !== 11000) throw e }
  }
}
