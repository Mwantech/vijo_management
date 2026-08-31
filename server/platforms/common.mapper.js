import { money, normalizeStatus, normalizeSubscriptionStatus, normalizeTransactionStatus } from './platform.types.js'

export function createMapper(platformSpecificMetrics = (value) => value?.metrics || {}) {
  return {
    summary(value = {}, config) {
      const users = value.users || {}
      return {
        platform: config.id,
        users: {
          total: Number(users.total ?? value.totalUsers ?? 0),
          new: Number(users.new ?? value.newUsers ?? 0),
          ...(users.active !== undefined || value.activeUsers !== undefined ? { active: Number(users.active ?? value.activeUsers) } : {}),
          ...(users.paying !== undefined || value.payingUsers !== undefined ? { paying: Number(users.paying ?? value.payingUsers) } : {}),
        },
        revenue: money(value.revenue, config.currency),
        mrr: money(value.mrr, config.currency),
        transactions: value.transactions === undefined ? undefined : Number(value.transactions),
        subscriptions: value.subscriptions,
        growth: value.growth,
        status: normalizeStatus(value.status || 'healthy'),
        lastUpdatedAt: value.lastUpdatedAt || new Date().toISOString(),
      }
    },
    analytics(value = {}, config) {
      return { summary: this.summary(value.summary || value, config), metrics: platformSpecificMetrics(value), series: value.series || [], recentUsers: (value.recentUsers || []).map((row) => this.user(row, config)), recentPayments: (value.recentPayments || []).map((row) => this.transaction(row, config)) }
    },
    user(value = {}, config) {
      const externalUserId = String(value.externalUserId ?? value.id ?? value._id ?? '')
      const joinedAt = value.joinedAt || value.createdAt || value.created_at
      return {
        id: `${config.id}:${externalUserId}`,
        externalUserId,
        platform: config.id,
        name: value.name || value.fullName || value.full_name || value.username,
        email: value.email,
        phone: value.phone,
        accountType: value.accountType || value.role,
        status: value.status || 'unknown',
        joinedAt,
        lastActiveAt: value.lastActiveAt,
        subscription: value.subscription ? this.subscription(value.subscription, config) : undefined,
        subscriptions: value.subscription ? [this.subscription(value.subscription, config)] : [],
        totalSpend: money(value.totalSpend, config.currency),
        platformAccounts: [{ platform: config.id, externalUserId, joinedAt, lastActiveAt: value.lastActiveAt, status: value.status || 'unknown' }],
      }
    },
    revenue(value = {}, config) {
      return { ...value, platform: config.id, total: money(value.total, config.currency), previousTotal: money(value.previousTotal, config.currency), mrr: money(value.mrr, config.currency), subscriptionRevenue: money(value.subscriptionRevenue, config.currency), nonRecurringRevenue: money(value.nonRecurringRevenue, config.currency), currency: value.currency || config.currency }
    },
    revenuePoint(value = {}, config) { return { date: value.date, platform: config.id, amount: Number(value.amount || 0), currency: value.currency || config.currency } },
    subscription(value = {}, config) { return { ...value, id: String(value.id), externalUserId: String(value.externalUserId || ''), userId: String(value.externalUserId || ''), platform: config.id, plan: String(value.plan || 'unknown'), rawStatus: value.rawStatus || value.status, status: normalizeSubscriptionStatus(value.status), amount: money(value.amount, config.currency) } },
    transaction(value = {}, config) { return { ...value, id: `${config.id}:${value.id}`, externalTransactionId: String(value.externalTransactionId || value.id), externalUserId: value.externalUserId === undefined ? undefined : String(value.externalUserId), platform: config.id, amount: Number(typeof value.amount === 'object' ? value.amount.amount : value.amount || 0), currency: value.currency || value.amount?.currency || config.currency, status: normalizeTransactionStatus(value.status) } },
    activity(value = {}, config) { return { ...value, id: `${config.id}:${value.id}`, platform: config.id, type: value.type || value.event || value.action || 'platform_activity', createdAt: value.createdAt || value.timestamp } },
    health(value = {}, config, latencyMs) { return { platform: config.id, status: normalizeStatus(value.status), latencyMs: value.latencyMs ?? latencyMs, lastSuccessfulRequest: value.lastSuccessfulRequest || new Date().toISOString(), dataFreshnessSeconds: value.dataFreshnessSeconds, lastError: value.lastError } },
  }
}
