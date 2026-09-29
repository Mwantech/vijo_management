import { required } from './shared.js'
export default ['membership_rate_limits', { key: required(String), count: { type: Number, default: 0 }, expiresAt: required(Date) },
  [[{ key: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
