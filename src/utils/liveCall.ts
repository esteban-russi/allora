/** Browser and mobile client for a Gemini Live voice call with reconnect, heartbeat, and resumption. */
import { getAuthToken } from './apiClient';

const MODEL_SAMPLE_RATE = 24000;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const MAX_RECONNECT_ATTEMPTS = 5;

// Converts mic audio to 16-bit PCM in ~2048-sample chunks off the main thread
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(2048); this.length = 0; }
  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(2048);
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export interface LiveCallOptions {
  personaId: string;
  learnerLevel: string;
  grammarStrictness: string;
  learnerName?: string;
  sessionId?: string;
}

export interface LiveCallHandlers {
  /** The Gemini session is open and the microphone is streaming. */
  onReady: () => void;
  /** Learner session confirmed or resumed by backend. */
  onSessionReady?: (sessionId: string, resumed: boolean) => void;
  /** Triggered when upstream resumption fails so caller can fall back to turn-based call. */
  onResumptionFailed?: (fallback: 'turn_based', message: string) => void;
  /** Running transcript of the learner's current turn. */
  onUserTranscript: (text: string) => void;
  /** Running transcript of the tutor's current turn. */
  onPersonaTranscript: (text: string) => void;
  /** Final transcripts of a finished exchange (either may be empty). */
  onTurnComplete: (userText: string, personaText: string) => void;
  /** Whether tutor audio is currently playing. */
  onSpeakingChange: (isSpeaking: boolean) => void;
  /** The call failed or ended unexpectedly. */
  onError: (message: string, beforeReady: boolean) => void;
}

/** One Gemini Live voice call: microphone up, tutor audio and transcripts down. */
export class LiveCall {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private isReady = false;
  private isStopped = false;
  private isMuted = false;
  private userText = '';
  private personaText = '';

  private currentSessionId: string | null = null;
  private heartbeatTimer: number | null = null;
  private lastPongTime = Date.now();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private userTurnEndTime = 0;

  constructor(private options: LiveCallOptions, private handlers: LiveCallHandlers) {
    this.currentSessionId = options.sessionId ?? null;
  }

