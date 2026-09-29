# Nexvijo permanent Premium Blog Membership

The customer website is `vijo-flat-future`, with `/blog`, `/blog/posts/:slug` and `/blog/membership`. The Express backend remains in Vijo Management. All membership/customer/session/content collections use the existing payment MongoDB connection. Management administrator authentication is unchanged.

## Deployment order

Owner-verified access can run before automatic Whop integration is configured: set `MEMBERSHIPS_ENABLED=true`, `PAYMENTS_ENABLED=false`, the payment MongoDB settings, Resend settings, website origin and OTP pepper. This starts the membership database/API without provider checkout routes. Set up Whop credentials and product/plan IDs before enabling automatic purchase ingestion. No purchase is automatically verified in manual-only mode.

1. Configure the existing payment database and Whop settings. The database must be a replica set and must use the configured `PAYMENTS_MONGODB_DB_NAME`. Do not point this at a product database.
2. Configure `WHOP_PREMIUM_BLOG_PRODUCT_ID` and the comma-separated `WHOP_PREMIUM_BLOG_PLAN_IDS` from the actual USD 50 one-time Whop plan. Names/checkout URLs are not secure product identifiers. API key needs payment read and membership/email read permissions.
3. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to GradePoa's existing server-side Resend settings. The development machine has a private `.env.local` copy. These do NOT transfer to Render; configure them there separately. The sender remains the already verified GradePoa sender; changing it to a Nexvijo address requires domain verification in Resend first.
4. Generate a fresh `MEMBERSHIP_OTP_PEPPER` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it only server-side. Set `MEMBERSHIP_WEBSITE_ORIGIN=https://nexvijo.com`.
5. With `PAYMENTS_ENABLED=true`, run `pnpm memberships:setup`. This adds Mongo validators/indexes and publishes three original starter resources. Existing articles are never overwritten. Review/edit content in Management under Blog content. Existing provider inbox validation is migrated to permit membership-only events.
6. Set `MEMBERSHIPS_ENABLED=true` and restart the server. Keep `PAYMENTS_CREATION_ENABLED` unchanged: storefront membership imports do not require enabling the existing gated live-checkout creation flow. The existing server worker processes membership events automatically.
7. Register the existing `/api/v1/providers/whop/webhook` URL in Whop with the configured API version. Subscribe to payment success, membership activation/deactivation/cancellation changes and refund events. Keep the raw-body signature validation enabled.
8. Deploy the website with a same-origin reverse proxy for `/api/membership/*`, `/api/content/*`, `/api/premium/*` to the management backend. Preserve cookies, Origin and Set-Cookie. This avoids third-party cookie blocking. Ensure `/blog/*` falls back to the website's index.html. Local Vite already proxies these routes to port 4000 (set the backend website origin to the local Vite origin when testing).
9. If using a separate cross-site API origin instead, set the public website `VITE_MEMBERSHIP_API_URL` to that HTTPS origin and backend `MEMBERSHIP_COOKIE_SAME_SITE=none`; some browsers block third-party cookies, so a same-origin proxy is preferred. Do not use wildcard CORS.
10. Import existing purchases as described below, then test purchase → webhook → email code → premium article. Do not enable the feature before the database setup succeeds.

## Existing customer

The owner explicitly confirmed the purchase and authorized a manual entry. To record that attestation without fabricating Whop API verification:

```sh
pnpm memberships:grant-owner gsilkgallagher@gmail.com lacycribd0 2026-09-26
```

This only needs the payment database variables, not Whop credentials. It stores `paymentStatus=owner_verified`, USD 5000 minor units, permanent access, and an owner-attestation audit event. The purchase date is stored as a date-only field; no exact payment timestamp is invented. Access starts when granted. The operation is idempotent and does not undo subsequent revocation. No provider receipt or payment ID is invented. Email ownership must still be verified. When an actual matching payment is later imported, it can link to this entitlement.

For the customer supplied by the owner, obtain the actual Whop `pay_...` identifier. Then run:

```sh
pnpm memberships:import pay_ACTUAL_PROVIDER_ID gsilkgallagher@gmail.com
```

The command retrieves the payment and membership from Whop, checks the expected email, account, product, plan, successful payment and USD 50 amount. It creates one permanent membership and a unique verified receipt. Repeating the import is safe. A pasted screenshot/username is not treated as a provider verification. No card data is stored. The customer claims the entitlement by receiving and consuming a code at `/blog/membership`.

If needed, a legitimate manual grant is available in the management UI with an audit reason. It is labelled manual, not verified payment. Two paid provider payment IDs can be two financial receipts; repeated views/deliveries of the same payment ID are not extra revenue.

## Access and audit rules

- USD 50 one-time membership has no expiry date. Customer sessions expire after seven days; signing in again does not require another purchase.
- Receipt history and entitlement state are distinct. Full refunds suspend access; partial refunds retain access while a positive paid amount remains. This policy should be reviewed if business terms change.
- Only `active`/`completed` provider memberships qualify. An activation alone without a verified purchase does not grant access. Unknown state, wrong amount or missing identity goes to review rather than granting access.
- Explicit administrator revocation survives later provider webhooks. Grant/revoke requires an administrator session, allowed Origin and audit reason. Service API keys cannot perform these membership mutations.
- Login codes: eight digits, ten-minute expiry, five guesses, single use. Rate limits live in MongoDB. Codes are HMAC hashed with a dedicated pepper and are never persisted as plaintext. Resend submission is synchronous with an eight-second timeout; failure requires a new request after cooldown, not an undisclosed background email retry.
- Public lists contain only previews. Protected bodies are plain text rendered by React, not HTML/MDX. They never enter the public bundle. Responses are private/no-store.
- Worker reconciliation refreshes known memberships approximately every six hours. Import is required for old purchases whose events predate integration. Reconciliation does not discover all historical Whop customers automatically.
- Membership receipt data appears on the membership detail page; it is deliberately not mixed into application checkout revenue totals.

## Verification

`pnpm test:payments`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; website `pnpm build`.

Integration tests use an isolated Mongo replica set and test-only email/provider evidence. Production never falls back to test data or sends a test success.

Provider references: https://docs.whop.com/developer/guides/webhooks and https://docs.whop.com/api-reference/memberships/retrieve-membership. Email API: https://resend.com/docs/api-reference/emails/send-email.
