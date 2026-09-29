import { required, ref, money, enumOf } from './shared.js'
import { states } from '../domain.js'

export default ['payments', {
      paymentId: required(String), applicationId: ref(), reference: required(String), requestHash: required(String),
      amount: money(), currency: required(String), method: { type: String, enum: ['card'], default: 'card' },
      provider: { type: String, enum: ['whop'], default: 'whop' }, providerAccountId: required(String),
      status: enumOf(states), version: { type: Number, default: 0 }, sequence: { type: Number, default: 1 },
      activeAttemptId: String, winningProviderId: String, verificationStatus: { type: String, default: 'PENDING' },
      customer: { externalId: String, email: String }, metadata: { type: Map, of: String },
      refundedAmount: { ...money(), default: '0' }, reservedAmount: { ...money(), default: '0' },
      lastVerifiedAt: Date, completedAt: Date, failedAt: Date,
    }, [[{ paymentId: 1 }, { unique: true }], [{ applicationId: 1, reference: 1 }, { unique: true }], [{ applicationId: 1, createdAt: -1, _id: -1 }], [{ status: 1, lastVerifiedAt: 1 }]]]
