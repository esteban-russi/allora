/** Tests for terms version constant, consent submission, OnboardingPage checkbox, and ConsentDialog. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsentDialog } from '../src/components/ConsentDialog';
import { OnboardingPage } from '../src/components/OnboardingPage';
import { TERMS_VERSION } from '../src/data/legal';
import { legalUrl } from '../src/utils/legalUrl';
import { parseMeResponse, submitConsent } from '../src/utils/me';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TERMS_VERSION and consent API helpers', () => {
  it('exports the current terms version', () => {
    expect(TERMS_VERSION).toBe('2026-11');
  });

  it('parses valid consent and rejects malformed consent in parseMeResponse', () => {
    const base = {
      userId: 'u1',
      email: 'u1@example.com',
      isAnonymous: false,
      tier: 'free',
      limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
      usage: { chatMessages: 0, voiceSeconds: 0, helperRequests: 0 },
      resetsAt: '2026-11-20T00:00:00.000Z',
      subscription: null
    };

    const withConsent = parseMeResponse({
      ...base,
      consent: { termsVersion: '2026-11', acceptedAt: '2026-11-19T10:00:00.000Z' }
    });
    expect(withConsent?.consent).toEqual({
      termsVersion: '2026-11',
      acceptedAt: '2026-11-19T10:00:00.000Z'
    });

    expect(parseMeResponse({ ...base, consent: 'bad' })).toBeNull();
    expect(parseMeResponse({ ...base, consent: { termsVersion: 123 } })).toBeNull();
  });

  it('posts termsVersion to /api/account/consent and returns the saved record', async () => {
    const consent = { termsVersion: '2026-11', acceptedAt: '2026-11-19T10:00:00.000Z' };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ consent }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const saved = await submitConsent(TERMS_VERSION);
    expect(saved).toEqual(consent);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/consent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ termsVersion: TERMS_VERSION })
      })
    );
  });

  it('returns null when /api/account/consent fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad', { status: 400 })));
    expect(await submitConsent(TERMS_VERSION)).toBeNull();
  });
});

describe('OnboardingPage consent gate', () => {
  it('renders the 18+ and Terms/Privacy checkbox and disables Start until ticked', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        initialProfile: { name: 'Marco', level: 'A2', personaId: 'emmanuele' },
        onComplete: vi.fn()
      })
    );

    expect(html).toContain('I am 18 or older and I agree to the');
    expect(html).toContain(`href="${legalUrl('terms')}"`);
    expect(html).toContain(`href="${legalUrl('privacy')}"`);
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });

  it('enables Start when profile has a name and consent is already accepted', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        initialProfile: { name: 'Marco', level: 'A2', personaId: 'emmanuele' },
        initialConsentAccepted: true,
        onComplete: vi.fn()
      })
    );

    expect(html).not.toMatch(/<button type="submit" disabled=""/);
  });
});

describe('ConsentDialog', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsentDialog, { isOpen: false, onAccepted: vi.fn() })
    );
    expect(html).toBe('');
  });

  it('renders a blocking modal with the consent checkbox and disabled Continue button', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsentDialog, { isOpen: true, onAccepted: vi.fn() })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('I am 18 or older and I agree to the');
    expect(html).toContain(`href="${legalUrl('terms')}"`);
    expect(html).toContain(`href="${legalUrl('privacy')}"`);
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Continue<\/button>/);
  });
});
