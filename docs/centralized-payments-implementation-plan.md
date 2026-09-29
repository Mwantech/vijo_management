# Centralized card payments inside VijoManagement

Status: proposed implementation plan; approval required before implementation.
Reviewed: 2026-09-27. Repository: `vijo-manage/vijo-management`, local HEAD `23b7f08`.

This document is the only proposed deliverable change. No application code, dependencies, environment values, databases, provider resources, or deployments are changed by this review.

## 1. Existing architecture analysis

### OBSERVED IN REPOSITORY

| Area | Evidence and present behavior |
| --- | --- |
| Runtime/framework | Root `package.json`: Node.js, Express `^5.1.0`, ESM JavaScript (`type: module`). Backend is `server/`, not `src/`; `src/` contains the React/TypeScript frontend. No Python backend exists in this application. |
| Entry point | `server/index.js` loads `server/utils/env.js`, validates production configuration, constructs the Express application, and listens. Shutdown closes HTTP with a 10-second deadline. There is currently no database/worker lifecycle. |
| Application wiring | `server/app.js`: request ID, Helmet, CORS, global JSON parser, in-memory rate limiting, request logging, `/api/health`, management routes, static frontend, SPA fallback, not-found and error middleware. |
| MongoDB/Mongoose | Neither `mongoose` nor `mongodb` is a declared dependency. No Mongo connection initialization, model layer, Mongo repositories, migrations, or Mongo tests were found in `server/`. A local `.env` contains `MONGODB_URI`; its value has an SRV scheme and explicit database path. The code does not consume it. No `PAYMENTS_MONGODB_URI` is present locally. Credentials/hostnames were not copied into this document. |
| Main database | There is no implemented primary VijoManagement database connection to reuse. An environment variable alone is not a connection strategy. The sibling `vijo-manage/api` contains no implementation files found by the inspection. |
| Browser authentication | `server/middleware/auth.js`: environment-configured administrator, bcrypt password verification, HMAC-signed HTTP-only session cookie. Roles: super_admin, admin, finance, support, viewer. No persisted administrator model or revocable session store. |
| Service authentication | The same middleware accepts a single global `VIJO_MANAGEMENT_API_KEY` (legacy fallback supported), yielding `super_admin`. Product outbound credentials are independently configured. This is not suitable for tenant-scoped payment applications. |
| Routing | `server/routes/management.routes.js` owns `/api/management/*`; authentication and role checks wrap analytics/users/revenue/etc. Payment processing routes do not exist. |
| Controllers/services | `server/controllers/management.controller.js` delegates to `server/services/aggregation.service.js`; adapters under `server/platforms/` normalize product data. This code reads analytics; it does not own provider charges. |
| Provider-style HTTP | `server/services/http/platformClient.js` supports signed GET requests, timeouts, bounded retries, and structured upstream errors. Its authentication, response normalization, and retry assumptions are specific to product analytics. |
| Validation | Zod `^3.24.1`, `server/middleware/validate.js`, `server/validation/queries.js`; query/parameter DTOs are separated from raw requests. Strict login body schema already exists. |
| Errors | `server/errors.js` defines `ApiError` and `PlatformError`. `server/middleware/errors.js` returns `{success:false,error,requestId}` and hides unknown errors in production, but logs arbitrary `error.message`. Non-ApiError HTTP parser/CORS errors currently become generic 500 errors. |
| Logging/audit | JSON console logs in request logging, HTTP client, and `server/services/audit.service.js`. Request IDs are validated or generated. Audit records are logs, not durable database records. |
| Cache/jobs | `server/services/cache.service.js` uses process-local Maps with TTL and single-flight behavior. No Redis, BullMQ, persistent queue, or scheduler. |
| Tests | Vitest, Supertest; `server/management.integration.test.js`, platform HTTP/registry tests, frontend parser/date tests. External APIs are stubbed in tests. Existing SPA integration test expects built `dist/`. No Mongo transaction tests. |
| Deployment | `render.yaml`: one Node web service; install/build with pnpm, start `node server/index.js`, health path `/api/health`, static frontend from `dist/`. No worker service declared. |
| Configuration | `server/config/index.js` reads environment configuration. `server/utils/env.js` loads `.env.local` then `.env` without overriding existing process variables. `.env.example` and `.env.production.example` document gateway credentials. No Whop or payments configuration. |

### What was not verified

No production Render environment, live MongoDB topology, Whop account capabilities, merchant onboarding, or actual payment-provider credentials were inspected. The configured local SRV URI does **not** prove that the intended payment database supports transactions. There is no configured payment database to test yet. Local working tree was clean before this document.

### RECOMMENDED

Retain Express, ESM JavaScript, Zod, the existing response envelope, logging style, Vitest/Supertest, and single Render service. Add Mongoose specifically for an isolated payment connection. Use JSDoc contracts for backend types; a backend TypeScript migration is unnecessary. Keep existing analytics integration adapters unchanged.

## 2. Proposed payment architecture

```text
Product frontend → Product backend → Application-authenticated payment routes
                                          │
                                   Payment orchestration
                                      │          │
                               Payment MongoDB   Whop adapter → Whop checkout
                                      │                           │
                               Durable work/inbox ← Verified provider webhook
                                      │
                           Payment + transaction + event commit
                                      │
                            Durable application webhook worker
                                      │
                               Product backend → Product business action
```

The payment module owns payments, attempts, provider references, verification, refunds, transaction records, events, delivery jobs, and reconciliation evidence. Product backends own price/order authorization and fulfillment. No POS, GradePoa, Medix, or other product-specific fulfillment function belongs in this module.

Recommended initial scope: one-time card payments through Whop, exact agreed currency and amount, provider-hosted checkout if its order-level charge controls pass the feasibility gate below. No subscriptions, saved-card charging, split settlement, marketplace payouts, M-Pesa, or bank rails in this release. A one-time payment may purchase a product subscription, but activating it remains the product's responsibility.

Components:

- HTTP controllers: parse validated DTOs, invoke services, return sanitized public DTOs.
- Application authentication: resolve the application and scopes from credentials.
- Domain services: payment state machine, money, idempotency, verification, refund reservations.
- Repositories: tenant-scoped explicit Mongo queries, sessions, conditional writes.
- Provider registry: select a configured provider by application policy and method, never by arbitrary client URL.
- Whop adapter: checkout creation, exact money conversion, status retrieval, webhook verification, refund requests and capability reporting.
- Mongo inbox/outbox and workers: recoverable provider work, incoming events, verification and outgoing delivery.
- Readiness/observability: separate database, provider and webhook-delivery indicators.

Assumption requiring approval: initially one Whop merchant account accepts payments for Vijo-owned products. If POS/Medix customers are themselves merchants collecting from unrelated customers, a connected-account/merchant ownership design is required before rollout. `applications` is an integration boundary, not a substitute for merchant settlement ownership. Do not quietly collect third-party merchant revenue into one Vijo account.

## 3. MongoDB connection architecture

### Proposed connection ownership

Add `server/modules/payments/db/connection.js`. Create one dedicated connection per process with `mongoose.createConnection(PAYMENTS_MONGODB_URI, options).asPromise()`. Do not call `mongoose.connect()` for payment models and do not use the default `mongoose.model()` registry.

`models/index.js` accepts the payment connection and compiles every schema through `connection.model(modelName, schema, explicitCollectionName)`. Inject the resulting model bundle into repositories. Check `connection.models` when reusing a connection in tests; do not export process-global compiled payment models. Sessions come from this same connection and every transaction operation receives that session explicitly.

