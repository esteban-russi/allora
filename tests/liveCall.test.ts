/** Tests for the LiveCall client: reconnects, heartbeat, and capture setup. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthTokenProvider } from '../src/utils/apiClient';
import { isVoiced, LiveCall, type LiveCallHandlers } from '../src/utils/liveCall';
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
  vi.restoreAllMocks();
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

  it('checkpoints both sides of a finished exchange to the server', async () => {
    const { call, socket } = await startCall();
    socket.receive({ type: 'input_transcript', text: 'Vorrei ' });
    socket.receive({ type: 'input_transcript', text: 'un caffè' });
    socket.receive({ type: 'output_transcript', text: 'Subito!' });
    socket.receive({ type: 'turn_complete' });

    const turns = socket.sentEvents().filter((e) => e.type === 'checkpoint_turn').map((e) => e.turn);
    expect(turns).toMatchObject([
      { sender: 'user', text: 'Vorrei un caffè' },
      { sender: 'persona', text: 'Subito!' }
    ]);
    call.stop();
  });
});

describe('isVoiced', () => {
  it('treats silence and low noise as not speech', () => {
    expect(isVoiced(new Int16Array(2048))).toBe(false);
    expect(isVoiced(new Int16Array(2048).fill(200))).toBe(false);
  });

  it('treats a loud frame as speech', () => {
    expect(isVoiced(new Int16Array(2048).fill(8000))).toBe(true);
  });
});

describe('LiveCall latency metrics', () => {
  let nowMs = 0;
  const loud = () => new Int16Array(2048).fill(8000).buffer;
  const quiet = () => new Int16Array(2048).buffer;

  beforeEach(() => {
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  /** Start a call, mark it ready, and return a function that feeds mic frames at a given time. */
  async function readyCall() {
    const { call, socket } = await startCall();
    socket.receive({ type: 'ready' });
    const mic = FakeWorkletNode.instances[0].port;
    const speak = (atMs: number, frame: ArrayBuffer) => {
      nowMs = atMs;
      mic.onmessage?.({ data: frame });
    };
    const tutorAudio = (atMs: number) => {
      nowMs = atMs;
      socket.onmessage?.({ data: new Int16Array(480).buffer });
    };
    const reports = (type: string) => socket.sentEvents().filter((e) => e.type === type).map((e) => e.latencyMs);
    return { call, socket, speak, tutorAudio, reports };
  }

  it('measures TTFA from the last voiced frame, not the last mic frame', async () => {
    const { call, speak, tutorAudio, reports } = await readyCall();
    speak(1000, loud());
    speak(1100, quiet());
    speak(1400, quiet());
    tutorAudio(1900);
    tutorAudio(1950); // continuation of the same reply

    expect(reports('ttfa_report')).toEqual([900]);
    call.stop();
  });

  it('measures barge-in from speech onset over tutor audio to playback cutoff', async () => {
    const { call, socket, speak, tutorAudio, reports } = await readyCall();
    tutorAudio(1000);
    speak(3000, loud());
    speak(3050, loud());
    nowMs = 3150;
    socket.receive({ type: 'interrupted' });

    expect(reports('barge_in_stop')).toEqual([150]);
    call.stop();
  });

  it('does not report barge-in when no speech was heard over the tutor', async () => {
    const { call, socket, tutorAudio, reports } = await readyCall();
    tutorAudio(1000);
    socket.receive({ type: 'interrupted' });

    expect(reports('barge_in_stop')).toEqual([]);
    call.stop();
  });
});

