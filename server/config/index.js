const cleanUrl = (value) => value?.trim().replace(/\/$/, '')
const list = (value, fallback = '') => (value || fallback).split(',').map((item) => item.trim().replace(/\/$/, '')).filter(Boolean)
const integer = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback

export const managementConfig = {
  host: process.env.MANAGEMENT_HOST || '127.0.0.1',
  port: integer(process.env.MANAGEMENT_PORT || process.env.PORT, 4000),
  allowedOrigins: list(process.env.MANAGEMENT_ALLOWED_ORIGINS, 'http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173,http://localhost:5174'),
  bodyLimit: process.env.MANAGEMENT_BODY_LIMIT || '32kb',
  rateLimitPerMinute: integer(process.env.MANAGEMENT_RATE_LIMIT_PER_MINUTE, 240),
  trustProxy: process.env.MANAGEMENT_TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  platformTimeoutMs: integer(process.env.MANAGEMENT_PLATFORM_TIMEOUT_MS, 8_000),
  platformRetries: Math.min(integer(process.env.MANAGEMENT_PLATFORM_RETRIES, 1), 2),
}

export const PLATFORM_IDS = ['gradepoa', 'goodscenes', 'hms', 'pos']

const definitions = {
  gradepoa: {
    name: 'GradePoa',
    prefix: 'GRADEPOA',
    liveUrl: 'https://gradepoa.onrender.com',
    currency: 'KES',
    capabilities: { users: true, revenue: true, subscriptions: true, transactions: true, activity: true },
  },
  goodscenes: {
    name: 'GoodScenes',
    prefix: 'GOODSCENES',
    liveUrl: 'https://getgoodscenes.onrender.com',
    currency: 'KES',
    capabilities: { users: true, revenue: true, subscriptions: false, transactions: true, activity: true },
  },
  hms: {
    name: 'HMS',
    prefix: 'HMS',
    liveUrl: 'https://bensmma.onrender.com',
    currency: 'KES',
    capabilities: { users: true, revenue: true, subscriptions: true, transactions: true, activity: true },
  },
  pos: {
    name: 'VijoPOS',
    prefix: 'VIJOPOS',
    legacyPrefix: 'POS',
    liveUrl: 'https://point-of-sale-system-cbew.onrender.com',
    currency: 'KES',
    capabilities: { users: true, revenue: true, subscriptions: true, transactions: true, activity: true, merchantAnalytics: true },
  },
}

const envValue = (definition, suffix) => process.env[`${definition.prefix}_${suffix}`] || (definition.legacyPrefix ? process.env[`${definition.legacyPrefix}_${suffix}`] : undefined)

export function platformConfig(id) {
  const definition = definitions[id]
  if (!definition) return undefined
  return {
    id,
    name: definition.name,
    enabled: envValue(definition, 'ENABLED') !== 'false',
    baseUrl: cleanUrl(envValue(definition, 'API_URL') || definition.liveUrl),
    apiKey: envValue(definition, 'MANAGEMENT_API_KEY') || envValue(definition, 'API_KEY'),
    apiSecret: envValue(definition, 'MANAGEMENT_API_SECRET'),
    currency: envValue(definition, 'CURRENCY') || definition.currency,
    capabilities: definition.capabilities,
    timeoutMs: integer(envValue(definition, 'TIMEOUT_MS'), managementConfig.platformTimeoutMs),
  }
}

export function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return
  const requiredGatewayVariables = [
    'VIJO_MANAGEMENT_SESSION_SECRET',
    'MANAGEMENT_ADMIN_EMAIL',
    'MANAGEMENT_ADMIN_PASSWORD_HASH',
    'VIJO_MANAGEMENT_API_KEY',
  ]
  const gatewayValues = {
    VIJO_MANAGEMENT_SESSION_SECRET: process.env.VIJO_MANAGEMENT_SESSION_SECRET || process.env.MANAGEMENT_SESSION_SECRET,
    MANAGEMENT_ADMIN_EMAIL: process.env.MANAGEMENT_ADMIN_EMAIL,
    MANAGEMENT_ADMIN_PASSWORD_HASH: process.env.MANAGEMENT_ADMIN_PASSWORD_HASH,
    VIJO_MANAGEMENT_API_KEY: process.env.VIJO_MANAGEMENT_API_KEY || process.env.MANAGEMENT_API_KEY,
  }
  const missingGatewayVariables = requiredGatewayVariables.filter((name) => !gatewayValues[name]?.trim())
  if (missingGatewayVariables.length) {
    throw new Error(`Missing required production environment variables: ${missingGatewayVariables.join(', ')}`)
  }
  for (const id of PLATFORM_IDS) {
    const config = platformConfig(id)
    if (config.enabled) {
      const missingPlatformVariables = [
        !config.apiKey?.trim() ? `${definitions[id].prefix}_MANAGEMENT_API_KEY` : undefined,
        !config.apiSecret?.trim() ? `${definitions[id].prefix}_MANAGEMENT_API_SECRET` : undefined,
      ].filter(Boolean)
      if (missingPlatformVariables.length) {
        throw new Error(`Missing required ${config.name} environment variables: ${missingPlatformVariables.join(', ')}`)
      }
    }
  }
}
