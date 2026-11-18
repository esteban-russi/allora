/** Tests for learner session lifecycle, checkpointing, and retention/deletion rules. */
import { describe, expect, it } from 'vitest';
import {
  InMemorySessionStore,
  initializeLearnerSession,
  type ConversationTurn
} from '../src/server/sessionStore';

describe('InMemorySessionStore lifecycle', () => {
  it('creates and retrieves a learner session by ID and userId', async () => {
    const store = new InMemorySessionStore();
    const session = initializeLearnerSession({
      userId: 'user-alessandro',
      personaId: 'emmanuele',
      learnerName: 'Alessandro',
      learnerLevel: 'B1'
    });

    const saved = await store.createOrUpdateSession(session);
    expect(saved.sessionId).toBe(session.sessionId);

    const retrieved = await store.getSession(session.sessionId, 'user-alessandro');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.learnerName).toBe('Alessandro');
    expect(retrieved?.learnerLevel).toBe('B1');
  });

  it('rejects access when a different userId attempts to read the session', async () => {
    const store = new InMemorySessionStore();
    const session = initializeLearnerSession({
      userId: 'owner-user',
      learnerName: 'Giulia'
    });
    await store.createOrUpdateSession(session);

    const stolen = await store.getSession(session.sessionId, 'intruder-user');
    expect(stolen).toBeNull();
  });

  it('retrieves the active user session', async () => {
    const store = new InMemorySessionStore();
    const s1 = initializeLearnerSession({ userId: 'active-user', learnerLevel: 'A1' });
    await store.createOrUpdateSession(s1);

    const active = await store.getActiveUserSession('active-user');
    expect(active?.sessionId).toBe(s1.sessionId);
    expect(active?.learnerLevel).toBe('A1');
  });
});

describe('Conversation checkpointing', () => {
  it('saves conversation turn checkpoints and updates talking share percentage', async () => {
    const store = new InMemorySessionStore();
    const session = initializeLearnerSession({ userId: 'learner-1' });
    await store.createOrUpdateSession(session);

    const userTurn: ConversationTurn = {
      id: 't1',
      sender: 'user',
      text: 'Ciao Emmanuele, come va oggi?',
      timestamp: new Date().toISOString()
    };
    await store.saveTurnCheckpoint(session.sessionId, 'learner-1', userTurn);

    const tutorTurn: ConversationTurn = {
      id: 't2',
      sender: 'persona',
      text: 'Salve! Tutto bene a Roma. E tu che lavoro fai?',
      translation: 'Hello! All good in Rome. And you, what do you do for work?',
      timestamp: new Date().toISOString()
    };
    const updated = await store.saveTurnCheckpoint(session.sessionId, 'learner-1', tutorTurn);

    expect(updated?.checkpointTurns.length).toBe(2);
    expect(updated?.progress.totalTurns).toBe(2);
    expect(updated?.progress.talkingSharePct).toBeGreaterThan(0);
  });

  it('stores and clears upstream Gemini Live resumption handle', async () => {
    const store = new InMemorySessionStore();
    const session = initializeLearnerSession({ userId: 'resumption-user' });
    await store.createOrUpdateSession(session);

    await store.updateUpstreamHandle(
      session.sessionId,
      'resumption-user',
      'gemini-handle-token-abc123',
      'gemini-3.8-live'
    );

    let retrieved = await store.getSession(session.sessionId, 'resumption-user');
    expect(retrieved?.upstreamResumptionHandle).toBe('gemini-handle-token-abc123');
    expect(retrieved?.upstreamModel).toBe('gemini-3.8-live');

    // Clear handle when expired
    await store.updateUpstreamHandle(session.sessionId, 'resumption-user', null);
    retrieved = await store.getSession(session.sessionId, 'resumption-user');
    expect(retrieved?.upstreamResumptionHandle).toBeNull();
  });
});

describe('Retention and GDPR Deletion Rules', () => {
  it('expires sessions past retention TTL', async () => {
    let simulatedTime = 1_000_000;
    const store = new InMemorySessionStore(5000, () => simulatedTime); // 5s retention TTL

    const session = initializeLearnerSession({ userId: 'expiring-user', retentionMs: 5000 });
    await store.createOrUpdateSession(session);

    // Within TTL
    expect(await store.getSession(session.sessionId, 'expiring-user')).not.toBeNull();

    // Advance past TTL
    simulatedTime += 6000;
    expect(await store.getSession(session.sessionId, 'expiring-user')).toBeNull();
  });

  it('purges all expired sessions', async () => {
    let simulatedTime = 1_000_000;
    const store = new InMemorySessionStore(5000, () => simulatedTime);

    const s1 = initializeLearnerSession({ userId: 'u1', retentionMs: 5000 });
    const s2 = initializeLearnerSession({ userId: 'u2', retentionMs: 5000 });
    await store.createOrUpdateSession(s1);
    await store.createOrUpdateSession(s2);

    simulatedTime += 6000;
    const purged = await store.purgeExpiredSessions();
    expect(purged).toBe(2);
  });

  it('deletes a specific session on user request', async () => {
    const store = new InMemorySessionStore();
    const session = initializeLearnerSession({ userId: 'delete-user' });
    await store.createOrUpdateSession(session);

    const deleted = await store.deleteSession(session.sessionId, 'delete-user');
    expect(deleted).toBe(true);

    const check = await store.getSession(session.sessionId, 'delete-user');
    expect(check).toBeNull();
  });

  it('deletes all user data on GDPR right-to-be-forgotten request', async () => {
    const store = new InMemorySessionStore();
    const s1 = initializeLearnerSession({ userId: 'gdpr-user' });
    const s2 = initializeLearnerSession({ userId: 'gdpr-user' });
    const sOther = initializeLearnerSession({ userId: 'keep-user' });

    await store.createOrUpdateSession(s1);
    await store.createOrUpdateSession(s2);
    await store.createOrUpdateSession(sOther);

    const deletedCount = await store.deleteAllUserData('gdpr-user');
    expect(deletedCount).toBe(2);

    expect(await store.getSession(s1.sessionId, 'gdpr-user')).toBeNull();
    expect(await store.getSession(sOther.sessionId, 'keep-user')).not.toBeNull();
  });
});
