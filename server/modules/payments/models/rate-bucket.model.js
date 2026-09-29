import { required, ref } from './shared.js'

export default ['payment_rate_buckets', { applicationId: ref(), window: required(Number), count: { type: Number, default: 0 }, expiresAt: required(Date) }, [[{ applicationId: 1, window: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
