import { describe, expect, it } from 'vitest';
import { CHAT_HISTORY_LENGTH, retryHistory } from '../src/hooks/useTutorChat';
import type { ChatMessage } from '../src/types';

const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
  id: `m${i}`,
  sender: i % 2 === 0 ? 'user' : 'persona',
  personaId: 'emmanuele',
  text: `message ${i}`,
  translation: '',
  timestamp: ''
}));

describe('retryHistory', () => {
  it('sends the messages before the failed one, capped to the history length', () => {
    const history = retryHistory(messages, 'm8');
    expect(history.map((m) => m.id)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    expect(history).toHaveLength(CHAT_HISTORY_LENGTH);
  });

  it('sends fewer messages when the failed one is near the start', () => {
    expect(retryHistory(messages, 'm2').map((m) => m.id)).toEqual(['m0', 'm1']);
  });

  it('falls back to the latest messages when the failed one is gone', () => {
    expect(retryHistory(messages, 'missing').map((m) => m.id)).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });
});
