import { createMapper } from '../common.mapper.js'
export const gradePoaMapper = createMapper((value) => value.metrics || {})
