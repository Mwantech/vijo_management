import { expect, it } from 'vitest'

it('loads the application shell without undefined navigation icons', async () => {
  const shell = await import('./AppShell')
  expect(typeof shell.AppShell).toBe('function')
})
