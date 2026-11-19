# Plan 09: Android purchases (Google Play Billing through RevenueCat)

Branch: `feature/android-purchases`. Depends on: 05, 07, 08 (and the `Billing` interface from 04).

Read first: plans 04, 05, 06 (`billingWeb.ts` is the model for this file), and the
current docs for `@revenuecat/purchases-capacitor` (configure, logIn, getOfferings,
purchasePackage, restorePurchases, error codes). Follow the installed version's types
where names differ from this plan.

## Goal

A signed-in learner can subscribe inside the Android app with Google Play, restore a
purchase after reinstalling, and reach Play's subscription management.

## Decisions

| Question | Decision |
|---|---|
| SDK | `@revenuecat/purchases-capacitor`. |
| Which billing runs where | `isNativeApp()` → native billing; otherwise web billing (plan 06). The Android build must never offer web checkout or link to it (Play payments policy). A unit test enforces the selection. |
| RevenueCat user | `Purchases.configure` is called only for signed-in users, with the Firebase user ID. Guests see "Sign in to subscribe". On account change call `Purchases.logIn`. |
| Play products | Two subscriptions, one base plan each: `parliamo_pro_monthly` (base plan `monthly`) and `parliamo_pro_annual` (base plan `annual`, with a 7-day free-trial offer for new subscribers). Same IDs as on the web. |
| Changing plan (monthly ↔ annual) | Not built. Premium users do not see the plans screen; they change plan by cancelling in Play and subscribing again. |
| Subscribed on the web, using Android | They are premium. The account menu shows "You subscribed on the web. Manage your subscription on the website." as plain text with **no link**. |
| Manage (Play subscriber) | Open `https://play.google.com/store/account/subscriptions?sku=<productId>&package=<APP_ID>`. |
| Key delivery | `REVENUECAT_ANDROID_PUBLIC_KEY` served in `/api/auth-config` as `billing.revenueCatAndroidKey`. |

## Steps (one commit each)

1. **Serve the Android key.** Extend `/api/auth-config` and `loadClientConfig`
   (plan 06 steps 1–2) with `revenueCatAndroidKey`. Tests, `.env.example`, README, `deploy.yml`.

2. **Install.** `npm install @revenuecat/purchases-capacitor`, `npx cap sync android`.
   Confirm the merged manifest contains `com.android.vending.BILLING` (the library adds it).

3. **Native billing implementation** (`src/utils/billingNative.ts`).
   ```ts
   export function createNativeBilling(apiKey: string, deps?: { loadSdk?: () => Promise<PurchasesPlugin> }): Billing
   ```
   - `ensureUser(userId)`: first call → `Purchases.configure({ apiKey, appUserID: userId })`;
     later calls with a different ID → `Purchases.logIn({ appUserID: userId })`.
   - `isAvailable()` → true.
   - `getOffers(userId)`: `ensureUser`, `Purchases.getOfferings()`, use `current`.
     Packages `$rc_monthly` → `monthly`, `$rc_annual` → `annual`.
     `priceText` = the product's localised price string. `trialText`: when the product
     has a free introductory phase (price 0), "N days free" from its period; else null.
     Play only returns the trial offer to eligible users, so no extra eligibility check.
   - `purchase(userId, plan)`: `ensureUser`, `Purchases.purchasePackage({ aPackage })`.
     Success → `postJson('/api/billing/sync', {})` → `{ status: 'purchased' }`.
     Cancelled (the error's `userCancelled` flag or the SDK's purchase-cancelled code) →
     `{ status: 'cancelled' }`. "Payment pending" → `{ status: 'failed', message: 'Your payment is pending. Premium will unlock when Google confirms it.' }`.
     Anything else → `{ status: 'failed', message: 'The purchase could not be completed.' }`.
   - `restore(userId)`: `ensureUser`, `Purchases.restorePurchases()`, then
     `/api/billing/sync`; return `tier === 'premium'` from the sync response.
   - `manageUrl(userId)`: the Play URL above when `me.subscription.store === 'play_store'`
     (pass the product ID in through a `getProductId` dep or read it from customer info); else null.
   - `tests/billingNative.test.ts` with a fake plugin: configure once then `logIn` on user
     change; offer mapping with and without trial; purchase success calls sync; cancel;
     pending; restore true/false.

4. **Select by platform** (`src/utils/billingSetup.ts`, called from where plan 06 step 4 activates billing).
   ```ts
   export function chooseBilling(config: { revenueCatWebKey: string | null; revenueCatAndroidKey: string | null }, native: boolean): Billing
   ```
   - native: Android key present → `createNativeBilling`, else `unavailableBilling`. **Never** web billing.
   - not native: web key present → `createWebBilling`, else `unavailableBilling`.
   - Test all four combinations, including "native with only a web key → unavailable".

5. **UI differences on Android.**
   - `AccountMenu`: for a `web` subscription on native show the plain text from Decisions;
     for `play_store` show "Manage subscription" opening the Play URL.
   - `PlansScreen` on native: under the primary button show the full terms line required
     by Play, built from the selected offer: e.g. "7 days free, then £59.99 per year.
     Renews automatically until cancelled. Cancel any time in Google Play." (no trial:
     "£8.99 per month. Renews automatically until cancelled. …"). Keep "Restore purchases".
   - Open `/terms` and `/privacy` with `publicUrl()` so they open in the browser.

6. **Sign-out.** In `signOutToGuest`, when native billing was configured call
   `Purchases.logOut()` inside try/catch.

7. **Docs**: README: Play Billing setup, licence testing, the "never web checkout on Android" rule.

## Owner setup

1. Play Console → Setup → Payments profile (merchant account). Needed before products can be created.
2. Upload a build that includes this PR to internal testing (the billing permission must
   be in an uploaded build before products can be activated).
3. Monetise → Subscriptions: create the two subscriptions and base plans from Decisions;
   prices £8.99 / €9.99 / $9.99 and £59.99 / €69.99 / $69.99; add the 7-day free-trial
   offer on the annual base plan (eligibility: new customers).
4. RevenueCat → add a **Google Play** app; follow RevenueCat's "Google Play Store" guide:
   service-account credentials with access to the Play Developer API, and real-time
   developer notifications (Pub/Sub topic). Credential propagation can take up to a day.
5. RevenueCat: import the two products, attach them to entitlement `premium` and to
   offering `default` (`$rc_monthly`, `$rc_annual`, next to the web products).
6. Copy the Google Play public SDK key to the GitHub variable `REVENUECAT_ANDROID_PUBLIC_KEY`.
7. Play Console → Setup → Licence testing: add tester Google accounts.

## Test (licence tester, build installed from the internal testing track)

1. Guest → plans → "Sign in to subscribe".
2. Buy annual: Play sheet shows the free trial; afterwards premium limits apply and
   `users/<uid>.subscription.store` is `play_store`.
3. Cancel in Play: tier stays premium, `willRenew` false. Test subscriptions renew every
   few minutes; after expiry the tier is `free`.
4. Uninstall, reinstall, sign in: premium without pressing anything. Then test "Restore purchases".
5. Sign in with a different account on the same phone and press "Restore purchases":
   check the result matches the transfer behaviour configured in RevenueCat.
6. Web subscriber signs in on Android: premium, and no link to web billing anywhere.
