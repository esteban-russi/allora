/** Tests for per-conversation draft isolation. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTutorChat, clearSessionDrafts, type UseTutorChatOptions, type UseTutorChatResult } from '../src/product/hooks/useTutorChat';
import { EMMANUELE } from '../src/product/data/personas';

function ChatHarness({
  options,
  onReady
}: {
  options: UseTutorChatOptions;
  onReady: (res: UseTutorChatResult) => void;
}) {
  const chat = useTutorChat(options);
  onReady(chat);
  return null;
}

describe('useTutorChat draft isolation', () => {
  beforeEach(() => {
    clearSessionDrafts();
  });
  const baseOptions: UseTutorChatOptions = {
    initialMessages: [],
    persona: EMMANUELE,
    learnerProfile: { name: 'Luca', level: 'A2', personaId: 'emmanuele' },
    temperature: 0.7,
    grammarStrictness: 'tutor',
    onQuotaReached: vi.fn(),
    onPremiumRequired: vi.fn(),
    onUsage: vi.fn(),
    onReply: vi.fn()
  };

  it('isolates drafts by sessionId so a draft does not leak into a new conversation', () => {
    let chatResult: UseTutorChatResult | null = null;
    let currentSessionId: string | null = 'chat_A';

    const render = () => {
      renderToStaticMarkup(
        React.createElement(ChatHarness, {
          options: { ...baseOptions, sessionId: currentSessionId },
          onReady: (res) => {
            chatResult = res;
          }
        })
      );
    };

    // 1. In Chat A: type a message draft
    render();
    expect(chatResult!.draft).toBe('');
    chatResult!.setDraft('Ciao, vorrei comprare del pane');

    // Re-render in Chat A to verify draft is saved
    render();
    expect(chatResult!.draft).toBe('Ciao, vorrei comprare del pane');

    // 2. Switch to new Chat B
    currentSessionId = 'chat_B';
    render();
    // Chat B must NOT inherit Chat A's draft
    expect(chatResult!.draft).toBe('');

    // 3. Type in Chat B
    chatResult!.setDraft('Salve!');
    render();
    expect(chatResult!.draft).toBe('Salve!');

    // 4. Switch back to Chat A
    currentSessionId = 'chat_A';
    render();
    // Chat A's draft is preserved
    expect(chatResult!.draft).toBe('Ciao, vorrei comprare del pane');
  });
});
