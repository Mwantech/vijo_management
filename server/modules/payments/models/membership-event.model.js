import { required, ref } from './shared.js'
export default ['membership_events', {
  eventId: required(String), membershipId: ref(), effectKey: required(String), type: required(String),
  actor: required(String), reason: String, providerEventId: String,
}, [[{ environment: 1, effectKey: 1 }, { unique: true }], [{ membershipId: 1, createdAt: -1 }, {}]]]
