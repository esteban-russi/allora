# Plan 05: billing backend (RevenueCat → subscription on the account)

## Status

- Branch: `feature/billing-backend`
- PR link: (pending opening)
- Date: 2026-11-19
- Summary: In progress.
- Items needing attention:
  - 🟠 Owner setup: Create RevenueCat project, entitlement \`premium\`, and offering \`default\` with packages \`$rc_monthly\` and \`$rc_annual\`.
  - 🟠 Owner setup: Create \`revenuecat-secret-key\` and \`revenuecat-webhook-auth\` secrets in Secret Manager and grant \`roles/secretmanager.secretAccessor\` to runtime SA (\`parliamo-italiano-runtime@corso-di-italiano-496920.iam.gserviceaccount.com\`).
  - 🟠 Owner setup: Configure RevenueCat webhook to \`https://parliamo-italiano-562781327825.europe-west1.run.app/api/webhooks/revenuecat\` with matching \`Authorization: Bearer <token>\`.

Branch: `feature/billing-backend`. Depends on: 01 (and 03 for the delete hook).

Read first: plan 01, `src/server/accountStore.ts`, `src/server/plans.ts`,
`src/server/accountMiddleware.ts`, `src/server/accountRoutes.ts`.

Before coding, open the current RevenueCat docs for **Webhooks** and **REST API v1
`GET /v1/subscribers/{app_user_id}`** and check the field names used below. If a name
differs, follow the docs and note it in the PR description.

## Goal

The server knows whether a user has an active subscription, whichever store sold it.
RevenueCat is the source of truth; the server copies the state onto `users/<uid>.subscription`,
which `tierFor` (plan 01) already reads.

## Decisions

| Question | Decision |
|---|---|
| RevenueCat app user ID | The Firebase user ID. Clients always configure the SDK with it; purchases are never made as an anonymous RevenueCat user. |
| Entitlement | `premium`. |
| How state reaches us | (a) RevenueCat webhook, (b) `POST /api/billing/sync` called by the app right after a purchase or restore and on start when a subscription looks expired. Both do the same thing: fetch the subscriber from the RevenueCat REST API and store the result. |
| Why re-fetch instead of trusting the event | Events can arrive late, twice or out of order. Fetching current state makes the handler idempotent with no event log. |
| Webhook authentication | RevenueCat sends a fixed `Authorization` header value that we choose. Compare with `timingSafeEqual`. |
| Secrets | `REVENUECAT_SECRET_KEY` (REST API secret key) and `REVENUECAT_WEBHOOK_AUTH`, both in Secret Manager, mounted as env vars by Cloud Run. |
| Sandbox purchases | Accepted (licence testers and Stripe test mode need them). Only accounts on the Play licence-tester list can make them. |
| Clock tolerance | `tierFor` treats a subscription as valid until `expiresAt` + 1 hour, because the renewal event can land slightly after the old period ends. |
| Billing not configured | Without `REVENUECAT_SECRET_KEY` the sync route returns 503 `BILLING_UNAVAILABLE` and the webhook returns 503. Local dev needs no RevenueCat account. |

## Mapping RevenueCat → `Subscription`

Input: `subscriber` from `GET https://api.revenuecat.com/v1/subscribers/{userId}`
(header `Authorization: Bearer <REVENUECAT_SECRET_KEY>`).

```
ent = subscriber.entitlements.premium
if ent is missing → null

sub        = subscriber.subscriptions[ent.product_identifier]   (may be missing)
expires    = ent.expires_date                                   (ISO string; null = lifetime, treat as year 9999)
graceUntil = ent.grace_period_expires_date                      (ISO string or null)

status     = now < expires                     → 'active'
             graceUntil and now < graceUntil   → 'grace'
             otherwise                         → 'expired'
expiresAt  = status === 'grace' ? graceUntil : expires
productId  = ent.product_identifier
store      = sub?.store === 'play_store' ? 'play_store' : 'web'
periodType = sub?.period_type === 'trial' ? 'trial' : 'normal'
willRenew  = !sub?.unsubscribe_detected_at && !sub?.billing_issues_detected_at
managementUrl = subscriber.management_url ?? null
updatedAt  = now (ISO)
```

Add `managementUrl: string | null` to the `Subscription` interface from plan 01 and to
the `/api/me` response.

## Steps (one commit each)

1. ✅ **Clock tolerance in `tierFor`.** Add `export const SUBSCRIPTION_SKEW_MS = 60 * 60 * 1000`
   to `plans.ts`, use `Date.parse(expiresAt) + SUBSCRIPTION_SKEW_MS > nowMs`, update tests.

2. ✅ **RevenueCat client** (`src/server/revenueCat.ts`).
   ```ts
   export interface RevenueCatClient {
     /** Raw `subscriber` object, or null when RevenueCat answers 404. Throws on other errors. */
     getSubscriber(userId: string): Promise<Record<string, unknown> | null>;
     deleteSubscriber(userId: string): Promise<void>;
   }
   export function createRevenueCatClient(secretKey: string, fetchImpl?: typeof fetch): RevenueCatClient
   export function toSubscription(subscriber: Record<string, unknown>, nowMs: number): Subscription | null
   ```
   - `encodeURIComponent(userId)` in the URL; 10 s timeout with `AbortSignal.timeout`.
   - Never log the response body or the key.
   - `tests/revenueCat.test.ts`: `toSubscription` for active, trial, cancelled-but-still-active
     (`willRenew` false), billing issue in grace, expired, no entitlement, lifetime, unknown
     store; `getSubscriber` with a fake `fetch` for 200, 404 and 500.

