import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatReplyError, requestChatReply, rememberLearnerSessionId } from '../src/product/client/learnerSession';
import { ChatInterface } from '../src/product/components/ChatInterface';
import { EMMANUELE } from '../src/product/data/personas';
import type { ChatMessage, DevSettings } from '../src/product/types';
import { installFakeBrowser } from './helpers/fakeBrowser';

const baseSettings: DevSettings = {
  voiceProvider: 'gemini_live',
  voiceId: 'Charon',
  sttProvider: 'production_cloud',
  voiceCallEngine: 'realtime_live',
  temperature: 0.7,
  speechRate: 0.95,
  audioSamplingRate: '24kHz',
  grammarStrictness: 'tutor',
  subtitlesEnabled: true,
  autoPlayAudio: false,
};

describe('requestChatReply', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    installFakeBrowser();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    rememberLearnerSessionId('sess-1');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns quota status on 429 QUOTA_EXCEEDED without inventing a reply', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Daily limit reached',
          code: 'QUOTA_EXCEEDED',
          counter: 'chatMessages',
          limit: 15,
          tier: 'free',
          resetsAt: '2026-11-20T00:00:00.000Z',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await requestChatReply({ personaId: 'emmanuele', userMessage: 'Ciao' });

    expect(result.status).toBe('quota');
    if (result.status === 'quota') {
      expect(result.quota.counter).toBe('chatMessages');
    }
  });

  it('returns server error status on 500 server failure without inventing a reply', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await requestChatReply({ personaId: 'emmanuele', userMessage: 'Ciao' });

    expect(result).toEqual({ status: 'error', reason: 'server' });
  });

  it('returns network error status when the network request rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await requestChatReply({ personaId: 'emmanuele', userMessage: 'Ciao' });

    expect(result).toEqual({ status: 'error', reason: 'network' });
  });

  it('returns ok status with reply data and quota usage on 200', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'Ciao! Come stai?',
          translation: 'Hi! How are you?',
          grammarNotes: [],
          quota: { used: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await requestChatReply({ personaId: 'emmanuele', userMessage: 'Ciao' });

    expect(result).toEqual({
      status: 'ok',
      text: 'Ciao! Come stai?',
      translation: 'Hi! How are you?',
      grammarNotes: [],
      quotaUsed: 3,
    });
  });
});

describe('ChatInterface failed reply row', () => {
  const userMessage: ChatMessage = {
    id: 'u-1',
    sender: 'user',
    personaId: EMMANUELE.id,
    text: 'Ciao Emmanuele!',
    translation: '',
    timestamp: '10:00',
  };

  it('formats network vs server reply errors accurately', () => {
    expect(formatReplyError('Emmanuele', 'network')).toBe(
      "Emmanuele couldn't reply. Check your connection."
    );
    expect(formatReplyError('Emmanuele', 'server')).toBe(
      "Emmanuele couldn't reply. Something went wrong on our side."
    );
  });

  it('shows connection copy and Try again on network failure', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [userMessage],
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn(),
        failedReply: { messageId: userMessage.id, text: userMessage.text, reason: 'network' },
        onRetryReply: vi.fn(),
      })
    );

    expect(html).toContain('Ciao Emmanuele!');
    expect(html).toContain('Emmanuele couldn&#x27;t reply. Check your connection.');
    expect(html).toContain('Try again');
  });

  it('shows server error copy without blaming the connection on server failure', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [userMessage],
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn(),
        failedReply: { messageId: userMessage.id, text: userMessage.text, reason: 'server' },
        onRetryReply: vi.fn(),
      })
    );

    expect(html).toContain('Ciao Emmanuele!');
    expect(html).toContain('Emmanuele couldn&#x27;t reply. Something went wrong on our side.');
    expect(html).not.toContain('Check your connection.');
    expect(html).toContain('Try again');
  });

  it('omits the inline error row when there is no failed reply', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [userMessage],
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn(),
        failedReply: null,
        onRetryReply: vi.fn(),
      })
    );

    expect(html).toContain('Ciao Emmanuele!');
    expect(html).not.toContain('Check your connection.');
    expect(html).not.toContain('Try again');
  });

  it('renders mobile-first chat composer with compact placeholder and icon send button', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [userMessage],
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn()
      })
    );

    // Compact placeholder fitting on 360px phones
    expect(html).toContain('placeholder="Scrivi a Emmanuele…"');

    // Send button has accessible label, 48px circle on mobile, text on sm+
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain('h-12 w-12 sm:w-auto sm:px-7');
    expect(html).toContain('lucide-send');
    expect(html).toContain('class="hidden sm:inline">Send</span>');
  });
});
