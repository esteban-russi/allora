# Plan 10: App Check

## Status

- Branch: `feature/app-check`
- Date: 2026-11-19
- Summary: Implemented the server and web App Check stack across steps 1–7 (`src/server/firebaseAdmin.ts`, `src/server/appCheck.ts`, `appCheck` counters in `defaultMetrics` / `/api/metrics`, `requireAppCheck()` wired first on authenticated routes in `server.ts`, upgrade verification in `liveBridge.ts`, `firebase.appCheckSiteKey` on `/api/auth-config`, lazy reCAPTCHA Enterprise web provider in `src/utils/appCheck.ts`, token attachment in `apiClient.ts` and `liveCall.ts`, `APP_CHECK_REQUIRED` notice handling via `setAppCheckFailedHandler` + `showNotice`, and config/docs updates with `APP_CHECK_MODE=off` by default).
- Native Android seam: The Android shell (plan 07) does not exist yet; `src/utils/appCheck.ts` leaves a `NativeAppCheckProvider` / `setNativeAppCheckProvider` seam (no Capacitor code) for plan 07/08 to plug in `@capacitor-firebase/app-check` (Play Integrity + emulator debug token support).
- Items needing attention:
  - 🟠 Owner setup: Create a score-based reCAPTCHA Enterprise **website** key in Google Cloud for the app's domain.
  - 🟠 Owner setup: In Firebase Console → App Check → Apps, register the web app with that key (and register the Android app with Play Integrity once the Play App Signing SHA-256 and Play Console link exist).
  - 🟠 Owner setup: Set the GitHub repository variable `FIREBASE_APPCHECK_SITE_KEY` (currently unset; `deploy.yml` passes it harmlessly as empty while `APP_CHECK_MODE=off`).
  - 🟠 Rollout: Change `APP_CHECK_MODE` in `.github/workflows/deploy.yml` from `off` to `monitor`, watch `metrics.appCheck` (`ok`, `failed`, `missing`) on `/api/metrics` for several days (and wait until any shipped Android build sends tokens), then switch to `APP_CHECK_MODE=enforce` in a separate commit (rollback = set back to `monitor`).
  - 🟠 Optional post-enforce: Enforce App Check for **Authentication** in Firebase Console → App Check → APIs only after `enforce` is verified in production.

Branch: `feature/app-check`. Depends on: 07 (the web half can ship earlier if needed).

Read first: `src/server/auth.ts` (`extractTokenFromRequest`), `src/utils/apiClient.ts`,
`src/utils/liveCall.ts`, `liveBridge.ts` (`handleLiveUpgrade`), plan 03 step 2
(`identityAdmin.ts`, where `firebase-admin` is initialised), and the README of
`@capacitor-firebase/app-check`.

## Goal

Only our web app and our Android app can call the billed endpoints. Today anyone can
create anonymous Firebase accounts from a script and use the AI on our bill, a few
guest messages at a time, without end.

## Decisions

| Question | Decision |
|---|---|
| Providers | Web: reCAPTCHA Enterprise. Android: Play Integrity through `@capacitor-firebase/app-check`. |
| Transport | HTTP header `X-Firebase-AppCheck`. WebSocket: two extra subprotocol entries `appcheck, <token>`, next to the existing `auth, <token>` (browsers cannot set headers on WebSockets). |
| Verification | `firebase-admin/app-check` `getAppCheck().verifyToken(token)` on the server. |
| Modes | `APP_CHECK_MODE=off` (default), `monitor` (verify and log, never block), `enforce`. |
| Covered routes | Everything behind `authenticateHttpUser()` plus the Live upgrade. Not covered: `/api/health`, `/api/auth-config`, `/api/webhooks/revenuecat`, `/.well-known/*`, static files. |
| Local dev and CI | Mode `off`. Debug tokens for emulators and for testing `enforce` locally. |
| Client without a token | The request is sent without the header; in `enforce` the server answers 401 `APP_CHECK_REQUIRED` and the app shows "Please update or reload the app." |

## Steps (one commit each)

