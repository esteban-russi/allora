import { generateKeyPairSync, sign } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { attachLiveBridge, buildRecapInstruction, parseLiveCallParams, toClientFrames } from '../liveBridge';
import { InMemorySessionStore, initializeLearnerSession, type ConversationTurn } from '../src/server/sessionStore';
import { InMemoryAccountStore } from '../src/server/accountStore';
import { InMemoryUsageStore, usageDay } from '../src/server/usageStore';
import { PLAN_LIMITS } from '../src/server/plans';
import { MetricsCollector } from '../src/server/metrics';
import { UserRateLimiter } from '../src/server/rateLimiter';
import { fakeGemini, openCall, startBridgeServer, waitUntil, type TestCall } from './helpers/fakeGemini';

const VALID_URL = '/api/live?personaId=emmanuele&learnerLevel=B1&grammarStrictness=strict&learnerName=Giulia&sampleRate=48000';

describe('parseLiveCallParams', () => {
  it('parses a valid call query', () => {
    expect(parseLiveCallParams(VALID_URL)).toEqual({
      params: {
        personaId: 'emmanuele',
        learnerLevel: 'B1',
        grammarStrictness: 'strict',
        learnerName: 'Giulia',
        sampleRate: 48000
      }
    });
  });

  it('defaults level and strictness when they are omitted', () => {
    const parsed = parseLiveCallParams('/api/live?personaId=emmanuele&sampleRate=16000');
    expect(parsed).toMatchObject({ params: { learnerLevel: 'A2', grammarStrictness: 'tutor', learnerName: '' } });
  });

  it.each([
    ['/api/live?personaId=nobody&sampleRate=16000', /Unknown personaId/],
    ['/api/live?personaId=__proto__&sampleRate=16000', /Unknown personaId/],
    ['/api/live?personaId=emmanuele&learnerLevel=Z9&sampleRate=16000', /learnerLevel/],
    ['/api/live?personaId=emmanuele&grammarStrictness=lax&sampleRate=16000', /grammarStrictness/],
    ['/api/live?personaId=emmanuele', /sampleRate/],
    ['/api/live?personaId=emmanuele&sampleRate=96000', /sampleRate/]
  ])('rejects %s', (url, message) => {
    const parsed = parseLiveCallParams(url);
    expect(parsed).toHaveProperty('error');
    expect((parsed as { error: string }).error).toMatch(message);
  });
});

describe('toClientFrames', () => {
  it('forwards audio as binary and transcripts and turn markers as events', () => {
    const message = {
      serverContent: {
        inputTranscription: { text: 'Ciao' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([1, 2]).toString('base64') } }] },
        outputTranscription: { text: 'Salve!' },
        turnComplete: true
      }
    } as LiveServerMessage;

    expect(toClientFrames(message)).toEqual([
      { type: 'input_transcript', text: 'Ciao' },
      Buffer.from([1, 2]),
      { type: 'output_transcript', text: 'Salve!' },
      { type: 'turn_complete' }
    ]);
  });

  it('emits an interrupted event when the learner talks over the model', () => {
    const message = { serverContent: { interrupted: true } } as LiveServerMessage;
    expect(toClientFrames(message)).toEqual([{ type: 'interrupted' }]);
  });

  it('returns nothing for messages without server content', () => {
    expect(toClientFrames({ setupComplete: {} } as LiveServerMessage)).toEqual([]);
  });
});

