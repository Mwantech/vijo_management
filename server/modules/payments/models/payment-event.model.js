import { required, ref } from './shared.js'

export default ['payment_events', {
      eventId: required(String), paymentId: ref(), applicationId: ref(), type: required(String), version: required(Number), body: required(String),
    }, [[{ eventId: 1 }, { unique: true }], [{ paymentId: 1, version: 1 }, { unique: true }]]]
