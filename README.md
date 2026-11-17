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

The Gemini API key stays on the server. The browser only talks to the server's `/api/*` routes, including the `/api/live` WebSocket, which bridges each call to a Gemini Live session. On Vertex AI the Live model is served from the `global`, `us` and `eu` locations, so set `GCP_REGION` accordingly (`GEMINI_LIVE_MODEL` overrides the model).

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
| `npm run lint` | Type-checks the project with `tsc --noEmit` |
| `npm test` | Runs the Vitest suite in `tests/` (offline; no GCP credentials needed) |

Speech recognition relies on the browser's Web Speech API, so voice calls work best in Chrome or Edge.

The billed API routes (`/api/chat`, `/api/translate`, `/api/tts`, `/api/stt`) are rate-limited per IP (`RATE_LIMIT_PER_MINUTE`, default 60), and each IP can hold at most two open Live calls. When deploying behind a proxy such as Cloud Run, set `TRUST_PROXY_HOPS=1` so the limit applies to each client rather than to the proxy.

## Project structure

```
├── server.ts                  # Express server: /api/chat, /api/translate, /api/tts, /api/stt, /api/health, Vite/static serving
├── liveBridge.ts              # /api/live WebSocket bridge to Gemini Live
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
│   ├── utils/speech.ts        # Gemini TTS playback, browser TTS fallback, speech recognition
│   ├── utils/liveCall.ts      # Gemini Live call client: mic streaming and audio playback
│   └── types/index.ts
└── index.html
```
