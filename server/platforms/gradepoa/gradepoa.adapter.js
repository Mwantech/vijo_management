import { BasePlatformAdapter } from '../base.adapter.js'
import { gradePoaMapper } from './gradepoa.mapper.js'
export class GradePoaAdapter extends BasePlatformAdapter { constructor(config) { super(config, gradePoaMapper) } }
