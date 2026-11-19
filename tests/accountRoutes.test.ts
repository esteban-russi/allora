/** Tests for /api/account routes (merge and delete). */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountRouter } from '../src/server/accountRoutes';
import { InMemorySessionStore, initializeLearnerSession } from '../src/server/sessionStore';
import { InMemoryAccountStore } from '../src/server/accountStore';
import { InMemoryUsageStore, usageDay } from '../src/server/usageStore';
import { authenticateHttpUser, verifyIdToken } from '../src/server/auth';
import { attachAccount } from '../src/server/accountMiddleware';
import type { IdentityAdmin } from '../src/server/identityAdmin';

describe('POST /api/account/merge', () => {
  let sessionStore: InMemorySessionStore;
  let accountStore: InMemoryAccountStore;
  let usageStore: InMemoryUsageStore;
  let mockIdentity: IdentityAdmin;
  let mockRevenueCat: { getSubscriber: any; deleteSubscriber: any };
  let clock: number;
  let app: express.Express;

  beforeEach(() => {
    clock = Date.parse('2026-11-18T10:00:00.000Z');
    sessionStore = new InMemorySessionStore(undefined, () => clock);
    accountStore = new InMemoryAccountStore(() => clock);
    usageStore = new InMemoryUsageStore();
    mockIdentity = {
      deleteUser: vi.fn().mockResolvedValue(undefined),
      userExists: vi.fn().mockResolvedValue(true)
    };
    mockRevenueCat = {
      getSubscriber: vi.fn(),
      deleteSubscriber: vi.fn().mockResolvedValue(undefined)
    };

    app = express();
    app.use(express.json());
    app.use(authenticateHttpUser());
    app.use(attachAccount(accountStore));
    app.use(
      '/api/account',
      createAccountRouter({
        sessions: sessionStore,
        accounts: accountStore,
        usage: usageStore,
        identity: mockIdentity,
        revenueCat: mockRevenueCat,
        verifyToken: verifyIdToken,
        now: () => clock
      })
    );
  });

  it('transfers sessions and returns moved when target account has no active session', async () => {
    const guestSession = initializeLearnerSession({ userId: 'anon-g' });
    await sessionStore.createOrUpdateSession(guestSession);

    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:anon-g' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: 'moved' });

    const transferred = await sessionStore.getSession(guestSession.sessionId, 'u1');
    expect(transferred).not.toBeNull();
    expect(transferred?.userId).toBe('u1');
    expect(await sessionStore.getSession(guestSession.sessionId, 'anon-g')).toBeNull();
  });

  it('discards guest sessions when target account already has an active session', async () => {
    const accountSession = initializeLearnerSession({ userId: 'u1' });
    const guestSession = initializeLearnerSession({ userId: 'anon-g' });
    await sessionStore.createOrUpdateSession(accountSession);
    await sessionStore.createOrUpdateSession(guestSession);

    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:anon-g' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: 'discarded' });

    expect(await sessionStore.getSession(guestSession.sessionId, 'anon-g')).toBeNull();
    expect(await sessionStore.getSession(guestSession.sessionId, 'u1')).toBeNull();
    expect(await sessionStore.getSession(accountSession.sessionId, 'u1')).not.toBeNull();
  });

  it('adds guest usage to target user and deletes guest usage', async () => {
    const day = usageDay(clock);
    await usageStore.add('anon-g', day, 'chatMessages', 3);
    await usageStore.add('anon-g', day, 'voiceSeconds', 10);
    await usageStore.add('anon-g', day, 'helperRequests', 2);

    await usageStore.add('u1', day, 'chatMessages', 2);

    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:anon-g' });

    expect(res.status).toBe(200);

    const targetUsage = await usageStore.getUsage('u1', day);
    expect(targetUsage.chatMessages).toBe(5);
    expect(targetUsage.voiceSeconds).toBe(10);
    expect(targetUsage.helperRequests).toBe(2);

    const guestUsage = await usageStore.getUsage('anon-g', day);
    expect(guestUsage.chatMessages).toBe(0);
    expect(guestUsage.voiceSeconds).toBe(0);
    expect(guestUsage.helperRequests).toBe(0);
  });

  it('deletes guest account record and calls identity.deleteUser', async () => {
    await accountStore.upsertFromAuth({ userId: 'anon-g', isAnonymous: true });

    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:anon-g' });

    expect(res.status).toBe(200);
    expect(await accountStore.getAccount('anon-g')).toBeNull();
    expect(mockIdentity.deleteUser).toHaveBeenCalledWith('anon-g');
  });

  it('rejects guest token of a non-anonymous user with 400 INVALID_GUEST_TOKEN', async () => {
    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:registered-user' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_GUEST_TOKEN' });
  });

  it('rejects when guest token belongs to the same user with 400 INVALID_GUEST_TOKEN', async () => {
    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:anon-g')
      .send({ guestIdToken: 'dev-token:anon-g' });
    expect(res.status).toBe(403);

    const resSame = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:u1')
      .send({ guestIdToken: 'dev-token:u1' });

    expect(resSame.status).toBe(400);
    expect(resSame.body).toEqual({ code: 'INVALID_GUEST_TOKEN' });
  });

  it('rejects anonymous caller with 403 SIGN_IN_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/account/merge')
      .set('Authorization', 'Bearer dev-token:anon-caller')
      .send({ guestIdToken: 'dev-token:anon-g' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'SIGN_IN_REQUIRED' });
  });
});

