import { apiRequest } from './client'
export interface Membership { membershipId: string; email: string; plan: string; provider: string; status: string; paymentStatus: string; accessGranted: boolean; claimed: boolean; startedAt: string; expiresAt: string | null; lastPaymentAt?: string; purchasedOn?: string; amount?: string; currency?: string }
export interface MembershipDetail extends Membership { events: { eventId: string; type: string; actor: string; reason?: string; createdAt: string }[]; receipts: { providerPaymentId: string; amount: string; currency: string; paidAt: string; refundedAmount: string }[] }
export interface BlogPost { slug: string; title: string; excerpt: string; content: string; visibility: 'public' | 'premium'; category: string; published: boolean }
const base = '/api/management'
export const membershipsApi = {
  list: (page: number, search: string, signal?: AbortSignal) => apiRequest<{items: Membership[]; totalPages: number; total: number}>(`${base}/memberships`, { signal }, { page, search, limit: 20 }),
  detail: (id: string, signal?: AbortSignal) => apiRequest<MembershipDetail>(`${base}/memberships/${encodeURIComponent(id)}`, { signal }),
  action: (id: string, action: 'grant' | 'revoke', reason: string) => apiRequest(`${base}/memberships/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  grant: (email: string, reason: string) => apiRequest(`${base}/memberships`, { method: 'POST', body: JSON.stringify({ email, reason }) }),
  posts: (page: number, signal?: AbortSignal) => apiRequest<BlogPost[]>(`${base}/content/posts`, { signal }, { page, limit: 20 }),
  save: (post: BlogPost) => apiRequest(`${base}/content/posts/${encodeURIComponent(post.slug)}`, { method: 'PUT', body: JSON.stringify(post) }),
}
