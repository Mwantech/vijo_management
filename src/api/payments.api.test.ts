import { describe, it, expect } from 'vitest'
import { formatMinor } from './payments.api'
describe('payment display precision', () => {
  it('formats integer minor units without floating point', () => {
    expect(formatMinor('10000', 'KES')).toBe('KES 100.00')
    expect(formatMinor('1234', 'KWD')).toBe('KWD 1.234')
    expect(formatMinor('123', 'JPY')).toBe('JPY 123')
    expect(formatMinor('0', 'USD')).toBe('USD 0.00')
    expect(formatMinor('9999999999999999', 'USD')).toContain('.99')
    expect(formatMinor('12', 'XYZ')).toBe('XYZ 12 minor units')
    expect(formatMinor('invalid', 'USD')).toBe('—')
  })
})
