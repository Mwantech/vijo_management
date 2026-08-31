import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoginPage } from '../pages/LoginPage'
import { apiRequest } from '../api/client'
import { SectionLoading } from '../components/common/SectionState'
import type { AdminRole } from '../types/models'

export type Permission = 'analytics:view'|'users:view'|'revenue:view'|'activity:view'|'system:view'|'settings:manage'
interface Admin { id:string;name:string;email:string;role:AdminRole }
interface AuthContextValue { user:Admin; can:(permission:Permission)=>boolean; logout:()=>Promise<void> }
const permissions: Record<AdminRole,Permission[]> = {
  super_admin:['analytics:view','users:view','revenue:view','activity:view','system:view','settings:manage'],
  admin:['analytics:view','users:view','revenue:view','activity:view','system:view'],
  finance:['revenue:view'],
  support:['users:view','activity:view'],
  viewer:['analytics:view','activity:view','system:view'],
}
const Context=createContext<AuthContextValue|undefined>(undefined)
const isRole=(role:string):role is AdminRole=>['super_admin','admin','finance','support','viewer'].includes(role)
const normalizeAdmin=(value:unknown):Admin|undefined=>{
  if(!value||typeof value!=='object')return undefined
  const user=(value as {user?:unknown}).user
  if(!user||typeof user!=='object')return undefined
  const record=user as Record<string,unknown>
  if(typeof record.id!=='string'||typeof record.email!=='string'||typeof record.role!=='string'||!isRole(record.role))return undefined
  return {id:record.id,name:typeof record.name==='string'?record.name:record.email,email:record.email,role:record.role}
}

export function AuthProvider({children}:{children:ReactNode}) {
  const[user,setUser]=useState<Admin>()
  const[loading,setLoading]=useState(true)
  const[error,setError]=useState<string>()
  useEffect(()=>{let active=true;apiRequest<unknown>('/api/management/auth/me').then((value)=>{if(active)setUser(normalizeAdmin(value))}).catch(()=>undefined).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  const login=async(email:string,password:string)=>{setError(undefined);const value=await apiRequest<unknown>('/api/management/auth/login',{method:'POST',body:JSON.stringify({email,password})});const admin=normalizeAdmin(value);if(!admin)throw new Error('Invalid management auth response');setUser(admin)}
  const logout=useCallback(async()=>{await apiRequest<void>('/api/management/auth/logout',{method:'POST'}).catch(()=>undefined);setUser(undefined)},[])
  const context=useMemo<AuthContextValue|undefined>(()=>user?{user,can:(permission)=>permissions[user.role].includes(permission),logout}:undefined,[user,logout])
  if(loading)return <div className="auth-shell"><SectionLoading rows={5}/></div>
  if(!context)return <LoginPage onLogin={login} error={error} setError={setError}/>
  return <Context.Provider value={context}>{children}</Context.Provider>
}

export const useAuth=()=>{const value=useContext(Context);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value}
