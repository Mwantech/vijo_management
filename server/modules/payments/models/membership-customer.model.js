import { required } from './shared.js'
export default ['membership_customers', {
  customerId: required(String), email: required(String), emailVerifiedAt: Date, name: String,
}, [[{ customerId: 1 }, { unique: true }], [{ environment: 1, email: 1 }, { unique: true }]]]
