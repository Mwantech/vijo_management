import { AlertCircle, Inbox } from 'lucide-react'
export const Skeleton = ({className=''}:{className?:string}) => <div className={`skeleton ${className}`} aria-hidden="true" />
export function SectionLoading({rows=3}:{rows?:number}) { return <div className="loading-stack" aria-label="Loading">{Array.from({length:rows},(_,i)=><Skeleton key={i} className="skeleton-row" />)}</div> }
export function SectionError({message='Unable to load this section.',onRetry}:{message?:string;onRetry?:()=>void}) { return <div className="state"><AlertCircle size={22}/><div><strong>Data unavailable</strong><p>{message}</p></div>{onRetry&&<button className="button button--secondary" onClick={onRetry}>Retry</button>}</div> }
export function EmptyState({title='No data available',message='There is no confirmed data for this selection.'}:{title?:string;message?:string}) { return <div className="empty"><Inbox size={24}/><strong>{title}</strong><p>{message}</p></div> }
