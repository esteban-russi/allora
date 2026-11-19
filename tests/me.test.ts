import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe, parseMeResponse } from '../src/utils/me';

const VALID_ME = {
  userId: 'user-1',
  email: 'user1@example.com',
  isAnonymous: false,
  tier: 'free',
  limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
  usage: { chatMessages: 2, voiceSeconds: 60, helperRequests: 5 },
  resetsAt: '2026-11-19T00:00:00.000Z',
  consent: null,
  subscription: null
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseMeResponse', () => {
  it('parses a valid me response', () => {
    expect(parseMeResponse(VALID_ME)).toEqual(VALID_ME);
  });

  it.each([
    null,
    undefined,
    {},
    { ...VALID_ME, userId: 123 },
    { ...VALID_ME, tier: 'unknown' },
    { ...VALID_ME, isAnonymous: 'not-bool' },
    { ...VALID_ME, limits: null },
    { ...VALID_ME, usage: null },
    { ...VALID_ME, resetsAt: 123 }
  ])('returns null for invalid payload %j', (payload) => {
    expect(parseMeResponse(payload)).toBeNull();
  });
});

describe('fetchMe', () => {
  it('returns parsed Me when /api/me responds 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID_ME), { status: 200 }))
    );

    const me = await fetchMe();
    expect(me).toEqual(VALID_ME);
  });

  it('returns null when /api/me fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Error', { status: 500 }))
    );

    const me = await fetchMe();
    expect(me).toBeNull();
  });
});
