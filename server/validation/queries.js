import { z } from 'zod'
import { PLATFORM_IDS } from '../config/index.js'

const optionalIsoDate = z.string().datetime({ offset: true }).optional()
const page = z.coerce.number().int().min(1).default(1)
const limit = z.coerce.number().int().min(1).max(100).default(20)
const platform = z.enum(PLATFORM_IDS).optional()

const withDateRange = (shape = {}) => z.object({ from: optionalIsoDate, to: optionalIsoDate, ...shape }).strict().superRefine((value, context) => {
  if (value.from && value.to && new Date(value.from) >= new Date(value.to)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '`to` must be later than `from` (from is inclusive; to is exclusive).' })
})

export const analyticsQuery = withDateRange({ interval: z.enum(['hour', 'day', 'week', 'month']).optional(), granularity: z.enum(['daily', 'weekly', 'monthly']).optional() })
export const usersQuery = withDateRange({ page, limit, platform, search: z.string().trim().max(120).optional(), status: z.enum(['active', 'inactive', 'suspended', 'unknown']).optional(), subscription: z.string().trim().max(80).optional(), paying: z.enum(['true', 'false']).optional(), activity: z.enum(['active', 'inactive']).optional() })
export const revenueQuery = withDateRange({ platform, currency: z.string().trim().min(3).max(12).optional(), interval: z.enum(['hour', 'day', 'week', 'month']).optional() })
export const subscriptionQuery = z.object({ page, limit, platform, status: z.enum(['trial', 'active', 'expired', 'cancelled', 'past_due', 'unknown']).optional(), plan: z.string().trim().max(80).optional() }).strict()
export const transactionQuery = withDateRange({ page, limit, platform, status: z.enum(['successful', 'pending', 'failed', 'reversed', 'cancelled', 'unknown']).optional(), paymentMethod: z.string().trim().max(80).optional(), method: z.string().trim().max(80).optional(), currency: z.string().trim().min(3).max(12).optional() })
export const activityQuery = withDateRange({ page, limit, platform, type: z.string().trim().max(120).optional() })
export const platformParam = z.object({ platform: z.enum(PLATFORM_IDS) }).strict()
export const userIdParam = z.object({ id: z.string().trim().min(3).max(300) }).strict()
