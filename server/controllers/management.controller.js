import * as service from '../services/aggregation.service.js'
import { audit } from '../services/audit.service.js'

const send = (res, req, data, pagination) => res.json({ success: true, data, ...(pagination ? { pagination } : {}), requestId: req.id })
const query = (req) => req.validatedQuery || req.query
const run = (handler, action) => async (req, res, next) => {
  try {
    const result = await handler(req)
    if (action) audit(req, action, { platform: req.params.platform, targetId: req.params.id })
    if (result && 'pagination' in result && Array.isArray(result.data)) {
      const { data, pagination, ...metadata } = result
      return send(res, req, data, pagination ? { ...pagination, ...metadata } : undefined)
    }
    return send(res, req, result)
  } catch (error) { next(error) }
}

export const dashboard = run((req) => service.dashboard(query(req), req.id), 'DASHBOARD_VIEWED')
export const platforms = run((req) => service.platforms(query(req), req.id), 'PLATFORMS_VIEWED')
export const platform = run((req) => service.platformOverview(req.params.platform, query(req), req.id), 'PLATFORM_ANALYTICS_VIEWED')
export const platformAnalytics = run((req) => service.platformAnalytics(req.params.platform, query(req), req.id), 'PLATFORM_ANALYTICS_VIEWED')
export const platformUsers = run((req) => service.users({ ...query(req), platform: req.params.platform }, req.id), 'USER_LIST_VIEWED')
export const platformRevenue = run((req) => service.revenue({ ...query(req), platform: req.params.platform }, req.id), 'REVENUE_VIEWED')
export const platformSubscriptions = run((req) => service.subscriptions({ ...query(req), platform: req.params.platform }, req.id), 'SUBSCRIPTIONS_VIEWED')
export const platformTransactions = run((req) => service.transactions({ ...query(req), platform: req.params.platform }, req.id), 'TRANSACTIONS_VIEWED')
export const platformActivity = run((req) => service.activity({ ...query(req), platform: req.params.platform }, req.id), 'ACTIVITY_VIEWED')
export const users = run((req) => service.users(query(req), req.id), 'USER_LIST_VIEWED')
export const user = run((req) => service.user(req.params.id, req.id), 'USER_VIEWED')
export const revenue = run((req) => service.revenue(query(req), req.id), 'REVENUE_VIEWED')
export const revenueTimeseries = run((req) => service.revenueTimeseries(query(req), req.id), 'REVENUE_VIEWED')
export const subscriptions = run((req) => service.subscriptions(query(req), req.id), 'SUBSCRIPTIONS_VIEWED')
export const transactions = run((req) => service.transactions(query(req), req.id), 'TRANSACTIONS_VIEWED')
export const activity = run((req) => service.activity(query(req), req.id), 'ACTIVITY_VIEWED')
export const growth = run((req) => service.growth(query(req), req.id), 'GROWTH_VIEWED')
export const systemStatus = run((req) => service.systemStatus(req.id), 'SYSTEM_STATUS_VIEWED')
