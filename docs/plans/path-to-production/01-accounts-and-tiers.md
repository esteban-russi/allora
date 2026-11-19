# Plan 01: accounts and tiers

## Status

- Branch: `feature/accounts-and-tiers`
- PR link: not opened (in progress)
- Date: 2026-11-19
- Summary: In progress; adding account record, tier logic, AccountStore and GET /api/me.
- Items needing attention:
  - (none)

Branch: `feature/accounts-and-tiers`. Depends on: `feature/firestore-sessions` merged to `main`.

Read first: `src/server/auth.ts`, `src/server/sessionStore.ts`,
`src/server/firestoreSessionStore.ts`, `src/server/defaultSessionStore.ts`,
`tests/helpers/sessionStoreContract.ts`, and the middleware block in `server.ts`
(search for `authenticateHttpUser()`).

## Goal

Give every user a server-side account record and a tier (`guest`, `free`, `premium`), and
expose it to the client at `GET /api/me`. Nothing is limited or sold yet; later plans
read the tier from here.

## Scope

In scope: `isAnonymous` on the authenticated user, plan constants, an `AccountStore`
(memory + Firestore), a middleware that attaches the account to the request, `GET /api/me`.

Out of scope: counting usage (02), sign-in UI (03), writing subscriptions (05). The
subscription field exists here but is always `null` until 05.

## Decisions

| Question | Decision |
|---|---|
| Where accounts live | Firestore collection `users`, document ID = Firebase user ID. |
| Store selection | Reuse `SESSION_STORE` (`memory` or `firestore`). One switch for all stores. |
| How we know a user is a guest | ID token claim `firebase.sign_in_provider === 'anonymous'`. |
| When the record is created | Lazily, the first time an authenticated request arrives. |
| Tier | Computed on read from the record, never stored. |
| Guest records | Get `expiresAtTs` = last seen + 30 days (Firestore TTL). Removed from the record when the user is no longer anonymous. |
| Caching | The middleware caches each account in memory for 60 s to avoid a Firestore read per request. The cache entry is dropped whenever the store writes that user. |

## Data model

`src/server/accountStore.ts`:

```ts
export type Tier = 'guest' | 'free' | 'premium';

export interface Subscription {
  status: 'active' | 'grace' | 'expired';
  productId: string;                 // e.g. "parliamo_pro_annual"
  store: 'play_store' | 'web';
  periodType: 'trial' | 'normal';
  expiresAt: string;                 // ISO time
  willRenew: boolean;
  updatedAt: string;                 // ISO time
}

export interface Account {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  subscription: Subscription | null; // null until plan 05 writes it
  createdAt: string;                 // ISO time
  lastSeenAt: string;                // ISO time
}

export interface AccountStore {
  /** Create the record if missing; update email/isAnonymous/lastSeenAt if they changed. */
  upsertFromAuth(user: { userId: string; email?: string; isAnonymous: boolean }): Promise<Account>;
  getAccount(userId: string): Promise<Account | null>;
  setSubscription(userId: string, subscription: Subscription | null): Promise<void>;
  deleteAccount(userId: string): Promise<boolean>;
}
```

`upsertFromAuth` rules:
- Missing record: create it with `subscription: null`.
- Existing record: only write when `email` or `isAnonymous` differ, or `lastSeenAt` is
  older than 24 h (avoids a write on every request).
- Firestore document also carries `expiresAtTs` (Timestamp, last seen + 30 days) when
  `isAnonymous` is true, and the field is deleted (`FieldValue.delete()`) when false.

`src/server/plans.ts`:

```ts
export interface PlanLimits { chatMessages: number; voiceSeconds: number; helperRequests: number; }

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  guest:   { chatMessages: 5,   voiceSeconds: 2 * 60,  helperRequests: 30 },
  free:    { chatMessages: 15,  voiceSeconds: 5 * 60,  helperRequests: 100 },
  premium: { chatMessages: 300, voiceSeconds: 60 * 60, helperRequests: 1000 }
};

/** Premium while the subscription is active or in grace and not past expiresAt. */
export function tierFor(account: Account, nowMs: number): Tier
```

`tierFor`: return `premium` when `subscription` is not null, `status` is `active` or
`grace`, and `Date.parse(expiresAt) > nowMs`; otherwise `guest` when `isAnonymous`, else `free`.

## Steps (one commit each)

1. ✅ **`isAnonymous` on `AuthenticatedUser`** (`src/server/auth.ts`).
   - ✅ Add `isAnonymous: boolean` to the interface.
   - ✅ In `verifyIdToken`, for Firebase tokens read
     `(payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider`
     and set `isAnonymous` to `true` when it equals `'anonymous'`. Google Identity tokens: `false`.
   - ✅ Dev users (dev tokens, `x-dev-user-id`, `devUserId` query): `isAnonymous` is `true`
     when the user ID starts with `anon-`, else `false`.
   - ✅ Tests in `tests/auth.test.ts`: a signed token with `firebase.sign_in_provider`
     `anonymous` gives `true`; `google.com` gives `false`; dev ID `anon-1` gives `true`.

