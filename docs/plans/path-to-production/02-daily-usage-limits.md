# Plan 02: daily usage limits

## Status

- Branch: `feature/daily-usage-limits`
- PR link: (pending opening)
- Date: 2026-11-19
- Summary: In progress; implementing UsageStore, quota middleware, HTTP routes, voice metering.
- Items needing attention:
  - `tests/helpers/fakeGemini.ts` only implements the WebSocket `live.connect` interface for Gemini Live; the turn-based chat endpoint tests mock `primaryAi.models.generateContent` directly with Vitest.

Branch: `feature/daily-usage-limits`. Depends on: 01.

Read first: plan 01, `src/server/rateLimiter.ts`, the `/api/chat`, `/api/tts`,
`/api/stt`, `/api/translate` handlers in `server.ts`, and in `liveBridge.ts` the
functions `attachLiveBridge` (`handleLiveUpgrade`, `reserveSlots`) and `runLiveCall`.

## Goal

Cap what each user can consume per day according to their tier, on the server, shared
across instances. Chat messages, helper requests (listen, translate, speech-to-text) and
voice-call seconds are counted separately.

## Decisions

| Question | Decision |
|---|---|
| Day | UTC calendar day, key `YYYY-MM-DD`. Resets at 00:00 UTC. |
| Storage | Firestore collection `usage`, document ID `<userId>_<day>`, with a TTL field so old days are deleted after 35 days. Memory store for dev and tests. |
| Chat and helpers | Reserve one unit before calling the model (atomic check-and-increment). Give it back if the provider call fails with a 5xx. |
| Voice | Wall-clock seconds from the WebSocket opening to it closing. Checked before the call starts; a timer ends the call when the allowance runs out; seconds are written every 30 s and at the end. |
| Over the limit | HTTP 429 with `code: 'QUOTA_EXCEEDED'`. WebSocket: event `{ type: 'quota_exceeded' }` then close code `4008`. |
| Switch | `QUOTAS_MODE=off` (default) counts nothing; `monitor` counts but never blocks; `enforce` blocks. Production goes `monitor` first, then `enforce`. |
| Usage in responses | `/api/me` gains `usage` and `resetsAt`. `/api/chat` responses gain `quota: { used, limit }` so the client can update its meter without another request. |

## Interfaces

`src/server/usageStore.ts`:

```ts
export type UsageCounter = 'chatMessages' | 'voiceSeconds' | 'helperRequests';
export type DailyUsage = Record<UsageCounter, number>;
export const EMPTY_USAGE: DailyUsage = { chatMessages: 0, voiceSeconds: 0, helperRequests: 0 };

/** "2026-11-18" for the UTC day containing nowMs. */
export function usageDay(nowMs: number): string
/** ISO time of the next 00:00 UTC after nowMs. */
export function nextResetAt(nowMs: number): string

export interface UsageStore {
  getUsage(userId: string, day: string): Promise<DailyUsage>;
  /** Add `amount` only if the result stays <= limit. Atomic. */
  tryConsume(userId: string, day: string, counter: UsageCounter, amount: number, limit: number):
    Promise<{ allowed: boolean; used: number }>;
  /** Add `amount` unconditionally (may be negative for a refund; never goes below 0). */
  add(userId: string, day: string, counter: UsageCounter, amount: number): Promise<void>;
  deleteAllUserUsage(userId: string): Promise<number>;
}
```

`src/server/quota.ts`:

```ts
export type QuotasMode = 'off' | 'monitor' | 'enforce';
export function quotasMode(env?: NodeJS.ProcessEnv): QuotasMode   // throws on any other value

/** Express middleware factory: reserve one unit of `counter` for req.account's tier. */
export function requireQuota(counter: 'chatMessages' | 'helperRequests', deps?: {
  store?: UsageStore; now?: () => number; mode?: QuotasMode;
})
```

`requireQuota` behaviour:
- `off`: call `next()`.
- Otherwise call `tryConsume(userId, usageDay(now), counter, 1, limits[counter])`.
- Store `{ counter, used, limit }` on `res.locals.quota`.
- Not allowed and mode `enforce`: respond
  `429 { error: 'Daily limit reached', code: 'QUOTA_EXCEEDED', counter, limit, tier, resetsAt }`.
- Not allowed and mode `monitor`: log one line `[Quota] over limit (monitor)` with tier
  and counter (no user ID) and call `next()`.
- Register `res.on('finish', …)`: if `res.statusCode >= 500` and a unit was consumed,
  call `store.add(userId, day, counter, -1)` (errors are logged, not thrown).
- If the store throws: log and call `next()` (fail open; a Firestore outage must not
  stop paying users).

## Steps (one commit each)

