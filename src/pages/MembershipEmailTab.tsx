import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { membershipsApi, type MembershipEmailPreview } from '../api/memberships.api'
import { SectionError } from '../components/common/SectionState'
import { DataTable } from '../components/common/DataTable'

export function MembershipEmailTab() {
  const [search, setSearch] = useState(''), [draft, setDraft] = useState(''), [page, setPage] = useState(1), [historyPage, setHistoryPage] = useState(1)
  const [selected, setSelected] = useState(''), [preview, setPreview] = useState<MembershipEmailPreview>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const members = useQuery({ queryKey: ['email-members', page, search], queryFn: ({ signal }) => membershipsApi.list(page, search, signal), retry: false })
  const history = useQuery({ queryKey: ['membership-email-history', historyPage], queryFn: ({ signal }) => membershipsApi.emailHistory(historyPage, signal), retry: false })
  async function loadPreview() {
    setBusy(true); setMessage(''); setPreview(undefined)
    try { setPreview(await membershipsApi.emailPreview(selected)) } catch (e) { setMessage(e instanceof Error ? e.message : 'Preview unavailable') } finally { setBusy(false) }
  }
  async function send() {
    if (!preview) return
    setBusy(true); setMessage('')
    try {
      const result = await membershipsApi.sendEmail(selected, preview.previewHash)
      setMessage(`${result.status === 'already_sent' ? 'Already submitted; no duplicate sent' : 'Accepted by email provider (delivery not yet confirmed)'}. Email ID: ${result.emailId}`)
      setPreview(undefined)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Send failed') }
    finally { setBusy(false); void history.refetch() }
  }
  return <div className="member-email-tab">
    <section className="member-grant"><div className="member-grant-form">
      <h2>Send purchase verification email</h2><p>Thank customers for their purchase and ask them to verify their email. Your team sends the Google Drive course link manually afterward.</p>
      <form className="member-toolbar" onSubmit={e => { e.preventDefault(); setSearch(draft.trim()); setPage(1); setSelected(''); setPreview(undefined) }}>
        <label className="member-search"><span className="member-sr-only">Find customer email</span><input type="search" placeholder="Find customer by email" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}/></label><button className="button button--secondary" disabled={busy}>Search</button>
      </form>
      {members.isError && <SectionError message={members.error.message} onRetry={() => void members.refetch()}/>}
      <div className="member-grant-fields"><label>Purchased course<select disabled={busy} value={selected} onChange={e => { setSelected(e.target.value); setPreview(undefined); setMessage('') }}><option value="">Select a course purchase</option>{members.data?.items.filter(m => m.plan !== 'premium_blog').map(m => <option key={m.membershipId} value={m.membershipId}>{m.email} · {m.productName || m.plan} · {m.status}</option>)}</select></label></div>
      <div className="member-grant-actions"><div><button className="button button--secondary" disabled={busy || page <= 1} onClick={() => { setPage(p => p - 1); setSelected(''); setPreview(undefined) }}>Previous customers</button> <button className="button button--secondary" disabled={busy || !members.data || page >= members.data.totalPages} onClick={() => { setPage(p => p + 1); setSelected(''); setPreview(undefined) }}>Next customers</button></div><button className="button button--secondary" disabled={!selected || busy} onClick={() => void loadPreview()}>Preview email</button></div>
      {!members.isLoading && !members.isError && !members.data?.items.some(m => m.plan !== 'premium_blog') && <p>No course purchases on this page. Search for the customer or change page.</p>}
      {preview && <section className="member-email-preview"><p><strong>To:</strong> {preview.to}</p><p><strong>Replies:</strong> {preview.replyTo}</p><h3>{preview.subject}</h3><pre>{preview.text}</pre><button className="button button--primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send this email'}</button></section>}
      {message && <p role="status">{message}</p>}
    </div></section>
    <section aria-label="Email history"><div className="member-directory-heading"><h2>Send history & verification</h2><button className="button button--secondary" onClick={() => { void history.refetch(); void members.refetch() }}>Refresh</button></div>
      <p>Reserved means pending or outcome unknown. Accepted means submitted to the provider, not confirmed delivery. Check Resend using the email ID before retrying. Verified customers are ready for your manual course-link follow-up.</p>
      {history.isError ? <SectionError message={history.error.message} onRetry={() => void history.refetch()}/> : <DataTable data={history.data?.items} loading={history.isLoading} page={historyPage} totalPages={history.data?.totalPages} onPageChange={setHistoryPage} emptyTitle="No membership emails sent yet" columns={[
        { key: 'email', label: 'Customer', render: e => e.email || '—' }, { key: 'product', label: 'Product', render: e => e.plan?.replaceAll('_', ' ') || '—' },
        { key: 'event', label: 'Event', render: e => e.type.replaceAll('_', ' ').toLowerCase() },
        { key: 'verified', label: 'Email verification', render: e => !e.accessGranted ? 'Access inactive · do not fulfill' : e.emailVerified ? 'Verified · manual follow-up' : 'Pending verification' },
        { key: 'id', label: 'Provider email ID', render: e => e.emailId || '—' },
        { key: 'date', label: 'Date', render: e => new Date(e.createdAt).toLocaleString() },
      ]}/>}
    </section>
  </div>
}
