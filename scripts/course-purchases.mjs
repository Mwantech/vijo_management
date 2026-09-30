import '../server/utils/env.js'
import { readFileSync } from 'node:fs'
import { connectPayments } from '../server/modules/payments/database.js'
import { paymentDatabaseConfig } from './payment-database-config.mjs'
import { recordCoursePurchase } from '../server/modules/memberships/course-purchases.js'
import { courseEmail } from '../server/modules/memberships/course-email.js'
import { id } from '../server/modules/payments/domain.js'
import { hasAccess } from '../server/modules/memberships/domain.js'

// Input is a private JSON file, not committed customer records. No raw payment/card payloads.
const [mode, path] = process.argv.slice(2)
let ctx
try {
  if (!['preview', 'record', 'send', 'verify'].includes(mode) || !path) throw new Error('Invalid command')
  const purchases = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(purchases) || purchases.length > 20) throw new Error('Invalid batch')
  if (mode === 'preview') {
    for (const purchase of purchases) console.log(JSON.stringify({ to: purchase.email, ...courseEmail(purchase) }))
  } else {
    const config = paymentDatabaseConfig()
    ctx = { config, ...await connectPayments(config) }
    const api = async (route, options = {}) => {
      const response = await fetch(`https://api.resend.com/emails${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...options.headers } })
      if (!response.ok) throw new Error(`EMAIL_HTTP_${response.status}`)
      return response.json()
    }
    for (const purchase of purchases) {
      if (mode === 'record') {
        const member = await recordCoursePurchase(ctx, purchase)
        console.log(JSON.stringify({ membershipId: member.membershipId, plan: member.plan, paymentStatus: member.paymentStatus }))
        continue
      }
      const member = await ctx.models.Membership.findOne({ environment: config.environment, providerPaymentId: purchase.providerPaymentId, email: purchase.email, plan: purchase.plan })
      if (!member || !hasAccess(member) || member.amount !== purchase.total) throw new Error('PURCHASE_NOT_READY')
      const effectKey = `course-access-email:v1:${purchase.providerPaymentId}`
      const sent = await ctx.models.MembershipEvent.findOne({ environment: config.environment, effectKey: `${effectKey}:sent` })
      if (mode === 'verify') {
        if (!sent) throw new Error('EMAIL_NOT_RECORDED')
        const message = await api(`/${encodeURIComponent(sent.reason)}`)
        console.log(JSON.stringify({ paymentId: purchase.providerPaymentId, emailId: message.id, status: message.last_event, recipientMatches: message.to?.includes(purchase.email) }))
        continue
      }
      if (sent) { console.log(JSON.stringify({ paymentId: purchase.providerPaymentId, status: 'already_sent', emailId: sent.reason })); continue }
      if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error('EMAIL_CONFIGURATION')
      const payload = courseEmail(purchase)
      // Unique reservation prevents concurrent scripts or later reruns from resending.
      // If a send outcome is unknown, inspect Resend before any manual retry.
      await ctx.models.MembershipEvent.create({ environment: config.environment, eventId: id('evt'), membershipId: member._id, effectKey,
        type: 'COURSE_EMAIL_RESERVED', actor: 'owner-approved-cli', reason: payload.subject })
      const address = process.env.RESEND_FROM_EMAIL.match(/<([^>]+)>/)?.[1] || process.env.RESEND_FROM_EMAIL
      const result = await api('', { method: 'POST', headers: { 'Idempotency-Key': effectKey },
        body: JSON.stringify({ from: `Nexvijo <${address}>`, to: [purchase.email], ...payload }) })
      if (!result.id) throw new Error('EMAIL_RESPONSE_INVALID')
      await ctx.models.MembershipEvent.create({ environment: config.environment, eventId: id('evt'), membershipId: member._id, effectKey: `${effectKey}:sent`,
        type: 'COURSE_EMAIL_SENT', actor: 'owner-approved-cli', reason: result.id })
      console.log(JSON.stringify({ paymentId: purchase.providerPaymentId, status: 'accepted', emailId: result.id }))
      await new Promise(resolve => setTimeout(resolve, 1100))
    }
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'course_purchase_operation_failed',
    code: typeof error.code === 'number' || /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'OPERATION_FAILED',
    name: /^[A-Za-z]+$/.test(error.name || '') ? error.name : 'Error',
    fields: error.issues?.map(issue => issue.path.join('.')),
  }))
  process.exitCode = 1
} finally { await ctx?.connection.close() }
