/** Tests for tier determination and plan limit constants. */
import { describe, expect, it } from 'vitest';
import type { Account, Subscription } from '../src/server/accountStore';
import { PLAN_LIMITS, tierFor } from '../src/server/plans';

describe('tierFor', () => {
  const baseAccount: Account = {
    userId: 'u1',
    email: 'user@example.com',
    isAnonymous: false,
    subscription: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    lastSeenAt: '2026-11-18T10:00:00.000Z'
  };

  const sampleSub: Subscription = {
    status: 'active',
    productId: 'parliamo_pro_annual',
    store: 'web',
    periodType: 'normal',
    expiresAt: '2026-12-01T00:00:00.000Z',
    willRenew: true,
    updatedAt: '2026-11-01T00:00:00.000Z'
  };

  const nowMs = Date.parse('2026-11-18T12:00:00.000Z');

  it('returns free for non-anonymous user with no subscription', () => {
    expect(tierFor({ ...baseAccount, isAnonymous: false, subscription: null }, nowMs)).toBe('free');
  });

  it('returns guest for anonymous user with no subscription', () => {
    expect(tierFor({ ...baseAccount, isAnonymous: true, subscription: null }, nowMs)).toBe('guest');
  });

  it('returns premium when subscription is active and not expired', () => {
    const account: Account = {
      ...baseAccount,
      subscription: { ...sampleSub, status: 'active', expiresAt: '2026-12-01T00:00:00.000Z' }
    };
    expect(tierFor(account, nowMs)).toBe('premium');
  });

  it('returns premium when subscription is in grace period and not expired', () => {
    const account: Account = {
      ...baseAccount,
      subscription: { ...sampleSub, status: 'grace', expiresAt: '2026-11-20T00:00:00.000Z' }
    };
    expect(tierFor(account, nowMs)).toBe('premium');
  });

  it('falls back to free when subscription status is expired', () => {
    const account: Account = {
      ...baseAccount,
      isAnonymous: false,
      subscription: { ...sampleSub, status: 'expired', expiresAt: '2026-12-01T00:00:00.000Z' }
    };
    expect(tierFor(account, nowMs)).toBe('free');
  });

  it('falls back when subscription is active but past expiresAt', () => {
    const account: Account = {
      ...baseAccount,
      isAnonymous: false,
      subscription: { ...sampleSub, status: 'active', expiresAt: '2026-11-10T00:00:00.000Z' }
    };
    expect(tierFor(account, nowMs)).toBe('free');
  });

  it('gives premium to an anonymous user who has an active subscription', () => {
    const account: Account = {
      ...baseAccount,
      isAnonymous: true,
      subscription: { ...sampleSub, status: 'active', expiresAt: '2026-12-01T00:00:00.000Z' }
    };
    expect(tierFor(account, nowMs)).toBe('premium');
  });
});

describe('PLAN_LIMITS', () => {
  it('defines expected limits for all tiers', () => {
    expect(PLAN_LIMITS.guest).toEqual({ chatMessages: 5, voiceSeconds: 120, helperRequests: 30 });
    expect(PLAN_LIMITS.free).toEqual({ chatMessages: 15, voiceSeconds: 300, helperRequests: 100 });
    expect(PLAN_LIMITS.premium).toEqual({ chatMessages: 300, voiceSeconds: 3600, helperRequests: 1000 });
  });
});
