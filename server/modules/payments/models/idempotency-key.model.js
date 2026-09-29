import { required, ref } from './shared.js'

export default ['idempotency_keys', {
      applicationId: ref(), key: required(String), requestHash: required(String), paymentId: required(String), response: required(String),
      expiresAt: Date,
    }, [[{ applicationId: 1, key: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
