# Allora

Learn conversational Italian by talking to people, not flashcards.

The name, short name, premium plan name and support email live in `src/data/brand.ts`;
`index.html` gets the name at build time and `public/manifest.webmanifest` carries it by hand. The
repository, Cloud Run service, GCP project and the `parliamo.*` browser storage keys
keep the old name on purpose: renaming them would risk the deployment and sign learners out.

Allora is a web app where you practise Italian with an AI tutor. For now there is one: **Emmanuele the Roman**, a retired legionary who chats about daily life in Rome. You can write to him or switch to a hands-free voice call: speak into your microphone, and he answers out loud in natural Italian, with captions, translations and short grammar notes to help you learn from every reply.

## Meet your tutor

| Tutor | City | Who he is | Level | Talks about |
|---|---|---|---|---|
| **Emmanuele il Romano** | Roma | Retired legionary | A2-B1 | Daily life in Rome, work and routines, food and markets, Roman history |

Emmanuele has a hand-written persona prompt, a native saying, a sample greeting, his own Gemini voice (Charon) and two portrait expressions (resting and speaking).

## Design

The dashboard has three columns: a 72px icon rail, the chat workspace, and a utility panel with the tutor's profile, the notebook (latest grammar tip and saved phrases) and how much of the talking you did. Colours are Tailwind theme tokens in `src/index.css`:

| Token | Hex | Used for |
|---|---|---|
| `ink` | `#1B1725` | Text and headings |
| `cobalt` | `#256EFF` | Brand, primary actions, tutor bubbles (`cobalt-tint`) |
| `mint` | `#3DDC97` | Your bubbles (`mint-tint`), grammar card, mic, progress |
| `coral` | `#FF495C` | Your badge, saved phrases and quick replies (`coral-tint`) |
| `canvas` | `#FCFCFC` | Page background |

Italian text is set in Fraunces; the interface uses Inter.

## Features

- **Chat with Emmanuele.** Every reply comes in Italian with an English translation and 1 to 3 notes on vocabulary, verbs, idioms, grammar or culture. Listen to any line, hide its translation, or save it to your notebook.
- **Hands-free voice calls.** Calls stream through Gemini Live, so the tutor answers in under a second and you can interrupt him mid-sentence. Ask him to go slower, repeat himself, or suggest something to say. If Live is unavailable, the call carries on turn by turn (speech recognition, then chat, then text-to-speech).
- **Captions.** Follow each line of the call in Italian with an English translation.
- **Natural voices.** Replies are spoken with Gemini text-to-speech. If it is unavailable, the app falls back to the browser's built-in Italian voice.
- **Adjustable tutoring.** Settings let you choose correction style (Casual, Friendly Tutor, or Strict Professor), subtitles, auto-play replies aloud, and speaking speed.

## How it works

```
Browser (React)                         Server (Express)                Gemini
---------------                         ----------------                ------
Web Speech API  ── your speech ──▶  POST /api/chat  ──────────▶  gemini-3.8-flash
                                     (persona prompt + history,      returns JSON:
                                      correction strictness)         text, translation,
                                                                     grammarNotes
Audio player   ◀── WAV audio ────  POST /api/tts   ──────────▶  gemini-3.8-flash-lite-tts

Voice call     ◀── PCM audio ───▶  WS /api/live    ◀─────────▶  gemini-3.8-live
 (mic + speaker)    + transcripts    (server-owned prompt,         streaming audio in/out
                                      voice and level)
Captions       ◀── English ──────  POST /api/translate ──────▶  gemini-3.8-flash
```

The Gemini API key stays on the server. The browser only talks to the server's `/api/*` routes, including the `/api/live` WebSocket, which bridges each call to a Gemini Live session. On Vertex AI the Live model is served only from the `us` and `eu` multi-regions (not `global`), so set `GCP_REGION` to one of those; the deployed service uses `eu` (`GEMINI_LIVE_MODEL` overrides the model).

## Tech stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Motion · Lucide · Express · Google Gen AI SDK (`@google/genai`) · Web Speech API

## Running locally

