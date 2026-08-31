# Vijo Management

Centralized operations and analytics frontend for GradePoa, GoodScenes, HMS and VijoPOS.

## Local development

```bash
cp .env.example .env.local
pnpm install
pnpm dev:all
```

`pnpm dev:all` starts the Vijo Management API on port `4000` and the Vite frontend. The dashboard uses real `/api/management` responses only; there is no mock fallback.

Run the API alone with:

```bash
pnpm dev:api
```

Configure product backend URLs with `GRADEPOA_API_URL`, `GOODSCENES_API_URL`, `HMS_API_URL` and `VIJOPOS_API_URL`. Product credentials and HMAC secrets are read only by the server; do not create `VITE_` variables for them.

## Production environment

Use [.env.production.example](./.env.production.example) as the production variable checklist. Configure these values in the hosting provider's encrypted environment/secret settings rather than committing a populated `.env` file.

Generate a bcrypt password hash without placing the password in a command argument:

```bash
pnpm password:hash
```

Paste the result into `MANAGEMENT_ADMIN_PASSWORD_HASH`. Production rejects the development-only `MANAGEMENT_ADMIN_PASSWORD` value.

Generate the session secret, gateway caller key, and four unique platform credential pairs with:

```bash
pnpm secrets:generate
```

The command prints private values once. Copy them directly to the relevant deployment secret stores and do not commit or expose the output in any `VITE_*` variable.

For a single Render Web Service, use:

```text
Build Command: pnpm install --frozen-lockfile && pnpm build
Start Command: pnpm start
Health Check Path: /api/health
```

Do not use `pnpm dev:all` in production. The production server serves both the compiled React application and `/api/management` from one origin. Leave `VITE_MANAGEMENT_API_URL` unset (or empty) for this deployment model. Render supplies `PORT`; the server binds to it on `0.0.0.0`.

The deployment configuration currently points to:

| Platform | Backend |
| --- | --- |
| GradePoa | `https://gradepoa.onrender.com` |
| GoodScenes | `https://getgoodscenes.onrender.com` |
| HMS | `https://bensmma.onrender.com` |
| VijoPOS | `https://point-of-sale-system-cbew.onrender.com` |

Each product must be deployed with its new `/internal/management/*` routes. Every enabled production integration requires its own API key and HMAC secret. Only the corresponding gateway adapter and product backend share a pair:

| Gateway variable | Matching product deployment variable |
| --- | --- |
| `GRADEPOA_MANAGEMENT_API_KEY` | GradePoa `MANAGEMENT_API_KEY` |
| `GRADEPOA_MANAGEMENT_API_SECRET` | GradePoa `MANAGEMENT_API_SECRET` |
| `GOODSCENES_MANAGEMENT_API_KEY` | GoodScenes `MANAGEMENT_API_KEY` |
| `GOODSCENES_MANAGEMENT_API_SECRET` | GoodScenes `MANAGEMENT_API_SECRET` |
| `HMS_MANAGEMENT_API_KEY` | HMS `MANAGEMENT_API_KEY` |
| `HMS_MANAGEMENT_API_SECRET` | HMS `MANAGEMENT_API_SECRET` |
| `VIJOPOS_MANAGEMENT_API_KEY` | VijoPOS `MANAGEMENT_API_KEY` |
| `VIJOPOS_MANAGEMENT_API_SECRET` | VijoPOS `MANAGEMENT_API_SECRET` |

Do not reuse one pair across platforms. Independent pairs limit the impact of a leak and allow one integration to be revoked or rotated without taking all products offline. The top-level gateway `MANAGEMENT_API_KEY` is different again: it authenticates trusted non-browser callers to the Vijo Management API and is never sent to product backends.

Browser administrators authenticate through:

```text
POST /api/management/auth/login
GET /api/management/auth/me
POST /api/management/auth/logout
```

The API sets an HTTP-only `vijo_management_session` cookie. Server-to-server callers can use `X-Management-Api-Key: <MANAGEMENT_API_KEY>`. Product backend tokens/API keys are only used by the server-side platform adapters.

## Integration boundary

Set `VITE_MANAGEMENT_API_URL` to the centralized backend. The browser only calls `/api/management` endpoints; it never connects to product databases or receives service credentials. Requests use secure cookie credentials by default.

Normalized contracts live in `src/types/models.ts`. Isolated product adapters and mappers live in `server/platforms`. The gateway uses bounded retries for safe GET requests, upstream timeouts, short-lived analytics caches with single-flight deduplication, request IDs, structured logs, audit events, validation, strict CORS, rate limiting, and partial failure responses. It never falls back to fake analytics.

Backend-enforced RBAC supports `super_admin`, `admin`, `finance`, `support` and `viewer`. Production browser login requires `MANAGEMENT_ADMIN_PASSWORD_HASH`; plain `MANAGEMENT_ADMIN_PASSWORD` is development-only. API clients can use `X-Management-Api-Key`.

Product internal routes are:

```text
GET /internal/management/summary
GET /internal/management/analytics
GET /internal/management/users
GET /internal/management/users/:id
GET /internal/management/revenue
GET /internal/management/revenue/timeseries
GET /internal/management/subscriptions   # where supported
GET /internal/management/transactions
GET /internal/management/activity
GET /internal/management/health
```

Only public configuration belongs in Vite environment variables. Database credentials, private API keys, admin secrets and service-to-service tokens must remain in the backend.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
