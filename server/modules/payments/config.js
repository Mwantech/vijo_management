import { z } from 'zod'
import { fail } from './domain.js'
import { ApiError } from '../../errors.js'

export function paymentConfig(env = process.env) {
  if (env.PAYMENTS_ENABLED !== 'true') return { enabled: false }
  const schema = z.object({
    PAYMENTS_ENVIRONMENT: z.enum(['development', 'test', 'production']),
    PAYMENTS_MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
    PAYMENTS_MONGODB_DB_NAME: z.string().min(1).max(63).regex(/^[A-Za-z0-9_-]+$/),
    PAYMENTS_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    WHOP_ENVIRONMENT: z.enum(['sandbox', 'production']), WHOP_API_KEY: z.string().min(10),
    WHOP_ACCOUNT_ID: z.string().regex(/^biz_[A-Za-z0-9]+$/),
    WHOP_API_VERSION_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}(-\d+)?$/),
    WHOP_WEBHOOK_SECRET: z.string().min(10),
  })
  const result = schema.safeParse(env)
  if (!result.success) throw new ApiError('PAYMENTS_CONFIGURATION', 'Missing or invalid payment settings.', 503,
    { fields: result.error.issues.map(i => i.path[0]) })
  const v = result.data
  const db = v.PAYMENTS_MONGODB_DB_NAME
  if ((v.PAYMENTS_ENVIRONMENT === 'production') !== (v.WHOP_ENVIRONMENT === 'production')) fail('PAYMENTS_CONFIGURATION', 'Payment environment and provider mode must match.', 503)
  const u = new URL(v.PAYMENTS_MONGODB_URI)
  if (decodeURIComponent(u.pathname.slice(1)) !== db) fail('PAYMENTS_CONFIGURATION', 'Payment URI must explicitly name the separate payment database.', 503)
  if (env.MONGODB_URI) {
    const main = new URL(env.MONGODB_URI)
    if (main.host === u.host && main.pathname === u.pathname) fail('PAYMENTS_CONFIGURATION', 'Payment and management databases must differ.', 503)
  }
  return {
    enabled: true, environment: v.PAYMENTS_ENVIRONMENT, uri: v.PAYMENTS_MONGODB_URI, dbName: db,
    encryptionKey: v.PAYMENTS_ENCRYPTION_KEY, providerEnvironment: v.WHOP_ENVIRONMENT,
    apiKey: v.WHOP_API_KEY, accountId: v.WHOP_ACCOUNT_ID, apiVersion: v.WHOP_API_VERSION_DATE,
    webhookSecret: v.WHOP_WEBHOOK_SECRET, previousWebhookSecret: env.WHOP_WEBHOOK_PREVIOUS_SECRET,
    workerEnabled: env.PAYMENTS_WORKER_ENABLED !== 'false',
    creationEnabled: env.PAYMENTS_CREATION_ENABLED === 'true',
    // Hosted links are reusable. Live creation remains blocked until an independently reviewed flow replaces this gate.
    liveCheckoutSupported: false,
    refundsEnabled: env.PAYMENTS_REFUNDS_ENABLED === 'true',
  }
}
