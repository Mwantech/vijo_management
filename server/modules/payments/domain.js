import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '../../errors.js'

export const id = (prefix) => `${prefix}_${randomBytes(18).toString('base64url')}`
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const fail = (code, message, status = 409) => { throw new ApiError(code, message, status) }
export const exponents = Object.freeze({ KES: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 })
export const amountSchema = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(v => /^[1-9][0-9]{0,15}$/.test(v) && BigInt(v) <= 9999999999999999n)
const metadata = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/).refine(k => !['constructor', 'prototype', '__proto__'].includes(k)), z.string().max(200)).refine(v => Object.keys(v).length <= 20 && Buffer.byteLength(JSON.stringify(v)) <= 4096)
export const paymentSchema = z.object({
  amount: amountSchema, currency: z.enum(Object.keys(exponents)), method: z.literal('card'),
  reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
  customer: z.object({ externalId: z.string().max(128).optional(), email: z.string().email().max(254).optional() }).strict().optional(),
  metadata: metadata.default({}),
}).strict()
export const refundSchema = z.object({ amount: amountSchema, reason: z.enum(['customer_request', 'duplicate', 'fraudulent']) }).strict()
export const keySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
export const publicId = z.string().regex(/^(pay|ref)_[A-Za-z0-9_-]{24}$/)
export function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) fail('VALIDATION_ERROR', 'Invalid payment request.', 400)
  return result.data
}
export function major(minor, currency) {
  const e = exponents[currency]
  if (e === undefined) fail('UNSUPPORTED_CURRENCY', 'Currency is not supported.', 422)
  const s = BigInt(minor).toString().padStart(e + 1, '0')
  return e ? `${s.slice(0, -e)}.${s.slice(-e)}` : s
}
export function minor(majorValue, currency) {
  const e = exponents[currency], s = String(majorValue)
  if (e === undefined || !/^\d+(\.\d+)?$/.test(s)) fail('PROVIDER_INVALID_MONEY', 'Invalid provider amount.', 502)
  const [whole, fraction = ''] = s.split('.')
  if (fraction.slice(e).replace(/0/g, '')) fail('PROVIDER_INVALID_MONEY', 'Provider amount has excess precision.', 502)
  return BigInt(whole + fraction.slice(0, e).padEnd(e, '0')).toString()
}
export const states = ['CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED']
const transitions = {
  CREATED: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  FAILED: ['PENDING', 'SUCCEEDED'], CANCELLED: ['SUCCEEDED'], EXPIRED: ['SUCCEEDED'],
  SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED'], PARTIALLY_REFUNDED: ['REFUNDED'], REFUNDED: [],
}
export const canTransition = (from, to) => from !== to && Boolean(transitions[from]?.includes(to))
