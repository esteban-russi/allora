# Plan 12: production cleanup

Branch: `chore/production-cleanup`. Depends on: nothing (can be done any time; rebase if
plan 04 has changed `handleSendMessage`).

Read first: `src/components/DevSettingsDrawer.tsx`, `src/types/index.ts`,
`src/data/fallbacks.ts`, `src/App.tsx` (`handleSendMessage`), `index.html`, `server.ts`
(`/api/health`, the end of `startServer`), `.github/workflows/deploy.yml` (smoke test).

## Goal

Remove what is left of the prototype and add the small things a public product needs.
Each step is independent; keep them as separate commits so any one can be dropped.

## Steps (one commit each)

1. **Remove mock voice providers.**
   - Delete `'elevenlabs'` and `'openai_tts'` from `VoiceProvider` in `src/types/index.ts`
     and their two cards in `DevSettingsDrawer.tsx` (search for "Architectural parameter mock").
   - Fix every `switch`/comparison the type checker then flags (`npm run lint`).

2. **Split settings from the developer lab.**
   - New `src/components/SettingsDialog.tsx` with the learner-facing options only:
     correction style (Casual / Friendly Tutor / Strict Professor), subtitles on/off,
     play replies aloud automatically, speaking speed. It edits the same `DevSettings` object.
   - The Settings button in `IconRail` opens this dialog and is labelled "Settings".
   - `DevSettingsDrawer` (providers, engines, temperature, sampling rate) opens only when
     `import.meta.env.DEV` is true or `localStorage.getItem('parliamo.devlab') === '1'`,
     from a "Developer options" button inside `SettingsDialog` that is rendered only then.

3. **No invented tutor replies when the server fails.**
   Today a failed `/api/chat` request makes the app generate a canned reply locally
   (`generatePersonaFallbackMessage`), which looks like a real answer.
   - In `handleSendMessage`, on a non-quota failure: keep the learner's message, and show
     an inline error row under it: "Emmanuele couldn't reply. Check your connection." with
     a "Try again" button that resends the same text (without adding the message twice).
   - Same for the turn-based call path (`generateCallFallback` in `VoiceCallModal`): show
     the error state already used for call failures instead.
   - Delete `src/data/fallbacks.ts` and `tests/fallbacks.test.ts` if nothing else uses them.
   - Keep the server-side "Scusa, ho avuto un problema…" fallback for unparseable model output.

4. **Empty notebook for new learners.** `INITIAL_SAVED_PHRASES` seeds two phrases the
   learner never saved. Make it an empty array and give `UtilityPanel` an empty state:
   "Tap Save on any reply to keep it here."

5. **Trim `/api/health`.** It is public and lists models, region and which credentials
   exist. Return only `{ status: 'ok' }`; move the rest into the `/api/metrics` response
   (operators only). The deploy smoke test only needs a 200. Update tests and README.

6. **HTTP hardening** (`server.ts`).
   - `app.disable('x-powered-by')`.
   - A small middleware setting `X-Content-Type-Options: nosniff`,
     `Referrer-Policy: strict-origin-when-cross-origin`,
     `Strict-Transport-Security: max-age=31536000` (production only), and
     `X-Frame-Options: DENY`.
   - Unknown API paths: before the SPA wildcard add
     `app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))`
     so `/api/typo` no longer returns `index.html`.
   - Static assets: `express.static(dist, { maxAge: '1y', immutable: true })` for
     `/assets/*` (hashed file names) and `no-cache` for `index.html`.
   - Tests for the headers and the JSON 404.

7. **Icons and web manifest.**
   - `public/favicon.svg`, `public/icon-192.png`, `public/icon-512.png`,
     `public/icon-maskable-512.png`, `public/apple-touch-icon.png` (from the same art as
     the Android icon, plan 07), `public/og-image.png` (1200×630).
   - `public/manifest.webmanifest`: `name`, `short_name` "Parliamo", `start_url` "/",
     `display` "standalone", `background_color` and `theme_color` `#FCFCFC`, the icons.
   - `index.html`: `<link rel="icon">`, `<link rel="apple-touch-icon">`,
     `<link rel="manifest">`, `<meta property="og:image">`.
   - No service worker (not needed, and it complicates updates).

8. **Self-host the fonts.** Replace the Google Fonts `<link>` tags with
   `@fontsource-variable/fraunces`, `@fontsource-variable/inter` and
   `@fontsource/jetbrains-mono` imported in `src/main.tsx`. Removes a third-party request
   (privacy policy stays simpler) and makes the Android app render correctly offline.
   Check `src/index.css` font-family names still match.

9. **Language attributes.** `index.html` says `lang="it"` but the interface is English.
   Set `lang="en"`, and add `lang="it"` on elements that hold Italian text (tutor
   messages, quick replies, saved phrases' Italian line, Italian headings such as
   "Benvenuto"), so screen readers pronounce both correctly.

10. **Leftovers.** Remove `metadata.json` and the AI Studio HMR comments in `vite.config.ts`
    if nothing uses them; set `"version"` in `package.json` to `1.0.0` (the Android
    `versionName` reads it); README: remove references to deleted pieces.

## Not in this plan (decide later)

- Client error reporting (e.g. Sentry). Server errors already reach Cloud Logging.
- A custom domain (see the overview's open questions).
- A GCP budget alert: set it in the Cloud console (Billing → Budgets & alerts), no code.
