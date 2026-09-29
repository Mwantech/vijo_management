import { required, ref, enumOf, lease } from './shared.js'

export default ['webhook_deliveries', {
      deliveryId: required(String), eventId: ref(), applicationId: ref(), destinationVersion: required(Number),
      status: enumOf(['PENDING', 'IN_FLIGHT', 'RETRY', 'DELIVERED', 'DEAD', 'PAUSED']), ...lease,
      deliveredAt: Date, lastHttpStatus: Number,
    }, [[{ deliveryId: 1 }, { unique: true }], [{ eventId: 1 }, { unique: true }], [{ status: 1, nextRunAt: 1 }], [{ status: 1, leaseUntil: 1 }]]]
