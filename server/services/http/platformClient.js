import { createHmac, randomUUID } from 'node:crypto'
import { managementConfig } from '../../config/index.js'
import { PlatformError } from '../../errors.js'

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const errorForStatus = (platform, status, message) => {
  const error = status === 401 || status === 403
    ? new PlatformError(platform, 'PLATFORM_AUTH_FAILED', message, 502)
    : status === 404
      ? new PlatformError(platform, 'UPSTREAM_ROUTE_NOT_FOUND', message, 502)
      : status >= 500
        ? new PlatformError(platform, 'PLATFORM_UNAVAILABLE', message, 503)
        : new PlatformError(platform, 'UPSTREAM_ERROR', message, 502)
  error.upstreamStatusCode = status
  return error
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
        try { body = text ? JSON.parse(text) : undefined } catch {
          if (!response.ok) throw errorForStatus(config.id, response.status, `${config.name} returned HTTP ${response.status} with a non-JSON response.`)
          throw new PlatformError(config.id, 'UPSTREAM_INVALID_RESPONSE', `${config.name} returned a non-JSON response.`, 502)
        }
        if (!response.ok) throw errorForStatus(config.id, response.status, body?.error?.message || body?.message || `${config.name} returned HTTP ${response.status}.`)
        const latencyMs = Math.round(performance.now() - startedAt)
        console.log(JSON.stringify({ level: 'info', event: 'platform_request_completed', requestId: correlationId, platform: config.id, method: 'GET', route: url.pathname, statusCode: response.status, responseTimeMs: latencyMs, attempt: attempt + 1 }))
        return { data: body?.success === true && 'data' in body ? body.data : body, pagination: body?.pagination, latencyMs }
      } catch (error) {
        const normalized = error?.name === 'AbortError'
          ? new PlatformError(config.id, 'PLATFORM_TIMEOUT', `${config.name} timed out.`, 504)
          : error instanceof PlatformError ? error : new PlatformError(config.id, 'PLATFORM_UNAVAILABLE', `${config.name} is unavailable.`, 503)
        if (attempt < retries && ['PLATFORM_TIMEOUT', 'PLATFORM_UNAVAILABLE'].includes(normalized.code)) {
          await wait(150 * (2 ** attempt))
          return attemptRequest(attempt + 1)
        }
        console.warn(JSON.stringify({ level: 'warn', event: 'platform_request_failed', requestId: correlationId, platform: config.id, method: 'GET', route: url.pathname, upstreamStatusCode: normalized.upstreamStatusCode, errorCode: normalized.code, responseTimeMs: Math.round(performance.now() - startedAt), attempt: attempt + 1 }))
        throw normalized
      } finally {
        clearTimeout(timeout)
      }
    }
    return attemptRequest(0)
  }
  return { get: request }
}
