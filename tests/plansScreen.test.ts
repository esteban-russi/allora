import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlansScreen } from '../src/components/PlansScreen';
import { EMMANUELE } from '../src/data/personas';
import type { Persona } from '../src/types';
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
    consent: null,
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
    expect(html).toContain('Allora Premium');
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
    expect(html).toContain('Allora Premium');
  });

  it('omits All tutors benefit when no premium tutors exist', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: freeMe,
        onDone: vi.fn(),
        onNeedSignIn: vi.fn()
      })
    );
    expect(html).not.toContain('All tutors');
  });

  it('lists All tutors with premium tutors names and portraits when premium tutors exist', () => {
    const premiumOne: Persona = {
      ...EMMANUELE,
      id: 'test-premium-1',
      name: 'Chiara',
      fullName: 'Chiara da Milano',
      avatar: { idle: '/fixtures/chiara-idle.webp', speaking: '/fixtures/chiara-speak.webp' },
      isPremium: true
    };
    const premiumTwo: Persona = {
      ...EMMANUELE,
      id: 'test-premium-2',
      name: 'Gennaro',
      fullName: 'Gennaro da Napoli',
      avatar: { idle: '/fixtures/gennaro-idle.webp', speaking: '/fixtures/gennaro-speak.webp' },
      isPremium: true
    };

    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: freeMe,
        tutors: [EMMANUELE, premiumOne, premiumTwo],
        onDone: vi.fn(),
        onNeedSignIn: vi.fn()
      })
    );

    expect(html).toContain('All tutors');
    expect(html).toContain('Chiara');
    expect(html).toContain('src="/fixtures/chiara-idle.webp"');
    expect(html).toContain('Gennaro');
    expect(html).toContain('src="/fixtures/gennaro-idle.webp"');
    expect(html).not.toContain(EMMANUELE.name);
  });
});
