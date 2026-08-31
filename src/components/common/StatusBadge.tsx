import type { PaymentStatus, PlatformStatus, UserStatus } from '../../types/models'
export function StatusBadge({status}:{status:PlatformStatus|PaymentStatus|UserStatus|string}) { return <span className={`status status--${status}`}>{status.replace('_',' ')}</span> }
