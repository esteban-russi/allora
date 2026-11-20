import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  fetchSessionList,
  fetchSessionById,
  deleteSessionById,
  createConversation,
  loadLearnerSession,
  rememberLearnerSessionId,
  getLearnerSessionId
} from '../src/product/client/learnerSession';
import * as apiClient from '../src/platform/client/apiClient';

describe('learnerSession client functions', () => {
  function stubStorage(): void {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key)
    });
  }

  beforeEach(() => {
    stubStorage();
    vi.restoreAllMocks();
    rememberLearnerSessionId(null);
  });

  it('fetchSessionList calls GET /api/session/list', async () => {
    const mockList = [{ sessionId: 's1', title: 'Chat 1' }];
    vi.spyOn(apiClient, 'getWithAuth').mockResolvedValue(
      new Response(JSON.stringify(mockList), { status: 200 })
    );

    const list = await fetchSessionList();
    expect(list).toEqual(mockList);
  });

  it('fetchSessionById calls GET /api/session/:id and validates client session structure', async () => {
    const validSession = {
      sessionId: 's1',
      personaId: 'emmanuele',
      learnerName: 'Enzo',
      learnerLevel: 'B2',
      grammarStrictness: 'tutor',
      checkpointTurns: [],
      progress: { cefrLevelHistory: [], savedPhrases: [] },
      topic: 'market',
      title: 'At the market'
    };

    vi.spyOn(apiClient, 'getWithAuth').mockResolvedValue(
      new Response(JSON.stringify(validSession), { status: 200 })
    );

    const session = await fetchSessionById('s1');
    expect(session?.sessionId).toBe('s1');
    expect(session?.topic).toBe('market');
  });

  it('deleteSessionById calls DELETE /api/session/:id and forgets remembered ID if matched', async () => {
    rememberLearnerSessionId('del_me');
    vi.spyOn(apiClient, 'deleteWithAuth').mockResolvedValue(
      new Response(JSON.stringify({ status: 'deleted' }), { status: 200 })
    );

    const ok = await deleteSessionById('del_me');
    expect(ok).toBe(true);
    expect(getLearnerSessionId()).toBeNull();
  });

  it('createConversation calls POST /api/session and remembers new sessionId', async () => {
    const createdSession = {
      sessionId: 'new_sess',
      personaId: 'emmanuele',
      learnerName: 'Enzo',
      learnerLevel: 'A2',
      grammarStrictness: 'tutor',
      checkpointTurns: [],
      progress: { cefrLevelHistory: [], savedPhrases: [] },
      topic: 'cafe',
      title: 'Ordering at a café'
    };

    vi.spyOn(apiClient, 'postJson').mockResolvedValue(
      new Response(JSON.stringify(createdSession), { status: 200 })
    );

    const res = await createConversation({ personaId: 'emmanuele', topic: 'cafe' });
    expect(res?.sessionId).toBe('new_sess');
    expect(getLearnerSessionId()).toBe('new_sess');
  });

  it('loadLearnerSession tries remembered ID first, falls back to /api/session', async () => {
    rememberLearnerSessionId('remembered_123');

    // First call to /api/session/remembered_123 fails with 404
    // Second call to /api/session succeeds
    const fallbackSession = {
      sessionId: 'fallback_active',
      personaId: 'emmanuele',
      learnerName: 'Luigi',
      learnerLevel: 'A1',
      grammarStrictness: 'tutor',
      checkpointTurns: [],
      progress: { cefrLevelHistory: [], savedPhrases: [] }
    };

    vi.spyOn(apiClient, 'getWithAuth').mockImplementation(async (path: string) => {
      if (path === '/api/session/remembered_123') {
        return new Response('Not found', { status: 404 });
      }
      return new Response(JSON.stringify(fallbackSession), { status: 200 });
    });

    const session = await loadLearnerSession();
    expect(session?.sessionId).toBe('fallback_active');
    expect(getLearnerSessionId()).toBe('fallback_active');
  });
});
