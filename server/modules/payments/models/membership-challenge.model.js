import { required } from './shared.js'
export default ['membership_challenges', {
  challengeId: required(String), email: required(String), codeHash: required(String),
  attempts: { type: Number, default: 0 }, consumedAt: Date, expiresAt: required(Date),
}, [[{ challengeId: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]]
