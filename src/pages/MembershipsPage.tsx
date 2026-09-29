import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { membershipsApi, type BlogPost } from '../api/memberships.api'
import { formatMinor } from '../api/payments.api'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/common/PageHeader'
import { SectionError, SectionLoading } from '../components/common/SectionState'
export { MembershipsPage } from './MembershipDirectory'

const date = (v?: string | null) => v ? new Date(v).toLocaleString() : '—'
export function MembershipDetailsPage() {
  const { id = '' } = useParams(), { user } = useAuth()
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const q = useQuery({ queryKey: ['membership', id], queryFn: ({ signal }) => membershipsApi.detail(id, signal), retry: false })
  async function action(value: 'grant' | 'revoke') {
    setBusy(true); setError('')
    try { await membershipsApi.action(id, value, reason); setReason(''); await q.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }
  const m = q.data
  return <><PageHeader eyebrow="Membership fulfillment" title={m?.email || 'Membership details'} description="Database-backed access and purchase history."/>
    {q.isLoading && <SectionLoading/>}{q.isError && <SectionError message={q.error.message} onRetry={() => void q.refetch()}/>}
    {m && <><section className="section"><h2>Premium Blog Membership</h2><p>Provider: {m.provider} · Payment: {m.paymentStatus === 'owner_verified' ? 'Paid (owner verified)' : m.paymentStatus === 'verified' ? 'Paid (Whop verified)' : m.paymentStatus} · Status: {m.status}</p><p>Access: {m.accessGranted ? 'Granted' : 'Not granted'} · {m.claimed ? 'Claimed by verified customer' : 'Awaiting email verification'}</p><p>Purchase: {m.amount && m.currency ? formatMinor(m.amount, m.currency) : '—'}{m.purchasedOn && ` · ${m.purchasedOn}`}</p><p>Started: {date(m.startedAt)} · Expiry: {m.expiresAt ? date(m.expiresAt) : 'Permanent'}</p></section>
      <section className="section"><h2>Verified receipts</h2>{!m.receipts.length && <p>No verified payment receipts.</p>}{m.receipts.map(r => <p key={r.providerPaymentId}>{r.providerPaymentId} · {formatMinor(r.amount, r.currency)} · Refunded {formatMinor(r.refundedAmount, r.currency)} · {date(r.paidAt)}</p>)}</section>
      {['admin', 'super_admin'].includes(user.role) && <section className="section"><label>Reason for access change<input minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><div className="page-actions"><button disabled={busy || reason.trim().length < 10} onClick={() => void action('grant')}>Grant / reinstate</button><button disabled={busy || reason.trim().length < 10} onClick={() => void action('revoke')}>Revoke access</button></div>{error && <p role="alert">{error}</p>}</section>}
      <section className="section"><h2>Audit history</h2>{m.events.map(e => <p key={e.eventId}>{date(e.createdAt)} · {e.type} · {e.actor}{e.reason && ` · ${e.reason}`}</p>)}</section></>}
  </>
}
const blank: BlogPost = { slug: '', title: '', excerpt: '', content: '', visibility: 'premium', category: 'Tutorial', published: false }
export function MembershipContentPage() {
  const [post, setPost] = useState<BlogPost>(blank), [page, setPage] = useState(1), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const { user } = useAuth(), editable = ['admin', 'super_admin'].includes(user.role)
  const q = useQuery({ queryKey: ['membership-posts', page], queryFn: ({ signal }) => membershipsApi.posts(page, signal), retry: false })
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('')
    try { await membershipsApi.save(post); setMessage('Saved. Published articles appear on nexvijo.com/blog.'); await q.refetch() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }
  return <><PageHeader eyebrow="Nexvijo library" title="Blog content" description="Premium bodies are served only after backend entitlement checks. Content is plain text, not executable HTML."/>
    {q.isError && <SectionError message={q.error.message} onRetry={() => void q.refetch()}/>}{q.isLoading && <SectionLoading/>}
    <section className="section">{q.data?.map(p => <p key={p.slug}><button onClick={() => setPost(p)}>{p.title}</button> · {p.visibility} · {p.published ? 'Published' : 'Draft'}</p>)}<div className="page-actions"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={(q.data?.length || 0) < 20} onClick={() => setPage(p => p + 1)}>Next</button><button onClick={() => setPost(blank)}>New article</button></div></section>
    {editable && <form className="section" onSubmit={save}><div className="filter-bar">{(['slug', 'title', 'category'] as const).map(key => <label key={key}>{key}<input required value={post[key]} onChange={e => setPost({ ...post, [key]: e.target.value })}/></label>)}<label>Visibility<select value={post.visibility} onChange={e => setPost({ ...post, visibility: e.target.value as BlogPost['visibility'] })}><option value="premium">Premium</option><option value="public">Public</option></select></label></div>
      <label>Public excerpt<textarea required minLength={10} maxLength={600} style={{ width: '100%' }} value={post.excerpt} onChange={e => setPost({ ...post, excerpt: e.target.value })}/></label>
      <label>Full article<textarea required minLength={30} maxLength={24000} rows={18} style={{ width: '100%' }} value={post.content} onChange={e => setPost({ ...post, content: e.target.value })}/></label>
      <label><input type="checkbox" checked={post.published} onChange={e => setPost({ ...post, published: e.target.checked })}/> Published</label><div className="page-actions"><button className="button" disabled={busy}>Save article</button></div>{message && <p role="status">{message}</p>}</form>}</>
}
