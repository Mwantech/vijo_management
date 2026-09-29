import { required, ref } from './shared.js'
export default ['membership_receipts', {
  membershipId: ref(), providerPaymentId: required(String), amount: required(String), currency: required(String),
  paidAt: required(Date), providerUpdatedAt: required(Date), refundedAmount: { type: String, default: '0' },
}, [[{ environment: 1, providerPaymentId: 1 }, { unique: true }], [{ membershipId: 1, paidAt: -1 }, {}]]]
