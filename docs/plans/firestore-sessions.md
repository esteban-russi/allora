# Plan: learner sessions in Firestore

## Goal

Keep learner sessions (settings, progress, last 50 checkpointed turns, Live resumption
handle) across restarts, deploys and scale-to-zero, and share them between Cloud Run
instances so `--max-instances` can go back above 1.

Today `InMemorySessionStore` loses every session whenever the instance stops, so the
30-day retention and GDPR delete only hold while one instance stays up.

## Scope

In scope:
- A `FirestoreSessionStore` implementing the existing `SessionStore` interface
  (`src/server/sessionStore.ts`). Routes, `liveBridge.ts` and `maintenance.ts` keep
  calling the interface and do not change behaviour.
- Choosing the store from the environment.
- GCP setup: database, TTL policy, index, IAM.
- Raising `--max-instances` again once deployed and checked.

Out of scope (stay in memory, per instance):
- Rate limits. With N instances a user can get up to N× the limits in the worst case;
  session affinity keeps most users on one instance. Accepted for now.
- Live calls in progress, Vertex cooldown, metrics.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Database | `(default)` Firestore database, Native mode | Free tier covers expected use; no server to run; same project and IAM as the rest. |
| Location | `europe-west1` | Same region as Cloud Run (`GCP_DEPLOY_REGION`), keeps learner data in the EU. Cannot be changed later. |
| Data model | One document per session in collection `learnerSessions`, ID = `sessionId`, turns stored inside it | 50 turns × ≤2,000 chars stays far under the 1 MiB document limit; one read loads a session. |
| Checkpoint writes | `runTransaction` read-modify-write | The user and tutor turns of one exchange are checkpointed back to back; without a transaction the second write can drop the first. |
| Ownership | Check `userId` inside the same transaction/read, as today | Keeps `SessionOwnershipError` and the 404 for foreign IDs. |
| Expiry | Firestore TTL policy on a `expiresAtTs` Timestamp field; reads still ignore expired sessions | TTL deletes within ~24 h of expiry at no cost; the read check keeps behaviour exact. `purgeExpiredSessions` returns 0 for this store. |
| Latest session for a user | Query `userId ==` ordered by `updatedAt desc`, limit 5, skip expired | Needs one composite index (`userId` asc, `updatedAt` desc). |
| GDPR delete-all | Query by `userId`, delete in batches of ≤500 | Firestore has no delete-by-query. |
| Store selection | `SESSION_STORE=firestore` (set in `deploy.yml`); default `memory` | Local dev and tests need no GCP credentials. Fail at startup if `firestore` is set but the client cannot be created. |
| Dependency | `@google-cloud/firestore` (server only) | Official client, uses the Cloud Run service account via ADC. `firebase-admin` would pull in more than needed. |

Also fix while here: `InMemorySessionStore.updateUpstreamHandle` mutates the stored
object in place instead of writing it back. Harmless in memory, but the Firestore
version must do an explicit update, and both should behave the same.

## Steps (one commit each)

1. **Shared contract tests.** Move the behaviour tests in `tests/sessionStore.test.ts`
   into a suite that takes a store factory, and run it against `InMemorySessionStore`.
   Add tests for the two checkpoints racing and for `updateUpstreamHandle` persisting.
2. **`FirestoreSessionStore`** in `src/server/firestoreSessionStore.ts`: convert
   `LearnerSession` to and from documents (ISO strings kept; `expiresAtTs` added), and
   implement each interface method as decided above.
3. **Run the contract suite against Firestore** when `FIRESTORE_EMULATOR_HOST` is set,
   skipped otherwise. Running the emulator needs `firebase-tools` and Java, so ask before
   adding it to CI; until then run it locally before merging.
4. **Store selection.** `createSessionStore(env)` returns the store; `defaultSessionStore`
   uses it. `SESSION_STORE` is documented in `.env.example` and the README.
5. **Deploy config.** Add `SESSION_STORE=firestore` to `deploy.yml`.

## GCP setup (before the first deploy of this branch)

Run with the personal account (`--account=estebangr2711@gmail.com`):

1. `gcloud services enable firestore.googleapis.com --project=corso-di-italiano-496920`
2. `gcloud firestore databases create --location=europe-west1 --type=firestore-native --project=corso-di-italiano-496920`
3. TTL: `gcloud firestore fields ttls update expiresAtTs --collection-group=learnerSessions --enable-ttl --project=corso-di-italiano-496920`
4. Index: `gcloud firestore indexes composite create --collection-group=learnerSessions --field-config=field-path=userId,order=ascending --field-config=field-path=updatedAt,order=descending --project=corso-di-italiano-496920`
5. IAM: grant `roles/datastore.user` to `parliamo-italiano-runtime@corso-di-italiano-496920.iam.gserviceaccount.com`.

## Rollout

1. Merge with `--max-instances=1` and `SESSION_STORE=firestore`. Check in production:
   a chat turn creates a document, a redeploy keeps it, and `DELETE /api/session` removes it.
2. Then raise `--max-instances` (e.g. to 3) in a separate commit.

Rollback: set `SESSION_STORE=memory` and redeploy. Sessions written to Firestore stay
there until their TTL.

## Cost

About two writes per chat turn plus one read per page load or reconnect. Free tier is
50k reads and 20k writes per day, so cost is expected to be zero at current usage.

## Open questions

- Should GDPR delete-all also delete the learner's anonymous Firebase account? Not done
  today; it would need `firebase-admin` or the Identity Toolkit API.
- Add the Firestore emulator to CI (step 3)?
