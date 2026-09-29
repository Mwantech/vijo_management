import { Schema, common, options } from './shared.js'
import Application from './application.model.js'
import Payment from './payment.model.js'
import Attempt from './payment-attempt.model.js'
import Transaction from './transaction.model.js'
import Event from './payment-event.model.js'
import Delivery from './webhook-delivery.model.js'
import DeliveryAttempt from './webhook-delivery-attempt.model.js'
import Idempotency from './idempotency-key.model.js'
import Inbox from './provider-event.model.js'
import Job from './provider-job.model.js'
import Refund from './refund.model.js'
import Audit from './audit-event.model.js'
import RateBucket from './rate-bucket.model.js'
import RequestNonce from './request-nonce.model.js'
import Customer from './membership-customer.model.js'
import Membership from './membership.model.js'
import MembershipEvent from './membership-event.model.js'
import MemberSession from './membership-session.model.js'
import Challenge from './membership-challenge.model.js'
import MemberRate from './membership-rate.model.js'
import Post from './premium-post.model.js'
import MembershipReceipt from './membership-receipt.model.js'

// Never register payment models on Mongoose's default connection.
export function createModels(connection) {
  const definitions = { Application, Payment, Attempt, Transaction, Event, Delivery, DeliveryAttempt, Idempotency, Inbox, Job, Refund, Audit, RateBucket, RequestNonce, Customer, Membership, MembershipEvent, MemberSession, Challenge, MemberRate, Post, MembershipReceipt }
  return Object.fromEntries(Object.entries(definitions).map(([name, [collection, fields, indexes]]) => {
    const immutable = ['Transaction', 'Event', 'Audit', 'MembershipEvent'].includes(name)
    const schema = new Schema({ ...common, ...fields }, { ...options, timestamps: immutable ? { createdAt: true, updatedAt: false } : true })
    for (const [keys, opts] of indexes) schema.index(keys, opts)
    return [name, connection.models[`Payments${name}`] || connection.model(`Payments${name}`, schema, collection)]
  }))
}
