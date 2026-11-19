import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountMenu } from '../src/components/AccountMenu';
import type { Me } from '../src/utils/me';
import type { PlanLimits } from '../src/server/plans';
import type { DailyUsage } from '../src/server/usageStore';
import { setBilling, unavailableBilling, type Billing } from '../src/utils/billing';

describe('AccountMenu component', () => {
  beforeEach(() => {
    setBilling(unavailableBilling);
  });

  const dummyLimits: PlanLimits = {
    chatMessages: 15,
    voiceSeconds: 300,
    helperRequests: 100,
  };

  const dummyUsage: DailyUsage = {
    chatMessages: 5,
    voiceSeconds: 60,
    helperRequests: 10,
  };

  const guestMe: Me = {
    userId: 'guest-123',
    email: null,
    isAnonymous: true,
    tier: 'guest',
    limits: dummyLimits,
    usage: dummyUsage,
    resetsAt: '2026-11-20T00:00:00.000Z',
    consent: null,
    subscription: null,
  };

  const signedInMe: Me = {
    userId: 'user-456',
    email: 'learner@example.com',
    isAnonymous: false,
    tier: 'free',
    limits: dummyLimits,
    usage: dummyUsage,
    resetsAt: '2026-11-20T00:00:00.000Z',
    consent: null,
    subscription: null,
  };

  const premiumMe: Me = {
    userId: 'user-789',
    email: 'premium@example.com',
    isAnonymous: false,
    tier: 'premium',
    limits: { ...dummyLimits, chatMessages: 300 },
    usage: dummyUsage,
    resetsAt: '2026-11-20T00:00:00.000Z',
    consent: null,
    subscription: {
      status: 'active',
      productId: 'allora_pro_annual',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2026-12-01T00:00:00.000Z',
      willRenew: true,
    },
  };

  it('renders nothing when isOpen is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: false,
        onClose: vi.fn(),
        me: guestMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
      })
    );
    expect(html).toBe('');
  });

  it('renders Guest badge and Sign in button for anonymous user', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: guestMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
      })
    );
    expect(html).toContain('Guest');
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Sign out');
    expect(html).not.toContain('Delete account');
  });

  it('renders email and Free plan with Sign out and Delete account for signed-in user', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: signedInMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
      })
    );
    expect(html).toContain('learner@example.com');
    expect(html).toContain('Free');
    expect(html).toContain('Sign out');
    expect(html).toContain('Delete account');
    expect(html).not.toContain('Sign in');
  });

  it('renders Premium plan name for premium user', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: premiumMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
      })
    );
    expect(html).toContain('premium@example.com');
    expect(html).toContain('Premium');
    expect(html).toContain('Sign out');
    expect(html).toContain('Delete account');
  });

  it('renders Upgrade button for free user when billing is available', () => {
    const fakeBilling: Billing = {
      isAvailable: () => true,
      getOffers: async () => [],
      purchase: async () => ({ status: 'failed', message: 'noop' }),
      restore: async () => false,
      manageUrl: async () => 'https://example.com/manage',
    };
    setBilling(fakeBilling);

    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: signedInMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
        onUpgrade: vi.fn(),
      })
    );
    expect(html).toContain('Upgrade');
  });

  it('renders Manage subscription button for premium user when billing is available', () => {
    const fakeBilling: Billing = {
      isAvailable: () => true,
      getOffers: async () => [],
      purchase: async () => ({ status: 'failed', message: 'noop' }),
      restore: async () => false,
      manageUrl: async () => 'https://example.com/manage',
    };
    setBilling(fakeBilling);

    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: premiumMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
        onUpgrade: vi.fn(),
      })
    );
    expect(html).toContain('Manage subscription');
  });
});
