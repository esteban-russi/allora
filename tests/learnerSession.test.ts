/** Tests for remembering the learner session and linking chat turns to it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLearnerSessionId,
  loadLearnerSession,
  postChat,
  rememberLearnerSessionId,
  saveLearnerSettings,
  startLearnerSession,
  toChatMessages,
  type LearnerSettings
} from '../src/utils/learnerSession';

const chat = { personaId: 'emmanuele', userMessage: 'Ciao', learnerLevel: 'A2' };

function stubStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key)
  });
}

/** Route fetch calls by path to canned JSON responses (status 200 unless given) and record request bodies. */
function stubServer(routes: Record<string, unknown>, statuses: Record<string, number> = {}) {
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      bodies.push({ path, body: init.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify(routes[path] ?? {}), { status: statuses[path] ?? 200 });
    })
  );
  return bodies;
}

const settings: LearnerSettings = {
  profile: { name: 'Giulia', level: 'B1', personaId: 'emmanuele' },
  grammarStrictness: 'tutor',
  savedPhrases: [{ id: 'p1', it: 'Ciao', en: 'Hi' }]
};

const storedSession = {
  sessionId: 'sess_stored',
  personaId: 'emmanuele',
  learnerName: 'Giulia',
  learnerLevel: 'B1',
  grammarStrictness: 'strict',
  progress: { savedPhrases: [{ id: 'p1', it: 'Ciao', en: 'Hi' }] },
  checkpointTurns: []
};

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

describe('loadLearnerSession', () => {
  it('returns the latest session and remembers its ID', async () => {
    stubServer({ '/api/session': storedSession });

    const session = await loadLearnerSession();

    expect(session?.learnerName).toBe('Giulia');
    expect(getLearnerSessionId()).toBe('sess_stored');
  });

  it('returns null when the learner has no session', async () => {
    stubServer({ '/api/session': { error: 'none' } }, { '/api/session': 404 });
    expect(await loadLearnerSession()).toBeNull();
  });

  it.each([
    ['a missing session ID', { ...storedSession, sessionId: undefined }],
    ['an unknown level', { ...storedSession, learnerLevel: 'Z9' }],
    ['turns that are not a list', { ...storedSession, checkpointTurns: 'x' }],
    ['no saved phrases', { ...storedSession, progress: {} }]
  ])('returns null for a reply with %s', async (_label, body) => {
    stubServer({ '/api/session': body });
    expect(await loadLearnerSession()).toBeNull();
    expect(getLearnerSessionId()).toBeNull();
  });

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    expect(await loadLearnerSession()).toBeNull();
  });
});

describe('startLearnerSession', () => {
  it('creates a new session with the settings, replacing the remembered one', async () => {
    rememberLearnerSessionId('sess_old');
    const calls = stubServer({ '/api/session': { sessionId: 'sess_fresh' } });

    expect(await startLearnerSession(settings)).toBe('sess_fresh');

    expect(calls[0].body).not.toHaveProperty('sessionId');
    expect(calls[0].body).toMatchObject({ learnerName: 'Giulia', learnerLevel: 'B1', savedPhrases: settings.savedPhrases });
    expect(getLearnerSessionId()).toBe('sess_fresh');
  });

  it('makes a chat sent while it runs use the new session instead of creating another', async () => {
    const calls = stubServer({ '/api/session': { sessionId: 'sess_fresh' }, '/api/chat': { text: 'Ciao!', sessionId: 'sess_fresh' } });

    const started = startLearnerSession(settings);
    await postChat(chat);
    await started;

    expect(calls.map((c) => c.path)).toEqual(['/api/session', '/api/chat']);
    expect(calls[1].body.sessionId).toBe('sess_fresh');
  });
});

describe('saveLearnerSettings', () => {
  it('updates the remembered session', async () => {
    rememberLearnerSessionId('sess_saved');
    const calls = stubServer({ '/api/session': { sessionId: 'sess_saved' } });

    expect(await saveLearnerSettings(settings)).toBe(true);
    expect(calls[0].body.sessionId).toBe('sess_saved');
  });

  it('starts a new session when the remembered one is gone', async () => {
    rememberLearnerSessionId('sess_gone');
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      return call === 1
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ sessionId: 'sess_new' }), { status: 200 });
    }));

    expect(await saveLearnerSettings(settings)).toBe(true);
    expect(getLearnerSessionId()).toBe('sess_new');
  });

  it('reports failure without starting a new session on a server error', async () => {
    rememberLearnerSessionId('sess_saved');
    stubServer({}, { '/api/session': 500 });

    expect(await saveLearnerSettings(settings)).toBe(false);
    expect(getLearnerSessionId()).toBe('sess_saved');
  });
});

describe('toChatMessages', () => {
  it('rebuilds chat messages from saved turns', () => {
    const messages = toChatMessages(
      [
        { id: 't1', sender: 'user', text: 'Ciao', timestamp: '2026-11-18T10:00:00.000Z' },
        {
          id: 't2',
          sender: 'persona',
          text: 'Salve!',
          translation: 'Hello!',
          grammarNotes: [{ wordOrPhrase: 'Salve', explanation: 'Polite hello', category: 'made-up' }],
          timestamp: '2026-11-18T10:00:05.000Z'
        }
      ],
      'emmanuele'
    );

    expect(messages[0]).toMatchObject({ id: 't1', sender: 'user', personaId: 'emmanuele', translation: '' });
    expect(messages[1].translation).toBe('Hello!');
    expect(messages[1].grammarNotes?.[0].category).toBe('grammar');
    expect(messages[1].timestamp).toMatch(/\d/);
  });
});
