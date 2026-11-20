/** Tests for premium tutor cards, lock states, and profile previews in OnboardingPage. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingPage, resolveTutorSelection } from '../src/product/components/OnboardingPage';
import { PersonaProfileModal } from '../src/product/components/PersonaProfileModal';
import { EMMANUELE } from '../src/product/data/personas';
import type { Persona } from '../src/product/types';

const TEST_PREMIUM_TUTOR: Persona = {
  ...EMMANUELE,
  id: 'test-premium-tutor',
  name: 'Chiara',
  fullName: 'Chiara da Milano',
  city: 'Milano',
  region: 'Lombardia',
  voiceGender: 'female',
  isPremium: true
};

const TWO_TUTORS: readonly Persona[] = [EMMANUELE, TEST_PREMIUM_TUTOR];

describe('resolveTutorSelection', () => {
  it('opens plans without selecting when a non-premium user taps a locked tutor and billing is available', () => {
    expect(resolveTutorSelection(TEST_PREMIUM_TUTOR, 'free', true)).toEqual({
      action: 'see-plans',
      tutorId: TEST_PREMIUM_TUTOR.id
    });
    expect(resolveTutorSelection(TEST_PREMIUM_TUTOR, 'guest', true)).toEqual({
      action: 'see-plans',
      tutorId: TEST_PREMIUM_TUTOR.id
    });
  });

  it('ignores taps on locked tutors when billing is unavailable', () => {
    expect(resolveTutorSelection(TEST_PREMIUM_TUTOR, 'free', false)).toEqual({ action: 'noop' });
    expect(resolveTutorSelection(TEST_PREMIUM_TUTOR, 'guest', false)).toEqual({ action: 'noop' });
  });

  it('allows premium users to select premium tutors and everyone to select free tutors', () => {
    expect(resolveTutorSelection(TEST_PREMIUM_TUTOR, 'premium', false)).toEqual({
      action: 'select',
      tutorId: TEST_PREMIUM_TUTOR.id
    });
    expect(resolveTutorSelection(EMMANUELE, 'guest', false)).toEqual({
      action: 'select',
      tutorId: EMMANUELE.id
    });
    expect(resolveTutorSelection(EMMANUELE, 'free', true)).toEqual({
      action: 'select',
      tutorId: EMMANUELE.id
    });
  });
});

describe('OnboardingPage tutor cards', () => {
  it('shows coming-soon notice and About button when only Emmanuele is present', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        tier: 'free',
        canUpgrade: true,
        onSeePlans: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).toContain('More regional tutors coming soon');
    expect(html).toContain(`About ${EMMANUELE.name}`);
    expect(html).not.toContain('aria-label="Premium tutor"');
  });

  it('hides the coming-soon header notice and shows Premium lock tag when billing is available', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        tier: 'free',
        canUpgrade: true,
        tutors: TWO_TUTORS,
        onSeePlans: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).not.toContain('More regional tutors coming soon');
    expect(html).toContain('aria-label="Premium tutor"');
    expect(html).toContain('Premium');
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain(`About ${EMMANUELE.name}`);
    expect(html).toContain(`About ${TEST_PREMIUM_TUTOR.name}`);
  });

  it('tags locked tutors as Coming soon and sets aria-disabled when billing is unavailable', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        tier: 'free',
        canUpgrade: false,
        tutors: TWO_TUTORS,
        onSeePlans: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).toContain('Coming soon');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('aria-label="Premium tutor"');
    expect(html).toContain(`About ${TEST_PREMIUM_TUTOR.name}`);
  });

  it('preselects pending premium tutor for a premium user after purchase', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        tier: 'premium',
        canUpgrade: true,
        tutors: TWO_TUTORS,
        initialTutorId: TEST_PREMIUM_TUTOR.id,
        onSeePlans: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain(`with ${TEST_PREMIUM_TUTOR.name}`);
    expect(html).toContain(`${TEST_PREMIUM_TUTOR.name} is an AI character. Her replies can contain mistakes.`);
  });

  it('falls back to a free tutor if a non-premium user opens onboarding with a premium initialProfile', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingPage, {
        tier: 'free',
        canUpgrade: true,
        tutors: TWO_TUTORS,
        initialProfile: { name: 'Luca', level: 'B1', personaId: TEST_PREMIUM_TUTOR.id },
        onSeePlans: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).toContain(`with ${EMMANUELE.name}`);
    expect(html).not.toContain(`with ${TEST_PREMIUM_TUTOR.name}`);
  });
});

describe('PersonaProfileModal preview mode', () => {
  it('renders tutor details and voice sample without Start voice call when opened from onboarding', () => {
    const html = renderToStaticMarkup(
      React.createElement(PersonaProfileModal, {
        persona: TEST_PREMIUM_TUTOR,
        isOpen: true,
        onClose: vi.fn()
      })
    );

    expect(html).toContain(TEST_PREMIUM_TUTOR.fullName);
    expect(html).toContain('Listen to Voice');
    expect(html).not.toContain('Start voice call');
  });
});
