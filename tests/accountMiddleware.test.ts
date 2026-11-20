/** Tests for account middleware attaching Account to requests with in-memory caching. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachAccount,
  invalidateAccountCache
} from '../src/platform/server/accountMiddleware';
import { InMemoryAccountStore, type AccountStore } from '../src/platform/server/accountStore';
import type { IdentityAdmin } from '../src/platform/server/identityAdmin';

async function executeTest(
  storeToUse: AccountStore,
  header: string,
  nowFn: () => number,
  identity?: IdentityAdmin
) {
  const middleware = attachAccount(storeToUse, { cacheMs: 60_000, now: nowFn, identity });
  const [userId, isAnonStr, email, authProvider] = header.split(':');
  const req: any = {
    user: {
      userId,
      isAnonymous: isAnonStr === 'true',
      email: email || undefined,
      authProvider: (authProvider || (isAnonStr === 'true' ? 'firebase' : 'google')) as any
    }
  };
  let statusCode = 200;
  let bodyData: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      bodyData = data;
      return res;
    }
  };
  await middleware(req, res, () => {
    bodyData = { account: req.account };
  });
  return { status: statusCode, body: bodyData };
}

function request(context: { store: AccountStore; nowFn: () => number; identity?: IdentityAdmin }) {
  return {
    get: (_url: string) => ({
      set: (_header: string, val: string) => executeTest(context.store, val, context.nowFn, context.identity)
    })
  };
}

describe('accountMiddleware', () => {
  let clock = Date.parse('2026-11-18T10:00:00.000Z');
  let store: InMemoryAccountStore;

  beforeEach(() => {
    clock = Date.parse('2026-11-18T10:00:00.000Z');
    store = new InMemoryAccountStore(() => clock);
    invalidateAccountCache('u1');
    invalidateAccountCache('anon-1');
    invalidateAccountCache('dev-learner-default');
  });

  function createTestApp(
    storeToUse: AccountStore,
    nowFn = () => clock,
    identity?: IdentityAdmin
  ) {
    return { store: storeToUse, nowFn, identity };
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
      setConsent: vi.fn(),
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

  it('skips identity check for dev-auth users even when account does not exist yet', async () => {
    const identity: IdentityAdmin = {
      deleteUser: vi.fn(),
      userExists: vi.fn().mockResolvedValue(false)
    };
    const app = createTestApp(store, () => clock, identity);

    const res = await request(app)
      .get('/test')
      .set('x-test-user', 'dev-learner-default:false:dev@example.com:dev');

    expect(res.status).toBe(200);
    expect(res.body.account.account.userId).toBe('dev-learner-default');
    expect(identity.userExists).not.toHaveBeenCalled();
    const stored = await store.getAccount('dev-learner-default');
    expect(stored?.userId).toBe('dev-learner-default');
  });
});
