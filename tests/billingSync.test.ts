/** Tests for syncSubscription handler. */
import { describe, expect, it, vi } from 'vitest';
import { syncSubscription } from '../src/server/billingSync';
import { InMemoryAccountStore } from '../src/server/accountStore';
import type { RevenueCatClient } from '../src/server/revenueCat';

describe('syncSubscription', () => {
  const nowMs = Date.parse('2026-11-19T12:00:00.000Z');

  it('ignores IDs starting with $RCAnonymousID:', async () => {
    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn(),
      deleteSubscriber: vi.fn()
    };
    const accounts = new InMemoryAccountStore(() => nowMs);

    const result = await syncSubscription('$RCAnonymousID:abc123xyz', {
      revenueCat: fakeClient,
      accounts,
      now: () => nowMs
    });

    expect(result).toBeNull();
    expect(fakeClient.getSubscriber).not.toHaveBeenCalled();
  });

  it('fetches subscriber, sets subscription on account, and returns it', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'test@example.com', isAnonymous: false });

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

    const sub = await syncSubscription('u1', {
      revenueCat: fakeClient,
      accounts,
      now: () => nowMs
    });

    expect(fakeClient.getSubscriber).toHaveBeenCalledWith('u1');
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('active');
    expect(sub?.productId).toBe('pro_monthly');

    const updatedAccount = await accounts.getAccount('u1');
    expect(updatedAccount?.subscription).toEqual(sub);
  });

  it('sets null subscription when subscriber has no premium entitlement', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u1', email: 'test@example.com', isAnonymous: false });
    // Pre-populate with existing subscription
    await accounts.setSubscription('u1', {
      status: 'active',
      productId: 'old_plan',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2026-12-01T00:00:00.000Z',
      willRenew: true,
      updatedAt: '2026-11-01T00:00:00.000Z'
    });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue({
        entitlements: {}
      }),
      deleteSubscriber: vi.fn()
    };

    const sub = await syncSubscription('u1', {
      revenueCat: fakeClient,
      accounts,
      now: () => nowMs
    });

    expect(sub).toBeNull();
    const updatedAccount = await accounts.getAccount('u1');
    expect(updatedAccount?.subscription).toBeNull();
  });

  it('sets null subscription when RevenueCat returns 404 (null subscriber)', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    await accounts.upsertFromAuth({ userId: 'u2', isAnonymous: true });

    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue(null),
      deleteSubscriber: vi.fn()
    };

    const sub = await syncSubscription('u2', {
      revenueCat: fakeClient,
      accounts,
      now: () => nowMs
    });

    expect(sub).toBeNull();
    const updatedAccount = await accounts.getAccount('u2');
    expect(updatedAccount?.subscription).toBeNull();
  });

  it('safely handles non-existent account without error', async () => {
    const accounts = new InMemoryAccountStore(() => nowMs);
    const fakeClient: RevenueCatClient = {
      getSubscriber: vi.fn().mockResolvedValue({
        entitlements: {
          premium: {
            product_identifier: 'pro_monthly',
            expires_date: '2026-12-19T12:00:00.000Z'
          }
        }
      }),
      deleteSubscriber: vi.fn()
    };

    // 'deleted_user' never existed in accounts
    const sub = await syncSubscription('deleted_user', {
      revenueCat: fakeClient,
      accounts,
      now: () => nowMs
    });

    expect(sub).not.toBeNull();
    expect(await accounts.getAccount('deleted_user')).toBeNull();
  });
});
