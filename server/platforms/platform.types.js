export const PLATFORM_STATUS = ['healthy', 'degraded', 'unavailable', 'unknown']
export const SUBSCRIPTION_STATUS = ['trial', 'active', 'expired', 'cancelled', 'past_due', 'unknown']
export const TRANSACTION_STATUS = ['successful', 'pending', 'failed', 'reversed', 'cancelled', 'unknown']

export const asNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const money = (value, currency) => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object') return asNumber(value.amount) === undefined ? undefined : { amount: asNumber(value.amount), currency: String(value.currency || currency) }
  const amount = asNumber(value)
  return amount === undefined ? undefined : { amount, currency }
}

export const normalizeStatus = (status) => PLATFORM_STATUS.includes(status) ? status : 'unknown'
export const normalizeSubscriptionStatus = (status) => {
  const value = String(status || '').toLowerCase()
  if (value === 'trialing') return 'trial'
  if (value === 'canceled') return 'cancelled'
  return SUBSCRIPTION_STATUS.includes(value) ? value : 'unknown'
}
export const normalizeTransactionStatus = (status) => {
  const value = String(status || '').toLowerCase()
  if (['success', 'successful', 'completed', 'paid'].includes(value)) return 'successful'
  if (['pending', 'initiated', 'processing'].includes(value)) return 'pending'
  if (['failed', 'declined'].includes(value)) return 'failed'
  if (['reversed', 'refunded'].includes(value)) return 'reversed'
  if (['cancelled', 'canceled'].includes(value)) return 'cancelled'
  return 'unknown'
}
