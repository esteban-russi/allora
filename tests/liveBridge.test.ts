import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachLiveBridge, parseLiveCallParams, toClientFrames } from '../liveBridge';
import { InMemorySessionStore } from '../src/server/sessionStore';
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
