import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import request from 'supertest'
import { createManagementApp } from '../../../app.js'
import { connectPayments, setupDatabase, checkIndexes } from '../database.js'
import { id, digest } from '../domain.js'
import { encrypt, signature } from '../crypto.js'
import { acceptPayment, requestRefund } from '../services/payments.js'
import { applyVerifiedPayment } from '../services/verification.js'
import { applyVerifiedRefund } from '../services/refunds.js'
import { claim, tick } from '../worker.js'
import { createSessionCookie } from '../../../middleware/auth.js'
import { paymentSignature } from '../managementAuth.js'

let repl, ctx, app, application, other
const key = 'integration-only-key', dto = { amount: '10000', currency: 'KES', method: 'card', reference: 'order-1', metadata: {} }
async function provision(name) {
  return ctx.models.Application.create({ applicationId: id('app'), name, clientId: id('client'), status: 'ACTIVE', environment: 'test',
    maxAmount: '1000000', currencies: ['KES'], productId: 'prod_test', returnUrl: 'https://example.com/return',
    scopes: ['payments:create', 'payments:read', 'transactions:read', 'refunds:create', 'refunds:read'],
    credentials: [{ credentialId: 'test', secretHash: digest(key), createdAt: new Date() }],
    webhook: { enabled: false, version: 1, url: 'https://example.com/hook', keyId: 'key_test', encryptedSecret: encrypt('webhook-secret', ctx.config.encryptionKey) },
  })
}
const headers = a => ({ 'X-Client-ID': a.clientId, 'X-API-Key': key })
async function evidence(paymentId, providerId = 'pay_whop1') {
  const payment = await ctx.models.Payment.findOne({ paymentId })
  return { paymentId, attemptId: payment.activeAttemptId, providerId, accountId: 'biz_test', status: 'SUCCEEDED',
    amount: payment.amount.toString(), currency: 'KES', method: 'card', refunded: '0', occurredAt: new Date() }
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { version: '7.0.24', downloadDir: '/tmp/vijo-payment-mongo-binaries' } })
  const config = { enabled: true, environment: 'test', uri: repl.getUri('nexvijo_payments_test'), dbName: 'nexvijo_payments_test', encryptionKey: 'a'.repeat(64), creationEnabled: true, refundsEnabled: true,
    accountId: 'biz_test', providerEnvironment: 'sandbox', apiVersion: '2026-09-25', webhookSecret: 'test-webhook-secret' }
  ctx = { config, ...await connectPayments(config), ready: true }
  await setupDatabase(ctx)
  await checkIndexes(ctx.models)
  application = await provision('One'); other = await provision('Two')
  app = createManagementApp({ payments: ctx })
}, 120000)
afterAll(async () => { await ctx?.connection.close(); await repl?.stop() })

