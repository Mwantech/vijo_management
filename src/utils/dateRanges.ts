import type { DateRange } from '../types/models'
export type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | '3m' | 'year' | 'custom'
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
export function getDateRange(preset: DatePreset, now = new Date(), custom?: { from: string; to: string }): DateRange {
  const today = startOfDay(now); let from = today; let to = today; let label = 'Today'; let comparisonLabel = 'vs yesterday'
  if (preset === 'yesterday') { from = to = addDays(today, -1); label = 'Yesterday'; comparisonLabel = 'vs previous day' }
  if (preset === '7d') { from = addDays(today, -6); label = 'Last 7 days'; comparisonLabel = 'vs previous 7 days' }
  if (preset === '30d') { from = addDays(today, -29); label = 'Last 30 days'; comparisonLabel = 'vs previous 30 days' }
  if (preset === 'this_month') { from = new Date(today.getFullYear(), today.getMonth(), 1); label = 'This month'; comparisonLabel = 'vs last month' }
  if (preset === 'last_month') { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0); label = 'Last month'; comparisonLabel = 'vs previous month' }
  if (preset === '3m') { from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate() + 1); label = 'Last 3 months'; comparisonLabel = 'vs previous 3 months' }
  if (preset === 'year') { from = new Date(today.getFullYear(), 0, 1); label = 'This year'; comparisonLabel = 'vs last year' }
  if (preset === 'custom' && custom) { return { ...custom, label: `${custom.from} – ${custom.to}`, comparisonLabel: 'vs previous equivalent period' } }
  return { from: iso(from), to: iso(to), label, comparisonLabel }
}
