import { describe, it, expect } from 'vitest'
import { paymentSchema, major, minor, canTransition, canonical } from '../domain.js'
import { encrypt, decrypt, signature, verifyWhop } from '../crypto.js'
import { publicAddress, webhookURL, resolveDestination } from '../webhooks.js'
import { paymentConfig } from '../config.js'
import { normalizePayment } from '../providers/whop.js'
import { paymentSignature } from '../managementAuth.js'

describe('payment domain and boundaries', () => {
  it('matches the GoodScenes signing protocol test vector', () => {
    expect(paymentSignature('test-secret', { platform: 'goodscenes', method: 'POST', target: '/api/v1/payments', body: '{"amount":"10000"}', idempotencyKey: 'order-1', timestamp: '1790500000000', nonce: '00000000-0000-4000-8000-000000000000' }))
      .toBe('eab10d21ccfef0210a3a9f849b8625cfd54eb9433c970dd8a87af380cd06536c')
  })
  it('converts money without rounding or floating-point arithmetic', () => {
    expect(major('100000', 'KES')).toBe('1000.00')
    expect(minor('1000.00', 'KES')).toBe('100000')
    expect(major('1234', 'JPY')).toBe('1234')
    expect(major('1234', 'KWD')).toBe('1.234')
    expect(minor('99999999999999.99', 'KES')).toBe('9999999999999999')
    expect(() => minor('1.001', 'KES')).toThrow()
  })
  it('rejects card fields, operators, unsafe numbers and nested metadata', () => {
    const valid = { amount: '100000', currency: 'KES', method: 'card', reference: 'order-1' }
    expect(paymentSchema.safeParse(valid).success).toBe(true)
    for (const invalid of [{ ...valid, amount: 100000 }, { ...valid, amount: '1e3' }, { ...valid, reference: { $ne: null } },
      { ...valid, cardNumber: 'do-not-accept' }, { ...valid, applicationId: 'other' }, { ...valid, metadata: { order: { id: '1' } } }]) {
      expect(paymentSchema.safeParse(invalid).success).toBe(false)
    }
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }))
  })
  it('never regresses captured/refunded funds to a stale failure', () => {
    expect(canTransition('SUCCEEDED', 'FAILED')).toBe(false)
    expect(canTransition('REFUNDED', 'SUCCEEDED')).toBe(false)
    expect(canTransition('PROCESSING', 'SUCCEEDED')).toBe(true)
  })
  it('verifies exact webhook bytes and timestamp', () => {
    const body = Buffer.from('{"id":"msg_test"}'), timestamp = String(Math.floor(Date.now() / 1000)), secret = 'test-secret'
    const headers = { 'webhook-id': 'msg_test', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature(secret, 'msg_test', timestamp, body)}` }
    expect(verifyWhop(body, headers, { webhookSecret: secret })).toBe('msg_test')
    expect(() => verifyWhop(Buffer.from('{}'), headers, { webhookSecret: secret })).toThrow()
    expect(() => verifyWhop(body, headers, { webhookSecret: secret }, Date.now() + 400000)).toThrow()
  })
  it('authenticates encrypted secrets and blocks private destinations', async () => {
    const key = 'a'.repeat(64), encrypted = encrypt('secret', key)
    expect(decrypt(encrypted, key)).toBe('secret')
    expect(() => decrypt(encrypted, 'b'.repeat(64))).toThrow()
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(publicAddress(ip)).toBe(false)
    expect(() => webhookURL('http://example.com')).toThrow()
    await expect(resolveDestination('https://example.com/hook', async () => [{ address: '127.0.0.1', family: 4 }])).rejects.toThrow()
  })
  it('is off by default and does not require Mongo settings when disabled', () => {
    expect(paymentConfig({})).toEqual({ enabled: false })
    expect(() => paymentConfig({ PAYMENTS_ENABLED: 'true' })).toThrow()
  })
  it('rejects provider account mismatches and normalizes captured card payments', () => {
    const payment = { id: 'pay_whop', account_id: 'biz_test', total: { amount: '12.34', currency: 'kes' }, currency: 'kes', status: 'paid', payment_method_type: 'card', paid_at: '2026-09-27T12:00:00Z', metadata: {} }
    expect(normalizePayment(payment, { accountId: 'biz_test' })).toMatchObject({ amount: '1234', status: 'SUCCEEDED' })
    expect(() => normalizePayment(payment, { accountId: 'biz_other' })).toThrow()
  })
  it('uses the environment database name without hardcoded naming restrictions', () => {
    const env = { PAYMENTS_ENABLED: 'true', PAYMENTS_ENVIRONMENT: 'test',
      PAYMENTS_MONGODB_URI: 'mongodb://localhost/custom_payments_test', PAYMENTS_MONGODB_DB_NAME: 'custom_payments_test',
      PAYMENTS_ENCRYPTION_KEY: 'a'.repeat(64), WHOP_ENVIRONMENT: 'sandbox', WHOP_API_KEY: 'test-only-api-key',
      WHOP_ACCOUNT_ID: 'biz_test', WHOP_API_VERSION_DATE: '2026-09-25', WHOP_WEBHOOK_SECRET: 'test-only-secret' }
    expect(paymentConfig(env)).toMatchObject({ uri: env.PAYMENTS_MONGODB_URI, dbName: 'custom_payments_test' })
    expect(() => paymentConfig({ ...env, PAYMENTS_MONGODB_DB_NAME: 'different_database' })).toThrow()
    expect(() => paymentConfig({ ...env, MONGODB_URI: env.PAYMENTS_MONGODB_URI })).toThrow()
    expect(() => paymentConfig({ ...env, PAYMENTS_MONGODB_DB_NAME: '../unsafe' })).toThrow()
    expect(() => paymentConfig({ ...env, WHOP_ENVIRONMENT: 'production' })).toThrow()
  })
})
