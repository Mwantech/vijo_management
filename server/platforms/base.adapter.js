import { ApiError } from '../errors.js'
import { createPlatformClient } from '../services/http/platformClient.js'

export class BasePlatformAdapter {
  constructor(config, mapper) {
    this.config = config
    this.mapper = mapper
    this.client = createPlatformClient(config)
  }

  ensureCapability(capability) {
    if (!this.config.capabilities[capability]) throw new ApiError('CAPABILITY_NOT_SUPPORTED', `${this.config.name} does not expose ${capability} analytics.`, 422)
  }

  async getSummary(query, context) {
    const response = await this.client.get('/internal/management/summary', { query, requestId: context?.requestId })
    return this.mapper.summary(response.data, this.config)
  }

  async getAnalytics(query, context) {
    const response = await this.client.get('/internal/management/analytics', { query, requestId: context?.requestId })
    return this.mapper.analytics(response.data, this.config)
  }

  async getUsers(query, context) {
    this.ensureCapability('users')
    const response = await this.client.get('/internal/management/users', { query, requestId: context?.requestId })
    return { data: (response.data || []).map((row) => this.mapper.user(row, this.config)), pagination: response.pagination }
  }

  async getUser(externalUserId, context) {
    this.ensureCapability('users')
    const response = await this.client.get(`/internal/management/users/${encodeURIComponent(externalUserId)}`, { requestId: context?.requestId })
    return this.mapper.user(response.data, this.config)
  }

  async getRevenue(query, context) {
    this.ensureCapability('revenue')
    const response = await this.client.get('/internal/management/revenue', { query, requestId: context?.requestId })
    return this.mapper.revenue(response.data, this.config)
  }

  async getRevenueTimeseries(query, context) {
    this.ensureCapability('revenue')
    const response = await this.client.get('/internal/management/revenue/timeseries', { query, requestId: context?.requestId })
    return (response.data || []).map((row) => this.mapper.revenuePoint(row, this.config))
  }

  async getSubscriptions(query, context) {
    this.ensureCapability('subscriptions')
    const response = await this.client.get('/internal/management/subscriptions', { query, requestId: context?.requestId })
    return { data: (response.data || []).map((row) => this.mapper.subscription(row, this.config)), pagination: response.pagination }
  }

  async getTransactions(query, context) {
    this.ensureCapability('transactions')
    const response = await this.client.get('/internal/management/transactions', { query, requestId: context?.requestId })
    return { data: (response.data || []).map((row) => this.mapper.transaction(row, this.config)), pagination: response.pagination }
  }

  async getActivity(query, context) {
    this.ensureCapability('activity')
    const response = await this.client.get('/internal/management/activity', { query, requestId: context?.requestId })
    return { data: (response.data || []).map((row) => this.mapper.activity(row, this.config)), pagination: response.pagination }
  }

  async getHealth(context) {
    const response = await this.client.get('/internal/management/health', { requestId: context?.requestId, retries: 0 })
    return this.mapper.health(response.data, this.config, response.latencyMs)
  }
}
