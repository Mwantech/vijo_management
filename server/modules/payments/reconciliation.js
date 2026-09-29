// Bounded persisted recovery work, shared safely by every backend instance.
export async function scheduleVerification(ctx) {
  const before = new Date(Date.now() - 5 * 60000)
  const payments = await ctx.models.Payment.find({
    status: { $in: ['PENDING', 'PROCESSING'] },
    $or: [{ lastVerifiedAt: { $lt: before } }, { lastVerifiedAt: { $exists: false }, updatedAt: { $lt: before } }],
  }).sort({ updatedAt: 1 }).limit(20)
  for (const payment of payments) {
    // One recurring verification job per payment; no unbounded bucket accumulation.
    const operationKey = `verify:${payment.paymentId}`
    try {
      await ctx.models.Job.updateOne({ operationKey }, { $setOnInsert: { operationKey, paymentId: payment._id,
        applicationId: payment.applicationId, operation: 'VERIFY', status: 'PENDING', environment: ctx.config.environment } }, { upsert: true })
      await ctx.models.Job.updateOne({ operationKey, status: 'DONE' }, { $set: { status: 'PENDING', nextRunAt: new Date(), count: 0 } })
    } catch (error) { if (error.code !== 11000) throw error }
  }
}
