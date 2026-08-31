import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { getDateRange, type DatePreset } from '../utils/dateRanges'
import type { DateRange } from '../types/models'
interface Value { preset: DatePreset; range: DateRange; setPreset: (preset: DatePreset) => void; setCustomRange: (from: string, to: string) => void }
const Context = createContext<Value | null>(null)
export function DateRangeProvider({ children }: { children: ReactNode }) { const [preset,setPresetState]=useState<DatePreset>('30d'); const [custom,setCustom]=useState<{from:string;to:string}>(); const value=useMemo(()=>({ preset,range:getDateRange(preset,new Date(),custom),setPreset:(next:DatePreset)=>setPresetState(next),setCustomRange:(from:string,to:string)=>{setCustom({from,to});setPresetState('custom')} }),[preset,custom]); return <Context.Provider value={value}>{children}</Context.Provider> }
export const useDateRange = () => { const value=useContext(Context); if(!value)throw new Error('useDateRange must be used within DateRangeProvider');return value }
