import type { ReactNode } from 'react'
import { useAuth, type Permission } from '../../context/AuthContext'
import { AccessDenied } from './AccessDenied'
export function ProtectedRoute({permission,children}:{permission:Permission;children:ReactNode}){return useAuth().can(permission)?children:<AccessDenied/>}
