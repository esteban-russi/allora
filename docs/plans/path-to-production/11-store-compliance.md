# Plan 11: store compliance

## Status

- Branch: `feature/store-compliance`
- Date: 2026-11-19
- Summary: Implemented all 8 steps — public legal pages (`/privacy`, `/terms`, `/delete-account`), in-app footer links, 18+ and Terms/Privacy consent persistence with blocking dialog for restored users, AI tutor disclosures, content reporting (in-memory + Firestore store, `POST /api/report`, merge transfer, delete cleanup, client UI in chat and voice calls), explicit Gemini safety settings + prompt guardrails + blocked-reply handling, and README compliance docs.
- After review:
  - Reports are transferred to the signed-in user on guest merge (`ReportStore.transferUserReports`) rather than deleted, so harmful-content reports survive sign-in.
  - Blocked chat replies return HTTP 200 with a fixed Italian decline line (`BLOCKED_REPLY_TEXT`) and empty translation, because plan 12 removed invented fallbacks on failures (real upstream failures still return 5xx).
- Items needing attention:
  - 🟠 Owner setup: Review and replace the draft legal text in `public/privacy.html`, `public/terms.html`, and `public/delete-account.html` (ideally with a lawyer) and remove the `"DRAFT – not yet reviewed"` banners.
  - 🟠 Owner setup: Fill in every `[to confirm: …]` placeholder in the legal pages before launch:
    - `[to confirm: developer legal name and postal address]` (`public/privacy.html`, `public/terms.html`, `public/delete-account.html`)
    - `[to confirm: production app URL]` (`public/delete-account.html`)
    - `[to confirm: refund policy beyond what stores and applicable law require]` (`public/terms.html`)
    - `[to confirm: governing law and courts]` (`public/terms.html`)
  - 🟠 Owner setup: In Cloud Logging, create a log-based alert on `"[Report] New content report"` → email.
  - 🟠 Owner setup: Firestore TTL is intentionally not set on `reports`; review and delete handled reports manually in the Firestore console.
  - 🟠 Owner setup: Complete the Google Play Console declarations (Privacy Policy URL, Account Deletion URL, Data safety, 18+ Target audience, IARC content rating, Ads, App access, and AI-generated content) using the table below.

Branch: `feature/store-compliance`. Depends on: 03.

Read first: `src/components/OnboardingPage.tsx`, `src/components/ChatInterface.tsx`
(the Listen / Translate / Save actions under a tutor message), `src/components/VoiceCallModal.tsx`
(captions), `src/data/personaPrompts.ts`, `server.ts` (static serving at the bottom, the
Gemini request configs), `src/server/accountStore.ts`, `src/server/accountRoutes.ts`.

Check Google Play's current policies before starting: **User Data** (privacy policy,
account deletion), **AI-Generated Content** (in-app reporting), **Subscriptions**,
**Families / target audience**. If a requirement differs from this plan, follow the policy.

## Goal

Everything Google Play (and basic consumer law) expects from an AI tutoring app with
accounts and subscriptions: public legal pages, a public account-deletion page, a way to
report an AI reply, an adults-only confirmation, and safety settings on the model.

## Decisions

| Question | Decision |
|---|---|
| Legal pages | Static HTML in `public/` (`privacy.html`, `terms.html`, `delete-account.html`), served at `/privacy`, `/terms`, `/delete-account`. Viewable without sign-in. This PR ships the pages with draft text marked "DRAFT"; the owner replaces the text before launch. |
| Audience | Adults (18+). Stated in onboarding, the terms and the Play target-audience form. |
| Consent record | `users/<uid>.consent = { termsVersion, acceptedAt }`, written through `POST /api/account/consent`. |
| Reporting | A "Report" action on every tutor message (chat and call captions). Reports go to a Firestore collection `reports`; a log line lets the owner set up an email alert. |
| Report contents | The reported text is stored with the report (the learner is told so in the dialog). Deleted with the account. |
| Model safety | Explicit `safetySettings` on chat and Live requests, plus a short safety paragraph in the system prompt. |

## Steps (one commit each)

1. **Legal pages.**
   - Create `public/privacy.html`, `public/terms.html`, `public/delete-account.html`:
     plain, self-contained HTML (inline CSS, same fonts/colours as the app, `lang="en"`,
     a link back to `/`). A visible "DRAFT – not yet reviewed" banner in each.
   - `privacy.html` sections (fill with accurate descriptions of what the code does):
     who we are and contact email; data we collect (first name, level, tutor choice;
     email when signed in; messages and call transcripts; voice audio, streamed for
     processing and not stored; daily usage counts; subscription status); why; processors
     (Google Cloud: Vertex AI, Firestore, Firebase Authentication; RevenueCat; Stripe;
     Google Play); that Vertex AI does not use the content to train models (see
     `src/server/privacyAndPolicy.ts`); retention (sessions expire after 30 days of
     inactivity; usage after 35 days; reports until resolved); your rights and how to
     delete; adults only; changes.
   - `terms.html`: the service; AI tutor disclaimer (replies can be wrong, not professional
     advice); accounts; plans, prices, renewal, trial, cancelling (Google Play / web),
     refunds; acceptable use; termination; liability; governing law; contact.
   - `delete-account.html`: app name and developer name; steps ("Open the app or
     <APP_URL> → sign in → tap your avatar → Delete account"); what is deleted (account,
     conversations, notebook, usage) and what is kept (payment records held by Google
     Play / Stripe as required by law); a contact email for people who cannot sign in;
     a note that deleting the account does not cancel a store subscription.
   - `server.ts` (production branch of `startServer`, before the wildcard):
     `app.get(['/privacy', '/terms', '/delete-account'], (req, res) => res.sendFile(path.join(__dirname, 'dist', `${req.path.slice(1)}.html`)))`.
     In dev, Vite serves `/privacy.html` directly; link to the `.html`-less path through a
     tiny helper `legalUrl(name)` that returns `publicUrl('/privacy')` in production builds
     and `/privacy.html` in dev.
   - Test with supertest that the three paths are routed (mock `sendFile` or build first).

