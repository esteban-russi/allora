import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationListScreen } from '../src/product/components/ConversationListScreen';
import type { SessionSummary } from '../src/product/server/sessionStore';

describe('ConversationListScreen', () => {
  const sampleSessions: SessionSummary[] = [
    {
      sessionId: 'sess_1',
      personaId: 'emmanuele',
      topic: 'cafe',
      title: 'Ordering at a café',
      lastLinePreview: 'Un cornetto, per favore.',
      lastLineSender: 'user',
      turnCount: 4,
      updatedAt: '2026-11-20T10:00:00.000Z'
    },
    {
      sessionId: 'sess_2',
      personaId: 'emmanuele',
      topic: 'free_chat',
      title: 'Ciao Emmanuele',
      lastLinePreview: 'Come stai oggi?',
      lastLineSender: 'persona',
      turnCount: 2,
      updatedAt: '2026-11-19T12:00:00.000Z'
    }
  ];

  it('renders list of sessions with titles, relative times, and previews', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConversationListScreen, {
        sessions: sampleSessions,
        activeSessionId: 'sess_1',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenNewConversation: vi.fn(),
        onBack: vi.fn()
      })
    );

    expect(html).toContain('Chats');
    expect(html).toContain('aria-label="New conversation"');
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('Ordering at a café');
    expect(html).toContain('Ciao Emmanuele');
    expect(html).toContain('You: Un cornetto, per favore.');
    expect(html).toContain('Delete conversation Ordering at a café');
  });

  it('renders empty state when session list is empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConversationListScreen, {
        sessions: [],
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenNewConversation: vi.fn(),
        onBack: vi.fn()
      })
    );

    expect(html).toContain('No conversations yet');
    expect(html).toContain('Start a conversation');
  });

  it('previews tutor opening line when conversation only contains the tutor greeting', () => {
    const greetingSession: SessionSummary[] = [
      {
        sessionId: 'sess_new',
        personaId: 'emmanuele',
        topic: 'free_chat',
        title: 'Free chat',
        lastLinePreview: 'Salve! Roma è piena di turisti oggi. E tu, che lavoro fai?',
        lastLineSender: 'persona',
        turnCount: 1,
        updatedAt: '2026-11-20T10:00:00.000Z'
      }
    ];

    const html = renderToStaticMarkup(
      React.createElement(ConversationListScreen, {
        sessions: greetingSession,
        activeSessionId: 'sess_new',
        onSelectSession: vi.fn(),
        onDeleteSession: vi.fn(),
        onOpenNewConversation: vi.fn(),
        onBack: vi.fn()
      })
    );

    expect(html).toContain('Salve! Roma è piena di turisti oggi');
    expect(html).not.toContain('No messages yet');
    expect(html).not.toContain('You: Salve');
  });
});
