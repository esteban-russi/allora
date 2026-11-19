# Plan 07: Android app shell (Capacitor)

Branch: `feature/android-app-shell`. Depends on: 01–04 on `main` (so the first build
already has limits and sign-in screens).

Read first: `src/utils/apiClient.ts`, `src/utils/liveCall.ts` (where the WebSocket URL is
built), `src/utils/speech.ts`, `src/utils/firebaseAuth.ts`, `liveBridge.ts`
(`handleLiveUpgrade`, the origin check), `server.ts` (middleware order), `vite.config.ts`.

Use the newest stable Capacitor major and read its Android "Getting started" page first.
After `npx cap add android`, check that `targetSdkVersion` in `android/variables.gradle`
meets Google Play's current target API requirement.

## Goal

The existing web app runs as an installable Android app that talks to the production
server: chat, voice calls, guest use. Google sign-in, purchases and App Check on Android
come in plans 08–10.

## Decisions

| Question | Decision |
|---|---|
| How the app loads | Web assets are bundled in the app (`webDir: 'dist'`). Not `server.url` pointing at the website: Play rejects thin website wrappers, and bundled assets start faster. |
| App ID | `<APP_ID>`. Cannot be changed after the first Play upload. |
| Talking to the server | The WebView's origin is `https://localhost`, so API paths must be absolute. A build-time variable `VITE_API_BASE_URL` (empty for the web build) prefixes every request and the Live WebSocket URL. |
| Cross-origin access | The server allows the origins listed in `ALLOWED_ORIGINS` (set to `https://localhost` in production) for HTTP (CORS) and for the Live WebSocket. CORS is not a security control here: auth tokens and App Check are. |
| Browser speech fallbacks | Disabled in the app. Android WebView has no `SpeechRecognition`, and `speechSynthesis` is unreliable. The app uses the server for speech-to-text and text-to-speech only. |
| App goes to background during a call | The call ends (after it has connected). Avoids billing voice seconds for a pocketed phone. |
| Screen during a call | Kept awake. |
| Android back button | Closes the open dialog/call; on the main screen it minimises the app. |
| Release signing | Play App Signing. The upload keystore stays outside the repo. CI builds a debug APK only. |

## Steps (one commit each)

1. **Platform helpers** (`src/utils/platform.ts`).
   ```ts
   export function isNativeApp(): boolean                 // Capacitor.isNativePlatform()
   export const API_BASE: string                          // import.meta.env.VITE_API_BASE_URL ?? '' without trailing slash
   export function apiUrl(path: string): string           // API_BASE + path
   export function liveSocketUrl(query: string): string   // wss://<API_BASE host>/api/live?query, or from window.location when API_BASE is ''
   export function publicUrl(path: string): string        // (API_BASE || window.location.origin) + path, for links such as /privacy
   ```
   `npm install @capacitor/core`. Add `VITE_API_BASE_URL` to `src/vite-env.d.ts` (create it
   if missing). Unit-test with both an empty and a set base.

2. **Use them everywhere.**
   - `apiClient.ts`: `getWithAuth`, `postJson`, `deleteWithAuth` call `fetch(apiUrl(path), …)`.
   - `clientConfig.ts` (or `firebaseAuth.ts`): `fetch(apiUrl('/api/auth-config'))`.
   - `liveCall.ts`: replace the `window.location` URL with `liveSocketUrl(query)`.
   - `grep -rn "fetch('/\|fetch(\"/\|window.location.host" src` must return nothing afterwards.
   - Update `tests/apiClient.test.ts` and `tests/liveCall.test.ts`.

3. **Server: allowed origins** (`src/server/cors.ts`).
   ```ts
   export function parseAllowedOrigins(env?: NodeJS.ProcessEnv): string[]   // ALLOWED_ORIGINS, comma separated, trimmed
   export function createCorsMiddleware(allowed: string[])
   ```
   - For requests under `/api/` whose `Origin` is in the list: set
     `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`,
     `Access-Control-Allow-Headers: Authorization, Content-Type, X-Firebase-AppCheck`,
     `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`, `Access-Control-Max-Age: 600`.
   - `OPTIONS` with an allowed origin → `204` and stop. Other origins get no CORS headers.
   - Register it in `server.ts` **before** the rate limiters and auth (preflights carry no token).
   - `liveBridge.ts`: add `allowedOrigins?: string[]` to `LiveBridgeOptions`; the origin
     check passes when the origin's host equals the `Host` header **or** the origin is in
     the list. Pass `parseAllowedOrigins()` from `startServer`.
   - Tests: preflight from `https://localhost` gets 204 with headers; from
     `https://evil.example` gets no CORS headers; Live upgrade accepted from an allowed
     origin and rejected (403) from another.
   - `ALLOWED_ORIGINS` in `.env.example`, README, and `deploy.yml` (`ALLOWED_ORIGINS=https://localhost`).

