# Parliamo Italiano: path to production (web + Google Play)

This replaces the earlier "Path to Production" Google Doc. That doc described a prototype
with API keys in the browser and a tutor called Ottavia. The app has moved on, so this
plan starts from what is deployed today.

## 1. Where we are

Already built and deployed (Cloud Run, `europe-west1`):

- React 19 + Vite + Tailwind client; tutor Emmanuele; text chat and Gemini Live voice calls.
- Express server (`server.ts`) that brokers every AI call: `/api/chat`, `/api/translate`,
  `/api/tts`, `/api/stt`, `/api/session`, and the `/api/live` WebSocket (`liveBridge.ts`).
  No provider keys reach the browser; the server calls Vertex AI with its service account.
- Anonymous Firebase sign-in (`src/utils/firebaseAuth.ts`); the server verifies ID tokens
  itself (`src/server/auth.ts`) and rejects unauthenticated requests in production.
- Learner sessions in Firestore (`SessionStore`, branch `feature/firestore-sessions`).
- Per-IP and per-user requests-per-minute limits, one live call per user, CI + deploy.

Missing for a paid launch:

| Gap | Plan |
|---|---|
| No account record, no notion of a plan | 01 |
| No daily caps, so cost per user is unbounded | 02 |
| No real sign-in (only anonymous) and no account deletion | 03 |
| The app cannot show limits or a paywall | 04 |
| No subscriptions or payments | 05, 06, 09 |
| No Android app | 07, 08 |
| Anonymous tokens can be minted by scripts | 10 |
| Play policy items (privacy policy, reporting AI replies, age, deletion URL) | 11 |
| Prototype leftovers (mock providers, no icons/manifest) | 12 |

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Backend | Keep Express + TypeScript on Cloud Run. No FastAPI rewrite. | It works and is tested; a rewrite adds weeks and no user value. |
| Database | Firestore (already used for sessions). No PostgreSQL. | Three small collections (`users`, `usage`, `reports`) fit it; no new infrastructure. |
| Auth | Firebase Auth: anonymous first, then Google or email magic link. | Already in place; one user ID for web and Android. |
| Sign-in moment | After the onboarding questions the learner is offered sign-in (and then the plans). They can skip and continue as a guest. "Already have an account? Log in" is on the first screen. | Product decision. |
| Guest to account | Sign in, then the server moves the guest's session to the account (`POST /api/account/merge`). | One code path for new and returning users; no `linkWithCredential` edge cases. |
| Tiers | `guest` (anonymous), `free` (signed in), `premium` (active subscription). | Guests cost money and can be recreated freely, so they get the smallest allowance. |
| Limits | Daily caps, reset at 00:00 UTC. Values in section 3; all are config. | Product decision. |
| Payments | RevenueCat as the single source of subscription state. Google Play Billing in the Android app, RevenueCat Web Billing (Stripe) on the web. | Play requires Play Billing inside the Android app; RevenueCat gives one entitlement for both stores. |
| Buying requires an account | Guests must sign in before the purchase button works. | The subscription has to be tied to an account that survives a reinstall. |
| Android shell | Capacitor, web assets bundled in the app, API calls to the Cloud Run URL. | One codebase; native Play Billing, Google sign-in and Play Integrity plugins. |
| Abuse protection | Firebase App Check (reCAPTCHA Enterprise on web, Play Integrity on Android). | Stops scripts minting anonymous accounts to use the AI for free. |
| Server SDK | Add `firebase-admin` (Auth user deletion, App Check verification). ID token verification stays as is. | The earlier "avoid firebase-admin" choice no longer holds once these two are needed. |

## 3. Plans and limits

| | Guest | Free | Premium |
|---|---|---|---|
| Chat messages per day | 5 | 15 | 300 (shown as "unlimited") |
| Voice call minutes per day | 2 | 5 | 60 |
| Helper requests per day (listen, translate, speech-to-text) | 30 | 100 | 1000 |
| Saved conversation across devices | no | yes | yes |
| Tutors | Emmanuele | Emmanuele | All tutors (plan 13) |

Guest numbers are an assumption (not confirmed by the owner); they are constants in
`src/server/plans.ts`.

Prices: £8.99 / €9.99 / $9.99 per month; £59.99 / €69.99 / $69.99 per year with a
7-day free trial on the annual plan. Product IDs: `parliamo_pro_monthly`,
`parliamo_pro_annual`. RevenueCat entitlement ID: `premium`.

## 4. Target architecture

```
Web browser ─┐                          ┌─ Vertex AI (chat, TTS, Live)
             ├─ HTTPS / WSS ─ Cloud Run ─┼─ Firestore: learnerSessions, users, usage, reports
Android app ─┘   (Express, liveBridge)   ├─ Firebase Auth + App Check (verify, delete users)
 (Capacitor)                             └─ RevenueCat REST API  ◄── webhook ── RevenueCat
      │                                                                         ▲      ▲
      └── Play Billing (RevenueCat SDK) ────────────────────────────────────────┘      │
Web ───── RevenueCat Web Billing (Stripe) ─────────────────────────────────────────────┘
```

## 5. Pull requests

One plan file per PR. Do them in this order; each is deployable on its own.