No main connection is introduced simply because `MONGODB_URI` exists. If a main connection is added later, it must be independently owned; payment models must remain bound to the payment connection. Separate credentials limited to the payment database enforce isolation even on the same Mongo cluster. Reject payment configuration that resolves to the main database on the same cluster. Explicit database names must match the configured environment. See [Mongoose connection-specific models](https://mongoosejs.com/docs/connections.html).

Connection policy: disable command buffering, bound server selection/connect timeouts, start with a modest pool (e.g. maximum 10, minimum 0 per process), TLS in hosted environments, majority writes for critical persistence. Limit worker concurrency against the pool. Use `autoIndex:false`/`autoCreate:false` in production; explicit setup scripts create collections, validators and indexes before routes become ready. Avoid `syncIndexes()` automatically deleting indexes at startup.

Startup: when payments are disabled, existing gateway startup is unchanged. When enabled, initialize the payment context and verify readiness before accepting new payment operations; a database failure should expose payments as unavailable while management analytics can remain available. Invalid payment configuration blocks enabling the module. Payments return 503 until ready; no buffering of charges in process memory. Whop credential availability is checked separately from transient provider health.

Shutdown: stop accepting new payment work, stop claiming jobs, drain bounded in-flight operations, release/expire leases, close payment connection, then complete existing HTTP shutdown. No unawaited background payment mutations.

### Transaction support verification

Required before enabling writes:

1. Provision the intended `nexvijo_payments_<environment>` database and restricted database user.
2. Run a read-only `hello` against that connection; inspect replica-set `setName` or sharded `msg:isdbgrid`, session support and server compatibility. Log capability booleans, not the URI.
3. In an isolated deployment-check collection, run a controlled transaction smoke test with rollback, then verify no committed document remains. This is a future setup action, not performed during this planning review.
4. Refuse payment-write readiness if transactions are unavailable. A local standalone Mongo process must become a replica set for development/testing; do not downgrade financial guarantees.

MongoDB supports multi-document transactions on replica sets and sharded clusters, not standalone deployments. All payment transactional data remains in the payment database; there is no cross-product transaction. See [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/).

### Proposed environment variables

```dotenv
# Existing, currently unused by the gateway: leave its value unchanged.
MONGODB_URI=<main-application-uri-if-needed>

PAYMENTS_ENABLED=false
PAYMENTS_ENVIRONMENT=development
PAYMENTS_MONGODB_URI=<dedicated-payment-database-uri>
PAYMENTS_MONGODB_DB_NAME=nexvijo_payments_dev
PAYMENTS_MONGODB_MAX_POOL_SIZE=10
PAYMENTS_MONGODB_SERVER_SELECTION_TIMEOUT_MS=5000
PAYMENTS_PUBLIC_BASE_URL=https://<management-host>
PAYMENTS_WORKER_ENABLED=true
PAYMENTS_WORKER_POLL_MS=2000
PAYMENTS_WORKER_CONCURRENCY=4
PAYMENTS_JOB_LEASE_MS=60000
PAYMENTS_PROVIDER_TIMEOUT_MS=8000
PAYMENTS_WEBHOOK_TIMEOUT_MS=5000
PAYMENTS_ENCRYPTION_ACTIVE_KEY_ID=<key-version>
PAYMENTS_ENCRYPTION_KEYS_JSON=<server-only-versioned-encryption-key-map>
PAYMENTS_REFUNDS_ENABLED=false

WHOP_ENVIRONMENT=sandbox
WHOP_API_KEY=<server-only-account-key>
WHOP_ACCOUNT_ID=<approved-account-id>
WHOP_API_VERSION_DATE=<supported-version-tested-and-pinned>
WHOP_WEBHOOK_SECRET=<provider-signing-secret>
WHOP_WEBHOOK_PREVIOUS_SECRET=<optional-short-rotation-overlap>
```

These are proposals, not variables already supported by code. Avoid arbitrary provider base URLs: derive sandbox/production endpoints from an enum. Per-application limits, currencies, product mappings, callback URLs and scopes belong in controlled application configuration.

Use separate deployment services/secrets/database users for development, test/staging and production, with databases `nexvijo_payments_dev`, `nexvijo_payments_test`, `nexvijo_payments_prod`. Store `environment` in documents as an additional guard, not the primary isolation mechanism. Separate Whop accounts/keys/webhook registrations and application credentials; never select live/test mode using a payment request field. Whop documents a separate sandbox API host and sandbox card testing; its Elements sandbox currently has documented limitations. Validate the selected integration in the sandbox rather than assuming all examples are available. [Whop sandbox](https://docs.whop.com/developer/guides/sandbox)

## 4. Directory and file plan

All paths below are relative to `vijo-manage/vijo-management/`. These are files to create/modify after approval, not changes made by this plan.

### Files to create

| Path | Purpose |
| --- | --- |
| `server/modules/payments/index.js` | Build injected payment context; attach routes; start/stop module. |
| `server/modules/payments/config.js` | Strict Zod payment environment configuration and environment invariants. |
| `server/modules/payments/db/connection.js` | Dedicated connection, topology check, lifecycle. |
| `server/modules/payments/db/indexes.js`, `db/validators.js` | Explicit collection validators/index definitions and readiness verification. |
| `server/modules/payments/models/{application,payment,paymentAttempt,transaction,paymentEvent,webhookDelivery,webhookDeliveryAttempt,idempotencyKey,providerEvent,providerJob,refund,auditEvent}.model.js` | Schemas for the collections defined below. |
| `server/modules/payments/models/index.js` | Bind schema factories only to the supplied payment connection. |
| `server/modules/payments/repositories/{application,payment,attempt,transaction,event,delivery,idempotency,providerEvent,providerJob,refund,audit}.repository.js` | Explicit projections, tenant-scoped queries, session-bound writes, atomic job claims. |
| `server/modules/payments/domain/{money,stateMachine,identifiers}.js` | Integer money conversion, transitions and opaque public identifiers. |
| `server/modules/payments/types/contracts.js` | JSDoc DTO/provider/job definitions. |
| `server/modules/payments/validators/{payment,refund,query,application,providerEvent}.schema.js` | Strict request, config and normalized-provider schemas. |
| `server/modules/payments/middleware/{applicationAuth,scopes,paymentErrors,rateLimits}.js` | Payment-only credential checks, scopes, sanitized errors and quotas. |
| `server/modules/payments/routes/{payments,transactions,providerWebhooks,health}.routes.js` | `/api/v1` payment routes; webhook raw-body route separate from JSON routes. |
| `server/modules/payments/controllers/{payment,transaction,providerWebhook,health}.controller.js` | HTTP boundary and explicit public projections. |
| `server/modules/payments/services/{payment,idempotency,verification,refund,event,application,health,audit}.service.js` | Domain orchestration and durable invariants. |
| `server/modules/payments/providers/{registry,provider.contract,httpClient}.js` | Provider selection, capabilities and bounded request policy. |
| `server/modules/payments/providers/whop/{whop.adapter,whop.mapper,whop.schemas,whop.webhook}.js` | Isolated Whop integration and signature verification. |
| `server/modules/payments/webhooks/{signing,destinationPolicy,delivery}.js` | Application HMAC signatures, SSRF-resistant destinations, HTTP delivery. |
| `server/modules/payments/workers/{runner,providerJobs,providerInbox,webhookDelivery,reconciliation}.js` | Mongo-backed leased work with bounded polling and recovery. |
| `server/modules/payments/utils/{canonicalJson,encryption,redaction}.js` | Stable request fingerprints, encrypted signing secrets, allowlisted logs. |
| `scripts/payments/{check-database,setup-database,manage-application,replay-delivery}.mjs` | Controlled provisioning, index checks, rotation/revocation and audited replay. |
| `server/modules/payments/tests/` | Unit, route, replica-set, concurrency and adapter contract tests. |
| `docs/payments/{api-contract,application-integration,operations}.md` | Approved public contracts, consumer examples and recovery procedures. |

Do not introduce a base repository abstraction that permits arbitrary filters; the named repositories should expose narrow operations. Small related helpers can share a file during implementation if this avoids empty scaffolding.

### Files to modify

| Existing file | Scoped change |
| --- | --- |
| `package.json`, `pnpm-lock.yaml` | Add Mongoose; exact-money JSON helper only if the chosen Whop schema requires decimal JSON numbers; optional pinned Whop SDK only after verification. Add payment test/provisioning commands. |
| `server/index.js` | Payment bootstrap/readiness and graceful worker/database shutdown. |
| `server/app.js` | Inject payment context, register raw webhook before global JSON parser, mount payment routes before SPA/error fallback, apply appropriate route limiters. Preserve management routes. |
| `server/middleware/errors.js` | Narrow generic safety improvement: honor validated parser/CORS status codes and sanitize payment errors; do not log arbitrary payment/provider bodies/messages. |
| `.env.example`, `.env.production.example` | Document new variables, database separation and test/live restrictions; no credentials. |
| `render.yaml` | Payment enable flag, secret placeholders, readiness/worker runtime requirements; remain one service initially. |
| `README.md` | Module setup, approved production startup and testing instructions. |
| `server/management.integration.test.js` | Confirm the disabled payment module preserves gateway behavior and malformed-request changes. |

Existing management auth, platform adapters, frontend analytics models and secrets-generation script should not be repurposed to issue payment application credentials. No frontend change is required for the payment service foundation.

## 5. MongoDB schema design

### Common conventions and money

Every collection has an internal ObjectId `_id`, explicit `schemaVersion`, and `environment`. References inside the payment database use ObjectIds. Exposed IDs are random opaque identifiers with prefixes: `app_`, `pay_`, `att_`, `txn_`, `evt_`, `dlv_`, `ref_`; use at least 128 bits of cryptographic randomness. Do not embed merchant identifiers, emails or timestamps in public IDs. Provider IDs remain separate even if Whop also uses `pay_`.

Mutable records have UTC `createdAt`, `updatedAt` and integer `version` where concurrent domain updates occur. Immutable audit/transaction/event records have `createdAt` only. Mongoose schemas use strict mode; repository updates explicitly use validation and conditional filters. Critical collection constraints also use MongoDB validators. No automatic cascading deletes of financial records.

**Money decision:** public `amount` is a canonical positive base-10 integer **string of minor units**, e.g. `"100000"` for KES 1,000.00. Reject floats, exponent notation, signs, leading zeros (except the permitted zero representation on output) and unsafe/unbounded input. This intentionally tightens the user's numeric example to avoid precision ambiguity across clients. Use uppercase ISO currency with a maintained exponent table and an application/provider currency allowlist. Unknown/unsupported currencies fail before checkout.

In JS, parse monetary strings to BigInt and use integer arithmetic. Persist money as BSON Decimal128 containing an **integral minor-unit value** created from a decimal string; all monetary fields follow this convention. Use validators for nonnegative integral values and maximums; bound phase-1 amounts to signed 64-bit range or stricter provider/application limits. Serialize explicit DTOs back to integer strings, never Extended JSON or Number. Preserve currency exponent on the payment as `currencyExponent`.

To Whop, format minor units into an exact major-unit decimal string. If the pinned endpoint demands a JSON number, use an exact decimal/lossless JSON serializer, validated numeric tokens and a lossless response parser; do not call `Number()` or multiply/divide floating-point values. Contract-test actual accepted types. Mongo aggregation uses Decimal128; no conversion to double. Taxes, fees, settled net amounts and charge amounts have distinct fields and currencies. Phase 1 assumes fixed total charged; reject mismatches or quarantine them, never silently perform FX or subtract fees from the promised payment amount.

Below, fields not marked optional are required unless explicitly described as set later. `U(...)` means a unique index. Every collection's default `_id` index is implicit. No financial collection has TTL deletion by default.

### `applications`

- Fields: `applicationId`, `name`, `clientId`, `status: ACTIVE|DISABLED|REVOKED`, `environment`, `scopes[]`, `allowedCurrencies[]`, `allowedMethods:['card']`, `amountLimits`, `providerPolicy:{provider:'whop',accountId,productId?}`, `webhook:{url,version,enabled,activeKeyId,keys:[{keyId,encryptedSecret,notBefore,notAfter?}]}`, approved `returnDestinations`, timestamps.
- Embedded credential records: `{credentialId,secretHash,createdAt,notBefore,expiresAt?,revokedAt?,lastUsedAt?}`; keep at most current and retiring active credentials, archive audit facts without retaining plaintext. `rotatedAt` and descriptive metadata optional. Store only hashes of inbound API secrets. Outbound HMAC secrets must be recoverable, so encrypt them with authenticated encryption and a key stored outside MongoDB; hashing cannot support signing.
- Indexes: `U(applicationId)`, `U(clientId)`; optional `(status,environment)` for operations listing. `clientId` is globally unique within each separate database.
- Queries: exact client lookup, scope/status check, configuration/rotation by public application ID. No public list endpoint for consumer applications. Credentials and callback URLs are provisioned through an audited backend CLI initially, not payment requests.

### `payments`

- Fields: `paymentId`, `applicationId` ObjectId, `merchantReference` (1–128 bounded characters), `creationRequestHash`, `amount` Decimal128 minor integer, `currency`, `currencyExponent`, `method:'card'`, `provider:'whop'`, `providerAccountId`, `status`, `version`, `attemptSequence`, `refundedAmount`, `refundReservedAmount`, `environment`, timestamps.
- Optional: `customer:{externalId?,email?}`, bounded flat `metadata`, `activeAttemptId`, `winningAttemptId`, `lastVerifiedAt`, `nextVerificationAt`, `reviewReason`, `completedAt`, `failedAt`, `cancelledAt`, `expiredAt`. A `verificationStatus: CURRENT|PENDING|REVIEW_REQUIRED` is independent of payment state; a provider outage is not a failed payment.
- Indexes: `U(paymentId)`, `U(applicationId,merchantReference)`, `(applicationId,createdAt desc,_id desc)`, `(applicationId,status,createdAt desc,_id desc)`, `(provider,status,nextVerificationAt)` for verification work. The provider-account/environment identity must be stored, not inferred from whatever credentials are current later.
- Queries: tenant/public ID, tenant/reference, tenant chronological listing, recoverable unresolved payments. Do not reuse merchant references after expiry or failed attempts. A price change requires a new business reference/revision approved by the product.

### `payment_attempts`

- Fields: `attemptId`, payment/application ObjectIds, `sequence`, `provider`, `providerAccountId`, `status: CREATED|SUBMITTING|PENDING|PROCESSING|SUCCEEDED|FAILED|CANCELLED|EXPIRED|UNKNOWN`, `version`, stable `providerIdempotencyKey`, `providerRequestHash`, environment/timestamps.
- Optional: `providerCheckoutId`, `providerPaymentId`, `providerRequestId`, `providerAttemptId`, encrypted `checkoutUrl`, `checkoutExpiresAt` only when provider-confirmed, `providerStatus`, `failureCode`, sanitized bounded `failureMessage`, `lastVerifiedAt`, `supersededAt`.
- Indexes: `U(attemptId)`, `U(paymentId,sequence)`, `U(provider,providerAccountId,environment,providerIdempotencyKey)`. A partial unique provider-payment mapping is appropriate only if a provider payment maps to one service attempt; if Whop reuses a payment across processor retries, those retries stay under the same service attempt. Define this in adapter tests. `(paymentId,createdAt)` for history.
- One attempt is one provider checkout/charge operation; HTTP retries never create attempts. Whop-internal card retries are not fabricated as separate attempts unless distinct documented IDs are available.
- Persist allowlisted identifiers, statuses, amounts and sanitized failure codes. Never persist raw card fields, authentication headers, entire provider bodies, billing addresses, provider client secrets or arbitrary error response dumps. Checkout URLs may grant access and should be encrypted, omitted from logs, and only returned to the owning application.

### `transactions`

- Fields: `transactionId`, payment/application/attempt ObjectIds, `provider`, `providerAccountId`, `providerReference`, `type: PAYMENT|REFUND|REVERSAL|FEE`, `amount`, `currency`, `currencyExponent`, `status: POSTED`, `occurredAt`, `createdAt`, `environment`, `dedupeKey`.
- Optional: refund ObjectId, original transaction ObjectId for corrections, settlement/balance references, provider fee reference. Only PAYMENT writes are enabled initially; other types require the corresponding verified operation.
- Indexes: `U(transactionId)`, `U(provider,providerAccountId,environment,dedupeKey)`, `(applicationId,createdAt desc,_id desc)`, `(paymentId,createdAt)`.
- Query audit and reconciliation by provider reference, payment and tenant/time. Insert append-only confirmed financial facts; pending operations belong in attempts/refunds. A refund creates a new record, never rewrites the original payment transaction. One success transaction per distinct provider charge, not blindly one per logical payment: an unexpected second real charge must be recorded and flagged, not hidden by a uniqueness constraint.

### `payment_events`

- Fields: `eventId`, application/payment ObjectIds, `paymentVersion`, `type`, `schemaVersion`, immutable sanitized `data`, `createdAt`, `environment`, `dedupeKey`.
- Event types: `payment.created`, `payment.pending`, `payment.processing`, `payment.succeeded`, `payment.failed`, `payment.cancelled`, `payment.expired`; add `payment.partially_refunded`, `payment.refunded` with refunds. Use a separate operational event for review-required anomalies; do not announce unverified success.
- Indexes: `U(eventId)`, `U(paymentId,dedupeKey)`, `(applicationId,createdAt desc,_id desc)`, `(paymentId,paymentVersion)`.
- Store the complete bounded consumer event snapshot so retries send the same body. Events and their delivery records are created in the same database transaction as the payment state change. They form the durable outbox.

### `webhook_deliveries`

- Fields: `deliveryId`, event/application ObjectIds, `destinationVersion`, approved `url` snapshot, `status: PENDING|IN_FLIGHT|RETRY|DELIVERED|DEAD|PAUSED`, `attemptCount`, `nextRetryAt`, environment/timestamps.
- Optional: `leaseOwner`, `leaseToken`, `leaseUntil`, `lastHttpStatus`, sanitized `lastErrorCode`, `deliveredAt`, `lastAttemptAt`. URLs never include secrets or customer data in query strings.
- Indexes: `U(deliveryId)`, `U(eventId,applicationId,destinationVersion)`, `(status,nextRetryAt,_id)` for due jobs, `(status,leaseUntil)` for abandoned work, `(applicationId,createdAt desc)` for support.
- No TTL on undelivered/dead work. Replaying an event reuses its event ID. Changing a destination requires an audited rebind to an approved destination version; old queued URLs must not silently remain trusted after revocation.

### `webhook_delivery_attempts`

- Fields: delivery/event/application ObjectIds, `attemptNumber`, `startedAt`, `outcome: STARTED|DELIVERED|FAILED|UNKNOWN`, `createdAt`; optional `finishedAt`, HTTP status, latency, safe error code. No response body or secret headers.
- Indexes: `U(deliveryId,attemptNumber)`, `(applicationId,createdAt desc)`. Record STARTED with the durable claim; finalize after I/O. A crash leaves UNKNOWN/unfinished evidence.
- Optional `purgeAt` TTL for completed diagnostic attempts after an approved retention period (proposal: 90 days). Preserve summary delivery records and financial events separately.

### `idempotency_keys`

- Fields: application ObjectId, `key`, `operation` (method + normalized route + API version), `requestHash`, `status: ACCEPTED|COMPLETED`, `paymentId`, environment/timestamps; optional attempt/refund ObjectId, bounded sanitized `response:{statusCode,body}`, `expiresAt`.
- Indexes: `U(applicationId,key)`; `(paymentId)`; single-field TTL `(expiresAt)` with `expireAfterSeconds:0` only for safe completed entries. Different endpoint use of the same key is a conflict.
- Never expire unresolved operations. Proposal: retain completed replay snapshots 30 days, then expire only once provider work is terminal and the durable payment/reference guard remains. TTL cleanup is asynchronous; it is not a concurrency mechanism. Older same-reference creates resolve to the existing payment or conflict on changed intent; they never charge again. Do not automatically revive expired provider POST keys.

### `provider_events` (durable inbox)

- Fields: `provider`, `providerAccountId`, `environment`, `providerEventId`, `type`, `apiVersion`, `payloadHash`, bounded normalized allowlisted payload, `receivedAt`, `status: RECEIVED|PROCESSING|PROCESSED|RETRY|IGNORED|REVIEW_REQUIRED`, `attemptCount`, `nextRetryAt`, timestamps.
- Optional: correlated payment/attempt ObjectIds, provider payment/reference, lease fields, `processedAt`, safe error code. Preserve only required verified evidence, not the raw full body. Verification happens on raw bytes before projection.
- Indexes: `U(provider,providerAccountId,environment,providerEventId)`, `(status,nextRetryAt)`, `(status,leaseUntil)`, `(provider,providerAccountId,providerPaymentId)`.
- Duplicates with the same event ID but a different payload hash trigger an alert. Keep event-ID tombstones at least as long as the supported replay/audit horizon; do not TTL away financial deduplication casually.

### `provider_jobs`

- Fields: `jobId`, `operation: CREATE_CHECKOUT|VERIFY_PAYMENT|REQUEST_REFUND|VERIFY_REFUND|CLOSE_CHECKOUT`, application/payment ObjectIds, optional attempt/refund ObjectIds, `operationKey`, `status: PENDING|IN_FLIGHT|RETRY|DONE|UNKNOWN|REVIEW_REQUIRED`, `nextRunAt`, `attemptCount`, environment/timestamps, bounded normalized request descriptor.
- Optional: lease fields, safe error code, provider key first-submitted time. Encrypt any credential-like checkout/token data if unavoidable; preferably retrieve protected config and construct the request at execution.
- Indexes: `U(jobId)`, `U(operationKey)`, `(status,nextRunAt)`, `(status,leaseUntil)`.
- This durable queue prevents payment acceptance followed by process death from losing provider work. Expired leases do not imply it is safe to create a fresh provider charge.

### `refunds` (create when refund capability is enabled)

- Fields: `refundId`, application/payment ObjectIds, `amount`, `currency`, `currencyExponent`, `status: REQUESTED|SUBMITTING|PENDING|SUCCEEDED|FAILED|UNKNOWN`, `provider`, provider account, stable provider idempotency key, environment/timestamps, bounded reason code.
- Optional: provider refund ID, `completedAt`, safe failure code, reconciliation timestamps.
- Indexes: `U(refundId)`, partial `U(provider,providerAccountId,environment,providerRefundId)` when a nonempty ID exists, `(paymentId,createdAt)`, `(status,updatedAt)`.
- Reserve refundable amount on the payment in the same transaction as refund creation. Unknown provider outcomes keep the reservation until resolved.

### `payment_audit_events`

- Required: actor type/ID, action, requestId, target public ID, environment, safe changed-field names, createdAt; optional application ID and approval/reference ID.
- Indexes: `(applicationId,createdAt desc)`, `(targetId,createdAt desc)`, `(requestId)`. Append-only; retention approved operationally. Capture credential rotation/revocation, destination changes, manual replay, refund requests and reconciliation overrides. Never log credential values or full settings diffs.

## 6. Relationship model

```text
Application
 ├─ credentials + trusted webhook configuration (bounded embedded records)
 ├─ Payments
 │   ├─ Payment Attempts
 │   ├─ Transactions (immutable facts)
 │   ├─ Refund requests (later enabled)
 │   └─ Payment Events
 │       └─ Webhook Deliveries
 │           └─ Delivery Attempts
 ├─ Idempotency Keys
 └─ Audit Events

Provider Events → verified payment/attempt mapping
Provider Jobs   → payment/attempt/refund work
```

Use separate collections for unbounded histories and queues. Embed only bounded customer snapshots, metadata, credential overlap and signing-key configuration. Use internal ObjectId references to avoid repeating large public IDs in indexes; denormalize applicationId onto every tenant-owned operational record. MongoDB does not enforce foreign keys: services enforce matching ownership and transactional creation, and reconciliation checks detect orphan records. Public DTOs expose only public IDs. Avoid unrestricted populate() that could leak application configuration.

## 7. Payment state machine

Payment states for phase 1: CREATED, PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED, EXPIRED. Add PARTIALLY_REFUNDED and REFUNDED only with the refund feature. Attempts additionally have UNKNOWN; payment verification flags expose unresolved provider outcomes without declaring failure.

| From | Allowed target | Required evidence |
| --- | --- | --- |
| CREATED | PENDING | Checkout accepted by provider. |
| CREATED | PROCESSING / SUCCEEDED | Verified provider event/read arrives before checkout response commit. |
| CREATED | FAILED | Definitive creation rejection with no charge ambiguity. |
| CREATED | CANCELLED / EXPIRED | Locally unsubmitted work cancelled, or provider confirms closed/unpayable checkout. |
| PENDING | PROCESSING | Provider confirms collection/authorization in progress; authorization alone is not success. |
| PENDING / PROCESSING | SUCCEEDED | Server-side verification confirms captured/paid funds, exact amount/currency, account and correlation. |
| PENDING / PROCESSING | FAILED | Provider definitively reports unsuccessful outcome for current attempt; no unresolved competing attempt. |
| PENDING / PROCESSING | CANCELLED / EXPIRED | Verified cancellation/expiry; not browser navigation or a local network timeout. |
| FAILED | PENDING | Explicit new attempt, authorized application request and idempotency key; previous checkout cannot still collect. |
| FAILED / CANCELLED / EXPIRED | SUCCEEDED | Exceptional late-capture correction only: authenticated current provider read proves funds moved for a known attempt. Record correction and alert; never trust a stale event alone. |
| SUCCEEDED | PARTIALLY_REFUNDED / REFUNDED | Confirmed refund monetary records, never refund request acceptance. |
| PARTIALLY_REFUNDED | PARTIALLY_REFUNDED / REFUNDED | Additional confirmed refund within captured amount. |

All other transitions are rejected or quarantined. In particular SUCCEEDED cannot become FAILED/PENDING/PROCESSING/CANCELLED/EXPIRED; REFUNDED cannot become SUCCEEDED from an old success event. Duplicate observations of a state are no-ops unless they reveal a new financial operation. Refunded state is derived from captured/refunded amounts, not event arrival order.

Conditional writes include `_id`, `applicationId`, expected `version`, permitted current status and applicable current/winning attempt. Increment version in the same write. Payment success from an older attempt must be inspected even if another attempt became current. Prefer forbidding a new checkout until the old one is definitively closed; an unexpected second captured charge produces an anomaly and a second audited financial fact, not a second fulfillment event.

## 8. API contract

Base: `/api/v1`. This sits alongside `/api/management`; existing analytics routes keep their meanings. The API is publicly reachable where necessary but application endpoints require server credentials. Browser cookies/global management keys are not accepted as application payment credentials.

Common application headers: `X-Client-ID`, `X-API-Key`, optional `X-Request-ID`; required `Idempotency-Key` for mutations. Public DTO responses use existing `{success,data,requestId}`; errors use `{success:false,error:{code,message},requestId}`. Pagination is bounded cursor-based (`limit` 1–100, default 20; opaque cursor), rather than loading all transactions.

Common validation: strict Zod objects; reject unknown fields such as applicationId/status/provider/webhookUrl; scalar strings only; DTO-built filters; bounded IDs/reference; UTC ISO times with from inclusive/to exclusive; allowlisted enums. Metadata at most 20 flat string entries, bounded keys/values and total encoded size (proposal 4 KiB), no `$`, `.`, `__proto__`, `constructor`, `prototype` keys. Body limit proposal 16 KiB for creation; provider webhook raw body separately bounded (e.g. 256 KiB after verifying actual payload sizes). No recursive arbitrary JSON.

### POST `/api/v1/payments`

Auth: active application, `payments:create`; mandatory idempotency key (1–128 printable bounded characters).

```json
{
  "amount": "100000",
  "currency": "KES",
  "method": "card",
  "reference": "VJPOS-ORDER-8392",
  "customer": {"externalId": "customer-18", "email": "customer@example.com"},
  "metadata": {"orderId": "8392"}
}
```

ApplicationId, provider/account, callback URL and return destination come from authenticated configuration. Product backend validates its order total before this call; payment service enforces configured currency/amount limits and freezes the request. A fixed application return destination is enough initially; later a bounded preapproved destination ID can select among stored URLs.

Always durably accept as `202` with Location header and stable initial response:

```json
{"success":true,"data":{"paymentId":"pay_<opaque>","reference":"VJPOS-ORDER-8392","amount":"100000","currency":"KES","status":"CREATED","checkout":null},"requestId":"<request-id>"}
```

Mongo transaction: insert idempotency claim + payment + first attempt + created event + delivery + provider job + replay response. No Whop request until committed. Worker creates checkout; client polls GET for its URL/status. A same-key replay returns original status/body (requestId may identify the new request separately); add `Idempotent-Replayed:true`. Store no secrets in replay payload.

Errors: 400 invalid DTO/key; 401 invalid credentials; 403 disabled application/scope; 409 IDEMPOTENCY_CONFLICT or REFERENCE_CONFLICT; 422 unsupported currency/method; 429 quota; 503 payment DB unready. Provider unavailability after acceptance leaves durable work pending/unknown, not a fictitious failure response that invites another charge.

### GET `/api/v1/payments/:paymentId`

Auth: `payments:read`; validate public ID; Mongo lookup always includes authenticated applicationId. Response `200` contains payment ID/reference, string amount/currency, status/version, verification status, created/completed timestamps and active checkout `{url,expiresAt?}` only when usable. No provider secrets/raw payloads/customer details beyond approved DTO.

Read is side-effect-free and authoritative from local persisted state; do not contact Whop on every poll. Worker performs verification. Errors: common auth, 404 for absent **or other application's** payment, 503 database. No idempotency key needed. Send `Cache-Control: no-store`.

### GET `/api/v1/payments/reference/:reference`

Register before `/:paymentId`. Same auth/response/error rules; bounded reference string decoded once; lookup `(applicationId,merchantReference)`. Read-only, no idempotency key.

### POST `/api/v1/payments/:paymentId/attempts`

Auth: `payments:create`; mandatory new idempotency key; body `{}` for hosted checkout. Validate tenant/payment and retry eligibility. In a transaction claim key, conditionally allocate next sequence/active attempt, create attempt/event/delivery/provider job, cache `202 {paymentId,attemptId,status}`. Same key replays; competing new keys contend on payment version/current attempt. Return 409 PAYMENT_NOT_RETRYABLE for success, in-flight/unknown outcomes, or unclosed old checkouts. Do not expose Whop's retry-payment command directly or silently re-charge a saved card.

### POST `/api/v1/payments/:paymentId/refunds`

Feature-gated until refund acceptance tests pass; auth `refunds:create`, separately granted; mandatory idempotency key. Body `{ "amount":"25000", "reason":"customer_request" }`; currency is derived from original payment. Reject zero, over-refund, unverified capture or disallowed reason. Transaction: reserve amount using guarded payment update, insert refund/key/job/audit; return `202 {refundId,paymentId,status:"REQUESTED",amount,currency}`. Errors: 404 tenant mismatch, 409 not refundable/insufficient unreserved amount/key conflict, 422 unsupported capability, 503 DB. Never return SUCCEEDED just because the provider accepted the refund call.

### GET `/api/v1/payments/:paymentId/refunds/:refundId`

When refunds enabled: `refunds:read`; validate both IDs and ownership in one scoped query; return refund DTO/status; 404 for mismatch, auth/DB errors as above. Read-only, no key.

### POST `/api/v1/providers/whop/webhook`

Provider signature authentication only, never application key/session. Fixed Whop route initially; adding providers requires registration, not dynamic URL execution. Validate headers, timestamp, raw body signature, envelope/version/account/environment and normalized payload. Insert inbox with majority durability and unique provider event key; return `200 {success:true}` only after persistence or confirmed identical duplicate. 400 malformed signed body/version, 401 invalid signature/time, 413 body limit, 503 persistence failure (so provider retries). Legitimate unrelated provider events can be recorded as ignored and acknowledged. Unexpected account is rejected/quarantined according to the configured allowlist; never create an application payment from metadata alone. No application idempotency header required; provider event ID is the dedupe key.

### GET `/api/v1/transactions`

Auth `transactions:read`. Optional paymentId, type, UTC range, currency, cursor and limit. Use explicit applicationId + permitted filters and compound indexes; return `200 {success:true,data:[transactionDTO],pagination:{limit,nextCursor},requestId}`. Amounts are strings; no provider raw bodies. 400 invalid filter/cursor, 401/403 auth, 503 DB. Cursor cannot change tenant or remove ownership filters. No idempotency key.

### GET `/api/v1/payments/health`

Register before dynamic ID route. Auth active application `payments:read`; return minimal availability for that application's enabled payment method, dataAsOf and status `healthy|degraded|unavailable|unknown`; no aggregate financial counts or provider credentials. DB failure is 503. No side effects/key. Keep `/api/health` as gateway liveness; do not label successful HTTP liveness as payment success readiness.

Provisioning/rotation/replay are initially controlled CLI operations with audit records; no new public admin mutation routes. If a UI is added later, require explicit payment administration permissions and CSRF protections for cookie-authenticated actions.

### Idempotency behavior in detail

Canonicalize the validated semantic DTO, including currency/method defaults and operation/API version, using deterministic JSON. Hash with SHA-256; preserve meaningful metadata/customer values, ignore transport requestId. Never hash raw header ordering or raw JSON whitespace. Use unique Mongo indexes as the arbiter.

Two simultaneous requests race to insert `(applicationId,key)` inside the creation transaction. One commits; the other's duplicate-key/write conflict aborts, then it reads the winning record with bounded retry after commit. Equal operation/hash returns cached acceptance; different hash/operation returns 409. If winner is still committing return a retryable 409 REQUEST_IN_PROGRESS, never start competing provider work. Same merchant reference with a different key also cannot create another payment: equal creation fingerprint returns the existing payment reference, different intent returns 409.

If commit succeeds but HTTP reply is lost, replay resolves from Mongo. If transaction aborts, there is no accepted payment/job and retry is safe. If provider outcome is unknown, use the same stored provider key/request within its supported retention window, inspect status, and keep UNKNOWN/review state when unsure. Local TTL expiry must never authorize recreating an existing reference.

## 9. Whop card provider integration

### Verified documentation findings and integration gates

Whop offers hosted checkout and hosted payment elements. Recommend hosted checkout first to keep card entry outside Vijo servers and reduce PCI scope; a redirect is never proof of payment. Formal PCI eligibility still depends on the final integration and merchant obligations. [Whop payment integration choices](https://docs.whop.com/developer/guides/accept-payments)

Whop's documentation exposes both Legacy and Current API references. Build against the Current API and pin an explicitly supported `Api-Version-Date`; some old URLs render Legacy schemas. Do not mix `company_id` Legacy fields with Current `account_id` or assume examples across surfaces have compatible amount/status types. Confirm the pinned endpoint schema and actual sandbox behavior before selecting an SDK release. [API stability](https://docs.whop.com/api-reference/stability) · [API versions](https://docs.whop.com/developer/api/versioning)

A Current checkout configuration is documented as reusable, with an existing/inline plan, metadata and purchase URL. Configure card as the only method and disable inclusion of platform-default methods; verify the effective settings. Metadata must include server-generated service payment/attempt correlation, not client-overridable fields. One-time plan pricing must match the immutable payment; disable adaptive pricing, coupons and adjustable quantity where supported or reject any resulting total mismatch. [Checkout configuration](https://docs.whop.com/api-reference/beta/checkout-configurations/create-a-checkout-configuration)

**Release gate: duplicate charge prevention with hosted checkout.** Creating one configuration idempotently does not make a reusable checkout single-use. Sandbox must prove a provider-enforced one-order collection restriction, covering concurrent checkout windows, another user, reopening after success and old attempts. Deleting/closing a link after success alone is not sufficient because of the race window. If Whop cannot enforce this, do not release reusable hosted links as an exactly-once order payment mechanism. Obtain approval for hosted Elements/tokenization plus a server-controlled idempotent charge path; the browser still sends card data only to Whop. Keep generic orchestration/models; adjust only checkout/confirmation contracts after reviewing actual provider capability. A documentation claim of local idempotency cannot replace this test.

Whop documents Current API POST idempotency with 24-hour retention; same-key changed requests are rejected and in-progress/unknown outcomes can return 409. Persist a separate stable provider operation key (derived from environment/application/attempt/operation, no PII), exact request/version fingerprint and first submission time. Never use a new key merely because the HTTP call timed out, or blindly retry an unresolved charge after the retention window. Key rotation during unresolved operations also changes provider caller scope and requires recovery review. [Whop idempotency](https://docs.whop.com/developer/api/idempotency)

### Provider-neutral contract

JSDoc async contract:

- `capabilities()` → supported currencies/methods, checkout restrictions, refunds, idempotency behavior.
- `createPayment(context, intent, operationKey)` → normalized checkout/reference/attempt state; may return UNKNOWN.
- `getPaymentStatus(context, providerReference)` → normalized state, exact amounts/currency, account, provider timestamps and evidence IDs.
- `verifyWebhook(rawBody, headers, config)` → verified normalized event (or typed signature/format error).
- `refund(context, providerReference, amount, operationKey)` and `getRefundStatus(...)` when supported.
- `closeCheckout(...)` only if the selected provider actually supports preventing further collection.

Registry key `whop` identifies a processor; `card`, `mpesa`, `bank` identify methods. Multiple processors can implement card. Product apps cannot submit arbitrary provider/account identifiers. Native fetch is already present and sufficient behind an isolated client; a pinned official SDK is optional if it preserves exact amounts and supports the selected version. Do not reuse GET-only `platformClient.js` for payment mutations.

### Authoritative flow

1. Application backend validates order/amount and submits idempotent intent.
2. Service commits intent/attempt/job, returns payment ID.
3. Worker creates the approved one-time checkout with provider idempotency, stores references/URL and emits PENDING.
4. Product fetches status and sends customer to provider-hosted URL; card/3DS interactions remain at Whop.
5. Whop webhook signature is verified over exact raw bytes; inbox is committed before acknowledgment.
6. Worker reads the provider payment using server credentials. Check account, environment, checkout/correlation, exact payable total/currency, card method, captured/paid status, and known attempt. Unknown correlation is quarantined; never trust arbitrary metadata to choose a tenant.
7. In one Mongo transaction, record verified attempt/payment outcome, transaction, event and delivery; mark inbox processed.
8. Outgoing worker sends signed application event. Application atomically deduplicates event and fulfills its order.
9. Browser return page asks its own backend for status; query-string status is presentation-only.

Whop Current payment reads have separate lifecycle and finer status fields; map verified paid capture to SUCCEEDED, authorization to PROCESSING, pending to PROCESSING, and terminal unpaid outcomes appropriately. Refund/dispute substatuses must not overwrite capture history. Preserve charge currency/amount distinct from provider net settlement. [Current payment retrieval](https://docs.whop.com/api-reference/beta/payments/retrieve-payment)

### Provider webhook protocol

Whop documents `webhook-id`, `webhook-timestamp`, `webhook-signature`, signing `id.timestamp.rawBody` with HMAC-SHA256 and a five-minute timestamp check. Implement the exact selected-version verification or a tested compatible SDK helper; do not copy the old `webhooks.unwrap` interface blindly. Persist before responding, within the provider deadline; delivery is duplicated and unordered, with retries for roughly three days. [Whop webhooks](https://docs.whop.com/developer/guides/webhooks)

The Express webhook raw-body parser must run before global JSON parsing; reject compressed bodies unless signature semantics are explicitly supported. Network/database work beyond durable inbox acceptance runs through recoverable workers. Signature verification failure never updates payments. If DB is down return retryable failure; do not acknowledge into an in-memory queue.

### Refunds and reconciliation

Whop provides full/partial refund requests; its amount contract differs from the service's minor-unit format, so convert exactly and verify the pinned schema. A successful HTTP refund response alone does not prove final movement. Verify refund ID/status and cumulative refunded amount, then append REFUND transaction/event and update totals atomically. Keep this feature disabled until provider/refund sandbox tests pass. [Whop refund API](https://docs.whop.com/api-reference/beta/payments/refund-payment)

Retain provider account, environment, checkout/payment/refund/settlement IDs, request keys/version, expected and observed money, event IDs and provider occurrence timestamps. Schedule bounded verification of UNKNOWN/PROCESSING and stale work; later add cursor-based provider transaction comparison. No full provider database copy. Alert on paid-unmatched payments, differing amounts, duplicate captures and missing provider events. A provider outage means UNKNOWN/degraded, not a fabricated FAILED payment.

## 10. Application webhook design

Example immutable event body (integer-string money):

```json
{
  "id":"evt_<opaque>",
  "type":"payment.succeeded",
  "schemaVersion":1,
  "createdAt":"2026-09-27T13:50:00Z",
  "data":{
    "paymentId":"pay_<opaque>",
    "reference":"VJPOS-ORDER-8392",
    "amount":"100000",
    "currency":"KES",
    "provider":"whop",
    "paymentVersion":3
  }
}
```

Headers: `X-Vijo-Event-ID`, `X-Vijo-Timestamp` (Unix seconds), `X-Vijo-Key-ID`, `X-Vijo-Signature: v1=<base64>`. Sign `eventId + '.' + timestamp + '.' + exactBodyBytes` with HMAC-SHA256 and that application's distinct webhook secret. New delivery attempt gets a fresh timestamp/signature while the event ID/body remain immutable. Store canonical serialized body or ensure stable byte serialization.

Consumer verifies signature in constant time before parsing, allows bounded five-minute clock skew, resolves active/retiring signing key, and stores event ID in a unique local inbox. Event dedupe and business fulfillment must commit together in the application's own database; there is no cross-database transaction with VijoManagement. Duplicate valid events return 2xx. Verify reference/amount/currency against the local order before applying business effects. Track paymentVersion or retrieve current status when events arrive out of order.

Sender policy: immediate attempt, then delays 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, 12 hours, 24 hours; bounded jitter. These are delays after failure, not absolute timestamps. Cap approximately 48 hours/8 attempts, then DEAD and alert, with audited manual replay. Network errors/408/429/5xx retry; respect bounded Retry-After. 401/403/404 alert as likely configuration faults; retain work for correction and bounded retries. 410 or revoked/unsafe destinations pause work. Only 2xx counts as delivery. Timeout 5 seconds; do not follow redirects; bound response consumption and never log response content.

Atomic claim uses due status/time and compare-and-set lease token. Record attempt-start and claim in a short transaction. Completion writes require the same lease token so a stale worker cannot overwrite a newer claim. A crash after application acceptance can produce a repeat: this is at-least-once delivery, not exactly-once HTTP. Application idempotence is mandatory.

Configuration changes require audit. Sign with a presently valid key recognized by the application, not a long-expired key captured in an old job; retain short key rotation overlap. Revocation stops new payment creation; already accepted valid payments still need provider verification. Independently disable unsafe callbacks and retain their jobs for recovery.

## 11. Concurrency and MongoDB atomicity

### Transaction boundaries

| Operation | Atomic database work | External work |
| --- | --- | --- |
| Accept payment | Key claim, payment, first attempt, event, delivery, provider job, cached acceptance. | None until commit. |
| Allocate retry | Guard payment/version/current attempt, new sequence/attempt, idempotency, job/event/delivery. | Only after old checkout proved unpayable. |
| Confirm capture | Guard state/version, update attempt/payment, append unique provider-charge transaction, success event/delivery, processed inbox. | Provider read before transaction. |
| Reserve refund | Guard amount/version, increment reservation, refund/key/job/audit. | Provider request after commit. |
| Confirm refund | Guard refund/payment versions, release reservation, update refunded total/state, append refund transaction/event/delivery. | Provider verification before transaction. |
| Delivery claim | Lease claim, increment attempt count and create delivery-attempt record. | HTTP after transaction; completion conditional on token. |

Use payment-connection sessions with snapshot read concern and majority write concern. Keep transactions short; no HTTP/email/provider calls inside `withTransaction`. Avoid parallel operations on one session. Use bounded driver transaction retries, handling transient errors/unknown commit results; re-read durable operation state before proceeding. Unique indexes are provisioned before traffic. Mongoose `unique:true` alone is not validation.

| Race/failure | Guard/recovery |
| --- | --- |
| Duplicate provider webhook | Unique inbox tuple; acknowledge verified duplicate; processed event + financial writes commit together. |
| Two workers handle same event | Lease token plus transaction/state version and unique transaction/event keys; exactly one domain transition. |
| Same idempotency key concurrently | Unique compound index + transaction abort/re-read; one logical intent/job. |
| Different keys, same order | Unique application/reference and creation fingerprint. |
| Application retries HTTP | Replay committed acceptance; no new attempt or provider key. |
| Customer retries card | Reuse active checkout if valid; create new attempt only under guarded retry policy. Hosted duplicate-charge feasibility gate still applies. |
| Status query vs webhook | GET reads only. Reconciliation and webhook workers both use the same verified transition service with version guards. |
| Late FAILED after success | Ignore regressive event; preserve success; current provider read may resolve ambiguity. |
| Success arrives before creation response persisted | Intent/attempt exists first; verified metadata correlation maps early event, version guard prevents later PENDING overwrite. |
| Provider POST succeeds but server crashes | Recover with same provider key while valid, or retrieve known reference. Never infer failure or issue fresh charge blindly. |
| Provider key retention expires | UNKNOWN/review; search provider records/reconcile using stored evidence, no automatic replay of charge-creating POST. |
| Two refunds simultaneously | Transactional reserved+refunded+requested <= captured guard; optimistic version prevents over-reservation. |
| External/provider-dashboard refund races local refund | Verify current refunded balance, import independently verified refunds, serialize local requests; provider remains final over-refund arbiter. Quarantine discrepancies, preserve unknown reservations. |
| Replica step-down/unknown commit | Driver commit retry + unique facts/read-back; never repeat external side effects in retried transaction callback. |
| Worker lease expires during network operation | Late completion fenced by token; replacement uses same operation key and read-before-retry rules. |
| Second real captured charge | Persist distinct provider-charge transaction, flag excess capture, suppress duplicate fulfillment, initiate approved review/refund procedure. Do not drop financial evidence. |

Single-document atomic writes suffice for lease renewal, lastUsedAt throttled updates and monotonic diagnostic timestamps. Neither in-memory locks nor the existing TTL cache enforce payment correctness.

## 12. Security review

### Application credentials

Use `X-Client-ID` plus high-entropy `X-API-Key` over TLS. Generate at least 32 random bytes; include a nonsecret key ID in the credential format. Store only a SHA-256 hash of the random secret and compare in constant time, or reuse bcrypt if operationally preferred. SHA-256 here is for uniformly random API secrets, not passwords. Throttle invalid attempts before expensive hashing. Never reuse the existing super-admin gateway key or product analytics keys.

Credential rotation: issue a new key, allow a short explicit overlap, record rotatedAt/lastUsedAt, then revoke old key. Revocation/status is checked on every request; optional short caching must have bounded revocation semantics. Scopes at least payments:create, payments:read, transactions:read, refunds:create/read. Test keys cannot address production databases/provider accounts.

Phase-1 inbound HMAC request signing is optional, not required for basic secure operation. TLS, narrow random credentials, tenant checks and durable idempotency are the baseline. A hash-only secret cannot directly serve as a recoverable server HMAC signing key. If signing is added, use a separate encrypted signing secret (or asymmetric client signatures), sign method/path/body digest/timestamp/nonce, and persist a unique nonce with TTL. Do not pretend API-key hashes provide request-signature verification.

| Threat | Required mitigation |
| --- | --- |
| Raw card collection | Reject card-number/CVV/PIN fields, use hosted card entry; do not log rejected bodies. No application or management endpoint handles raw card data. |
| Forged provider callbacks | Raw-byte signature, timestamp and account/environment verification; server retrieval before financial transition. |
| Forged app callback/replay | Per-application HMAC, timestamp, key ID, event ID, idempotent consumer. |
| Duplicate charges | Durable intent/reference uniqueness, provider idempotency and unknown-outcome recovery; provider-enforced checkout restrictions validated before release. |
| Amount/currency tampering | Price comes from authenticated product backend, immutable intent; provider amount/account/currency/method matched; no client-controlled settlement account. |
| Stolen application key | Limited scopes, application limits/rates, revocation, rotation, monitoring, separate environments. It never grants super-admin management access. |
| IDOR/cross-application reads | All tenant repositories require applicationId, including reference/refund/transaction lookup. Return 404 for foreign identifiers. Random IDs alone are insufficient. |
| NoSQL injection | Strict scalar DTOs; explicit construction of filters/updates/projections; never spread req.body/query into Mongo; reject operator/nested objects. Schema/collection validators are additional guards. |
| Metadata/payload abuse | Flat bounded strings, reject dangerous keys, schema strictness and body limits; forbid secrets/medical data and scrub logs. No arbitrary embedded Mongo objects. |
| Race/state manipulation | Transactions, conditional version/status/amount writes, unique indexes, immutable financial facts; no public state-setting endpoint. |
| Webhook SSRF | URL only from trusted application config. HTTPS only, no credentials/fragments, restrict ports/approved hostnames. Reject private/loopback/link-local/reserved IPv4/IPv6 and cloud metadata addresses. Validate DNS at registration and every delivery; bind connection to vetted resolution/egress policy to prevent rebinding. No redirects; controlled egress. |
| User-controlled redirects | Only stored approved return destinations, no arbitrary redirect_url from payments. Returned checkout URL must use approved provider host and expected environment. |
| Sensitive logs | Allowlist structured attributes; scrub SDK/Mongo errors; no bodies, URIs, URLs with tokens, authorization headers, API keys, PAN/CVV or medical metadata. |
| Financial data tampering | Narrow DB user, encrypted connections, explicit index/validator migration, restricted operational access, append-only APIs, audit of refunds/replay/config changes, tested backups. |
| Provider/key mix-up | Pin account, API version and environment in each operation; fixed provider host registry; verify webhook account and payment ownership. |
| Denial of service | Ingress limit, per-application bounded quota/queue depth, concurrency/backoff, provider circuit breaking, body/response bounds; failure does not free money reservations. |

Global express-rate-limit is currently per process and not a distributed control. Retain it as basic ingress protection; implement payment-specific per-application counters atomically in Mongo or an edge control with verified shared limits. If a Mongo counter collection is used, unique `(applicationId,windowStart,operation)` and TTL on old buckets; TTL does not enforce the limit. Provider webhooks need a separate policy to avoid legitimate bursts being starved by normal API traffic.

Observability follows existing JSON logs with event names payment_created, payment_attempt_started, provider_request_failed, provider_webhook_received/rejected, payment_transition_rejected, application_webhook_attempt/retry/dead, refund_requested/confirmed, reconciliation_mismatch. Fields: requestId, application public ID, paymentId, attemptId, eventId, provider operation ID, safe code, duration, HTTP status, transition/version. Domain audit also persists in Mongo. Avoid high-cardinality IDs as metric labels.

Payment health measures provider connectivity/auth failures, unresolved-operation age, technical failure ratio with minimum sample size, webhook lag and dead delivery backlog. Declined cards are not automatically provider outages, and zero payment traffic means insufficient evidence rather than failure. Alerting destination and ownership need operational approval; this plan does not send messages or create alert integrations.

## 13. Migration strategy

1. Add module behind PAYMENTS_ENABLED=false; gateway must work without Mongo/Whop configuration.
2. Provision distinct sandbox database/user, validators/indexes, encryption material and application credentials through controlled scripts. No product database migration.
3. Add routes, worker lifecycle and payment-only authentication. Re-run existing management/SPA tests.
4. Complete provider feasibility/security tests before enabling payment creation for any application.
5. Integrate one product backend using a scoped credential. Product persists service paymentId/reference and an event inbox; business fulfillment remains local.
6. Route only explicitly selected new card orders through service. Keep in-flight old integrations and their callbacks intact until settled. Do not switch providers mid-order or bulk-recharge old records.
7. Expand application allowlist after verification; record rollout/cutover timestamps.
8. Rollback disables **new payment creation**, not receipt/verification of existing provider events or delivery of already committed outcomes. Drain pending payments and preserve records. Full module disable is only safe before first live payment or after completed drain.

The management revenue page currently aggregates product-reported revenue. Do not also add payment-service totals to that aggregate: products may report the very same sales. Define an authoritative source/deduplication policy before adding centralized payment analytics to existing dashboards. Payments, product subscription revenue, gross processed volume and net settlement are different metrics.

Stay within one Render backend initially. Durable leases allow overlap during rolling deployment or later scaling. The service must have an always-running production instance for predictable retries; local timers alone cannot provide scheduling while the service is suspended. A later worker process can run the same payment workers against the same database without changing the domain. No Redis, Kafka, RabbitMQ, Kubernetes, or standalone microservice is required for phase 1.

## 14. Testing strategy

Reuse Vitest and Supertest. Tests may stub external APIs; production never falls back to stubbed data. Use a disposable real replica-set Mongo database (CI service or test-only replica-set harness) for atomicity tests; an in-memory JS repository cannot demonstrate Mongo uniqueness/transaction correctness.

| Test group | Required cases |
| --- | --- |
| Connection/models | All models bound to payment connection; main/default untouched; explicit collection names; env mismatch; missing transaction support; validators/index existence and duplicate-key behavior. |
| Money | KES 2 decimals, 0- and 3-decimal currencies, max bounds, fractional/exponent/negative rejection; exact Whop serialization and round trip; no floating-point sums or mixed-currency arithmetic. |
| State/domain | Every allowed/forbidden transition, duplicate observations, stale failures after paid/refunded, late capture correction, unknown outcome and no automatic failure. |
| Auth/isolation | Missing/revoked/disabled/expired/wrong-environment keys, rotation overlap, scopes; foreign payment/refund/reference/cursor/transaction; management key cannot call consumer payment endpoints. |
| Routes | Request/response shapes, 202 replay, validation errors, raw webhook parsing before JSON parser, body limits, accurate parser HTTP errors, no secret fields in DTOs. |
| Idempotency | Same key/body, changed body, concurrent same key, different keys/same reference, transaction rollback, lost HTTP response after commit, TTL expiry with permanent reference guard. |
| Provider adapter | Pinned schema/account, card-only effective config, expected amount/currency, metadata correlation, timeout/429/5xx, same operation key reuse, late response and unknown outcomes. |
| Whop sandbox | Hosted checkout success/decline/3DS, closed/expired/reopened link, concurrent windows/different buyers, amount/currency controls, checkout return before webhook. Fail release if a link permits duplicate order charges. |
| Webhook signatures | Exact bytes/whitespace, wrong/missing signature/header, malformed base64, old/future timestamps, current/previous key, body size/encoding, signature-valid wrong account/version. |
| Provider inbox | Duplicate delivery same/different bytes, restart after persist, out-of-order events, processing lease lost, provider read fails; no success before verification. |
| Atomicity/races | Two backend processes on same DB, step-down/commit ambiguity, success+transaction+event all-or-none, duplicate provider transaction ID, payment/attempt allocation race, concurrent verification and webhook. |
| Application delivery | Consumer offline, 429/backoff, 5xx/timeout, wrong credentials, redirect rejected, DNS/private-address/rebinding, lease recovery, crash after consumer 2xx, same event replay, destination/key rotation. |
| Refunds | Full/partial, cumulative limits, concurrent reservations, provider timeout retains reservation, failed releases reservation, duplicate refund webhook, provider-dashboard refund, delayed success after refund; disabled feature route. |
| Reconciliation/audit | Unmatched/excess capture, missing callbacks, mismatched totals, durable manual replay audit, sanitized logs. |
| Deployment/regression | Payments disabled/no Mongo leaves management intact; DB loss isolates payment routes; shutdown stops jobs safely; restart resumes persisted work; build-backed SPA tests pass. |

Sandbox tests must never use live card numbers/keys and run separately from ordinary CI. No test should create a real charge merely to demonstrate connectivity. Test-only mock responses do not violate the prohibition on fake production analytics.

## 15. Implementation phases and acceptance gates

The steps below refer to the exact file groups in section 4. Idempotency/atomicity are implemented before any charge-capable rollout, not postponed to a final hardening phase.

| Phase | Files created / modified | Dependencies and steps | Acceptance criteria | Security considerations / risks |
| --- | --- | --- | --- | --- |
| 0. Approve provider and account assumptions | Create approved API/operations docs only. | Confirm own-product vs third-party merchant model, supported card currencies, tax/amount policy, Current API version and provider-enforced one-order checkout. | Decisions recorded; hosted-vs-tokenized flow chosen with evidence. | Reusable link can double-charge; account or currency assumptions block launch. |
| 1. Payment DB connection | Create config, db/connection, module entry, check-database script. Modify package/lock, index/app, env examples. | Add Mongoose; isolated credentials, explicit database; readiness/shutdown; replica-set probe. | Default model registry unused; unavailable DB prevents payment writes; gateway still works disabled. | Wrong database, URI logging, buffering, unsupported topology. |
| 2. Schemas and indexes | Create models, db/validators/indexes, setup script, money/IDs. | Phase 1; strict schemas/validators, explicit named indexes, integer money, model factory. | Duplicate/reference/index tests pass on replica set; migrations repeat safely. | Index rollout before traffic; precision/PII/TTL mistakes. |
| 3. Application auth and provisioning | Create auth/scopes/application service/repository, encryption, manage-application script/audit. | Phase 2; hashed keys, encrypted webhook keys, rotation/status/scopes, trusted destinations. | Cross-app access denied; secrets returned once during issuance; rotation/revocation verified. | Do not reuse super-admin key; protect signing key encryption and SSRF config. |
| 4. Domain acceptance and idempotency | Create payment/idempotency/state/event repositories/services, routes/controllers, DTOs. | Phases 2–3; creation transaction, reference guard, 202 contract, immutable intents. | Concurrent requests produce one payment/job; changed intent conflicts; no provider call yet. | Lost responses and TTL cannot cause duplicate payments. |
| 5. Durable workers and transaction tests | Create runner/providerJobs/providerInbox/reconciliation workers, job repository/lease operations. Modify bootstrap/shutdown. | Phase 4; lease/fencing/backoff, safe claim recovery, connection session handling. | Multi-instance workers survive crashes with no lost accepted work; commit tests pass. | In-memory scheduling alone insufficient; side effects outside transactions. |
| 6. Whop adapter and checkout | Create provider registry/contract/http client and Whop files. Optional dependency change. | Phases 0,4,5; pinned version/exact money, account checks, card-only checkout, provider keys. | Sandbox checkout and repeated/concurrent checkout gate passes; known request/error normalization. | No launch if one-order charge prevention unsupported; timeout never implies failure. |
| 7. Verified provider inbox and financial transitions | Create webhook controller/routes/verifier; complete verification/transaction/event services. Modify app raw parser order. | Phases 5–6; verify before durable acceptance, retrieve payment, atomic financial commit. | Duplicate/out-of-order events produce one fulfillment event; invalid signatures have no effects. | Raw-body corruption, account mismatch, delayed failure, partial financial commits. |
| 8. Reliable application delivery | Create signing/destination/delivery modules, delivery repositories/worker and replay script. | Phase 7; persisted outbox, attempts, retries, secrets, consumer integration spec. | Offline consumer later receives same signed event; multi-instance/replay/SSRF tests pass. | No fire-and-forget; at-least-once requires consumer inbox. |
| 9. Queries, readiness and reconciliation | Complete transaction/status/health routes and recovery worker, audit/redaction. | Phases 7–8; tenant-scoped queries, provider read recovery, backlog/health signals. | Tenant/currency filtering correct; unknown outcomes visible; missing callbacks detected. | No double-counting analytics; no zero-traffic outage claims or leaking provider data. |
| 10. Refund capability (separately enabled) | Create refund schema/service/repository/validator and worker operations; extend events/transitions. | Phases 6–9 plus provider refund sandbox proof. | Exact partial/full refunds; concurrent requests cannot over-reserve; unknown refunds recovered. | Stricter scopes, monetary limits, asynchronous confirmations; live feature initially off. |
| 11. First product integration | Create consumer integration/runbook docs; product changes only in separately approved scope. | Phases 0–9; choose one product, server-only key, order price validation, durable event inbox. | Sandbox purchase updates exactly one local order after verified event, survives duplicate delivery. | Payment service never activates subscriptions or marks product invoices itself. |
| 12. Production readiness and staged release | Modify render/env/docs; finish tests, provision indexes/secrets and operational alerts. | All enabled capability gates, backup/restore and recovery drill, always-running service. | All appropriate tests pass; restore tested; known pending operations survive rolling deploy; rollout limited by application. | Approval required for live enablement; creation pause must leave callback/drain paths running. |

Dependency policy: Mongoose is the required new runtime library. Prefer existing Zod/crypto/fetch and test tools; add exact JSON-money tooling only when dictated by the pinned provider format. A Whop SDK is optional, not an excuse to skip webhook/version/money checks. No DB/provider operations during frontend build.

## 16. Existing-code conflicts and decisions to approve

1. **No implemented Mongo/Mongoose architecture:** the requested existing pattern is absent. Add one isolated payment connection; do not pretend MONGODB_URI is already connected or create a main persistence layer unnecessarily.
2. **Unknown payment Mongo topology:** local SRV URI is only evidence of configuration. Dedicated URI/database/user and replica-set verification are prerequisites.
3. **Global super-admin key:** cannot identify consuming apps or enforce tenant isolation. Payment auth must be separate, with no automatic credential fallback.
4. **Global JSON parser:** would break raw-body signature verification. Register the provider raw route first with its own limits/error handling.
5. **In-memory cache/rate limiter:** not durable idempotency, locks, queues or shared quotas. Keep analytics caching; use Mongo for payment invariants and workers.
6. **GET-only analytics HTTP client:** cannot safely orchestrate payment POST retries. Add payment client with stable provider operation keys and explicit unknown states.
7. **Logs as audit:** insufficient for financial audit records. Add persistent financial/events/audit collections; sanitize global error messages on payment paths.
8. **Gateway health always healthy:** describes process liveness, not Mongo/Whop payment health. Add separate payment readiness and signals.
9. **No startup worker/DB lifecycle:** index.js needs bounded initialization/shutdown. Preserve app factory testability through dependency injection.
10. **Existing analytics money:** frontend/aggregation amounts use ordinary numbers. Do not reuse these for payment arithmetic. Any future payment-to-analytics conversion must explicitly document units/precision.
11. **Product revenue duplication:** adding payment totals to product analytics could double count. Defer that UI integration until source ownership is defined.
12. **Whop API documentation/version differences:** new adapter must bind one Current API contract; Legacy examples are not interchangeable.
13. **Reusable hosted checkout vs duplicate-charge guarantee:** this is a blocking provider capability check, not a Mongo schema fix. Approve Elements fallback only if needed and verified.
14. **Business/merchant scope:** clarify whether only Vijo's own sales or third-party merchant collections are in scope. The latter needs settlement/account ownership design.
15. **Refunds:** design is included, but capability remains disabled until independently validated and authorized.
16. **Retention and environment:** approve retention for PII, financial records, delivery diagnostics, replay snapshots, encryption-key rotation and deployment ownership; do not TTL-delete financial evidence by default.

### Step-by-step execution order for the next coding agent

1. Obtain approval of this plan and resolve phases 0/merchant ownership, exact-total policy, currency allowlist and hosted-checkout charge restriction.
2. Recheck repository HEAD, dirty files and local instructions; preserve unrelated changes.
3. Add disabled module configuration and payment-only Mongoose dependency/connection factory.
4. Provision an isolated test replica set/database user; verify topology and transaction support.
5. Implement explicit model factory, exact money/IDs, collection validators and unique indexes; test database binding and precision.
6. Implement application provisioning, hashed credentials, scopes, encrypted signing keys, trusted callbacks and durable audit.
7. Implement idempotent payment acceptance/reference uniqueness and durable provider jobs in one transaction; test concurrent HTTP creation before using Whop.
8. Implement leased worker/recovery infrastructure; prove crash/unknown-commit behavior across two instances.
9. Complete Whop contract/sandbox feasibility, pinned schema, exact conversion, stable provider keys and checkout adapter. Stop live rollout if duplicate checkout charges cannot be prevented.
10. Wire raw-body webhook verification/inbox before JSON parsing; implement verified atomic success/transaction/event/outbox transitions and regressive-event tests.
11. Implement signed application delivery, retries, attempt history, SSRF controls and a duplicate-safe consumer example.
12. Finish tenant-scoped reads, payment health, recovery/reconciliation, safe logs and dashboards/alerts only within approved scope.
13. Add refunds behind separate flag/scopes if approved; complete refund race and unknown-outcome tests.
14. Integrate one product in sandbox; verify local business update is transactional/idempotent and browser redirects cannot grant success.
15. Run existing gateway checks plus payment/replica-set/sandbox/security/recovery tests; review index plans and backup/restore.
16. Present verified implementation and operational runbook for live enablement approval; deploy disabled first, then enable one application and monitor. Preserve processing of accepted payments during any rollback.

No implementation should start until this plan has been reviewed and approved.
