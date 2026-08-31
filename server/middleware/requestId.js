import { randomUUID } from 'node:crypto'

const validRequestId = /^[A-Za-z0-9._:-]{8,128}$/

export function requestId(req, res, next) {
  const provided = req.get('X-Request-ID')
  req.id = provided && validRequestId.test(provided) ? provided : randomUUID()
  res.setHeader('X-Request-ID', req.id)
  next()
}
