import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../server';

describe('/api/session endpoints', () => {
  it('returns 404 when no session exists for the user', async () => {
    const res = await request(app)
      .get('/api/session')
      .set('x-dev-user-id', 'fresh-user-without-session');
    expect(res.status).toBe(404);
  });

  it('creates and persists a learner session via POST /api/session', async () => {
    const res = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'user-session-test')
      .send({
        learnerName: 'Enzo',
        learnerLevel: 'B2',
        grammarStrictness: 'strict'
      });

    expect(res.status).toBe(200);
    expect(res.body.learnerName).toBe('Enzo');
    expect(res.body.learnerLevel).toBe('B2');
    expect(res.body.sessionId).toBeDefined();

    const sessionId = res.body.sessionId;

    // Fetch the active session
    const getRes = await request(app)
      .get('/api/session')
      .set('x-dev-user-id', 'user-session-test');
    expect(getRes.status).toBe(200);
    expect(getRes.body.sessionId).toBe(sessionId);
    expect(getRes.body).not.toHaveProperty('userId');
    expect(getRes.body).not.toHaveProperty('upstreamResumptionHandle');
    expect(res.body).not.toHaveProperty('upstreamResumptionHandle');

    // Delete the specific session
    const delRes = await request(app)
      .delete(`/api/session/${sessionId}`)
      .set('x-dev-user-id', 'user-session-test');
    expect(delRes.status).toBe(200);
    expect(delRes.body.status).toBe('deleted');

    // Confirm session is gone
    const checkRes = await request(app)
      .get('/api/session')
      .set('x-dev-user-id', 'user-session-test');
    expect(checkRes.status).toBe(404);
  });

  it('refuses to write to a session ID owned by another user', async () => {
    const victim = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'session-victim')
      .send({ learnerName: 'Lucia', learnerLevel: 'B1' });

    const attack = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'session-attacker')
      .send({ sessionId: victim.body.sessionId, learnerName: 'Mallory' });
    expect(attack.status).toBe(404);

    const victimView = await request(app).get('/api/session').set('x-dev-user-id', 'session-victim');
    expect(victimView.body.sessionId).toBe(victim.body.sessionId);
    expect(victimView.body.learnerName).toBe('Lucia');
  });

  it('updates the settings and saved phrases of an existing session', async () => {
    const created = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'settings-user')
      .send({ learnerName: 'Enzo', learnerLevel: 'A2' });

    const res = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'settings-user')
      .send({
        sessionId: created.body.sessionId,
        learnerName: 'Enzo',
        learnerLevel: 'B1',
        savedPhrases: [{ id: 'p1', it: 'Ciao', en: 'Hi' }]
      });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(created.body.sessionId);
    expect(res.body.learnerLevel).toBe('B1');
    expect(res.body.progress.savedPhrases).toEqual([{ id: 'p1', it: 'Ciao', en: 'Hi' }]);
  });

  it('returns 404 when updating an unknown session ID instead of creating it', async () => {
    const res = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'session-guesser')
      .send({ sessionId: 'sess_chosen-by-client', learnerName: 'Pia' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['an unknown persona', { personaId: 'nobody' }],
    ['an unknown level', { learnerLevel: 'Z9' }],
    ['an unknown grammar strictness', { grammarStrictness: 'lenient' }],
    ['malformed saved phrases', { savedPhrases: [{ id: 1 }] }],
    ['a non-string sessionId', { sessionId: 123 }],
    ['an unknown topic', { topic: 'space-travel' }]
  ])('rejects POST /api/session with %s', async (_label, body) => {
    const res = await request(app).post('/api/session').set('x-dev-user-id', 'validation-user').send(body);
    expect(res.status).toBe(400);
  });

  it('creates a session with a valid topic and returns title and topic', async () => {
    const res = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'user-topic-test')
      .send({
        personaId: 'emmanuele',
        topic: 'cafe'
      });

    expect(res.status).toBe(200);
    expect(res.body.topic).toBe('cafe');
    expect(res.body.title).toBe('Ordering at a café');
  });

  it('lists user sessions with GET /api/session/list and returns single session via GET /api/session/:sessionId', async () => {
    // Fresh user has empty list
    const emptyList = await request(app)
      .get('/api/session/list')
      .set('x-dev-user-id', 'user-multi-session');
    expect(emptyList.status).toBe(200);
    expect(emptyList.body).toEqual([]);

    // Create session 1: market
    const sess1 = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'user-multi-session')
      .send({ personaId: 'emmanuele', topic: 'market' });
    expect(sess1.status).toBe(200);

    // Ensure distinct millisecond timestamp for newest-first order
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Create session 2: free chat
    const sess2 = await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'user-multi-session')
      .send({ personaId: 'emmanuele', topic: 'free_chat' });
    expect(sess2.status).toBe(200);

    // List sessions: newest first
    const listRes = await request(app)
      .get('/api/session/list')
      .set('x-dev-user-id', 'user-multi-session');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);
    expect(listRes.body[0].sessionId).toBe(sess2.body.sessionId);
    expect(listRes.body[0].topic).toBe('free_chat');
    expect(listRes.body[1].sessionId).toBe(sess1.body.sessionId);
    expect(listRes.body[1].topic).toBe('market');
    expect(listRes.body[1].title).toBe('At the market');

    // Never return other users' sessions
    const otherUserList = await request(app)
      .get('/api/session/list')
      .set('x-dev-user-id', 'user-other-observer');
    expect(otherUserList.body).toEqual([]);

    // GET /api/session/:sessionId (owner view)
    const detailRes = await request(app)
      .get(`/api/session/${sess1.body.sessionId}`)
      .set('x-dev-user-id', 'user-multi-session');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.sessionId).toBe(sess1.body.sessionId);
    expect(detailRes.body.topic).toBe('market');

    // GET /api/session/:sessionId for another user -> 404
    const forbiddenDetail = await request(app)
      .get(`/api/session/${sess1.body.sessionId}`)
      .set('x-dev-user-id', 'user-other-observer');
    expect(forbiddenDetail.status).toBe(404);

    // GET /api/session/:sessionId with unknown ID -> 404
    const unknownDetail = await request(app)
      .get('/api/session/non-existent-sess-id')
      .set('x-dev-user-id', 'user-multi-session');
    expect(unknownDetail.status).toBe(404);
  });

  it('supports GDPR deletion of all user sessions via DELETE /api/session', async () => {
    await request(app)
      .post('/api/session')
      .set('x-dev-user-id', 'gdpr-route-user')
      .send({ learnerName: 'Sara' });

    const delAllRes = await request(app)
      .delete('/api/session')
      .set('x-dev-user-id', 'gdpr-route-user');

    expect(delAllRes.status).toBe(200);
    expect(delAllRes.body.status).toBe('all_data_deleted');
    expect(delAllRes.body.sessionsDeleted).toBeGreaterThanOrEqual(1);
  });
});
