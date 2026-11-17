/** Browser client for a Gemini Live voice call streamed through the server's `/api/live` socket. */

const MODEL_SAMPLE_RATE = 24000;

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
}

export interface LiveCallHandlers {
  /** The Gemini session is open and the microphone is streaming. */
  onReady: () => void;
  /** Running transcript of the learner's current turn. */
  onUserTranscript: (text: string) => void;
  /** Running transcript of the tutor's current turn. */
  onPersonaTranscript: (text: string) => void;
  /** Final transcripts of a finished exchange (either may be empty). */
  onTurnComplete: (userText: string, personaText: string) => void;
  /** Whether tutor audio is currently playing. */
  onSpeakingChange: (isSpeaking: boolean) => void;
  /**
   * The call failed or ended unexpectedly.
   *
   * `beforeReady` is true when the session never opened, so the caller can
   * switch to another voice engine.
   */
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

  constructor(private options: LiveCallOptions, private handlers: LiveCallHandlers) {}

  /**
   * Ask for the microphone and open the Live socket.
   *
   * Failures are reported through `onError` rather than thrown.
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
      this.openSocket(this.audioContext.sampleRate);
    } catch (err) {
      this.fail((err as Error).message || 'Could not start the microphone');
    }
  }

  /** Send a typed line (e.g. a suggested phrase or a "please repeat") as a learner turn. */
  sendText(text: string): void {
    if (this.isReady && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'text', text }));
    }
  }

  /** Stop or resume streaming microphone audio without closing the call. */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  /** Hang up and release the microphone and audio output. */
  stop(): void {
    this.isStopped = true;
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

  private openSocket(sampleRate: number): void {
    const query = new URLSearchParams({
      personaId: this.options.personaId,
      learnerLevel: this.options.learnerLevel,
      grammarStrictness: this.options.grammarStrictness,
      learnerName: this.options.learnerName ?? '',
      sampleRate: String(sampleRate)
    });
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/live?${query}`);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.playChunk(event.data);
      } else {
        this.handleEvent(JSON.parse(event.data));
      }
    };
    socket.onclose = () => {
      if (!this.isStopped) this.fail('The voice call was disconnected');
    };
  }

  private handleEvent(event: { type: string; text?: string; message?: string }): void {
    switch (event.type) {
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
      case 'interrupted':
        this.stopPlayback();
        break;
      case 'turn_complete':
        this.handlers.onTurnComplete(this.userText.trim(), this.personaText.trim());
        this.userText = '';
        this.personaText = '';
        break;
      case 'error':
        this.fail(event.message ?? 'Gemini Live error');
        break;
    }
  }

  private startCapture(): void {
    if (!this.audioContext || !this.micStream) return;
    const source = this.audioContext.createMediaStreamSource(this.micStream);
    this.captureNode = new AudioWorkletNode(this.audioContext, 'pcm-capture', { numberOfOutputs: 0 });
    this.captureNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.isMuted && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(event.data);
      }
    };
    source.connect(this.captureNode);
  }

  /** Queue a 24 kHz 16-bit PCM chunk right after the previous one for gapless playback. */
  private playChunk(data: ArrayBuffer): void {
    const ctx = this.audioContext;
    if (!ctx) return;
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