1. ✅ **`UsageStore`, in-memory store, contract tests.**
   `tests/helpers/usageStoreContract.ts` cases: empty usage is all zeros; `tryConsume`
   up to the limit succeeds and the next one fails without changing `used`; 20 parallel
   `tryConsume` calls with limit 10 allow exactly 10; `add` with a negative amount never
   goes below 0; different days and users are independent; `deleteAllUserUsage` removes
   every day for that user only. Also unit-test `usageDay` and `nextResetAt` at
   23:59:59 and 00:00:00 UTC.

2. ✅ **`FirestoreUsageStore`** (`src/server/firestoreUsageStore.ts`).
   - ✅ Document fields: `userId`, `day`, the three counters, `expiresAtTs`
     (Timestamp = day start + 35 days).
   - ✅ `tryConsume`: `runTransaction` (read, check, `set(..., { merge: true })`).
   - ✅ `add`: transaction too, clamping at 0.
   - ✅ `deleteAllUserUsage`: query `where('userId', '==', userId)`, delete in batches of 500.
   - ✅ Contract runs only with `FIRESTORE_TEST=1`.

3. ✅ **Store selection.** `src/server/defaultUsageStore.ts`, same pattern as plan 01 step 5.

4. ✅ **`quota.ts` with `requireQuota`**, tested with supertest on a tiny Express app:
   each mode; the 429 body; the refund on a 500; fail-open when the store rejects.

5. ✅ **Apply to HTTP routes** (`server.ts`).
   - ✅ `app.post('/api/chat', requireQuota('chatMessages'), …)`.
   - ✅ `requireQuota('helperRequests')` on `/api/tts`, `/api/stt`, `/api/translate`.
   - ✅ In the chat success response add `quota: res.locals.quota ?? null`.
   - ✅ Turn-based voice calls use these same routes, so they are covered.
   - ✅ Tests: with `QUOTAS_MODE=enforce` and dev user `anon-q`, the 6th `/api/chat` call
     returns 429 `QUOTA_EXCEEDED` (mock Gemini with `tests/helpers/fakeGemini.ts`).

6. **`/api/me` returns usage.** Add
   `usage: await defaultUsageStore.getUsage(userId, usageDay(Date.now()))` and
   `resetsAt: nextResetAt(Date.now())`. Make the handler `async` with try/catch like the
   session routes.

7. **Voice metering** (`liveBridge.ts`).
   - Add to `LiveBridgeOptions`: `accountStore?`, `usageStore?`, `quotasMode?`, `now?`.
   - In `handleLiveUpgrade`, after authentication and before `reserveSlots`:
     load the account (`accountStore.upsertFromAuth(user)`), compute `limits`, read
     today's usage, `remainingSec = limits.voiceSeconds - usage.voiceSeconds`. In
     `enforce` mode, if `remainingSec <= 0`, `rejectUpgrade(socket, 429, 'QUOTA_EXCEEDED')`.
   - Pass `remainingSec` (or `Infinity` when mode is not `enforce`) into `runLiveCall`.
   - In `runLiveCall`:
     - `const startedAt = now(); let recordedSec = 0;`
     - `flush()`: `const total = Math.floor((now() - startedAt) / 1000);` then
       `usageStore.add(userId, usageDay(now()), 'voiceSeconds', total - recordedSec)` and
       set `recordedSec = total`. Skip when mode is `off` or the delta is 0.
     - `setInterval(flush, 30_000)` (`unref()`), cleared in the existing `ws.on('close')`
       handler, which also calls `flush()` once more.
     - `setTimeout` for `remainingSec * 1000` (only when finite): send
       `{ type: 'quota_exceeded' }` and `ws.close(4008, 'Daily voice limit reached')`.
       Clear it on close.
   - Add `{ type: 'quota_exceeded' }` to the `LiveClientEvent` union.
   - Tests in `tests/liveBridge.test.ts` with fake timers and an in-memory usage store:
     upgrade is rejected with 429 when no seconds remain; a call with 10 s remaining gets
     `quota_exceeded` and close code 4008; closing after 45 s records 45 seconds in total;
     `off` mode records nothing.

8. **Config and docs.** `QUOTAS_MODE` in `.env.example`, README and `deploy.yml`
   (`QUOTAS_MODE=monitor`). Update the README "limits" paragraph.

## GCP setup

`gcloud firestore fields ttls update expiresAtTs --collection-group=usage --enable-ttl --project=<project>`

No composite index is needed (`userId ==` only).

## Rollout

1. Deploy with `QUOTAS_MODE=monitor`. For a few days check that `usage` documents look
   right and how often `[Quota] over limit (monitor)` is logged.
2. After plan 04 (the app can explain a limit) is live, set `QUOTAS_MODE=enforce`.
3. `--max-instances` can then go above 1; daily caps no longer depend on one instance.

## Cost

Per chat message: one transaction (1 read + 1 write). Per voice call: 1 read, then 1
write per 30 s. Well inside the Firestore free tier at launch volumes.
