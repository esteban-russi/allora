/** Tests for POST /api/report validation, storage, logging, and server wiring. */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app as serverApp } from '../server';
import { authenticateHttpUser } from '../src/platform/server/auth';
import { createReportRouter } from '../src/platform/server/reportRoutes';
import { InMemoryReportStore } from '../src/platform/server/reportStore';

describe('POST /api/report', () => {
  let reportStore: InMemoryReportStore;
  let clock: number;
  let app: express.Express;

  beforeEach(() => {
    clock = Date.parse('2026-11-19T12:00:00.000Z');
    reportStore = new InMemoryReportStore();

    app = express();
    app.use(express.json());
    app.use(authenticateHttpUser());
    app.use('/api/report', createReportRouter({ reports: reportStore, now: () => clock }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores all report fields and logs only reason and source', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/report')
      .set('Authorization', 'Bearer dev-token:u-report')
      .send({
        text: 'Questo è un messaggio segnalato.',
        reason: 'harmful',
        comment: 'Inappropriate tone',
        source: 'chat',
        sessionId: 'sess_123'
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });

    const stored = reportStore.getUserReports('u-report');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      userId: 'u-report',
      sessionId: 'sess_123',
      source: 'chat',
      text: 'Questo è un messaggio segnalato.',
      reason: 'harmful',
      comment: 'Inappropriate tone',
      createdAt: '2026-11-19T12:00:00.000Z'
    });
    expect(stored[0].id).toMatch(/^rep_/);

    expect(warnSpy).toHaveBeenCalledWith('[Report] New content report', {
      reason: 'harmful',
      source: 'chat'
    });
  });

  it('defaults optional comment and sessionId and works for guests', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/report')
      .set('Authorization', 'Bearer dev-token:anon-report')
      .send({
        text: 'Risposta confusa',
        reason: 'inaccurate',
        source: 'call'
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });

    const stored = reportStore.getUserReports('anon-report');
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBeNull();
    expect(stored[0].comment).toBe('');
    expect(stored[0].source).toBe('call');
  });

  it.each([
    { reason: 'harmful', source: 'chat' },
    { text: '', reason: 'harmful', source: 'chat' },
    { text: '   ', reason: 'harmful', source: 'chat' },
    { text: 'a'.repeat(2001), reason: 'harmful', source: 'chat' },
    { text: 123, reason: 'harmful', source: 'chat' },
    { text: 'ok', reason: 'spam', source: 'chat' },
    { text: 'ok', reason: 'other', source: 'email' },
    { text: 'ok', reason: 'other', source: 'chat', comment: 'c'.repeat(501) },
    { text: 'ok', reason: 'other', source: 'chat', comment: 42 },
    { text: 'ok', reason: 'other', source: 'chat', sessionId: 's'.repeat(101) },
    { text: 'ok', reason: 'other', source: 'chat', sessionId: 99 }
  ])('returns 400 for invalid body %j', async (body) => {
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', 'Bearer dev-token:u-bad')
      .send(body);

    expect(res.status).toBe(400);
    expect(reportStore.getUserReports('u-bad')).toHaveLength(0);
  });

  it('is mounted behind auth middleware on the main Express app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(serverApp)
      .post('/api/report')
      .set('x-dev-user-id', 'u-server-report')
      .send({
        text: 'Messaggio di prova',
        reason: 'other',
        source: 'chat'
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });
  });
});
