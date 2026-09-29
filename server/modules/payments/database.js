import mongoose from 'mongoose'
import { createModels } from './models/index.js'
import { fail } from './domain.js'

export async function connectPayments(config) {
  const connection = await mongoose.createConnection(config.uri, {
    dbName: config.dbName, maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000, bufferCommands: false, autoIndex: false, autoCreate: false,
  }).asPromise()
  try {
    const hello = await connection.db.admin().command({ hello: 1 })
    if ((!hello.setName && hello.msg !== 'isdbgrid') || hello.logicalSessionTimeoutMinutes == null) fail('TRANSACTIONS_REQUIRED', 'Payment database must support transactions.', 503)
    return { connection, models: createModels(connection) }
  } catch (error) { await connection.close(); throw error }
}

export async function setupDatabase({ connection, models }) {
  for (const model of Object.values(models)) {
    const required = Object.entries(model.schema.paths).filter(([, p]) => p.isRequired).map(([name]) => name)
    const properties = { environment: { enum: ['development', 'test', 'production'] } }
    for (const [name, path] of Object.entries(model.schema.paths)) {
      if (path.instance === 'Decimal128') properties[name] = { bsonType: 'decimal', minimum: mongoose.Types.Decimal128.fromString('0'), maximum: mongoose.Types.Decimal128.fromString('9999999999999999') }
      else if (path.enumValues?.length) properties[name] = { enum: path.enumValues }
      else if (['String', 'Date', 'ObjectId'].includes(path.instance)) properties[name] = { bsonType: { String: 'string', Date: 'date', ObjectId: 'objectId' }[path.instance] }
    }
    const moneyFields = Object.entries(model.schema.paths).filter(([, p]) => p.instance === 'Decimal128').map(([n]) => ({ [n]: { $mod: [1, 0] } }))
    const validator = { $and: [{ $jsonSchema: { bsonType: 'object', required, properties } }, ...moneyFields] }
    const name = model.collection.name
    if ((await connection.db.listCollections({ name }).toArray()).length) await connection.db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' })
    else await connection.db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' })
    await model.createIndexes()
  }
}
export async function checkIndexes(models) {
  for (const model of Object.values(models)) {
    const indexes = await model.collection.indexes()
    for (const [key, opts] of model.schema.indexes()) {
      if (!indexes.some(i => JSON.stringify(i.key) === JSON.stringify(key) && Boolean(i.unique) === Boolean(opts.unique) && Boolean(i.sparse) === Boolean(opts.sparse) && i.expireAfterSeconds === opts.expireAfterSeconds && JSON.stringify(i.partialFilterExpression) === JSON.stringify(opts.partialFilterExpression))) fail('PAYMENTS_INDEXES_MISSING', 'Run payments:setup before enabling payments.', 503)
    }
  }
}
export const transaction = (connection, callback) => connection.transaction(callback, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' })
