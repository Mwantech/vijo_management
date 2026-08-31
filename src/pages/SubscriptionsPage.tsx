import { useState } from 'react'
import { PageHeader } from '../components/common/PageHeader'
import { DataTable,type Column } from '../components/common/DataTable'
import { StatusBadge } from '../components/common/StatusBadge'
import { platformRegistry } from '../config/platforms'
import { useSubscriptions } from '../hooks/useManagementQueries'
import type { Subscription } from '../types/models'
import { formatDate,formatMoney } from '../utils/format'
import { SectionError } from '../components/common/SectionState'
type Row=Subscription&{userId:string;userName?:string}
const columns:Column<Row>[]=[{key:'user',label:'User / merchant',render:s=>s.userName??s.userId},{key:'platform',label:'Platform',render:s=>platformRegistry[s.platform].name},{key:'plan',label:'Plan',render:s=>s.plan},{key:'status',label:'Status',render:s=><StatusBadge status={s.status}/>},{key:'amount',label:'Amount',render:s=>formatMoney(s.amount)},{key:'started',label:'Started',render:s=>formatDate(s.startedAt)},{key:'expires',label:'Expires',render:s=>formatDate(s.expiresAt)}]
export function SubscriptionsPage(){const[page,setPage]=useState(1);const q=useSubscriptions(page);return <><PageHeader eyebrow="Operations" title="Subscriptions" description="Plans and renewal status use the actual normalized backend values."/>{q.isError?<SectionError message={q.error.message} onRetry={()=>void q.refetch()}/>:<DataTable columns={columns} data={q.data?.data} loading={q.isLoading} page={q.data?.meta.page} totalPages={q.data?.meta.totalPages} onPageChange={setPage} emptyTitle="No subscriptions available"/>}</>}
