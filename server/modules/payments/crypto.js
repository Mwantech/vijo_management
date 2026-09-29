import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { fail } from './domain.js'

export function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
export function encrypt(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  return [iv.toString('base64'), Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64'), cipher.getAuthTag().toString('base64')].join('.')
}
export function decrypt(value, key) {
  const [iv, body, tag] = value.split('.').map(v => Buffer.from(v, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8')
}
export const signature = (secret, eventId, timestamp, body) => createHmac('sha256', secret).update(`${eventId}.${timestamp}.`).update(body).digest('base64')
export function verifyWhop(body, headers, config, now = Date.now()) {
  const eventId = headers['webhook-id'], timestamp = headers['webhook-timestamp'], signed = headers['webhook-signature']
  if (!Buffer.isBuffer(body) || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId || '') || !/^\d{10}$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof signed !== 'string' || signed.length > 1024) fail('INVALID_SIGNATURE', 'Invalid webhook signature.', 401)
  const secrets = [config.webhookSecret, config.previousWebhookSecret].filter(Boolean)
  if (!secrets.some(secret => signed.split(' ').some(s => s.startsWith('v1,') && equal(s.slice(3), signature(secret, eventId, timestamp, body))))) fail('INVALID_SIGNATURE', 'Invalid webhook signature.', 401)
  return eventId
}
