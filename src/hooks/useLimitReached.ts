/** React hook holding the daily-limit card and clearing it when it no longer applies. */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { QuotaError } from '../utils/quotaError';

/**
 * Decide when a shown daily-limit card should go away.
 *
 * Args:
 *   limit: The limit that was reached.
 *   currentTier: The account's tier now, or undefined while the account is unknown.
 *   nowMs: Current time in milliseconds.
 *
 * Returns:
 *   0 to clear now (the tier changed or the reset time passed), the milliseconds
 *   until the reset, or null to keep the card when the reset time is unreadable.
 */
export function limitClearDelayMs(limit: QuotaError, currentTier: string | undefined, nowMs: number): number | null {
  if (currentTier !== undefined && limit.tier !== currentTier) return 0;
  const resetMs = Date.parse(limit.resetsAt);
  if (Number.isNaN(resetMs)) return null;
  return Math.max(resetMs - nowMs, 0);
}

/**
 * The daily limit the learner last hit, cleared on a tier change or at the reset time.
 *
 * Args:
 *   currentTier: The account's tier, or undefined while it is unknown.
 *
 * Returns:
 *   The current limit (or null) and its setter, like `useState`.
 */
export function useLimitReached(
  currentTier: string | undefined
): [QuotaError | null, Dispatch<SetStateAction<QuotaError | null>>] {
  const [limitReached, setLimitReached] = useState<QuotaError | null>(null);

  useEffect(() => {
    if (!limitReached) return;
    const delay = limitClearDelayMs(limitReached, currentTier, Date.now());
    if (delay === null) return;
    if (delay === 0) {
      setLimitReached(null);
      return;
    }
    const timer = setTimeout(() => setLimitReached(null), delay);
    return () => clearTimeout(timer);
  }, [limitReached, currentTier]);

  return [limitReached, setLimitReached];
}
