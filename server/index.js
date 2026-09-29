import './utils/env.js'
import { createManagementApp } from './app.js'
import { assertProductionConfig, managementConfig } from './config/index.js'
import { initializePayments } from './modules/payments/index.js'

assertProductionConfig()

const payments = await initializePayments()
const app = createManagementApp({ payments })
const server = app.listen(managementConfig.port, managementConfig.host, () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'server_started',
    service: 'vijo-management-api',
    address: `http://${managementConfig.host}:${managementConfig.port}`,
  }))
})

const shutdown = (signal) => {
  console.log(JSON.stringify({ level: 'info', event: 'server_stopping', signal }))
  server.close(async () => { await payments.close(); process.exit(0) })
  setTimeout(() => process.exit(1), 30_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, server }
