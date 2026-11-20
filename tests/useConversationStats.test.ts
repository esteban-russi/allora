import { describe, expect, it } from 'vitest';
import { latestGrammarNote, talkingSharePct } from '../src/hooks/useConversationStats';
import type { ChatMessage, GrammarNote } from '../src/types';

const note = (wordOrPhrase: string): GrammarNote => ({ wordOrPhrase, explanation: 'x', category: 'verb' }) as GrammarNote;

function message(sender: ChatMessage['sender'], text: string, grammarNotes?: GrammarNote[]): ChatMessage {
  return { id: `${sender}-${text}`, sender, personaId: 'emmanuele', text, translation: '', timestamp: '', grammarNotes };
}

describe('latestGrammarNote', () => {
  it('returns the first note of the latest tutor message with notes', () => {
    const messages = [
      message('persona', 'Ciao', [note('ciao')]),
      message('persona', 'Andiamo', [note('andare'), note('noi')]),
      message('user', 'Va bene', [note('ignored')]),
      message('persona', 'Perfetto')
    ];
    expect(latestGrammarNote(messages)?.wordOrPhrase).toBe('andare');
  });

  it('returns null when no tutor message has notes', () => {
    expect(latestGrammarNote([message('user', 'Ciao'), message('persona', 'Ciao', [])])).toBeNull();
  });
});

describe('talkingSharePct', () => {
  it('returns 0 for an empty conversation', () => {
    expect(talkingSharePct([])).toBe(0);
  });

  it('rounds the learner share of all words', () => {
    const messages = [message('persona', 'uno due three'), message('user', 'quattro')];
    expect(talkingSharePct(messages)).toBe(25);
  });
});
