import { cache } from './cache.service.js'
import { allPlatformAdapters, getPlatformAdapter } from '../platforms/platform.registry.js'
import { ApiError } from '../errors.js'

const context = (requestId) => ({ requestId })
const cacheKey = (prefix, query) => `${prefix}:${JSON.stringify(query, Object.keys(query).sort())}`
const failure = (adapter, error) => ({ status: 'failed', error: { code: error?.code || 'PLATFORM_UNAVAILABLE', message: error?.message || `${adapter.config.name} is unavailable.` } })

async function settle(method, query, requestId, adapters = allPlatformAdapters()) {
  const results = await Promise.allSettled(adapters.map((adapter) => adapter[method](query, context(requestId))))
  return Object.fromEntries(results.map((result, index) => {
    const adapter = adapters[index]
    return [adapter.config.id, result.status === 'fulfilled' ? { status: 'fulfilled', data: result.value } : failure(adapter, result.reason)]
  }))
}

const fulfilled = (results) => Object.values(results).filter((result) => result.status === 'fulfilled').map((result) => result.data)
const sum = (values) => {
  const known = values.filter((value) => Number.isFinite(value))
  return known.length ? known.reduce((total, value) => total + value, 0) : undefined
}
const percent = (current, previous) => previous === 0 ? null : ((current - previous) / previous) * 100

const moneyByCurrency = (values, selector) => values.reduce((totals, value) => {
  const amount = selector(value)
  if (amount?.currency && Number.isFinite(amount.amount)) totals[amount.currency] = (totals[amount.currency] || 0) + amount.amount
  return totals
}, {})

const singleMoney = (byCurrency) => {
  const entries = Object.entries(byCurrency)
  return entries.length === 1 ? { currency: entries[0][0], amount: entries[0][1] } : undefined
}

export async function dashboard(query, requestId) {
  return cache.getOrLoad(cacheKey('dashboard', query), 45_000, async () => {
    const platformResults = await settle('getSummary', query, requestId)
    const summaries = fulfilled(platformResults)
    const revenueByCurrency = moneyByCurrency(summaries, (item) => item.revenue)
    const totalUsers = sum(summaries.map((item) => item.users.total))
    const payingUsers = sum(summaries.map((item) => item.users.paying))
    const platformSummaries = allPlatformAdapters().map((adapter) => {
      const result = platformResults[adapter.config.id]
      return result.status === 'fulfilled' ? result.data : { platform: adapter.config.id, status: 'unavailable', lastUpdatedAt: new Date().toISOString(), error: result.error.message }
    })
    return {
      summary: {
        totalUsers,
        newUsers: sum(summaries.map((item) => item.users.new)),
        activeUsers: sum(summaries.map((item) => item.users.active)),
        payingUsers,
        payingPercentage: totalUsers && payingUsers !== undefined ? (payingUsers / totalUsers) * 100 : null,
        revenue: singleMoney(revenueByCurrency),
        revenueByCurrency,
        transactions: sum(summaries.map((item) => item.transactions)),
      },
      platforms: platformSummaries,
      platformResults,
      lastUpdatedAt: new Date().toISOString(),
    }
  })
}

export async function platforms(query, requestId) {
  const results = await settle('getSummary', query, requestId)
  const adapters = allPlatformAdapters()
  return { platforms: adapters.map((adapter) => results[adapter.config.id].status === 'fulfilled' ? results[adapter.config.id].data : { platform: adapter.config.id, status: 'unavailable', lastUpdatedAt: new Date().toISOString(), error: results[adapter.config.id].error.message }), results, configurations: adapters.map(({ config }) => ({ id: config.id, name: config.name, enabled: config.enabled, capabilities: config.capabilities })) }
}

export async function platformOverview(id, query, requestId) {
  const adapter = getPlatformAdapter(id)
  const summary = await adapter.getSummary(query, context(requestId))
  return { id, name: adapter.config.name, capabilities: adapter.config.capabilities, summary }
}

export async function platformAnalytics(id, query, requestId) {
  return cache.getOrLoad(cacheKey(`analytics:${id}`, query), 60_000, () => getPlatformAdapter(id).getAnalytics(query, context(requestId)))
}

