import { PLATFORM_IDS, platformConfig } from '../config/index.js'
import { ApiError } from '../errors.js'
import { GradePoaAdapter } from './gradepoa/gradepoa.adapter.js'
import { GoodScenesAdapter } from './goodscenes/goodscenes.adapter.js'
import { HmsAdapter } from './hms/hms.adapter.js'
import { VijoPosAdapter } from './pos/pos.adapter.js'

const registry = new Map([
  ['gradepoa', new GradePoaAdapter(platformConfig('gradepoa'))],
  ['goodscenes', new GoodScenesAdapter(platformConfig('goodscenes'))],
  ['hms', new HmsAdapter(platformConfig('hms'))],
  ['pos', new VijoPosAdapter(platformConfig('pos'))],
])

export const platformAdapters = Object.freeze(Object.fromEntries(registry))
export const allPlatformAdapters = () => PLATFORM_IDS.map((id) => registry.get(id)).filter((adapter) => adapter.config.enabled)
export const getPlatformAdapter = (id) => {
  const adapter = registry.get(id)
  if (!adapter || !adapter.config.enabled) throw new ApiError('INVALID_PLATFORM', 'The requested platform is not configured.', 404)
  return adapter
}
