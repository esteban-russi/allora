import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../server';

describe('/api/habits endpoints', () => {
  it('returns default habit summary for a fresh user via GET /api/habits', async () => {
    const res = await request(app)
      .get('/api/habits')
      .set('x-dev-user-id', 'habit-user-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      goal: 10,
      todayCount: 0,
      goalMetToday: false,
      currentStreak: 0,
      longestStreak: 0,
      timeZone: 'UTC',
      reminder: {
        enabled: false,
        time: '19:00'
      }
    });
    expect(Array.isArray(res.body.last7Days)).toBe(true);
    expect(res.body.last7Days).toHaveLength(7);
  });

  it('updates habit settings via PUT /api/habits/settings and persists them', async () => {
    const updateRes = await request(app)
      .put('/api/habits/settings')
      .set('x-dev-user-id', 'habit-user-2')
      .send({
        goal: 20,
        timeZone: 'Europe/Rome',
        reminder: {
          enabled: true,
          time: '20:30'
        }
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.goal).toBe(20);
    expect(updateRes.body.timeZone).toBe('Europe/Rome');
    expect(updateRes.body.reminder).toEqual({
      enabled: true,
      time: '20:30'
    });

    const getRes = await request(app)
      .get('/api/habits')
      .set('x-dev-user-id', 'habit-user-2');

    expect(getRes.status).toBe(200);
    expect(getRes.body.goal).toBe(20);
    expect(getRes.body.timeZone).toBe('Europe/Rome');
    expect(getRes.body.reminder).toEqual({
      enabled: true,
      time: '20:30'
    });
  });

  it('falls back to UTC when invalid timeZone is provided', async () => {
    const res = await request(app)
      .put('/api/habits/settings')
      .set('x-dev-user-id', 'habit-user-tz')
      .send({
        timeZone: 'Invalid/Zone_Name_123'
      });

    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe('UTC');
  });

  it('rejects invalid goal values', async () => {
    const res = await request(app)
      .put('/api/habits/settings')
      .set('x-dev-user-id', 'habit-user-bad-goal')
      .send({
        goal: 15
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/goal must be one of/);
  });

  it('rejects malformed reminder times', async () => {
    const res = await request(app)
      .put('/api/habits/settings')
      .set('x-dev-user-id', 'habit-user-bad-rem')
      .send({
        reminder: {
          enabled: true,
          time: '25:99'
        }
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reminder\.time must be in 24h format/);
  });

  it('keeps data isolated between different users', async () => {
    await request(app)
      .put('/api/habits/settings')
      .set('x-dev-user-id', 'habit-user-a')
      .send({ goal: 5 });

    const resA = await request(app)
      .get('/api/habits')
      .set('x-dev-user-id', 'habit-user-a');
    expect(resA.body.goal).toBe(5);

    const resB = await request(app)
      .get('/api/habits')
      .set('x-dev-user-id', 'habit-user-b');
    expect(resB.body.goal).toBe(10);
  });
});
