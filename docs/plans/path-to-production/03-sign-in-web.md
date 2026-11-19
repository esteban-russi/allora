# Plan 03: sign-in on the web

## Status

- Branch: `feature/sign-in-web`
- PR link: (pending opening)
- Date: 2026-11-19
- Summary: In progress.
- Cloud changes made:
  - ✅ Granted `roles/firebaseauth.admin` to `parliamo-italiano-runtime@corso-di-italiano-496920.iam.gserviceaccount.com`:
    Command: `gcloud projects add-iam-policy-binding corso-di-italiano-496920 --member="serviceAccount:parliamo-italiano-runtime@corso-di-italiano-496920.iam.gserviceaccount.com" --role="roles/firebaseauth.admin" --condition=None --project=corso-di-italiano-496920 --account=estebangr2711@gmail.com`
    Before: runtime SA had `roles/aiplatform.user`, `roles/datastore.user`, `roles/serviceusage.serviceUsageConsumer`.
    After: `roles/firebaseauth.admin` present in policy bindings.
  - ✅ Added authorized domain `parliamo-italiano-562781327825.europe-west1.run.app` and enabled email sign-in via Identity Toolkit API patch.
    Before: authorizedDomains `["localhost", "corso-di-italiano-496920.firebaseapp.com", "corso-di-italiano-496920.web.app"]`.
    After: authorizedDomains includes `parliamo-italiano-562781327825.europe-west1.run.app`; `signIn.email.enabled` is `true`.
