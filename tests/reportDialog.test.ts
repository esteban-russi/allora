/** Tests for ReportDialog, submitReport, and the ChatInterface report action. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInterface } from '../src/components/ChatInterface';
import { ReportDialog, submitReport } from '../src/components/ReportDialog';
import { EMMANUELE } from '../src/data/personas';
import type { ChatMessage, DevSettings } from '../src/types';

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleSettings: DevSettings = {
  voiceProvider: 'gemini_live',
  voiceId: EMMANUELE.voiceId,
  sttProvider: 'production_cloud',
  voiceCallEngine: 'realtime_live',
  temperature: 0.7,
  speechRate: 0.95,
  audioSamplingRate: '24kHz',
  grammarStrictness: 'tutor',
  subtitlesEnabled: true,
  autoPlayAudio: false
};

describe('ReportDialog', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportDialog, {
        isOpen: false,
        reportedText: 'Ciao',
        source: 'chat',
        onClose: vi.fn()
      })
    );
    expect(html).toBe('');
  });

  it('renders radio choices, max-500 textarea, review note, and actions when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportDialog, {
        isOpen: true,
        reportedText: 'Risposta segnalata',
        source: 'chat',
        onClose: vi.fn()
      })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Offensive or harmful');
    expect(html).toContain('Wrong or misleading');
    expect(html).toContain('Something else');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('The reported message is sent to us for review.');
    expect(html).toContain('Cancel');
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Send report<\/button>/);
  });
});

describe('submitReport', () => {
  it('posts trimmed payload to /api/report and returns true on 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'received' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await submitReport({
      text: '  Messaggio  ',
      reason: 'inaccurate',
      comment: '  Wrong verb  ',
      source: 'call',
      sessionId: 'sess_42'
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: 'Messaggio',
          reason: 'inaccurate',
          comment: 'Wrong verb',
          source: 'call',
          sessionId: 'sess_42'
        })
      })
    );
  });

  it('returns false when the server responds with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad', { status: 400 })));
    const ok = await submitReport({
      text: 'Messaggio',
      reason: 'other',
      source: 'chat'
    });
    expect(ok).toBe(false);
  });
});

describe('ChatInterface report action', () => {
  it('renders a Report button with aria-label on tutor messages only', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', sender: 'user', personaId: 'emmanuele', text: 'Ciao!', translation: '', timestamp: '10:00' },
      { id: 'p1', sender: 'persona', personaId: 'emmanuele', text: 'Salve!', translation: 'Hello!', timestamp: '10:01' }
    ];

    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages,
        devSettings: sampleSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn()
      })
    );

    const matches = html.match(/aria-label="Report this reply"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toContain('>Report<');
  });
});
