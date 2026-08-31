import { BasePlatformAdapter } from '../base.adapter.js'
import { hmsMapper } from './hms.mapper.js'
export class HmsAdapter extends BasePlatformAdapter { constructor(config) { super(config, hmsMapper) } }