2. ✅ **Plan constants and `tierFor`** (`src/server/plans.ts`, `tests/plans.test.ts`).
   Test every branch: no subscription, active, grace, expired status, active but past
   `expiresAt`, anonymous with an active subscription (premium wins).

3. **`AccountStore` interface, `InMemoryAccountStore`, contract tests.**
   - Put the interface, types and the in-memory class in `src/server/accountStore.ts`.
     Inject `now: () => number` in the constructor, as `InMemorySessionStore` does.
   - Add `tests/helpers/accountStoreContract.ts` exporting
     `runAccountStoreContract(name, makeStore)`, modelled on `sessionStoreContract.ts`.
     Cases: create on first upsert; second upsert with the same data does not change
     `createdAt`; changing `isAnonymous` from true to false updates the record and keeps
     `subscription`; `setSubscription` then `getAccount` returns it; `setSubscription`
     for an unknown user creates nothing and does not throw; `deleteAccount` returns
     true then false.
   - `tests/accountStore.test.ts` runs the contract against the in-memory store.

4. **`FirestoreAccountStore`** (`src/server/firestoreAccountStore.ts`).
   - Constructor `(db: Firestore, options: { collectionName?: string; now?: () => number })`,
     default collection `users`.
   - `upsertFromAuth` runs in `db.runTransaction` (read, compare, write only if needed).
   - `tests/firestoreAccountStore.test.ts`: run the contract only when `FIRESTORE_TEST=1`,
     in a throwaway collection, exactly like `tests/firestoreSessionStore.test.ts`.

5. **Store selection** (`src/server/defaultAccountStore.ts`).
   `createAccountStore(env)` mirrors `createSessionStore`; export `defaultAccountStore`.
   Test it like `tests/defaultSessionStore.test.ts`.

6. **Account middleware** (`src/server/accountMiddleware.ts`).
   ```ts
   export interface RequestAccount { account: Account; tier: Tier; limits: PlanLimits; }
   export function attachAccount(store: AccountStore, options?: { cacheMs?: number; now?: () => number })
   export function invalidateAccountCache(userId: string): void
   ```
   - Runs after `authenticateHttpUser()`; needs `req.user`.
   - Looks in a `Map<userId, { value: RequestAccount; expiresAt: number }>`; on a miss or
     when `req.user.isAnonymous !== cached.account.isAnonymous`, calls `upsertFromAuth`.
   - Sets `req.account` (extend the Express `Request` type next to `user` in `auth.ts`).
   - If the store throws, log with `summarizeError` and respond 503
     `{ error: 'Account service unavailable', code: 'ACCOUNT_UNAVAILABLE' }`.
   - Tests with supertest and an in-memory store: record is created; second request
     within 60 s does not call the store (spy); anonymous→signed-in change bypasses the cache.

7. **Wire it and add `GET /api/me`** (`server.ts`).
   - Add `/api/me` to both path lists (the `rateLimit` one and the
     `authenticateHttpUser()` one), and append `attachAccount(defaultAccountStore)` to
     the second `app.use([...])` call, after the user rate limiter.
   - Route:
     ```ts
     app.get('/api/me', (req, res) => {
       const { account, tier, limits } = req.account!;
       res.json({
         userId: account.userId, email: account.email, isAnonymous: account.isAnonymous,
         tier, limits,
         subscription: account.subscription && {
           status: account.subscription.status, productId: account.subscription.productId,
           store: account.subscription.store, periodType: account.subscription.periodType,
           expiresAt: account.subscription.expiresAt, willRenew: account.subscription.willRenew
         }
       });
     });
     ```
   - `tests/server.test.ts`: `GET /api/me` with dev user `anon-1` returns tier `guest`
     and the guest limits; with dev user `u1` returns `free`.

8. **Docs.** README: add `/api/me` to the endpoint list and `accountStore`, `plans`,
   `accountMiddleware` to the project structure.

## GCP setup (before deploying)

1. TTL for guest records:
   `gcloud firestore fields ttls update expiresAtTs --collection-group=users --enable-ttl --project=<project>`
2. No new IAM: the runtime service account already has `roles/datastore.user`.

## Acceptance

- In production, opening the app creates one `users/<uid>` document with `isAnonymous: true`.
- `GET /api/me` returns `tier: "guest"`.
- No extra Firestore read on the second chat message within a minute (check with a spy test, not in production).
