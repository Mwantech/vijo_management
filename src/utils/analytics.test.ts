import {describe,expect,it} from 'vitest'
import {calculateGrowth} from './analytics'
describe('calculateGrowth',()=>{it('calculates positive and negative growth',()=>{expect(calculateGrowth(120,100)).toBe(20);expect(calculateGrowth(75,100)).toBe(-25)});it('does not misrepresent growth from a zero baseline',()=>{expect(calculateGrowth(10,0)).toBeUndefined();expect(calculateGrowth(0,0)).toBe(0)})})
