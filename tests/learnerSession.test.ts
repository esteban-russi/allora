/** Tests for remembering the learner session and linking chat turns to it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLearnerSessionId, postChat, rememberLearnerSessionId } from '../src/utils/learnerSession';

const chat = { personaId: 'emmanuele', userMessage: 'Ciao', learnerLevel: 'A2' };

function stubStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key)
  });
}

/** Route fetch calls by path to canned JSON responses and record request bodies. */
function stubServer(routes: Record<string, unknown>) {
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      bodies.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(routes[path]), { status: 200 });
    })
  );
  return bodies;
}

beforeEach(stubStorage);
afterEach(() => vi.unstubAllGlobals());

describe('postChat', () => {
  it('creates a learner session on first use and sends its ID with the chat turn', async () => {
    const calls = stubServer({ '/api/session': { sessionId: 'sess_new' }, '/api/chat': { text: 'Ciao!', sessionId: 'sess_new' } });

    await postChat(chat);

    expect(calls.map((c) => c.path)).toEqual(['/api/session', '/api/chat']);
    expect(calls[1].body.sessionId).toBe('sess_new');
    expect(getLearnerSessionId()).toBe('sess_new');
  });

  it('reuses the remembered session ID', async () => {
    rememberLearnerSessionId('sess_saved');
    const calls = stubServer({ '/api/chat': { text: 'Ciao!', sessionId: 'sess_saved' } });

    await postChat(chat);

    expect(calls).toHaveLength(1);
    expect(calls[0].body.sessionId).toBe('sess_saved');
  });

  it('forgets a session ID the server no longer knows', async () => {
    rememberLearnerSessionId('sess_expired');
    stubServer({ '/api/chat': { text: 'Ciao!', sessionId: null } });

    await postChat(chat);

    expect(getLearnerSessionId()).toBeNull();
  });
});

describe('learner session storage', () => {
  it('returns null instead of throwing when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      }
    });
    expect(getLearnerSessionId()).toBeNull();
  });
});
