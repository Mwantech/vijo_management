export type PlatformId = 'gradepoa' | 'goodscenes' | 'hms' | 'pos'
export type PlatformStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown'
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'unknown'
export type PaymentStatus = 'successful' | 'pending' | 'failed' | 'reversed' | 'cancelled' | 'unknown'
export type AdminRole = 'super_admin' | 'admin' | 'finance' | 'support' | 'viewer'
export type PeriodGranularity = 'daily' | 'weekly' | 'monthly'

export interface Money { amount: number; currency: string }
export interface DateRange { from: string; to: string; label: string; comparisonLabel: string }
export interface GrowthValue { percentage?: number; absolute?: number; comparisonLabel: string }
export interface PlatformSummary {
  platform: PlatformId; users?: number; activeUsers?: number; newUsers?: number
  payingUsers?: number; revenue?: Money; mrr?: Money; transactions?: number
  userGrowthPercentage?: number; revenueGrowthPercentage?: number
  status: PlatformStatus; lastUpdatedAt: string; error?: string
}
export interface DashboardMetrics {
  totalUsers?: number; activeUsers?: { dau?: number; wau?: number; mau?: number }
  payingUsers?: number; payingPercentage?: number; revenue?: Money; previousRevenue?: Money
  mrr?: Money; newUsers?: number; transactions?: number
  growth: { users?: GrowthValue; paying?: GrowthValue; revenue?: GrowthValue }
  platforms: PlatformSummary[]; lastUpdatedAt: string
}
export interface PlatformIdentity {
  platform: PlatformId; externalUserId: string; joinedAt: string; lastActiveAt?: string; status: UserStatus
}
export interface Subscription {
  id: string; platform: PlatformId; plan: string; status: 'active' | 'trial' | 'expired' | 'cancelled' | 'past_due' | string
  startedAt?: string; expiresAt?: string; amount?: Money; recurring?: boolean
}
export interface UnifiedUser {
  id: string; name?: string; email?: string; phone?: string; status: UserStatus; accountType?: string
  joinedAt: string; lastActiveAt?: string; platformAccounts: PlatformIdentity[]
  subscriptions: Subscription[]; totalSpend?: Money
}
export interface Transaction {
  id: string; entityId?: string; entityName?: string; platform: PlatformId; amount: Money
  paymentMethod?: string; status: PaymentStatus; createdAt: string
}
export interface SeriesPoint { date: string; value: number; platform?: PlatformId | 'all'; currency?: string }
export interface RevenueSeries { currency: string; granularity: PeriodGranularity; points: SeriesPoint[] }
export interface GrowthSeries { metric: 'users' | 'new_users' | 'active_users' | 'revenue' | 'paying_users'; granularity: PeriodGranularity; points: SeriesPoint[] }
export interface CustomMetric { key: string; label: string; value?: number | string | Money; description?: string }
export interface PlatformAnalytics { summary: PlatformSummary; metrics: CustomMetric[]; growth: GrowthSeries[]; recentUsers: UnifiedUser[]; recentPayments: Transaction[] }
export interface ActivityEvent { id: string; platform: PlatformId; event: string; entity?: string; timestamp: string; metadata?: Record<string, string | number | boolean> }
export interface PlatformHealth {
  platform: PlatformId; status: PlatformStatus; lastSuccessfulSyncAt?: string; latencyMs?: number
  errorRate?: number; lastError?: string; dataFreshnessSeconds?: number
}
export interface PageMeta { page: number; limit: number; total: number; totalPages: number }
export interface Paginated<T> { data: T[]; meta: PageMeta; lastUpdatedAt?: string }
export interface UserQuery { page?: number; limit?: number; search?: string; platform?: PlatformId; status?: string; subscription?: string; paying?: boolean; activity?: 'active' | 'inactive'; from?: string; to?: string }
export interface PaymentQuery { page?: number; limit?: number; platform?: PlatformId; status?: PaymentStatus; method?: string; currency?: string; from?: string; to?: string }
export interface RevenueAnalytics {
  total?: Money; previousTotal?: Money; growthPercentage?: number; mrr?: Money
  subscriptionRevenue?: Money; nonRecurringRevenue?: Money; successfulTransactions?: number
  failedTransactions?: number; byPlatform: Array<{ platform: PlatformId; revenue?: Money; previousRevenue?: Money }>
  series: RevenueSeries[]; lastUpdatedAt: string
}
export interface ApiErrorPayload { message?: string; code?: string; details?: Record<string, string> }
