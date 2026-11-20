import { describe, expect, it } from 'vitest';
import { limitClearDelayMs } from '../src/platform/hooks/useLimitReached';
import type { QuotaError } from '../src/platform/client/quotaError';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const limit = (overrides: Partial<QuotaError> = {}): QuotaError => ({
  counter: 'chatMessages',
  limit: 15,
  tier: 'free',
  resetsAt: '2026-11-21T00:00:00.000Z',
  ...overrides
});

describe('limitClearDelayMs', () => {
  it('clears at once when the tier changed', () => {
    expect(limitClearDelayMs(limit(), 'premium', NOW)).toBe(0);
  });

  it('waits until the reset time while the tier is unchanged', () => {
    expect(limitClearDelayMs(limit(), 'free', NOW)).toBe(12 * 60 * 60 * 1000);
  });

  it('waits until the reset time while the account is unknown', () => {
    expect(limitClearDelayMs(limit(), undefined, NOW)).toBe(12 * 60 * 60 * 1000);
  });

  it('clears at once when the reset time has passed', () => {
    expect(limitClearDelayMs(limit({ resetsAt: '2026-11-20T11:00:00.000Z' }), 'free', NOW)).toBe(0);
  });

  it('keeps the card when the reset time is unreadable', () => {
    expect(limitClearDelayMs(limit({ resetsAt: 'soon' }), 'free', NOW)).toBeNull();
  });
});
