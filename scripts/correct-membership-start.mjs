import '../server/utils/env.js'
import { connectPayments, transaction } from '../server/modules/payments/database.js'
import { paymentDatabaseConfig } from './payment-database-config.mjs'
import { id, digest } from '../server/modules/payments/domain.js'

// Owner-authorized correction only; never creates a membership or changes access/payment status.
const membershipId = 'mem_wWuviDJtfaTP9Fz3PRdFi7I_'
const startedAt = new Date('2026-09-26T02:54:00+03:00')
let ctx
try {
  const config = paymentDatabaseConfig()
  ctx = { config, ...await connectPayments(config) }
  await transaction(ctx.connection, async session => {
    const filter = { environment: config.environment, membershipId, email: 'gsilkgallagher@gmail.com', purchasedOn: '2026-09-26', paymentStatus: 'owner_verified' }
    const member = await ctx.models.Membership.findOne(filter).session(session)
    if (!member) throw new Error('TARGET_NOT_FOUND')
    const before = member.startedAt.toISOString()
    if (process.argv.includes('--apply') && before !== startedAt.toISOString()) {
      const result = await ctx.models.Membership.updateOne({ ...filter, startedAt: member.startedAt }, { $set: { startedAt }, $inc: { version: 1 } }, { session })
      if (result.modifiedCount !== 1) throw new Error('CONCURRENT_CHANGE')
      await ctx.models.MembershipEvent.create([{ environment: config.environment, eventId: id('evt'), membershipId: member._id,
        effectKey: `start-correction:${digest(`${membershipId}:${startedAt.toISOString()}`)}`, type: 'MEMBERSHIP_START_CORRECTED', actor: 'owner-approved-cli',
        reason: `Owner requested correction from ${before} to ${startedAt.toISOString()} (26/09/2026 02:54 Africa/Nairobi). Access and payment state unchanged.` }], { session })
    }
    console.log(JSON.stringify({ membershipId, previousStartedAt: before, requestedStartedAt: startedAt.toISOString(), applied: process.argv.includes('--apply') }))
  })
} catch {
  console.error('Membership correction failed. Check the database connection and exact target; no secrets were logged.')
  process.exitCode = 1
} finally { await ctx?.connection.close() }
