import { required, enumOf, Schema } from './shared.js'
export default ['memberships', {
  membershipId: required(String), customerId: Schema.Types.ObjectId, email: required(String),
  provider: enumOf(['whop', 'manual']), providerMembershipId: String, providerCustomerId: String,
  providerPaymentId: String, productId: String, accountId: String, providerUpdatedAt: Date,
  plan: { type: String, default: 'premium_blog' }, status: enumOf(['active', 'cancelled', 'expired', 'suspended']),
  paymentStatus: enumOf(['verified', 'owner_verified', 'manual', 'unverified']), amount: String, currency: String,
  manualPurchaseKey: String, purchasedOn: String,
  startedAt: required(Date), expiresAt: Date, lastPaymentAt: Date, verifiedAt: Date,
  revokedAt: Date, overrideReason: String, version: { type: Number, default: 1 },
}, [[{ membershipId: 1 }, { unique: true }],
  [{ environment: 1, provider: 1, providerMembershipId: 1 }, { unique: true, partialFilterExpression: { providerMembershipId: { $type: 'string' } } }],
  [{ environment: 1, manualPurchaseKey: 1 }, { unique: true, partialFilterExpression: { manualPurchaseKey: { $type: 'string' } } }],
  [{ environment: 1, customerId: 1, plan: 1 }, {}], [{ environment: 1, email: 1 }, {}]]]
