# Plan 08: Android sign-in

Branch: `feature/android-sign-in`. Depends on: 03, 07.

Read first: plan 03 (`signInAndMerge`, `completeMagicLink`), plan 07, and the README of
`@capacitor-firebase/authentication` (Android setup and the Google provider section).

## Goal

In the Android app: "Continue with Google" opens the native account picker, and tapping
the magic link in an email opens the app and signs the learner in.

## Decisions

| Question | Decision |
|---|---|
| Google sign-in | `@capacitor-firebase/authentication` with `skipNativeAuth: true`: the plugin only returns a Google ID token; the Firebase **web** SDK in the WebView signs in with it. One auth state (the web SDK's), so the rest of the app is unchanged. Web popups do not work in a WebView. |
| Magic link | Android App Links on `https://<APP_HOST>/auth/action`. The email link points at our domain (set up in plan 03), so tapping it opens the app directly. |
| If the link opens in a browser instead | On an Android browser the web page shows two buttons, "Open in the Parliamo app" and "Continue in the browser", and does **not** complete sign-in automatically (the code in the link works once). |
| Host name in the manifest | A Gradle manifest placeholder `appLinkHost`, defined in `android/variables.gradle`. |
| `assetlinks.json` | Served by Express from environment variables, so fingerprints can change without a client release. |

## Steps (one commit each)

1. **Install and configure the plugin.**
   - `npm install @capacitor-firebase/authentication` and follow its Android instructions
     (Google provider enabled; the plugin README names the Gradle variable to set).
   - `capacitor.config.ts`:
     ```ts
     plugins: { FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] } }
     ```
   - Add `android/app/google-services.json` (from the Firebase console, see setup) and commit
     it; it contains no secrets.
   - `npx cap sync android`.

2. **Native Google sign-in** (`firebaseAuth.ts`).
   In `signInWithGoogle`, replace the popup when `isNativeApp()`:
   ```ts
   const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
   const result = await FirebaseAuthentication.signInWithGoogle();
   const idToken = result.credential?.idToken;
   if (!idToken) return { ok: false, reason: 'failed', message: 'Google did not return a token' };
   await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
   ```
   - This runs inside `signInAndMerge`, so the guest merge still happens.
   - A user closing the account picker → `{ ok: false, reason: 'cancelled' }` (check the
     plugin's error code/message for cancellation).
   - `signOutToGuest`: when native, also `await FirebaseAuthentication.signOut()` so the
     next sign-in shows the account picker again.
   - Tests with the plugin mocked: token is passed to `signInWithCredential`; missing token; cancel.

3. **Magic link URL.** In `sendMagicLink`, build the URL with
   `publicUrl('/auth/action')` (plan 07) instead of `window.location.origin`, so the app
   sends `https://<APP_HOST>/auth/action`, not `https://localhost/...`.

4. **App Links in the manifest.**
   - `android/variables.gradle`: `appLinkHost = '<APP_HOST>'`; in `android/app/build.gradle`
     `defaultConfig { manifestPlaceholders = [appLinkHost: rootProject.ext.appLinkHost] }`.
   - In the main `<activity>`:
     ```xml
     <intent-filter android:autoVerify="true">
       <action android:name="android.intent.action.VIEW" />
       <category android:name="android.intent.category.DEFAULT" />
       <category android:name="android.intent.category.BROWSABLE" />
       <data android:scheme="https" android:host="${appLinkHost}" android:pathPrefix="/auth/action" />
     </intent-filter>
     ```
   - The activity's `launchMode` must be `singleTask` (Capacitor's default) so the link
     reuses the running app.

5. **Serve `/.well-known/assetlinks.json`** (`server.ts`, helper in `src/server/assetLinks.ts`).
   ```ts
   export function buildAssetLinks(env?: NodeJS.ProcessEnv): unknown[] | null
   ```
   - Reads `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` (comma-separated fingerprints,
     format `AA:BB:…`). Returns null when either is missing.
   - Response: `[{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name, sha256_cert_fingerprints } }]`
     with `Content-Type: application/json`; 404 when null.
   - Register the route before the static/wildcard handlers. Test both cases.
   - Add both variables to `.env.example`, README and `deploy.yml` (from GitHub variables).

6. **Handle the link in the app** (`src/utils/nativeLifecycle.ts` + `App.tsx`).
   - On start when native: `const launch = await App.getLaunchUrl(); if (launch?.url) handleAuthLink(launch.url)`.
   - `App.addListener('appUrlOpen', ({ url }) => handleAuthLink(url))`.
   - `handleAuthLink(url)`: if `await isMagicLink(url)`, run the same completion code as
     the web landing in plan 03 (email from `localStorage`, ask if missing,
     `completeMagicLink(url, email)`, then the "after a successful sign-in" path).
     Ignore any other URL.

7. **Browser fallback page.** In the web landing code (plan 03 step 8), before completing
   sign-in: if `!isNativeApp()` and `/Android/i.test(navigator.userAgent)`, render a small
   screen with:
   - "Open in the Parliamo app": an `<a>` whose `href` is
     `intent://<host>/auth/action?<same query>#Intent;scheme=https;package=<APP_ID>;end`
   - "Continue in the browser": completes sign-in on the web as before.

8. **Docs**: README: Firebase Android app, fingerprints, `assetlinks.json`, how to test App Links
   (`adb shell pm get-app-links <APP_ID>`).

## Owner setup

1. Firebase console → Project settings → Add app → Android, package
   `<APP_ID>`. Add SHA-1 **and** SHA-256 for: the debug keystore,
   the upload key, and the Play App Signing key (Play Console → Setup → App signing).
   Download `google-services.json`.
2. Set GitHub variables `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` (upload key and
   Play App Signing key fingerprints; add the debug one while testing).
3. Confirm the email template's action URL is `<APP_URL>/auth/action` (plan 03).

## Test on a real device (build installed from the internal testing track)

- Google: account picker → signed in; guest conversation kept; `/api/me` is `free`.
- Sign out → sign in again shows the picker.
- Magic link: request it in the app, open the email on the same phone, tap: the app opens
  and signs in. `adb shell pm get-app-links …` shows the domain as `verified`.
- Open the link on a laptop: the web app signs in there (expected), the phone stays a guest.
- Open the link in Chrome on the phone with the app uninstalled: fallback screen, "Continue in the browser" works.