**Prerequisites:** Node.js 20.19+ or 22.12+ and a [Gemini API key](https://aistudio.google.com/apikey).

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your key:
   ```bash
   cp .env.example .env
   # then set GEMINI_API_KEY in .env
   ```

3. Start the dev server (Express + Vite with hot reload):
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and allow microphone access when you start a call.

### Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Serves the production build with Express |
| `npm run lint` | Type-checks the project with `tsc --noEmit`, failing on unused code |
| `npm test` | Runs the Vitest suite in `tests/` (offline; no GCP credentials needed) |

Speech recognition relies on the browser's Web Speech API, so voice calls work best in Chrome or Edge.

The billed API routes (`/api/chat`, `/api/translate`, `/api/tts`, `/api/stt`, `/api/session`, `/api/me`) are rate-limited per IP (`RATE_LIMIT_PER_MINUTE`, default 60) and per user (60 a minute). Each user can hold one open Live call and each IP two. When deploying behind a proxy such as Cloud Run, set `TRUST_PROXY_HOPS=1` so the limit applies to each client rather than to the proxy.

## Accounts, sessions and privacy

**Authentication.** Billed routes and the Live socket need a Firebase Auth or Google Identity ID token. HTTP requests send it as `Authorization: Bearer <token>`; Live calls send it as the WebSocket subprotocol `auth, <token>`, never in the URL. Tokens are checked against Google's certificates, and their audience must be `GCP_PROJECT` (Firebase) or `GOOGLE_CLIENT_ID` (Google Identity). Auth is enforced when `NODE_ENV=production` or `ENFORCE_AUTH=true`, and the server refuses to start without one of those audiences. Locally, requests without a token run as a dev user (`x-dev-user-id` header or `devUserId` query) and `dev-token:<id>` tokens are accepted.

On load the client signs the learner in anonymously with Firebase (`src/utils/firebaseAuth.ts`), using the public web config from `GET /api/auth-config`, and the same anonymous account is reused on that device. That needs `FIREBASE_API_KEY` and `FIREBASE_APP_ID` set on the server and Anonymous sign-in enabled in the Firebase project `GCP_PROJECT`; without them, the client sends no token, which only works when auth is not enforced. Anyone can create anonymous accounts, so the per-IP limits remain the backstop against abuse.

**Sign-in, merging and account deletion.** Learners can upgrade from guest to an authenticated account using Google popup sign-in or an email magic link (`sendSignInLinkToEmail`). Upon signing in, `POST /api/account/merge` moves the guest's session and daily usage over to the account (unless the account already has active sessions, in which case guest sessions are discarded), deletes the guest `users` record, and deletes the anonymous Firebase user. `DELETE /api/account` deletes the learner's sessions, usage, and account documents, and permanently deletes their Firebase Auth user via `firebase-admin` (notifying the user if an active store subscription exists).

**Accounts and tiers.** Authenticated users are assigned a tier (`guest`, `free`, `premium`). `GET /api/me` returns the learner's account details, current tier, plan limits, subscription metadata, today's usage, and quota reset time (`resetsAt`). Guest records in Firestore carry a 30-day inactivity TTL on `expiresAtTs`. Accounts and sessions live in the store selected by `SESSION_STORE` (`memory` or `firestore`).

**Daily usage limits.** Daily quotas are tracked per user in Firestore (`usage` collection) or memory: chat messages, helper requests (TTS, STT, translation), and voice seconds. `QUOTAS_MODE` controls enforcement: `off` disables tracking, `monitor` (default in production) meters usage and logs over-limit events, and `enforce` rejects requests with HTTP 429 (`QUOTA_EXCEEDED`) or cuts off live voice calls when daily limits are reached. Usage documents expire after 2 days via Firestore TTL on `expiresAtTs`.

**Plans and limits.** The app provides three subscription tiers:
- **Guest**: For unauthenticated learners exploring the app. Includes 5 chat messages, 2 minutes of voice calls, and 5 helper requests (TTS, STT, translation) per day.
- **Free**: For registered accounts with email/magic link or Google sign-in. Includes 15 chat messages, 5 minutes of voice calls, and 100 helper requests per day.
- **Premium**: For subscribers. Includes unlimited chat messages (fair use cap of 300), 30 minutes of voice calls, and unlimited helper requests per day.

When daily quotas are reached:
- In chat, a status card explains the limit, preserves unsent draft text in the composer, and prompts guests to sign in or free users to view plans (when billing is available).
- In voice calls, calls gracefully cut off with an explanatory modal when time expires, or prevent connecting if zero time remains today.
- In helper tools (Listen and Translate), transient inline alerts ("Daily limit reached") are shown for 4 seconds.
- The drawer utility panel displays a real-time daily usage meter showing progress towards message and call limits and the local reset time.
- The plans screen (`PlansScreen`) compares allowances between free and premium tiers, with monthly and annual options.

**Billing backend and subscription synchronization.** RevenueCat acts as the source of truth for premium subscriptions across web and mobile stores:
- `POST /api/billing/sync`: Authenticated endpoint that queries RevenueCat REST API v1 for the current learner's entitlements and synchronizes `users/<uid>.subscription`. Invoked by the client post-purchase or on app launch when subscriptions near expiration.
- `POST /api/webhooks/revenuecat`: Webhook listener secured with constant-time token comparison (`REVENUECAT_WEBHOOK_AUTH`). Processes subscriber events (initial purchase, renewal, expiration, user transfer) by pulling latest status directly from RevenueCat.
- Subscription state includes a 1-hour grace window (`SUBSCRIPTION_SKEW_MS`) past `expiresAt` to avoid disruptions during delayed renewal webhooks.
- Account deletion (`DELETE /api/account`) cleans up subscriber data in RevenueCat via `deleteSubscriber`.
- When `REVENUECAT_SECRET_KEY` is omitted, the app runs normally without billing (endpoints return 503 `BILLING_UNAVAILABLE`).

**Learner sessions.** A session holds the learner's level, saved phrases and the last 50 conversation turns. The server assigns its ID, the client remembers it on the device, and both chat and Live turns are checkpointed to it. `GET /api/session` returns the latest session, `POST` creates or updates one, `DELETE /api/session/:id` deletes one and `DELETE /api/session` deletes all of a user's data. Sessions expire after 30 days without activity.

`SESSION_STORE` picks where sessions live. `memory` (the default, for local development) loses them on restart. `firestore` keeps one document per session in the `learnerSessions` collection, shared by all instances; a TTL policy on `expiresAtTs` deletes expired ones. Production uses Firestore. Per-user rate limits stay in each instance's memory.

**Live call resilience.** The client pings every 5 s and reconnects with backoff after 10 s without a reply; the server pings every 10 s and ends calls that stop answering, so a dead socket never holds the call slot. A reconnect for the same session replaces the old call and resumes the Gemini session with its stored resumption handle. If the handle is rejected, a fresh Gemini session starts with a recap of the recent turns; only if that also fails does the call continue turn by turn.

**Privacy.** Learner audio and text go only to Vertex AI by default (`vertex_only`). Failover to Google AI Studio, whose terms allow prompts to be logged and reviewed, happens only with `ALLOW_AI_STUDIO_FALLBACK=true`, and is logged as an audit warning. Raw audio and transcripts are never logged.

**Metrics.** `GET /api/metrics` reports runtime configuration (models, billing, GCP region and client availability), privacy mode, p50/p90/p95 time to first audio and barge-in stop latency (measured on the device from speech detection), reconnect outcomes, Live lessons with audio minutes, and estimated chat and Live costs. When auth is enforced, only user IDs in `METRICS_ADMIN_USER_IDS` can read it. `/api/health` stays public and returns only `{ "status": "ok" }`.

## Deployment

Every push to `main` runs the CI checks (type check, tests, build) and, if they pass, deploys to Cloud Run through `.github/workflows/deploy.yml`. The workflow builds the `Dockerfile` image, pushes it to Artifact Registry tagged with the commit SHA, deploys it, and checks `/api/health`. GitHub authenticates to Google Cloud through Workload Identity Federation, so no service-account keys are stored.

The service runs as its own service account and calls Vertex AI with its built-in credentials, so it needs no `GEMINI_API_KEY`. Its environment variables are set in the workflow's `env_vars` block.

One-time setup (needs `gcloud` and `gh` logged in with owner rights on the project and repo):

```bash
scripts/setup-gcp-deploy.sh <gcp-project-id> [region] [service-name]
```

The script enables the APIs, creates the Artifact Registry repo, the deployer and runtime service accounts and the identity pool, and writes the GitHub repo variables the workflow reads. You can also trigger a deploy by hand from the Actions tab (**Deploy to Cloud Run → Run workflow**).

### Firebase Console setup (owner, before deploying)

1. **Sign-in providers:** In Firebase Console → Authentication → Sign-in method, enable **Google** and **Email/Password** with **Email link (passwordless sign-in)**.
2. **Authorised domains:** In Firebase Console → Authentication → Settings → Authorised domains, add the app's Cloud Run or custom domain.
3. **Customize action URL:** In Firebase Console → Authentication → Templates → edit template → "Customize action URL": `<APP_URL>/auth/action`.
4. **IAM permissions:** Ensure `roles/firebaseauth.admin` is granted to the runtime service account (`parliamo-italiano-runtime@<project>.iam.gserviceaccount.com`).

### RevenueCat setup (owner, before deploying billing)

1. **RevenueCat project:** Create the project, entitlement `premium`, and offering `default` with packages `$rc_monthly` and `$rc_annual`.
2. **Secret Manager secrets:** Store the RevenueCat REST API secret key and a random webhook secret:
   ```bash
   printf '%s' '<REVENUECAT_SECRET_KEY>' | gcloud secrets create revenuecat-secret-key --data-file=- --project=<project>
   openssl rand -hex 32 | tr -d '\n' | gcloud secrets create revenuecat-webhook-auth --data-file=- --project=<project>
   gcloud secrets add-iam-policy-binding revenuecat-secret-key --member=serviceAccount:<runtime-sa> --role=roles/secretmanager.secretAccessor --project=<project>
   gcloud secrets add-iam-policy-binding revenuecat-webhook-auth --member=serviceAccount:<runtime-sa> --role=roles/secretmanager.secretAccessor --project=<project>
   ```
3. **Webhook configuration:** In RevenueCat → Integrations → Webhooks, set endpoint URL to `<APP_URL>/api/webhooks/revenuecat` with `Authorization: Bearer <the-webhook-secret>`. Check that "Send test event" returns 200.
4. **Web Billing public key:** In RevenueCat → Project Settings → Apps → Web Billing app, copy the Public API key (sandbox or production) and store it in the GitHub repository variable `REVENUECAT_WEB_PUBLIC_KEY`. The server exposes it safely to the browser client via `GET /api/auth-config`.
5. **Stripe & Web Billing products:**
   - In RevenueCat → Project Settings → Apps, create a Web Billing app and connect a verified Stripe account.
   - Create products `allora_pro_monthly` (£3.99/mo) and `allora_pro_annual` (£29.99/yr with a 7-day free trial), each with a 3-day grace period.
   - Attach both to entitlement `premium`, and to offering `default` as `$rc_monthly` and `$rc_annual`.
6. **Sandbox testing:**
   - Set `REVENUECAT_WEB_PUBLIC_KEY` to the sandbox Web Billing public key in the environment or GitHub repository variables.
   - Use Stripe test card `4242 4242 4242 4242` (any valid future date, 3-digit CVC) in checkout to test successful subscriptions and trial activation.
   - Use card `4000 0000 0000 0002` to verify payment decline error handling.

## Store compliance, legal pages and content reports

### Legal pages and consent

Static, self-contained HTML pages live in `public/privacy.html`, `public/terms.html`, and `public/delete-account.html` (viewable without sign-in). In production, `server.ts` serves them at `/privacy`, `/terms`, and `/delete-account` before the SPA wildcard; in dev, `legalUrl()` links to the `.html` files directly.

- Footer links (**Privacy** and **Terms**, opening in a new tab) appear on `OnboardingPage`, `SignInScreen`, `PlansScreen`, and `AccountMenu`.
- Learners must tick the 18+ and Terms/Privacy confirmation checkbox on onboarding (and restored users whose `me.consent?.termsVersion !== TERMS_VERSION` see a blocking `ConsentDialog`). Consent is persisted on `users/<uid>.consent` via `POST /api/account/consent` (and copied from guest to account on merge when the account has none).
- Replace the draft legal text and every `[to confirm: …]` placeholder, then remove the `DRAFT – not yet reviewed` banners before launch.

### Content reporting and model safety

- Every AI tutor reply in text chat (`ChatInterface`) and live voice-call captions (`VoiceCallModal`) has a **Report** action opening `ReportDialog` (reporting during a call does not end the call).
- `POST /api/report` validates the payload, stores `{ id, userId, sessionId, source, text, reason, comment, createdAt }` in the `reports` Firestore collection (or in-memory store in dev), and logs `[Report] New content report` with `{ reason, source }` only (never message text or user ID).
- Guest reports are transferred to the signed-in account on merge (`POST /api/account/merge`), and all user reports are deleted on account deletion (`DELETE /api/account`).
- Both `/api/chat` and `/api/live` pass explicit `safetySettings` (`BLOCK_MEDIUM_AND_ABOVE` for harassment, hate speech, sexually explicit, and dangerous content) and append safety instructions to the tutor system prompt. Blocked chat replies return HTTP 200 with a fixed Italian decline line (`BLOCKED_REPLY_TEXT`); real upstream failures still return 5xx.

### Reviewing reports (owner setup)

1. **Email alert:** In Cloud Logging, create a log-based alert matching `"[Report] New content report"` routed to your support email.
2. **Review in Firestore:** Open Google Cloud Console → **Firestore → Data → `reports`** to inspect submitted reports.
3. **Manual cleanup:** No TTL is configured on `reports`; delete each report document by hand once handled.

### Google Play Console forms

| Form | Answer |
|---|---|
| Privacy policy URL | `<APP_URL>/privacy` |
| Account deletion URL | `<APP_URL>/delete-account` |
| Data safety: collected | Name; email address; user IDs; messages (in-app messages / other user-generated content); voice or sound recordings (processed, not stored); purchase history; app interactions. Encrypted in transit: yes. Deletion can be requested: yes. Shared with third parties: no (service providers are processors). |
| Target audience | 18 and over |
| Content rating (IARC) | Answer honestly; note the app has AI-generated text and voice chat with an AI (not between users) |
| Ads | No |
| App access | "All features are available without credentials as a guest. To test Premium, sign in with any Google account and use a Play test card." Provide a demo account if the reviewer asks. |
| AI-generated content | Yes; in-app reporting is available on every tutor reply |

## Project structure

```
├── server.ts                  # Express server: chat, translate, TTS, STT, sessions, me, account, billing, report, health, metrics, Vite/static serving
├── liveBridge.ts              # /api/live WebSocket bridge to Gemini Live: auth, call limits, safety settings, heartbeat, resumption
├── public/                    # Web manifest, icons, and static legal pages (privacy.html, terms.html, delete-account.html)
├── src/
│   ├── App.tsx                # App state, routing and dashboard layout
│   ├── assets/emmanuele/      # Tutor portraits (resting and speaking)
│   ├── components/
│   │   ├── AccountMenu.tsx    # Account dialog: identity, plan, edit profile, sign out, delete account
│   │   ├── ConsentCheckbox.tsx # Shared 18+ and Terms/Privacy checkbox
│   │   ├── ConsentDialog.tsx  # Blocking consent modal for restored users
│   │   ├── LegalLinks.tsx     # Footer Privacy & Terms links
│   │   ├── ReportDialog.tsx   # Report-a-reply modal dialog
│   │   ├── PlansScreen.tsx    # Full-screen paywall and subscription plan selection
│   │   ├── UsageMeter.tsx     # Daily usage meter & upgrade call-to-action
│   │   ├── SignInScreen.tsx   # Sign-in screen: Google popup and magic link email form
│   │   ├── OnboardingPage.tsx # Learner name, CEFR level, tutor picker and consent
│   │   ├── IconRail.tsx       # Left navigation rail
│   │   ├── TopHeader.tsx      # Brand, conversation title, Text/Voice switch
│   │   ├── ChatInterface.tsx  # Chat bubbles, report action, quick replies and composer
│   │   ├── UtilityPanel.tsx   # Tutor profile, notebook and talking share
│   │   ├── VoiceCallModal.tsx # Hands-free voice call with captions and report action
│   │   ├── SettingsDialog.tsx # Learner settings: correction style, subtitles, auto-play, speaking speed
│   │   ├── DevSettingsDrawer.tsx # Developer lab (dev mode or parliamo.devlab=1)
│   │   ├── PersonaProfileModal.tsx
│   │   ├── PersonaBadge.tsx
│   │   └── UserBadge.tsx
│   ├── data/                  # brand.ts, legal.ts, personas.ts, personaPrompts.ts
│   ├── server/                # auth, accountStore, accountRoutes, billingRoutes, billingSync, identityAdmin, modelSafety, plans, reportStore, reportRoutes, revenueCat, usageStore, quota, sessionStore, rateLimiter, metrics
│   ├── utils/apiClient.ts     # Authenticated API calls (get, post, delete) and ID token source
│   ├── utils/billing.ts       # Client billing interface and active adapter registry
│   ├── utils/billingWeb.ts    # RevenueCat Web Billing adapter (@revenuecat/purchases-js)
│   ├── utils/clientConfig.ts  # Client config loader (/api/auth-config)
│   ├── utils/firebaseAuth.ts  # Client auth: anonymous, Google popup, email magic link, account merge
│   ├── utils/learnerSession.ts # Remembers the learner session and links chat turns to it
│   ├── utils/legalUrl.ts      # Dev/prod URL helper for static legal pages
│   ├── utils/me.ts            # Client account /api/me fetching, consent submission and typing
│   ├── utils/speech.ts        # Gemini TTS playback, browser TTS fallback, speech recognition
│   ├── utils/liveCall.ts      # Gemini Live call client: mic streaming, playback, heartbeat, reconnect
│   └── types/index.ts
└── index.html
```
