import { required, enumOf } from './shared.js'

export default ['applications', {
      applicationId: required(String), name: required(String), clientId: required(String),
      managementPlatform: { type: String, enum: ['gradepoa', 'goodscenes', 'hms', 'pos'] },
      status: enumOf(['ACTIVE', 'DISABLED', 'REVOKED']), scopes: [String], currencies: [String],
      maxAmount: required(String), productId: required(String), returnUrl: required(String),
      credentials: [{ credentialId: String, secretHash: String, expiresAt: Date, revokedAt: Date, createdAt: Date }],
      webhook: { url: String, enabled: Boolean, keyId: String, encryptedSecret: String, version: Number }, lastUsedAt: Date,
    }, [[{ applicationId: 1 }, { unique: true }], [{ clientId: 1 }, { unique: true }], [{ managementPlatform: 1 }, { unique: true, sparse: true }]]]
