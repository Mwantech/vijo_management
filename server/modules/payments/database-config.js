import { z } from 'zod'
export function paymentDatabaseConfig(env = process.env) {
  const v = z.object({ PAYMENTS_MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
    PAYMENTS_MONGODB_DB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/), PAYMENTS_ENVIRONMENT: z.enum(['development', 'test', 'production']) }).parse(env)
  const uri = new URL(v.PAYMENTS_MONGODB_URI)
  if (decodeURIComponent(uri.pathname.slice(1)) !== v.PAYMENTS_MONGODB_DB_NAME) throw new Error('DATABASE_MISMATCH')
  if (env.MONGODB_URI) {
    const main = new URL(env.MONGODB_URI)
    if (main.host === uri.host && main.pathname === uri.pathname) throw new Error('DATABASE_MISMATCH')
  }
  return { uri: v.PAYMENTS_MONGODB_URI, dbName: v.PAYMENTS_MONGODB_DB_NAME, environment: v.PAYMENTS_ENVIRONMENT }
}
