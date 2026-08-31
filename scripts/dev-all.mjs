import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const commands = [
  ['api', 'node', ['server/index.js']],
  ['web', fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url)), ['--host', '127.0.0.1']],
]

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: 'pipe', env: process.env })
  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`))
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`))
  child.on('exit', (code) => {
    if (code) process.exitCode = code
  })
  return child
})

process.on('SIGINT', () => {
  children.forEach((child) => child.kill('SIGINT'))
})