  /**
   * Ask for the microphone and open the Live socket.
   */
  async start(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this.audioContext = new AudioContext();
      const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      await this.audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      if (this.isStopped) return;
      await this.openSocket(this.audioContext.sampleRate);
    } catch (err) {
      this.fail((err as Error).message || 'Could not start the microphone');
    }
  }

  /** Send a typed line as a learner turn. */
  sendText(text: string): void {
    if (this.isReady && this.socket?.readyState === WebSocket.OPEN) {
      this.userTurnEndTime = performance.now();
      this.socket.send(JSON.stringify({ type: 'text', text }));
    }
  }

  /** Stop or resume streaming microphone audio without closing the call. */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  /** Hang up and release the microphone, heartbeat timers, and audio output. */
  stop(): void {
    this.isStopped = true;
    this.clearTimers();
    this.stopPlayback();
    this.socket?.close();
    this.captureNode?.disconnect();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close().catch(() => undefined);
    this.socket = null;
    this.captureNode = null;
    this.micStream = null;
    this.audioContext = null;
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async openSocket(sampleRate: number): Promise<void> {
    if (this.isStopped) return;
    // Fetched per attempt so a reconnect after a long drop gets a refreshed token
    const token = await getAuthToken();
    if (this.isStopped) return;

    const query = new URLSearchParams({
      personaId: this.options.personaId,
      learnerLevel: this.options.learnerLevel,
      grammarStrictness: this.options.grammarStrictness,
      learnerName: this.options.learnerName ?? '',
      sampleRate: String(sampleRate)
    });

    if (this.currentSessionId) {
      query.set('sessionId', this.currentSessionId);
    }

    // The token travels as a subprotocol, not in the URL, so it stays out of request logs
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/api/live?${query}`;
    const socket = token ? new WebSocket(url, ['auth', token]) : new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.lastPongTime = Date.now();
      this.startHeartbeat(sampleRate);
      this.reconnectAttempts = 0;
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.playChunk(event.data);
      } else {
        this.handleEvent(JSON.parse(event.data));
      }
    };

    socket.onclose = () => {
      this.clearTimers();
      if (!this.isStopped) {
        this.attemptReconnect(sampleRate);
      }
    };
  }

  private startHeartbeat(sampleRate: number): void {
    this.clearTimers();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
        if (Date.now() - this.lastPongTime > HEARTBEAT_TIMEOUT_MS) {
          console.warn('[LiveCall] Heartbeat timeout: mobile silent network drop detected. Reconnecting...');
          this.abandonSocketAndReconnect(sampleRate);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Drop a dead socket and reconnect now.
   *
   * On a dead link close() waits for a closing handshake that never arrives, so
   * onclose (and the reconnect) could be delayed by tens of seconds.
   */
  private abandonSocketAndReconnect(sampleRate: number): void {
    const dead = this.socket;
    if (dead) {
      dead.onopen = null;
      dead.onmessage = null;
      dead.onclose = null;
      dead.close();
    }
    this.socket = null;
    this.clearTimers();
    this.attemptReconnect(sampleRate);
  }

  private attemptReconnect(sampleRate: number): void {
    if (this.isStopped) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.fail('The voice call connection could not be restored after multiple attempts.');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter
    const delay = Math.min(1000 * 1.5 ** this.reconnectAttempts + Math.random() * 500, 8000);
    console.log(`[LiveCall] Connection lost. Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.openSocket(sampleRate).catch((err) => this.fail((err as Error).message || 'Could not reconnect'));
    }, delay);
  }

  private handleEvent(event: {
    type: string;
    text?: string;
    message?: string;
    sessionId?: string;
    resumed?: boolean;
    fallback?: 'turn_based';
  }): void {
    switch (event.type) {
      case 'session_ready':
        if (event.sessionId) {
          this.currentSessionId = event.sessionId;
          this.handlers.onSessionReady?.(event.sessionId, Boolean(event.resumed));
        }
        break;
      case 'pong':
        this.lastPongTime = Date.now();
        break;
      case 'ready':
        this.isReady = true;
        this.startCapture();
        this.handlers.onReady();
        break;
      case 'input_transcript':
        this.userText += event.text ?? '';
        this.handlers.onUserTranscript(this.userText.trim());
        break;
      case 'output_transcript':
        this.personaText += event.text ?? '';
        this.handlers.onPersonaTranscript(this.personaText.trim());
        break;
      case 'interrupted': {
        const startStop = performance.now();
        this.stopPlayback();
        const latencyMs = Math.round(performance.now() - startStop);
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'barge_in_stop', latencyMs }));
        }
        break;
      }
      case 'turn_complete':
        this.handlers.onTurnComplete(this.userText.trim(), this.personaText.trim());
        this.userText = '';
        this.personaText = '';
        this.userTurnEndTime = 0;
        break;
      case 'resumption_failed':
        // The server closes the socket next; stop first so that is not treated as a drop to reconnect from
        console.warn('[LiveCall] Upstream resumption failed:', event.message);
        this.stop();
        this.handlers.onResumptionFailed?.('turn_based', event.message ?? 'Resumption failed');
        break;
      case 'error':
        this.fail(event.message ?? 'Gemini Live error');
        break;
    }
  }

  private startCapture(): void {
    // The server sends 'ready' again after every reconnect; a second worklet would
    // send every mic frame twice. The existing node already writes to this.socket.
    if (this.captureNode || !this.audioContext || !this.micStream) return;
    const source = this.audioContext.createMediaStreamSource(this.micStream);
    this.captureNode = new AudioWorkletNode(this.audioContext, 'pcm-capture', { numberOfOutputs: 0 });
    this.captureNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.isMuted && this.socket?.readyState === WebSocket.OPEN) {
        this.userTurnEndTime = performance.now();
        this.socket.send(event.data);
      }
    };
    source.connect(this.captureNode);
  }

  /** Queue a 24 kHz 16-bit PCM chunk right after the previous one for gapless playback. */
  private playChunk(data: ArrayBuffer): void {
    const ctx = this.audioContext;
    if (!ctx) return;

    // Report TTFA on the first audio buffer chunk received after a user turn
    if (this.userTurnEndTime > 0) {
      const ttfaMs = Math.round(performance.now() - this.userTurnEndTime);
      this.userTurnEndTime = 0;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ttfa_report', latencyMs: ttfaMs }));
      }
    }

    const pcm = new Int16Array(data);
    const buffer = ctx.createBuffer(1, pcm.length, MODEL_SAMPLE_RATE);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.nextPlayTime = Math.max(this.nextPlayTime, ctx.currentTime);
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    if (this.playing.size === 0) this.handlers.onSpeakingChange(true);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size === 0) this.handlers.onSpeakingChange(false);
    };
  }

  /** Cut tutor audio immediately, e.g. when the learner talks over it. */
  private stopPlayback(): void {
    const wasPlaying = this.playing.size > 0;
    this.playing.forEach((source) => {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
    });
    this.playing.clear();
    this.nextPlayTime = 0;
    if (wasPlaying) this.handlers.onSpeakingChange(false);
  }

  private fail(message: string): void {
    if (this.isStopped) return;
    const beforeReady = !this.isReady;
    this.stop();
    this.handlers.onError(message, beforeReady);
  }
}