describe('DELETE /api/account', () => {
  let sessionStore: InMemorySessionStore;
  let accountStore: InMemoryAccountStore;
  let usageStore: InMemoryUsageStore;
  let mockIdentity: IdentityAdmin;
  let mockRevenueCat: { getSubscriber: any; deleteSubscriber: any };
  let clock: number;
  let app: express.Express;

  beforeEach(() => {
    clock = Date.parse('2026-11-18T10:00:00.000Z');
    sessionStore = new InMemorySessionStore(undefined, () => clock);
    accountStore = new InMemoryAccountStore(() => clock);
    usageStore = new InMemoryUsageStore();
    mockIdentity = {
      deleteUser: vi.fn().mockResolvedValue(undefined),
      userExists: vi.fn().mockResolvedValue(true)
    };
    mockRevenueCat = {
      getSubscriber: vi.fn(),
      deleteSubscriber: vi.fn().mockResolvedValue(undefined)
    };

    app = express();
    app.use(express.json());
    app.use(authenticateHttpUser());
    app.use(attachAccount(accountStore));
    app.use(
      '/api/account',
      createAccountRouter({
        sessions: sessionStore,
        accounts: accountStore,
        usage: usageStore,
        identity: mockIdentity,
        revenueCat: mockRevenueCat,
        verifyToken: verifyIdToken,
        now: () => clock
      })
    );
  });

  it('deletes sessions, usage, account and identity, returning hadActiveSubscription: false for free', async () => {
    const day = usageDay(clock);
    const session = initializeLearnerSession({ userId: 'u1' });
    await sessionStore.createOrUpdateSession(session);
    await usageStore.add('u1', day, 'chatMessages', 5);
    await accountStore.upsertFromAuth({ userId: 'u1', isAnonymous: false });

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer dev-token:u1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'deleted', hadActiveSubscription: false });

    expect(await sessionStore.getSession(session.sessionId, 'u1')).toBeNull();
    const usage = await usageStore.getUsage('u1', day);
    expect(usage.chatMessages).toBe(0);
    expect(await accountStore.getAccount('u1')).toBeNull();
    expect(mockIdentity.deleteUser).toHaveBeenCalledWith('u1');
    expect(mockRevenueCat.deleteSubscriber).toHaveBeenCalledWith('u1');
  });

  it('completes account deletion even if deleteSubscriber throws', async () => {
    mockRevenueCat.deleteSubscriber.mockRejectedValueOnce(new Error('RevenueCat unreachable'));
    await accountStore.upsertFromAuth({ userId: 'u-rc-fail', isAnonymous: false });

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer dev-token:u-rc-fail');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'deleted', hadActiveSubscription: false });
    expect(await accountStore.getAccount('u-rc-fail')).toBeNull();
    expect(mockRevenueCat.deleteSubscriber).toHaveBeenCalledWith('u-rc-fail');
  });

  it('returns hadActiveSubscription: true when deleting a premium account', async () => {
    await accountStore.upsertFromAuth({ userId: 'u-premium', isAnonymous: false });
    await accountStore.setSubscription('u-premium', {
      status: 'active',
      productId: 'parliamo_pro_annual',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2027-01-01T00:00:00.000Z',
      willRenew: true,
      updatedAt: '2026-11-18T00:00:00.000Z'
    });

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer dev-token:u-premium');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'deleted', hadActiveSubscription: true });
    expect(await accountStore.getAccount('u-premium')).toBeNull();
  });

  it('works for guest users as well', async () => {
    const day = usageDay(clock);
    const guestSession = initializeLearnerSession({ userId: 'anon-g' });
    await sessionStore.createOrUpdateSession(guestSession);
    await usageStore.add('anon-g', day, 'chatMessages', 2);
    await accountStore.upsertFromAuth({ userId: 'anon-g', isAnonymous: true });

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer dev-token:anon-g');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'deleted', hadActiveSubscription: false });
    expect(await sessionStore.getSession(guestSession.sessionId, 'anon-g')).toBeNull();
    expect(await accountStore.getAccount('anon-g')).toBeNull();
    expect(mockIdentity.deleteUser).toHaveBeenCalledWith('anon-g');
  });

  it('returns 500 when identity.deleteUser fails so the user can retry', async () => {
    await accountStore.upsertFromAuth({ userId: 'u-fail', isAnonymous: false });
    (mockIdentity.deleteUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Firebase service unavailable'));

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer dev-token:u-fail');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Could not delete user identity' });
  });
});
