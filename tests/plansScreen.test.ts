import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlansScreen } from '../src/components/PlansScreen';
import { setBilling, type Billing, type PlanOffer } from '../src/utils/billing';
import type { Me } from '../src/utils/me';

describe('PlansScreen', () => {
  const dummyOffers: PlanOffer[] = [
    {
      id: 'monthly',
      priceText: '£8.99',
      periodText: 'per month',
      trialText: null
    },
    {
      id: 'annual',
      priceText: '£59.99',
      periodText: 'per year',
      trialText: '7 days free'
    }
  ];

  const freeMe: Me = {
    userId: 'u1',
    email: 'user@example.com',
    isAnonymous: false,
    tier: 'free',
    limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
    usage: { chatMessages: 2, voiceSeconds: 60, helperRequests: 5 },
    resetsAt: '2026-11-20T00:00:00.000Z',
    subscription: null
  };

  const guestMe: Me = {
    ...freeMe,
    userId: 'guest-1',
    email: null,
    isAnonymous: true,
    tier: 'guest'
  };

  beforeEach(() => {
    const mockBilling: Billing = {
      isAvailable: () => true,
      getOffers: async () => dummyOffers,
      purchase: async () => ({ status: 'purchased' }),
      restore: async () => true,
      manageUrl: async () => null
    };
    setBilling(mockBilling);
  });

  it('renders heading and feature comparison list', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: freeMe,
        onDone: vi.fn(),
        onNeedSignIn: vi.fn()
      })
    );
    expect(html).toContain('Parliamo Premium');
    expect(html).toContain('Unlimited');
    expect(html).toContain('chat messages daily');
    expect(html).toContain('5</strong> → <strong class="font-semibold text-cobalt">30</strong> call minutes daily');
    expect(html).not.toContain('tutor personas');
  });

  it('renders loading state initially during server rendering', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: freeMe,
        onDone: vi.fn(),
        onNeedSignIn: vi.fn()
      })
    );
    expect(html).toContain('Loading plans…');
  });

  it('renders for guest user with sign-in prompt potential', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: guestMe,
        onDone: vi.fn(),
        onNeedSignIn: vi.fn()
      })
    );
    expect(html).toContain('Parliamo Premium');
  });
});
