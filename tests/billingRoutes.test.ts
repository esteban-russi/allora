/** Tests for billing router endpoints. */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBillingRouter, createRevenueCatWebhookRouter } from '../src/server/billingRoutes';
import { InMemoryAccountStore } from '../src/server/accountStore';
import type { RevenueCatClient } from '../src/server/revenueCat';
import type { AuthenticatedUser } from '../src/server/auth';

describe('POST /api/billing/sync', () => {
  const nowMs = Date.parse('2026-11-19T12:00:00.000Z');

  function createApp(options: {
    user?: AuthenticatedUser;
    revenueCat?: RevenueCatClient | null;
    accounts?: InMemoryAccountStore;
  }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (options.user) {
        req.user = options.user;
      }
      next();
    });

    const accounts = options.accounts ?? new InMemoryAccountStore(() => nowMs);
    app.use('/api/billing', createBillingRouter({
      revenueCat: options.revenueCat,
      accounts,
      now: () => nowMs
    }));

    return { app, accounts };
  }

  it('returns 503 BILLING_UNAVAILABLE when revenueCat is not configured', async () => {
    const { app } = createApp({
      user: { userId: 'u1', email: 'user@example.com', isAnonymous: false, authProvider: 'firebase' },
      revenueCat: null
    });

    const res = await request(app).post('/api/billing/sync');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'BILLING_UNAVAILABLE' });
  });

  it('returns 403 SIGN_IN_REQUIRED when user is anonymous', async () => {
    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn(),
      deleteSubscriber: vi.fn()
    };
    const { app } = createApp({
      user: { userId: 'guest-1', isAnonymous: true, authProvider: 'firebase' },
      revenueCat: fakeClient
    });

    const res = await request(app).post('/api/billing/sync');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'SIGN_IN_REQUIRED' });
    expect(fakeClient.getSubscriber).not.toHaveBeenCalled();
  });

  it('returns 200 with tier and subscription when sync succeeds', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'u1@example.com', isAnonymous: false });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue({
        entitlements: {
          premium: {
            product_identifier: 'pro_monthly',
            expires_date: '2026-12-19T12:00:00.000Z'
          }
        },
        subscriptions: {
          pro_monthly: {
            store: 'web',
            period_type: 'normal'
          }
        }
      }),
      deleteSubscriber: vi.fn()
    };

    const { app } = createApp({
      user: { userId: 'u1', email: 'u1@example.com', isAnonymous: false, authProvider: 'firebase' },
      revenueCat: fakeClient,
      accounts
    });

    const res = await request(app).post('/api/billing/sync');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('premium');
    expect(res.body.subscription).not.toBeNull();
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.subscription.productId).toBe('pro_monthly');
  });

  it('returns 502 BILLING_UPSTREAM_ERROR when RevenueCat client throws', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'u1@example.com', isAnonymous: false });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockRejectedValue(new Error('Network error')),
      deleteSubscriber: vi.fn()
    };

    const { app } = createApp({
      user: { userId: 'u1', email: 'u1@example.com', isAnonymous: false, authProvider: 'firebase' },
      revenueCat: fakeClient,
      accounts
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/billing/sync');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: 'BILLING_UPSTREAM_ERROR' });
    expect(errorSpy).toHaveBeenCalledWith('[Billing] Subscription sync failed:', 'Network error');
    errorSpy.mockRestore();
  });
});

