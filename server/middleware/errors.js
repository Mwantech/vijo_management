import { ApiError } from '../errors.js'

export function notFound(req, res) {
  res.status(404).json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Management API route not found.' }, requestId: req.id })
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  const known = error instanceof ApiError
  const status = known ? error.status : 500
  const code = known ? error.code : 'INTERNAL_ERROR'
  console.error(JSON.stringify({ level: 'error', event: 'request_error', requestId: req.id, route: req.originalUrl.split('?')[0], statusCode: status, errorCode: code, message: error.message }))
  res.status(status).json({
    success: false,
    error: {
      code,
      message: known || process.env.NODE_ENV !== 'production' ? error.message : 'The management API could not complete this request.',
      ...(known && error.details ? { details: error.details } : {}),
    },
    requestId: req.id,
  })
}
