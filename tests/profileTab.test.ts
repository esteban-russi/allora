/** Tests for ProfileTab titles and usage meters in subscription section. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileTab } from '../src/product/components/ProfileTab';
import type { Me } from '../src/platform/client/me';
import type { DevSettings, LearnerProfile } from '../src/product/types';
import * as billingModule from '../src/platform/client/billing';

describe('ProfileTab', () => {
  const fakeProfile: LearnerProfile = {
    name: 'Mario',
    level: 'B1',
    personaId: 'emmanuele'
  };

  const fakeDevSettings: DevSettings = {
    voiceProvider: 'gemini_live',
    voiceId: 'Kore',
    sttProvider: 'production_cloud',
    voiceCallEngine: 'realtime_live',
    temperature: 0.7,
    speechRate: 1.0,
    audioSamplingRate: '24kHz',
    grammarStrictness: 'conversational',
    subtitlesEnabled: true,
    autoPlayAudio: false
  };

  const fakeMe: Me = {
    userId: 'learner-1',
    email: 'learner@example.com',
    isAnonymous: false,
    tier: 'free',
    limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
    usage: { chatMessages: 7, voiceSeconds: 120, helperRequests: 2 },
    resetsAt: '2026-11-21T00:00:00.000Z',
    consent: null,
    subscription: null
  };

  it('renders a visually-hidden H1 without duplicate visible heading', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProfileTab, {
        learnerProfile: fakeProfile,
        devSettings: fakeDevSettings,
        onSaveSettings: vi.fn(),
        me: fakeMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn()
      })
    );

    // Visually-hidden heading
    expect(html).toContain('class="sr-only focus:outline-none">Profile</h1>');
    // Does not have a visible text-2xl/text-3xl H1
    expect(html).not.toContain('text-2xl sm:text-3xl font-semibold text-ink focus:outline-none">Profile</h1>');
  });

  it('renders usage meters in the subscription section', () => {
    vi.spyOn(billingModule, 'getBilling').mockReturnValue({
      isAvailable: () => true,
      openManageSubscription: vi.fn(),
      purchasePackage: vi.fn(),
      getOfferings: vi.fn()
    } as any);

    const html = renderToStaticMarkup(
      React.createElement(ProfileTab, {
        learnerProfile: fakeProfile,
        devSettings: fakeDevSettings,
        onSaveSettings: vi.fn(),
        me: fakeMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onUpgrade: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn()
      })
    );

    // Subscription section exists
    expect(html).toContain('Subscription');
    expect(html).toContain('Upgrade to Premium');

    // Messages and call minutes usage meters are rendered in subscription section
    expect(html).toContain('Messages today');
    expect(html).toContain('7 / 15');
    expect(html).toContain('Call minutes today');
    expect(html).toContain('2 / 5');
  });
});
