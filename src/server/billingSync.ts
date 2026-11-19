/** Synchronize RevenueCat subscriber state to learner account storage.
 * Fetches subscriber record from RevenueCat and updates the local user account.
 */
import type { AccountStore, Subscription } from './accountStore';
import { invalidateAccountCache } from './accountMiddleware';
import { toSubscription, type RevenueCatClient } from './revenueCat';

export interface BillingSyncDeps {
  revenueCat: RevenueCatClient;
  accounts: AccountStore;
  now?: () => number;
}

/**
 * Synchronize subscription status for a user from RevenueCat to local account storage.
 *
 * Args:
 *   userId: Target user identifier.
 *   deps: Required dependencies (RevenueCatClient, AccountStore, now clock).
 *
 * Returns:
 *   Mapped Subscription or null if no active entitlement or anonymous RC ID.
 */
export async function syncSubscription(
  userId: string,
  deps: BillingSyncDeps
): Promise<Subscription | null> {
  if (userId.startsWith('$RCAnonymousID:')) {
    return null;
  }

  const nowMs = deps.now ? deps.now() : Date.now();
  const rawSubscriber = await deps.revenueCat.getSubscriber(userId);
  const subscription = rawSubscriber ? toSubscription(rawSubscriber, nowMs) : null;

  await deps.accounts.setSubscription(userId, subscription);
  invalidateAccountCache(userId);

  return subscription;
}
