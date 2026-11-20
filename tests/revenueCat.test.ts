/** Tests for RevenueCat REST client and subscription mapping. */
import { describe, expect, it, vi } from 'vitest';
import { createRevenueCatClient, toSubscription } from '../src/platform/server/revenueCat';

describe('toSubscription', () => {
  const nowMs = Date.parse('2026-11-19T12:00:00.000Z');

  it('maps active subscription correctly', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_monthly_pro',
          expires_date: '2026-12-19T12:00:00.000Z',
          grace_period_expires_date: null
        }
      },
      subscriptions: {
        rc_monthly_pro: {
          store: 'play_store',
          period_type: 'normal'
        }
      },
      management_url: 'https://play.google.com/store/account/subscriptions'
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('active');
    expect(sub?.productId).toBe('rc_monthly_pro');
    expect(sub?.store).toBe('play_store');
    expect(sub?.periodType).toBe('normal');
    expect(sub?.expiresAt).toBe('2026-12-19T12:00:00.000Z');
    expect(sub?.willRenew).toBe(true);
    expect(sub?.managementUrl).toBe('https://play.google.com/store/account/subscriptions');
    expect(sub?.updatedAt).toBe(new Date(nowMs).toISOString());
  });

  it('maps trial subscription correctly', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_annual_pro',
          expires_date: '2026-11-26T12:00:00.000Z',
          grace_period_expires_date: null
        }
      },
      subscriptions: {
        rc_annual_pro: {
          store: 'stripe',
          period_type: 'trial'
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('active');
    expect(sub?.periodType).toBe('trial');
    expect(sub?.store).toBe('web'); // non-play_store maps to web
    expect(sub?.willRenew).toBe(true);
    expect(sub?.managementUrl).toBeNull();
  });

  it('maps cancelled-but-still-active subscription with willRenew: false', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_monthly_pro',
          expires_date: '2026-12-01T00:00:00.000Z'
        }
      },
      subscriptions: {
        rc_monthly_pro: {
          store: 'web',
          period_type: 'normal',
          unsubscribe_detected_at: '2026-11-18T10:00:00.000Z'
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('active');
    expect(sub?.willRenew).toBe(false);
  });

  it('maps billing issue in grace period', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_monthly_pro',
          expires_date: '2026-11-18T00:00:00.000Z', // past
          grace_period_expires_date: '2026-11-25T00:00:00.000Z' // in future
        }
      },
      subscriptions: {
        rc_monthly_pro: {
          store: 'play_store',
          period_type: 'normal',
          billing_issues_detected_at: '2026-11-18T00:00:00.000Z'
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('grace');
    expect(sub?.expiresAt).toBe('2026-11-25T00:00:00.000Z');
    expect(sub?.willRenew).toBe(false);
  });

  it('maps expired subscription when now is past expiry and grace', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_monthly_pro',
          expires_date: '2026-11-10T00:00:00.000Z',
          grace_period_expires_date: '2026-11-15T00:00:00.000Z'
        }
      },
      subscriptions: {
        rc_monthly_pro: {
          store: 'web',
          period_type: 'normal'
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('expired');
    expect(sub?.expiresAt).toBe('2026-11-10T00:00:00.000Z');
  });

  it('returns null when premium entitlement is missing', () => {
    const subscriber = {
      entitlements: {
        other: {
          product_identifier: 'other_item'
        }
      }
    };

    expect(toSubscription(subscriber, nowMs)).toBeNull();
    expect(toSubscription({}, nowMs)).toBeNull();
  });

  it('handles lifetime entitlement with null expires_date', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_lifetime',
          expires_date: null
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('active');
    expect(sub?.expiresAt).toContain('9999-12-31');
    expect(sub?.willRenew).toBe(true);
  });

  it('maps unknown store to web', () => {
    const subscriber = {
      entitlements: {
        premium: {
          product_identifier: 'rc_monthly_pro',
          expires_date: '2026-12-01T00:00:00.000Z'
        }
      },
      subscriptions: {
        rc_monthly_pro: {
          store: 'unknown_store'
        }
      }
    };

    const sub = toSubscription(subscriber, nowMs);
    expect(sub?.store).toBe('web');
  });

  it('unwraps nested subscriber object if response is wrapped in { subscriber: ... }', () => {
    const wrapped = {
      subscriber: {
        entitlements: {
          premium: {
            product_identifier: 'rc_monthly_pro',
            expires_date: '2026-12-01T00:00:00.000Z'
          }
        }
      }
    };

    const sub = toSubscription(wrapped, nowMs);
    expect(sub).not.toBeNull();
    expect(sub?.productId).toBe('rc_monthly_pro');
  });
});

describe('createRevenueCatClient', () => {
  it('fetches subscriber and returns parsed subscriber object on 200', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        subscriber: {
          entitlements: { premium: { product_identifier: 'p1' } }
        }
      })
    });

    const client = createRevenueCatClient('sk_test_123', fakeFetch as any);
    const subscriber = await client.getSubscriber('user/special+id');

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const callArgs = fakeFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.revenuecat.com/v1/subscribers/user%2Fspecial%2Bid');
    expect(callArgs[1].headers).toEqual({
      Authorization: 'Bearer sk_test_123',
      Accept: 'application/json'
    });
    expect(subscriber).toEqual({
      entitlements: { premium: { product_identifier: 'p1' } }
    });
  });

  it('returns null on 404 response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    });

    const client = createRevenueCatClient('sk_test_123', fakeFetch as any);
    const subscriber = await client.getSubscriber('user_not_found');

    expect(subscriber).toBeNull();
  });

  it('throws on 500 error response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    const client = createRevenueCatClient('sk_test_123', fakeFetch as any);
    await expect(client.getSubscriber('u1')).rejects.toThrow('RevenueCat getSubscriber failed with status 500');
  });

  it('deleteSubscriber succeeds on 200 or 404 and throws on 500', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const client = createRevenueCatClient('sk_test_123', fakeFetch as any);

    await expect(client.deleteSubscriber('u1')).resolves.toBeUndefined();
    await expect(client.deleteSubscriber('u2')).resolves.toBeUndefined();
    await expect(client.deleteSubscriber('u3')).rejects.toThrow('RevenueCat deleteSubscriber failed with status 500');

    expect(fakeFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});
