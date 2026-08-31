import { keepPreviousData,useQuery } from '@tanstack/react-query'
import { managementApi } from '../api/management.api'
import { queryKeys } from '../api/queryKeys'
import type { DateRange,PaymentQuery,PlatformId,UserQuery } from '../types/models'
const standard={staleTime:60_000,refetchOnWindowFocus:false as const,retry:1}
export const useDashboard=(range:DateRange)=>useQuery({queryKey:queryKeys.dashboard(range),queryFn:()=>managementApi.dashboard(range),...standard})
export const usePlatform=(id:PlatformId,range:DateRange)=>useQuery({queryKey:queryKeys.platform(id,range),queryFn:()=>managementApi.platform(id,range),...standard})
export const useUsers=(query:UserQuery)=>useQuery({queryKey:queryKeys.users(query),queryFn:()=>managementApi.users(query),placeholderData:keepPreviousData,...standard})
export const useUser=(id:string)=>useQuery({queryKey:queryKeys.user(id),queryFn:()=>managementApi.user(id),...standard})
export const useRevenue=(range:DateRange)=>useQuery({queryKey:queryKeys.revenue(range),queryFn:()=>managementApi.revenue(range),...standard})
export const useGrowth=(range:DateRange,granularity:string)=>useQuery({queryKey:queryKeys.growth(range,granularity),queryFn:()=>managementApi.growth(range,granularity),...standard})
export const usePayments=(query:PaymentQuery)=>useQuery({queryKey:queryKeys.payments(query),queryFn:()=>managementApi.payments(query),placeholderData:keepPreviousData,...standard})
export const useActivity=(page:number)=>useQuery({queryKey:queryKeys.activity(page),queryFn:()=>managementApi.activity(page,15),placeholderData:keepPreviousData,...standard})
export const useHealth=()=>useQuery({queryKey:queryKeys.health,queryFn:managementApi.health,staleTime:30_000,refetchOnWindowFocus:false,retry:1})
export const useSubscriptions=(page:number)=>useQuery({queryKey:queryKeys.subscriptions(page),queryFn:()=>managementApi.subscriptions(page,10),placeholderData:keepPreviousData,...standard})
