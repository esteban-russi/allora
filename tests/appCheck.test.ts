/** Tests for Firebase App Check mode parsing, extraction, verifier, and middleware. */
import type { IncomingMessage } from 'http';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appCheckMode,
  createAppCheckVerifier,
  extractAppCheckToken,
  requireAppCheck,
  type AppCheckMode,
  type AppCheckVerifier
} from '../src/server/appCheck';
import { MetricsCollector } from '../src/server/metrics';

const mockGetApps = vi.fn(() => [] as unknown[]);
const mockInitializeApp = vi.fn((_options?: unknown) => ({ name: '[DEFAULT]' }));
vi.mock('firebase-admin/app', () => ({
  getApps: () => mockGetApps(),
  initializeApp: (options?: unknown) => mockInitializeApp(options)
}));

const mockVerifyToken = vi.fn();
vi.mock('firebase-admin/app-check', () => ({
  getAppCheck: vi.fn(() => ({
    verifyToken: mockVerifyToken
  }))
}));

function makeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('appCheckMode', () => {
  it('defaults to off when unset or blank', () => {
    expect(appCheckMode({})).toBe('off');
    expect(appCheckMode({ APP_CHECK_MODE: '   ' })).toBe('off');
  });

  it.each(['off', 'monitor', 'enforce'] as const)('accepts valid mode %s', (mode) => {
    expect(appCheckMode({ APP_CHECK_MODE: mode })).toBe(mode);
  });

  it('throws on invalid values', () => {
    expect(() => appCheckMode({ APP_CHECK_MODE: 'strict' })).toThrow('APP_CHECK_MODE must be');
  });
});

describe('extractAppCheckToken', () => {
  it('extracts and trims the x-firebase-appcheck header', () => {
    const req = makeReq({ 'x-firebase-appcheck': '  ac-token-123  ' });
    expect(extractAppCheckToken(req)).toBe('ac-token-123');
  });

  it('extracts the token after appcheck in sec-websocket-protocol', () => {
    const req = makeReq({ 'sec-websocket-protocol': 'auth, jwt-1, appcheck, ac-ws-456' });
    expect(extractAppCheckToken(req)).toBe('ac-ws-456');
  });

  it('prefers the HTTP header over sec-websocket-protocol when both are set', () => {
    const req = makeReq({
      'x-firebase-appcheck': 'from-header',
      'sec-websocket-protocol': 'appcheck, from-ws'
    });
    expect(extractAppCheckToken(req)).toBe('from-header');
  });

  it('returns null when header is blank and subprotocol lacks a value after appcheck', () => {
    expect(extractAppCheckToken(makeReq({}))).toBeNull();
    expect(extractAppCheckToken(makeReq({ 'x-firebase-appcheck': '   ' }))).toBeNull();
    expect(extractAppCheckToken(makeReq({ 'sec-websocket-protocol': 'auth, jwt-1' }))).toBeNull();
    expect(extractAppCheckToken(makeReq({ 'sec-websocket-protocol': 'appcheck' }))).toBeNull();
    expect(extractAppCheckToken(makeReq({ 'sec-websocket-protocol': 'appcheck, ' }))).toBeNull();
  });
});

describe('createAppCheckVerifier', () => {
  beforeEach(() => {
    mockGetApps.mockReset().mockReturnValue([]);
    mockInitializeApp.mockReset().mockReturnValue({ name: '[DEFAULT]' });
    mockVerifyToken.mockReset();
  });

  it('returns true when firebase-admin verifies the token', async () => {
    mockVerifyToken.mockResolvedValueOnce({ appId: 'app-1', token: {} });
    const verifier = createAppCheckVerifier({ GCP_PROJECT: 'test-proj' });

    await expect(verifier.verify('valid-token')).resolves.toBe(true);
    expect(mockInitializeApp).toHaveBeenCalledWith({ projectId: 'test-proj' });
    expect(mockVerifyToken).toHaveBeenCalledWith('valid-token');
  });

  it('returns false on any verification error', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid signature'));
    const verifier = createAppCheckVerifier({ GCP_PROJECT: 'test-proj' });

    await expect(verifier.verify('bad-token')).resolves.toBe(false);
  });

  it('returns false for an empty token without calling firebase-admin', async () => {
    const verifier = createAppCheckVerifier({ GCP_PROJECT: 'test-proj' });

    await expect(verifier.verify('')).resolves.toBe(false);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });
});

