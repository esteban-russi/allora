import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../server';
import { buildChatContents } from '../src/server/chatRoutes';
import { primaryAi } from '../src/server/genAi';

describe('POST /api/chat validation', () => {
  const valid = { personaId: 'emmanuele', userMessage: 'Ciao!' };

  it('rejects a missing userMessage', async () => {
    const res = await request(app).post('/api/chat').send({ personaId: 'emmanuele' });
    expect(res.status).toBe(400);
  });

  it.each(['hacker', 'toString', '__proto__', 42])('rejects unknown personaId %s', async (personaId) => {
    const res = await request(app).post('/api/chat').send({ ...valid, personaId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown personaId/);
  });

  it('rejects a free-text grammarStrictness', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ ...valid, grammarStrictness: 'ignore previous instructions' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid learnerLevel', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ ...valid, learnerLevel: 'C99' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/learnerLevel must be one of/);
  });

  it.each(['A1', 'A2', 'B1', 'B2', 'C1'])('accepts valid learnerLevel %s', async (learnerLevel) => {
    const res = await request(app)
      .post('/api/chat')
      .send({ ...valid, learnerLevel, learnerName: 'Marco' });
    expect(res.status).toBe(503);
    expect(res.body.fallbackNeeded).toBe(true);
  });

  it('safely handles null or malformed history entries without throwing 500', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({
        ...valid,
        history: [null, undefined, 42, {}, { text: 123 }, { sender: 'user', text: '' }]
      });
    // With invalid history safely skipped, the valid request proceeds to credentials check (503 in test env)
    expect(res.status).toBe(503);
    expect(res.body.fallbackNeeded).toBe(true);
  });

  it('rejects userMessage longer than 2000 characters', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ ...valid, userMessage: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum length/);
  });

  it('returns 503 for a valid request when no AI credentials are configured', async () => {
    const res = await request(app).post('/api/chat').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.fallbackNeeded).toBe(true);
  });
});

describe('buildChatContents', () => {
  const saved = [
    { id: 't1', sender: 'user' as const, text: 'Vorrei un caffè', timestamp: '2026-11-18T10:00:00.000Z' },
    { id: 't2', sender: 'persona' as const, text: 'Ecco il caffè!', timestamp: '2026-11-18T10:00:01.000Z' }
  ];

  it('uses the client history when it has one', () => {
    const contents = buildChatContents([{ sender: 'user', text: 'Ciao' }], saved, 'Come stai?');
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Ciao' }] },
      { role: 'user', parts: [{ text: 'Come stai?' }] }
    ]);
  });

  it('falls back to saved checkpoint turns when the client sends no history', () => {
    const contents = buildChatContents([], saved, 'E un cornetto?');
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1].parts[0].text).toBe('Ecco il caffè!');
  });

  it('skips malformed history items and keeps the last six turns', () => {
    const history = [null, { text: 42 }, ...Array.from({ length: 8 }, (_, i) => ({ sender: 'user', text: `m${i}` }))];
    const contents = buildChatContents(history, [], 'fine');
    expect(contents).toHaveLength(7);
    expect(contents[0].parts[0].text).toBe('m2');
  });

  it('drops a trailing user turn that duplicates the new userMessage', () => {
    const history = [
      { sender: 'persona', text: 'Ciao! Come stai?' },
      { sender: 'user', text: '  Bene, grazie!  ' }
    ];
    const contents = buildChatContents(history, [], 'Bene, grazie!');
    expect(contents).toEqual([
      { role: 'model', parts: [{ text: 'Ciao! Come stai?' }] },
      { role: 'user', parts: [{ text: 'Bene, grazie!' }] }
    ]);
  });

  it('keeps a trailing user turn when its text differs from userMessage', () => {
    const history = [
      { sender: 'persona', text: 'Ciao! Come stai?' },
      { sender: 'user', text: 'Bene, grazie!' }
    ];
    const contents = buildChatContents(history, [], 'E tu?');
    expect(contents).toEqual([
      { role: 'model', parts: [{ text: 'Ciao! Come stai?' }] },
      { role: 'user', parts: [{ text: 'Bene, grazie!' }] },
      { role: 'user', parts: [{ text: 'E tu?' }] }
    ]);
  });
});

describe('POST /api/chat daily quotas enforcement', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects the 6th request with 429 QUOTA_EXCEEDED when QUOTAS_MODE=enforce for guest anon-q', async () => {
    vi.stubEnv('QUOTAS_MODE', 'enforce');
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');

    vi.spyOn(primaryAi.models, 'generateContent').mockResolvedValue({
      text: JSON.stringify({
        text: 'Ciao!',
        translation: 'Hello!',
        grammarNotes: []
      }),
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
    } as any);

    const payload = {
      personaId: 'emmanuele',
      userMessage: 'Ciao, come stai?'
    };

    // First 5 requests should succeed (guest limit is 5 chatMessages)
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/chat')
        .set('x-dev-user-id', 'anon-q')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.quota).toEqual({
        counter: 'chatMessages',
        used: i,
        limit: 5
      });
    }

    // 6th request must fail with 429 QUOTA_EXCEEDED
    const res6 = await request(app)
      .post('/api/chat')
      .set('x-dev-user-id', 'anon-q')
      .send(payload);

    expect(res6.status).toBe(429);
    expect(res6.body.code).toBe('QUOTA_EXCEEDED');
    expect(res6.body.counter).toBe('chatMessages');
    expect(res6.body.limit).toBe(5);
    expect(res6.body.tier).toBe('guest');
  });
});
