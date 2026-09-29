// Original, editable starter resources. Stored server-side; never bundled into the public website.
export const starterPosts = [
  { slug: 'welcome-to-the-nexvijo-library', title: 'Welcome to the Nexvijo technical library', category: 'Members-only updates', visibility: 'public',
    excerpt: 'A practical library for building dependable software: tutorials, architecture notes and learning roadmaps.',
    content: `Welcome to the Nexvijo library.

This is a place for builders who want to understand not only how a feature works, but why it is designed that way. The library covers practical software engineering, development roadmaps, technical documentation and AI learning resources.

How access works

Premium Blog Membership is a one-time USD 50 purchase through Whop. It provides permanent access to our premium library, with no recurring membership payment. After purchasing, open the membership page and enter the email you used at checkout. A short-lived email code verifies ownership of that address. Your membership is then linked to your Nexvijo customer record.

Our first premium resources cover reliable payment fulfillment and a structured roadmap for building an AI-assisted application. These are practical guides, not promises of guaranteed business outcomes. Additional resources can be published from the Nexvijo management dashboard.

If you cannot access a purchase, first check that you are using the checkout email. A checkout redirect is not proof of access: the backend must verify the purchase. Never send your card number, verification code or password to someone claiming to help with membership access.` },
  { slug: 'reliable-payment-fulfillment', title: 'From payment notification to dependable product access', category: 'Technical documentation', visibility: 'premium',
    excerpt: 'A practical design guide to separating payment confirmation from authorization, handling retries and preserving an audit trail.',
    content: `The problem

A customer pays, the browser redirects, and your application displays “success.” That is a useful user experience, but it is not a trustworthy fulfillment system. Browsers close, redirects can be replayed, and networks fail. Product access needs a durable backend decision.

1. Separate financial facts from access policy

A payment record answers whether money was collected. An entitlement answers whether a particular customer can use a resource now. They are related but different. A complimentary grant may provide access without a payment. A refunded purchase may still appear in the historical ledger while its entitlement is revoked.

Store both records and link them with stable identifiers. Avoid a single isPremium flag because it loses provider references, grant reasons and history. Keep monetary values in integer minor units and perform calculations with exact integer or decimal representations.

2. Design for repeated delivery

Treat webhooks as at-least-once notifications. Verify the signature against the original bytes, validate the provider account and event type, then persist an inbox item before acknowledging receipt. A unique provider-event key prevents two workers from handling the same delivery as two purchases.

An event ID alone is insufficient: two different provider events can describe the same purchase. Add a unique provider payment identifier to financial receipts and a unique provider membership identifier to memberships. Each index protects a different invariant.

3. Make fulfillment atomic

Within one database transaction, update the entitlement and append its audit event. If the operation fails, neither change should remain. Do not call a slow external provider inside a retried database transaction. Retrieve evidence first; apply that evidence using conditional state updates and provider version timestamps.

4. Resolve identity without inventing accounts

The checkout email can identify a pending entitlement, but the person opening your site must still prove ownership. Email-code verification can establish a customer identity without generating a password. Consuming the code must be atomic, expiry must be checked in the query, and unsuccessful guesses must consume a shared attempt budget.

Never move a claimed membership to another user because an incoming payload happens to contain a different email. Identity changes require an explicit recovery process.

5. Enforce access where the content is served

Hiding a button does not protect an API response. Read the customer from a verified session and check their entitlement before returning a premium body. Public article listings should project only titles, excerpts and categories. Do not include a premium article in a static bundle and attempt to conceal it with CSS.

6. Test the uncomfortable cases

Deliver the same event concurrently. Deliver cancellation after a stale activation event. Stop a worker after it writes a receipt but before acknowledgement. Reuse an email code. Revoke a membership while its customer remains logged in. For each case, assert database state and the protected HTTP response, not just a visible success message.

Completion checklist

The purchase has a verified provider identifier. The customer is linked only after ownership verification. Access checks use local database state. Duplicate events are harmless. Admin actions have a reason and actor. Failed fulfillment is visible and retryable. No secret or card data appears in logs.` },
  { slug: 'a-practical-ai-application-roadmap', title: 'A practical roadmap for your first AI-assisted application', category: 'AI learning resources', visibility: 'premium',
    excerpt: 'Build a small, measurable AI workflow with clear boundaries, useful evaluations and a safe release process.',
    content: `Start with a decision, not a model

Choose one narrow task: classify a support request, summarize a technical note, or suggest relevant documentation. Write down who uses the result, how they check it, and what happens when it is wrong. A workflow with a clear failure policy is easier to improve than a general-purpose assistant with undefined responsibilities.

Stage 1 — Establish a non-AI baseline

Collect a small, permissioned set of representative examples. Remove unnecessary personal data. Record what an acceptable answer looks like and build a simple keyword or template baseline. The baseline gives you something concrete to compare against and reveals whether the task needs a language model at all.

Stage 2 — Build one server-side model boundary

Keep credentials in the backend. Define a request schema, a response schema and a timeout. Limit input size and token expenditure. Treat model output as untrusted data: parse it, validate it and reject unexpected structures. Do not let generated text become a database query, shell command or privileged action without an independent validation layer.

Stage 3 — Add retrieval only when needed

If answers must use private documentation, begin with a small curated collection. Preserve document identifiers and versions. Apply access filters before retrieval, not after generating an answer. Retrieved documents are evidence, not instructions; they must not be able to override the application's permissions or system policy.

Stage 4 — Evaluate behavior before polishing the interface

Build cases for ordinary requests, ambiguous requests, missing information and adversarial text. Measure correctness, unsupported claims, latency and cost separately. A single average score hides important failures. Keep the same evaluation set while comparing prompts or models, and reserve unseen examples for a final check.

Stage 5 — Design human control

Let users inspect source references, correct an output and cancel a task. Start with suggestions instead of automated mutations. If an action affects money, account access or external communications, require explicit authorization and record an audit event. The model should not decide its own privileges.

Stage 6 — Release with limits

Use per-user quotas, bounded concurrency and provider timeouts. Show a useful failure state when the provider is unavailable. Keep request IDs for troubleshooting, but avoid retaining sensitive prompts by default. Track whether the workflow saves users time, not merely how many requests it processes.

Your first milestone

Ship one bounded workflow, a reproducible evaluation set, a clear privacy policy and a rollback switch. Only then expand the task. A smaller system with measurable behavior is a stronger foundation than a broad demo whose failures you cannot explain.` },
]
