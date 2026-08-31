import { createMapper } from '../common.mapper.js'
export const posMapper = createMapper((value) => value.metrics || {})
