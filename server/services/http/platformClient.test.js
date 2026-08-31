import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatformClient } from './platformClient.js'

const config = { id: 'gradepoa', name: 'GradePoa', enabled: true, baseUrl: 'https://gradepoa.example', apiKey: 'private-key', apiSecret: 'private-secret', timeoutMs: 500 }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('platform HTTP client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('propagates request IDs and keeps service credentials in backend headers', async () => {
    const fetchMock = vi.fn(async (url, options) => {
      expect(String(url)).toContain('/internal/management/summary?from=2026-08-01')
      expect(options.headers['X-Request-ID']).toBe('request-123')
      expect(options.headers['X-Management-Key']).toBe('private-key')
      expect(options.headers['X-Management-Signature']).toMatch(/^[a-f0-9]{64}$/)
      return json({ success: true, data: { users: { total: 1 } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await createPlatformClient(config).get('/internal/management/summary', { query: { from: '2026-08-01' }, requestId: 'request-123' })
    expect(result.data.users.total).toBe(1)
  })

  it('retries a safe GET once after an availability failure', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json({ success: true, data: { status: 'healthy' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(createPlatformClient(config).get('/internal/management/health', { retries: 1 })).resolves.toMatchObject({ data: { status: 'healthy' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('normalizes upstream authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: { message: 'bad key' } }, 401)))
    await expect(createPlatformClient(config).get('/internal/management/summary', { retries: 0 })).rejects.toMatchObject({ code: 'PLATFORM_AUTH_FAILED', status: 502 })
  })
})
