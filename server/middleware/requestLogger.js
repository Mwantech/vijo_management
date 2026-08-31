export function requestLogger(req, res, next) {
  const startedAt = performance.now()
  res.on('finish', () => {
    console.log(JSON.stringify({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId: req.id,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
      responseTimeMs: Math.round(performance.now() - startedAt),
    }))
  })
  next()
}
