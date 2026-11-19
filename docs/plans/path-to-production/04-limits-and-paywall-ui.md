# Plan 04: limits and paywall UI

## Status

- Branch: `feature/limits-and-paywall-ui`
- PR link: (pending opening)
- Date: 2026-11-19
- Summary: In progress.
- Items needing attention:
  - 🟠 Owner setup: `QUOTAS_MODE=enforce` should be enabled in `deploy.yml` after merging this PR to enforce limits in production.

Branch: `feature/limits-and-paywall-ui`. Depends on: 02, 03.

Read first: plans 02 and 03, `src/App.tsx` (`handleSendMessage`),
`src/components/ChatInterface.tsx`, `src/components/UtilityPanel.tsx`,
`src/components/VoiceCallModal.tsx`, `src/utils/liveCall.ts`, `src/utils/speech.ts`.

## Goal

The app shows what the learner has left today, explains clearly when a limit is reached,
and has a plans screen. No money changes hands yet: the purchase buttons call a billing
interface whose real implementations arrive in plans 06 (web) and 09 (Android).

## Decisions

| Question | Decision |
|---|---|
| Limit reached in chat | Show a card in the chat instead of a tutor reply. The local fallback generator (`generatePersonaFallbackMessage`) must **not** run for a quota error; today any failed request triggers it. |
| Limit reached in a voice call | The call ends and the modal shows the same card. Before starting a call the app checks remaining seconds and shows the card instead of connecting when there are none. |
| Helper limit (listen, translate, speech-to-text) | A short inline message next to the control ("Daily limit reached"); no modal. |
| What the card offers | Guest: "Sign in for more" (opens the sign-in screen). Free: "See plans". Premium: only the reset time. |
| Billing interface | `src/utils/billing.ts` defines the interface and a default implementation that reports "not available". While it is unavailable, "See plans" is hidden and free users only see the reset time. |
| Plans screen placement | After sign-in in the onboarding flow (when billing is available), from the limit card, and from the account menu ("Upgrade"). |
| Premium label | Chat shows "Unlimited" for premium even though a fair-use cap of 300 exists. |

## Billing interface (`src/utils/billing.ts`)

```ts
export type PlanId = 'monthly' | 'annual';
export interface PlanOffer {
  id: PlanId;
  priceText: string;          // localised, from the store, e.g. "£8.99"
  periodText: string;         // "per month" | "per year"
  trialText: string | null;   // e.g. "7 days free", null when no trial is offered
}
export type PurchaseResult = { status: 'purchased' } | { status: 'cancelled' } | { status: 'failed'; message: string };

export interface Billing {
  isAvailable(): boolean;
  getOffers(userId: string): Promise<PlanOffer[]>;
  purchase(userId: string, plan: PlanId): Promise<PurchaseResult>;
  restore(userId: string): Promise<boolean>;      // true when premium was restored
  manageUrl(userId: string): Promise<string | null>;
}

export const unavailableBilling: Billing   // isAvailable false, empty offers, purchase → failed
let current: Billing = unavailableBilling;
export function setBilling(b: Billing): void
export function getBilling(): Billing
```

## Steps (one commit each)

1. ✅ **Quota error helper** (`src/utils/quotaError.ts`).
   ```ts
   export interface QuotaError { counter: 'chatMessages' | 'voiceSeconds' | 'helperRequests';
     limit: number; tier: string; resetsAt: string; }
   /** Parse a 429 QUOTA_EXCEEDED response; null for anything else. Does not consume the body of other responses (use res.clone()). */
   export async function readQuotaError(res: Response): Promise<QuotaError | null>
   export function formatResetTime(resetsAt: string, locale?: string): string  // "01:00" local time
   ```
   Unit tests for both.

2. ✅ **Chat: handle the limit** (`src/App.tsx`).
   - In `handleSendMessage`, after `postChat`: `const quota = await readQuotaError(res)`.
     If not null: remove the just-added user message from `messages` (so it is not shown
     as sent), put its text back in the composer (add a `draft`/`onDraftChange` prop pair
     to `ChatInterface` or expose `restoreDraft(text)` through a ref), set
     `limitReached` state to `quota`, stop the "generating" state and `return` before the
     fallback branch.
   - On success, when the body has `quota: { used, limit }`, update the account state
     (`setUsage('chatMessages', used)` on `useAccount`; add that setter).
   - Test (`tests/chatLimit.test.ts`, with `tests/helpers/fakeBrowser.ts`): a 429 quota
     response never calls `generatePersonaFallbackMessage`.