describe('requireAppCheck middleware', () => {
  let metrics: MetricsCollector;
  let verifySpy: ReturnType<typeof vi.fn<(token: string) => Promise<boolean>>>;
  let fakeVerifier: AppCheckVerifier;

  beforeEach(() => {
    metrics = new MetricsCollector();
    verifySpy = vi.fn(async (token: string) => token === 'good-token');
    fakeVerifier = { verify: verifySpy };
  });

  function createTestApp(mode: AppCheckMode) {
    const app = express();
    app.get(
      '/protected',
      requireAppCheck({ verifier: fakeVerifier, mode, metrics }),
      (_req, res) => {
        res.json({ ok: true });
      }
    );
    return app;
  }

  describe('mode = off', () => {
    it.each([
      ['valid', 'good-token'],
      ['invalid', 'bad-token'],
      ['missing', undefined]
    ])('allows %s requests without verifying or counting', async (_label, token) => {
      const app = createTestApp('off');
      const req = request(app).get('/protected');
      if (token) req.set('X-Firebase-AppCheck', token);

      const res = await req;
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(verifySpy).not.toHaveBeenCalled();
      expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 0, missing: 0 });
    });
  });

  describe('mode = monitor', () => {
    it('allows valid token and increments ok counter', async () => {
      const app = createTestApp('monitor');
      const res = await request(app).get('/protected').set('X-Firebase-AppCheck', 'good-token');

      expect(res.status).toBe(200);
      expect(verifySpy).toHaveBeenCalledWith('good-token');
      expect(metrics.getSummary().appCheck).toEqual({ ok: 1, failed: 0, missing: 0 });
    });

    it('allows invalid token, warns, and increments failed counter', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const app = createTestApp('monitor');
      const res = await request(app).get('/protected').set('X-Firebase-AppCheck', 'bad-token');

      expect(res.status).toBe(200);
      expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 1, missing: 0 });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AppCheck]'));
      warnSpy.mockRestore();
    });

    it('allows missing token, warns, and increments missing counter', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const app = createTestApp('monitor');
      const res = await request(app).get('/protected');

      expect(res.status).toBe(200);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 0, missing: 1 });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AppCheck]'));
      warnSpy.mockRestore();
    });
  });

  describe('mode = enforce', () => {
    it('allows valid token and increments ok counter', async () => {
      const app = createTestApp('enforce');
      const res = await request(app).get('/protected').set('X-Firebase-AppCheck', 'good-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(metrics.getSummary().appCheck).toEqual({ ok: 1, failed: 0, missing: 0 });
    });

    it('rejects invalid token with 401 APP_CHECK_REQUIRED and increments failed counter', async () => {
      const app = createTestApp('enforce');
      const res = await request(app).get('/protected').set('X-Firebase-AppCheck', 'bad-token');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'App verification failed',
        code: 'APP_CHECK_REQUIRED'
      });
      expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 1, missing: 0 });
    });

    it('rejects missing token with 401 APP_CHECK_REQUIRED and increments missing counter', async () => {
      const app = createTestApp('enforce');
      const res = await request(app).get('/protected');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'App verification failed',
        code: 'APP_CHECK_REQUIRED'
      });
      expect(verifySpy).not.toHaveBeenCalled();
      expect(metrics.getSummary().appCheck).toEqual({ ok: 0, failed: 0, missing: 1 });
    });
  });
});