4. **Add Capacitor and the Android project.**
   - `npm install @capacitor/android @capacitor/app @capacitor/splash-screen @capacitor-community/keep-awake`
     and `npm install -D @capacitor/cli @capacitor/assets`.
   - `capacitor.config.ts`:
     ```ts
     import type { CapacitorConfig } from '@capacitor/cli';
     const config: CapacitorConfig = {
       appId: '<APP_ID>',
       appName: 'Parliamo Italiano',
       webDir: 'dist'
     };
     export default config;
     ```
   - `npx cap add android`; commit the generated `android/` folder.
   - `.gitignore`: add `android/app/build/`, `android/build/`, `android/.gradle/`,
     `android/local.properties`, `android/keystore.properties`, `*.jks`, `*.keystore`.
   - `.dockerignore`: add `android/`.
   - `package.json` scripts:
     `"build:android": "vite build && cap sync android"`, `"open:android": "cap open android"`.
     Document that `VITE_API_BASE_URL` must be set when running `build:android`
     (e.g. in `.env.android.local` loaded with `vite build --mode android`; then the script
     is `vite build --mode android && cap sync android`).

5. **Android manifest and resources.**
   - `android/app/src/main/AndroidManifest.xml`: add
     `<uses-permission android:name="android.permission.RECORD_AUDIO" />` and
     `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />`.
     `INTERNET` is already there. Keep `android:usesCleartextTraffic` unset (false).
   - Capacitor's WebView asks for the microphone runtime permission the first time the
     page calls `getUserMedia`, as long as the manifest declares it. No plugin needed.
   - Icons and splash: put `assets/icon-only.png`, `assets/icon-foreground.png`,
     `assets/icon-background.png`, `assets/splash.png`, `assets/splash-dark.png` (owner
     supplies final art; use the Emmanuele portrait on the cobalt background until then)
     and run `npx capacitor-assets generate --android`. Commit the generated resources.
   - `android/app/build.gradle`: `versionName` from `package.json`'s version; `versionCode`
     an integer that is raised by hand for every upload (document this in the README).
     Add a `release` signing config that reads `android/keystore.properties` when the file exists.

6. **Firebase Auth inside the WebView** (`firebaseAuth.ts`).
   When `isNativeApp()`, create auth with
   `initializeAuth(app, { persistence: indexedDBLocalPersistence })` instead of `getAuth(app)`
   (the default initialisation loads browser popup helpers that can hang in a WebView).
   If the Firebase web API key has HTTP-referrer restrictions in Google Cloud Console, add
   `https://localhost/*` to them, or anonymous sign-in from the app will fail.

7. **Speech: server only in the app** (`speech.ts`, `VoiceCallModal.tsx`, `DevSettingsDrawer.tsx`).
   - When `isNativeApp()`: `createSpeechRecognizer` returns null; `speakSmart` never uses
     `browser_tts` (a server failure surfaces as an error state on the Listen button);
     the `browser_tts` and `browser_web_speech` options are hidden.
   - Tests in `tests/speech.test.ts` with `isNativeApp` mocked.

8. **Microphone denied.** In `liveCall.ts`/`VoiceCallModal.tsx`, when `getUserMedia`
   rejects with `NotAllowedError`, show: "Parliamo needs the microphone for calls. Allow it
   in Settings → Apps → Parliamo Italiano → Permissions." with a "Close" button. No retry loop.

9. **Lifecycle** (`src/utils/nativeLifecycle.ts`, used from `App.tsx` and `VoiceCallModal.tsx`).
   - Call: when the call reaches its connected state, `KeepAwake.keepAwake()` and add
     `App.addListener('appStateChange', ({ isActive }) => { if (!isActive) endCall(); })`.
     Remove the listener and `KeepAwake.allowSleep()` when the call ends. Attach only
     after connecting: the microphone permission dialog also makes the app "inactive".
   - Back button: `App.addListener('backButton', …)`: close, in this order, the call,
     any open dialog/drawer, the plans or sign-in screen (when skippable); otherwise
     `App.minimizeApp()`.
   - All of this is a no-op when `!isNativeApp()`.

10. **Layout on a phone.**
    - `index.html` already has `viewport-fit=cover`. Add `padding: env(safe-area-inset-top) …`
      to the outer containers in `App.tsx`, `OnboardingPage`, `SignInScreen`, `PlansScreen`
      and the full-screen modals (a `.safe-area` utility class in `src/index.css`).
    - Check on a device with gesture navigation and on Android 15+ (edge-to-edge is forced):
      the composer stays above the keyboard and nothing sits under the status bar.
    - Offline banner: a small `role="status"` bar "No internet connection" driven by
      `navigator.onLine` and the `online`/`offline` events.

11. **CI** (`.github/workflows/ci.yml`): new job `android`:
    checkout, Node 22, `actions/setup-java@v4` (Temurin 21), `npm ci`,
    `VITE_API_BASE_URL=https://example.invalid npm run build`, `npx cap sync android`,
    `cd android && ./gradlew assembleDebug --no-daemon`. `deploy.yml` does not wait for it.

12. **Docs**: README section "Android app": prerequisites (Android Studio, JDK),
    build, run on a device, create a release bundle, version codes, where the keystore lives.

## Owner setup

1. Create the Play Console app with the package name above.
2. Generate an upload keystore (`keytool -genkeypair …`), store it and its passwords in a
   password manager, create `android/keystore.properties` locally.
3. Build `./gradlew bundleRelease` and upload the `.aab` to **internal testing**.

## Test on a real device

- Cold start shows onboarding; a guest can chat.
- Voice call: permission prompt appears once; audio in both directions; captions.
- During a call press Home: the call ends; reopening shows the chat.
- Switch Wi-Fi → mobile data during a call: the existing reconnect logic recovers or the call ends cleanly.
- Deny the microphone: the explanation appears.
- Rotate, open the keyboard, use the back button on every screen.
- Kill and reopen: the session is restored (same guest account).
