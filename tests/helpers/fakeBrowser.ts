/** Minimal fake browser audio and WebSocket globals for LiveCall client tests. */
import { vi } from 'vitest';

export class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: any) => void) | null = null;

  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    FakeSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
  }

  /** Simulate the server accepting the connection. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Simulate a JSON event from the server. */
  receive(event: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** JSON messages this socket has sent. */
  sentEvents(): Array<Record<string, unknown>> {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

export class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  constructor() {
    FakeWorkletNode.instances.push(this);
  }
  disconnect(): void {}
}

class FakeAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: async () => undefined };
  createMediaStreamSource() {
    return { connect: () => undefined };
  }
  createBuffer(_channels: number, length: number) {
    return { duration: length / 24000, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => undefined, stop: () => undefined, onended: null };
  }
  async close() {}
}

/** Install the fakes as globals; call `vi.unstubAllGlobals()` afterwards. */
export function installFakeBrowser(): void {
  FakeSocket.instances = [];
  FakeWorkletNode.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('window', {
    location: { protocol: 'https:', host: 'app.example' },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
  });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }
  });
}
