import '../server/utils/env.js'
import { paymentConfig } from '../server/modules/payments/config.js'
import { membershipConfig } from '../server/modules/memberships/config.js'
import { connectPayments, setupDatabase } from '../server/modules/payments/database.js'
import { createWhop } from '../server/modules/payments/providers/whop.js'
import { fulfill } from '../server/modules/memberships/fulfillment.js'
import { starterPosts } from '../server/modules/memberships/starter-posts.js'
import { emailSchema } from '../server/modules/memberships/domain.js'
import { paymentDatabaseConfig } from './payment-database-config.mjs'

const [command, reference, expectedEmail] = process.argv.slice(2)
let ctx
try {
  if (!['setup', 'import'].includes(command)) throw new Error('Usage: node scripts/memberships.mjs setup | import pay_PROVIDER_ID purchase-email')
  const config = command === 'setup' ? paymentDatabaseConfig() : paymentConfig()
  if (command === 'import' && !config.enabled) throw new Error('Enable PAYMENTS_ENABLED before running import.')
  ctx = { config, ...await connectPayments(config) }
  if (command === 'setup') {
    await setupDatabase(ctx)
    for (const post of starterPosts) await ctx.models.Post.updateOne({ environment: config.environment, slug: post.slug },
      { $setOnInsert: { ...post, environment: config.environment, published: true, publishedAt: new Date() } }, { upsert: true })
    console.log('Membership collections/indexes ready. Starter articles inserted without overwriting existing content.')
  } else {
    if (!/^pay_[A-Za-z0-9]+$/.test(reference || '') || !emailSchema.safeParse(expectedEmail).success) throw new Error('A real Whop payment ID and expected purchase email are required.')
    ctx.memberships = membershipConfig()
    if (!ctx.memberships.enabled) throw new Error('Enable MEMBERSHIPS_ENABLED and configure product/plan IDs first.')
    ctx.provider = createWhop(config)
    const payment = await ctx.provider.getMembershipPayment(reference)
    if (payment.status !== 'paid') throw new Error('Purchase is not paid; nothing imported.')
    const membership = await ctx.provider.getMembership(payment.membership?.id)
    if (emailSchema.parse(membership.user?.email) !== emailSchema.parse(expectedEmail)) throw new Error('Purchase email does not match. Nothing imported.')
    const result = await fulfill(ctx, membership, payment, `import:${reference}`)
    if (result.ignored) throw new Error('Purchase does not match configured premium product/plan. Nothing imported.')
    console.log('Verified purchase imported idempotently. Customer must verify their email to claim access.')
  }
} catch (error) {
  // Never print database URLs, provider payloads or raw SDK errors.
  console.error(error.code || (error.message?.startsWith('Usage:') ? error.message : 'Membership command failed; check configuration, payment ID, account permissions and expected email.'))
  process.exitCode = 1
} finally { await ctx?.connection.close() }
