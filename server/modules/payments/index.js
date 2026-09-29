import { paymentConfig } from './config.js'
import { connectPayments, checkIndexes } from './database.js'
import { createWhop } from './providers/whop.js'
import { startWorker } from './worker.js'
import { membershipConfig } from '../memberships/config.js'
import { paymentDatabaseConfig } from './database-config.js'

export async function initializePayments() {
  const ctx = { ready: false, config: { enabled: false }, close: async () => {} }
  const paymentsEnabled = process.env.PAYMENTS_ENABLED === 'true'
  if (!paymentsEnabled && process.env.MEMBERSHIPS_ENABLED !== 'true') return ctx
  ctx.config.enabled = paymentsEnabled
  try {
    ctx.config = paymentsEnabled ? paymentConfig() : { ...paymentDatabaseConfig(), enabled: false }
    Object.assign(ctx, await connectPayments(ctx.config))
    await checkIndexes(ctx.models)
    if (paymentsEnabled) ctx.provider = createWhop(ctx.config)
    try { ctx.memberships = membershipConfig() } catch { ctx.memberships = { enabled: false }; console.error(JSON.stringify({ level: 'error', event: 'membership_configuration_invalid' })) }
    ctx.ready = true
    const stop = paymentsEnabled && ctx.config.workerEnabled ? startWorker(ctx) : async () => {}
    ctx.close = async () => { ctx.ready = false; await stop(); await ctx.connection.close() }
    console.log(JSON.stringify({ level: 'info', event: 'payments_started', environment: ctx.config.environment }))
  } catch (error) {
    if (ctx.connection) await ctx.connection.close()
    console.error(JSON.stringify({ level: 'error', event: 'payments_unavailable', errorCode: typeof error.code === 'string' ? error.code : 'PAYMENTS_INITIALIZATION_FAILED' }))
  }
  return ctx
}
