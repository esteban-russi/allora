# Plan 06: web checkout

## Status

- Branch: `feature/web-checkout`
- PR link: (pending opening)
- Date: 2026-11-19
- Summary: Fully implemented; web billing adapter with Purchases JS, dynamic config, checkout/success states, tests, and documentation.
- Items needing attention:
  - 🟠 Owner setup: Connect Stripe account to RevenueCat Web Billing and configure tax settings.
  - 🟠 Owner setup: Create Web Billing products (`parliamo_pro_monthly` and `parliamo_pro_annual`) attached to `premium` entitlement and offering `default` as `$rc_monthly` and `$rc_annual`.
  - 🟠 Owner setup: Set `REVENUECAT_WEB_PUBLIC_KEY` in GitHub repository variables with the RevenueCat Web Billing public key (sandbox key initially).
  - 🟠 Could not verify: End-to-end checkout modal with real Stripe processing; verified via comprehensive unit tests with fake SDK.

Branch: `feature/web-checkout`. Depends on: 04, 05.

Read first: plan 04 (the `Billing` interface and `PlansScreen`), plan 05,
`src/utils/firebaseAuth.ts` (how `/api/auth-config` is fetched), `server.ts`
(`buildFirebaseClientConfig`, `/api/auth-config`).

Before coding, read the current docs and TypeScript types of `@revenuecat/purchases-js`
(RevenueCat Web Billing). Method and property names below are from the SDK at the time
of writing; where the installed version differs, follow its types.

## Goal

A signed-in learner on the web can subscribe with a card, and becomes premium immediately.

## Decisions

| Question | Decision |
|---|---|
| Processor | RevenueCat Web Billing with a connected Stripe account. Checkout UI is the RevenueCat SDK's own modal; we build no card form and no Stripe webhooks. |
| Key delivery | `REVENUECAT_WEB_PUBLIC_KEY` (public by design) is served in `/api/auth-config` as `billing.revenueCatWebKey`, like the Firebase web config. No rebuild to change it. |
| SDK loading | Dynamic `import('@revenuecat/purchases-js')` the first time billing is used, so it is not in the main bundle. |
| After purchase | Call `POST /api/billing/sync`, then refresh `/api/me`. The webhook does the same in the background. |
| Manage / cancel | `customerInfo.managementURL` from the SDK, opened in a new tab from the account menu. |
| Android | This implementation must never be active in the Android app (Play policy forbids other payment methods there). Plan 09 selects the implementation by platform. |

## Steps (one commit each)

1. ✅ **Serve the key** (`server.ts`).
   - `/api/auth-config` responds `{ firebase: …, billing: { revenueCatWebKey: string | null } }`.
   - `revenueCatWebKey` = trimmed `REVENUECAT_WEB_PUBLIC_KEY` or null.
   - Test in `tests/server.test.ts`. Add the variable to `.env.example`, README, `deploy.yml`
     (`REVENUECAT_WEB_PUBLIC_KEY=${{ vars.REVENUECAT_WEB_PUBLIC_KEY }}`).

2. ✅ **Client config** (`src/utils/clientConfig.ts`).
   Move the `fetch('/api/auth-config')` call out of `firebaseAuth.ts` into
   `loadClientConfig(): Promise<{ firebase: FirebaseClientConfig | null; revenueCatWebKey: string | null }>`
   that fetches once and caches the promise. `firebaseAuth.ts` uses it. Update its tests.

3. ✅ **Web billing implementation** (`src/utils/billingWeb.ts`).
   ```ts
   export function createWebBilling(apiKey: string, deps?: { loadSdk?: () => Promise<PurchasesModule>; email?: () => string | null }): Billing
   ```
   - `npm install @revenuecat/purchases-js`.
   - Keep one configured instance per `userId`. If the SDK is already configured for a
     different user, switch with the SDK's change-user call (or reconfigure).
   - `isAvailable()` → true.
   - `getOffers(userId)`: `getOfferings()`, take `current`; map the package with
     identifier `$rc_monthly` to `id: 'monthly'` and `$rc_annual` to `id: 'annual'`;
     `priceText` from the product's formatted current price; `periodText` "per month" /
     "per year"; `trialText` from the default subscription option's trial period
     (e.g. 7 days → "7 days free"), else null. Skip packages without a web product.
   - `purchase(userId, plan)`: find the package, call `purchase({ rcPackage, customerEmail })`.
     On success, `await postJson('/api/billing/sync', {})` and return `{ status: 'purchased' }`.
     Map the SDK's "user cancelled" error code to `{ status: 'cancelled' }`; anything else
     to `{ status: 'failed', message: 'Payment could not be completed. You have not been charged.' }`.
   - `restore(userId)`: call `/api/billing/sync` and return `tier === 'premium'`
     (web purchases are tied to the account; there is nothing device-local to restore).
   - `manageUrl(userId)`: `getCustomerInfo()` → `managementURL ?? null`.
   - `tests/billingWeb.test.ts` with a fake SDK module: offer mapping (with and without
     trial, missing package), purchase success calls sync, cancel, failure.

4. ✅ **Activate it** (`src/main.tsx` or the first effect in `App.tsx`).
   ```ts
   const { revenueCatWebKey } = await loadClientConfig();
   if (revenueCatWebKey) setBilling(createWebBilling(revenueCatWebKey, { email: () => currentEmail }));
   ```
   With no key the app behaves as after plan 04 (no plans screen).

5. ✅ **Purchase states in `PlansScreen`.** While `purchase` runs, disable the buttons and
   show "Opening secure checkout…". After `purchased`, show "Welcome to Premium" and a
   "Start practising" button. Cover these with a component test if the project has a
   component test setup by then; otherwise list them in the PR's manual test notes.

6. ✅ **Docs.** README: web checkout setup and how to test in sandbox.

## Setup (owner)

1. Create a Stripe account; complete business verification; turn on Stripe Tax or decide
   how VAT on digital services (UK, EU) is handled. Ask an accountant if unsure.
2. RevenueCat → add a **Web Billing** app to the project and connect Stripe.
3. Create two Web Billing products:
   - `parliamo_pro_monthly`: monthly, £8.99 / €9.99 / $9.99, no trial.
   - `parliamo_pro_annual`: yearly, £59.99 / €69.99 / $69.99, 7-day free trial.
4. Attach both to entitlement `premium`, and to offering `default` as `$rc_monthly` and `$rc_annual`.
5. Copy the Web Billing **sandbox** public key into the GitHub variable
   `REVENUECAT_WEB_PUBLIC_KEY` first; switch to the production key at launch.
6. The terms (plan 11) must state price, renewal, how to cancel, and the refund policy.

## Manual test script (sandbox key, Stripe test card 4242 4242 4242 4242)

1. Guest opens plans → pressing subscribe sends them to sign-in.
2. Signed-in user buys annual: the checkout shows a 7-day trial; afterwards the meter
   shows premium limits and `users/<uid>.subscription.periodType` is `trial`.
3. Account menu → "Manage subscription" opens the RevenueCat management page; cancel there;
   `/api/me` shows `willRenew: false` and tier stays premium.
4. Declined card (4000 0000 0000 0002) shows the failure message and no subscription is created.
5. Open the app in a second browser, sign in with the same account: premium.
