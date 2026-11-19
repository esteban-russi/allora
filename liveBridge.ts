/** WebSocket bridge between mobile voice calls and a Gemini Live session with resumption and separate lifecycles. */
import { randomUUID } from 'crypto';
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
import { authenticateWebSocketRequest, type AuthenticatedUser, type AuthOptions } from './src/server/auth';
import { defaultSessionStore } from './src/server/defaultSessionStore';
import { defaultAccountStore } from './src/server/defaultAccountStore';
import { defaultUsageStore } from './src/server/defaultUsageStore';
import { quotasMode, type QuotasMode } from './src/server/quota';
import { usageDay, type UsageStore } from './src/server/usageStore';
import type { AccountStore } from './src/server/accountStore';
import { PLAN_LIMITS, tierFor } from './src/server/plans';
import { summarizeError } from './vertexCooldown';
import {
  initializeLearnerSession,
  parseConversationTurn,
  type ConversationTurn,
  type LearnerSession,
  type SessionStore
} from './src/server/sessionStore';
import { defaultUserLimiter, UserRateLimiter } from './src/server/rateLimiter';
import { defaultMetrics, MetricsCollector } from './src/server/metrics';
import { MODEL_SAFETY_SETTINGS } from './src/server/modelSafety';

export const LIVE_PATH = '/api/live';

// Cap how many open sessions one client IP or user can hold.
const MAX_SESSIONS_PER_IP = 2;
const MAX_TEXT_LENGTH = 500;
const MAX_FRAME_BYTES = 256 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
/** Gemini Live returns 24 kHz 16-bit mono PCM. */
const MODEL_SAMPLE_RATE = 24000;
const SETUP_TIMEOUT_MS = 10_000;
const GREETING_PROMPT =
  '(Lo studente ha appena risposto alla telefonata. Salutalo brevemente e fagli una domanda semplice.)';

export interface LiveCallParams {
  personaId: string;
  learnerLevel: CefrLevel;
  grammarStrictness: string;
  learnerName: string;
  sampleRate: number;
  sessionId?: string;
}

/** JSON events sent to the browser or mobile app; model audio travels as binary PCM frames. */
export type LiveClientEvent =
  | { type: 'ready' }
  | { type: 'session_ready'; sessionId: string; resumed: boolean }
  | { type: 'input_transcript'; text: string }
  | { type: 'output_transcript'; text: string }
  | { type: 'interrupted' }
  | { type: 'turn_complete' }
  | { type: 'resumption_failed'; fallback: 'turn_based'; message: string }
  | { type: 'go_away'; timeToDisconnectSec?: number }
  | { type: 'pong'; timestamp: number }
  | { type: 'quota_exceeded' }
  | { type: 'error'; message: string };

export interface LiveBridgeOptions {
  /** Clients tried in order (Vertex AI first, then AI Studio). Empty disables the bridge. */
  clients: GoogleGenAI[];
  model: string;
  /** Proxy hops to skip in X-Forwarded-For, matching Express `trust proxy`. */
  trustProxyHops: number;
  /** Token verification options (audience, certificate source); defaults read the environment. */
  auth?: AuthOptions;
  /** Optional custom session store. */
  sessionStore?: SessionStore;
  /** Optional custom account store. */
  accountStore?: AccountStore;
  /** Optional custom usage store. */
  usageStore?: UsageStore;
  /** Quotas mode override ('off' | 'monitor' | 'enforce'). */
  quotasMode?: QuotasMode;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Optional custom user rate limiter. */
  userLimiter?: UserRateLimiter;
  /** Optional metrics collector. */
  metrics?: MetricsCollector;
  /** Return true to skip a client for this call (e.g. Vertex AI while it is cooling down). */
  skipClient?: (ai: GoogleGenAI) => boolean;
  /** How often to ping each call socket; one missed pong terminates it. Defaults to 10 s. */
  heartbeatIntervalMs?: number;
  /** Called when a client fails to open a session, before the next one is tried. */
  onClientFailed?: (ai: GoogleGenAI) => void;
}

/**
 * Validate the query string a mobile or web client opens the Live socket with.
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
  const sessionId = query.get('sessionId') || undefined;

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
      sampleRate,
      sessionId
    }
  };
}

/**
 * Turn one Gemini Live server message into frames for the browser or mobile client.
 *
 * Args:
 *   message: A message received from the Gemini Live session.
 *
 * Returns:
 *   Binary PCM audio chunks (24 kHz, 16-bit mono) and JSON events, in arrival order.
 */
