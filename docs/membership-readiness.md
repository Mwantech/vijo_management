# Membership service readiness

Administrator membership/content reads require the payment MongoDB connection and initialized indexes, not Resend or Whop credentials. Customer sign-in and automatic Whop fulfillment have separate readiness checks. Access controls still apply to every route.

Set these variables on the deployed server (local `.env` and `.env.local` files are not deployed):

- `PAYMENTS_MONGODB_URI`: existing payment database connection string; keep private.
- `PAYMENTS_MONGODB_DB_NAME`: exact database name in that URI, including case.
- `PAYMENTS_ENVIRONMENT=production`: must match the environment of existing records.

Customer email access is enabled by default in code, with `https://nexvijo.com` as the default website origin. Neither `MEMBERSHIPS_ENABLED` nor `MEMBERSHIP_WEBSITE_ORIGIN` is required. An explicit `MEMBERSHIPS_ENABLED=false` still disables customer login; remove that value or change it to `true` when enabling an existing deployment. Override the website origin for local development if needed.

Still configure `MEMBERSHIP_OTP_PEPPER` (stable random secret of at least 32 characters), `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` (verified sender) server-side. Missing credentials fail closed; code defaults do not replace secrets or database configuration. Do not rotate existing secrets merely to redeploy. Whop synchronization additionally requires the existing provider configuration and premium product/plan allowlist. Do not enable payment creation merely to read memberships.

After updating the deployment, request authenticated `GET /api/management/memberships/status`. This endpoint returns readiness and invalid/missing variable names, never secret values. It works even when the database is unavailable. The startup log `payment_services_status` also separates database, login and provider readiness.

If indexes are missing on a newly configured database, run `pnpm memberships:setup` against the intended database using the server environment. This provisions indexes/validators and inserts starter content; inspect the target before running. Never point production at a new empty database just to suppress an error.

Redeploy/restart after server environment changes. Existing manually configured Render services need environment values entered explicitly; adding entries to `render.yaml` does not prove those values are present in a running service.

An unreachable database still returns a real failure for record requests. It is not replaced by fake memberships or an empty-success response. A configured email provider or Whop client does not guarantee the external service is currently reachable.
