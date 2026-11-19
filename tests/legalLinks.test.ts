/** Tests verifying Privacy and Terms footer links across all four legal-link screens. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu } from '../src/components/AccountMenu';
import { LegalLinks } from '../src/components/LegalLinks';
import { OnboardingPage } from '../src/components/OnboardingPage';
import { PlansScreen } from '../src/components/PlansScreen';
import { SignInScreen } from '../src/components/SignInScreen';
import { legalUrl } from '../src/utils/legalUrl';
import type { Me } from '../src/utils/me';

const sampleMe: Me = {
  userId: 'user-1',
  email: 'learner@example.com',
  isAnonymous: false,
  tier: 'free',
  limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
  usage: { chatMessages: 0, voiceSeconds: 0, helperRequests: 0 },
  resetsAt: '2026-11-20T00:00:00.000Z',
  subscription: null,
};

function expectFooterLegalLinks(html: string): void {
  expect(html).toContain(
    `<a href="${legalUrl('privacy')}" target="_blank" rel="noopener noreferrer"`
  );
  expect(html).toContain('>Privacy</a>');
  expect(html).toContain(
    `<a href="${legalUrl('terms')}" target="_blank" rel="noopener noreferrer"`
  );
  expect(html).toContain('>Terms</a>');
}

describe('LegalLinks and screen footers', () => {
  it('renders Privacy and Terms links opening in a new tab', () => {
    const html = renderToStaticMarkup(React.createElement(LegalLinks));
    expectFooterLegalLinks(html);
  });

  it('includes Privacy and Terms footer links in OnboardingPage', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, { onComplete: vi.fn() })
    );
    expectFooterLegalLinks(html);
  });

  it('includes Privacy and Terms footer links in SignInScreen', () => {
    const html = renderToStaticMarkup(
      React.createElement(SignInScreen, {
        mode: 'after-onboarding',
        onSignedIn: vi.fn(),
        onSkip: vi.fn(),
      })
    );
    expectFooterLegalLinks(html);
  });

  it('includes Privacy and Terms footer links in PlansScreen', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlansScreen, {
        me: sampleMe,
        onDone: vi.fn(),
        onNeedSignIn: vi.fn(),
      })
    );
    expectFooterLegalLinks(html);
  });

  it('includes Privacy and Terms footer links in AccountMenu when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccountMenu, {
        isOpen: true,
        onClose: vi.fn(),
        me: sampleMe,
        onEditProfile: vi.fn(),
        onSignIn: vi.fn(),
        onSignedOut: vi.fn(),
        onAccountDeleted: vi.fn(),
      })
    );
    expectFooterLegalLinks(html);
  });
});