export function toClientFrames(message: LiveServerMessage): Array<Buffer | LiveClientEvent> {
  const frames: Array<Buffer | LiveClientEvent> = [];

  const goAway = (message as unknown as { goAway?: { timeToDisconnectSec?: number } }).goAway;
  if (goAway) {
    frames.push({ type: 'go_away', timeToDisconnectSec: goAway.timeToDisconnectSec });
  }

  const content = message.serverContent;
  if (!content) return frames;

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
 * Open a Live session and resolve only once Gemini confirms setup.
 *
 * Args:
 *   ai: GoogleGenAI client instance.
 *   model: Gemini Live model name.
 *   config: Connect configuration including voice, instructions, and optional resumption handle.
 *   onMessage: Stream event callback.
 *   onClose: Close event callback.
 *
 * Returns:
 *   Active Session object.
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
    let isSetupComplete = false;
    let session: Session | null = null;

    const resolveWhenReady = () => {
      if (isReady || !isSetupComplete || !session) return;
      isReady = true;
      clearTimeout(timeout);
      resolve(session);
    };

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
            if (message.setupComplete) {
              isSetupComplete = true;
              resolveWhenReady();
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
        resolveWhenReady();
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

const RECAP_TURNS = 10;

/**
 * Summarise recent checkpoint turns for a fresh upstream session after resumption fails.
 *
 * Args:
 *   turns: Saved conversation turns, oldest first.
 *
 * Returns:
 *   Text to append to the system instruction, or '' when there is nothing to recap.
 */
export function buildRecapInstruction(turns: ConversationTurn[]): string {
  const recent = turns.slice(-RECAP_TURNS).filter((turn) => turn.text.trim());
  if (recent.length === 0) return '';
  const lines = recent.map((turn) => `${turn.sender === 'user' ? 'Learner' : 'You'}: ${turn.text.trim()}`);
  return (
    '\n\nThe call just reconnected after a network drop. Continue naturally from this recent ' +
    `conversation without greeting the learner again:\n${lines.join('\n')}`
  );
}

/**
 * Bridge one mobile/browser socket to one Gemini Live session until either side disconnects.
 *
 * Separates three distinct lifecycles:
 * 1. Learner Session (long-lived state, checkpoints, saved in SessionStore).
 * 2. Mobile Socket (transient physical network connection; client can drop and reconnect).
 * 3. Gemini Upstream Connection (managed stream to Gemini Live; resumptions handled via tokens).
 */
async function runLiveCall(
  ws: WebSocket,
  params: LiveCallParams,
  user: AuthenticatedUser,
  sessionRecord: LearnerSession,
  options: LiveBridgeOptions,
  remainingSec: number = Infinity
): Promise<void> {
  const sessionStore = options.sessionStore ?? defaultSessionStore;
  const usageStore = options.usageStore ?? defaultUsageStore;
  const metrics = options.metrics ?? defaultMetrics;
  const now = options.now ?? Date.now;
  const qMode = options.quotasMode ?? quotasMode();

  const startedAt = now();
  let recordedSec = 0;

  const flush = () => {
    if (qMode === 'off') return;
    const total = Math.floor((now() - startedAt) / 1000);
    const delta = total - recordedSec;
    if (delta <= 0) return;
    usageStore.add(user.userId, usageDay(now()), 'voiceSeconds', delta).catch((err) => {
      console.error('[Gemini Live] Error recording voice usage:', summarizeError(err));
    });
    recordedSec = total;
  };

  const flushInterval = setInterval(flush, 30_000);
  if (flushInterval.unref) flushInterval.unref();

  // Counted for the lesson metrics: audio streamed each way and finished exchanges
  let inputAudioBytes = 0;
  let outputAudioBytes = 0;
  let completedExchanges = 0;

  const send = (frame: Buffer | LiveClientEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Buffer.isBuffer(frame)) outputAudioBytes += frame.length;
    else if (frame.type === 'turn_complete') completedExchanges++;
    ws.send(Buffer.isBuffer(frame) ? frame : JSON.stringify(frame));
  };

  let quotaTimeout: NodeJS.Timeout | null = null;
  if (Number.isFinite(remainingSec) && remainingSec >= 0) {
    quotaTimeout = setTimeout(() => {
      send({ type: 'quota_exceeded' });
      ws.close(4008, 'Daily voice limit reached');
    }, remainingSec * 1000);
    if (quotaTimeout.unref) quotaTimeout.unref();
  }

  const closeWithError = (message: string) => {
    send({ type: 'error', message });
    ws.close(1011, 'Gemini Live session ended');
  };

  const handle = sessionRecord.upstreamResumptionHandle;
  const baseInstruction = buildVoiceCallInstruction({
    personaId: params.personaId,
    level: params.learnerLevel,
    grammarStrictness: params.grammarStrictness,
    learnerName: params.learnerName
  });
  const buildConfig = (resumeHandle: string | null, systemInstruction: string): LiveConnectConfig => ({
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    safetySettings: MODEL_SAFETY_SETTINGS,
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    speechConfig: {
      languageCode: 'it-IT',
      voiceConfig: { prebuiltVoiceConfig: { voiceName: PERSONA_VOICES[params.personaId] } }
    },
    // Ask Gemini for resumption handles so a reconnect can continue this session
    sessionResumption: resumeHandle ? { handle: resumeHandle, transparent: true } : { transparent: true }
  });

  let liveSession: Session | null = null;
  // Disconnecting the mobile socket closes upstream liveSession, but leaves LearnerSession intact in store
  ws.on('close', () => {
    clearInterval(flushInterval);
    if (quotaTimeout) clearTimeout(quotaTimeout);
    flush();
    liveSession?.close();
    // 16-bit mono PCM: 2 bytes per sample
    const audioSec = inputAudioBytes / (2 * params.sampleRate) + outputAudioBytes / (2 * MODEL_SAMPLE_RATE);
    metrics.recordLiveCallEnded(completedExchanges, audioSec);
  });

  const onUpstreamMessage = (message: LiveServerMessage) => {
    // Resumption handles stay server-side; the client only needs its sessionId
    const update = (message as unknown as { sessionResumptionUpdate?: { newHandle?: string } })
      .sessionResumptionUpdate;
    if (update?.newHandle) {
      sessionStore
        .updateUpstreamHandle(sessionRecord.sessionId, user.userId, update.newHandle, options.model)
        .catch((err) => console.error('[Gemini Live] Could not store resumption handle:', err));
    }
    toClientFrames(message).forEach(send);
  };

  let lastError = 'No Gemini client configured';
  /** Try each permitted client in order; resolve the first session that opens, or null. */
  const connectUpstream = async (config: LiveConnectConfig): Promise<Session | null> => {
    for (const ai of options.clients) {
      if (options.skipClient?.(ai)) continue;
      try {
        return await openLiveSession(ai, options.model, config, onUpstreamMessage, (reason) =>
          closeWithError(reason || 'Gemini Live session closed')
        );
      } catch (err) {
        lastError = (err as Error).message;
        console.warn('[Gemini Live] Could not open session, trying next client:', lastError);
        options.onClientFailed?.(ai);
      }
    }
    return null;
  };

  liveSession = await connectUpstream(buildConfig(handle, baseInstruction));
  let resumed = Boolean(handle && liveSession);

  if (!liveSession && handle) {
    // The handle may simply be expired: start a fresh upstream session that is told
    // the recent conversation, before giving up on Live for this call
    console.warn('[Gemini Live] Resumption failed; retrying with a fresh session');
    await sessionStore.updateUpstreamHandle(sessionRecord.sessionId, user.userId, null);
    const recap = buildRecapInstruction(sessionRecord.checkpointTurns);
    liveSession = await connectUpstream(buildConfig(null, `${baseInstruction}${recap}`));

    if (!liveSession) {
      metrics.recordReconnectOutcome('turn_based_fallback');
      send({
        type: 'resumption_failed',
        fallback: 'turn_based',
        message: 'Gemini Live session resumption failed. You can continue speaking with turn-based audio.'
      });
      ws.close(1000, 'Falling back to turn-based');
      return;
    }
    metrics.recordReconnectOutcome('restarted');
  }

  if (!liveSession) {
    closeWithError(lastError);
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    liveSession.close();
    return;
  }

  if (resumed) {
    metrics.recordReconnectOutcome('resumed');
  }

  const audioMimeType = `audio/pcm;rate=${params.sampleRate}`;

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      inputAudioBytes += chunk.length;
      liveSession?.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: audioMimeType } });
      return;
    }

    try {
      const message = JSON.parse(data.toString());

      // Ping/Pong heartbeat for detecting silent mobile drops
      if (message?.type === 'ping') {
        send({ type: 'pong', timestamp: Date.now() });
        return;
      }

      // Barge-in metrics report from mobile client
      if (message?.type === 'barge_in_stop' && typeof message.latencyMs === 'number') {
        metrics.recordBargeInStop(message.latencyMs);
        return;
      }

      // TTFA report from mobile client
      if (message?.type === 'ttfa_report' && typeof message.latencyMs === 'number') {
        metrics.recordTtfa(message.latencyMs);
        return;
      }

      // Text input turn
      if (message?.type === 'text' && typeof message.text === 'string' && message.text.trim()) {
        liveSession?.sendRealtimeInput({ text: message.text.slice(0, MAX_TEXT_LENGTH) });
      }

      // Checkpoint completed exchange; the turn is untrusted client input
      if (message?.type === 'checkpoint_turn') {
        const turn = parseConversationTurn(message.turn);
        if (!turn) {
          // Drop it rather than sending 'error', which makes the client end the call
          console.warn('[Gemini Live] Ignoring invalid checkpoint_turn payload');
          return;
        }
        sessionStore
          .saveTurnCheckpoint(sessionRecord.sessionId, user.userId, turn)
          .catch((err) => console.error('[Gemini Live] Could not save turn checkpoint:', err));
      }
    } catch {
      // Ignore malformed control messages
    }
  });

  // Notify client of active learner session ID and whether it was resumed
  send({
    type: 'session_ready',
    sessionId: sessionRecord.sessionId,
    resumed
  });
  send({ type: 'ready' });

  // Only send greeting if this is a brand new session without existing checkpoints
  if (!handle && sessionRecord.checkpointTurns.length === 0) {
    liveSession.sendRealtimeInput({ text: GREETING_PROMPT });
  }
}

