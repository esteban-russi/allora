import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsageMeter } from '../src/components/UsageMeter';
import type { Me } from '../src/utils/me';

describe('UsageMeter', () => {
  const freeMe: Me = {
    userId: 'u1',
    email: 'user@example.com',
    isAnonymous: false,
    tier: 'free',
    limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
    usage: { chatMessages: 7, voiceSeconds: 120, helperRequests: 10 },
    resetsAt: '2026-11-20T00:00:00.000Z',
    consent: null,
    subscription: null
  };

  const premiumMe: Me = {
    userId: 'u2',
    email: 'pro@example.com',
    isAnonymous: false,
    tier: 'premium',
    limits: { chatMessages: 300, voiceSeconds: 3600, helperRequests: 1000 },
    usage: { chatMessages: 42, voiceSeconds: 720, helperRequests: 50 },
    resetsAt: '2026-11-20T00:00:00.000Z',
    consent: null,
    subscription: {
      status: 'active',
      productId: 'allora_pro_annual',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2026-12-01T00:00:00.000Z',
      willRenew: true
    }
  };

  it('renders nothing when me is null', () => {
    const html = renderToStaticMarkup(React.createElement(UsageMeter, { me: null }));
    expect(html).toBe('');
  });

  it('renders messages and call minutes with progress bars for free tier', () => {
    const html = renderToStaticMarkup(React.createElement(UsageMeter, { me: freeMe }));
    expect(html).toContain('Messages today');
    expect(html).toContain('7 / 15');
    expect(html).toContain('Call minutes today');
    expect(html).toContain('2 / 5');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="7"');
    expect(html).toContain('aria-valuenow="2"');
  });

  it('renders Unlimited for messages and call minutes for premium tier', () => {
    const html = renderToStaticMarkup(React.createElement(UsageMeter, { me: premiumMe }));
    expect(html).toContain('Unlimited');
    expect(html).not.toContain('42 / 300');
    expect(html).toContain('Call minutes today');
    expect(html).toContain('12 / 60');
    expect(html).toContain('aria-valuenow="12"');
  });
});