3. **Sync function** (`src/server/billingSync.ts`).
   ```ts
   export async function syncSubscription(userId: string, deps: {
     revenueCat: RevenueCatClient; accounts: AccountStore; now: () => number;
   }): Promise<Subscription | null>
   ```
   - Ignore IDs starting with `$RCAnonymousID:` (return null, write nothing).
   - `getSubscriber` → `toSubscription` → `accounts.setSubscription(userId, sub)` →
     `invalidateAccountCache(userId)` → return `sub`.
   - `setSubscription` for a user with no account record is a no-op (plan 01 contract),
     so an event for a deleted account does nothing.
   - Tests with a fake client and the in-memory account store.

4. **`POST /api/billing/sync`** (authenticated; add `/api/billing` to both middleware
   path lists; handlers in `src/server/billingRoutes.ts`).
   - Guests: `403 { code: 'SIGN_IN_REQUIRED' }`.
   - Call `syncSubscription(req.user.userId)`; respond
     `{ tier, subscription }` (tier recomputed with `tierFor`).
   - RevenueCat failure: `502 { code: 'BILLING_UPSTREAM_ERROR' }`.

5. **`POST /api/webhooks/revenuecat`** (not behind user auth; register it before the
   authenticated block; it uses the global `express.json` parser and the IP rate limiter).
   - Missing config → 503. Wrong or missing `Authorization` header → 401 (constant-time compare
     of equal-length buffers; unequal length is a mismatch).
   - Body: `{ event: { id, type, app_user_id, original_app_user_id, aliases, transferred_from, transferred_to } }`.
     Not an object or no `event` → 400.
   - Collect user IDs: `app_user_id`, `original_app_user_id`, every entry of `aliases`,
     `transferred_from`, `transferred_to`; keep strings only; de-duplicate; cap at 20.
   - `type === 'TEST'`: respond 200 without syncing.
   - `await Promise.allSettled(ids.map(syncSubscription))`. If **any** rejected, respond
     500 so RevenueCat retries; otherwise `200 { ok: true }`.
   - Log one line per event: type and how many IDs were synced. No user IDs.
   - Tests: auth cases; a purchase event sets the subscription; an expiration event sets
     `expired`; a transfer syncs both users; upstream failure gives 500; `TEST` gives 200.

6. **Delete hook.** In `DELETE /api/account` (plan 03) call
   `revenueCat.deleteSubscriber(userId)` in try/catch after the stores are cleared (log on
   failure, do not fail the request). Skip when billing is not configured.

7. **Client: sync on start.** In `useAccount` (plan 03), after the first `fetchMe`: if
   `me.subscription` exists and `Date.parse(me.subscription.expiresAt) < Date.now() + 3600_000`,
   call `POST /api/billing/sync` once and use its result. This repairs a missed webhook.

8. **Config and docs.**
   - `.env.example`: `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` (commented, with a note).
   - `deploy.yml`: add to the `deploy-cloudrun` step
     ```yaml
     secrets: |-
       REVENUECAT_SECRET_KEY=revenuecat-secret-key:latest
       REVENUECAT_WEBHOOK_AUTH=revenuecat-webhook-auth:latest
     ```
   - `/api/health`: add `billing: Boolean(process.env.REVENUECAT_SECRET_KEY)`.
   - README: endpoints and setup.

## Setup (owner)

1. RevenueCat: create the project; entitlement `premium`; offering `default` with packages
   `$rc_monthly` and `$rc_annual` (products are attached in plans 06 and 09).
2. RevenueCat → API keys: create a **secret** key (v1). Store it:
   `printf '%s' '<key>' | gcloud secrets create revenuecat-secret-key --data-file=- --project=<project>`
3. Choose a long random string for the webhook:
   `openssl rand -hex 32 | tr -d '\n' | gcloud secrets create revenuecat-webhook-auth --data-file=- --project=<project>`
4. `gcloud secrets add-iam-policy-binding <each secret> --member=serviceAccount:<runtime SA> --role=roles/secretmanager.secretAccessor`
5. After deploying: RevenueCat → Integrations → Webhooks → URL `<APP_URL>/api/webhooks/revenuecat`,
   Authorization header = `Bearer <the random string>` (store the secret **with** the
   `Bearer ` prefix, or compare against `Bearer ${secret}`; pick one and test it), all events,
   production and sandbox. Press "Send test event" and expect 200.

## Acceptance

- "Send test event" returns 200; a wrong header returns 401.
- With a sandbox purchase made for user X (plan 06 or 09), `users/X.subscription.status`
  becomes `active` within seconds and `/api/me` reports `premium`.
- Cancelling keeps `premium` until `expiresAt` with `willRenew: false`; after expiry the tier is `free`.
