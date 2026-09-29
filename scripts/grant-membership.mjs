import '../server/utils/env.js'
import { z } from 'zod'
import { connectPayments, setupDatabase } from '../server/modules/payments/database.js'
import { grantOwnerVerifiedPurchase } from '../server/modules/memberships/manual.js'
import { paymentDatabaseConfig } from './payment-database-config.mjs'

let ctx
try {
  const [email, name, purchasedOn] = process.argv.slice(2)
  const config = paymentDatabaseConfig()
  ctx = { config, ...await connectPayments(config) }
  await setupDatabase(ctx)
  const membership = await grantOwnerVerifiedPurchase(ctx, { email, name, purchasedOn,
    actor: 'owner-approved-cli', reason: 'Owner personally verified the USD 50 one-time Whop purchase and authorized permanent access.' })
  console.log(JSON.stringify({ membershipId: membership.membershipId, paymentStatus: membership.paymentStatus, permanent: true, claimed: Boolean(membership.customerId) }))
} catch (error) {
  console.error(JSON.stringify({ event: 'membership_grant_failed', errorName: /^[A-Za-z]+$/.test(error.name || '') ? error.name : 'Error',
    errorCode: typeof error.code === 'number' || /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : error.message === 'DATABASE_MISMATCH' ? 'DATABASE_MISMATCH' : 'UNAVAILABLE' }))
  console.error(error instanceof z.ZodError ? 'Configure PAYMENTS_MONGODB_URI, PAYMENTS_MONGODB_DB_NAME and PAYMENTS_ENVIRONMENT. Usage: pnpm memberships:grant-owner email username YYYY-MM-DD' : 'Membership grant failed; check the payment database connection and inputs. No provider verification was fabricated.')
  process.exitCode = 1
} finally { await ctx?.connection.close() }
