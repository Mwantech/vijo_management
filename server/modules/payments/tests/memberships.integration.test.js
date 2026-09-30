import { beforeAll, afterAll, it, expect } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import request from 'supertest'
import { connectPayments, setupDatabase } from '../database.js'
import { createManagementApp } from '../../../app.js'
import { createSessionCookie } from '../../../middleware/auth.js'
import { fulfill } from '../../memberships/fulfillment.js'
import { requestCode, verifyCode } from '../../memberships/auth.js'
import { hasAccess } from '../../memberships/domain.js'
import { digest } from '../domain.js'
import { signature } from '../crypto.js'
import { grantOwnerVerifiedPurchase } from '../../memberships/manual.js'
import { recordCoursePurchase } from '../../memberships/course-purchases.js'

let repl, ctx, app, code, challengeId
const origin = 'https://nexvijo.com', email = 'member@example.com'
const membership = { id: 'mem_provider1', company: { id: 'biz_test' }, product: { id: 'prod_blog' }, plan: { id: 'plan_blog' },
  user: { id: 'user_customer', email }, status: 'completed', joined_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T01:00:00Z' }
const payment = { id: 'pay_purchase', company: { id: 'biz_test' }, membership: { id: membership.id }, status: 'paid', currency: 'usd', final_amount: '50.00', refunded_amount: '0', paid_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T01:00:00Z' }
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { version: '7.0.24', downloadDir: '/tmp/vijo-payment-mongo-binaries' } })
  const config = { enabled: true, environment: 'test', uri: repl.getUri('members_test'), dbName: 'members_test', accountId: 'biz_test', apiVersion: '2026-09-25', webhookSecret: 'test-only-webhook-secret' }
  ctx = { config, ...await connectPayments(config), ready: true,
    memberships: { enabled: true, origin, pepper: 'p'.repeat(40), productId: 'prod_blog', planIds: ['plan_blog'], secure: false, sameSite: 'Lax' },
    sendMembershipEmail: async (_email, value) => { code = value },
  }
  await setupDatabase(ctx)
  app = createManagementApp({ payments: ctx })
}, 120000)
afterAll(async () => { await ctx?.connection.close(); await repl?.stop() })

it('keeps administrator reads available without email login and protects service diagnostics', async () => {
  const previous = ctx.memberships.enabled
  const admin = createSessionCookie({ id: 'a', role: 'super_admin' }).split(';')[0]
  const support = createSessionCookie({ id: 's', role: 'support' }).split(';')[0]
  ctx.memberships.enabled = false
  try {
    expect((await request(app).get('/api/management/memberships').set('Cookie', admin)).status).toBe(200)
    expect((await request(app).get('/api/content/posts')).status).toBe(200)
    expect((await request(app).get('/api/membership/me')).status).toBe(503)
    expect((await request(app).get('/api/management/memberships/status')).status).toBe(401)
    expect((await request(app).get('/api/management/memberships/status').set('Cookie', support)).status).toBe(403)
    ctx.ready = false
    const status = await request(app).get('/api/management/memberships/status').set('Cookie', admin)
    expect(status.status).toBe(200)
    expect(status.body.data.databaseReady).toBe(false)
    expect((await request(app).get('/api/management/memberships').set('Cookie', admin)).status).toBe(503)
  } finally { ctx.ready = true; ctx.memberships.enabled = previous }
})

