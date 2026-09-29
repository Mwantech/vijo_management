import { apiRequest } from './client'
export interface PaymentApplication { applicationId: string; name: string; status: string }
export interface PaymentRecord {
  id: string; paymentId?: string; reference?: string; application: string; applicationId?: string;
  amountMinor: string; currency: string; status: string; provider: string; type?: string; verificationStatus?: string; createdAt: string;
}
export interface PaymentAnalytics {
  statuses: Record<string, number>; totalPayments: number; reviewRequired: number;
  totals: { currency: string; type: string; amountMinor: string; count: number }[];
  environment: string; lastUpdatedAt: string; newPaymentsEnabled: boolean;
}
export interface PaymentRecords { rows: PaymentRecord[]; pagination: { page: number; limit: number; total: number; totalPages: number }; lastUpdatedAt: string }
export interface PaymentFilters { from: string; to: string; application?: string; currency?: string }
const base = '/api/management/payments'
export const paymentApi = {
  applications: (signal?: AbortSignal) => apiRequest<PaymentApplication[]>(`${base}/applications`, { signal }),
  analytics: (q: PaymentFilters, signal?: AbortSignal) => apiRequest<PaymentAnalytics>(`${base}/analytics`, { signal }, { ...q }),
  records: (ledger: boolean, q: PaymentFilters & { page: number; status?: string; type?: string }, signal?: AbortSignal) => apiRequest<PaymentRecords>(`${base}/${ledger ? 'transactions' : 'records'}`, { signal }, { ...q, limit: 20 }),
}
// Decimal strings + BigInt preserve financial precision even beyond Number.MAX_SAFE_INTEGER.
export function formatMinor(amount: string, currency: string) {
  const decimals: Record<string, number> = { KES: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }
  const places = decimals[currency]
  if (!/^\d+$/.test(amount)) return '—'
  if (places === undefined) return `${currency} ${amount} minor units`
  const n = BigInt(amount), factor = 10n ** BigInt(places)
  return `${currency} ${(n / factor).toLocaleString()}${places ? `.${(n % factor).toString().padStart(places, '0')}` : ''}`
}
