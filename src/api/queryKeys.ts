import type { DateRange, PaymentQuery, PlatformId, UserQuery } from '../types/models'
export const queryKeys = {
  dashboard: (range: DateRange) => ['dashboard',range.from,range.to] as const,
  platform: (id: PlatformId, range: DateRange) => ['platform',id,range.from,range.to] as const,
  users: (query: UserQuery) => ['users',query] as const, user: (id: string) => ['user',id] as const,
  revenue: (range: DateRange) => ['revenue',range.from,range.to] as const,
  growth: (range: DateRange, granularity: string) => ['growth',range.from,range.to,granularity] as const,
  payments: (query: PaymentQuery) => ['payments',query] as const,
  activity: (page: number) => ['activity',page] as const, health: ['health'] as const,
  subscriptions: (page: number) => ['subscriptions',page] as const,
}
