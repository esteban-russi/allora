/** Tests for the LiveCall client: reconnects, heartbeat, and capture setup. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthTokenProvider } from '../src/utils/apiClient';
import { LiveCall, type LiveCallHandlers } from '../src/utils/liveCall';
import { FakeSocket, FakeWorkletNode, installFakeBrowser } from './helpers/fakeBrowser';

function handlers(overrides: Partial<LiveCallHandlers> = {}): LiveCallHandlers {
  return {
    onReady: vi.fn(),
    onUserTranscript: vi.fn(),
    onPersonaTranscript: vi.fn(),
    onTurnComplete: vi.fn(),
    onSpeakingChange: vi.fn(),
    onError: vi.fn(),
    ...overrides
  };
}

async function startCall(extra: Partial<LiveCallHandlers> = {}): Promise<{ call: LiveCall; socket: FakeSocket }> {
  const call = new LiveCall({ personaId: 'emmanuele', learnerLevel: 'A2', grammarStrictness: 'tutor' }, handlers(extra));
  await call.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  return { call, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeBrowser();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAuthTokenProvider(async () => null);
});

describe('LiveCall authentication', () => {
  it('sends the ID token as a WebSocket subprotocol, never in the URL', async () => {
    setAuthTokenProvider(async () => 'id-token-xyz');
    const { call, socket } = await startCall();

    expect(socket.protocols).toEqual(['auth', 'id-token-xyz']);
    expect(socket.url).not.toContain('id-token-xyz');
    call.stop();
  });
});

describe('LiveCall reconnects', () => {
  it('creates one capture node even when the server sends ready again after a reconnect', async () => {
    const { call, socket } = await startCall();
    socket.receive({ type: 'ready' });
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(10_000);

    const second = FakeSocket.instances[1];
    second.open();
    second.receive({ type: 'ready' });

    expect(FakeWorkletNode.instances).toHaveLength(1);
    call.stop();
  });

  it('reconnects on heartbeat timeout without waiting for the dead socket to close', async () => {
    const { call, socket } = await startCall();

    // No pongs arrive: the timeout trips on the heartbeat after 10 s, then backoff (<= 8 s)
    await vi.advanceTimersByTimeAsync(15_000 + 8_000);

    expect(socket.closeCalls).toBe(1);
    expect(socket.onclose).toBeNull();
    expect(FakeSocket.instances).toHaveLength(2);
    call.stop();
  });

  it('resumes with the session ID the server assigned', async () => {
    const { call, socket } = await startCall();
    socket.receive({ type: 'session_ready', sessionId: 'sess_abc', resumed: false });
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(FakeSocket.instances[1].url).toContain('sessionId=sess_abc');
    call.stop();
  });

  it('stops without reconnecting when the server falls back to turn-based', async () => {
    const onResumptionFailed = vi.fn();
    const { socket } = await startCall({ onResumptionFailed });

    socket.receive({ type: 'resumption_failed', fallback: 'turn_based', message: 'expired' });
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onResumptionFailed).toHaveBeenCalledWith('turn_based', 'expired');
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