3. **`LimitReachedCard`** (`src/components/LimitReachedCard.tsx`).
   Props: `quota: QuotaError`, `tier`, `canUpgrade: boolean`, `onSignIn`, `onSeePlans`, `onDismiss`.
   - Text: chat → "You've used today's {limit} messages."; voice → "You've used today's
     {limit/60} minutes of calls."; then "Your allowance resets at {time}."
   - Buttons by tier as in Decisions. `role="status"`.
   - Rendered by `ChatInterface` at the end of the message list when `limitReached` is set
     and its counter is `chatMessages`. While set, the composer's Send button is disabled
     with `aria-describedby` pointing at the card.
   - Clear `limitReached` when `me` changes tier or when the time passes `resetsAt`.

4. **Usage meter** (`src/components/UsageMeter.tsx`, shown in `UtilityPanel` under the
   talking-share bar).
   - Two rows: "Messages today 7 / 15" and "Call minutes today 2 / 5" with a thin
     progress bar each (`role="progressbar"`, `aria-valuenow/min/max`).
   - Premium: "Messages: Unlimited" and "Call minutes today 12 / 60".
   - Hidden when `me` is null (local dev without auth).

5. **Voice: preflight and mid-call cut-off.**
   - `App.tsx` `startCall`: `const m = await refresh()`; if
     `m && m.usage.voiceSeconds >= m.limits.voiceSeconds`, set `limitReached` with counter
     `voiceSeconds` and show the card in a small dialog instead of opening `VoiceCallModal`.
   - `src/utils/liveCall.ts`: handle the server event `{ type: 'quota_exceeded' }` and the
     close code `4008`: call a new handler `onQuotaExceeded?: () => void` and do **not**
     reconnect or fall back to turn-based.
   - `VoiceCallModal`: on `onQuotaExceeded`, stop audio, end the call and call a new prop
     `onLimitReached()`; `App.tsx` then refreshes the account and shows the card.
   - Turn-based mode: its `/api/chat` and `/api/stt` calls can return the quota 429; treat
     it the same way (end the call, show the card), not as a reason to use
     `generateCallFallback`.
   - Extend `tests/liveCall.test.ts`: `quota_exceeded` triggers the handler and no reconnect.

6. **Helper limit messages.**
   - `speech.ts` `playServerTts` and `transcribeAudioBlob`, and the translate call in
     `VoiceCallModal`/`ChatInterface`: when `readQuotaError` matches, throw/return a typed
     `QuotaLimitError` instead of falling back to another provider.
   - The Listen and Translate buttons show "Daily limit reached" as inline text for 4 s.

7. **Billing interface** (`src/utils/billing.ts`) with `unavailableBilling`, plus tests.

8. **`PlansScreen`** (`src/components/PlansScreen.tsx`).
   Props: `me: Me`, `onDone: () => void`, `onNeedSignIn: () => void`.
   - On mount `getBilling().getOffers(me.userId)`; loading and error states.
   - Layout: heading "Parliamo Premium"; a comparison list built from `me.limits` and the
     premium numbers (15 → unlimited messages, 5 → 60 call minutes); two selectable plan
     cards (`role="radiogroup"`, annual preselected, showing `priceText`, `periodText`,
     `trialText`); primary button "Start free trial" (when the selected plan has a trial)
     or "Subscribe"; secondary "Continue with the free plan"; link button "Restore purchases".
   - Under the button: "Renews automatically. Cancel any time." and links to `/terms` and
     `/privacy` (pages arrive in plan 11; plain links are fine now).
   - Guest pressing the primary button → `onNeedSignIn()` (buying requires an account).
   - `purchase` result: `purchased` → `await refresh()` until `tier === 'premium'` (retry
     up to 5 times, 2 s apart), then `onDone()`; `cancelled` → stay; `failed` → show message.
   - Prices are never hard-coded; they come from `getOffers`.

9. **Entry points.**
   - Onboarding flow: after a successful sign-in in `signin-after-onboarding`, if
     `getBilling().isAvailable()` and tier is not premium, show `PlansScreen` before the app.
   - `LimitReachedCard` "See plans"; `AccountMenu` "Upgrade" (free) or
     "Manage subscription" (premium, opens `manageUrl` in a new tab when not null).
   - All three are hidden while `isAvailable()` is false.

10. **Docs**: README section "Plans and limits" describing the three tiers and the UI states.

## Manual test script

With `QUOTAS_MODE=enforce` locally and a dev user `anon-test`:
1. Send 5 messages; the 6th shows the card, the text stays in the composer, no fake reply appears.
2. The meter shows 5 / 5.
3. Start a call with 2 minutes remaining; after 2 minutes the call ends with the card.
4. Starting another call shows the card without connecting.

## After merge

Set `QUOTAS_MODE=enforce` in `deploy.yml` (separate commit), as described in plan 02.
