import { required, ref, money, enumOf } from './shared.js'

export default ['refunds', {
      refundId: required(String), paymentId: ref(), applicationId: ref(), amount: money(), currency: required(String),
      reason: required(String), status: enumOf(['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']),
      providerKey: required(String), providerRefundId: String,
    }, [[{ refundId: 1 }, { unique: true }], [{ paymentId: 1, createdAt: 1 }]]]
