/** Tests verifying AI tutor disclosures in OnboardingPage and PersonaProfileModal. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../src/components/OnboardingPage';
import { PersonaProfileModal } from '../src/components/PersonaProfileModal';
import { EMMANUELE } from '../src/data/personas';

describe('AI disclosure', () => {
  it('shows the AI tutor tag and disclosure sentence for the selected tutor in OnboardingPage', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, { onComplete: vi.fn() })
    );

    expect(html).toContain('AI tutor');
    expect(html).toContain(
      `${EMMANUELE.name} is an AI character. His replies can contain mistakes.`
    );
  });

  it('shows the AI tutor tag in PersonaProfileModal when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(PersonaProfileModal, {
        persona: EMMANUELE,
        isOpen: true,
        onClose: vi.fn(),
        onStartVideoCall: vi.fn()
      })
    );

    expect(html).toContain('AI tutor');
    expect(html).toContain(EMMANUELE.fullName);
  });
});
