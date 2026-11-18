/** Tests for learner session lifecycle, checkpointing, and retention/deletion rules. */
import { describe, expect, it } from 'vitest';
import {
  appendCheckpointTurn,
  InMemorySessionStore,
  initializeLearnerSession,
  parseConversationTurn,
  parseSavedPhrases,
  toClientSession
} from '../src/server/sessionStore';
import { describeSessionStoreContract } from './helpers/sessionStoreContract';

describeSessionStoreContract('InMemorySessionStore', ({ retentionMs, now }) => new InMemorySessionStore(retentionMs, now));

describe('InMemorySessionStore.purgeExpiredSessions', () => {
  it('purges expired sessions and keeps active ones', async () => {
    let clock = 1_000_000;
    const store = new InMemorySessionStore(5000, () => clock);
    await store.createOrUpdateSession(initializeLearnerSession({ userId: 'u1' }));
    clock += 3000;
    await store.createOrUpdateSession(initializeLearnerSession({ userId: 'u2' }));

    clock += 3000;
    expect(await store.purgeExpiredSessions()).toBe(1);
    expect(await store.getActiveUserSession('u2')).not.toBeNull();
  });
});

describe('initializeLearnerSession', () => {
  it('generates a unique server-side session ID for every new session', () => {
    const a = initializeLearnerSession({ userId: 'u' });
    const b = initializeLearnerSession({ userId: 'u' });
    expect(a.sessionId).toMatch(/^sess_/);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe('toClientSession', () => {
  it('drops the owner and Live resumption fields and keeps the rest', () => {
    const session = { ...initializeLearnerSession({ userId: 'u' }), upstreamResumptionHandle: 'secret', upstreamModel: 'm' };
    const view = toClientSession(session);

    expect(view).not.toHaveProperty('userId');
    expect(view).not.toHaveProperty('upstreamResumptionHandle');
    expect(view).not.toHaveProperty('upstreamModel');
    expect(view.sessionId).toBe(session.sessionId);
    expect(session.userId).toBe('u');
  });
});

describe('appendCheckpointTurn', () => {
  it('does not modify the session it is given', () => {
    const session = initializeLearnerSession({ userId: 'u' });
    appendCheckpointTurn(session, { id: 't', sender: 'user', text: 'ciao', timestamp: session.createdAt }, 0, 1000);
    expect(session.checkpointTurns).toEqual([]);
  });

  it('reports a zero talking share when no words were said', () => {
    const session = initializeLearnerSession({ userId: 'u' });
    const updated = appendCheckpointTurn(session, { id: 't', sender: 'user', text: '  ', timestamp: session.createdAt }, 0, 1000);
    expect(updated.progress.talkingSharePct).toBe(0);
  });
});

describe('parseConversationTurn', () => {
  const validTurn = {
    id: 'turn-1',
    sender: 'user',
    text: 'Ciao, come stai?',
    timestamp: '2026-11-18T10:00:00.000Z'
  };

  it('accepts a valid turn and drops unknown fields', () => {
    expect(parseConversationTurn({ ...validTurn, injected: 'x' })).toEqual(validTurn);
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a missing text', { ...validTurn, text: undefined }],
    ['a non-string text', { ...validTurn, text: 42 }],
    ['an unknown sender', { ...validTurn, sender: 'admin' }],
    ['an unparseable timestamp', { ...validTurn, timestamp: 'yesterday' }],
    ['an oversized text', { ...validTurn, text: 'a'.repeat(2001) }],
    ['malformed grammar notes', { ...validTurn, grammarNotes: [{ wordOrPhrase: 1 }] }]
  ])('rejects %s', (_label, value) => {
    expect(parseConversationTurn(value)).toBeNull();
  });
});

describe('parseSavedPhrases', () => {
  it('accepts well-formed phrases', () => {
    const phrases = [{ id: 'p1', it: 'Buongiorno', en: 'Good morning' }];
    expect(parseSavedPhrases(phrases)).toEqual(phrases);
  });

  it('rejects non-arrays, malformed entries, and oversized lists', () => {
    expect(parseSavedPhrases('nope')).toBeNull();
    expect(parseSavedPhrases([{ id: 'p1', it: 'Ciao' }])).toBeNull();
    expect(parseSavedPhrases(Array.from({ length: 501 }, (_, i) => ({ id: `p${i}`, it: 'a', en: 'b' })))).toBeNull();
  });
});
