import { ApiError } from '../errors.js'

export const validate = (schema, location = 'query') => (req, res, next) => {
  const result = schema.safeParse(req[location])
  if (!result.success) return next(new ApiError('VALIDATION_ERROR', 'The request parameters are invalid.', 400, result.error.flatten()))
  if (location === 'query') req.validatedQuery = result.data
  else if (location === 'params') req.validatedParams = result.data
  else req.body = result.data
  next()
}
