import { required } from './shared.js'

export default ['payment_request_nonces', {
  platform: required(String), nonce: required(String), expiresAt: required(Date),
}, [[{ environment: 1, platform: 1, nonce: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
