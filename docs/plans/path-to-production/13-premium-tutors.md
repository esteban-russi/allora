# Plan 13: premium tutors

Branch: `feature/premium-tutors`. Depends on: 01, 04 (and 05 for anyone to actually be premium).

Read first: `src/data/personas.ts` (`EMMANUELE`, `TUTORS`), `src/data/personaPrompts.ts`
(`PERSONA_PROMPTS`, `PERSONA_VOICES`), `src/components/OnboardingPage.tsx` (the tutor
radio group), `src/components/PersonaProfileModal.tsx`, `server.ts` (`POST /api/session`,
`POST /api/chat`), `liveBridge.ts` (`parseLiveCallParams`, `handleLiveUpgrade`), plan 04.

## Goal

Premium unlocks extra tutors. Emmanuele stays available to everyone. The server enforces
the lock; the app shows locked tutors with a clear path to the plans screen.

## Decisions

| Question | Decision |
|---|---|
| Where "premium" is marked | `PREMIUM_PERSONA_IDS` in `src/data/personaPrompts.ts` (shared by client and server, next to `PERSONA_PROMPTS`). `Persona` gains `isPremium: boolean`, derived from it. |
| Enforcement | Server: a non-premium user sending a premium `personaId` to `/api/session`, `/api/chat` or `/api/live` gets `403 { code: 'PREMIUM_REQUIRED' }` (WebSocket upgrade: HTTP 403). |
| Locked tutors in the UI | Visible in onboarding and the profile editor with a "Premium" tag and a lock icon; their profile and voice sample can be opened; selecting one as a non-premium user opens the plans screen. Hidden lock when billing is unavailable: the tag reads "Coming soon" and the card cannot be selected. |
| Voice sample of a locked tutor | Allowed (it uses one helper request). It is the best advert for the tutor. |
| Subscription ends while using a premium tutor | The conversation is kept. On next load the app shows a notice "Your Premium has ended. <Tutor> is a Premium tutor." with "See plans" and "Continue with Emmanuele"; choosing the latter starts a new session with Emmanuele. |
| Who writes the tutors | Character, prompt and portrait are content decisions for the owner. This plan builds the mechanism and adds the tutors from the table below once the owner fills it in. |

## Tutor content the owner must supply (per tutor)

| Field | Notes |
|---|---|
| `id`, name, full name, age, city, region, role | As in `EMMANUELE`. |
| Bio, topics (4), daily context, native saying + translation | Short; shown on the card and profile. |
| Persona prompt (Italian, like `PERSONA_PROMPTS.emmanuele`) | Personality, regional flavour, how they correct. |
| Voice | A Gemini prebuilt voice name that suits the character; test it in a Live call in Italian. Male/female flag. |
| Starter message and quick replies per level | See `createInitialMessages`. |
| Two portraits (resting, speaking), `.webp`, same size and style as `src/assets/emmanuele/` | Original artwork only. |

Suggested first two (owner to confirm or replace): a Milanese fashion-and-business
professional for B1–C1 work Italian, and a Neapolitan cook for food, family and
everyday warmth at A1–B1.

## Steps (one commit each)

1. **Mark premium tutors.**
   - `personaPrompts.ts`: `export const PREMIUM_PERSONA_IDS: readonly string[] = [];` and
     `export function isPremiumPersona(id: string): boolean`.
   - `Persona` type: `isPremium: boolean`; set from `isPremiumPersona(id)` in `personas.ts`.
   - Tests.

2. **Server enforcement** (`src/server/personaAccess.ts`).
   ```ts
   /** True when this tier may talk to this tutor. */
   export function canUsePersona(tier: Tier, personaId: string): boolean
   ```
   - `POST /api/session` (create and update) and `POST /api/chat`: after the existing
     persona validation, `if (!canUsePersona(req.account!.tier, personaId)) return res.status(403).json({ error: 'This tutor needs Premium', code: 'PREMIUM_REQUIRED' })`.
     In `/api/chat` this check goes **before** `requireQuota` consumes a message (make it
     a small middleware placed ahead of it).
   - `liveBridge.ts` `handleLiveUpgrade`: after loading the account (plan 02 step 7),
     `rejectUpgrade(socket, 403, 'PREMIUM_REQUIRED')` when not allowed.
   - `/api/tts` is not restricted (voice samples).
   - Tests: free user + premium tutor → 403 on all three; premium user → allowed; free
     tutor always allowed. Use a test-only premium ID by injecting the list into `canUsePersona`.

3. **Onboarding and profile editor** (`OnboardingPage.tsx`).
   - New props: `tier`, `canUpgrade: boolean`, `onSeePlans: (tutorId: string) => void`.
   - Tutor cards for premium tutors show a "Premium" tag (`Lock` icon from `lucide-react`,
     `aria-label="Premium tutor"`). Remove the "More regional tutors coming soon" text once
     there is more than one tutor.
   - Selecting a locked tutor when `tier !== 'premium'`: do not change the selection; call
     `onSeePlans(tutor.id)`. When `canUpgrade` is false the card is `aria-disabled` and
     tagged "Coming soon".
   - Each card gets an "About <name>" button opening `PersonaProfileModal` for that tutor
     (currently the modal only shows the active tutor).
   - `App.tsx`: `onSeePlans` remembers `pendingTutorId`, opens `PlansScreen` (sign-in first
     for guests, as in plan 04). After a successful purchase, select `pendingTutorId` in onboarding.

4. **`PlansScreen` copy.** Add "All tutors" to the premium benefits list, with the
   premium tutors' names and small portraits.

5. **Client handling of `PREMIUM_REQUIRED`.** In `App.tsx` `handleSendMessage` and the
   call start path: on a 403 with that code, show the "Premium has ended" notice from
   Decisions (new small component `PremiumEndedNotice`), not an error and not a fallback reply.
   On app load: if the restored session's tutor is premium and `me.tier !== 'premium'`,
   show the same notice immediately.

6. **Add the tutors** (one commit per tutor, after the owner supplies the content).
   For each: prompt and voice in `personaPrompts.ts`, the `Persona` object and starter
   messages in `personas.ts`, portraits in `src/assets/<id>/`, the ID in
   `PREMIUM_PERSONA_IDS`, the tutor in `TUTORS`. Check a chat and a Live call at A1 and C1.

7. **Docs**: README: how to add a tutor and how the premium lock works.

## Acceptance

- Free user: sees locked tutors, can hear their sample, tapping one opens plans; direct
  API calls with a premium `personaId` return 403.
- Premium user: can choose any tutor in onboarding and switch from the profile editor.
- After the subscription expires, the next message to a premium tutor shows the notice,
  and "Continue with Emmanuele" starts a fresh conversation.
- Store listing screenshots and the Play description mention the extra tutors only once
  at least one is live.