1. **Server verifier** (`src/server/appCheck.ts`).
   ```ts
   export type AppCheckMode = 'off' | 'monitor' | 'enforce';
   export function appCheckMode(env?: NodeJS.ProcessEnv): AppCheckMode          // throws on other values
   export interface AppCheckVerifier { verify(token: string): Promise<boolean>; }
   export function createAppCheckVerifier(env?: NodeJS.ProcessEnv): AppCheckVerifier   // firebase-admin backed
   export function extractAppCheckToken(req: IncomingMessage): string | null
   export function requireAppCheck(deps?: { verifier?: AppCheckVerifier; mode?: AppCheckMode })
   ```
   - Share the `firebase-admin` app initialisation with `identityAdmin.ts` (move it to
     `src/server/firebaseAdmin.ts` exporting `getAdminApp()`).
   - `verify` returns false on any error from `verifyToken`.
   - `extractAppCheckToken`: the `x-firebase-appcheck` header, else the value after
     `appcheck` in `sec-websocket-protocol` (same parsing style as `extractTokenFromRequest`).
   - Middleware: `off` → `next()`. Otherwise verify. Failure in `enforce` →
     `401 { error: 'App verification failed', code: 'APP_CHECK_REQUIRED' }`. Failure in
     `monitor` → increment a counter and `next()`.
   - Counters `appCheck: { ok, failed, missing }` added to `defaultMetrics` and shown in `/api/metrics`.
   - Tests with a fake verifier: every mode × (valid, invalid, missing); header and subprotocol extraction.

2. **Apply on the server.**
   - `server.ts`: add `requireAppCheck()` as the **first** handler in the authenticated
     `app.use([...paths], …)` block, so unverified clients are rejected before token
     verification and rate-limit accounting.
   - `liveBridge.ts`: in `handleLiveUpgrade`, after the origin check: in `enforce`, an
     invalid or missing token → `rejectUpgrade(socket, 401, 'App verification failed')`.
     Add `appCheck?: { verifier; mode }` to `LiveBridgeOptions`.
   - Tests in `tests/server.test.ts` and `tests/liveBridge.test.ts`.

3. **Serve the site key.** `/api/auth-config` → `firebase.appCheckSiteKey` from
   `FIREBASE_APPCHECK_SITE_KEY` (null when unset). Update `parseFirebaseClientConfig`
   (the field is optional) and its tests.

4. **Client token source** (`src/utils/appCheck.ts`).
   ```ts
   export function initAppCheck(firebaseApp: FirebaseApp, siteKey: string | null): void
   export async function getAppCheckToken(): Promise<string | null>   // null when not initialised or on error
   ```
   - Web: lazy `import('firebase/app-check')`;
     `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })`;
     `getToken(instance, false)`. No site key → not initialised.
   - Native: `npm install @capacitor-firebase/app-check`;
     `FirebaseAppCheck.initialize({ isTokenAutoRefreshEnabled: true })` and
     `FirebaseAppCheck.getToken()`. For debug builds pass the plugin's debug option so an
     emulator prints a debug token to register in the console.
   - Call `initAppCheck` from `firebaseAuth.ts` right after `initializeApp(config)`.
   - Tests with fakes for both branches.

5. **Attach the token.**
   - `apiClient.ts`: one internal `authHeaders()` used by `getWithAuth`, `postJson`,
     `deleteWithAuth` that adds `Authorization` and, when available, `X-Firebase-AppCheck`.
   - `liveCall.ts`: build the subprotocol list as
     `[...(token ? ['auth', token] : []), ...(appCheck ? ['appcheck', appCheck] : [])]`;
     pass `undefined` instead of an empty list.
   - The CORS middleware (plan 07) already allows the header.
   - Tests updated.

6. **Client handling of `APP_CHECK_REQUIRED`.** A single place (`apiClient.ts`, after
   `fetch`): on a 401 with that code, dispatch a `window` event `parliamo:app-check-failed`;
   `App.tsx` shows a blocking notice with a "Reload" button (web) or "Update the app" (native).

7. **Config and docs.** `APP_CHECK_MODE`, `FIREBASE_APPCHECK_SITE_KEY` in `.env.example`,
   README, `deploy.yml` (`APP_CHECK_MODE=monitor`).

## Owner setup

1. Google Cloud → reCAPTCHA Enterprise: create a **website** key (score-based) for the app's domain.
2. Firebase console → App Check → Apps: register the web app with that key; register the
   Android app with Play Integrity (needs the SHA-256 of the Play App Signing key, and the
   Play Console project linked to this Google Cloud project under App integrity).
3. Set the GitHub variable `FIREBASE_APPCHECK_SITE_KEY`.
4. Optional, recommended: Firebase console → App Check → APIs → enforce for
   **Authentication**. This blocks scripted anonymous sign-ups at the source (may require
   upgrading the project to Identity Platform). Do it only after step "enforce" below.
5. For emulators and local tests of `enforce`: App Check → Apps → Manage debug tokens.

## Rollout

1. Deploy with `APP_CHECK_MODE=monitor`. Release the Android build that sends tokens.
2. Watch `/api/metrics` `appCheck` for several days. Wait until `missing` + `failed` come
   only from traffic you do not recognise, and the previous Android version is no longer in use.
3. Set `APP_CHECK_MODE=enforce` (separate commit). Rollback = set it back to `monitor`.

Play Integrity only works for builds installed from Google Play (or with a debug token).
A sideloaded release build will fail verification; this is expected.
