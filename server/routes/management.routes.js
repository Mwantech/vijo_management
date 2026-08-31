import { Router } from 'express'
import { z } from 'zod'
import { rateLimit } from 'express-rate-limit'
import { login, logout, me } from '../controllers/auth.controller.js'
import * as controller from '../controllers/management.controller.js'
import { authenticateManagementUser, authorizeRoles } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { activityQuery, analyticsQuery, platformParam, revenueQuery, subscriptionQuery, transactionQuery, userIdParam, usersQuery } from '../validation/queries.js'

export const managementRouter = Router()
const allAnalytics = authorizeRoles('super_admin', 'admin', 'viewer')
const financial = authorizeRoles('super_admin', 'admin', 'finance')
const userAccess = authorizeRoles('super_admin', 'admin', 'support')
const activityAccess = authorizeRoles('super_admin', 'admin', 'support', 'viewer')

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })
const loginBody = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(256) }).strict()

managementRouter.post('/auth/login', loginLimiter, validate(loginBody, 'body'), login)
managementRouter.post('/auth/logout', logout)
managementRouter.get('/auth/me', me)

managementRouter.use(authenticateManagementUser)
managementRouter.get('/dashboard', allAnalytics, validate(analyticsQuery), controller.dashboard)
managementRouter.get('/platforms', allAnalytics, validate(analyticsQuery), controller.platforms)
managementRouter.get('/platforms/:platform', allAnalytics, validate(platformParam, 'params'), validate(analyticsQuery), controller.platform)
managementRouter.get('/platforms/:platform/analytics', allAnalytics, validate(platformParam, 'params'), validate(analyticsQuery), controller.platformAnalytics)
managementRouter.get('/platforms/:platform/users', userAccess, validate(platformParam, 'params'), validate(usersQuery), controller.platformUsers)
managementRouter.get('/platforms/:platform/revenue', financial, validate(platformParam, 'params'), validate(revenueQuery), controller.platformRevenue)
managementRouter.get('/platforms/:platform/subscriptions', financial, validate(platformParam, 'params'), validate(subscriptionQuery), controller.platformSubscriptions)
managementRouter.get('/platforms/:platform/transactions', financial, validate(platformParam, 'params'), validate(transactionQuery), controller.platformTransactions)
managementRouter.get('/platforms/:platform/activity', activityAccess, validate(platformParam, 'params'), validate(activityQuery), controller.platformActivity)
managementRouter.get('/users', userAccess, validate(usersQuery), controller.users)
managementRouter.get('/users/:id', userAccess, validate(userIdParam, 'params'), controller.user)
managementRouter.get('/revenue', financial, validate(revenueQuery), controller.revenue)
managementRouter.get('/revenue/timeseries', financial, validate(revenueQuery), controller.revenueTimeseries)
managementRouter.get('/subscriptions', financial, validate(subscriptionQuery), controller.subscriptions)
managementRouter.get('/transactions', financial, validate(transactionQuery), controller.transactions)
managementRouter.get('/activity', activityAccess, validate(activityQuery), controller.activity)
managementRouter.get('/growth', allAnalytics, validate(analyticsQuery), controller.growth)
managementRouter.get('/system/status', allAnalytics, controller.systemStatus)
