import { required, enumOf, lease } from './shared.js'

export default ['provider_events', {
      provider: { type: String, default: 'whop' }, accountId: required(String), providerEventId: required(String),
      providerPaymentId: String, providerMembershipId: String, providerRefundId: String, type: required(String), payloadHash: required(String),
      status: enumOf(['PENDING', 'IN_FLIGHT', 'RETRY', 'DONE', 'REVIEW_REQUIRED']), ...lease,
    }, [[{ accountId: 1, environment: 1, providerEventId: 1 }, { unique: true }], [{ status: 1, nextRunAt: 1 }], [{ status: 1, leaseUntil: 1 }]]]
