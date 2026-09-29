import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { id, digest, fail } from '../payments/domain.js'
import { transaction } from '../payments/database.js'

const COOKIE = 'nexvijo_member_session'
const ttl = 7 * 86400000
const hashCode = (ctx, challengeId, code) => createHmac('sha256', ctx.memberships.pepper).update(`${challengeId}:${code}`).digest('hex')
export async function rate(ctx, key, max, windowMs) {
  const now = Date.now(), bucket = `${ctx.config.environment}:${key}:${Math.floor(now / windowMs)}`
  let value
  try { value = await ctx.models.MemberRate.findOneAndUpdate({ key: bucket }, { $inc: { count: 1 }, $setOnInsert: { environment: ctx.config.environment, expiresAt: new Date(now + windowMs * 2) } }, { upsert: true, new: true }) }
  catch (e) { if (e.code !== 11000) throw e; value = await ctx.models.MemberRate.findOneAndUpdate({ key: bucket }, { $inc: { count: 1 } }, { new: true }) }
  if (!value || value.count > max) fail('RATE_LIMITED', 'Too many attempts. Please try again later.', 429)
}
export async function requestCode(ctx, email, ip) {
  await rate(ctx, `request-ip:${digest(ip)}`, 15, 3600000)
  await rate(ctx, `request-email:${digest(email)}`, 5, 3600000)
  await rate(ctx, `resend:${digest(email)}`, 1, 60000)
  const challengeId = id('challenge'), code = String(randomInt(0, 100000000)).padStart(8, '0')
  await ctx.models.Challenge.create({ challengeId, email, codeHash: hashCode(ctx, challengeId, code), expiresAt: new Date(Date.now() + 600000), environment: ctx.config.environment })
  try {
    if (ctx.sendMembershipEmail) await ctx.sendMembershipEmail(email, code)
    else {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${ctx.memberships.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': challengeId },
        body: JSON.stringify({ from: ctx.memberships.from, to: [email], subject: 'Your Nexvijo membership access code',
          text: `Your Nexvijo sign-in code is ${code}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.` }) })
      if (!response.ok) throw new Error('EMAIL_FAILED')
    }
  } catch {
    await ctx.models.Challenge.deleteOne({ challengeId })
    fail('EMAIL_UNAVAILABLE', 'The code could not be sent. Please try again later.', 503)
  }
  return { challengeId, message: 'Check your email for your access code.' }
}
export async function verifyCode(ctx, challengeId, code, ip) {
  await rate(ctx, `verify-ip:${digest(ip)}`, 30, 600000)
  const filter = { challengeId, environment: ctx.config.environment, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } }
  // Incorrect attempts consume budget atomically, including concurrent guesses.
  const expected = hashCode(ctx, challengeId, code)
  const wrong = await ctx.models.Challenge.findOneAndUpdate({ ...filter, codeHash: { $ne: expected } }, { $inc: { attempts: 1 } })
  if (wrong) fail('INVALID_CODE', 'Code is invalid or expired.', 401)
  const token = randomBytes(32).toString('base64url')
  await transaction(ctx.connection, async session => {
    const challenge = await ctx.models.Challenge.findOneAndUpdate({ ...filter, codeHash: expected }, { $set: { consumedAt: new Date() } }, { new: true, session })
    if (!challenge) fail('INVALID_CODE', 'Code is invalid or expired.', 401)
    const customer = await ctx.models.Customer.findOneAndUpdate({ email: challenge.email, environment: ctx.config.environment },
      { $set: { emailVerifiedAt: new Date() }, $setOnInsert: { customerId: id('cus') } }, { upsert: true, new: true, session })
    const pending = await ctx.models.Membership.find({ email: customer.email, environment: ctx.config.environment, customerId: { $exists: false } }).session(session)
    for (const membership of pending) {
      await ctx.models.Membership.updateOne({ _id: membership._id }, { $set: { customerId: customer._id }, $inc: { version: 1 } }, { session })
      await ctx.models.MembershipEvent.create([{ eventId: id('evt'), membershipId: membership._id, effectKey: `claim:${membership.membershipId}`, type: 'MEMBERSHIP_CLAIMED', actor: customer.customerId, environment: ctx.config.environment }], { session })
    }
    await ctx.models.MemberSession.create([{ tokenHash: digest(token), customerId: customer._id, expiresAt: new Date(Date.now() + ttl), environment: ctx.config.environment }], { session })
  })
  return token
}
export function memberCookie(ctx, token) {
  const secure = ctx.memberships.secure || ctx.memberships.sameSite === 'None'
  return `${COOKIE}=${token}; HttpOnly; Path=/api; SameSite=${ctx.memberships.sameSite}; Max-Age=${token ? ttl / 1000 : 0}${secure ? '; Secure' : ''}`
}
export function sessionToken(req) {
  return String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ''
}
export async function customerFor(ctx, req) {
  const token = sessionToken(req)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const session = await ctx.models.MemberSession.findOne({ tokenHash: digest(token), environment: ctx.config.environment, expiresAt: { $gt: new Date() } })
  return session ? ctx.models.Customer.findById(session.customerId) : null
}
