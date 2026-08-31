import type { Money } from '../types/models'

export const formatNumber = (value?: number|null, compact = false) => typeof value!=='number'||!Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-KE', { notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(value)
export const formatMoney = (money?: Money, compact = false) => money === undefined ? '—' : new Intl.NumberFormat('en-KE', { style: 'currency', currency: money.currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(money.amount)
export const formatPercent = (value?: number|null) => typeof value!=='number'||!Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
export const formatDate = (value?: string, withTime = false) => value ? new Intl.DateTimeFormat('en-KE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value)) : '—'
export const formatRelativeTime = (value?: string) => {
  if (!value) return 'Never'
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  const [unit, divisor]: [Intl.RelativeTimeFormatUnit, number] = abs < 60 ? ['second', 1] : abs < 3600 ? ['minute', 60] : abs < 86400 ? ['hour', 3600] : ['day', 86400]
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit)
}
export const currenciesMatch = (items: Array<Money | undefined>) => new Set(items.filter(Boolean).map((item) => item!.currency)).size <= 1