it('ignores other products and requires a verified paid purchase', async () => {
  expect(await fulfill(ctx, { ...membership, product: { id: 'prod_other' } }, payment, 'evt_other')).toEqual({ ignored: true })
  await fulfill(ctx, membership, undefined, 'evt_activation')
  const m = await ctx.models.Membership.findOne()
  expect(hasAccess(m)).toBe(false)
  expect(m.customerId).toBeUndefined()
})
it('verifies raw membership webhook signatures and deduplicates the inbox', async () => {
  const eventId = 'evt_membership_delivery', timestamp = String(Math.floor(Date.now() / 1000))
  const body = JSON.stringify({ id: eventId, account_id: 'biz_test', api_version_date: ctx.config.apiVersion, type: 'membership.activated', data: { id: membership.id } })
  const headers = { 'Content-Type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature(ctx.config.webhookSecret, eventId, timestamp, Buffer.from(body))}` }
  const route = '/api/v1/providers/whop/webhook'
  expect((await request(app).post(route).set(headers).send(body + ' ')).status).toBe(401)
  expect((await request(app).post(route).set(headers).send(body)).status).toBe(200)
  expect((await request(app).post(route).set(headers).send(body)).status).toBe(200)
  expect(await ctx.models.Inbox.countDocuments({ providerEventId: eventId })).toBe(1)
})
it('fulfills concurrent duplicated events once and grants permanent unclaimed access', async () => {
  await Promise.all(Array.from({ length: 5 }, () => fulfill(ctx, membership, payment, 'evt_purchase')))
  expect(await ctx.models.Membership.countDocuments()).toBe(1)
  expect(await ctx.models.MembershipReceipt.countDocuments()).toBe(1)
  expect(await ctx.models.MembershipEvent.countDocuments({ effectKey: 'whop:evt_purchase' })).toBe(1)
  const m = await ctx.models.Membership.findOne()
  expect(hasAccess(m)).toBe(true); expect(m.expiresAt).toBeUndefined()
})
it('blocks premium bodies and only lists public preview metadata', async () => {
  await ctx.models.Post.create({ environment: 'test', slug: 'protected-post', title: 'Test article', excerpt: 'A safe article excerpt', content: 'SECRET_PREMIUM_BODY', visibility: 'premium', published: true })
  const listing = await request(app).get('/api/content/posts')
  expect(listing.status).toBe(200); expect(JSON.stringify(listing.body)).not.toContain('SECRET_PREMIUM_BODY')
  expect((await request(app).get('/api/content/posts/protected-post')).status).toBe(401)
  expect((await request(app).get('/api/premium/posts/protected-post')).status).toBe(401)
})
it('requires website origin and rejects Mongo operators at login boundary', async () => {
  expect((await request(app).post('/api/membership/auth/request-code').send({ email })).status).toBe(403)
  expect((await request(app).post('/api/membership/auth/request-code').set('Origin', origin).send({ email: { $ne: null } })).status).toBe(400)
})
let cookie
it('sends an email code, claims the pending entitlement, and consumes code exactly once', async () => {
  const res = await request(app).post('/api/membership/auth/request-code').set('Origin', origin).send({ email })
  expect(res.status).toBe(200); expect(JSON.stringify(res.body)).not.toContain(code)
  challengeId = res.body.data.challengeId
  const verified = await request(app).post('/api/membership/auth/verify-code').set('Origin', origin).send({ challengeId, code })
  expect(verified.status).toBe(200); cookie = verified.headers['set-cookie'][0].split(';')[0]
  expect(verified.headers['set-cookie'][0]).toContain('HttpOnly')
  expect((await request(app).post('/api/membership/auth/verify-code').set('Origin', origin).send({ challengeId, code })).status).toBe(401)
  const me = await request(app).get('/api/membership/me').set('Cookie', cookie)
  expect(me.body.data.accessGranted).toBe(true); expect(me.body.data.memberships[0].claimed).toBe(true)
  expect((await request(app).get('/api/premium/posts/protected-post').set('Cookie', cookie)).body.data.content).toBe('SECRET_PREMIUM_BODY')
})
it('revokes access immediately without invalidating identity and resists webhook regrant', async () => {
  const m = await ctx.models.Membership.findOne()
  const support = createSessionCookie({ id: 's', role: 'support' }).split(';')[0]
  expect((await request(app).get('/api/management/memberships').set('Cookie', support)).status).toBe(403)
  const admin = createSessionCookie({ id: 'a', role: 'super_admin' }).split(';')[0]
  const path = `/api/management/memberships/${m.membershipId}/revoke`
  expect((await request(app).post(path).set('Cookie', admin).send({ reason: 'Customer requested revocation' })).status).toBe(403)
  expect((await request(app).post(path).set('Cookie', admin).set('Origin', 'http://127.0.0.1').set('Host', '127.0.0.1').send({ reason: 'Customer requested revocation' })).status).toBe(200)
  await fulfill(ctx, membership, payment, 'evt_replay_new')
  expect((await request(app).get('/api/premium/posts/protected-post').set('Cookie', cookie)).status).toBe(403)
  expect((await request(app).get('/api/membership/me').set('Cookie', cookie)).status).toBe(200)
})
it('locks a challenge after five guesses and enforces database-backed resend limits', async () => {
  const result = await requestCode(ctx, 'other@example.com', 'ip-other'), correct = code
  for (let n = 0; n < 5; n++) await expect(verifyCode(ctx, result.challengeId, correct === '00000000' ? '11111111' : '00000000', 'ip-other')).rejects.toMatchObject({ code: 'INVALID_CODE' })
  await expect(verifyCode(ctx, result.challengeId, correct, 'ip-other')).rejects.toMatchObject({ code: 'INVALID_CODE' })
  await expect(requestCode(ctx, 'other@example.com', 'ip-other')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
})
it('prevents a stale payment snapshot from undoing a refund', async () => {
  await fulfill(ctx, membership, { ...payment, refunded_amount: '50.00', updated_at: '2026-09-27T00:00:00Z' }, 'evt_refund')
  await fulfill(ctx, membership, payment, 'evt_stale_paid')
  const m = await ctx.models.Membership.findOne()
  expect(m.status).toBe('suspended')
  expect((await ctx.models.MembershipReceipt.findOne()).refundedAmount).toBe('5000')
})
it('expires sessions independently of TTL cleanup and never trusts frontend claims', async () => {
  await ctx.models.MemberSession.updateOne({ tokenHash: digest(cookie.split('=')[1]) }, { $set: { expiresAt: new Date(0) } })
  expect((await request(app).get('/api/premium/posts/protected-post?isPremium=true').set('Cookie', cookie)).status).toBe(401)
})
it('records owner-verified purchases idempotently without inventing provider receipts', async () => {
  const input = { email: 'owner-confirmed@example.com', name: 'Known customer', purchasedOn: '2026-09-26', actor: 'test-owner', reason: 'Owner has personally verified the purchase.' }
  const a = await grantOwnerVerifiedPurchase(ctx, input), b = await grantOwnerVerifiedPurchase(ctx, input)
  expect(a.membershipId).toBe(b.membershipId)
  expect(a.paymentStatus).toBe('owner_verified'); expect(a.amount).toBe('5000'); expect(hasAccess(a)).toBe(true)
  expect(a.customerId).toBeUndefined(); expect(a.expiresAt).toBeUndefined()
  expect(await ctx.models.MembershipReceipt.countDocuments({ membershipId: a._id })).toBe(0)
  await ctx.models.Membership.updateOne({ _id: a._id }, { $set: { revokedAt: new Date() } })
  expect(hasAccess(await grantOwnerVerifiedPurchase(ctx, input))).toBe(false)
})

it('isolates course purchases, claims them through email verification, and protects both article paths', async () => {
  const purchase = { email: 'course-only@example.com', name: 'Course learner', plan: 'ai_visual_mastery', providerPaymentId: 'pay_courseOnly', purchasedOn: '2026-09-30', total: '10800', tax: '800', actor: 'test-owner' }
  const [first, second] = await Promise.all([recordCoursePurchase(ctx, purchase), recordCoursePurchase(ctx, purchase)])
  expect(first.membershipId).toBe(second.membershipId)
  expect(first.paymentStatus).toBe('owner_verified')
  expect(await ctx.models.MembershipReceipt.countDocuments({ membershipId: first._id })).toBe(0)
  await expect(recordCoursePurchase(ctx, { ...purchase, email: 'someone-else@example.com' })).rejects.toMatchObject({ code: 'PURCHASE_CONFLICT' })
  await expect(recordCoursePurchase(ctx, { ...purchase, total: '100' })).rejects.toMatchObject({ code: 'INVALID_PURCHASE_TOTAL' })
  for (const plan of ['ai_visual_mastery', 'ai_training_premium']) await ctx.models.Post.create({ environment: 'test', slug: plan.replaceAll('_', '-'), title: plan, excerpt: 'Safe course preview', content: `PRIVATE_${plan}`, visibility: 'premium', requiredEntitlement: plan, published: true })
  const listing = await request(app).get('/api/content/posts?plan=ai_visual_mastery')
  expect(listing.body.data.items).toHaveLength(1)
  expect(JSON.stringify(listing.body)).not.toContain('PRIVATE_')
  expect((await request(app).get('/api/content/posts?plan=unknown')).status).toBe(400)
  expect((await request(app).get('/api/content/posts/ai-visual-mastery')).status).toBe(401)
  const challenge = await requestCode(ctx, purchase.email, 'course-ip')
  const token = await verifyCode(ctx, challenge.challengeId, code, 'course-ip')
  const courseCookie = `nexvijo_member_session=${token}`
  const me = await request(app).get('/api/membership/me').set('Cookie', courseCookie)
  expect(me.body.data.accessGranted).toBe(true)
  expect(me.body.data.blogAccessGranted).toBe(false)
  expect(me.body.data.memberships[0].productName).toBe('AI Visual Content Mastery')
  for (const path of ['/api/content/posts/', '/api/premium/posts/']) {
    expect((await request(app).get(`${path}ai-visual-mastery`).set('Cookie', courseCookie)).status).toBe(200)
    expect((await request(app).get(`${path}ai-training-premium`).set('Cookie', courseCookie)).status).toBe(403)
    expect((await request(app).get(`${path}protected-post`).set('Cookie', courseCookie)).status).toBe(403)
  }
  await ctx.models.Membership.updateOne({ _id: first._id }, { $set: { revokedAt: new Date() } })
  expect(hasAccess(await recordCoursePurchase(ctx, purchase))).toBe(false)
  expect((await request(app).get('/api/content/posts/ai-visual-mastery').set('Cookie', courseCookie)).status).toBe(403)
})
