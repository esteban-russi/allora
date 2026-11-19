/** Plan limits and tier determination rules. */
import type { Account, Tier } from './accountStore';

export interface PlanLimits {
  chatMessages: number;
  voiceSeconds: number;
  helperRequests: number;
}

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  guest: { chatMessages: 5, voiceSeconds: 2 * 60, helperRequests: 30 },
  free: { chatMessages: 15, voiceSeconds: 5 * 60, helperRequests: 100 },
  premium: { chatMessages: 300, voiceSeconds: 30 * 60, helperRequests: 1000 }
};

/**
 * Determine the tier of a user account at a specific timestamp.
 *
 * Args:
 *   account: Stored learner account.
 *   nowMs: Current timestamp in milliseconds.
 *
 * Returns:
 *   'premium' if subscription is active/grace and not expired,
 *   otherwise 'guest' if anonymous, else 'free'.
 */
export function tierFor(account: Account, nowMs: number): Tier {
  if (
    account.subscription &&
    (account.subscription.status === 'active' || account.subscription.status === 'grace') &&
    Date.parse(account.subscription.expiresAt) > nowMs
  ) {
    return 'premium';
  }
  return account.isAnonymous ? 'guest' : 'free';
}