describe('attachLiveBridge upgrade handling', () => {
  let server: Server;

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** Start a bare HTTP server with the bridge and resolve the status a WebSocket handshake gets. */
  async function handshakeStatus(path: string, headers: Record<string, string> = {}): Promise<number> {
    server = createServer();
    attachLiveBridge(server, { clients: [], model: 'test-model', trustProxyHops: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}${path}`, { headers });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('handshake unexpectedly succeeded')));
      ws.on('error', () => undefined);
    });
  }

  it('rejects invalid call parameters with 400', async () => {
    expect(await handshakeStatus('/api/live?personaId=nobody&sampleRate=16000')).toBe(400);
  });

  it('rejects cross-origin connections with 403', async () => {
    expect(await handshakeStatus(VALID_URL, { Origin: 'https://evil.example' })).toBe(403);
  });

  it('returns 503 when no Gemini credentials are configured', async () => {
    expect(await handshakeStatus(VALID_URL)).toBe(503);
  });
});

describe('attachLiveBridge slot accounting', () => {
  let server: Server;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    sockets.splice(0).forEach((ws) => ws.terminate());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Start the bridge with a session store whose calls never settle or always fail. */
  async function startBridge(store: InMemorySessionStore, userLimiter: UserRateLimiter): Promise<number> {
    server = createServer();
    attachLiveBridge(server, {
      // Never reached: these tests stop before a Gemini session is opened
      clients: [{} as GoogleGenAI],
      model: 'test-model',
      trustProxyHops: 0,
      sessionStore: store,
      userLimiter
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    return (server.address() as AddressInfo).port;
  }

  function connect(port: number, userId: string): { ws: WebSocket; status: Promise<number | 'closed'> } {
    const ws = new WebSocket(`ws://localhost:${port}${VALID_URL}&devUserId=${userId}`);
    sockets.push(ws);
    const status = new Promise<number | 'closed'>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('close', () => resolve('closed'));
      ws.on('error', () => undefined);
    });
    return { ws, status };
  }

  const waitFor = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(check()).toBe(true);
  };

  class HangingStore extends InMemorySessionStore {
    override createOrUpdateSession(): Promise<never> {
      return new Promise(() => undefined);
    }
  }

  class FailingStore extends InMemorySessionStore {
    override async createOrUpdateSession(): Promise<never> {
      throw new Error('store unavailable');
    }
  }

  it('returns 500 and releases the call slot when the session store throws', async () => {
    const limiter = new UserRateLimiter();
    const port = await startBridge(new FailingStore(), limiter);

    expect(await connect(port, 'store-fail-user').status).toBe(500);
    // A leaked slot would turn the retry into a 429
    expect(await connect(port, 'store-fail-user').status).toBe(500);
    expect(limiter.getActiveCallCount('store-fail-user')).toBe(0);
  });

  it('releases the call slot when the client hangs up during setup', async () => {
    const limiter = new UserRateLimiter();
    const port = await startBridge(new HangingStore(), limiter);

    const { ws } = connect(port, 'impatient-user');
    await waitFor(() => limiter.getActiveCallCount('impatient-user') === 1);
    ws.terminate();
    await waitFor(() => limiter.getActiveCallCount('impatient-user') === 0);
  });

  it('counts concurrent upgrades from one IP before any of them finishes setup', async () => {
    const limiter = new UserRateLimiter();
    const port = await startBridge(new HangingStore(), limiter);

    connect(port, 'ip-user-1');
    connect(port, 'ip-user-2');
    await waitFor(() => limiter.getActiveCallCount('ip-user-2') === 1);
    expect(await connect(port, 'ip-user-3').status).toBe(429);
  });
});

