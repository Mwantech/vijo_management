import type { PlatformId } from '../types/models'

export interface PlatformConfig { id: PlatformId; name: string; shortName: string; route: string; color: string; description: string }

export const platformRegistry: Record<PlatformId, PlatformConfig> = {
  gradepoa: { id: 'gradepoa', name: 'GradePoa', shortName: 'GP', route: '/platforms/gradepoa', color: '#00ED64', description: 'Learning and revision' },
  goodscenes: { id: 'goodscenes', name: 'GoodScenes', shortName: 'GS', route: '/platforms/goodscenes', color: '#3B82F6', description: 'Creator experiences' },
  hms: { id: 'hms', name: 'HMS', shortName: 'HM', route: '/platforms/hms', color: '#60A5FA', description: 'Hospital operations' },
  pos: { id: 'pos', name: 'VijoPOS', shortName: 'VP', route: '/platforms/pos', color: '#00C853', description: 'Merchant point of sale' },
}
export const platforms = Object.values(platformRegistry)
export const isPlatformId = (value: string): value is PlatformId => value in platformRegistry
export const getPlatform = (id: PlatformId) => platformRegistry[id]
