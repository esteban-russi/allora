/** Behaviour every SessionStore must have, run against each implementation. */
import { describe, expect, it } from 'vitest';
import {
  initializeLearnerSession,
  SessionOwnershipError,
  type ConversationTurn,
  type SessionStore
} from '../../src/server/sessionStore';

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
      expect(again?.checkpointTurns).toEqual([]);
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
      const session = initializeLearnerSession({ userId: 'learner' });
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
      const session = initializeLearnerSession({ userId: 'learner' });
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
      expect((await store.getSession(session.sessionId, 'owner'))?.checkpointTurns).toEqual([]);
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
  });
}
