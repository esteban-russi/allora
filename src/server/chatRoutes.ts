/** HTTP route for one tutor chat turn with grammar notes and session checkpointing. */
import { randomUUID } from 'crypto';
import { Type } from '@google/genai';
import { Router } from 'express';
import { buildSystemInstruction, GRAMMAR_STRICTNESS_LEVELS, LEVEL_PROMPTS, PERSONA_PROMPTS } from '../data/personaPrompts';
import type { CefrLevel } from '../types';
import { defaultSessionStore } from './defaultSessionStore';
import { CHAT_MODEL, generateContentWithFallback, hasGenAiCredentials, parseModelJsonResponse } from './genAi';
import { defaultMetrics } from './metrics';
import { BLOCKED_REPLY_TEXT, isBlockedGeminiResponse, MODEL_SAFETY_SETTINGS } from './modelSafety';
import { requirePersonaAccess } from './personaAccess';
import { requireQuota } from './quota';
import type { ConversationTurn, SessionStore } from './sessionStore';
import { summarizeError } from './vertexCooldown';

export interface ChatRouterDeps {
  sessions?: SessionStore;
}

/**
 * Create the Express router mounted at /api/chat.
 *
 * POST / checks persona access and the daily chat quota, asks Gemini for an
 * Italian reply with translation and grammar notes, and checkpoints both turns
 * when the request names one of the user's sessions.
 *
 * Args:
 *   deps: Session store (injectable for testing).
 *
 * Returns:
 *   Configured Express Router.
 */
export function createChatRouter(deps: ChatRouterDeps = {}): Router {
  const router = Router();
  const sessionStore = deps.sessions ?? defaultSessionStore;

  router.post('/', requirePersonaAccess(), requireQuota('chatMessages'), async (req, res) => {
    const startTime = Date.now();
    try {
      const {
        personaId,
        history,
        userMessage,
        temperature = 0.7,
        grammarStrictness = 'tutor',
        learnerLevel = 'A2',
        learnerName,
        sessionId
      } = req.body;

      if (!userMessage || typeof userMessage !== 'string') {
        return res.status(400).json({ error: 'Missing userMessage' });
      }
      if (userMessage.length > 2000) {
        return res.status(400).json({ error: 'userMessage exceeds maximum length of 2000 characters' });
      }

      const hasPersona = typeof personaId === 'string' && Object.hasOwn(PERSONA_PROMPTS, personaId);
      if (!hasPersona) {
        return res.status(400).json({ error: `Unknown personaId: ${String(personaId)}` });
      }
      if (!GRAMMAR_STRICTNESS_LEVELS.includes(grammarStrictness)) {
        return res.status(400).json({ error: `grammarStrictness must be one of ${GRAMMAR_STRICTNESS_LEVELS.join(', ')}` });
      }
      if (typeof learnerLevel !== 'string' || !Object.hasOwn(LEVEL_PROMPTS, learnerLevel)) {
        return res.status(400).json({ error: `learnerLevel must be one of ${Object.keys(LEVEL_PROMPTS).join(', ')}` });
      }

      if (!hasGenAiCredentials()) {
        return res.status(503).json({
          error: 'Neither GCP_PROJECT nor GEMINI_API_KEY is configured',
          fallbackNeeded: true
        });
      }

      const systemInstruction = buildSystemInstruction({
        personaId,
        level: learnerLevel as CefrLevel,
        grammarStrictness,
        learnerName
      });

      const userId = req.user!.userId;
      const session =
        typeof sessionId === 'string' && sessionId ? await sessionStore.getSession(sessionId, userId) : null;
      const contents = buildChatContents(history, session?.checkpointTurns ?? [], userMessage);

      const response = await generateContentWithFallback({
        model: CHAT_MODEL,
        contents,
        config: {
          systemInstruction,
          safetySettings: MODEL_SAFETY_SETTINGS,
          temperature: Math.min(Math.max(Number(temperature) || 0.7, 0.1), 1.2),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'Italian conversational response' },
              translation: { type: Type.STRING, description: 'Accurate English translation' },
              grammarNotes: {
                type: Type.ARRAY,
                description: 'Grammar and cultural notes',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    wordOrPhrase: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    category: { type: Type.STRING }
                  },
                  required: ['wordOrPhrase', 'explanation', 'category']
                }
              }
            },
            required: ['text', 'translation', 'grammarNotes']
          }
        }
      });

      const usage = response.usageMetadata;
      if (usage?.promptTokenCount !== undefined && usage.candidatesTokenCount !== undefined) {
        defaultMetrics.recordChatTurn(usage.promptTokenCount, usage.candidatesTokenCount);
      }

      if (isBlockedGeminiResponse(response)) {
        return res.json({
          text: BLOCKED_REPLY_TEXT,
          translation: '',
          grammarNotes: [],
          sessionId: session?.sessionId ?? null,
          quota: res.locals.quota ?? null
        });
      }

      const parsed = parseModelJsonResponse(response.text, {
        text: 'Scusa, ho avuto un problema a capire. Puoi ripetere?',
        translation: 'Sorry, I had trouble understanding. Could you repeat that?',
        grammarNotes: []
      });

      // Checkpoint both sides of the exchange; a storage failure must not lose the reply
      if (session) {
        const timestamp = new Date().toISOString();
        const userTurn: ConversationTurn = { id: `turn_${randomUUID()}`, sender: 'user', text: userMessage, timestamp };
        const personaTurn: ConversationTurn = {
          id: `turn_${randomUUID()}`,
          sender: 'persona',
          text: parsed.text,
          translation: parsed.translation,
          grammarNotes: parsed.grammarNotes,
          timestamp,
          turnDurationMs: Date.now() - startTime
        };
        try {
          await sessionStore.saveTurnCheckpoint(session.sessionId, userId, userTurn);
          await sessionStore.saveTurnCheckpoint(session.sessionId, userId, personaTurn);
        } catch (err) {
          console.error('[Session] Could not checkpoint chat turn:', summarizeError(err));
        }
      }

      // sessionId is null when the client's ID is unknown or expired, so it can start a new one
      res.json({ ...parsed, sessionId: session?.sessionId ?? null, quota: res.locals.quota ?? null });
    } catch (error: any) {
      console.error('Chat generation error:', error);
      res.status(500).json({
        error: error.message || 'Error communicating with AI model',
        fallbackNeeded: true
      });
    }
  });

  return router;
}

