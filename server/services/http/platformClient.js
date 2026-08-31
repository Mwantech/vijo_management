import { createHmac, randomUUID } from 'node:crypto'
import { managementConfig } from '../../config/index.js'
import { PlatformError } from '../../errors.js'

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const errorForStatus = (platform, status, message) => {
  if (status === 401 || status === 403) return new PlatformError(platform, 'PLATFORM_AUTH_FAILED', message, 502)
  if (status === 404) return new PlatformError(platform, 'UPSTREAM_ROUTE_NOT_FOUND', message, 502)
  if (status >= 500) return new PlatformError(platform, 'PLATFORM_UNAVAILABLE', message, 503)
  return new PlatformError(platform, 'UPSTREAM_ERROR', message, 502)
}

export function createPlatformClient(config) {
  const request = async (path, { query = {}, requestId, retries = managementConfig.platformRetries } = {}) => {
    if (!config.enabled || !config.baseUrl) throw new PlatformError(config.id, 'PLATFORM_NOT_CONFIGURED', `${config.name} is not configured.`, 503)
    const url = new URL(path, `${config.baseUrl}/`)
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    const correlationId = requestId || randomUUID()
    const attemptRequest = async (attempt) => {
      const timestamp = String(Date.now())
      const target = `${url.pathname}${url.search}`
      const headers = { Accept: 'application/json', 'X-Request-ID': correlationId }
      if (config.apiKey) headers['X-Management-Key'] = config.apiKey
      if (config.apiSecret) {
        headers['X-Management-Timestamp'] = timestamp
        headers['X-Management-Signature'] = createHmac('sha256', config.apiSecret).update(`${timestamp}\nGET\n${target}`).digest('hex')
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
      const startedAt = performance.now()
      try {
        const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
        const text = await response.text()
        let body
        try { body = text ? JSON.parse(text) : undefined } catch { throw new PlatformError(config.id, 'UPSTREAM_INVALID_RESPONSE', `${config.name} returned a non-JSON response.`, 502) }
        if (!response.ok) throw errorForStatus(config.id, response.status, body?.error?.message || body?.message || `${config.name} returned HTTP ${response.status}.`)
        return { data: body?.success === true && 'data' in body ? body.data : body, pagination: body?.pagination, latencyMs: Math.round(performance.now() - startedAt) }
      } catch (error) {
        const normalized = error?.name === 'AbortError'
          ? new PlatformError(config.id, 'PLATFORM_TIMEOUT', `${config.name} timed out.`, 504)
          : error instanceof PlatformError ? error : new PlatformError(config.id, 'PLATFORM_UNAVAILABLE', `${config.name} is unavailable.`, 503)
        if (attempt < retries && ['PLATFORM_TIMEOUT', 'PLATFORM_UNAVAILABLE'].includes(normalized.code)) {
          await wait(150 * (2 ** attempt))
          return attemptRequest(attempt + 1)
        }
        throw normalized
      } finally {
        clearTimeout(timeout)
      }
    }
    return attemptRequest(0)
  }
  return { get: request }
}
