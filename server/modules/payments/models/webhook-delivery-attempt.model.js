import { required, ref } from './shared.js'

export default ['webhook_delivery_attempts', {
      deliveryId: ref(), attemptNumber: required(Number), outcome: required(String), httpStatus: Number, finishedAt: Date,
    }, [[{ deliveryId: 1, attemptNumber: 1 }, { unique: true }]]]
