import { required, ref, money, enumOf } from './shared.js'

export default ['transactions', {
      transactionId: required(String), paymentId: ref(), applicationId: ref(), providerReference: required(String),
      providerAccountId: required(String), provider: { type: String, default: 'whop' },
      type: enumOf(['PAYMENT', 'REFUND', 'REVERSAL', 'FEE']), amount: money(), currency: required(String),
      status: { type: String, enum: ['POSTED'], default: 'POSTED' }, occurredAt: required(Date),
    }, [[{ transactionId: 1 }, { unique: true }], [{ providerAccountId: 1, environment: 1, type: 1, providerReference: 1 }, { unique: true }], [{ applicationId: 1, createdAt: -1, _id: -1 }], [{ paymentId: 1 }]]]
