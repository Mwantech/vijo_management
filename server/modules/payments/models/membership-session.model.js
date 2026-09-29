import { required, ref } from './shared.js'
export default ['membership_sessions', { tokenHash: required(String), customerId: ref(), expiresAt: required(Date) },
  [[{ tokenHash: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