describe('payments on a real replica set', () => {
  it('protects payment management endpoints independently of application credentials', async () => {
    const path = '/api/management/payments/analytics'
    expect((await request(app).get(path)).status).toBe(401)
    expect((await request(app).get(path).set(headers(application))).status).toBe(401)
    const support = createSessionCookie({ id: 'support', role: 'support' }).split(';')[0]
    expect((await request(app).get(path).set('Cookie', support)).status).toBe(403)
    const finance = createSessionCookie({ id: 'finance', role: 'finance' }).split(';')[0]
    expect((await request(app).get(path).set('Cookie', finance)).body.data.totalPayments).toBe(0)
    const applications = await request(app).get('/api/management/payments/applications').set('Cookie', finance)
    expect(applications.body.data).toHaveLength(2)
    expect(JSON.stringify(applications.body)).not.toContain('secretHash')
    expect((await request(app).get('/api/management/payments/records?limit=999999').set('Cookie', finance)).status).toBe(400)
    expect((await request(app).get('/api/management/payments/analytics?from=2026-09-28T00:00:00Z&to=2026-09-01T00:00:00Z').set('Cookie', finance)).status).toBe(400)
  })
  it('binds all models to the payment database and enforces indexes', () => {
    for (const model of Object.values(ctx.models)) expect(model.db.name).toBe('nexvijo_payments_test')
  })
  it('accepts simultaneous identical requests once and rejects changed bodies', async () => {
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => acceptPayment(ctx, application, dto, 'same-key')))
    expect(new Set(outcomes.map(o => o.data.paymentId)).size).toBe(1)
    expect(await ctx.models.Payment.countDocuments()).toBe(1)
    expect(await ctx.models.Attempt.countDocuments()).toBe(1)
    expect(await ctx.models.Job.countDocuments()).toBe(1)
    await expect(acceptPayment(ctx, application, { ...dto, amount: '9999' }, 'same-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await acceptPayment(ctx, application, dto, 'another-key')
    expect(await ctx.models.Payment.countDocuments()).toBe(1)
  })
  it('isolates applications on payment/reference/transaction endpoints', async () => {
    const { data } = await acceptPayment(ctx, application, dto, 'same-key')
    expect((await request(app).get(`/api/v1/payments/${data.paymentId}`).set(headers(other))).status).toBe(404)
    expect((await request(app).get('/api/v1/payments/reference/order-1').set(headers(other))).status).toBe(404)
    expect((await request(app).get(`/api/v1/payments/${data.paymentId}`).set('X-Management-Api-Key', 'irrelevant')).status).toBe(401)
    expect((await request(app).post('/api/v1/payments').set(headers(application)).set('Idempotency-Key', 'bad').send({ ...dto, amount: { $ne: null } })).status).toBe(400)
  })
  it('commits capture, transaction and outbox once across concurrent confirmations', async () => {
    const { data } = await acceptPayment(ctx, application, dto, 'same-key')
    const e = await evidence(data.paymentId)
    await Promise.all(Array.from({ length: 5 }, () => applyVerifiedPayment(ctx, e)))
    expect(await ctx.models.Transaction.countDocuments({ type: 'PAYMENT' })).toBe(1)
    expect(await ctx.models.Event.countDocuments({ type: 'payment.succeeded' })).toBe(1)
    await applyVerifiedPayment(ctx, { ...e, status: 'FAILED' })
    expect((await ctx.models.Payment.findOne({ paymentId: data.paymentId })).status).toBe('SUCCEEDED')
  })
  it('persists verified webhooks once, rejects replay tampering', async () => {
    const body = JSON.stringify({ id: 'msg_1', type: 'payment.succeeded', account_id: 'biz_test', api_version_date: '2026-09-25', data: { id: 'pay_whop1' } })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signed = { 'Content-Type': 'application/json', 'webhook-id': 'msg_1', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature(ctx.config.webhookSecret, 'msg_1', timestamp, body)}` }
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/v1/providers/whop/webhook').set(signed).send(body)).status).toBe(200)
    expect(await ctx.models.Inbox.countDocuments()).toBe(1)
    expect((await request(app).post('/api/v1/providers/whop/webhook').set(signed).send('{}')).status).toBe(401)
  })
  it('serializes competing refunds without over-reserving funds', async () => {
    const { data } = await acceptPayment(ctx, application, dto, 'same-key')
    const outcomes = await Promise.allSettled([requestRefund(ctx, application, data.paymentId, { amount: '7000', reason: 'customer_request' }, 'refund-1'), requestRefund(ctx, application, data.paymentId, { amount: '7000', reason: 'customer_request' }, 'refund-2')])
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
    expect((await ctx.models.Payment.findOne({ paymentId: data.paymentId })).reservedAmount.toString()).toBe('7000')
    const refund = await ctx.models.Refund.findOne({})
    await ctx.models.Refund.updateOne({ _id: refund._id }, { $set: { providerRefundId: 'rf_1' } })
    const r = { providerId: 'rf_1', providerPaymentId: 'pay_whop1', accountId: 'biz_test', amount: '7000', currency: 'KES', status: 'succeeded', occurredAt: new Date() }
    await applyVerifiedRefund(ctx, r); await applyVerifiedRefund(ctx, r)
    const payment = await ctx.models.Payment.findOne({ paymentId: data.paymentId })
    expect(payment.status).toBe('PARTIALLY_REFUNDED'); expect(payment.reservedAmount.toString()).toBe('0')
    expect(await ctx.models.Transaction.countDocuments({ type: 'REFUND' })).toBe(1)
  })
  it('claims a due job once across competing workers', async () => {
    await ctx.models.Job.updateMany({}, { $set: { status: 'DONE' } })
    const payment = await ctx.models.Payment.findOne({})
    await ctx.models.Job.create({ operationKey: 'claim-test', operation: 'VERIFY', paymentId: payment._id, applicationId: application._id, status: 'PENDING', environment: 'test' })
    const results = await Promise.all([claim(ctx.models.Job), claim(ctx.models.Job)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
  it('reports posted amounts, keeps currencies separate and paginates the ledger', async () => {
    const finance = createSessionCookie({ id: 'finance', role: 'finance' }).split(';')[0]
    const payment = await ctx.models.Payment.findOne({})
    await ctx.models.Transaction.create({ transactionId: id('txn'), paymentId: payment._id, applicationId: other._id,
      providerReference: 'pay_usd_test', providerAccountId: 'biz_test', type: 'PAYMENT', amount: '123', currency: 'USD', occurredAt: new Date(), environment: 'test' })
    const result = await request(app).get('/api/management/payments/analytics').set('Cookie', finance)
    expect(result.status).toBe(200)
    expect(result.body.data.totals).toEqual(expect.arrayContaining([
      { currency: 'KES', type: 'PAYMENT', amountMinor: '10000', count: 1 },
      { currency: 'KES', type: 'REFUND', amountMinor: '7000', count: 1 },
      { currency: 'USD', type: 'PAYMENT', amountMinor: '123', count: 1 },
    ]))
    const filtered = await request(app).get(`/api/management/payments/transactions?application=${other.applicationId}&limit=1`).set('Cookie', finance)
    expect(filtered.body.data.rows).toHaveLength(1)
    expect(filtered.body.data.rows[0]).toMatchObject({ currency: 'USD', amountMinor: '123', application: 'Two' })
    expect(filtered.body.data.pagination.total).toBe(1)
    expect(await ctx.models.Delivery.countDocuments()).toBe(0)
  })
  it('does not submit unresolved provider operations after the idempotency window', async () => {
    await ctx.models.Inbox.updateMany({}, { $set: { status: 'DONE' } })
    await ctx.models.Job.updateMany({}, { $set: { status: 'DONE' } })
    const result = await acceptPayment(ctx, application, { ...dto, reference: 'expired-operation' }, 'expired-operation')
    const payment = await ctx.models.Payment.findOne({ paymentId: result.data.paymentId })
    await ctx.models.Job.updateOne({ paymentId: payment._id }, { $set: { firstSubmittedAt: new Date(Date.now() - 86400000) } })
    await tick(ctx)
    expect((await ctx.models.Job.findOne({ paymentId: payment._id })).status).toBe('REVIEW_REQUIRED')
  })
  it('authenticates platform signatures, binds tenants and rejects tampering and concurrent replay', async () => {
    vi.stubEnv('GOODSCENES_MANAGEMENT_API_KEY', 'goodscenes-test-management-key')
    vi.stubEnv('GOODSCENES_MANAGEMENT_API_SECRET', 'goodscenes-test-management-secret')
    vi.stubEnv('GOODSCENES_ENABLED', 'true')
    const path = '/api/v1/payments/reference/order-1'
    function signed(target = path, body = '', overrides = {}) {
      const fields = { platform: 'goodscenes', timestamp: String(Date.now()), nonce: randomUUID(), method: body ? 'POST' : 'GET', target, body, idempotencyKey: body ? 'signed-create' : '', ...overrides }
      return { 'X-Management-Platform': fields.platform, 'X-Management-Key': 'goodscenes-test-management-key',
        'X-Management-Timestamp': fields.timestamp, 'X-Management-Nonce': fields.nonce,
        'X-Management-Signature': paymentSignature('goodscenes-test-management-secret', fields), ...(fields.idempotencyKey ? { 'Idempotency-Key': fields.idempotencyKey } : {}) }
    }
    try {
      expect((await request(app).get(path).set(signed())).status).toBe(403) // no automatic registration
      await ctx.models.Application.updateOne({ _id: application._id }, { $set: { managementPlatform: 'goodscenes' } })
      const response = await request(app).get(path).set(signed())
      expect(response.status).toBe(200)
      expect(response.body.data.reference).toBe('order-1')
      expect((await request(app).get(path).set(headers(application))).status).toBe(401) // no downgrade
      const replayHeaders = signed()
      const replies = await Promise.all([request(app).get(path).set(replayHeaders), request(app).get(path).set(replayHeaders)])
      expect(replies.map(r => r.status).sort()).toEqual([200, 409])
      expect((await request(app).get(path).set(signed(path, '', { timestamp: String(Date.now() - 600000) }))).status).toBe(401)
      expect((await request(app).get('/api/v1/payments/health').set(signed())).status).toBe(401)
      const body = JSON.stringify({ ...dto, reference: 'signed-new' })
      expect((await request(app).post('/api/v1/payments').set(signed('/api/v1/payments', body)).set('Content-Type', 'application/json').send(body.replace('10000', '20000'))).status).toBe(401)
      expect((await request(app).post('/api/v1/payments').set(signed('/api/v1/payments', body)).set('Idempotency-Key', 'changed').set('Content-Type', 'application/json').send(body)).status).toBe(401)
      const created = await request(app).post('/api/v1/payments').set(signed('/api/v1/payments', body)).set('Content-Type', 'application/json').send(body)
      expect(created.status).toBe(202)
      const retry = await request(app).post('/api/v1/payments').set(signed('/api/v1/payments', body)).set('Content-Type', 'application/json').send(body)
      expect(retry.body.data.paymentId).toBe(created.body.data.paymentId)
      const otherPayment = await acceptPayment(ctx, other, { ...dto, reference: 'other-private' }, 'other-private')
      const otherPath = `/api/v1/payments/${otherPayment.data.paymentId}`
      expect((await request(app).get(otherPath).set(signed(otherPath))).status).toBe(404)
      await ctx.models.Application.updateOne({ _id: application._id }, { $set: { status: 'DISABLED' } })
      expect((await request(app).get(path).set(signed())).status).toBe(403)
      await ctx.models.Application.updateOne({ _id: application._id }, { $set: { status: 'ACTIVE' } })
      vi.stubEnv('GRADEPOA_MANAGEMENT_API_KEY', 'goodscenes-test-management-key')
      expect((await request(app).get(path).set(signed())).status).toBe(503)
    } finally { vi.unstubAllEnvs() }
  })
})