describe('attachLiveBridge liveness and reconnects', () => {
  let server: Server;
  const calls: TestCall[] = [];

  afterEach(async () => {
    calls.splice(0).forEach((call) => call.ws.terminate());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const call = (port: number, query: string, wsOptions = {}): TestCall => {
    const opened = openCall(port, query, wsOptions);
    calls.push(opened);
    return opened;
  };

  it('terminates a call whose client stops answering pings and stops the Gemini session', async () => {
    const gemini = fakeGemini();
    const limiter = new UserRateLimiter();
    ({ server } = await startBridgeServer({ clients: [gemini.ai], userLimiter: limiter, heartbeatIntervalMs: 30 }));
    const port = (server.address() as AddressInfo).port;

    // autoPong: false simulates a link that died without a FIN
    const silent = call(port, `${VALID_URL}&devUserId=silent-user`, { autoPong: false });
    await silent.waitForEvent('ready');

    expect(await silent.closed).toBe(1006);
    expect(await waitUntil(() => gemini.sessions[0].closed)).toBe(true);
    expect(await waitUntil(() => limiter.getActiveCallCount('silent-user') === 0)).toBe(true);
  });

  it('keeps a responsive call open across heartbeats', async () => {
    const gemini = fakeGemini();
    ({ server } = await startBridgeServer({ clients: [gemini.ai], heartbeatIntervalMs: 30 }));
    const port = (server.address() as AddressInfo).port;

    const live = call(port, `${VALID_URL}&devUserId=chatty-user`);
    await live.waitForEvent('ready');
    await new Promise((r) => setTimeout(r, 150));
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('lets a reconnect for the same session replace the stale call instead of returning 429', async () => {
    const gemini = fakeGemini();
    ({ server } = await startBridgeServer({ clients: [gemini.ai] }));
    const port = (server.address() as AddressInfo).port;

    const first = call(port, `${VALID_URL}&devUserId=roaming-user`, { autoPong: false });
    const { sessionId } = await first.waitForEvent('session_ready');

    const second = call(port, `${VALID_URL}&devUserId=roaming-user&sessionId=${sessionId}`);
    expect(await second.waitForEvent('session_ready')).toMatchObject({ sessionId });
    await first.closed;
    expect(gemini.sessions[0].closed).toBe(true);
  });

  it('still refuses a second concurrent call for a different session', async () => {
    const gemini = fakeGemini();
    ({ server } = await startBridgeServer({ clients: [gemini.ai] }));
    const port = (server.address() as AddressInfo).port;

    const first = call(port, `${VALID_URL}&devUserId=two-device-user`);
    await first.waitForEvent('ready');

    const status = await new Promise<number>((resolve) => {
      const other = new WebSocket(`ws://localhost:${port}${VALID_URL}&devUserId=two-device-user`);
      other.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      other.on('error', () => undefined);
    });
    expect(status).toBe(429);
  });
});

describe('attachLiveBridge upstream resumption', () => {
  let server: Server;
  const calls: TestCall[] = [];

  afterEach(async () => {
    calls.splice(0).forEach((call) => call.ws.terminate());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const turn = (sender: 'user' | 'persona', text: string): ConversationTurn => ({
    id: `t-${text}`,
    sender,
    text,
    timestamp: '2026-11-18T10:00:00.000Z'
  });

  /** Store a session for `userId` that already holds a resumption handle and two turns. */
  async function sessionWithHandle(store: InMemorySessionStore, userId: string): Promise<string> {
    const session = await store.createOrUpdateSession({
      ...initializeLearnerSession({ userId }),
      upstreamResumptionHandle: 'old-handle',
      checkpointTurns: [turn('user', 'Vorrei un caffè'), turn('persona', 'Subito!')]
    });
    return session.sessionId;
  }

  it('resumes with the stored handle and keeps it off the client', async () => {
    const store = new InMemorySessionStore();
    const metrics = new MetricsCollector();
    const gemini = fakeGemini();
    ({ server } = await startBridgeServer({ clients: [gemini.ai], sessionStore: store, metrics }));
    const port = (server.address() as AddressInfo).port;
    const sessionId = await sessionWithHandle(store, 'resume-user');

    const live = openCall(port, `${VALID_URL}&devUserId=resume-user&sessionId=${sessionId}`);
    calls.push(live);
    expect(await live.waitForEvent('session_ready')).toMatchObject({ sessionId, resumed: true });
    expect(gemini.sessions[0].config.sessionResumption?.handle).toBe('old-handle');

    gemini.sessions[0].emit({ sessionResumptionUpdate: { newHandle: 'new-handle' } } as LiveServerMessage);
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.getSession(sessionId, 'resume-user'))?.upstreamResumptionHandle).toBe('new-handle');
    expect(live.events.some((e) => JSON.stringify(e).includes('new-handle'))).toBe(false);
    expect(metrics.getSummary().reconnect.resumedSuccessfully).toBe(1);
  });

  it('restarts a fresh upstream session with a recap when the handle is rejected', async () => {
    const store = new InMemorySessionStore();
    const metrics = new MetricsCollector();
    const gemini = fakeGemini((config) => Boolean(config.sessionResumption?.handle));
    ({ server } = await startBridgeServer({ clients: [gemini.ai], sessionStore: store, metrics }));
    const port = (server.address() as AddressInfo).port;
    const sessionId = await sessionWithHandle(store, 'restart-user');

    const live = openCall(port, `${VALID_URL}&devUserId=restart-user&sessionId=${sessionId}`);
    calls.push(live);
    expect(await live.waitForEvent('session_ready')).toMatchObject({ sessionId, resumed: false });

    expect(gemini.sessions).toHaveLength(1);
    expect(String(gemini.sessions[0].config.systemInstruction)).toContain('Learner: Vorrei un caffè');
    // No greeting: the learner is mid-conversation
    expect(gemini.sessions[0].inputs).toEqual([]);
    expect(metrics.getSummary().reconnect.restartedFresh).toBe(1);
  });

  it('falls back to turn-based and closes the socket when no upstream session can open', async () => {
    const store = new InMemorySessionStore();
    const metrics = new MetricsCollector();
    const gemini = fakeGemini(() => true);
    const limiter = new UserRateLimiter();
    ({ server } = await startBridgeServer({ clients: [gemini.ai], sessionStore: store, metrics, userLimiter: limiter }));
    const port = (server.address() as AddressInfo).port;
    const sessionId = await sessionWithHandle(store, 'fallback-user');

    const live = openCall(port, `${VALID_URL}&devUserId=fallback-user&sessionId=${sessionId}`);
    calls.push(live);
    expect(await live.waitForEvent('resumption_failed')).toMatchObject({ fallback: 'turn_based' });
    expect(await live.closed).toBe(1000);
    expect(await waitUntil(() => limiter.getActiveCallCount('fallback-user') === 0)).toBe(true);
    expect(metrics.getSummary().reconnect.fallbackToTurnBased).toBe(1);
  });
});

describe('buildRecapInstruction', () => {
  it('returns nothing when there are no turns', () => {
    expect(buildRecapInstruction([])).toBe('');
  });

  it('keeps only the most recent ten turns', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      sender: 'user' as const,
      text: `frase ${i}`,
      timestamp: '2026-11-18T10:00:00.000Z'
    }));
    const recap = buildRecapInstruction(turns);
    expect(recap).not.toContain('frase 0');
    expect(recap).not.toContain('frase 1\n');
    expect(recap).toContain('frase 2');
    expect(recap).toContain('frase 11');
  });
});

