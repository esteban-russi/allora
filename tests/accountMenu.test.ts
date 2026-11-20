import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountMenu, openManageSubscriptionTab, type ManageTab } from '../src/components/AccountMenu';
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

describe('openManageSubscriptionTab', () => {
  it('opens a blank tab synchronously, clears opener before navigating, and returns true', async () => {
    const events: string[] = [];
    let openerValue: unknown = { parent: true };
    let hrefValue = '';

    const fakeTab: ManageTab = {
      get opener() {
        return openerValue;
      },
      set opener(value: unknown) {
        openerValue = value;
        events.push(`opener=${String(value)}`);
      },
      location: {
        get href() {
          return hrefValue;
        },
        set href(value: string) {
          hrefValue = value;
          events.push(`href=${value}`);
        }
      },
      close: vi.fn(() => {
        events.push('close');
      })
    };

    const openTab = vi.fn(() => {
      events.push('open');
      return fakeTab;
    });

    let resolveUrl!: (url: string | null) => void;
    const urlPromise = new Promise<string | null>((resolve) => {
      resolveUrl = resolve;
    });

    const resultPromise = openManageSubscriptionTab('user-789', () => urlPromise, openTab);

    // Tab must be opened synchronously before the URL promise settles.
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith('', '_blank');
    expect(events).toEqual(['open']);

    resolveUrl('https://billing.revenuecat.com/portal/direct');
    const opened = await resultPromise;

    expect(opened).toBe(true);
    expect(openerValue).toBeNull();
    expect(hrefValue).toBe('https://billing.revenuecat.com/portal/direct');
    expect(events).toEqual([
      'open',
      'opener=null',
      'href=https://billing.revenuecat.com/portal/direct'
    ]);
    expect(fakeTab.close).not.toHaveBeenCalled();
  });

  it('closes the blank tab and returns false when manageUrl resolves to null', async () => {
    const fakeTab: ManageTab = {
      opener: {},
      location: { href: '' },
      close: vi.fn()
    };
    const openTab = vi.fn(() => fakeTab);

    const opened = await openManageSubscriptionTab('user-789', async () => null, openTab);

    expect(opened).toBe(false);
    expect(fakeTab.close).toHaveBeenCalledTimes(1);
    expect(fakeTab.location.href).toBe('');
  });

  it('closes the blank tab and returns false when manageUrl throws', async () => {
    const fakeTab: ManageTab = {
      opener: {},
      location: { href: '' },
      close: vi.fn()
    };
    const openTab = vi.fn(() => fakeTab);

    const opened = await openManageSubscriptionTab(
      'user-789',
      async () => {
        throw new Error('upstream failed');
      },
      openTab
    );

    expect(opened).toBe(false);
    expect(fakeTab.close).toHaveBeenCalledTimes(1);
    expect(fakeTab.location.href).toBe('');
  });

  it('falls back to opening directly with noopener,noreferrer when blank tab is blocked', async () => {
    const openTab = vi.fn(() => null);

    const opened = await openManageSubscriptionTab(
      'user-789',
      async () => 'https://billing.revenuecat.com/portal/direct',
      openTab
    );

    expect(opened).toBe(true);
    expect(openTab).toHaveBeenNthCalledWith(1, '', '_blank');
    expect(openTab).toHaveBeenNthCalledWith(
      2,
      'https://billing.revenuecat.com/portal/direct',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
