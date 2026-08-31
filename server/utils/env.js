import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const separator = trimmed.indexOf('=')
  if (separator === -1) return
  const key = trimmed.slice(0, separator).trim()
  let value = trimmed.slice(separator + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  if (key && process.env[key] === undefined) process.env[key] = value
}

export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    readFileSync(path, 'utf8').split(/\r?\n/).forEach(parseLine)
  }
}

loadEnv()
