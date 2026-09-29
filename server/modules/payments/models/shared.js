import mongoose from 'mongoose'

export const { Schema } = mongoose
export const required = type => ({ type, required: true })
export const ref = () => required(Schema.Types.ObjectId)
export const money = () => ({ type: Schema.Types.Decimal128, required: true, validate: v => /^\d+$/.test(v.toString()) && BigInt(v.toString()) <= 9999999999999999n })
export const enumOf = values => ({ type: String, enum: values, required: true })
export const lease = { leaseToken: String, leaseUntil: Date, nextRunAt: { type: Date, default: Date.now }, count: { type: Number, default: 0 }, lastError: String }
export const environment = enumOf(['development', 'test', 'production'])
export const common = { environment, schemaVersion: { type: Number, default: 1 } }
export const options = { timestamps: true, strict: 'throw', autoIndex: false, autoCreate: false, bufferCommands: false }
