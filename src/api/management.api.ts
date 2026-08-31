import { apiRequest } from './client'
import type { ActivityEvent, DashboardMetrics, DateRange, GrowthSeries, Paginated, PaymentQuery, PlatformAnalytics, PlatformHealth, PlatformId, RevenueAnalytics, Subscription, Transaction, UnifiedUser, UserQuery } from '../types/models'
import { parseMoney,parseOptionalNumber,parsePlatformSummary } from './parsers'
type SubscriptionRow = Subscription & { userId: string; userName?: string }
type ApiDashboard={summary:{totalUsers?:unknown;newUsers?:unknown;activeUsers?:unknown;payingUsers?:unknown;payingPercentage?:unknown;revenue?:unknown;transactions?:unknown};platforms:unknown[];lastUpdatedAt:string}
type ApiPlatforms={platforms:unknown[]}
type ApiTransaction={id:string;externalUserId?:string;entityName?:string;platform:PlatformId;amount:number;currency:string;paymentMethod?:string;status:Transaction['status'];createdAt:string}
type ApiActivity={id:string;platform:PlatformId;type:string;actor?:{name?:string;email?:string};createdAt:string;metadata?:Record<string,string|number|boolean>}
const transaction=(value:ApiTransaction):Transaction=>({id:value.id,entityId:value.externalUserId,entityName:value.entityName,platform:value.platform,amount:{amount:value.amount,currency:value.currency},paymentMethod:value.paymentMethod,status:value.status,createdAt:value.createdAt})
const rangeQuery = (range: DateRange) => ({ from: range.from, to: range.to })
export const managementApi = {
  dashboard: (range: DateRange) => apiRequest<ApiDashboard>('/api/management/dashboard', {}, rangeQuery(range)).then((value):DashboardMetrics=>({totalUsers:parseOptionalNumber(value.summary.totalUsers),newUsers:parseOptionalNumber(value.summary.newUsers),activeUsers:{mau:parseOptionalNumber(value.summary.activeUsers)},payingUsers:parseOptionalNumber(value.summary.payingUsers),payingPercentage:parseOptionalNumber(value.summary.payingPercentage),revenue:parseMoney(value.summary.revenue),transactions:parseOptionalNumber(value.summary.transactions),growth:{users:{comparisonLabel:range.comparisonLabel},paying:{comparisonLabel:range.comparisonLabel},revenue:{comparisonLabel:range.comparisonLabel}},platforms:value.platforms.map(parsePlatformSummary),lastUpdatedAt:value.lastUpdatedAt})),
  platforms: (range: DateRange) => apiRequest<ApiPlatforms>('/api/management/platforms', {}, rangeQuery(range)).then((value) => value.platforms.map(parsePlatformSummary)),
  platform: (platform: PlatformId, range: DateRange) => apiRequest<PlatformAnalytics&{series?:PlatformAnalytics['growth']}>(`/api/management/platforms/${platform}/analytics`, {}, rangeQuery(range)).then((value) => ({ ...value, summary: parsePlatformSummary(value.summary),growth:value.growth??value.series??[],recentPayments:(value.recentPayments as unknown as ApiTransaction[]).map(transaction) })),
  users: (query: UserQuery) => apiRequest<Paginated<UnifiedUser>>('/api/management/users', {}, query),
  user: (id: string) => apiRequest<UnifiedUser>(`/api/management/users/${encodeURIComponent(id)}`),
  revenue: (range: DateRange) => apiRequest<RevenueAnalytics>('/api/management/revenue', {}, rangeQuery(range)),
  growth: (range: DateRange, granularity: string) => apiRequest<{data:GrowthSeries[]}>('/api/management/growth', {}, { ...rangeQuery(range), granularity }).then((value)=>value.data),
  payments: (query: PaymentQuery) => apiRequest<Paginated<ApiTransaction>>('/api/management/transactions', {}, query).then((value)=>({...value,data:value.data.map(transaction)})),
  activity: (page: number, limit: number) => apiRequest<Paginated<ApiActivity>>('/api/management/activity', {}, { page, limit }).then((value)=>({...value,data:value.data.map((item):ActivityEvent=>({id:item.id,platform:item.platform,event:item.type,entity:item.actor?.name??item.actor?.email,timestamp:item.createdAt,metadata:item.metadata}))})),
  health: () => apiRequest<{data:Array<PlatformHealth&{lastSuccessfulRequest?:string}>}>('/api/management/system/status').then((value)=>value.data.map((item)=>({...item,latencyMs:parseOptionalNumber(item.latencyMs),errorRate:parseOptionalNumber(item.errorRate),dataFreshnessSeconds:parseOptionalNumber(item.dataFreshnessSeconds),lastSuccessfulSyncAt:item.lastSuccessfulSyncAt??item.lastSuccessfulRequest}))),
  subscriptions: (page: number, limit: number) => apiRequest<Paginated<SubscriptionRow>>('/api/management/subscriptions', {}, { page, limit }),
}
