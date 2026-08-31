export class ApiError extends Error {
  constructor(code, message, status = 500, details) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class PlatformError extends ApiError {
  constructor(platform, code, message, status = 502) {
    super(code, message, status)
    this.platform = platform
  }
}
