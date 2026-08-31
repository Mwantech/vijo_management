import { ApiError } from '../errors.js'
import { audit } from '../services/audit.service.js'
import { clearSessionCookie, configuredAdmin, createSessionCookie, sessionUser, verifyAdminPassword } from '../middleware/auth.js'

export async function login(req, res, next) {
  try {
    const admin = configuredAdmin()
    if (!admin) throw new ApiError('AUTH_NOT_CONFIGURED', 'Management login is not configured.', 503)
    const email = String(req.body?.email || '').trim().toLowerCase()
    const valid = email === admin.email && await verifyAdminPassword(admin, req.body?.password)
    if (!valid) throw new ApiError('UNAUTHORIZED', 'Invalid management credentials.', 401)
    const user = { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    res.setHeader('Set-Cookie', createSessionCookie(user))
    req.managementUser = user
    audit(req, 'MANAGEMENT_LOGIN')
    res.json({ success: true, data: { user }, requestId: req.id })
  } catch (error) { next(error) }
}

export function logout(req, res) {
  req.managementUser = sessionUser(req)
  if (req.managementUser) audit(req, 'MANAGEMENT_LOGOUT')
  res.setHeader('Set-Cookie', clearSessionCookie())
  res.status(204).end()
}

export function me(req, res, next) {
  const user = sessionUser(req)
  if (!user) return next(new ApiError('UNAUTHORIZED', 'Authentication is required.', 401))
  res.json({ success: true, data: { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, requestId: req.id })
}
