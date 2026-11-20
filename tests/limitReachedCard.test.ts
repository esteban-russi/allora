import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LimitReachedCard } from '../src/platform/components/LimitReachedCard';
import type { QuotaError } from '../src/platform/client/quotaError';

describe('LimitReachedCard', () => {
  const chatQuota: QuotaError = {
    counter: 'chatMessages',
    limit: 15,
    tier: 'free',
    resetsAt: '2026-11-20T00:00:00.000Z'
  };

  const voiceQuota: QuotaError = {
    counter: 'voiceSeconds',
    limit: 300,
    tier: 'guest',
    resetsAt: '2026-11-20T00:00:00.000Z'
  };

  it('renders chat limit message', () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitReachedCard, {
        quota: chatQuota,
        tier: 'free',
        canUpgrade: true
      })
    );
    expect(html).toContain("You&#x27;ve used today&#x27;s 15 messages.");
    expect(html).toContain('Your allowance resets at');
    expect(html).toContain('role="status"');
    expect(html).toContain('id="limit-reached-card"');
  });

  it('renders voice call limit message', () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitReachedCard, {
        quota: voiceQuota,
        tier: 'guest',
        canUpgrade: false,
        onSignIn: vi.fn()
      })
    );
    expect(html).toContain("You&#x27;ve used today&#x27;s 5 minutes of calls.");
    expect(html).toContain('Sign in for more');
  });

  it('shows See plans button for free tier when canUpgrade is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitReachedCard, {
        quota: chatQuota,
        tier: 'free',
        canUpgrade: true,
        onSeePlans: vi.fn()
      })
    );
    expect(html).toContain('See plans');
    expect(html).not.toContain('Sign in for more');
  });

  it('hides See plans button for free tier when canUpgrade is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitReachedCard, {
        quota: chatQuota,
        tier: 'free',
        canUpgrade: false,
        onSeePlans: vi.fn()
      })
    );
    expect(html).not.toContain('See plans');
    expect(html).not.toContain('Sign in for more');
  });

  it('shows only reset time for premium tier', () => {
    const html = renderToStaticMarkup(
      React.createElement(LimitReachedCard, {
        quota: { ...chatQuota, tier: 'premium' },
        tier: 'premium',
        canUpgrade: false,
        onSignIn: vi.fn(),
        onSeePlans: vi.fn()
      })
    );
    expect(html).toContain('Your allowance resets at');
    expect(html).not.toContain('Sign in for more');
    expect(html).not.toContain('See plans');
  });
});
