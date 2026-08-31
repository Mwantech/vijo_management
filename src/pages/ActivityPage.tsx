import { useState } from 'react'
import { PageHeader } from '../components/common/PageHeader'
import { DataTable,type Column } from '../components/common/DataTable'
import { platformRegistry } from '../config/platforms'
import { useActivity } from '../hooks/useManagementQueries'
import type { ActivityEvent } from '../types/models'
import { formatDate } from '../utils/format'
import { SectionError } from '../components/common/SectionState'
const columns:Column<ActivityEvent>[]=[{key:'event',label:'Event',render:e=><div><strong>{e.event}</strong><small className="block">{e.entity??'System event'}</small></div>},{key:'platform',label:'Platform',render:e=><span className="with-status"><i style={{background:platformRegistry[e.platform].color}}/>{platformRegistry[e.platform].name}</span>},{key:'metadata',label:'Metadata',render:e=>e.metadata?Object.entries(e.metadata).map(([k,v])=>`${k}: ${String(v)}`).join(' · '):'—'},{key:'time',label:'Timestamp',render:e=>formatDate(e.timestamp,true)}]
export function ActivityPage(){const[page,setPage]=useState(1);const q=useActivity(page);return <><PageHeader eyebrow="Operations" title="Activity" description="A normalized event stream from connected Vijo products."/>{q.isError?<SectionError message={q.error.message} onRetry={()=>void q.refetch()}/>:<DataTable columns={columns} data={q.data?.data} loading={q.isLoading} page={q.data?.meta.page} totalPages={q.data?.meta.totalPages} onPageChange={setPage} emptyTitle="No activity in this period"/>}</>}
