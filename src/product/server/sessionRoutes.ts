/** HTTP routes for reading, saving and deleting learner sessions. */
import { Router } from 'express';
import { GRAMMAR_STRICTNESS_LEVELS, LEVEL_PROMPTS, PERSONA_PROMPTS, sanitizeLearnerName } from '../data/personaPrompts';
import { isValidTopicId } from '../data/topics';
import type { CefrLevel } from '../types';
import { defaultSessionStore } from './defaultSessionStore';
import { canUsePersona, PREMIUM_REQUIRED_BODY } from './personaAccess';
import { initializeLearnerSession, parseSavedPhrases, toClientSession, type SessionStore } from './sessionStore';
import { summarizeError } from '../../platform/server/vertexCooldown';

export interface SessionRouterDeps {
  sessions?: SessionStore;
}

/**
 * Create the Express router mounted at /api/session.
 *
 * Routes: GET / (active session), POST / (create, or update settings when a
 * sessionId is sent), DELETE /:sessionId (one session) and DELETE / (all of the
 * user's data). Every route expects `req.user` and `req.account` to be set.
 *
 * Args:
 *   deps: Session store (injectable for testing).
 *
 * Returns:
 *   Configured Express Router.
 */
export function createSessionRouter(deps: SessionRouterDeps = {}): Router {
  const router = Router();
  const sessions = deps.sessions ?? defaultSessionStore;

  router.get('/list', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const summaries = await sessions.listUserSessions(userId, 50);
      res.json(summaries);
    } catch (err) {
      console.error('[Session] Error listing sessions:', summarizeError(err));
      res.status(500).json({ error: 'Error listing sessions' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const session = await sessions.getActiveUserSession(userId);
      if (!session) {
        return res.status(404).json({ error: 'No active session found for user' });
      }
      res.json(toClientSession(session));
    } catch (err) {
      console.error('[Session] Error fetching session:', summarizeError(err));
      res.status(500).json({ error: 'Error fetching session' });
    }
  });

  router.get('/:sessionId', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { sessionId } = req.params;
      const session = await sessions.getSession(sessionId, userId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or not owned by user' });
      }
      res.json(toClientSession(session));
    } catch (err) {
      console.error('[Session] Error fetching session by id:', summarizeError(err));
      res.status(500).json({ error: 'Error fetching session' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const {
        sessionId,
        personaId = 'emmanuele',
        learnerName = '',
        learnerLevel = 'A2',
        grammarStrictness = 'tutor',
        topic,
        savedPhrases
      } = req.body ?? {};

      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId)) {
        return res.status(400).json({ error: 'sessionId must be a non-empty string' });
      }
      if (topic !== undefined && !isValidTopicId(topic)) {
        return res.status(400).json({ error: `Invalid topic: ${String(topic)}` });
      }
      if (typeof personaId !== 'string' || !Object.hasOwn(PERSONA_PROMPTS, personaId)) {
        return res.status(400).json({ error: `Unknown personaId: ${String(personaId)}` });
      }
      if (!canUsePersona(req.account!.tier, personaId)) {
        return res.status(403).json(PREMIUM_REQUIRED_BODY);
      }
      if (typeof learnerLevel !== 'string' || !Object.hasOwn(LEVEL_PROMPTS, learnerLevel)) {
        return res.status(400).json({ error: `learnerLevel must be one of ${Object.keys(LEVEL_PROMPTS).join(', ')}` });
      }
      if (!GRAMMAR_STRICTNESS_LEVELS.includes(grammarStrictness)) {
        return res.status(400).json({ error: `grammarStrictness must be one of ${GRAMMAR_STRICTNESS_LEVELS.join(', ')}` });
      }
      const phrases = savedPhrases === undefined ? undefined : parseSavedPhrases(savedPhrases);
      if (phrases === null) {
        return res.status(400).json({ error: 'savedPhrases must be a list of {id, it, en} strings (max 500)' });
      }

      const fields = {
        personaId,
        learnerName: sanitizeLearnerName(learnerName),
        learnerLevel: learnerLevel as CefrLevel,
        grammarStrictness
      };

      if (sessionId) {
        // Only the settings change, so a turn checkpointed at the same moment is kept
        const updated = await sessions.updateSessionSettings(sessionId, userId, {
          ...fields,
          savedPhrases: phrases
        });
        if (!updated) {
          return res.status(404).json({ error: 'Session not found or not owned by user' });
        }
        return res.json(toClientSession(updated));
      }

      const session = initializeLearnerSession({ userId, ...fields, topic });
      if (phrases) {
        session.progress = { ...session.progress, savedPhrases: phrases };
      }
      res.json(toClientSession(await sessions.createOrUpdateSession(session)));
    } catch (err) {
      console.error('[Session] Error saving session:', summarizeError(err));
      res.status(500).json({ error: 'Error saving session' });
    }
  });

  router.delete('/:sessionId', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { sessionId } = req.params;
      const deleted = await sessions.deleteSession(sessionId, userId);
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found or not owned by user' });
      }
      res.json({ status: 'deleted', sessionId });
    } catch (err) {
      console.error('[Session] Error deleting session:', summarizeError(err));
      res.status(500).json({ error: 'Error deleting session' });
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const count = await sessions.deleteAllUserData(userId);
      res.json({ status: 'all_data_deleted', sessionsDeleted: count });
    } catch (err) {
      console.error('[Session] Error deleting user data:', summarizeError(err));
      res.status(500).json({ error: 'Error deleting user data' });
    }
  });

  return router;
}
