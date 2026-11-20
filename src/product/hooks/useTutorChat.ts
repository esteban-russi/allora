/** React hook owning the tutor text chat: messages, draft, sending, retrying. */
import { useCallback, useState } from 'react';
import type { ChatMessage, DevSettings, LearnerProfile, Persona } from '../types';
import { requestChatReply, type ChatReplyErrorReason } from '../client/learnerSession';
import type { QuotaError } from '../../platform/client/quotaError';

/** How many earlier messages are sent with each turn as context. */
export const CHAT_HISTORY_LENGTH = 6;

/** A learner message whose tutor reply failed and can be retried. */
export interface FailedReply {
  messageId: string;
  text: string;
  reason: ChatReplyErrorReason;
}

export interface UseTutorChatOptions {
  initialMessages: ChatMessage[];
  persona: Persona;
  learnerProfile: LearnerProfile | null;
  sessionId?: string | null;
  temperature: number;
  grammarStrictness: DevSettings['grammarStrictness'];
  /** The daily chat limit was hit; the learner's text is put back in the draft. */
  onQuotaReached: (quota: QuotaError) => void;
  /** The tutor needs Premium; the learner's text is put back in the draft. */
  onPremiumRequired: () => void;
  /** The server reported the updated chat message count. */
  onUsage: (used: number) => void;
  /** A tutor reply arrived. */
  onReply: (text: string) => void;
}

export interface UseTutorChatResult {
  messages: ChatMessage[];
  failedReply: FailedReply | null;
  isAiGenerating: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  sendMessage: (text: string) => Promise<void>;
  retryReply: () => Promise<void>;
  /** Replace the conversation (new tutor, restored session, sign-out) and drop any failed reply. */
  resetConversation: (messages: ChatMessage[]) => void;
}

const clockTime = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Pick the context to resend when retrying a failed reply.
 *
 * Args:
 *   messages: Conversation, oldest first.
 *   messageId: ID of the learner message whose reply failed.
 *
 * Returns:
 *   Up to CHAT_HISTORY_LENGTH messages before that message, or the latest ones
 *   when it is no longer in the conversation.
 */
export function retryHistory(messages: ChatMessage[], messageId: string): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === messageId);
  return (index === -1 ? messages : messages.slice(0, index)).slice(-CHAT_HISTORY_LENGTH);
}

const sessionDraftsInMemory = new Map<string, string>();

export function getSessionDraft(sessionId?: string | null): string {
  return sessionDraftsInMemory.get(sessionId ?? 'default') ?? '';
}

export function clearSessionDrafts(): void {
  sessionDraftsInMemory.clear();
}

/**
 * Text chat with the tutor.
 *
 * Args:
 *   options: The active tutor and learner, tutoring settings and outcome callbacks.
 *
 * Returns:
 *   Chat state and the actions that change it.
 */
export function useTutorChat(options: UseTutorChatOptions): UseTutorChatResult {
  const { persona, learnerProfile, temperature, grammarStrictness } = options;
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages);
  const [failedReply, setFailedReply] = useState<FailedReply | null>(null);
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [, setDraftVersion] = useState<number>(0);
  const activeSessionKey = options.sessionId ?? 'default';
  const draft = sessionDraftsInMemory.get(activeSessionKey) ?? '';

  const setDraft = useCallback(
    (text: string) => {
      sessionDraftsInMemory.set(activeSessionKey, text);
      setDraftVersion((v) => v + 1);
    },
    [activeSessionKey]
  );

  // Take back a message the tutor will not answer, and put its text back in the draft
  const withdrawMessage = (messageId: string, text: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setFailedReply(null);
    setDraft(text);
  };

  const requestTutorReply = async (text: string, messageId: string, history: ChatMessage[]) => {
    setIsAiGenerating(true);

    const result = await requestChatReply({
      personaId: persona.id,
      history,
      userMessage: text,
      temperature,
      grammarStrictness,
      learnerLevel: learnerProfile?.level ?? 'A2',
      learnerName: learnerProfile?.name
    });

    if (result.status === 'quota') {
      withdrawMessage(messageId, text);
      options.onQuotaReached(result.quota);
    } else if (result.status === 'premium_required') {
      withdrawMessage(messageId, text);
      options.onPremiumRequired();
    } else if (result.status === 'ok') {
      if (result.quotaUsed !== undefined) options.onUsage(result.quotaUsed);
      const aiMessage: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: 'persona',
        personaId: persona.id,
        text: result.text,
        translation: result.translation,
        grammarNotes: result.grammarNotes,
        timestamp: clockTime()
      };
      setMessages((prev) => [...prev, aiMessage]);
      setFailedReply(null);
      options.onReply(aiMessage.text);
    } else {
      setFailedReply({ messageId, text, reason: result.reason });
    }
    setIsAiGenerating(false);
  };

  const sendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      personaId: persona.id,
      text,
      translation: '',
      timestamp: clockTime()
    };
    const history = messages.slice(-CHAT_HISTORY_LENGTH);
    setFailedReply(null);
    setMessages((prev) => [...prev, userMsg]);
    await requestTutorReply(text, userMsg.id, history);
  };

  const retryReply = async () => {
    if (!failedReply || isAiGenerating) return;
    const { messageId, text } = failedReply;
    const history = retryHistory(messages, messageId);
    setFailedReply(null);
    await requestTutorReply(text, messageId, history);
  };

  const resetConversation = (next: ChatMessage[]) => {
    setMessages(next);
    setFailedReply(null);
  };

  return { messages, failedReply, isAiGenerating, draft, setDraft, sendMessage, retryReply, resetConversation };
}
