import { Router } from 'express'
import { z } from 'zod'
import { authenticateManagementUser, authorizeRoles } from '../../middleware/auth.js'
import { fail, parse, states } from './domain.js'
import { paymentError } from './routes.js'
import { audit } from './services/events.js'

const querySchema = z.object({
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  application: z.string().regex(/^app_[A-Za-z0-9_-]{24}$/).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  status: z.enum(states).optional(), type: z.enum(['PAYMENT', 'REFUND', 'REVERSAL', 'FEE']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(q => !q.from || !q.to || new Date(q.from) < new Date(q.to), 'Invalid date range')

export function paymentManagementRouter(ctx) {
  const router = Router()
  router.use(authenticateManagementUser, authorizeRoles('super_admin', 'admin', 'finance'))
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!ctx?.ready || ctx.connection?.readyState !== 1) fail('PAYMENTS_UNAVAILABLE', 'The payment database is not configured or is unavailable.', 503)
    next()
  })
  async function filters(req, dateField = 'createdAt') {
    const q = parse(querySchema, req.query), filter = { environment: ctx.config.environment }
    if (q.currency) filter.currency = q.currency
    if (q.from || q.to) filter[dateField] = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lt: new Date(q.to) } : {}) }
    if (q.application) {
      const app = await ctx.models.Application.findOne({ applicationId: q.application, environment: ctx.config.environment }).select('_id')
      if (!app) fail('RESOURCE_NOT_FOUND', 'Payment application not found.', 404)
      filter.applicationId = app._id
    }
    return { q, filter }
  }
  async function respond(req, res, action, data) {
    await audit(ctx, req.managementUser.id, action, 'payment-service', req.id)
    res.json({ success: true, data, requestId: req.id })
  }
  router.get('/applications', async (req, res) => {
    const applications = await ctx.models.Application.find({ environment: ctx.config.environment }).select('applicationId name status -_id').sort({ name: 1 }).limit(500).lean()
    await respond(req, res, 'PAYMENT_APPLICATIONS_VIEWED', applications)
  })
  router.get('/analytics', async (req, res) => {
    const { filter } = await filters(req), ledger = { ...filter }
    if (ledger.createdAt) { ledger.occurredAt = ledger.createdAt; delete ledger.createdAt }
    const [statuses, currencies, reviewRequired] = await Promise.all([
      ctx.models.Payment.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
      ctx.models.Transaction.aggregate([{ $match: { ...ledger, status: 'POSTED' } }, { $group: { _id: { currency: '$currency', type: '$type' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
      ctx.models.Payment.countDocuments({ ...filter, verificationStatus: 'REVIEW_REQUIRED' }).maxTimeMS(5000),
    ])
    await respond(req, res, 'PAYMENT_ANALYTICS_VIEWED', {
      statuses: Object.fromEntries(statuses.map(row => [row._id, row.count])), totalPayments: statuses.reduce((n, row) => n + row.count, 0), reviewRequired,
      totals: currencies.map(row => ({ currency: row._id.currency, type: row._id.type, amountMinor: row.amount.toString(), count: row.count })),
      environment: ctx.config.environment, lastUpdatedAt: new Date().toISOString(),
      newPaymentsEnabled: ctx.config.creationEnabled && (ctx.config.providerEnvironment !== 'production' || ctx.config.liveCheckoutSupported),
    })
  })
  for (const kind of ['records', 'transactions']) router.get(`/${kind}`, async (req, res) => {
    const isLedger = kind === 'transactions'
    const { q, filter } = await filters(req, isLedger ? 'occurredAt' : 'createdAt')
    if (isLedger && q.type) filter.type = q.type
    if (!isLedger && q.status) filter.status = q.status
    const model = isLedger ? ctx.models.Transaction : ctx.models.Payment
    const selected = isLedger ? 'transactionId paymentId applicationId providerReference provider type amount currency status occurredAt createdAt' : 'paymentId applicationId reference amount currency status verificationStatus provider createdAt completedAt refundedAmount'
    const [rows, total] = await Promise.all([
      model.find(filter).select(selected).sort({ _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).maxTimeMS(5000).lean(),
      model.countDocuments(filter).maxTimeMS(5000),
    ])
    const apps = await ctx.models.Application.find({ _id: { $in: rows.map(row => row.applicationId) } }).select('name applicationId').lean()
    const appNames = new Map(apps.map(app => [app._id.toString(), app]))
    const payments = isLedger ? await ctx.models.Payment.find({ _id: { $in: rows.map(row => row.paymentId) } }).select('paymentId reference').lean() : []
    const paymentNames = new Map(payments.map(p => [p._id.toString(), p]))
    const data = rows.map(row => ({
      id: isLedger ? row.transactionId : row.paymentId,
      paymentId: isLedger ? paymentNames.get(row.paymentId.toString())?.paymentId : row.paymentId,
      reference: isLedger ? paymentNames.get(row.paymentId.toString())?.reference : row.reference,
      application: appNames.get(row.applicationId.toString())?.name ?? 'Deleted application',
      applicationId: appNames.get(row.applicationId.toString())?.applicationId,
      amountMinor: row.amount.toString(), currency: row.currency, status: row.status, provider: row.provider,
      ...(isLedger ? { type: row.type, providerReference: row.providerReference } : { verificationStatus: row.verificationStatus }),
      createdAt: isLedger ? row.occurredAt : row.createdAt,
    }))
    await respond(req, res, isLedger ? 'PAYMENT_TRANSACTIONS_VIEWED' : 'PAYMENTS_VIEWED', { rows: data,
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) }, lastUpdatedAt: new Date().toISOString() })
  })
  router.use(paymentError)
  return router
}
