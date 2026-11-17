/** WebSocket bridge between the browser voice call and a Gemini Live session. */
import { STATUS_CODES, type IncomingMessage, type Server } from 'http';
import type { Duplex } from 'stream';
import { GoogleGenAI, Modality, type LiveConnectConfig, type LiveServerMessage, type Session } from '@google/genai';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  GRAMMAR_STRICTNESS_LEVELS,
  LEVEL_PROMPTS,
  PERSONA_PROMPTS,
  PERSONA_VOICES,
  buildVoiceCallInstruction
} from './src/data/personaPrompts';
import type { CefrLevel } from './src/types';

export const LIVE_PATH = '/api/live';

// Each open session streams billed audio, so cap how many one client can hold.
const MAX_SESSIONS_PER_IP = 2;
const MAX_TEXT_LENGTH = 500;
const MAX_FRAME_BYTES = 256 * 1024;
const SETUP_TIMEOUT_MS = 10_000;
const GREETING_PROMPT =
  '(Lo studente ha appena risposto alla telefonata. Salutalo brevemente e fagli una domanda semplice.)';

export interface LiveCallParams {
  personaId: string;
  learnerLevel: CefrLevel;
  grammarStrictness: string;
  learnerName: string;
  sampleRate: number;
}

/** JSON events sent to the browser; model audio travels as binary PCM frames. */
export type LiveClientEvent =
  | { type: 'ready' }
  | { type: 'input_transcript'; text: string }
  | { type: 'output_transcript'; text: string }
  | { type: 'interrupted' }
  | { type: 'turn_complete' }
  | { type: 'error'; message: string };

export interface LiveBridgeOptions {
  /** Clients tried in order (Vertex AI first, then AI Studio). Empty disables the bridge. */
  clients: GoogleGenAI[];
  model: string;
  /** Proxy hops to skip in X-Forwarded-For, matching Express `trust proxy`. */
  trustProxyHops: number;
}

/**
 * Validate the query string a browser opens the Live socket with.
 *
 * Args:
 *   url: The request URL, e.g. `/api/live?personaId=emmanuele&learnerLevel=A2&sampleRate=48000`.
 *
 * Returns:
 *   The parsed call parameters, or an `error` message when any value is invalid.
 */
export function parseLiveCallParams(url: string): { params: LiveCallParams } | { error: string } {
  const query = new URL(url, 'http://localhost').searchParams;
  const personaId = query.get('personaId') ?? '';
  const learnerLevel = query.get('learnerLevel') ?? 'A2';
  const grammarStrictness = query.get('grammarStrictness') ?? 'tutor';
  const sampleRate = Number(query.get('sampleRate'));

  if (!Object.hasOwn(PERSONA_PROMPTS, personaId)) {
    return { error: `Unknown personaId: ${personaId}` };
  }
  if (!Object.hasOwn(LEVEL_PROMPTS, learnerLevel)) {
    return { error: `learnerLevel must be one of ${Object.keys(LEVEL_PROMPTS).join(', ')}` };
  }
  if (!GRAMMAR_STRICTNESS_LEVELS.includes(grammarStrictness)) {
    return { error: `grammarStrictness must be one of ${GRAMMAR_STRICTNESS_LEVELS.join(', ')}` };
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    return { error: 'sampleRate must be an integer between 8000 and 48000' };
  }

  return {
    params: {
      personaId,
      learnerLevel: learnerLevel as CefrLevel,
      grammarStrictness,
      learnerName: query.get('learnerName') ?? '',
      sampleRate
    }
  };
}

/**
 * Turn one Gemini Live server message into frames for the browser.
 *
 * Args:
 *   message: A message received from the Gemini Live session.
 *
 * Returns:
 *   Binary PCM audio chunks (24 kHz, 16-bit mono) and JSON events, in arrival order.
 */
export function toClientFrames(message: LiveServerMessage): Array<Buffer | LiveClientEvent> {
  const content = message.serverContent;
  if (!content) return [];

  const frames: Array<Buffer | LiveClientEvent> = [];
  if (content.inputTranscription?.text) {
    frames.push({ type: 'input_transcript', text: content.inputTranscription.text });
  }
  for (const part of content.modelTurn?.parts ?? []) {
    if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
      frames.push(Buffer.from(part.inlineData.data, 'base64'));
    }
  }
  if (content.outputTranscription?.text) {
    frames.push({ type: 'output_transcript', text: content.outputTranscription.text });
  }
  if (content.interrupted) frames.push({ type: 'interrupted' });
  if (content.turnComplete) frames.push({ type: 'turn_complete' });
  return frames;
}

/**
 * Open a Live session and resolve only once Gemini confirms the setup.
 *
 * `live.connect` resolves as soon as the socket opens, but permission and
 * unknown-model errors arrive afterwards as a close, so waiting for
 * `setupComplete` is what makes falling back to the next client possible.
 */
