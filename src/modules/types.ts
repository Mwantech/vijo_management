import type { PlatformId } from '../types/models'
export interface PlatformModule { platform: PlatformId; entityLabel: string; operationalScope: string; sensitiveDataExcluded?: string[] }
