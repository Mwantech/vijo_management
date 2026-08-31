import { randomBytes } from 'node:crypto'

const secret = () => randomBytes(48).toString('base64url')
const gatewayKey = secret()
const sessionSecret = secret()
const platforms = ['GRADEPOA', 'GOODSCENES', 'HMS', 'VIJOPOS'].map((name) => ({ name, key: secret(), hmac: secret() }))

const lines = [
  '# Vijo Management API environment',
  `MANAGEMENT_SESSION_SECRET=${sessionSecret}`,
  `MANAGEMENT_API_KEY=${gatewayKey}`,
  ...platforms.flatMap(({ name, key, hmac }) => [`${name}_MANAGEMENT_API_KEY=${key}`, `${name}_MANAGEMENT_API_SECRET=${hmac}`]),
  '',
  '# Copy each matching pair into that product backend environment:',
  ...platforms.flatMap(({ name, key, hmac }) => [
    `# ${name} backend`,
    `MANAGEMENT_API_KEY=${key}`,
    `MANAGEMENT_API_SECRET=${hmac}`,
  ]),
  '',
  '# Keep this output private. Do not commit it or place it in VITE_* variables.',
]

process.stdout.write(`${lines.join('\n')}\n`)
