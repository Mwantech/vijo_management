import { paymentConfig } from './config.js'
import { connectPayments, checkIndexes } from './database.js'
import { createWhop } from './providers/whop.js'
import { startWorker } from './worker.js'
import { membershipConfig } from '../memberships/config.js'
import { paymentDatabaseConfig } from './database-config.js'
import { configurationIssue } from '../memberships/status.js'

export async function initializePayments(env = process.env, dependencies = {}) {
  const connect = dependencies.connectPayments || connectPayments
  const indexes = dependencies.checkIndexes || checkIndexes
  const provider = dependencies.createWhop || createWhop
  const worker = dependencies.startWorker || startWorker
  const ctx = { ready: false, providerReady: false, config: { enabled: false }, close: async () => {} }
  const paymentsEnabled = env.PAYMENTS_ENABLED === 'true'
  try { ctx.memberships = membershipConfig(env) }
  catch (error) {
    ctx.memberships = { enabled: false }
    ctx.membershipIssue = configurationIssue(error, 'MEMBERSHIP_CONFIGURATION')
    console.error(JSON.stringify({ level: 'error', event: 'membership_configuration_invalid', ...ctx.membershipIssue }))
  }
  // Preserve the trusted public-content origin even if email credentials are incomplete.
  if (!ctx.memberships.origin && env.MEMBERSHIP_WEBSITE_ORIGIN) {
    try {
      const url = new URL(env.MEMBERSHIP_WEBSITE_ORIGIN)
      if (url.protocol === 'https:' || (env.NODE_ENV !== 'production' && url.protocol === 'http:')) ctx.memberships.origin = url.origin
    } catch { /* Invalid origins remain disallowed. */ }
  }
  // Administrator access to stored records must not depend on email or checkout credentials.
  try {
    ctx.config = { ...paymentDatabaseConfig(env), enabled: paymentsEnabled }
    Object.assign(ctx, await connect(ctx.config))
    await indexes(ctx.models)
    ctx.ready = true
  } catch (error) {
    if (ctx.connection) await ctx.connection.close()
    ctx.databaseIssue = configurationIssue(error, 'PAYMENT_DATABASE_UNAVAILABLE')
    console.error(JSON.stringify({ level: 'error', event: 'payment_database_unavailable', ...ctx.databaseIssue }))
  }
  ctx.config.enabled = paymentsEnabled
  if (paymentsEnabled && ctx.ready) {
    try {
      const config = paymentConfig(env)
      ctx.provider = provider(config)
      ctx.config = config
      ctx.providerReady = true
    } catch (error) {
      ctx.providerIssue = configurationIssue(error, 'PAYMENTS_CONFIGURATION')
      console.error(JSON.stringify({ level: 'error', event: 'payment_provider_unavailable', ...ctx.providerIssue }))
    }
  }
  let stop = async () => {}
  if (ctx.providerReady && ctx.config.workerEnabled) {
    try { stop = worker(ctx) }
    catch { ctx.providerReady = false; ctx.providerIssue = { code: 'PAYMENT_WORKER_UNAVAILABLE', fields: [] } }
  }
  ctx.close = async () => { ctx.ready = false; await stop(); if (ctx.connection?.readyState) await ctx.connection.close() }
  console.log(JSON.stringify({ level: 'info', event: 'payment_services_status', databaseReady: ctx.ready,
    customerLoginReady: ctx.ready && Boolean(ctx.memberships?.enabled), providerReady: ctx.providerReady }))
  return ctx
}
