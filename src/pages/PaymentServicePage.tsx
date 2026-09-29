import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { paymentApi, formatMinor, type PaymentFilters, type PaymentRecord } from '../api/payments.api'
import { useDateRange } from '../context/DateRangeContext'
import { DateRangeFilter } from '../components/dashboard/DateRangeFilter'
import { MetricCard } from '../components/dashboard/MetricCard'
import { PageHeader } from '../components/common/PageHeader'
import { DataTable, type Column } from '../components/common/DataTable'
import { EmptyState, SectionError, SectionLoading } from '../components/common/SectionState'

const statuses = ['CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED']
export function PaymentServicePage({ ledger = false }: { ledger?: boolean }) {
  const { range } = useDateRange()
  const [application, setApplication] = useState(''), [currency, setCurrency] = useState('')
  const filters: PaymentFilters = { from: range.from, to: range.to, application: application || undefined, currency: currency || undefined }
  const apps = useQuery({ queryKey: ['payment-service-applications'], queryFn: ({ signal }) => paymentApi.applications(signal), staleTime: 60000, retry: false })
  return <>
    <PageHeader eyebrow="Centralized payment service" title={ledger ? 'Payment transactions' : 'Payment analytics'} description="Records from the isolated payments database—not product revenue estimates." actions={<DateRangeFilter/>}/>
    <div className="page-actions"><Link className="button button--secondary" to="/payments">Analytics & payments</Link><Link className="button button--secondary" to="/payments/transactions">Transaction ledger</Link></div>
    <div className="filter-bar">
      <label>Application <select value={application} onChange={e => setApplication(e.target.value)}><option value="">All applications</option>{apps.data?.map(a => <option key={a.applicationId} value={a.applicationId}>{a.name}</option>)}</select></label>
      <label>Currency <select value={currency} onChange={e => setCurrency(e.target.value)}><option value="">All currencies (separate totals)</option>{['KES', 'USD', 'EUR', 'GBP', 'JPY', 'KWD'].map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    {apps.isError && <SectionError message={apps.error.message} onRetry={() => void apps.refetch()}/>}
    {!ledger && <Analytics filters={filters}/>}
    <Records key={JSON.stringify([filters, ledger])} filters={filters} ledger={ledger}/>
  </>
}
function Analytics({ filters }: { filters: PaymentFilters }) {
  const q = useQuery({ queryKey: ['payment-service-analytics', filters], queryFn: ({ signal }) => paymentApi.analytics(filters, signal), staleTime: 30000, retry: false })
  if (q.isLoading) return <SectionLoading rows={4}/>
  if (q.isError) return <SectionError message={q.error.message} onRetry={() => void q.refetch()}/>
  if (!q.data) return null
  const d = q.data, s = d.statuses
  return <section className="section">
    <div className="section-heading"><p>Environment: {d.environment} · New checkout: {d.newPaymentsEnabled ? 'enabled' : 'paused'} · Updated {new Date(d.lastUpdatedAt).toLocaleString()}</p><button className="button button--secondary" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh analytics</button></div>
    <section className="metric-grid">
      <MetricCard label="Payments created" value={String(d.totalPayments)} detail="Created in the selected period"/>
      <MetricCard label="Captured payments" value={String((s.SUCCEEDED || 0) + (s.REFUNDED || 0) + (s.PARTIALLY_REFUNDED || 0))} detail="Includes subsequently refunded payments"/>
      <MetricCard label="Pending payments" value={String((s.CREATED || 0) + (s.PENDING || 0) + (s.PROCESSING || 0))}/>
      <MetricCard label="Failed payments" value={String(s.FAILED || 0)} detail={`${s.CANCELLED || 0} cancelled · ${s.EXPIRED || 0} expired`}/>
      <MetricCard label="Needs review" value={String(d.reviewRequired)}/>
    </section>
    <h2>Confirmed ledger totals</h2><p>Transactions occurring during this period. Currencies and transaction types are never combined.</p>
    {!d.totals.length ? <EmptyState title="No confirmed transactions"/> : <section className="metric-grid">{d.totals.map(t => <MetricCard key={`${t.currency}-${t.type}`} label={`${t.type} · ${t.currency}`} value={formatMinor(t.amountMinor, t.currency)} detail={`${t.count} posted transactions`}/>)}</section>}
  </section>
}
function Records({ filters, ledger }: { filters: PaymentFilters; ledger: boolean }) {
  const [page, setPage] = useState(1), [state, setState] = useState('')
  const q = useQuery({ queryKey: ['payment-service-records', ledger, filters, page, state], queryFn: ({ signal }) => paymentApi.records(ledger, { ...filters, page, ...(ledger ? { type: state || undefined } : { status: state || undefined }) }, signal), staleTime: 30000, retry: false })
  const columns: Column<PaymentRecord>[] = [
    { key: 'id', label: ledger ? 'Transaction' : 'Payment', render: r => r.id },
    { key: 'application', label: 'Application', render: r => r.application },
    { key: 'reference', label: 'Merchant reference', render: r => r.reference || '—' },
    { key: 'amount', label: 'Amount', render: r => formatMinor(r.amountMinor, r.currency) },
    { key: 'provider', label: 'Provider', render: r => r.provider },
    { key: 'status', label: 'Status', render: r => `${r.status}${r.verificationStatus === 'REVIEW_REQUIRED' ? ' · Needs review' : ''}` },
    ...(ledger ? [{ key: 'type', label: 'Type', render: (r: PaymentRecord) => r.type || '—' }] : []),
    { key: 'date', label: ledger ? 'Occurred' : 'Created', render: r => new Date(r.createdAt).toLocaleString() },
  ]
  return <section className="section panel"><div className="panel-heading"><h2>{ledger ? 'Financial transaction ledger' : 'All payments'}</h2>
    <label>{ledger ? 'Type' : 'Status'} <select value={state} onChange={e => { setState(e.target.value); setPage(1) }}><option value="">All</option>{(ledger ? ['PAYMENT', 'REFUND', 'REVERSAL', 'FEE'] : statuses).map(s => <option key={s}>{s}</option>)}</select></label>
    <button className="button button--secondary" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh</button></div>
    {q.isError ? <SectionError message={q.error.message} onRetry={() => void q.refetch()}/> : <DataTable columns={columns} data={q.data?.rows} loading={q.isLoading} page={page} totalPages={q.data?.pagination.totalPages} onPageChange={setPage} emptyTitle={ledger ? 'No posted transactions' : 'No payments for these filters'}/>}
    {q.data && <div className="panel-body">{q.data.pagination.total} records · Updated {new Date(q.data.lastUpdatedAt).toLocaleString()}</div>}
  </section>
}
