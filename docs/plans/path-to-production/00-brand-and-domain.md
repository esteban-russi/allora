# Plan 00: brand constants and custom domain

Branch: `chore/brand-and-domain`. Depends on: nothing. **Do this first**: the Android
application ID and the domain are baked into later plans and cannot be changed cheaply
after the first Play upload (ID) or after App Links and Firebase are configured (domain).

Read first: `index.html`, `src/components/TopHeader.tsx`, `src/components/OnboardingPage.tsx`,
`src/data/personaPrompts.ts`, `server.ts`, `.github/workflows/deploy.yml`, `scripts/setup-gcp-deploy.sh`.

## Goal

The app's name lives in one place so the rebrand is a one-file change, and the app is
served from the custom domain.

## Owner decisions needed before this PR can be finished

| Value | Placeholder used in the other plans | Example | Notes |
|---|---|---|---|
| Product name | `<APP_NAME>` | "Parliamo Italiano" | Play store title, max 30 characters. Check it is free on Google Play and as a trademark. |
| Short name | `<APP_SHORT_NAME>` | "Parliamo" | Shown in the header and under the home-screen icon (about 12 characters). |
| Domain | `<APP_HOST>`, `<APP_URL>` = `https://<APP_HOST>` | `app.example.com` | A subdomain for the app leaves the bare domain free for a marketing page. |
| Android application ID | `<APP_ID>` | `com.example.app` | Reverse-domain form, lowercase. Permanent once uploaded to Play. Prefer one based on the new domain or name, not on "parliamoitaliano". |
| Support email | `<SUPPORT_EMAIL>` | `support@example.com` | Shown in the legal pages and the Play listing. With a personal developer account, Google shows the developer's contact details publicly on paid apps. |

Steps 1–3 can be merged with the current name; steps 4–6 need the final values.

## Decisions

| Question | Decision |
|---|---|
| Where the name lives (client and server) | `src/data/brand.ts`, imported by both. |
| Static files that cannot import it (`index.html`, `public/*.html`, `manifest.webmanifest`) | Vite's `transformIndexHtml` replaces `%APP_NAME%` tokens at build time for `index.html`; the few static files are listed in the brand file's docstring and edited by hand. |
| Things that keep the old name | The GitHub repo, Cloud Run service, Artifact Registry repo, GCP project and the `parliamo.*` localStorage keys. They are not user-visible; renaming them risks the deployment and existing sessions for no gain. |
| How the domain reaches Cloud Run | A Cloud Run domain mapping in `europe-west1`. Not Firebase Hosting (it cannot proxy the `/api/live` WebSocket). If the domain mapping proves unreliable, move to a global external Application Load Balancer with a serverless NEG (about $18/month); no code changes either way. |
| Old `run.app` URL | Keeps working. The server redirects browser page loads (not `/api/*`) from other hosts to `<APP_URL>` once `APP_URL` is set. |

## Steps (one commit each)

1. **Brand module** (`src/data/brand.ts`).
   ```ts
   export const BRAND = {
     name: 'Parliamo Italiano',        // <APP_NAME>
     shortName: 'Parliamo',            // <APP_SHORT_NAME>
     premiumName: 'Parliamo Premium',  // `${shortName} Premium`
     supportEmail: 'support@example.com'
   } as const;
   ```
   Docstring lists the static files that also contain the name.

2. **Use it.** Replace hard-coded names in `TopHeader.tsx`, `OnboardingPage.tsx`,
   `DevSettingsDrawer.tsx` (`runtime` string), `personaPrompts.ts` (the platform name in
   the system instruction), `server.ts` (startup log, STT prompt, `User-Agent`).
   `grep -rni "parliamo" src server.ts liveBridge.ts` must then only show `brand.ts`,
   storage keys and test fixtures.

3. **`index.html` tokens.** Replace the title and meta contents with `%APP_NAME%` and add
   a small Vite plugin in `vite.config.ts`:
   ```ts
   { name: 'brand-html', transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', BRAND.name) }
   ```
   Rewrite the meta description so it does not depend on the old name.

4. **Rename** (needs the final name): update `BRAND`, the `package.json` `name` (optional),
   `metadata.json` (or delete it, plan 12), README title and text.

5. **Canonical host redirect** (`server.ts`).
   - Read `APP_URL` (already in `.env.example`). When set and `NODE_ENV=production`:
     for `GET` requests that are not under `/api/` or `/.well-known/` and whose `Host`
     differs from the `APP_URL` host, respond `308` to `APP_URL + req.originalUrl`.
   - API and WebSocket requests are never redirected (the Android app and old tabs keep working).
   - Tests: redirect for `/` on another host; no redirect for `/api/health`; no redirect when unset.
   - `deploy.yml`: `APP_URL=${{ vars.APP_URL }}`.

6. **Docs.** README: the domain, how the mapping was created, where the name lives.

## Owner setup (domain)

1. Buy the domain; verify it in Google Search Console with the Google account that owns the GCP project.
2. `gcloud beta run domain-mappings create --service=<service> --domain=<APP_HOST> --region=europe-west1 --project=<project>`
   and add the DNS records it prints. Certificate provisioning can take up to a day.
3. Check `https://<APP_HOST>/api/health` and a voice call (WebSocket) on the new domain.
4. Set the GitHub variable `APP_URL`, then deploy step 5.
5. Firebase console → Authentication → Settings → Authorised domains: add `<APP_HOST>`.
6. Later plans use this domain for: the email action URL (03), App Links and
   `assetlinks.json` (08), the reCAPTCHA key (10), the RevenueCat webhook URL (05), and
   the Play listing URLs (11).

## Everywhere the placeholders appear

- `<APP_ID>`: plans 07, 08, 09 (Capacitor `appId`, Firebase Android app, intent URL, Play URLs).
- `<APP_NAME>` / `<APP_SHORT_NAME>`: UI copy in plans 03, 04, 07, 08, 09, 11. Where a
  plan quotes copy with "Parliamo" in it, use `BRAND.shortName` / `BRAND.premiumName`.
- Product IDs `parliamo_pro_monthly` / `parliamo_pro_annual` (plans 05, 06, 09) are never
  shown to users. Rename them only if you want; they cannot be changed after products go live.
