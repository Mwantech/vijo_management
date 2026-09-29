import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen, ChevronDown, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { membershipsApi, type Membership } from '../api/memberships.api'
import { formatMinor } from '../api/payments.api'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/common/PageHeader'
import { DataTable, type Column } from '../components/common/DataTable'
import { StatusBadge } from '../components/common/StatusBadge'
import { SectionError } from '../components/common/SectionState'
import './memberships.css'

const date = (value?: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—'
const paymentLabel = (status: string) => ({ owner_verified: 'Owner verified', verified: 'Payment verified', manual: 'Manual grant' })[status] || status.replaceAll('_', ' ')

export function MembershipsPage() {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [draft, setDraft] = useState('')
  const [email, setEmail] = useState(''), [reason, setReason] = useState('')
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false)
  const { user } = useAuth(), client = useQueryClient()
  const editable = ['admin', 'super_admin'].includes(user.role)
  const q = useQuery({ queryKey: ['memberships', page, search], queryFn: ({ signal }) => membershipsApi.list(page, search, signal), staleTime: 30000, retry: false })
  const columns: Column<Membership>[] = [
    { key: 'customer', label: 'Member', render: m => <div className="member-identity"><span className="member-avatar" aria-hidden="true">{m.email.slice(0, 2).toUpperCase()}</span><div><Link to={`/memberships/${m.membershipId}`}>{m.email}</Link><small>{m.claimed ? 'Email verified' : 'Email verification pending'}</small></div></div> },
    { key: 'plan', label: 'Membership', render: m => <div className="member-cell"><strong>{m.plan === 'premium_blog' ? 'Premium Blog' : m.plan}</strong><small>{m.expiresAt ? `Until ${date(m.expiresAt)}` : 'Permanent access'}</small></div> },
    { key: 'status', label: 'Status', render: m => <StatusBadge status={m.status}/> },
    { key: 'purchase', label: 'Purchase', render: m => <div className="member-cell"><strong>{m.amount && m.currency ? formatMinor(m.amount, m.currency) : '—'}</strong><small>{m.provider === 'whop' ? 'Whop' : m.provider} · {paymentLabel(m.paymentStatus)}</small></div> },
    { key: 'started', label: 'Started (EAT)', render: m => <div className="member-cell"><span>{date(m.startedAt)}</span><small>Last payment: {date(m.lastPaymentAt)}</small></div> },
    { key: 'access', label: 'Access', render: m => <span className={`member-access ${m.accessGranted ? 'member-access--granted' : ''}`}><ShieldCheck size={14} aria-hidden="true"/>{m.accessGranted ? 'Granted' : 'Not granted'}</span> },
    { key: 'actions', label: 'Details', render: m => <Link className="member-view" to={`/memberships/${m.membershipId}`} aria-label={`View membership for ${m.email}`}>View <ArrowUpRight size={14} aria-hidden="true"/></Link> },
  ]
  async function grant(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      await membershipsApi.grant(email, reason)
      setSuccess('Permanent access granted. The action has been recorded in the membership history.')
      setEmail(''); setReason(''); await client.invalidateQueries({ queryKey: ['memberships'] })
    } catch (e) { setError(e instanceof Error ? e.message : 'Grant failed') }
    finally { setBusy(false) }
  }
  return <div className="membership-directory">
    <PageHeader eyebrow="Nexvijo · Member access" title="Memberships" description="Your members, their purchases, and the content they can access." actions={editable && <Link className="button button--secondary" to="/membership-content"><BookOpen size={15} aria-hidden="true"/> Manage content</Link>}/>
    <section className="member-directory-panel" aria-label="Member directory">
      <div className="member-directory-heading"><div><h2>Member directory {q.data && <span className="member-count">{q.data.total.toLocaleString()}</span>}</h2><p>{search ? 'Matching memberships' : 'All memberships'} · Premium content access</p></div><span className="member-product"><BookOpen size={14} aria-hidden="true"/> Nexvijo Blog</span></div>
      <form className="member-toolbar" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(draft.trim()) }}>
        <label className="member-search"><Search size={17} aria-hidden="true"/><span className="member-sr-only">Search members by email</span><input type="search" placeholder="Search members by email…" value={draft} onChange={e => setDraft(e.target.value)}/></label>
        <button className="button button--secondary" type="submit">Search</button>
        {search && <button className="button button--secondary" type="button" onClick={() => { setSearch(''); setDraft(''); setPage(1) }}>Clear</button>}
        <button className="button button--secondary member-refresh" type="button" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw size={14} aria-hidden="true"/>{q.isFetching ? 'Refreshing…' : 'Refresh'}</button>
      </form>
      {q.isError && <SectionError message={q.error.message} onRetry={() => void q.refetch()}/>}
      {(!q.isError || q.data) && <DataTable columns={columns} data={q.data?.items} loading={q.isLoading} page={page} totalPages={q.data?.totalPages} onPageChange={setPage} emptyTitle={search ? 'No members match this email' : 'No memberships yet'}/>}
      {q.data && <div className="member-directory-footer"><span>{q.data.total === 0 ? 'No results' : `Showing ${(page - 1) * 20 + 1}–${(page - 1) * 20 + q.data.items.length} of ${q.data.total} memberships`}</span><span>Page {page} of {Math.max(1, q.data.totalPages)}</span></div>}
    </section>
    {editable && <details className="member-grant">
      <summary><span className="member-grant-icon"><UserPlus size={19} aria-hidden="true"/></span><span><strong>Grant membership access</strong><small>Manually provide permanent access with an audit record.</small></span><ChevronDown className="member-chevron" size={18} aria-hidden="true"/></summary>
      <form onSubmit={grant} className="member-grant-form">
        <p>This grants an entitlement only; it does not charge the customer or mark a payment as verified.</p>
        <div className="member-grant-fields"><label>Customer email<input required type="email" autoComplete="off" placeholder="member@example.com" value={email} onChange={e => setEmail(e.target.value)}/></label><label>Reason for granting access<textarea required minLength={10} maxLength={500} rows={2} placeholder="Explain why this access is being granted…" value={reason} onChange={e => setReason(e.target.value)}/></label></div>
        <div className="member-grant-actions"><span>All access changes are recorded.</span><button className="button button--primary" disabled={busy}><UserPlus size={15} aria-hidden="true"/>{busy ? 'Granting access…' : 'Grant permanent access'}</button></div>
        {error && <p role="alert" className="member-form-error">{error}</p>}{success && <p role="status" className="member-form-success">{success}</p>}
      </form>
    </details>}
  </div>
}
