/** Tests for client PREMIUM_REQUIRED handling and PremiumEndedNotice rendering. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInterface } from '../src/components/ChatInterface';
import { isTutorLockedForTier, PremiumEndedNotice } from '../src/components/PremiumEndedNotice';
import { EMMANUELE } from '../src/data/personas';
import type { ChatMessage, DevSettings, Persona } from '../src/types';
import {
  isPremiumRequiredResponse,
  rememberLearnerSessionId,
  requestChatReply
} from '../src/utils/learnerSession';
import { installFakeBrowser } from './helpers/fakeBrowser';

const TEST_PREMIUM_TUTOR: Persona = {
  ...EMMANUELE,
  id: 'test-premium-tutor',
  name: 'Chiara',
  fullName: 'Chiara da Milano',
  isPremium: true
};

const baseSettings: DevSettings = {
  voiceProvider: 'gemini_live',
  voiceId: 'Kore',
  sttProvider: 'production_cloud',
  voiceCallEngine: 'realtime_live',
  temperature: 0.7,
  speechRate: 0.95,
  audioSamplingRate: '24kHz',
  grammarStrictness: 'tutor',
  subtitlesEnabled: true,
  autoPlayAudio: false
};

describe('isPremiumRequiredResponse and requestChatReply', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    installFakeBrowser();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      }
    });
    rememberLearnerSessionId('sess-premium-1');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects 403 PREMIUM_REQUIRED responses and ignores other responses', async () => {
    const match = new Response(
      JSON.stringify({ error: 'This tutor needs Premium', code: 'PREMIUM_REQUIRED' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
    const other403 = new Response(JSON.stringify({ code: 'SIGN_IN_REQUIRED' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
    const ok200 = new Response(JSON.stringify({ code: 'PREMIUM_REQUIRED' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    expect(await isPremiumRequiredResponse(match)).toBe(true);
    expect(await isPremiumRequiredResponse(other403)).toBe(false);
    expect(await isPremiumRequiredResponse(ok200)).toBe(false);
  });

  it('returns premium_required status (not error) on 403 PREMIUM_REQUIRED from /api/chat', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'This tutor needs Premium', code: 'PREMIUM_REQUIRED' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await requestChatReply({
      personaId: TEST_PREMIUM_TUTOR.id,
      userMessage: 'Ciao!'
    });

    expect(result).toEqual({ status: 'premium_required' });
  });

  it('returns server error for a non-premium 403 response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await requestChatReply({
      personaId: TEST_PREMIUM_TUTOR.id,
      userMessage: 'Ciao!'
    });

    expect(result).toEqual({ status: 'error', reason: 'server' });
  });
});

describe('isTutorLockedForTier', () => {
  it('returns true only when the tutor is premium and the resolved tier is not premium', () => {
    expect(isTutorLockedForTier(TEST_PREMIUM_TUTOR, 'free')).toBe(true);
    expect(isTutorLockedForTier(TEST_PREMIUM_TUTOR, 'guest')).toBe(true);
    expect(isTutorLockedForTier(TEST_PREMIUM_TUTOR, 'premium')).toBe(false);
    expect(isTutorLockedForTier(TEST_PREMIUM_TUTOR, null)).toBe(false);
    expect(isTutorLockedForTier(TEST_PREMIUM_TUTOR, undefined)).toBe(false);
    expect(isTutorLockedForTier(EMMANUELE, 'free')).toBe(false);
    expect(isTutorLockedForTier(EMMANUELE, 'guest')).toBe(false);
  });
});

describe('PremiumEndedNotice', () => {
  it('renders the notice copy with See plans and Continue with Emmanuele when billing is available', () => {
    const html = renderToStaticMarkup(
      React.createElement(PremiumEndedNotice, {
        tutorName: TEST_PREMIUM_TUTOR.name,
        canUpgrade: true,
        onSeePlans: vi.fn(),
        onContinueWithEmmanuele: vi.fn()
      })
    );

    expect(html).toContain('id="premium-ended-notice"');
    expect(html).toContain(`Your Premium has ended. ${TEST_PREMIUM_TUTOR.name} is a Premium tutor.`);
    expect(html).toContain('See plans');
    expect(html).toContain(`Continue with ${EMMANUELE.name}`);
  });

  it('omits See plans when billing is unavailable while keeping Continue with Emmanuele', () => {
    const html = renderToStaticMarkup(
      React.createElement(PremiumEndedNotice, {
        tutorName: TEST_PREMIUM_TUTOR.name,
        canUpgrade: false,
        onSeePlans: vi.fn(),
        onContinueWithEmmanuele: vi.fn()
      })
    );

    expect(html).not.toContain('See plans');
    expect(html).toContain(`Continue with ${EMMANUELE.name}`);
  });

  it('renders inline in ChatInterface while keeping existing conversation messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        sender: 'persona',
        personaId: TEST_PREMIUM_TUTOR.id,
        text: 'Ciao da Milano!',
        translation: 'Hi from Milan!',
        timestamp: '10:00'
      }
    ];

    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: TEST_PREMIUM_TUTOR,
        messages,
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn(),
        premiumEnded: true,
        canUpgrade: true,
        onSeePlans: vi.fn(),
        onContinueWithEmmanuele: vi.fn()
      })
    );

    expect(html).toContain('Ciao da Milano!');
    expect(html).toContain('id="premium-ended-notice"');
    expect(html).toContain(`Your Premium has ended. ${TEST_PREMIUM_TUTOR.name} is a Premium tutor.`);
  });
});
