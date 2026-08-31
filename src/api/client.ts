import type { ApiErrorPayload } from '../types/models'

export class ApiError extends Error { constructor(message: string, public status: number, public payload?: ApiErrorPayload) { super(message); this.name = 'ApiError' } }
const BASE_URL = (import.meta.env.VITE_MANAGEMENT_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const hasManagementApiUrl = Boolean(BASE_URL)
export const apiModeLabel = hasManagementApiUrl ? 'Connected' : 'Via proxy'

type Query = Record<string, string | number | boolean | undefined>
export const toQueryString = (query?: Query) => {
  const params = new URLSearchParams()
  Object.entries(query ?? {}).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
  const serialized = params.toString(); return serialized ? `?${serialized}` : ''
}
export async function apiRequest<T>(path: string, options: RequestInit = {}, query?: Query): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}${toQueryString(query)}`, { ...options, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers } })
  if (!response.ok) { let payload: ApiErrorPayload | undefined; try { const body=await response.json() as {error?:ApiErrorPayload}&ApiErrorPayload;payload=body.error??body } catch { /* non-json error */ } throw new ApiError(payload?.message ?? `Request failed (${response.status})`, response.status, payload) }
  if (response.status === 204) return undefined as T
  const body=await response.json() as {success?:boolean;data?:unknown;pagination?:Record<string,unknown>}
  if(body.success===true){
    if(Array.isArray(body.data)&&body.pagination)return {data:body.data,meta:body.pagination,lastUpdatedAt:body.pagination.lastUpdatedAt} as T
    return body.data as T
  }
  return body as T
}
