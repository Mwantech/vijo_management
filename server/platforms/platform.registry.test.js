import { describe, expect, it } from 'vitest'
import { getPlatformAdapter, platformAdapters } from './platform.registry.js'
import { posMapper } from './pos/pos.mapper.js'

describe('platform registry and mappers', () => {
  it('registers every initial platform', () => {
    expect(Object.keys(platformAdapters)).toEqual(['gradepoa', 'goodscenes', 'hms', 'pos'])
    expect(getPlatformAdapter('gradepoa').config.name).toBe('GradePoa')
  })

  it('rejects unknown platforms with a normalized error', () => {
    expect(() => getPlatformAdapter('unknown')).toThrowError(/not configured/i)
  })

  it('maps POS merchant and subscription values without leaking raw schemas', () => {
    const config = getPlatformAdapter('pos').config
    const user = posMapper.user({ id: 'merchant-1', name: 'Shop', status: 'active', createdAt: '2026-08-01T00:00:00Z', subscription: { id: 'sub-1', plan: 'monthly', status: 'trialing' } }, config)
    expect(user.id).toBe('pos:merchant-1')
    expect(user.platformAccounts[0].externalUserId).toBe('merchant-1')
    expect(user.subscriptions[0].status).toBe('trial')
  })

  it('preserves mixed currencies as separate transaction fields', () => {
    const config = getPlatformAdapter('pos').config
    const transaction = posMapper.transaction({ id: 'tx-1', amount: 20, currency: 'USD', status: 'COMPLETED', createdAt: '2026-08-01T00:00:00Z' }, config)
    expect(transaction.amount).toBe(20)
    expect(transaction.currency).toBe('USD')
    expect(transaction.status).toBe('successful')
  })
})
