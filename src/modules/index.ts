import type { PlatformId } from '../types/models'
import type { PlatformModule } from './types'
import { gradePoaModule } from './gradepoa'
import { goodScenesModule } from './goodscenes'
import { hmsModule } from './hms'
import { posModule } from './pos'
export const platformModules={gradepoa:gradePoaModule,goodscenes:goodScenesModule,hms:hmsModule,pos:posModule} satisfies Record<PlatformId,PlatformModule>
