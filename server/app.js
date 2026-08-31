import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { managementConfig } from './config/index.js'
import { requestId } from './middleware/requestId.js'
import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { managementRouter } from './routes/management.routes.js'

export function createManagementApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', managementConfig.trustProxy ? 1 : false)
  app.use(requestId)
  app.use(helmet())
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || managementConfig.allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true)
      return callback(Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'FORBIDDEN' }))
    },
  }))
  app.use(express.json({ limit: managementConfig.bodyLimit }))
  app.use(rateLimit({
    windowMs: 60_000,
    limit: managementConfig.rateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health',
    handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many management API requests.' }, requestId: req.id }),
  }))
  app.use(requestLogger)
  app.get('/api/health', (req, res) => res.json({
    success: true,
    data: { service: 'vijo-management-api', status: 'healthy', timestamp: new Date().toISOString() },
    requestId: req.id,
  }))
  app.use('/api/management', managementRouter)
  app.use(notFound)
  app.use(errorHandler)
  return app
}
