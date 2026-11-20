/** Tests for quota mode configuration and requireQuota Express middleware. */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { quotasMode, requireQuota } from '../src/platform/server/quota';
import { InMemoryUsageStore } from '../src/platform/server/usageStore';

describe('quotasMode', () => {
  it('defaults to off when unset', () => {
    expect(quotasMode({})).toBe('off');
  });

  it.each(['off', 'monitor', 'enforce'] as const)('accepts valid mode %s', (mode) => {
    expect(quotasMode({ QUOTAS_MODE: mode })).toBe(mode);
  });

  it('throws on invalid mode', () => {
    expect(() => quotasMode({ QUOTAS_MODE: 'strict' })).toThrow('QUOTAS_MODE must be');
  });
});

describe('requireQuota middleware', () => {
  let clock: number;
  let store: InMemoryUsageStore;

  beforeEach(() => {
    clock = Date.parse('2026-11-18T10:00:00.000Z');
    store = new InMemoryUsageStore();
  });

  function createTestApp(options: {
    mode: 'off' | 'monitor' | 'enforce';
    storeToUse?: InMemoryUsageStore;
    statusCodeToReturn?: number;
    limit?: number;
  }) {
    const app = express();
    const activeStore = options.storeToUse ?? store;

    // Fake auth & account middleware
    app.use((req, _res, next) => {
      req.user = {
        userId: 'u1',
        email: 'u1@example.com',
        isAnonymous: false,
        authProvider: 'google'
      };
      req.account = {
        account: {
          userId: 'u1',
          email: 'u1@example.com',
          isAnonymous: false,
          subscription: null,
          consent: null,
          createdAt: '2026-11-18T10:00:00.000Z',
          lastSeenAt: '2026-11-18T10:00:00.000Z'
        },
        tier: 'free',
        limits: {
          chatMessages: options.limit ?? 2,
          voiceSeconds: 300,
          helperRequests: 50
        }
      };
      next();
    });

    app.post(
      '/chat',
      requireQuota('chatMessages', {
        store: activeStore,
        mode: options.mode,
        now: () => clock
      }),
      (_req, res) => {
        if (options.statusCodeToReturn && options.statusCodeToReturn >= 400) {
          res.status(options.statusCodeToReturn).json({ error: 'Failed' });
          return;
        }
        res.json({ ok: true, quota: res.locals.quota });
      }
    );

    return app;
  }

  it('off mode does not consume quota and calls next', async () => {
    const app = createTestApp({ mode: 'off' });
    const res = await request(app).post('/chat');
    expect(res.status).toBe(200);
    const usage = await store.getUsage('u1', '2026-11-18');
    expect(usage.chatMessages).toBe(0);
  });

  it('enforce mode allows requests within limit and returns 429 when exceeded', async () => {
    const app = createTestApp({ mode: 'enforce', limit: 2 });

    // 1st request
    const res1 = await request(app).post('/chat');
    expect(res1.status).toBe(200);
    expect(res1.body.quota).toEqual({ counter: 'chatMessages', used: 1, limit: 2 });

    // 2nd request
    const res2 = await request(app).post('/chat');
    expect(res2.status).toBe(200);
    expect(res2.body.quota).toEqual({ counter: 'chatMessages', used: 2, limit: 2 });

    // 3rd request (exceeds limit 2)
    const res3 = await request(app).post('/chat');
    expect(res3.status).toBe(429);
    expect(res3.body).toEqual({
      error: 'Daily limit reached',
      code: 'QUOTA_EXCEEDED',
      counter: 'chatMessages',
      limit: 2,
      tier: 'free',
      resetsAt: '2026-11-19T00:00:00.000Z'
    });
  });

  it('monitor mode warns but does not block requests over limit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createTestApp({ mode: 'monitor', limit: 1 });

    // 1st request succeeds
    await request(app).post('/chat');
    // 2nd request over limit succeeds with 200 in monitor mode
    const res2 = await request(app).post('/chat');
    expect(res2.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Quota] over limit (monitor): tier=free counter=chatMessages')
    );
    warnSpy.mockRestore();
  });

  it('refunds consumed unit when handler finishes with >= 500', async () => {
    const app = createTestApp({ mode: 'enforce', statusCodeToReturn: 500, limit: 5 });

    await request(app).post('/chat');

    // Give asynchronous finish event listener a tick to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    const usage = await store.getUsage('u1', '2026-11-18');
    expect(usage.chatMessages).toBe(0); // 1 consumed, refunded to 0
  });

  it('refunds consumed unit when handler rejects the request with 400', async () => {
    const app = createTestApp({ mode: 'enforce', statusCodeToReturn: 400, limit: 5 });

    await request(app).post('/chat');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const usage = await store.getUsage('u1', '2026-11-18');
    expect(usage.chatMessages).toBe(0);
  });

  it('keeps consumed unit when handler succeeds', async () => {
    const app = createTestApp({ mode: 'enforce', statusCodeToReturn: 200, limit: 5 });

    await request(app).post('/chat');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const usage = await store.getUsage('u1', '2026-11-18');
    expect(usage.chatMessages).toBe(1);
  });

  it('fails open when store throws an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingStore = {
      ...store,
      tryConsume: vi.fn().mockRejectedValue(new Error('Firestore down'))
    };

    const app = createTestApp({ mode: 'enforce', storeToUse: failingStore as any });
    const res = await request(app).post('/chat');

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Quota] Store error, failing open:'),
      'Firestore down'
    );
    errorSpy.mockRestore();
  });
});
