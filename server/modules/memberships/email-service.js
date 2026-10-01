import { digest, fail, id } from '../payments/domain.js'
import { hasAccess } from './domain.js'
import { productFor } from './products.js'
import { rate } from './auth.js'

export const supportEmail = 'company@nexvijo.com'
export function verificationEmail(member, origin) {
  const product = productFor(member.plan)
  if (product?.kind !== 'course') fail('INVALID_EMAIL_PRODUCT', 'Select a purchased course.', 400)
  const url = new URL('/blog/membership', origin).href
  return { to: member.email, replyTo: supportEmail,
    subject: `Thank you for purchasing ${product.name} — verify your email`,
    text: `Hey,

Thank you for purchasing ${product.name} from Nexvijo! We’re glad to have you learning with us.

Please verify the email address used for your purchase:
${member.email}

Verify your email here:
${url}

Enter the email address above to request your sign-in code, then enter that code on the website. You do not need to create a password.

After you verify your email, our team will manually send you the Google Drive link to the full course. The link is not sent automatically when you sign in.

For help with verification, course access, or anything else, contact ${supportEmail}.

If you believe a mistake has occurred, you were charged more than once, or you would like to request a refund, please contact ${supportEmail} with your purchase email and any payment reference available. Our team will review your request.

Please keep your sign-in codes and course materials private. Never email us your password, verification code, or full card details.

Keep learning,
The Nexvijo Team
${supportEmail}`,
  }
}
export async function emailPreview(ctx, membershipId) {
  if (!ctx.memberships?.enabled) fail('MEMBERSHIP_LOGIN_UNAVAILABLE', 'Enable and configure email-code login before sending verification invitations.', 503)
  const member = await ctx.models.Membership.findOne({ environment: ctx.config.environment, membershipId })
  if (!member) fail('RESOURCE_NOT_FOUND', 'Membership not found.', 404)
  if (!hasAccess(member) || !['verified', 'owner_verified'].includes(member.paymentStatus)) fail('PURCHASE_NOT_CONFIRMED', 'An active confirmed purchase is required.', 409)
  const message = verificationEmail(member, ctx.memberships.origin)
  return { member, message, previewHash: digest(JSON.stringify(message)),
    effectKey: `verification-invite:v1:${digest(`${member.email}:${member.plan}`)}` }
}
export async function sendVerificationEmail(ctx, membershipId, previewHash, actor) {
  const preview = await emailPreview(ctx, membershipId)
  if (preview.previewHash !== previewHash) fail('PREVIEW_CHANGED', 'Preview the current email before sending.', 409)
  const { member, message, effectKey } = preview, environment = ctx.config.environment
  const sent = await ctx.models.MembershipEvent.findOne({ environment, effectKey: `${effectKey}:sent` })
  if (sent) return { status: 'already_sent', emailId: sent.reason }
  await rate(ctx, `admin-membership-email:${actor}`, 30, 3600000)
  try {
    await ctx.models.MembershipEvent.create({ environment, eventId: id('evt'), membershipId: member._id, effectKey,
      type: 'VERIFICATION_EMAIL_RESERVED', actor, reason: message.subject })
  } catch (error) {
    if (error.code === 11000) fail('EMAIL_ALREADY_RESERVED', 'This email is pending or its outcome is unknown. Check send history and Resend before retrying.', 409)
    throw error
  }
  try {
    const address = ctx.memberships.from.match(/<([^>]+)>/)?.[1] || ctx.memberships.from
    const payload = { from: `Nexvijo <${address}>`, to: [message.to], reply_to: message.replyTo, subject: message.subject, text: message.text }
    let result
    if (ctx.sendVerificationEmail) result = await ctx.sendVerificationEmail(payload, effectKey)
    else {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${ctx.memberships.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': effectKey }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('EMAIL_PROVIDER_FAILED')
      result = await response.json()
    }
    if (typeof result?.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.id)) throw new Error('INVALID_EMAIL_RESPONSE')
    await ctx.models.MembershipEvent.create({ environment, eventId: id('evt'), membershipId: member._id, effectKey: `${effectKey}:sent`,
      type: 'VERIFICATION_EMAIL_ACCEPTED', actor, reason: result.id })
    return { status: 'accepted', emailId: result.id }
  } catch {
    fail('EMAIL_OUTCOME_UNKNOWN', 'Email submission could not be confirmed. Check Resend before retrying; a duplicate send is blocked.', 503)
  }
}