describe('attachLiveBridge authentication', () => {
  let server: Server;

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('authenticates an ID token sent as a WebSocket subprotocol', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const signedData = `${encode({ alg: 'RS256', kid: 'k1' })}.${encode({
      sub: 'protocol-user',
      iss: 'https://securetoken.google.com/test-project',
      aud: 'test-project',
      exp: nowSec + 3600,
      iat: nowSec
    })}`;
    const token = `${signedData}.${sign('RSA-SHA256', Buffer.from(signedData), privateKey).toString('base64url')}`;

    const store = new InMemorySessionStore();
    ({ server } = await startBridgeServer({
      clients: [fakeGemini().ai],
      sessionStore: store,
      auth: { enforceAuth: true, projectId: 'test-project', certResolver: async () => publicKey }
    }));
    const port = (server.address() as AddressInfo).port;

    const live = new WebSocket(`ws://localhost:${port}${VALID_URL}`, ['auth', token]);
    await new Promise<void>((resolve) =>
      live.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'session_ready') resolve();
      })
    );

    // The server must select a protocol the browser offered, or the browser drops the socket
    expect(live.protocol).toBe('auth');
    expect(await store.getActiveUserSession('protocol-user')).not.toBeNull();
    live.terminate();
  });

  it('rejects a call without a token when auth is enforced', async () => {
    ({ server } = await startBridgeServer({ clients: [fakeGemini().ai], auth: { enforceAuth: true, projectId: 'p' } }));
    const port = (server.address() as AddressInfo).port;

    const status = await new Promise<number>((resolve) => {
      const live = new WebSocket(`ws://localhost:${port}${VALID_URL}`);
      live.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      live.on('error', () => undefined);
    });
    expect(status).toBe(401);
  });
});

