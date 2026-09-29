import { LosslessNumber, parse, stringify } from 'lossless-json'
import { fail, major, minor } from '../domain.js'

export function normalizePayment(value, config) {
  const currency = String(value.currency || '').toUpperCase()
  if (value.account_id !== config.accountId || !/^pay_[A-Za-z0-9]+$/.test(value.id || '') || !value.total || String(value.total.currency).toUpperCase() !== currency) fail('PROVIDER_INVALID_RESPONSE', 'Provider payment identity or currency is invalid.', 502)
  const paid = value.status === 'paid'
  const status = paid ? 'SUCCEEDED' : ({ draft: 'PENDING', open: 'PENDING', pending: 'PROCESSING', authorized: 'PROCESSING', uncollectible: 'FAILED', void: 'CANCELLED' }[value.status] || 'UNKNOWN')
  return { providerId: value.id, accountId: value.account_id, checkoutId: value.checkout_configuration_id,
    paymentId: value.metadata?.vijo_payment_id, attemptId: value.metadata?.vijo_attempt_id,
    status, amount: minor(value.total.amount, currency), currency, method: value.payment_method_type,
    refunded: value.refunded_amount ? minor(value.refunded_amount.amount, currency) : '0',
    // Keep provider payloads out of persistence and logs.
    occurredAt: value.paid_at ? new Date(value.paid_at) : new Date(value.updated_at),
  }
}
export function createWhop(config, transport = fetch) {
  const base = config.providerEnvironment === 'production' ? 'https://api.whop.com/api/v1' : 'https://sandbox-api.whop.com/api/v1'
  async function request(path, { body, key } = {}) {
    let response
    try {
      response = await transport(`${base}${path}`, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
          'Api-Version-Date': config.apiVersion, ...(key ? { 'Idempotency-Key': key } : {}) }, body })
      if (!response.ok) fail(`WHOP_HTTP_${response.status}`, 'Provider request could not be completed.', 502)
      const reader = response.body.getReader(); let text = '', size = 0
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length
        if (size > 1024 * 1024) { await reader.cancel(); fail('PROVIDER_RESPONSE_LIMIT', 'Provider response exceeded limit.', 502) }
        text += Buffer.from(value).toString('utf8')
      }
      return parse(text)
    } catch (error) {
      if (error.code?.startsWith('WHOP_') || error.code?.startsWith('PROVIDER_')) throw error
      fail('PROVIDER_OUTCOME_UNKNOWN', 'Provider request outcome is unknown.', 502)
    }
  }
  return {
    async getMembership(providerId) {
      if (!/^mem_[A-Za-z0-9]+$/.test(providerId)) fail('PROVIDER_INVALID_REFERENCE', 'Invalid membership reference.', 502)
      return request(`/memberships/${providerId}`)
    },
    async getMembershipPayment(providerId) {
      if (!/^pay_[A-Za-z0-9]+$/.test(providerId)) fail('PROVIDER_INVALID_REFERENCE', 'Invalid payment reference.', 502)
      return request(`/payments/${providerId}`)
    },
    checkoutBody(payment, attempt, app) {
      return stringify({ account_id: config.accountId, mode: 'payment',
        plan: { product_id: app.productId, plan_type: 'one_time', currency: payment.currency.toLowerCase(),
          initial_price: new LosslessNumber(major(payment.amount.toString(), payment.currency)), adaptive_pricing_enabled: false },
        metadata: { vijo_payment_id: payment.paymentId, vijo_attempt_id: attempt.attemptId },
        payment_method_configuration: { enabled: ['card'], include_platform_defaults: false }, redirect_url: app.returnUrl })
    },
    async createPayment(body, key) {
      const data = await request('/checkout_configurations', { body, key })
      let url
      try { url = new URL(data.purchase_url) } catch { fail('PROVIDER_INVALID_RESPONSE', 'Invalid checkout response.', 502) }
      const host = config.providerEnvironment === 'production' ? 'whop.com' : 'sandbox.whop.com'
      const methods = data.effective_payment_method_configuration
      if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || data.account_id !== config.accountId || !/^ch_[A-Za-z0-9]+$/.test(data.id || '') || !methods || methods.include_platform_defaults !== false || methods.enabled?.length !== 1 || methods.enabled[0] !== 'card') fail('PROVIDER_INVALID_RESPONSE', 'Checkout account, host or card-only policy could not be verified.', 502)
      return { checkoutId: data.id, url: url.href }
    },
    async getPaymentStatus(providerId) {
      if (!/^pay_[A-Za-z0-9]+$/.test(providerId)) fail('PROVIDER_INVALID_REFERENCE', 'Invalid provider reference.', 502)
      return normalizePayment(await request(`/payments/${providerId}`), config)
    },
    async getRefundStatus(refundId) {
      if (!/^rf_[A-Za-z0-9]+$/.test(refundId)) fail('PROVIDER_INVALID_REFERENCE', 'Invalid refund reference.', 502)
      const value = await request(`/refunds/${refundId}`)
      if (value.account_id !== config.accountId || value.id !== refundId || !value.original_amount) fail('PROVIDER_INVALID_RESPONSE', 'Refund identity is invalid.', 502)
      const currency = String(value.original_amount.currency).toUpperCase()
      return { providerId: value.id, providerPaymentId: value.payment_id, accountId: value.account_id,
        amount: minor(value.original_amount.amount, currency), currency, status: value.status, occurredAt: new Date(value.updated_at) }
    },
    refundBody(amount, currency) { return stringify({ partial_amount: new LosslessNumber(major(amount, currency)) }) },
    async refund(providerId, body, key) {
      if (!/^pay_[A-Za-z0-9]+$/.test(providerId)) fail('PROVIDER_INVALID_REFERENCE', 'Invalid provider reference.', 502)
      await request(`/payments/${providerId}/refund`, { body, key })
      // The HTTP response is acceptance, never final refund confirmation.
    },
  }
}
