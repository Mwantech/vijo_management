export function configurationIssue(error, fallback) {
  const databaseCode = error.code === 18 ? 'PAYMENT_DATABASE_AUTH_FAILED'
    : error.code === 26 ? 'PAYMENTS_INDEXES_MISSING'
      : error.name === 'MongooseServerSelectionError' ? 'PAYMENT_DATABASE_UNREACHABLE' : fallback
  const code = typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : error.message === 'DATABASE_MISMATCH' ? 'DATABASE_MISMATCH' : databaseCode
  const fields = [...new Set((error.issues?.map(i => i.path?.[0]) || error.details?.fields || [])
    .filter(v => typeof v === 'string' && /^[A-Z][A-Z0-9_]+$/.test(v)))]
  return { code, fields }
}
export function membershipStatus(ctx) {
  const databaseReady = Boolean(ctx?.ready && ctx.connection?.readyState === 1)
  return {
    databaseReady, customerLoginReady: databaseReady && Boolean(ctx?.memberships?.enabled),
    automaticWhopSyncReady: databaseReady && Boolean(ctx?.providerReady && ctx?.config?.workerEnabled && ctx?.memberships?.syncEnabled),
    environment: ctx?.config?.environment || null,
    databaseIssue: databaseReady ? null : ctx?.databaseIssue || { code: 'PAYMENT_DATABASE_UNAVAILABLE', fields: [] },
    loginIssue: ctx?.membershipIssue || (!ctx?.memberships?.enabled ? { code: 'MEMBERSHIPS_DISABLED', fields: ['MEMBERSHIPS_ENABLED'] } : null),
    providerIssue: ctx?.providerIssue || null,
  }
}