| # | Plan | What ships | Depends on | Status |
|---|---|---|---|---|
| 00 | [Brand constants and custom domain](00-brand-and-domain.md) | App name in one place, custom domain, final Android app ID | none (do first) | |
| 01 | [Accounts and tiers](01-accounts-and-tiers.md) | `users` collection, tier logic, `GET /api/me` | firestore-sessions merged | ✅ |
| 02 | [Daily usage limits](02-daily-usage-limits.md) | `usage` collection, caps on chat, helpers and voice minutes | 01 | 🟠 |
| 03 | [Sign-in on the web](03-sign-in-web.md) | Google + magic link, guest merge, sign out, delete account | 01, 02 | 🟠 |
| 04 | [Limits and paywall UI](04-limits-and-paywall-ui.md) | Usage meter, limit-reached states, plans screen (no checkout yet) | 02, 03 | 🟠 |
| 05 | [Billing backend](05-billing-backend.md) | RevenueCat webhook and sync, subscription on the user record | 01 | 🟠 |
| 06 | [Web checkout](06-web-checkout.md) | Card payments on the web through RevenueCat Web Billing | 04, 05 | |
| 07 | [Android app shell](07-android-app-shell.md) | Capacitor project, API base URL, CORS, mic, lifecycle | 01–04 on main | |
| 08 | [Android sign-in](08-android-sign-in.md) | Native Google sign-in, magic link through App Links | 03, 07 | |
| 09 | [Android purchases](09-android-purchases.md) | Play Billing through RevenueCat, restore purchases | 05, 07, 08 | |
| 10 | [App Check](10-app-check.md) | Attestation on web and Android, enforced on billed routes | 07 | |
| 11 | [Store compliance](11-store-compliance.md) | Privacy/terms pages, deletion URL, report a reply, 18+ confirmation | 03 | |
| 12 | [Production cleanup](12-production-cleanup.md) | Remove mocks, manifest and icons, headers, accessibility fixes | none | |
| 13 | [Premium tutors](13-premium-tutors.md) | Extra tutors locked to premium, enforced on the server | 01, 04 | |

Web-only launch = 00–06 + 11–13. Android launch adds 07–10.

The app is being renamed and moved to a custom domain. Plans use the placeholders
`<APP_NAME>`, `<APP_SHORT_NAME>`, `<APP_HOST>`, `<APP_URL>`, `<APP_ID>` and
`<SUPPORT_EMAIL>`; plan 00 defines them. Where a plan quotes UI copy containing
"Parliamo", use the brand constants instead.

Rules for every PR (from `AGENTS.local.md` and the existing code):

- Small, atomic commits; each plan lists them under "Steps". No AI attribution in commits or PRs.
- Follow the patterns already in the repo: store interfaces with an in-memory and a
  Firestore implementation (see `src/server/sessionStore.ts`), injectable clocks and
  dependencies for tests, a two-line module docstring, `Args/Returns/Raises` docstrings on
  exported functions, camelCase names as in the existing TypeScript.
- `npm run lint`, `npm test` and `npm run build` must pass.
- New environment variables go in `.env.example`, the README table and `deploy.yml`.
- Never log tokens, emails, audio or message text.

## 6. Work outside the code (start now, it has lead time)

| Task | Lead time | Needed by |
|---|---|---|
| Google Play developer account, **personal** ($25), identity and device verification | days | 07 |
| Recruit 12 testers; a new personal account needs a closed test with 12 testers for 14 days before production access | 14+ days | launch |
| Choose the new name, buy the custom domain, choose the Android app ID (plan 00) | days | 00, then 03, 07, 08 |
| Content for the premium tutors: character, prompt, voice, portraits (plan 13) | days | 13 |
| Firebase console: enable Google and Email link providers, add the domain to authorised domains, set the custom email action URL | 1 hour | 03 |
| RevenueCat project, entitlement `premium`, offering `default` | 1 hour | 05 |
| Stripe account connected to RevenueCat Web Billing, tax settings | days (verification) | 06 |
| Play Console: merchant/payments profile, subscription products, licence testers | days | 09 |
| Privacy policy and terms text (owner or lawyer writes it; 11 only builds the pages) | days | 11 |
| Store listing: icon 512×512, feature graphic 1024×500, 4–8 phone screenshots with Emmanuele, descriptions | 1–2 days | launch |
| Play forms: Data safety (voice audio and text sent to Google for AI processing), content rating, target audience 18+, app access instructions for reviewers | 1 day | launch |

Upload a build to Play **internal testing** as soon as 07 is merged. Play Billing cannot
be tested until a build with the billing library is on a track.

## 7. Launch checklist

- [ ] 01–12 merged; `QUOTAS_MODE=enforce`, `APP_CHECK_MODE=enforce` in production.
- [ ] `--max-instances` raised above 1 (limits no longer depend on one instance).
- [ ] Budget alert on the GCP project; `/api/metrics` cost estimates checked against billing.
- [ ] Test purchase, renewal, cancel, refund and restore on Android (licence tester) and web (Stripe test mode).
- [ ] Guest → sign in → subscribe → reinstall → sign in → premium is restored.
- [ ] Delete account in the app and from the web link; all Firestore documents and the Firebase user are gone.
- [ ] Privacy policy, terms and delete-account URLs open without sign-in.
- [ ] Closed test ran 14 days with 12 testers; production access granted.
- [ ] Target API level meets Play's current requirement; signed `.aab`; upload key backed up.

## 8. Owner answers and open questions

Answered:
- Custom domain: yes, and the app will be renamed (plan 00).
- Premium also unlocks extra tutors (plan 13).
- Play developer account: personal. This means the 12-tester, 14-day closed test applies,
  and the developer's contact details are public on a paid app.

Still open:
1. Guest allowance (5 messages, 2 voice minutes a day): keep, or require sign-in before any use?
2. The new name, domain and Android app ID (plan 00 lists what is needed).
3. Which premium tutors to launch with, and who produces the portraits (plan 13).
