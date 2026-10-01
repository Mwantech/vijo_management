# Membership verification emails

Memberships → Send email lets an authenticated admin/super-admin search existing
course purchases, preview a fixed server-owned message, and send it through Resend.
Finance, support, viewers and API-key-only callers cannot send these emails.
Mutations require a permitted Origin. Recipients are taken from the stored membership,
not an arbitrary browser email field. Only active owner-confirmed/provider-verified
course purchases qualify. Manual access grants alone are not proof of purchase.

The template thanks the purchaser, links to `/blog/membership` for email-code verification,
and says the team will **manually** email the full Google Drive course link afterward.
Support and refund requests go to `company@nexvijo.com`, also set as Reply-To.
The verified Resend sender remains unchanged, with Nexvijo display branding.
No automatic refund promise, Drive attachment, or invented course link is included.

Preview and send share the same template and a hash. Changed preview data requires
another preview. A unique MembershipEvent key deduplicates invitations by environment,
email, product and template version, even across duplicate purchase records. MongoDB
rate buckets restrict admin sends. Reservation and accepted-provider-ID events provide
an audit trail. A timeout/unknown outcome blocks blind retries: inspect the provider
before retrying manually. Accepted is not delivered; check Resend using the recorded ID.

History shows current verified-email and access status. Before manual fulfillment,
confirm access is still active. Do not send course links to revoked/unpaid customers.
Drive sharing permissions are managed by the team; verification does not automatically
create Drive permissions or guarantee a shared link is non-transferable.

## Operational batch

`node scripts/membership-invitations.mjs prepare /private/batch.json` records explicitly
owner-confirmed purchases only where no email/product membership exists. Existing
memberships are reused without altering payment state or revocation. No provider payment
IDs or provider-verified receipts are fabricated when IDs are absent. Purchase evidence
is audited and repeated screenshot rows are not counted as additional charges.

Commands `preview`, `send`, and `verify` use the same mail service as the UI. Keep private
recipient JSON outside Git. The Oct 1 batch contains 11 proposed invitations to 9 people:
seven confirmed visual-course purchases plus Rocco and Christina's two courses each.
Artem's failed training payment is excluded. Training rows for alienpoplar, Christopher,
and jazzymarvel12 need confirmation of successful payment before inclusion.

Before sending, check live `/blog/membership` and `/api/membership/me`. Unauthenticated
`/me` should return 401, not 503. Configure `MEMBERSHIPS_ENABLED=true`,
`MEMBERSHIP_WEBSITE_ORIGIN=https://nexvijo.com`, `MEMBERSHIP_OTP_PEPPER`, `RESEND_API_KEY`,
and `RESEND_FROM_EMAIL` on the backend and verify actual email-code delivery using an
authorized test account. Never send customers to a known broken verification flow.
