# Parliamo Italiano

Learn conversational Italian by talking to people, not flashcards.

Parliamo Italiano is a web app where you practise Italian with an AI tutor. For now there is one: **Emmanuele the Roman**, a retired legionary who chats about daily life in Rome. You can write to him or switch to a hands-free voice call: speak into your microphone, and he answers out loud in natural Italian, with captions, translations and short grammar notes to help you learn from every reply.

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
- **Adjustable tutoring.** A settings drawer lets you choose how strictly mistakes are corrected (conversational, tutor or strict), how much regional slang to use, speech rate, subtitles, auto-play and a custom system prompt.

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

The billed API routes (`/api/chat`, `/api/translate`, `/api/tts`, `/api/stt`, `/api/session`) are rate-limited per IP (`RATE_LIMIT_PER_MINUTE`, default 60) and per user (60 a minute). Each user can hold one open Live call and each IP two. When deploying behind a proxy such as Cloud Run, set `TRUST_PROXY_HOPS=1` so the limit applies to each client rather than to the proxy.

## Accounts, sessions and privacy

**Authentication.** Billed routes and the Live socket need a Firebase Auth or Google Identity ID token. HTTP requests send it as `Authorization: Bearer <token>`; Live calls send it as the WebSocket subprotocol `auth, <token>`, never in the URL. Tokens are checked against Google's certificates, and their audience must be `GCP_PROJECT` (Firebase) or `GOOGLE_CLIENT_ID` (Google Identity). Auth is enforced when `NODE_ENV=production` or `ENFORCE_AUTH=true`, and the server refuses to start without one of those audiences. Locally, requests without a token run as a dev user (`x-dev-user-id` header or `devUserId` query) and `dev-token:<id>` tokens are accepted.

On load the client signs the learner in anonymously with Firebase (`src/utils/firebaseAuth.ts`), using the public web config from `GET /api/auth-config`, and the same anonymous account is reused on that device. That needs `FIREBASE_API_KEY` and `FIREBASE_APP_ID` set on the server and Anonymous sign-in enabled in the Firebase project `GCP_PROJECT`; without them, the client sends no token, which only works when auth is not enforced. Anyone can create anonymous accounts, so the per-IP limits remain the backstop against abuse.

**Learner sessions.** A session holds the learner's level, saved phrases and the last 50 conversation turns. The server assigns its ID, the client remembers it on the device, and both chat and Live turns are checkpointed to it. `GET /api/session` returns the latest session, `POST` creates or updates one, `DELETE /api/session/:id` deletes one and `DELETE /api/session` deletes all of a user's data. Sessions expire after 30 days without activity and are purged hourly.

Sessions and the per-user limits are currently **kept in server memory**: they are lost on restart and not shared between Cloud Run instances, so the deploy runs a single instance (`--max-instances=1`) until they move to Firestore.

**Live call resilience.** The client pings every 5 s and reconnects with backoff after 10 s without a reply; the server pings every 10 s and ends calls that stop answering, so a dead socket never holds the call slot. A reconnect for the same session replaces the old call and resumes the Gemini session with its stored resumption handle. If the handle is rejected, a fresh Gemini session starts with a recap of the recent turns; only if that also fails does the call continue turn by turn.

**Privacy.** Learner audio and text go only to Vertex AI by default (`vertex_only`). Failover to Google AI Studio, whose terms allow prompts to be logged and reviewed, happens only with `ALLOW_AI_STUDIO_FALLBACK=true`, and is logged as an audit warning. Raw audio and transcripts are never logged.

**Metrics.** `GET /api/metrics` reports p50/p90/p95 time to first audio and barge-in stop latency (measured on the device from speech detection), reconnect outcomes, Live lessons with audio minutes, and estimated chat and Live costs. When auth is enforced, only user IDs in `METRICS_ADMIN_USER_IDS` can read it. `/api/health` stays public and reports only status and configuration.

## Deployment

Every push to `main` runs the CI checks (type check, tests, build) and, if they pass, deploys to Cloud Run through `.github/workflows/deploy.yml`. The workflow builds the `Dockerfile` image, pushes it to Artifact Registry tagged with the commit SHA, deploys it, and checks `/api/health`. GitHub authenticates to Google Cloud through Workload Identity Federation, so no service-account keys are stored.

The service runs as its own service account and calls Vertex AI with its built-in credentials, so it needs no `GEMINI_API_KEY`. Its environment variables are set in the workflow's `env_vars` block.

One-time setup (needs `gcloud` and `gh` logged in with owner rights on the project and repo):

```bash
scripts/setup-gcp-deploy.sh <gcp-project-id> [region] [service-name]
```

The script enables the APIs, creates the Artifact Registry repo, the deployer and runtime service accounts and the identity pool, and writes the GitHub repo variables the workflow reads. You can also trigger a deploy by hand from the Actions tab (**Deploy to Cloud Run → Run workflow**).

## Project structure

```
├── server.ts                  # Express server: chat, translate, TTS, STT, sessions, health, metrics, Vite/static serving
├── liveBridge.ts              # /api/live WebSocket bridge to Gemini Live: auth, call limits, heartbeat, resumption
├── src/
│   ├── App.tsx                # App state and dashboard layout
│   ├── assets/emmanuele/      # Tutor portraits (resting and speaking)
│   ├── components/
│   │   ├── IconRail.tsx       # Left navigation rail
│   │   ├── TopHeader.tsx      # Brand, conversation title, Text/Voice switch
│   │   ├── ChatInterface.tsx  # Chat bubbles, quick replies and composer
│   │   ├── UtilityPanel.tsx   # Tutor profile, notebook and talking share
│   │   ├── VoiceCallModal.tsx # Hands-free voice call with captions
│   │   ├── DevSettingsDrawer.tsx
│   │   ├── PersonaProfileModal.tsx
│   │   ├── PersonaBadge.tsx
│   │   └── UserBadge.tsx
│   ├── data/personas.ts       # Emmanuele's persona, starter message and saved phrases
│   ├── server/                # auth, sessionStore, rateLimiter, privacyAndPolicy, metrics, maintenance
│   ├── utils/apiClient.ts     # Authenticated API calls and the ID token source
│   ├── utils/learnerSession.ts # Remembers the learner session and links chat turns to it
│   ├── utils/speech.ts        # Gemini TTS playback, browser TTS fallback, speech recognition
│   ├── utils/liveCall.ts      # Gemini Live call client: mic streaming, playback, heartbeat, reconnect
│   └── types/index.ts
└── index.html
```
