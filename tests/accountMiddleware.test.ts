/** Tests for account middleware attaching Account to requests with in-memory caching. */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachAccount,
  invalidateAccountCache
} from '../src/server/accountMiddleware';
import { InMemoryAccountStore, type AccountStore } from '../src/server/accountStore';
import type { IdentityAdmin } from '../src/server/identityAdmin';

describe('accountMiddleware', () => {
  let clock = Date.parse('2026-11-18T10:00:00.000Z');
  let store: InMemoryAccountStore;

  beforeEach(() => {
    clock = Date.parse('2026-11-18T10:00:00.000Z');
    store = new InMemoryAccountStore(() => clock);
    invalidateAccountCache('u1');
    invalidateAccountCache('anon-1');
  });

  function createTestApp(
    storeToUse: AccountStore,
    nowFn = () => clock,
    identity?: IdentityAdmin
  ) {
    const app = express();
    // Simulate auth middleware setting req.user
    app.use((req, _res, next) => {
      const authHeader = req.headers['x-test-user'];
      if (typeof authHeader === 'string') {
        const [userId, isAnonStr, email] = authHeader.split(':');
        req.user = {
          userId,
          isAnonymous: isAnonStr === 'true',
          email: email || undefined,
          authProvider: isAnonStr === 'true' ? 'firebase' : 'google'
        };
      }
      next();
    });

    app.use(attachAccount(storeToUse, { cacheMs: 60_000, now: nowFn, identity }));

    app.get('/test', (req, res) => {
      res.json({ account: req.account });
    });

    return app;
  }

  it('creates an account record on first request and attaches it', async () => {
    const app = createTestApp(store);

    const res = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');

    expect(res.status).toBe(200);
    expect(res.body.account.account.userId).toBe('u1');
    expect(res.body.account.tier).toBe('free');
    expect(res.body.account.limits.chatMessages).toBe(15);

    const stored = await store.getAccount('u1');
    expect(stored?.userId).toBe('u1');
  });

  it('uses cache on second request within 60s and does not call store', async () => {
    const upsertSpy = vi.spyOn(store, 'upsertFromAuth');
    const app = createTestApp(store);

    // First request
    await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // Second request 30 seconds later
    clock += 30_000;
    const res2 = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');

    expect(res2.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledTimes(1); // Not called again!
  });

  it('bypasses cache when anonymous status changes from true to false', async () => {
    const upsertSpy = vi.spyOn(store, 'upsertFromAuth');
    const app = createTestApp(store);

    // Request as guest
    await request(app)
      .get('/test')
      .set('x-test-user', 'u1:true');
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // Request 10 seconds later as signed-in
    clock += 10_000;
    const res2 = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');

    expect(res2.status).toBe(200);
    expect(res2.body.account.tier).toBe('free');
    expect(upsertSpy).toHaveBeenCalledTimes(2); // Store called because isAnonymous changed!
  });

  it('returns 503 ACCOUNT_UNAVAILABLE when store throws', async () => {
    const failingStore: AccountStore = {
      upsertFromAuth: vi.fn().mockRejectedValue(new Error('Database unavailable')),
      getAccount: vi.fn(),
      setSubscription: vi.fn(),
      deleteAccount: vi.fn()
    };

    const app = createTestApp(failingStore);

    const res = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: 'Account service unavailable',
      code: 'ACCOUNT_UNAVAILABLE'
    });
  });

  it('returns 401 ACCOUNT_DELETED and does not recreate a deleted account', async () => {
    const identity: IdentityAdmin = {
      deleteUser: vi.fn(),
      userExists: vi.fn().mockResolvedValue(false)
    };
    const app = createTestApp(store, () => clock, identity);

    const res = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_DELETED');
    expect(identity.userExists).toHaveBeenCalledWith('u1');
    expect(await store.getAccount('u1')).toBeNull();
  });

  it('skips the identity lookup when the account record exists', async () => {
    await store.upsertFromAuth({ userId: 'u1', email: 'u1@example.com', isAnonymous: false });
    const identity: IdentityAdmin = {
      deleteUser: vi.fn(),
      userExists: vi.fn().mockResolvedValue(false)
    };
    const app = createTestApp(store, () => clock, identity);

    const res = await request(app)
      .get('/test')
      .set('x-test-user', 'u1:false:u1@example.com');

    expect(res.status).toBe(200);
    expect(identity.userExists).not.toHaveBeenCalled();
  });
});