/**
 * Accept WebSocket upgrades on `LIVE_PATH` and bridge each to Gemini Live.
 *
 * Enforces per-user usage limits, token authentication, and session checkpointing.
 *
 * Args:
 *   server: The HTTP server returned by `app.listen`.
 *   options: Gemini clients, Live model and proxy settings.
 */
export function attachLiveBridge(server: Server, options: LiveBridgeOptions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const sessionsPerIp = new Map<string, number>();
  const userLimiter = options.userLimiter ?? defaultUserLimiter;
  const sessionStore = options.sessionStore ?? defaultSessionStore;
  // Open calls by learner session, so a reconnect can replace its own stale call
  const callsBySession = new Map<string, { userId: string; socket: Duplex; release: () => void }>();

  // Server-side liveness: after a silent mobile drop no FIN ever arrives, so without
  // this the dead socket would hold the user's call slot and keep Gemini billing.
  const unanswered = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (unanswered.has(ws)) {
        ws.terminate();
        continue;
      }
      unanswered.add(ws);
      ws.ping();
    }
  }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));

  /**
   * End the user's existing call for the same learner session, if any.
   *
   * A client that detects a dead link reconnects with its sessionId while the server
   * may still see the old socket as open; that old call is replaced, not counted
   * against the one-call limit. Calls for other sessions are left alone.
   */
  const evictStaleCall = (userId: string, sessionId: string | undefined): void => {
    const stale = sessionId ? callsBySession.get(sessionId) : undefined;
    if (!stale || stale.userId !== userId) return;
    console.warn('[Gemini Live] Replacing stale call on reconnect');
    stale.release();
    stale.socket.destroy();
  };

  /**
   * Take the user's call slot and an IP slot together, synchronously, so concurrent
   * upgrades cannot all pass the check before any of them increments the count.
   *
   * Returns:
   *   An idempotent release function, or an error message if a limit is reached.
   */
  const reserveSlots = (userId: string, ip: string): (() => void) | string => {
    if ((sessionsPerIp.get(ip) ?? 0) >= MAX_SESSIONS_PER_IP) return 'Too many open voice calls';
    const connectionId = `conn_${randomUUID()}`;
    if (!userLimiter.acquireLiveCall(userId, connectionId)) {
      return 'Active voice call already in progress for this account';
    }
    sessionsPerIp.set(ip, (sessionsPerIp.get(ip) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      userLimiter.releaseLiveCall(userId, connectionId);
      const remaining = (sessionsPerIp.get(ip) ?? 1) - 1;
      if (remaining > 0) sessionsPerIp.set(ip, remaining);
      else sessionsPerIp.delete(ip);
    };
  };

  const handleLiveUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const url = req.url ?? '';

    // Reject cross-origin requests
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

    const user = await authenticateWebSocketRequest(req, options.auth);
    if (socket.destroyed) return;
    if (!user) {
      rejectUpgrade(socket, 401, 'Unauthorized: Valid Firebase or Google Identity token required');
      return;
    }

    const accountStore = options.accountStore ?? defaultAccountStore;
    const usageStore = options.usageStore ?? defaultUsageStore;
    const qMode = options.quotasMode ?? quotasMode();
    const now = options.now ?? Date.now;

    let remainingSec = Infinity;
    if (qMode !== 'off') {
      try {
        const account = await accountStore.upsertFromAuth(user);
        const nowMs = now();
        const tier = tierFor(account, nowMs);
        const limits = PLAN_LIMITS[tier];
        const day = usageDay(nowMs);
        const usage = await usageStore.getUsage(user.userId, day);
        remainingSec = limits.voiceSeconds - usage.voiceSeconds;
        if (qMode === 'enforce' && remainingSec <= 0) {
          rejectUpgrade(socket, 429, 'QUOTA_EXCEEDED');
          return;
        }
      } catch (err) {
        console.error('[Gemini Live] Quota check failed, failing open:', summarizeError(err));
      }
    }

    evictStaleCall(user.userId, parsed.params.sessionId);
    const release = reserveSlots(user.userId, clientIp(req, options.trustProxyHops));
    if (typeof release === 'string') {
      rejectUpgrade(socket, 429, release);
      return;
    }
    // Covers every later exit: rejection, a client that hangs up mid-setup, and the
    // upgraded WebSocket closing (it closes this same socket)
    socket.once('close', release);
    // HTTP server sockets are half-open: a client hang-up only emits 'end', so close
    // it ourselves until ws takes over the socket
    const destroyOnEnd = () => socket.destroy();
    socket.once('end', destroyOnEnd);

    try {
      let sessionRecord: LearnerSession | null = null;
      if (parsed.params.sessionId) {
        sessionRecord = await sessionStore.getSession(parsed.params.sessionId, user.userId);
      }
      // An unknown or foreign sessionId starts a fresh session under a new server-generated ID
      if (!sessionRecord) {
        sessionRecord = await sessionStore.createOrUpdateSession(
          initializeLearnerSession({
            userId: user.userId,
            personaId: parsed.params.personaId,
            learnerName: parsed.params.learnerName,
            learnerLevel: parsed.params.learnerLevel,
            grammarStrictness: parsed.params.grammarStrictness
          })
        );
      }
      if (socket.destroyed) return;
      socket.off('end', destroyOnEnd);

      const record = sessionRecord;
      const call = { userId: user.userId, socket, release };
      callsBySession.set(record.sessionId, call);
      socket.once('close', () => {
        if (callsBySession.get(record.sessionId) === call) callsBySession.delete(record.sessionId);
      });

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('close', release);
        // Any frame from the client, including its own JSON pings, proves the link is up
        ws.on('pong', () => unanswered.delete(ws));
        ws.on('message', () => unanswered.delete(ws));
        runLiveCall(
          ws,
          parsed.params,
          user,
          record,
          options,
          qMode === 'enforce' ? remainingSec : Infinity
        ).catch((err) => {
          console.error('[Gemini Live] Bridge error:', err);
          ws.close(1011, 'Internal error');
        });
      });
    } catch (err) {
      release();
      throw err;
    }
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '', 'http://localhost').pathname !== LIVE_PATH) return;

    handleLiveUpgrade(req, socket, head).catch((err) => {
      console.error('[Gemini Live] Upgrade error:', err);
      if (!socket.destroyed) rejectUpgrade(socket, 500, 'Could not start the voice call');
    });
  });
}
