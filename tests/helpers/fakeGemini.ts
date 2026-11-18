/** Fake Gemini Live client and bridge server helpers for Live bridge tests. */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { GoogleGenAI, LiveConnectConfig, LiveServerMessage } from '@google/genai';
import { WebSocket, type ClientOptions } from 'ws';
import { attachLiveBridge, type LiveBridgeOptions } from '../../liveBridge';

export interface FakeLiveSession {
  config: LiveConnectConfig & { sessionResumption?: { handle?: string } };
  inputs: unknown[];
  closed: boolean;
  /** Push a server message to the bridge as if Gemini sent it. */
  emit: (message: LiveServerMessage) => void;
}

/**
 * Build a fake GoogleGenAI whose `live.connect` succeeds unless `shouldFail` says otherwise.
 *
 * Args:
 *   shouldFail: Decides per connect config whether setup fails (e.g. a stale handle).
 *
 * Returns:
 *   The fake client and the sessions it has opened, in order.
 */
export function fakeGemini(
  shouldFail: (config: FakeLiveSession['config']) => boolean = () => false
): { ai: GoogleGenAI; sessions: FakeLiveSession[] } {
  const sessions: FakeLiveSession[] = [];
  const ai = {
    live: {
      connect: async ({
        config,
        callbacks
      }: {
        config: FakeLiveSession['config'];
        callbacks: { onmessage: (m: LiveServerMessage) => void; onclose: (e: { reason: string }) => void };
      }) => {
        if (shouldFail(config)) {
          setTimeout(() => callbacks.onclose({ reason: 'session not found' }));
          return { close: () => undefined, sendRealtimeInput: () => undefined };
        }
        const session: FakeLiveSession = {
          config,
          inputs: [],
          closed: false,
          emit: (message) => callbacks.onmessage(message)
        };
        sessions.push(session);
        setTimeout(() => callbacks.onmessage({ setupComplete: {} } as LiveServerMessage));
        return {
          close: () => {
            session.closed = true;
          },
          sendRealtimeInput: (input: unknown) => session.inputs.push(input)
        };
      }
    }
  } as unknown as GoogleGenAI;
  return { ai, sessions };
}

/** Start an HTTP server with the bridge attached and return its port. */
export async function startBridgeServer(
  options: Partial<LiveBridgeOptions> & Pick<LiveBridgeOptions, 'clients'>
): Promise<{ server: Server; port: number }> {
  const server = createServer();
  attachLiveBridge(server, { model: 'test-model', trustProxyHops: 0, ...options });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

/** A connected test client that records JSON events from the bridge. */
export interface TestCall {
  ws: WebSocket;
  events: Array<Record<string, unknown>>;
  closed: Promise<number>;
  /** Resolve once an event of this type has arrived. */
  waitForEvent: (type: string) => Promise<Record<string, unknown>>;
}

/** Open a Live call socket and collect its JSON events. */
export function openCall(port: number, query: string, wsOptions: ClientOptions = {}): TestCall {
  const ws = new WebSocket(`ws://localhost:${port}${query}`, wsOptions);
  const events: Array<Record<string, unknown>> = [];
  const waiters: Array<{ type: string; resolve: (event: Record<string, unknown>) => void }> = [];

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const event = JSON.parse(data.toString());
    events.push(event);
    for (const waiter of waiters.filter((w) => w.type === event.type)) waiter.resolve(event);
  });
  ws.on('error', () => undefined);
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));

  const waitForEvent = (type: string) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const seen = events.find((e) => e.type === type);
      if (seen) resolve(seen);
      else waiters.push({ type, resolve });
    });

  return { ws, events, closed, waitForEvent };
}

/** Poll until `check` passes or about one second has elapsed. */
export async function waitUntil(check: () => boolean): Promise<boolean> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  return check();
}
