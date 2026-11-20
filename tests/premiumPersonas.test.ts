/** Tests for premium persona markers in personaPrompts and personas. */
import { describe, expect, it } from 'vitest';
import { isPremiumPersona, PREMIUM_PERSONA_IDS } from '../src/product/data/personaPrompts';
import { EMMANUELE, TUTORS } from '../src/product/data/personas';
import type { Persona } from '../src/product/types';

describe('PREMIUM_PERSONA_IDS and isPremiumPersona', () => {
  it('starts empty before owner-supplied premium tutors are added', () => {
    expect(PREMIUM_PERSONA_IDS).toEqual([]);
  });

  it('returns false for Emmanuele and unknown ids by default', () => {
    expect(isPremiumPersona('emmanuele')).toBe(false);
    expect(isPremiumPersona('unknown-tutor')).toBe(false);
    expect(isPremiumPersona('')).toBe(false);
  });

  it('identifies premium ids from an injected list without marking free tutors', () => {
    const premiumIds = ['test-premium-tutor'];

    expect(isPremiumPersona('test-premium-tutor', premiumIds)).toBe(true);
    expect(isPremiumPersona('emmanuele', premiumIds)).toBe(false);
    expect(isPremiumPersona('other', premiumIds)).toBe(false);
    expect(isPremiumPersona('', premiumIds)).toBe(false);
  });
});

describe('Persona.isPremium', () => {
  it('marks Emmanuele as non-premium', () => {
    expect(EMMANUELE.isPremium).toBe(false);
    expect(EMMANUELE.isPremium).toBe(isPremiumPersona(EMMANUELE.id));
  });

  it('derives isPremium from isPremiumPersona for every shipped tutor', () => {
    for (const tutor of TUTORS) {
      expect(tutor.isPremium).toBe(isPremiumPersona(tutor.id));
    }
  });

  it('supports a premium Persona fixture derived from isPremiumPersona', () => {
    const fixtureId = 'test-premium-tutor';
    const premiumFixture: Persona = {
      ...EMMANUELE,
      id: fixtureId,
      isPremium: isPremiumPersona(fixtureId, [fixtureId])
    };

    expect(premiumFixture.isPremium).toBe(true);
  });
});
