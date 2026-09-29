import { required, ref, enumOf } from './shared.js'

export default ['payment_attempts', {
      attemptId: required(String), paymentId: ref(), applicationId: ref(), sequence: required(Number),
      status: enumOf(['CREATED', 'SUBMITTING', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN']),
      providerKey: required(String), providerPaymentId: String, checkoutId: String, encryptedUrl: String, failureCode: String,
    }, [[{ attemptId: 1 }, { unique: true }], [{ paymentId: 1, sequence: 1 }, { unique: true }], [{ providerKey: 1 }, { unique: true }]]]
