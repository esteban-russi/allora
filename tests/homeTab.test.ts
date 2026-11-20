/** Tests for HomeTab greeting and component logic. */
import { describe, expect, it } from 'vitest';
import { getItalianGreeting } from '../src/product/components/HomeTab';

describe('getItalianGreeting', () => {
  it('returns Buongiorno between 04:00 and 16:59', () => {
    const morning = new Date('2026-11-20T09:30:00');
    const noon = new Date('2026-11-20T12:00:00');
    const afternoon = new Date('2026-11-20T16:59:59');

    expect(getItalianGreeting(morning)).toBe('Buongiorno');
    expect(getItalianGreeting(noon)).toBe('Buongiorno');
    expect(getItalianGreeting(afternoon)).toBe('Buongiorno');
  });

  it('returns Buonasera starting from 17:00 through the night until 03:59', () => {
    const evening = new Date('2026-11-20T17:00:00');
    const night = new Date('2026-11-20T22:15:00');
    const earlyHours = new Date('2026-11-20T02:00:00');

    expect(getItalianGreeting(evening)).toBe('Buonasera');
    expect(getItalianGreeting(night)).toBe('Buonasera');
    expect(getItalianGreeting(earlyHours)).toBe('Buonasera');
  });
});
