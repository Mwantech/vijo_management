import { createMapper } from '../common.mapper.js'
export const hmsMapper = createMapper((value) => value.metrics || {})