2. **Links in the app.** Footer links "Privacy" and "Terms" in `OnboardingPage`,
   `SignInScreen`, `PlansScreen` and `AccountMenu` (open in a new tab / system browser).

3. **Consent.**
   - `AccountStore.setConsent(userId, { termsVersion: string, acceptedAt: string })` in both
     stores + contract test; `Account.consent: { … } | null`; returned by `/api/me`.
   - `POST /api/account/consent` body `{ termsVersion }` (string ≤ 20 chars) → stores it
     with the server time. Works for guests.
   - `src/data/legal.ts`: `export const TERMS_VERSION = '2026-11'`.
   - `OnboardingPage`: a required checkbox above the start button:
     "I am 18 or older and I agree to the Terms and the Privacy Policy." (links). The
     start button stays disabled until it is ticked. On submit call the consent endpoint.
   - Restored users whose `me.consent?.termsVersion !== TERMS_VERSION` see a small blocking
     dialog with the same checkbox and a "Continue" button.
   - Server merge (plan 03): when the account has no consent and the guest has one, copy it.

4. **AI disclosure.** In `OnboardingPage` tutor card and `PersonaProfileModal`: a small
   "AI tutor" tag. One sentence under the onboarding heading: "Emmanuele is an AI
   character. His replies can contain mistakes."

5. **Report a reply: server.**
   - `src/server/reportStore.ts`: `ReportStore { addReport(report): Promise<void>; deleteAllUserReports(userId): Promise<number>; }`,
     in-memory + Firestore (`reports` collection), store selection as in plan 01.
   - `Report`: `{ id, userId, sessionId: string | null, source: 'chat' | 'call', text, reason: 'harmful' | 'inaccurate' | 'other', comment, createdAt }`.
   - `POST /api/report` (authenticated; add the path to both middleware lists): validate
     `text` (1–2000 chars), `reason` (one of the three), `comment` (≤ 500, optional),
     `source`, `sessionId` (optional string ≤ 100). Store, then
     `console.warn('[Report] New content report', { reason, source })` (no text, no user ID).
     Respond `{ status: 'received' }`.
   - `DELETE /api/account` also calls `deleteAllUserReports`.
   - Tests: validation, stored fields, deletion.

6. **Report a reply: client.**
   - `src/components/ReportDialog.tsx` (uses `useDialog`): radio group "Offensive or
     harmful" / "Wrong or misleading" / "Something else", optional comment textarea
     (max 500), note "The reported message is sent to us for review.", "Send report" / "Cancel".
     After sending: "Thanks. We'll review it."
   - `ChatInterface`: add a "Report" button (flag icon from `lucide-react`, visible label
     on focus/hover, `aria-label="Report this reply"`) to the action row of tutor messages.
   - `VoiceCallModal`: a small "Report" button next to the tutor caption; reporting does not end the call.

7. **Model safety.**
   - `server.ts` chat request config and `liveBridge.ts` `buildConfig`: add
     `safetySettings` for harassment, hate speech, sexually explicit and dangerous content
     with threshold `BLOCK_MEDIUM_AND_ABOVE` (enum names from `@google/genai`).
   - `personaPrompts.ts`: append to both the chat and voice system instructions:
     "Stay in your role as a friendly Italian tutor. If the learner asks for sexual,
     violent, hateful or dangerous content, or for medical, legal or financial advice,
     decline briefly in Italian and steer back to language practice. If the learner
     seems to be in distress, respond with care and suggest contacting local emergency
     services or someone they trust."
   - When Gemini blocks a reply (no text / a block reason), the chat route returns the
     existing "Scusa…" fallback text, not a 500. Add a test with `fakeGemini`.

8. **Docs**: README: legal pages, report flow, how to review reports (Firestore console),
   and the Play forms table below.

## Owner setup

1. Replace the draft legal text (ideally reviewed by a lawyer); remove the DRAFT banners.
2. Cloud Logging: log-based alert on `"[Report] New content report"` → email.
3. Firestore TTL is **not** set on `reports`; delete them by hand once handled.

## Play Console forms (answers that match this app)

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
