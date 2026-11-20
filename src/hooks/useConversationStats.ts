/** React hook deriving the notebook's grammar tip and talking share from the chat. */
import { useMemo } from 'react';
import type { ChatMessage, GrammarNote } from '../types';

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Find the tutor's most recent grammar tip.
 *
 * Args:
 *   messages: Conversation, oldest first.
 *
 * Returns:
 *   The first note of the latest tutor message that has notes, or null.
 */
export function latestGrammarNote(messages: ChatMessage[]): GrammarNote | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const notes = messages[i].grammarNotes;
    if (messages[i].sender === 'persona' && notes && notes.length > 0) return notes[0];
  }
  return null;
}

/**
 * Work out how much of the talking the learner did.
 *
 * Args:
 *   messages: Conversation, oldest first.
 *
 * Returns:
 *   The learner's share of all words as a whole percentage, 0 for an empty chat.
 */
export function talkingSharePct(messages: ChatMessage[]): number {
  let learner = 0;
  let total = 0;
  for (const m of messages) {
    const words = countWords(m.text);
    total += words;
    if (m.sender === 'user') learner += words;
  }
  return total === 0 ? 0 : Math.round((learner / total) * 100);
}

/**
 * Memoised grammar tip and talking share for the current conversation.
 *
 * Args:
 *   messages: Conversation, oldest first.
 *
 * Returns:
 *   `grammarHighlight` (latest tip or null) and `talkingShare` (0-100).
 */
export function useConversationStats(messages: ChatMessage[]): {
  grammarHighlight: GrammarNote | null;
  talkingShare: number;
} {
  const grammarHighlight = useMemo(() => latestGrammarNote(messages), [messages]);
  const talkingShare = useMemo(() => talkingSharePct(messages), [messages]);
  return { grammarHighlight, talkingShare };
}
