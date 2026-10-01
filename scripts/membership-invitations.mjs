import '../server/utils/env.js'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { connectPayments, transaction } from '../server/modules/payments/database.js'
import { paymentDatabaseConfig } from './payment-database-config.mjs'
import { membershipConfig } from '../server/modules/memberships/config.js'
import { emailPreview, sendVerificationEmail } from '../server/modules/memberships/email-service.js'
import { emailSchema } from '../server/modules/memberships/domain.js'
import { digest, id } from '../server/modules/payments/domain.js'

const [mode, filename] = process.argv.slice(2)
let ctx
try {
  if (!['prepare', 'preview', 'send', 'verify'].includes(mode)) throw new Error('INVALID_MODE')
  const rows = z.array(z.object({ email: emailSchema, name: z.string().min(1).max(100),
    plan: z.enum(['ai_visual_mastery', 'ai_training_premium']), purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    total: z.string().regex(/^\d+$/), ownerEvidence: z.string().min(20).max(500),
  }).strict()).max(30).parse(JSON.parse(readFileSync(filename, 'utf8')))
  const config = paymentDatabaseConfig()
  ctx = { config, ...await connectPayments(config), memberships: membershipConfig() }
  for (const row of rows) {
    const scope = { environment: config.environment, email: row.email, plan: row.plan }
    let member = await ctx.models.Membership.findOne(scope).sort({ createdAt: 1 })
    if (mode === 'prepare' && !member) {
      const manualPurchaseKey = digest(`owner-course:${row.email}:${row.plan}:${row.purchasedOn}`)
      await transaction(ctx.connection, async session => {
        const existing = await ctx.models.Membership.findOne({ environment: config.environment, manualPurchaseKey }).session(session)
        if (existing) { member = existing; return }
        const customer = await ctx.models.Customer.findOneAndUpdate({ environment: config.environment, email: row.email },
          { $setOnInsert: { customerId: id('cus'), name: row.name }, $set: { updatedAt: new Date() } }, { upsert: true, returnDocument: 'after', session })
        ;[member] = await ctx.models.Membership.create([{ ...scope, membershipId: id('mem'), manualPurchaseKey,
          provider: 'whop', paymentStatus: 'owner_verified', status: 'active', startedAt: new Date(), purchasedOn: row.purchasedOn,
          amount: row.total, currency: 'USD', overrideReason: row.ownerEvidence,
          ...(customer.emailVerifiedAt ? { customerId: customer._id } : {}),
        }], { session })
        await ctx.models.MembershipEvent.create([{ environment: config.environment, eventId: id('evt'), membershipId: member._id,
          effectKey: `owner:${manualPurchaseKey}`, type: 'OWNER_VERIFIED_PURCHASE_ACCESS_GRANTED', actor: 'owner-approved-cli',
          reason: `${row.ownerEvidence} No provider payment ID supplied; no provider-verified receipt created. Repeated screenshot rows are not additional charges.` }], { session })
      })
    }
    if (!member) throw new Error('MEMBERSHIP_MISSING')
    if (mode === 'prepare') { console.log(JSON.stringify({ email: row.email, plan: row.plan, membershipId: member.membershipId })); continue }
    const preview = await emailPreview(ctx, member.membershipId)
    if (mode === 'preview') { console.log(JSON.stringify(preview.message)); continue }
    if (mode === 'send') {
      console.log(JSON.stringify({ email: row.email, plan: row.plan, ...await sendVerificationEmail(ctx, member.membershipId, preview.previewHash, 'owner-approved-cli') }))
    } else {
      const event = await ctx.models.MembershipEvent.findOne({ environment: config.environment, effectKey: `${preview.effectKey}:sent` })
      if (!event) throw new Error('EMAIL_NOT_SENT')
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(event.reason)}`, { headers: { Authorization: `Bearer ${ctx.memberships.resendKey}` }, signal: AbortSignal.timeout(15000), redirect: 'error' })
      if (!response.ok) throw new Error('VERIFY_FAILED')
      const email = await response.json()
      console.log(JSON.stringify({ recipient: row.email, plan: row.plan, emailId: email.id, status: email.last_event, recipientMatches: email.to?.includes(row.email) }))
    }
    await new Promise(resolve => setTimeout(resolve, 1100))
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'membership_invitation_failed', code: typeof error.code === 'number' || /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'OPERATION_FAILED', name: error.name }))
  process.exitCode = 1
} finally { await ctx?.connection.close() }
