import { BasePlatformAdapter } from '../base.adapter.js'
import { goodScenesMapper } from './goodscenes.mapper.js'
export class GoodScenesAdapter extends BasePlatformAdapter { constructor(config) { super(config, goodScenesMapper) } }