function selectedAdapters(platform) {
  return platform ? [getPlatformAdapter(platform)] : allPlatformAdapters()
}

async function federatedPage(method, query, requestId, sortField) {
  const adapters = selectedAdapters(query.platform)
  const results = await settle(method, query, requestId, adapters)
  const successful = fulfilled(results)
  if (!successful.length) throw new ApiError('PLATFORM_UNAVAILABLE', 'None of the selected platforms could satisfy this request.', 503, results)
  const rows = successful.flatMap((result) => result.data)
  if (sortField) rows.sort((a, b) => new Date(b[sortField] || 0) - new Date(a[sortField] || 0))
  const data = rows.slice(0, query.limit)
  const total = successful.reduce((count, result) => count + Number(result.pagination?.total || 0), 0)
  return { data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), mode: query.platform ? 'platform' : 'federated' }, sources: results, lastUpdatedAt: new Date().toISOString() }
}

export const users = (query, requestId) => federatedPage('getUsers', query, requestId, 'joinedAt')
export const subscriptions = (query, requestId) => federatedPage('getSubscriptions', query, requestId, 'startedAt')
export const transactions = (query, requestId) => federatedPage('getTransactions', query, requestId, 'createdAt')
export const activity = (query, requestId) => federatedPage('getActivity', query, requestId, 'createdAt')

export async function user(id, requestId) {
  const separator = id.indexOf(':')
  if (separator < 1) throw new ApiError('INVALID_USER_ID', 'Use a platform-qualified user ID such as gradepoa:123.', 400)
  const platform = id.slice(0, separator)
  const externalUserId = id.slice(separator + 1)
  if (!externalUserId) throw new ApiError('INVALID_USER_ID', 'The external user ID is required.', 400)
  return getPlatformAdapter(platform).getUser(externalUserId, context(requestId))
}

export async function revenue(query, requestId) {
  return cache.getOrLoad(cacheKey('revenue', query), 60_000, async () => {
    const adapters = selectedAdapters(query.platform)
    const results = await settle('getRevenue', query, requestId, adapters)
    const values = fulfilled(results)
    const revenueByCurrency = moneyByCurrency(values, (item) => item.total)
    const previousByCurrency = moneyByCurrency(values, (item) => item.previousTotal)
    const breakdown = values.map((item) => ({ platform: item.platform, revenue: item.total, previousRevenue: item.previousTotal, growthPercentage: item.previousTotal?.amount === 0 ? null : item.growthPercentage ?? percent(item.total?.amount || 0, item.previousTotal?.amount || 0) }))
    const total = singleMoney(revenueByCurrency)
    const previousTotal = singleMoney(previousByCurrency)
    return { total, previousTotal, growthPercentage: total && previousTotal ? percent(total.amount, previousTotal.amount) : null, revenueByCurrency, previousRevenueByCurrency: previousByCurrency, byPlatform: breakdown, series: [], successfulTransactions: sum(values.map((item) => item.successfulTransactions)), failedTransactions: sum(values.map((item) => item.failedTransactions)), sources: results, lastUpdatedAt: new Date().toISOString() }
  })
}

export async function revenueTimeseries(query, requestId) {
  const results = await settle('getRevenueTimeseries', query, requestId, selectedAdapters(query.platform))
  return { data: fulfilled(results).flat(), sources: results, lastUpdatedAt: new Date().toISOString() }
}

export async function growth(query, requestId) {
  const results = await settle('getAnalytics', query, requestId, selectedAdapters(query.platform))
  return { data: fulfilled(results).flatMap((item) => item.series || []), sources: results, lastUpdatedAt: new Date().toISOString() }
}

export async function systemStatus(requestId) {
  return cache.getOrLoad('system-status', 20_000, async () => {
    const results = await settle('getHealth', undefined, requestId)
    return { data: allPlatformAdapters().map((adapter) => results[adapter.config.id].status === 'fulfilled' ? results[adapter.config.id].data : { platform: adapter.config.id, status: 'unavailable', lastError: results[adapter.config.id].error.message }), sources: results, lastUpdatedAt: new Date().toISOString() }
  })
}
