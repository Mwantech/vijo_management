import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { ApiError } from '../errors.js'

const COOKIE_NAME = 'vijo_management_session'
const ROLES = new Set(['super_admin', 'admin', 'finance', 'support', 'viewer'])
const ttlMs = Number(process.env.MANAGEMENT_SESSION_TTL_MS || 8 * 60 * 60 * 1000)

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

const secret = () => process.env.MANAGEMENT_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-session-secret-change-me')
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url')
const cookieOptions = () => {
  const configuredSameSite = String(process.env.MANAGEMENT_COOKIE_SAME_SITE || 'Strict').toLowerCase()
  const sameSite = configuredSameSite === 'none' ? 'None' : configuredSameSite === 'lax' ? 'Lax' : 'Strict'
  const secure = process.env.NODE_ENV === 'production' || sameSite === 'None'
  const domain = process.env.MANAGEMENT_COOKIE_DOMAIN?.trim()
  return `; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}${domain ? `; Domain=${domain}` : ''}`
}

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
  const separator = part.indexOf('=')
  return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
}))

export function configuredAdmin() {
  const email = process.env.MANAGEMENT_ADMIN_EMAIL
  const passwordHash = process.env.MANAGEMENT_ADMIN_PASSWORD_HASH
  const developmentPassword = process.env.NODE_ENV !== 'production' ? process.env.MANAGEMENT_ADMIN_PASSWORD : undefined
  if (!email || (!passwordHash && !developmentPassword)) return undefined
  const role = ROLES.has(process.env.MANAGEMENT_ADMIN_ROLE) ? process.env.MANAGEMENT_ADMIN_ROLE : 'super_admin'
  return { id: process.env.MANAGEMENT_ADMIN_ID || 'management-admin', name: process.env.MANAGEMENT_ADMIN_NAME || 'Vijo Admin', email: email.toLowerCase(), passwordHash, developmentPassword, role }
}

export async function verifyAdminPassword(admin, password) {
  if (!admin || typeof password !== 'string') return false
  if (admin.passwordHash) return bcrypt.compare(password, admin.passwordHash)
  return safeEqual(password, admin.developmentPassword)
}

export function createSessionCookie(user) {
  const payload = encode({ sub: user.id, name: user.name, email: user.email, role: user.role, exp: Date.now() + ttlMs })
  return `${COOKIE_NAME}=${payload}.${sign(payload)}${cookieOptions()}`
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=${cookieOptions().replace(/Max-Age=\d+/, 'Max-Age=0')}`
}

export function sessionUser(req) {
  try {
    const token = cookies(req)[COOKIE_NAME]
    if (!token) return undefined
    const [payload, signature] = token.split('.')
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return undefined
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!value.exp || value.exp <= Date.now() || !ROLES.has(value.role)) return undefined
    return { id: value.sub, name: value.name, email: value.email, role: value.role, authType: 'session' }
  } catch {
    return undefined
  }
}

export function apiKeyUser(req) {
  const expected = process.env.MANAGEMENT_API_KEY
  if (!expected) return undefined
  const authorization = req.get('Authorization') || ''
  const provided = req.get('X-Management-Api-Key') || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
  return safeEqual(provided, expected) ? { id: 'service-api-key', name: 'Management service', email: 'service@nexvijo.internal', role: 'super_admin', authType: 'api_key' } : undefined
}

export function authenticateManagementUser(req, res, next) {
  req.managementUser = sessionUser(req) || apiKeyUser(req)
  if (!req.managementUser) return next(new ApiError('UNAUTHORIZED', 'Authentication is required.', 401))
  next()
}

export const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.managementUser) return next(new ApiError('UNAUTHORIZED', 'Authentication is required.', 401))
  if (!roles.includes(req.managementUser.role)) return next(new ApiError('FORBIDDEN', 'You do not have permission to access this resource.', 403))
  next()
}
