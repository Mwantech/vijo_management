import {describe,expect,it} from 'vitest'
import {getDateRange} from './dateRanges'
describe('getDateRange',()=>{const now=new Date(2026,7,31,12);it('calculates an inclusive last seven days range',()=>{expect(getDateRange('7d',now)).toMatchObject({from:'2026-08-25',to:'2026-08-31',comparisonLabel:'vs previous 7 days'})});it('calculates calendar month boundaries',()=>{expect(getDateRange('last_month',now)).toMatchObject({from:'2026-07-01',to:'2026-07-31'})});it('preserves custom ranges',()=>{expect(getDateRange('custom',now,{from:'2026-01-05',to:'2026-01-19'}).from).toBe('2026-01-05')})})
