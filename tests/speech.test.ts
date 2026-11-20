import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceProvider } from '../src/product/types';

/** Minimal HTMLAudioElement stand-in that "plays" immediately. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  playbackRate = 1;
  paused = true;
  currentTime = 0;
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  play() {
    this.paused = false;
    this.onplay?.();
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [], speaking: false };
const fetchMock = vi.fn();

async function loadSpeechService() {
  // SpeechService captures window.speechSynthesis in its constructor, so stub first
  vi.resetModules();
  return (await import('../src/product/client/speech')).speechService;
}

function okTtsResponse(mimeType: string) {
  return { ok: true, json: async () => ({ audioBase64: 'AAAA', mimeType }) };
}

beforeEach(() => {
  FakeAudio.instances = [];
  synth.speak.mockReset();
  synth.cancel.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('fetch', fetchMock);
});

describe('speakSmart with Cloud TTS', () => {
  it('applies the rate once, server-side, and plays at normal speed', async () => {
    fetchMock.mockResolvedValue(okTtsResponse('audio/mp3'));
    const speech = await loadSpeechService();

    await speech.speakSmart('Ciao', { provider: 'gcp_cloud_tts', rate: 1.2 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rate).toBeCloseTo(1.2);
    expect(FakeAudio.instances[0].playbackRate).toBe(1);
  });

  it('scales the chosen rate by 0.8 in slow mode', async () => {
    fetchMock.mockResolvedValue(okTtsResponse('audio/mp3'));
    const speech = await loadSpeechService();

    await speech.speakSmart('Ciao', { provider: 'gcp_cloud_tts', rate: 1.2, slow: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rate).toBeCloseTo(0.96);
    expect(FakeAudio.instances[0].playbackRate).toBe(1);
  });
});

describe('speakSmart with Gemini TTS', () => {
  it('slows playback with the audio element in slow mode', async () => {
    fetchMock.mockResolvedValue(okTtsResponse('audio/wav'));
    const speech = await loadSpeechService();

    await speech.speakSmart('Ciao', { provider: 'gemini_live', slow: true });

    expect(FakeAudio.instances[0].playbackRate).toBe(0.8);
  });
});

describe('speakSmart failures', () => {
  it.each(['gemini_live', 'gcp_cloud_tts'] as const)(
    'reports a %s failure via onError once and never uses browser speech',
    async (provider) => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onError = vi.fn();
      const speech = await loadSpeechService();

      await speech.speakSmart('Ciao', { provider, onError });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(synth.speak).not.toHaveBeenCalled();
    }
  );

  it('reports unknown providers via onError without browser speech', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = vi.fn();
    const speech = await loadSpeechService();

    await speech.speakSmart('Ciao', { provider: 'unknown_provider' as VoiceProvider, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('uses browser speech directly for the browser provider', async () => {
    const speech = await loadSpeechService();

    await speech.speakSmart('Ciao', { provider: 'browser_tts' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('throws QuotaLimitError when server returns 429 QUOTA_EXCEEDED', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      ok: false,
      clone: () => ({
        json: async () => ({
          error: 'Daily limit reached',
          code: 'QUOTA_EXCEEDED',
          counter: 'helperRequests',
          limit: 30,
          tier: 'guest',
          resetsAt: '2026-11-20T00:00:00.000Z'
        })
      })
    });
    const onError = vi.fn();
    const speech = await loadSpeechService();

    await expect(
      speech.speakSmart('Ciao', { provider: 'gcp_cloud_tts', onError })
    ).rejects.toThrow('Daily limit reached for helperRequests');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('transcribeAudioBlob throws QuotaLimitError when STT returns 429 QUOTA_EXCEEDED', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      ok: false,
      clone: () => ({
        json: async () => ({
          error: 'Daily limit reached',
          code: 'QUOTA_EXCEEDED',
          counter: 'helperRequests',
          limit: 30,
          tier: 'guest',
          resetsAt: '2026-11-20T00:00:00.000Z'
        })
      })
    });
    const { transcribeAudioBlob } = await import('../src/product/client/speech');
    const fakeBlob = new Blob(['audio-data'], { type: 'audio/webm' });

    await expect(transcribeAudioBlob(fakeBlob)).rejects.toThrow(
      'Daily limit reached for helperRequests'
    );
  });
});