- Items needing attention:
  - 🟠 Owner console setup: In Firebase Console -> Authentication -> Sign-in method, enable **Google** provider (requires OAuth client ID / secret).
  - 🟠 Owner console setup: In Firebase Console -> Authentication -> Sign-in method -> Email/Password, verify **Email link (passwordless sign-in)** is checked.
  - 🟠 Owner console setup: In Firebase Console -> Authentication -> Templates -> Edit template -> Customize action URL, set to `https://parliamo-italiano-562781327825.europe-west1.run.app/auth/action`. (API rejected template patch with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`).
  - 🟠 Live verification: Real Google sign-in popup and real email link delivery could not be executed unattended in test environments; auth flows are verified via unit tests with fakes and mocked Firebase Auth.

Branch: `feature/sign-in-web`. Depends on: 01, 02.

Read first: `src/utils/firebaseAuth.ts`, `src/utils/apiClient.ts`,
`src/utils/learnerSession.ts`, `src/App.tsx`, `src/components/OnboardingPage.tsx`,
`src/components/UserBadge.tsx`, `src/hooks/useDialog.ts`, `src/server/sessionStore.ts`.

## Goal

A learner can sign in with Google or an email magic link, keeps the conversation they
started as a guest, can sign out, and can delete their account and data.

## User flow

1. First screen (onboarding) gains a link: **"Already have an account? Log in"**.
   It opens the sign-in screen. After signing in, if the account has a saved session the
   app restores it and skips onboarding; if not, the learner continues onboarding.
2. A new learner fills in onboarding (name, level, tutor) and presses the start button.
   If they are a guest, the **sign-in screen** appears with:
   "Continue with Google", an email field with "Email me a sign-in link", and "Not now".
3. "Not now" goes to the chat as a guest. Signing in goes to the chat as a `free` user
   (plan 04 inserts the plans screen here).
4. The avatar button (`UserBadge`) opens an **account menu**: email or "Guest", the plan
   name, "Edit profile", "Sign in" (guests), "Sign out" and "Delete account" (signed in).

## Decisions

| Question | Decision |
|---|---|
| Guest → account | Sign in with the provider, then call `POST /api/account/merge` with the guest's ID token. No `linkWithCredential`. One path covers new and existing accounts. |
| What merge does | If the account has no active session, the guest's sessions are moved to it. Otherwise the guest's sessions are deleted (the account's own conversation wins). Today's guest usage is added to the account's usage, so signing in does not reset the daily caps. The guest's `users` record and Firebase user are deleted. |
| Google on the web | `signInWithPopup`. Not redirect: redirect breaks in browsers that block third-party storage. |
| Magic link | `sendSignInLinkToEmail` with `url = <origin>/auth/action`, `handleCodeInApp: true`. The email typed is kept in `localStorage` under `parliamo.emailForSignIn`. If the link is opened in another browser, the app asks for the email again. |
| Email link target | Firebase console → Authentication → Templates → "Customize action URL" = `<APP_URL>/auth/action`. The link in the email then points at our domain directly (needed later for Android App Links, plan 08). |
| Sign out | `signOut`, then sign in anonymously again, forget the stored session ID, show onboarding. |
| Deleting the Firebase user | Server-side with `firebase-admin` (`getAuth().deleteUser(uid)`). The runtime service account needs `roles/firebaseauth.admin`. |
| Delete with an active subscription | Allowed. The response says `hadActiveSubscription: true` and the app tells the user to cancel the subscription in Google Play or the web billing page (deleting an account cannot cancel a store subscription). |

## Server

### Step 1: ✅ `transferUserSessions` on `SessionStore`

Add to the interface in `src/server/sessionStore.ts` and implement in both stores:

```ts
/**
 * Give a guest's sessions to an account.
 * Returns 'moved' when they were reassigned, 'discarded' when the target already had an
 * active session (the guest's were deleted), 'none' when the guest had no sessions.
 */
transferUserSessions(fromUserId: string, toUserId: string): Promise<'moved' | 'discarded' | 'none'>;
```

- ✅ "Active session" = `getActiveUserSession(toUserId)` is not null.
- ✅ Moving = set `userId` to `toUserId` and clear `upstreamResumptionHandle` and `upstreamModel`.
- ✅ Firestore: query by `userId == fromUserId`, update or delete in batches of 500.
- ✅ Add the three outcomes to `tests/helpers/sessionStoreContract.ts`.

### Step 2: ✅ identity admin (`src/server/identityAdmin.ts`)

```ts
export interface IdentityAdmin { deleteUser(userId: string): Promise<void>; }
/** firebase-admin backed when GCP_PROJECT is set; otherwise a no-op (local dev, tests). */
export function createIdentityAdmin(env?: NodeJS.ProcessEnv): IdentityAdmin
export const defaultIdentityAdmin: IdentityAdmin
```

- ✅ `npm install firebase-admin`. Import only `firebase-admin/app` and `firebase-admin/auth`.
- ✅ Initialise lazily on first use: `initializeApp({ projectId: env.GCP_PROJECT })` (ADC).
- ✅ `deleteUser` ignores the `auth/user-not-found` error and rethrows others.

### Step 3: ✅ `POST /api/account/merge`

Add `/api/account` to both middleware path lists in `server.ts`. Put the handlers in a
new file `src/server/accountRoutes.ts` exporting
`createAccountRouter(deps: { sessions, accounts, usage, identity, verifyToken, now })`
and mount it with `app.use('/api/account', router)`; `server.ts` is already 870 lines.

Request body: `{ guestIdToken: string }`.

1. ✅ `req.user.isAnonymous` must be false, else `403 { code: 'SIGN_IN_REQUIRED' }`.
2. ✅ `const guest = await verifyIdToken(guestIdToken)`. If null, not anonymous, or
   `guest.userId === req.user.userId`: `400 { code: 'INVALID_GUEST_TOKEN' }`.
3. ✅ `const outcome = await sessions.transferUserSessions(guest.userId, req.user.userId)`.
4. ✅ Usage: `const day = usageDay(now()); const u = await usage.getUsage(guest.userId, day);`
   for each counter with a value > 0 call `usage.add(req.user.userId, day, counter, value)`;
   then `usage.deleteAllUserUsage(guest.userId)`.
5. ✅ `accounts.deleteAccount(guest.userId)`; `invalidateAccountCache(guest.userId)`.
6. ✅ `identity.deleteUser(guest.userId)` inside try/catch (log, do not fail the request).
7. ✅ Respond `{ sessions: outcome }`.

Calling it twice is safe: the second call finds nothing to move and returns `none`.

Tests (`tests/accountRoutes.test.ts`, in-memory stores, dev tokens `dev-token:anon-g`
for the guest and `dev-token:u1` for the account): moved, discarded, usage added,
guest record gone, guest token of a non-anonymous user rejected, same user rejected,
anonymous caller rejected.

### Step 4: ✅ `DELETE /api/account`

1. ✅ `const hadActiveSubscription = req.account!.tier === 'premium'`.
2. ✅ `sessions.deleteAllUserData(userId)`, `usage.deleteAllUserUsage(userId)`,
   `accounts.deleteAccount(userId)`, `invalidateAccountCache(userId)`.
3. ✅ `identity.deleteUser(userId)`; if this throws respond 500 (the user must be able to retry).
4. ✅ Respond `{ status: 'deleted', hadActiveSubscription }`.

Works for guests too. Tests: everything is removed; identity failure gives 500.

## Client

### Step 5: ✅ auth service (`src/utils/firebaseAuth.ts`)

Today `signInWithFirebase` hides the `auth` object. Change it so the module keeps it:

- ✅ `startAnonymousAuth` keeps its signature and behaviour.
- ✅ New exports (each loads `firebase/auth` lazily and awaits the same `ready` promise):
  ```ts
  export async function signInWithGoogle(): Promise<SignInResult>
  export async function sendMagicLink(email: string): Promise<void>
  /** Null when `url` is not a sign-in link. */
  export async function completeMagicLink(url: string, email: string): Promise<SignInResult | null>
  export async function isMagicLink(url: string): Promise<boolean>
  export async function signOutToGuest(): Promise<void>
  export type SignInResult = { ok: true } | { ok: false; reason: 'cancelled' | 'failed'; message: string };
  ```
- ✅ Shared helper `signInAndMerge(doSignIn)`:
  1. `const guest = auth.currentUser?.isAnonymous ? auth.currentUser : null;`
     `const guestIdToken = guest ? await guest.getIdToken() : null;`
  2. `await doSignIn()` (popup or email link). `auth/popup-closed-by-user` and
     `auth/cancelled-popup-request` → `{ ok: false, reason: 'cancelled' }`.
  3. If `guestIdToken`, `await postJson('/api/account/merge', { guestIdToken })`
     (a failure here is logged; sign-in still succeeded).
  4. Return `{ ok: true }`.
- ✅ Keep the functions injectable for tests the way `startAnonymousAuth` takes `loadConfig`
  and `signIn` arguments; extend `tests/firebaseAuth.test.ts` with fakes: merge is called
  with the guest token; not called when there was no guest; cancelled popup maps to `cancelled`.

### Step 6: account state (`src/utils/me.ts`, `src/hooks/useAccount.ts`)

```ts
export interface Me { userId: string; email: string | null; isAnonymous: boolean;
  tier: 'guest' | 'free' | 'premium'; limits: {...}; usage: {...}; resetsAt: string;
  subscription: {...} | null; }
export async function fetchMe(): Promise<Me | null>      // GET /api/me, validated, null on failure
export function useAccount(): { me: Me | null; refresh: () => Promise<Me | null> }
```

`useAccount` fetches once on mount. `App.tsx` calls `refresh()` after sign-in, sign-out
and merge.

### Step 7: `SignInScreen` (`src/components/SignInScreen.tsx`)

Props: `mode: 'after-onboarding' | 'login'`, `onSignedIn: () => void`, `onSkip: () => void`.

- Same page shell and Tailwind tokens as `OnboardingPage` (copy its outer layout classes).
- Heading: after-onboarding "Save your progress"; login "Welcome back".
- Button "Continue with Google" → `signInWithGoogle()`.
- Form: `<input type="email" required autocomplete="email">` + button "Email me a sign-in link"
  → `sendMagicLink(email)`; on success replace the form with "Check your inbox. Open the
  link on this device to finish signing in." and a "Use a different email" button.
- Secondary button: "Not now" (after-onboarding) or "Back" (login) → `onSkip`.
- Errors in a `role="alert"` paragraph. Disable buttons while a request is running.
- Real `<button type="button">` elements; labels as above.

### Step 8: wire into `App.tsx`

- Extract the body of the restore effect into `applySession(session)` so sign-in can reuse it.
- New state `screen: 'onboarding' | 'signin-after-onboarding' | 'signin-login' | 'app'`
  replacing `isOnboardingOpen` (keep `isRestoring`).
- `handleCompleteOnboarding`: after starting the session, go to
  `'signin-after-onboarding'` when `me?.isAnonymous`, else `'app'`.
- `OnboardingPage` gets an `onLogin` prop that renders the "Already have an account? Log in"
  button (only when `me?.isAnonymous`).
- After a successful sign-in (`onSignedIn`): `await refresh()`, then
  `const session = await loadLearnerSession()`; if there is one, `applySession(session)`
  and go to `'app'`; if none and the mode was `login`, go back to `'onboarding'`; if none
  and the mode was `after-onboarding`, call `startLearnerSession(...)` with the current
  profile and go to `'app'`.
- Magic-link landing, in the first effect before restoring: if
  `await isMagicLink(window.location.href)`, read the email from `localStorage`
  (ask with a small inline form when missing), call `completeMagicLink`, then
  `history.replaceState(null, '', '/')` and continue as "after a successful sign-in".

### Step 9: account menu (`src/components/AccountMenu.tsx`)

- Dialog using `useDialog`. Opened by `UserBadge` in `IconRail` and `TopHeader`
  (replace their `onEditProfile` wiring with `onOpenAccount`; "Edit profile" moves inside).
- Content: email or "Guest"; plan label ("Guest", "Free", "Premium"); buttons as listed
  under "User flow".
- "Delete account": second confirmation step inside the dialog ("This permanently deletes
  your conversations, notebook and account. This cannot be undone." + "Delete" / "Cancel").
  On confirm: `DELETE /api/account` (add `deleteWithAuth(path)` to `apiClient.ts`), then
  `signOutToGuest()` and show onboarding. If `hadActiveSubscription`, show
  "Your subscription is not cancelled automatically. Cancel it in Google Play or from the
  link in your receipt email." before closing.

### Step 10: docs

README: sign-in, merge and delete endpoints; console setup below.

## Console setup (owner, before deploying)

1. Firebase → Authentication → Sign-in method: enable **Google** and **Email/Password**
   with **Email link (passwordless sign-in)**.
2. Authentication → Settings → Authorised domains: add the app's domain.
3. Authentication → Templates → edit any template → "Customize action URL": `<APP_URL>/auth/action`.
4. IAM: grant `roles/firebaseauth.admin` to the runtime service account.

## Acceptance

- Guest chats, signs in with Google: the conversation is still there, `/api/me` says `free`,
  and the guest's Firebase user no longer exists.
- Sign out, then "Log in" from onboarding: the conversation comes back without onboarding.
- Magic link opened in the same browser signs in; in a different browser it asks for the email.
- Delete account removes `learnerSessions`, `usage`, `users` documents and the Firebase user.
