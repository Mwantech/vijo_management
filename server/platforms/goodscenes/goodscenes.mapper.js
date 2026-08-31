import { createMapper } from '../common.mapper.js'
export const goodScenesMapper = createMapper((value) => value.metrics || {})
