import { required } from './shared.js'

export default ['payment_audit_events', { actor: required(String), action: required(String), targetId: required(String), requestId: String }, [[{ targetId: 1, createdAt: -1 }]]]