describe('POST /api/webhooks/revenuecat', () => {
  const nowMs = Date.parse('2026-11-19T12:00:00.000Z');
  const validSecret = 'test_webhook_secret_key_1234567890';

  function createWebhookApp(options: {
    revenueCat?: RevenueCatClient | null;
    accounts?: InMemoryAccountStore;
    webhookAuth?: string;
  }) {
    const app = express();
    app.use(express.json());
    const accounts = options.accounts ?? new InMemoryAccountStore(() => nowMs);
    app.use('/api/webhooks', createRevenueCatWebhookRouter({
      revenueCat: options.revenueCat,
      accounts,
      webhookAuth: options.webhookAuth,
      now: () => nowMs
    }));
    return { app, accounts };
  }

  it('returns 503 when webhook config is missing', async () => {
    const { app } = createWebhookApp({ revenueCat: null });
    const res = await request(app).post('/api/webhooks/revenuecat').send({});
    expect(res.status).toBe(503);
  });

  it('returns 401 when Authorization header is missing or wrong', async () => {
    const fakeClient: RevenueCatClient = { getSubscriber: vi.fn(), deleteSubscriber: vi.fn() };
    const { app } = createWebhookApp({ revenueCat: fakeClient, webhookAuth: validSecret });

    const missingRes = await request(app)
      .post('/api/webhooks/revenuecat')
      .send({ event: { type: 'TEST' } });
    expect(missingRes.status).toBe(401);

    const wrongRes = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', 'Bearer wrong_key')
      .send({ event: { type: 'TEST' } });
    expect(wrongRes.status).toBe(401);
  });

  it('returns 400 when body does not contain an event object', async () => {
    const fakeClient: RevenueCatClient = { getSubscriber: vi.fn(), deleteSubscriber: vi.fn() };
    const { app } = createWebhookApp({ revenueCat: fakeClient, webhookAuth: validSecret });

    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({ foo: 'bar' });
    expect(res.status).toBe(400);
  });

  it('returns 200 without syncing for TEST events', async () => {
    const fakeClient: RevenueCatClient = { getSubscriber: vi.fn(), deleteSubscriber: vi.fn() };
    const { app } = createWebhookApp({ revenueCat: fakeClient, webhookAuth: validSecret });

    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({ event: { type: 'TEST', id: 'evt_test' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeClient.getSubscriber).not.toHaveBeenCalled();
  });

  it('syncs subscriber and sets active subscription on INITIAL_PURCHASE', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'u1@example.com', isAnonymous: false });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue({
        entitlements: {
          premium: {
            product_identifier: 'pro_annual',
            expires_date: '2027-11-19T12:00:00.000Z'
          }
        },
        subscriptions: {
          pro_annual: { store: 'web', period_type: 'normal' }
        }
      }),
      deleteSubscriber: vi.fn()
    };

    const { app } = createWebhookApp({ revenueCat: fakeClient, accounts, webhookAuth: validSecret });

    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({
        event: {
          id: 'evt_purchase_1',
          type: 'INITIAL_PURCHASE',
          app_user_id: 'u1'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeClient.getSubscriber).toHaveBeenCalledWith('u1');

    const account = await accounts.getAccount('u1');
    expect(account?.subscription?.status).toBe('active');
    expect(account?.subscription?.productId).toBe('pro_annual');
  });

  it('syncs subscriber and sets expired subscription on EXPIRATION event', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'u1@example.com', isAnonymous: false });
    await accounts.setSubscription('u1', {
      status: 'active',
      productId: 'pro_monthly',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2026-11-10T00:00:00.000Z',
      willRenew: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue({
        entitlements: {
          premium: {
            product_identifier: 'pro_monthly',
            expires_date: '2026-11-10T00:00:00.000Z'
          }
        },
        subscriptions: {
          pro_monthly: { store: 'web', period_type: 'normal' }
        }
      }),
      deleteSubscriber: vi.fn()
    };

    const { app } = createWebhookApp({ revenueCat: fakeClient, accounts, webhookAuth: validSecret });

    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({
        event: {
          id: 'evt_exp_1',
          type: 'EXPIRATION',
          app_user_id: 'u1'
        }
      });

    expect(res.status).toBe(200);
    const account = await accounts.getAccount('u1');
    expect(account?.subscription?.status).toBe('expired');
  });

  it('syncs both users on TRANSFER event', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'from_user', email: 'from@example.com', isAnonymous: false });
    await accounts.upsertFromAuth({ userId: 'to_user', email: 'to@example.com', isAnonymous: false });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockImplementation(async (userId: string) => {
        if (userId === 'to_user') {
          return {
            entitlements: {
              premium: { product_identifier: 'pro_monthly', expires_date: '2026-12-19T12:00:00.000Z' }
            },
            subscriptions: { pro_monthly: { store: 'web', period_type: 'normal' } }
          };
        }
        return { entitlements: {} };
      }),
      deleteSubscriber: vi.fn()
    };

    const { app } = createWebhookApp({ revenueCat: fakeClient, accounts, webhookAuth: validSecret });

    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({
        event: {
          id: 'evt_transfer_1',
          type: 'TRANSFER',
          app_user_id: 'to_user',
          transferred_from: ['from_user'],
          transferred_to: ['to_user']
        }
      });

    expect(res.status).toBe(200);
    expect(fakeClient.getSubscriber).toHaveBeenCalledWith('from_user');
    expect(fakeClient.getSubscriber).toHaveBeenCalledWith('to_user');

    const toAcc = await accounts.getAccount('to_user');
    expect(toAcc?.subscription?.status).toBe('active');
    const fromAcc = await accounts.getAccount('from_user');
    expect(fromAcc?.subscription).toBeNull();
  });

  it('returns 500 when upstream sync fails so RevenueCat will retry', async () => {
    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockRejectedValue(new Error('RevenueCat timeout')),
      deleteSubscriber: vi.fn()
    };

    const { app } = createWebhookApp({ revenueCat: fakeClient, webhookAuth: validSecret });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${validSecret}`)
      .send({
        event: {
          id: 'evt_fail_1',
          type: 'RENEWAL',
          app_user_id: 'u1'
        }
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Webhook sync failed' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RevenueCat] Webhook event RENEWAL failed for 1 of 1 user(s)'),
      'RevenueCat timeout'
    );
    errorSpy.mockRestore();
  });
});
