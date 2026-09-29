import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MembershipsPage } from './MembershipDirectory'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))

it('renders records without a service-status dependency and uses Nairobi start time', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['memberships', 1, ''], { items: [{ membershipId: 'mem_test', email: 'member@example.com', plan: 'premium_blog', provider: 'whop', status: 'active', paymentStatus: 'owner_verified', amount: '5000', currency: 'USD', accessGranted: true, claimed: false, startedAt: '2026-09-25T23:54:00.000Z', expiresAt: null }], total: 1, totalPages: 1 })
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><MembershipsPage/></MemoryRouter></QueryClientProvider>)
  expect(html).toContain('member@example.com')
  expect(html).toContain('26/09/2026, 2:54 am')
  expect(html).toContain('Started (EAT)')
  expect(html).toContain('Grant membership access')
  expect(html).not.toContain('Service status')
  expect(html).not.toContain('MEMBERSHIPS_ENABLED')
  expect(client.getQueryCache().find({ queryKey: ['membership-service-status'] })).toBeUndefined()
  client.clear()
})
