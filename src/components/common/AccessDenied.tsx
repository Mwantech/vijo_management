import { ShieldAlert } from 'lucide-react'
export function AccessDenied(){return <div className="access-denied"><ShieldAlert size={32}/><h2>Access restricted</h2><p>Your administrator role does not have permission to view this area.</p></div>}
