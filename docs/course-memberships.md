# Product-specific course access

The existing payment MongoDB models and email-code sessions now support `premium_blog`,
`ai_training_premium`, and `ai_visual_mastery`. Each purchase grants only its own product.
The existing Premium Blog webhook allowlist is unchanged; automatic course fulfillment
is not enabled without verified Whop product/plan IDs and a reviewed tax-aware payment mapping.

Course delivery currently uses the owner's Whop product links. No Whop lesson content
has been copied into Nexvijo and no placeholder lessons are published as paid content.
After deployment, `/blog/membership` shows each customer's purchases and Whop access links.
Optional local course resources are listed at `/blog/courses/:plan`.

Admin content editing selects a required product. Both public-path and premium-path
article endpoints enforce that product for the full body. Course bodies are protected
even if an administrator incorrectly labels their visibility public. Public listings
contain previews only; old posts with no product remain blog resources.

## Owner-confirmed purchase imports

`node scripts/course-purchases.mjs preview /private/purchases.json` prints the exact emails
without sending or writing the database. A private JSON array contains `name`, `email`,
`plan`, `providerPaymentId`, `purchasedOn` (YYYY-MM-DD), `total`, `tax`, and `actor`.
Money values are strings of USD minor units. Product price plus tax must equal total.
Do not include card numbers, addresses, IP addresses, or provider credentials.

`record` records the owner's payment attestation and audit event. It does not pretend
to verify against Whop or create provider-verified receipts. Exact payment timezone
is not inferred from a screenshot; the purchase date is retained and access starts
when recorded. A unique payment-derived key handles concurrent/repeated imports,
and a repeated command never removes revocation. The supplied payment reference is
checked for ownership conflicts. Newly verified email sessions claim pending purchases.

`send` sends one product-specific email per purchase through the existing Resend sender
with Nexvijo branding. It requires recorded active access, reserves a unique audit key,
uses a provider idempotency key, and records the accepted email ID. A reserved send with
an unknown outcome must be checked in Resend before any manual retry. Do not delete
the reservation and blindly retry. `verify` retrieves the recorded emails' delivery
states without resending. Recipient input files stay outside version control.

## Deployment

Deploy Vijo Management and the Nexvijo website changes together before publishing local
course content. The existing `MEMBERSHIPS_ENABLED`, Resend, origin and OTP settings remain
required for Nexvijo email login. Whop access emails use the existing Whop links rather
than claiming new local pages are deployed. Customers must use their purchasing Whop
account; the product URL itself is public, not a personal access token.
