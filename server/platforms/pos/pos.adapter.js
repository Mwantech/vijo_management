import { BasePlatformAdapter } from '../base.adapter.js'
import { posMapper } from './pos.mapper.js'
export class VijoPosAdapter extends BasePlatformAdapter { constructor(config) { super(config, posMapper) } }
