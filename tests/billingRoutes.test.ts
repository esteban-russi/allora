/** Tests for billing router endpoints. */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBillingRouter } from '../src/server/billingRoutes';
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

    const res = await request(app).post('/api/billing/sync');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: 'BILLING_UPSTREAM_ERROR' });
  });
});