const CHAT_HISTORY_TURNS = 6;

/**
 * Build the Gemini `contents` for one chat turn.
 *
 * The client's own recent history wins. When it has none, e.g. after the app was
 * restarted or a Live call fell back to turn-based, the session's saved checkpoint
 * turns are used so the tutor keeps the thread of the conversation. If the last
 * history turn duplicates the new user message, it is dropped so the model sees it
 * only once.
 *
 * Args:
 *   history: Untrusted client history items (`{sender, text}`), possibly absent.
 *   checkpointTurns: Saved turns of the learner session, oldest first.
 *   userMessage: The learner's new message.
 *
 * Returns:
 *   Gemini content entries, ending with the new user message.
 */
export function buildChatContents(
  history: unknown,
  checkpointTurns: ConversationTurn[],
  userMessage: string
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const clientTurns = Array.isArray(history)
    ? history.filter(
        (h): h is { sender?: unknown; text: string } =>
          Boolean(h) && typeof h === 'object' && typeof h.text === 'string' && h.text.trim().length > 0
      )
    : [];
  const turns = clientTurns.length > 0 ? clientTurns : checkpointTurns;
  const lastTurn = turns[turns.length - 1];
  const priorTurns =
    lastTurn?.sender === 'user' && lastTurn.text.trim() === userMessage.trim()
      ? turns.slice(0, -1)
      : turns;

  return [
    ...priorTurns.slice(-CHAT_HISTORY_TURNS).map((turn) => ({
      role: turn.sender === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: turn.text }]
    })),
    { role: 'user' as const, parts: [{ text: userMessage }] }
  ];
}