function openLiveSession(
  ai: GoogleGenAI,
  model: string,
  config: LiveConnectConfig,
  onMessage: (message: LiveServerMessage) => void,
  onClose: (reason: string) => void
): Promise<Session> {
  return new Promise((resolve, reject) => {
    let isReady = false;
    let session: Session | null = null;
    const timeout = setTimeout(() => {
      session?.close();
      reject(new Error('Timed out waiting for Gemini Live setup'));
    }, SETUP_TIMEOUT_MS);

    const fail = (reason: string) => {
      if (isReady) {
        onClose(reason);
        return;
      }
      clearTimeout(timeout);
      reject(new Error(reason || 'Gemini Live closed during setup'));
    };

    ai.live
      .connect({
        model,
        config,
        callbacks: {
          onmessage: (message) => {
            if (!isReady && message.setupComplete && session) {
              isReady = true;
              clearTimeout(timeout);
              resolve(session);
              return;
            }
            onMessage(message);
          },
          onerror: (event) => fail(event.message),
          onclose: (event) => fail(event.reason)
        }
      })
      .then((opened) => {
        session = opened;
      })
      .catch((err: Error) => fail(err.message));
  });
}

function clientIp(req: IncomingMessage, trustProxyHops: number): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (trustProxyHops > 0 && forwarded.length > 0) {
    return forwarded[Math.max(forwarded.length - trustProxyHops, 0)];
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body
  );
}

/**
 * Bridge one browser socket to one Gemini Live session until either side closes.
 *
 * The browser sends binary 16-bit PCM microphone frames and optional
 * `{type: 'text', text}` JSON messages; it receives binary model audio plus
 * `LiveClientEvent` JSON.
 */
async function runLiveCall(ws: WebSocket, params: LiveCallParams, options: LiveBridgeOptions): Promise<void> {
  const send = (frame: Buffer | LiveClientEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(Buffer.isBuffer(frame) ? frame : JSON.stringify(frame));
  };
  const closeWithError = (message: string) => {
    send({ type: 'error', message });
    ws.close(1011, 'Gemini Live session ended');
  };

  const config: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildVoiceCallInstruction({
      personaId: params.personaId,
      level: params.learnerLevel,
      grammarStrictness: params.grammarStrictness,
      learnerName: params.learnerName
    }),
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    speechConfig: {
      languageCode: 'it-IT',
      voiceConfig: { prebuiltVoiceConfig: { voiceName: PERSONA_VOICES[params.personaId] } }
    }
  };

  let session: Session | null = null;
  ws.on('close', () => session?.close());

  let lastError = 'No Gemini client configured';
  for (const ai of options.clients) {
    try {
      session = await openLiveSession(
        ai,
        options.model,
        config,
        (message) => toClientFrames(message).forEach(send),
        (reason) => closeWithError(reason || 'Gemini Live session closed')
      );
      break;
    } catch (err) {
      lastError = (err as Error).message;
      console.warn('[Gemini Live] Could not open session, trying next client:', lastError);
    }
  }

  if (!session) {
    closeWithError(lastError);
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    session.close();
    return;
  }

  const audioMimeType = `audio/pcm;rate=${params.sampleRate}`;
  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      session?.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: audioMimeType } });
      return;
    }
    try {
      const message = JSON.parse(data.toString());
      if (message?.type === 'text' && typeof message.text === 'string' && message.text.trim()) {
        session?.sendRealtimeInput({ text: message.text.slice(0, MAX_TEXT_LENGTH) });
      }
    } catch {
      // Ignore malformed control messages rather than dropping the call
    }
  });

  send({ type: 'ready' });
  session.sendRealtimeInput({ text: GREETING_PROMPT });
}

/**
 * Accept WebSocket upgrades on `LIVE_PATH` and bridge each to Gemini Live.
 *
 * Other upgrade requests (e.g. Vite HMR) are left untouched.
 *
 * Args:
 *   server: The HTTP server returned by `app.listen`.
 *   options: Gemini clients, Live model and proxy settings.
 */
export function attachLiveBridge(server: Server, options: LiveBridgeOptions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const sessionsPerIp = new Map<string, number>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? '';
    if (new URL(url, 'http://localhost').pathname !== LIVE_PATH) return;

    // Browsers send Origin on WebSocket requests; refuse other sites using a visitor's browser
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      rejectUpgrade(socket, 403, 'Cross-origin Live connections are not allowed');
      return;
    }

    const parsed = parseLiveCallParams(url);
    if ('error' in parsed) {
      rejectUpgrade(socket, 400, parsed.error);
      return;
    }
    if (options.clients.length === 0) {
      rejectUpgrade(socket, 503, 'Neither GCP_PROJECT nor GEMINI_API_KEY is configured');
      return;
    }

    const ip = clientIp(req, options.trustProxyHops);
    const openSessions = sessionsPerIp.get(ip) ?? 0;
    if (openSessions >= MAX_SESSIONS_PER_IP) {
      rejectUpgrade(socket, 429, 'Too many open voice calls');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      sessionsPerIp.set(ip, (sessionsPerIp.get(ip) ?? 0) + 1);
      ws.on('close', () => {
        const remaining = (sessionsPerIp.get(ip) ?? 1) - 1;
        if (remaining > 0) sessionsPerIp.set(ip, remaining);
        else sessionsPerIp.delete(ip);
      });
      runLiveCall(ws, parsed.params, options).catch((err) => {
        console.error('[Gemini Live] Bridge error:', err);
        ws.close(1011, 'Internal error');
      });
    });
  });
}
