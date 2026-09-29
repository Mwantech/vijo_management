import { createHmac } from 'node:crypto'
import { PLATFORM_IDS, platformConfig } from '../../config/index.js'
import { digest, fail } from './domain.js'
import { equal } from './crypto.js'

// Different protocol/purpose from management -> product analytics signatures.
export function paymentSignature(secret, { platform, timestamp, nonce, method, target, body = '', idempotencyKey = '' }) {
  return createHmac('sha256', secret).update(['vijo-payments-request-v1', platform, timestamp, nonce,
    method, target, digest(body), idempotencyKey].join('\n')).digest('hex')
}

export function paymentPlatformCredentials(platform) {
  const config = platformConfig(platform)
  if (!config?.enabled || !config.apiKey || !config.apiSecret) fail('UNAUTHORIZED', 'Invalid payment service credentials.', 401)
  // A reused key cannot securely identify one product.
  if (PLATFORM_IDS.some(id => id !== platform && platformConfig(id)?.apiKey && equal(platformConfig(id).apiKey, config.apiKey))) {
    fail('PAYMENT_AUTH_CONFIGURATION', 'Payment authentication requires unique per-platform keys.', 503)
  }
  return config
}

export async function authenticateSignedApplication(ctx, req) {
  const platform = req.get('X-Management-Platform'), key = req.get('X-Management-Key')
  const timestamp = req.get('X-Management-Timestamp'), nonce = req.get('X-Management-Nonce'), signature = req.get('X-Management-Signature')
  if (!PLATFORM_IDS.includes(platform) || typeof key !== 'string' || key.length > 256 ||
    !/^\d{13}$/.test(timestamp || '') || Math.abs(Date.now() - Number(timestamp)) > 300000 ||
    !/^[a-f0-9-]{36}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '') ||
    req.get('X-Client-ID') || req.get('X-API-Key')) fail('UNAUTHORIZED', 'Invalid signed payment request.', 401)
  const credentials = paymentPlatformCredentials(platform)
  const expected = paymentSignature(credentials.apiSecret, { platform, timestamp, nonce, method: req.method,
    target: req.originalUrl, body: req.paymentRawBody || '', idempotencyKey: req.get('Idempotency-Key') || '' })
  if (!equal(key, credentials.apiKey) || !equal(signature, expected)) fail('UNAUTHORIZED', 'Invalid signed payment request.', 401)
  const app = await ctx.models.Application.findOne({ managementPlatform: platform, environment: ctx.config.environment })
  if (!app) fail('FORBIDDEN', 'This platform has not been registered for payments.', 403)
  if (app.status !== 'ACTIVE') fail('FORBIDDEN', 'Application is disabled.', 403)
  try {
    // Unique insert, not an in-memory cache. Retain beyond the entire clock-skew window.
    await ctx.models.RequestNonce.create([{ platform, nonce, environment: ctx.config.environment,
      expiresAt: new Date(Date.now() + 600000) }], { writeConcern: { w: 'majority' } })
  } catch (error) {
    if (error.code === 11000) fail('REQUEST_REPLAYED', 'This request was already received. Retry with a fresh nonce and the same idempotency key.', 409)
    throw error
  }
  return app
}
