/** Behaviour every SessionStore must have, run against each implementation. */
import { describe, expect, it } from 'vitest';
import {
  initializeLearnerSession,
  SessionOwnershipError,
  type ConversationTurn,
  type SessionStore
} from '../../src/product/server/sessionStore';

/** Builds a fresh, empty store whose clock is `now` and whose retention is `retentionMs`. */
export type SessionStoreFactory = (options: { retentionMs: number; now: () => number }) => SessionStore;

const DAY_MS = 24 * 60 * 60 * 1000;

function turn(id: string, sender: ConversationTurn['sender'], text: string): ConversationTurn {
  return { id, sender, text, timestamp: '2026-11-18T10:00:00.000Z' };
}

/**
 * Register the shared SessionStore behaviour tests.
 *
 * Args:
 *   name: Implementation name shown in test output.
 *   makeStore: Factory for a fresh, empty store.
 */
export function describeSessionStoreContract(name: string, makeStore: SessionStoreFactory): void {
  describe(`${name} (SessionStore contract)`, () => {
    let clock = Date.parse('2026-11-18T10:00:00.000Z');
    const setup = (retentionMs = 30 * DAY_MS) => {
      clock = Date.parse('2026-11-18T10:00:00.000Z');
      return makeStore({ retentionMs, now: () => clock });
    };

    it('creates and retrieves a session for its owner only', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'owner', learnerName: 'Giulia', learnerLevel: 'B1' });
      await store.createOrUpdateSession(session);

      const retrieved = await store.getSession(session.sessionId, 'owner');
      expect(retrieved?.learnerName).toBe('Giulia');
      expect(retrieved?.learnerLevel).toBe('B1');
      expect(await store.getSession(session.sessionId, 'intruder')).toBeNull();
    });

    it('returns null for an unknown session', async () => {
      const store = setup();
      expect(await store.getSession('sess_missing', 'owner')).toBeNull();
    });

    it('refuses to overwrite a session that belongs to another user', async () => {
      const store = setup();
      const owned = initializeLearnerSession({ userId: 'owner', learnerName: 'Giulia' });
      await store.createOrUpdateSession(owned);

      const hijack = { ...initializeLearnerSession({ userId: 'intruder' }), sessionId: owned.sessionId };
      await expect(store.createOrUpdateSession(hijack)).rejects.toBeInstanceOf(SessionOwnershipError);
      expect((await store.getSession(owned.sessionId, 'owner'))?.learnerName).toBe('Giulia');
    });

    it('does not let callers change stored state through returned objects', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'owner', learnerName: 'Giulia' });
      const saved = await store.createOrUpdateSession(session);
      saved.learnerName = 'changed';

      const read = await store.getSession(session.sessionId, 'owner');
      read!.checkpointTurns.push(turn('x', 'user', 'not saved'));

      const again = await store.getSession(session.sessionId, 'owner');
      expect(again?.learnerName).toBe('Giulia');
      expect(again?.checkpointTurns).toEqual(session.checkpointTurns);
    });

    it('returns the most recently updated active session of a user', async () => {
      const store = setup();
      const older = initializeLearnerSession({ userId: 'learner', learnerLevel: 'A1' });
      const newer = initializeLearnerSession({ userId: 'learner', learnerLevel: 'B2' });
      const other = initializeLearnerSession({ userId: 'someone-else' });
      await store.createOrUpdateSession(older);
      clock += 1000;
      await store.createOrUpdateSession(newer);
      clock += 1000;
      await store.createOrUpdateSession(other);

      expect((await store.getActiveUserSession('learner'))?.sessionId).toBe(newer.sessionId);
      expect(await store.getActiveUserSession('nobody')).toBeNull();
    });

    it('saves checkpoints in order and updates progress', async () => {
      const store = setup();
      const session = { ...initializeLearnerSession({ userId: 'learner' }), checkpointTurns: [] };
      await store.createOrUpdateSession(session);

      await store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t1', 'user', 'Ciao, come va?'));
      const updated = await store.saveTurnCheckpoint(
        session.sessionId,
        'learner',
        turn('t2', 'persona', 'Tutto bene, grazie!')
      );

      expect(updated?.checkpointTurns.map((t) => t.id)).toEqual(['t1', 't2']);
      expect(updated?.progress.totalTurns).toBe(2);
      expect(updated?.progress.talkingSharePct).toBe(50);
      expect((await store.getSession(session.sessionId, 'learner'))?.checkpointTurns).toHaveLength(2);
    });

    it('keeps both turns when two checkpoints are saved at the same time', async () => {
      const store = setup();
      const session = { ...initializeLearnerSession({ userId: 'learner' }), checkpointTurns: [] };
      await store.createOrUpdateSession(session);

      await Promise.all([
        store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t1', 'user', 'Ciao')),
        store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t2', 'persona', 'Salve'))
      ]);

      const ids = (await store.getSession(session.sessionId, 'learner'))?.checkpointTurns.map((t) => t.id);
      expect(ids?.sort()).toEqual(['t1', 't2']);
    });

    it('keeps only the last 50 checkpoint turns', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'learner' });
      await store.createOrUpdateSession({
        ...session,
        checkpointTurns: Array.from({ length: 50 }, (_, i) => turn(`t${i}`, 'user', 'ciao'))
      });

      const updated = await store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t50', 'persona', 'salve'));

      expect(updated?.checkpointTurns).toHaveLength(50);
      expect(updated?.checkpointTurns[0].id).toBe('t1');
      expect(updated?.checkpointTurns[49].id).toBe('t50');
    });

    it('does not checkpoint into a session owned by another user', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'owner' });
      await store.createOrUpdateSession(session);

      expect(await store.saveTurnCheckpoint(session.sessionId, 'intruder', turn('t1', 'user', 'hi'))).toBeNull();
      expect((await store.getSession(session.sessionId, 'owner'))?.checkpointTurns).toEqual(session.checkpointTurns);
    });

    it('updates settings without losing a turn checkpointed at the same time', async () => {
      const store = setup();
      const session = { ...initializeLearnerSession({ userId: 'learner', learnerLevel: 'A2' }), checkpointTurns: [] };
      await store.createOrUpdateSession(session);
      const settings = {
        personaId: 'emmanuele',
        learnerName: 'Giulia',
        learnerLevel: 'B1' as const,
        grammarStrictness: 'strict',
        savedPhrases: [{ id: 'p1', it: 'Ciao', en: 'Hi' }]
      };

      await Promise.all([
        store.updateSessionSettings(session.sessionId, 'learner', settings),
        store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t1', 'user', 'Ciao'))
      ]);

      const read = await store.getSession(session.sessionId, 'learner');
      expect(read?.checkpointTurns.map((t) => t.id)).toEqual(['t1']);
      expect(read?.learnerName).toBe('Giulia');
      expect(read?.progress.savedPhrases).toEqual(settings.savedPhrases);
      expect(read?.progress.cefrLevel).toBe('B1');
      expect(read?.progress.levelHistory.map((h) => h.level)).toEqual(['A2', 'B1']);
    });

    it('keeps saved phrases when settings arrive without them, and ignores other users', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'learner' });
      await store.createOrUpdateSession({
        ...session,
        progress: { ...session.progress, savedPhrases: [{ id: 'p1', it: 'Ciao', en: 'Hi' }] }
      });
      const settings = { personaId: 'emmanuele', learnerName: 'Pia', learnerLevel: 'A2' as const, grammarStrictness: 'tutor' };

      expect(await store.updateSessionSettings(session.sessionId, 'intruder', settings)).toBeNull();
      const updated = await store.updateSessionSettings(session.sessionId, 'learner', settings);

      expect(updated?.progress.savedPhrases).toHaveLength(1);
      expect(updated?.progress.levelHistory).toHaveLength(1);
    });

    it('stores and clears the Live resumption handle', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'learner' });
      await store.createOrUpdateSession(session);

      await store.updateUpstreamHandle(session.sessionId, 'learner', 'handle-abc', 'gemini-3.8-live');
      let read = await store.getSession(session.sessionId, 'learner');
      expect(read?.upstreamResumptionHandle).toBe('handle-abc');
      expect(read?.upstreamModel).toBe('gemini-3.8-live');

      await store.updateUpstreamHandle(session.sessionId, 'learner', null);
      read = await store.getSession(session.sessionId, 'learner');
      expect(read?.upstreamResumptionHandle).toBeNull();
      expect(read?.upstreamModel).toBe('gemini-3.8-live');
    });

    it('hides sessions once their retention has passed, and extends it on activity', async () => {
      const store = setup(5000);
      const session = initializeLearnerSession({ userId: 'learner' });
      await store.createOrUpdateSession(session);

      clock += 4000;
      await store.saveTurnCheckpoint(session.sessionId, 'learner', turn('t1', 'user', 'ciao'));
      clock += 4000;
      expect(await store.getSession(session.sessionId, 'learner')).not.toBeNull();

      await store.updateUpstreamHandle(session.sessionId, 'learner', 'handle');
      clock += 4000;
      expect(await store.getSession(session.sessionId, 'learner')).not.toBeNull();

      clock += 2000;
      expect(await store.getSession(session.sessionId, 'learner')).toBeNull();
      expect(await store.getActiveUserSession('learner')).toBeNull();
    });

    it('deletes a session only for its owner', async () => {
      const store = setup();
      const session = initializeLearnerSession({ userId: 'owner' });
      await store.createOrUpdateSession(session);

      expect(await store.deleteSession(session.sessionId, 'intruder')).toBe(false);
      expect(await store.deleteSession(session.sessionId, 'owner')).toBe(true);
      expect(await store.getSession(session.sessionId, 'owner')).toBeNull();
      expect(await store.deleteSession(session.sessionId, 'owner')).toBe(false);
    });

    it('deletes all data of one user and nobody else', async () => {
      const store = setup();
      const a = initializeLearnerSession({ userId: 'forget-me' });
      const b = initializeLearnerSession({ userId: 'forget-me' });
      const keep = initializeLearnerSession({ userId: 'keep-me' });
      for (const s of [a, b, keep]) await store.createOrUpdateSession(s);

      expect(await store.deleteAllUserData('forget-me')).toBe(2);
      expect(await store.getSession(a.sessionId, 'forget-me')).toBeNull();
      expect(await store.getSession(keep.sessionId, 'keep-me')).not.toBeNull();
    });

    it('transfers user sessions to an account without active sessions', async () => {
      const store = setup();
      const guestSession = initializeLearnerSession({ userId: 'guest-1' });
      await store.createOrUpdateSession(guestSession);
      await store.updateUpstreamHandle(guestSession.sessionId, 'guest-1', 'handle-123', 'model-123');

      const outcome = await store.transferUserSessions('guest-1', 'account-1');
      expect(outcome).toBe('moved');

      const transferred = await store.getSession(guestSession.sessionId, 'account-1');
      expect(transferred).not.toBeNull();
      expect(transferred?.userId).toBe('account-1');
      expect(transferred?.upstreamResumptionHandle).toBeNull();
      expect(transferred?.upstreamModel).toBeNull();
      expect(await store.getSession(guestSession.sessionId, 'guest-1')).toBeNull();
    });

    it('discards guest sessions when the target account already has an active session', async () => {
      const store = setup();
      const guestSession = initializeLearnerSession({ userId: 'guest-2' });
      const accountSession = initializeLearnerSession({ userId: 'account-2' });
      await store.createOrUpdateSession(guestSession);
      await store.createOrUpdateSession(accountSession);

      const outcome = await store.transferUserSessions('guest-2', 'account-2');
      expect(outcome).toBe('discarded');

      expect(await store.getSession(guestSession.sessionId, 'guest-2')).toBeNull();
      expect(await store.getSession(guestSession.sessionId, 'account-2')).toBeNull();
      expect(await store.getSession(accountSession.sessionId, 'account-2')).not.toBeNull();
    });

    it('returns none when the source user has no sessions to transfer', async () => {
      const store = setup();
      const outcome = await store.transferUserSessions('empty-guest', 'account-3');
      expect(outcome).toBe('none');
    });

    it('syncs notebook phrases across all conversations of a user and preserves them on deleting a session', async () => {
      const store = setup();
      const s1 = initializeLearnerSession({ userId: 'phrase-learner' });
      await store.createOrUpdateSession(s1);

      // Add phrase p1 via settings update on s1
      await store.updateSessionSettings(s1.sessionId, 'phrase-learner', {
        personaId: 'emmanuele',
        learnerName: 'Test',
        learnerLevel: 'A2',
        grammarStrictness: 'tutor',
        savedPhrases: [{ id: 'p1', it: 'Grazie', en: 'Thank you' }]
      });

      // Create second session s2 for same user
      const s2 = initializeLearnerSession({ userId: 'phrase-learner', topic: 'cafe' });
      await store.createOrUpdateSession(s2);

      // s2 should see p1
      const readS2 = await store.getSession(s2.sessionId, 'phrase-learner');
      expect(readS2?.progress.savedPhrases).toEqual([{ id: 'p1', it: 'Grazie', en: 'Thank you' }]);

      // Add phrase p2 on s2
      await store.updateSessionSettings(s2.sessionId, 'phrase-learner', {
        personaId: 'emmanuele',
        learnerName: 'Test',
        learnerLevel: 'A2',
        grammarStrictness: 'tutor',
        savedPhrases: [
          { id: 'p1', it: 'Grazie', en: 'Thank you' },
          { id: 'p2', it: 'Prego', en: "You're welcome" }
        ]
      });

      // s1 should now see p1 and p2
      const readS1 = await store.getSession(s1.sessionId, 'phrase-learner');
      expect(readS1?.progress.savedPhrases).toHaveLength(2);

      // Delete s2: s1 and user notebook still have both phrases
      expect(await store.deleteSession(s2.sessionId, 'phrase-learner')).toBe(true);
      const afterDel = await store.getSession(s1.sessionId, 'phrase-learner');
      expect(afterDel?.progress.savedPhrases).toHaveLength(2);
      expect(await store.getUserPhrases('phrase-learner')).toHaveLength(2);

      // Delete s1: user notebook phrases still survive!
      expect(await store.deleteSession(s1.sessionId, 'phrase-learner')).toBe(true);
      expect(await store.getUserPhrases('phrase-learner')).toHaveLength(2);

      // GDPR delete wipes phrases completely
      await store.deleteAllUserData('phrase-learner');
      expect(await store.getUserPhrases('phrase-learner')).toHaveLength(0);
    });

    it('lists user sessions newest-first with summaries and never returns another user\'s sessions', async () => {
      const store = setup();
      const s1 = initializeLearnerSession({ userId: 'list-user', topic: 'market' });
      await store.createOrUpdateSession(s1);

      clock += 2000;
      const s2 = initializeLearnerSession({ userId: 'list-user', topic: 'free_chat' });
      await store.createOrUpdateSession(s2);

      // Add checkpoint turn to s2
      await store.saveTurnCheckpoint(
        s2.sessionId,
        'list-user',
        turn('t1', 'user', 'Come stai oggi a Roma?')
      );

      // Other user session
      const other = initializeLearnerSession({ userId: 'other-user', topic: 'doctor' });
      await store.createOrUpdateSession(other);

      const list = await store.listUserSessions('list-user');
      expect(list).toHaveLength(2);
      // Newest first
      expect(list[0].sessionId).toBe(s2.sessionId);
      expect(list[0].title).toBe('Come stai oggi a Roma?');
      expect(list[0].lastLinePreview).toBe('Come stai oggi a Roma?');
      expect(list[0].lastLineSender).toBe('user');
      expect(list[0].turnCount).toBe(2);

      expect(list[1].sessionId).toBe(s1.sessionId);
      expect(list[1].topic).toBe('market');
      expect(list[1].title).toBe('At the market');
      expect(list[1].turnCount).toBe(1);
      expect(list[1].lastLineSender).toBe('persona');

      // Verify other user not returned
      expect(list.some((s) => s.sessionId === other.sessionId)).toBe(false);
    });

    it('transfers all guest conversations to a new account', async () => {
      const store = setup();
      const g1 = initializeLearnerSession({ userId: 'guest-multi', topic: 'market' });
      const g2 = initializeLearnerSession({ userId: 'guest-multi', topic: 'cafe' });
      const g3 = initializeLearnerSession({ userId: 'guest-multi', topic: 'free_chat' });
      await store.createOrUpdateSession(g1);
      await store.createOrUpdateSession(g2);
      await store.createOrUpdateSession(g3);

      const outcome = await store.transferUserSessions('guest-multi', 'target-multi');
      expect(outcome).toBe('moved');

      const guestList = await store.listUserSessions('guest-multi');
      expect(guestList).toHaveLength(0);

      const targetList = await store.listUserSessions('target-multi');
      expect(targetList).toHaveLength(3);
    });
  });
}
