# Centralized payment administration

Navigation → Payments provides `/payments` (analytics and payment records) and `/payments/transactions` (posted financial ledger). The existing product `/revenue` and `/transactions` pages remain unchanged.

These pages use the isolated payment MongoDB connection, not mock data or product database connections. Session-authenticated `super_admin`, `admin`, and `finance` users can access the matching read-only `/api/management/payments/{applications,analytics,records,transactions}` endpoints. Application keys do not grant management access. Reads are audited without logging secrets or card data.

Filters: application public ID, currency, from-inclusive/to-exclusive UTC range; payment status on records, transaction type on ledger. Lists are paginated on the server (20 default, 100 maximum). Payment metrics use payment creation time; financial totals use transaction occurrence time. Amounts stay Decimal128/integer minor-unit strings through aggregation and BigInt display. Totals are separated by currency and transaction type. A disabled/unavailable database produces an explicit error, not fake zeros. Refresh is manual, with 30-second frontend caching and no continuous dashboard polling.

## GoodScenes: pull-based integration

Whop's webhook is **only** `/api/v1/providers/whop/webhook` on Vijo Management. Provision GoodScenes without `webhookUrl`; it needs no inbound webhook or webhook secret. The payment service still records lifecycle events but does not enqueue deliveries for applications with notifications disabled.

For existing applications configured with a webhook, run:

```sh
pnpm payments:application pull app_YOUR_APPLICATION_ID
```

This audited command disables outbound webhooks and invalidates the prior destination version. Existing delivery records remain for audit; workers will pause obsolete deliveries. It does not disable payment access or change credentials.

GoodScenes needs `VIJO_PAYMENTS_API_URL` and reuses its existing `VIJO_MANAGEMENT_API_KEY` / `VIJO_MANAGEMENT_API_SECRET`. Management verifies against `GOODSCENES_MANAGEMENT_API_KEY` / `GOODSCENES_MANAGEMENT_API_SECRET`. No new payment client credentials or Whop secrets are installed on GoodScenes. Credentials must be unique per product and environment.

### Enable management-key authentication

Run these on the management backend after configuring its payment database/provider settings:

```sh
pnpm payments:setup
pnpm payments:application bind-management app_YOUR_GOODSCENES_APPLICATION_ID goodscenes
```

Restart the management backend after setup so it verifies the new indexes. The binding is explicit, unique and audited. It preserves the application/payment IDs and clears old payment-only credentials; API-key-only requests cannot bypass signing on a bound application. No database or production credentials are modified automatically by this code change.

For new application provisioning, include `"managementPlatform": "goodscenes"` in the `create` JSON. It uses the existing configured management pair and does not issue a new payment API key. Product/return URL, currency, limits and scopes still need registration; possession of an analytics key alone does not automatically grant financial access. Unbound non-platform clients retain the existing authentication path for compatibility.

### Signed request protocol

Headers: `X-Management-Platform`, `X-Management-Key`, `X-Management-Timestamp` (milliseconds), `X-Management-Nonce` (UUID), `X-Management-Signature` (hex HMAC SHA256). Sign newline-separated `vijo-payments-request-v1`, platform, timestamp, nonce, HTTP method, exact path plus query, SHA256 hex of raw body bytes (empty for GET), and idempotency key (empty if absent).

The payment-specific marker prevents analytics signatures from authorizing payment operations. Body and idempotency-key changes invalidate signatures. Verification uses timing-safe comparison and a five-minute skew window. A unique MongoDB nonce record prevents replay across backend instances; ten-minute TTL cleanup is storage maintenance, not the authorization clock check. Retries must have a fresh nonce while keeping the original payment idempotency key. Missing nonce storage/indexes fail closed. Revocation uses the existing application status; rotate the management key/secret on both servers, not `payments:application rotate`, for bound applications.

The GoodScenes backend automatically checks persisted, uncredited purchases and applies its own token-wallet business logic. Whop verification, provider retries, payment state and financial records stay in this service.

Live checkout remains subject to the existing single-charge safety gate. This UI does not bypass it or implement refunds/mutations. Complete sandbox and real-database fulfillment testing before enabling production collection.