describe('attachLiveBridge voice metering and quota cutoff', () => {
  let server: Server;
  const calls: TestCall[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    calls.splice(0).forEach((call) => call.ws.terminate());
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const call = (port: number, query: string, wsOptions = {}): TestCall => {
    const opened = openCall(port, query, wsOptions);
    calls.push(opened);
    return opened;
  };

  it('rejects upgrade with 429 when no seconds remain in enforce mode', async () => {
    const gemini = fakeGemini();
    const accountStore = new InMemoryAccountStore();
    const usageStore = new InMemoryUsageStore();
    const nowMs = 1_700_000_000_000;
    const day = usageDay(nowMs);
    const userId = 'quota-user-0';

    await accountStore.upsertFromAuth({ userId, isAnonymous: true });
    // Anonymous free limit is 300 seconds
    await usageStore.add(userId, day, 'voiceSeconds', PLAN_LIMITS.free.voiceSeconds);

    ({ server } = await startBridgeServer({
      clients: [gemini.ai],
      accountStore,
      usageStore,
      quotasMode: 'enforce',
      now: () => nowMs
    }));
    const port = (server.address() as AddressInfo).port;

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}${VALID_URL}&devUserId=${userId}`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(429);
  });

  it('sends quota_exceeded and closes with 4008 when daily limit is reached during a call', async () => {
    const gemini = fakeGemini();
    const accountStore = new InMemoryAccountStore();
    const usageStore = new InMemoryUsageStore();
    let currentMs = 1_700_000_000_000;
    const day = usageDay(currentMs);
    const userId = 'quota-user-10s';

    await accountStore.upsertFromAuth({ userId, isAnonymous: true });
    // Leave 10 seconds remaining
    await usageStore.add(userId, day, 'voiceSeconds', PLAN_LIMITS.free.voiceSeconds - 10);

    ({ server } = await startBridgeServer({
      clients: [gemini.ai],
      accountStore,
      usageStore,
      quotasMode: 'enforce',
      now: () => currentMs
    }));
    const port = (server.address() as AddressInfo).port;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const live = call(port, `${VALID_URL}&devUserId=${userId}`);
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(10);
      expect(live.events.some((e) => e.type === 'session_ready')).toBe(true);
    });

    // Advance 10 seconds
    currentMs += 10_000;
    await vi.advanceTimersByTimeAsync(10_000);

    const event = await live.waitForEvent('quota_exceeded');
    expect(event).toEqual({ type: 'quota_exceeded' });
    expect(await live.closed).toBe(4008);
  });

  it('records 45 seconds in total when closing after 45 s', async () => {
    const gemini = fakeGemini();
    const accountStore = new InMemoryAccountStore();
    const usageStore = new InMemoryUsageStore();
    let currentMs = 1_700_000_000_000;
    const day = usageDay(currentMs);
    const userId = 'metered-user-45s';

    ({ server } = await startBridgeServer({
      clients: [gemini.ai],
      accountStore,
      usageStore,
      quotasMode: 'enforce',
      now: () => currentMs
    }));
    const port = (server.address() as AddressInfo).port;

    const live = call(port, `${VALID_URL}&devUserId=${userId}`);
    await live.waitForEvent('session_ready');

    currentMs += 45_000;
    live.ws.close();
    await live.closed;

    for (let i = 0; i < 50; i++) {
      const u = await usageStore.getUsage(userId, day);
      if (u.voiceSeconds === 45) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const usage = await usageStore.getUsage(userId, day);
    expect(usage.voiceSeconds).toBe(45);
  });

  it('records nothing when quotasMode is off', async () => {
    const gemini = fakeGemini();
    const accountStore = new InMemoryAccountStore();
    const usageStore = new InMemoryUsageStore();
    let currentMs = 1_700_000_000_000;
    const day = usageDay(currentMs);
    const userId = 'off-mode-user';

    ({ server } = await startBridgeServer({
      clients: [gemini.ai],
      accountStore,
      usageStore,
      quotasMode: 'off',
      now: () => currentMs
    }));
    const port = (server.address() as AddressInfo).port;

    const live = call(port, `${VALID_URL}&devUserId=${userId}`);
    await live.waitForEvent('session_ready');

    currentMs += 45_000;
    live.ws.close();
    await live.closed;

    const usage = await usageStore.getUsage(userId, day);
    expect(usage.voiceSeconds).toBe(0);
  });
});

describe('attachLiveBridge App Check', () => {
  let server: Server;

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function rejectInfo(
    port: number,
    protocols?: string[],
    headers?: Record<string, string>
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const ws = protocols
        ? new WebSocket(`ws://localhost:${port}${VALID_URL}`, protocols, { headers })
        : new WebSocket(`ws://localhost:${port}${VALID_URL}`, { headers });
      ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      ws.on('open', () => {
        ws.terminate();
        reject(new Error('handshake unexpectedly succeeded'));
      });
      ws.on('error', () => undefined);
    });
  }

  function connectAndWaitReady(port: number, protocols?: string[]): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = protocols
        ? new WebSocket(`ws://localhost:${port}${VALID_URL}`, protocols)
        : new WebSocket(`ws://localhost:${port}${VALID_URL}`);
      ws.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'session_ready') resolve(ws);
      });
      ws.on('unexpected-response', (_req, res) => reject(new Error(`unexpected status ${res.statusCode}`)));
      ws.on('error', reject);
    });
  }

  it('rejects missing and invalid tokens with 401 in enforce mode and allows valid ones', async () => {
    const metrics = new MetricsCollector();
    const verify = vi.fn(async (token: string) => token === 'good-ac');
    ({ server } = await startBridgeServer({
      clients: [fakeGemini().ai],
      metrics,
      appCheck: { verifier: { verify }, mode: 'enforce' }
    }));
    const port = (server.address() as AddressInfo).port;

    const missing = await rejectInfo(port);
    expect(missing.status).toBe(401);
    expect(JSON.parse(missing.body)).toEqual({ error: 'App verification failed' });
    expect(verify).not.toHaveBeenCalled();

    const invalid = await rejectInfo(port, ['appcheck', 'bad-ac']);
    expect(invalid.status).toBe(401);
    expect(JSON.parse(invalid.body)).toEqual({ error: 'App verification failed' });
    expect(verify).toHaveBeenCalledWith('bad-ac');

    // Cross-origin check still runs before App Check
    const crossOrigin = await rejectInfo(port, undefined, { Origin: 'https://evil.example' });
    expect(crossOrigin.status).toBe(403);

    const ws = await connectAndWaitReady(port, ['appcheck', 'good-ac']);
    ws.terminate();

    expect(metrics.getSummary().appCheck).toEqual({ ok: 1, failed: 1, missing: 1 });
  });

  it('allows missing and invalid tokens in monitor mode while recording metrics', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metrics = new MetricsCollector();
    const verify = vi.fn(async () => false);
    ({ server } = await startBridgeServer({
      clients: [fakeGemini().ai],
      metrics,
      appCheck: { verifier: { verify }, mode: 'monitor' }
    }));
    const port = (server.address() as AddressInfo).port;

    const wsMissing = await connectAndWaitReady(port);
    wsMissing.terminate();

    const wsInvalid = await connectAndWaitReady(port, ['appcheck', 'bad-ac']);
    wsInvalid.terminate();

    expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 1, missing: 1 });
    warnSpy.mockRestore();
  });

  it('skips verification when mode is off', async () => {
    const metrics = new MetricsCollector();
    const verify = vi.fn(async () => false);
    ({ server } = await startBridgeServer({
      clients: [fakeGemini().ai],
      metrics,
      appCheck: { verifier: { verify }, mode: 'off' }
    }));
    const port = (server.address() as AddressInfo).port;

    const ws = await connectAndWaitReady(port);
    ws.terminate();

    expect(verify).not.toHaveBeenCalled();
    expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 0, missing: 0 });
  });
});
