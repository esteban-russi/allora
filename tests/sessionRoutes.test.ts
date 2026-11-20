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
    ['a non-string sessionId', { sessionId: 123 }]
  ])('rejects POST /api/session with %s', async (_label, body) => {
    const res = await request(app).post('/api/session').set('x-dev-user-id', 'validation-user').send(body);
    expect(res.status).toBe(400);
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
