import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { managementConfig } from './config/index.js'
import { requestId } from './middleware/requestId.js'
import { requestLogger } from './middleware/requestLogger.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { managementRouter } from './routes/management.routes.js'

const clientDirectory = fileURLToPath(new URL('../dist', import.meta.url))
const clientIndex = fileURLToPath(new URL('../dist/index.html', import.meta.url))

export function createManagementApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', managementConfig.trustProxy ? 1 : false)
  app.use(requestId)
  app.use(helmet())
  app.use(cors((req, callback) => {
    const origin = req.get('Origin')?.replace(/\/$/, '')
    const requestOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '')
    const allowed = !origin || origin === requestOrigin || managementConfig.allowedOrigins.includes(origin)
    if (allowed) return callback(null, { credentials: true, origin: true })
    return callback(Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'FORBIDDEN' }))
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

  if (existsSync(clientIndex)) {
    app.use(express.static(clientDirectory, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next()
      return res.sendFile(clientIndex)
    })
  }

  app.use(notFound)
  app.use(errorHandler)
  return app
}
