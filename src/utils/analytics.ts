export const calculateGrowth = (current: number, previous: number): number | undefined => previous === 0 ? (current === 0 ? 0 : undefined) : ((current - previous) / previous) * 100
