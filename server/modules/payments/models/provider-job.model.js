import { required, ref, enumOf, lease } from './shared.js'

export default ['provider_jobs', {
      operationKey: required(String), paymentId: ref(), applicationId: ref(), attemptId: String, refundId: String,
      operation: enumOf(['CREATE_CHECKOUT', 'VERIFY', 'REFUND']),
      status: enumOf(['PENDING', 'IN_FLIGHT', 'RETRY', 'DONE', 'REVIEW_REQUIRED']), ...lease,
      firstSubmittedAt: Date, providerRequest: String,
    }, [[{ operationKey: 1 }, { unique: true }], [{ status: 1, nextRunAt: 1 }], [{ status: 1, leaseUntil: 1 }]]]
