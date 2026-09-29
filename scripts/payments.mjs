import '../server/utils/env.js'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { paymentConfig } from '../server/modules/payments/config.js'
import { connectPayments, setupDatabase, checkIndexes, transaction } from '../server/modules/payments/database.js'
import { id, digest, fail, parse, amountSchema, exponents } from '../server/modules/payments/domain.js'
import { encrypt } from '../server/modules/payments/crypto.js'
import { resolveDestination, webhookURL } from '../server/modules/payments/webhooks.js'
import { audit } from '../server/modules/payments/services/events.js'
import { PLATFORM_IDS } from '../server/config/index.js'
import { paymentPlatformCredentials } from '../server/modules/payments/managementAuth.js'

const [command, argument, platformArgument] = process.argv.slice(2)
const config = paymentConfig()
if (!config.enabled) throw new Error('Set PAYMENTS_ENABLED=true for payment administration.')
const ctx = { config, ...await connectPayments(config) }
try {
  if (command === 'setup') {
    await setupDatabase(ctx)
    console.log('Payment collections, validators and indexes are ready.')
  } else {
    await checkIndexes(ctx.models)
    if (command === 'create') {
      if (!argument) throw new Error('Usage: pnpm payments:application create /path/to/application.json')
      const input = parse(z.object({ name: z.string().min(1).max(100), currencies: z.array(z.enum(Object.keys(exponents))).min(1), maxAmount: amountSchema,
        managementPlatform: z.enum(PLATFORM_IDS).optional(),
        productId: z.string().regex(/^prod_[A-Za-z0-9]+$/), returnUrl: z.string().url(), webhookUrl: z.string().url().optional(),
        scopes: z.array(z.enum(['payments:create', 'payments:read', 'transactions:read', 'refunds:create', 'refunds:read'])).min(1),
      }).strict(), JSON.parse(await readFile(argument, 'utf8')))
      if (input.webhookUrl) await resolveDestination(input.webhookUrl)
      if (input.managementPlatform) paymentPlatformCredentials(input.managementPlatform)
      webhookURL(input.returnUrl)
      const apiKey = `sk_${randomBytes(32).toString('base64url')}`, webhookSecret = `whsec_${randomBytes(32).toString('base64url')}`, applicationId = id('app'), clientId = id('client')
      await transaction(ctx.connection, async session => {
        await ctx.models.Application.create([{ applicationId, clientId, name: input.name, currencies: input.currencies, maxAmount: input.maxAmount,
          productId: input.productId, returnUrl: input.returnUrl, scopes: input.scopes, status: 'ACTIVE', environment: config.environment,
          ...(input.managementPlatform ? { managementPlatform: input.managementPlatform } : {}),
          credentials: input.managementPlatform ? [] : [{ credentialId: id('key'), secretHash: digest(apiKey), createdAt: new Date() }],
          webhook: input.webhookUrl ? { url: input.webhookUrl, enabled: true, keyId: id('key'), encryptedSecret: encrypt(webhookSecret, config.encryptionKey), version: 1 } : { enabled: false, version: 1 },
        }], { session })
        await audit(ctx, 'operator-cli', 'APPLICATION_CREATED', applicationId, undefined, session)
      })
      console.log(JSON.stringify({ applicationId, ...(input.managementPlatform ? { managementPlatform: input.managementPlatform, note: 'Uses existing platform management credentials.' } : { clientId, apiKey, note: 'Shown once. Store in the product backend secret store.' }), ...(input.webhookUrl ? { webhookSecret } : {}) }, null, 2))
    } else if (['rotate', 'disable', 'revoke', 'replay', 'pull', 'bind-management'].includes(command)) {
      if (command === 'replay') {
        await transaction(ctx.connection, async session => {
          const delivery = await ctx.models.Delivery.findOneAndUpdate({ deliveryId: argument, status: { $in: ['DEAD', 'PAUSED'] } }, { $set: { status: 'RETRY', nextRunAt: new Date() } }, { session, new: true })
          if (!delivery) fail('NOT_FOUND', 'No failed delivery found.', 404)
          await audit(ctx, 'operator-cli', 'WEBHOOK_REPLAYED', argument, undefined, session)
        })
        console.log('Delivery scheduled; original event ID preserved.')
      } else {
        const apiKey = command === 'rotate' ? `sk_${randomBytes(32).toString('base64url')}` : undefined
        await transaction(ctx.connection, async session => {
          const app = await ctx.models.Application.findOne({ applicationId: argument }).session(session)
          if (!app) fail('NOT_FOUND', 'Application not found.', 404)
          if (command === 'bind-management') {
            const platform = parse(z.enum(PLATFORM_IDS), platformArgument)
            paymentPlatformCredentials(platform)
            if (app.managementPlatform && app.managementPlatform !== platform) fail('APPLICATION_ALREADY_BOUND', 'Cannot reassign a platform payment application.')
            app.managementPlatform = platform
            app.credentials = []
          }
          else if (command === 'pull') app.webhook = { enabled: false, version: (app.webhook?.version || 0) + 1 }
          else if (command === 'rotate') app.credentials = [
            ...app.credentials.filter(c => !c.revokedAt && (!c.expiresAt || c.expiresAt > new Date())).slice(-1).map(c => ({ ...c.toObject(), expiresAt: new Date(Date.now() + 86400000) })),
            { credentialId: id('key'), secretHash: digest(apiKey), createdAt: new Date() },
          ]
          else app.status = command === 'revoke' ? 'REVOKED' : 'DISABLED'
          if (command === 'rotate' && app.managementPlatform) fail('MANAGEMENT_CREDENTIALS_REQUIRED', 'Rotate management credentials on both servers instead.')
          await app.save({ session })
          await audit(ctx, 'operator-cli', `APPLICATION_${command.toUpperCase()}`, argument, undefined, session)
        })
        console.log(apiKey ? JSON.stringify({ apiKey, note: 'Previous key expires in 24 hours.' }) : command === 'bind-management' ? 'Application bound to platform management credentials; old payment keys revoked.' : command === 'pull' ? 'Application now uses status queries; outbound webhooks disabled.' : 'Application access disabled.')
      }
    } else throw new Error('Commands: create <config.json>, bind-management <app_id> <platform>, rotate <app_id>, disable <app_id>, revoke <app_id>, pull <app_id>, replay <dlv_id>')
  }
} catch (error) {
  // Mongo/provider errors can contain connection strings or document contents.
  console.error(error.code && typeof error.code === 'string' ? error.code : 'PAYMENT_ADMINISTRATION_FAILED')
  process.exitCode = 1
} finally { await ctx.connection.close() }
