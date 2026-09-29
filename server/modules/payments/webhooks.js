import https from 'node:https'
import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { decrypt, signature } from './crypto.js'
import { fail } from './domain.js'

export function webhookURL(value) {
  let url
  try { url = new URL(value) } catch { fail('UNSAFE_WEBHOOK_URL', 'Webhook URL must be HTTPS.', 400) }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || url.search || url.hostname === 'localhost') fail('UNSAFE_WEBHOOK_URL', 'Only public HTTPS webhook URLs without credentials or query strings are allowed.', 400)
  return url
}
export function publicAddress(address) {
  try { const ip = ipaddr.process(address); return ip.range() === 'unicast' } catch { return false }
}
export async function resolveDestination(value, resolver = lookup) {
  const url = webhookURL(value)
  const addresses = await resolver(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) fail('UNSAFE_WEBHOOK_URL', 'Webhook destination is not a public network address.', 400)
  return { url, address: addresses[0] }
}
export async function deliver(ctx, app, event) {
  const { url, address } = await resolveDestination(app.webhook.url)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const secret = decrypt(app.webhook.encryptedSecret, ctx.config.encryptionKey)
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(event.body),
    'X-Vijo-Event-ID': event.eventId, 'X-Vijo-Timestamp': timestamp, 'X-Vijo-Key-ID': app.webhook.keyId,
    'X-Vijo-Signature': `v1=${signature(secret, event.eventId, timestamp, event.body)}` }
  return new Promise((resolve, reject) => {
    // Pin DNS to the checked public address. TLS still authenticates the original hostname.
    const req = https.request(url, { method: 'POST', agent: false, headers,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, res => { const status = res.statusCode; res.destroy(); resolve(status) })
    const timer = setTimeout(() => req.destroy(new Error('WEBHOOK_TIMEOUT')), 5000)
    req.on('close', () => clearTimeout(timer)); req.on('error', () => reject(new Error('WEBHOOK_CONNECTION_FAILED')))
    req.end(event.body)
  })
}
