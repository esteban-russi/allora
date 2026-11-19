/** Account records, subscription metadata, and storage contracts. */

export type Tier = 'guest' | 'free' | 'premium';

export interface Subscription {
  status: 'active' | 'grace' | 'expired';
  productId: string; // e.g. "parliamo_pro_annual"
  store: 'play_store' | 'web';
  periodType: 'trial' | 'normal';
  expiresAt: string; // ISO time
  willRenew: boolean;
  managementUrl?: string | null;
  updatedAt: string; // ISO time
}

export interface Account {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  subscription: Subscription | null; // null until plan 05 writes it
  createdAt: string; // ISO time
  lastSeenAt: string; // ISO time
}

export interface AccountStore {
  /** Create the record if missing; update email/isAnonymous/lastSeenAt if they changed. */
  upsertFromAuth(user: { userId: string; email?: string; isAnonymous: boolean }): Promise<Account>;
  getAccount(userId: string): Promise<Account | null>;
  setSubscription(userId: string, subscription: Subscription | null): Promise<void>;
  deleteAccount(userId: string): Promise<boolean>;
}

/**
 * In-memory AccountStore, for local development and tests.
 *
 * Accounts are copied on the way in and out so callers cannot mutate stored state directly.
 */
export class InMemoryAccountStore implements AccountStore {
  private accounts = new Map<string, Account>();

  constructor(private now: () => number = Date.now) {}

  /**
   * Create account if missing or update if email, anonymity, or last seen has changed.
   *
   * Args:
   *   user: Authenticated user details.
   *
   * Returns:
   *   The created or updated Account.
   */
  async upsertFromAuth(user: { userId: string; email?: string; isAnonymous: boolean }): Promise<Account> {
    const existing = this.accounts.get(user.userId);
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const email = user.email ?? null;

    if (!existing) {
      const created: Account = {
        userId: user.userId,
        email,
        isAnonymous: user.isAnonymous,
        subscription: null,
        createdAt: nowIso,
        lastSeenAt: nowIso
      };
      this.accounts.set(user.userId, structuredClone(created));
      return structuredClone(created);
    }

    const emailChanged = existing.email !== email;
    const anonChanged = existing.isAnonymous !== user.isAnonymous;
    const lastSeenAge = nowMs - Date.parse(existing.lastSeenAt);
    const staleLastSeen = Number.isNaN(lastSeenAge) || lastSeenAge >= 24 * 60 * 60 * 1000;

    if (emailChanged || anonChanged || staleLastSeen) {
      const updated: Account = {
        ...existing,
        email,
        isAnonymous: user.isAnonymous,
        lastSeenAt: nowIso
      };
      this.accounts.set(user.userId, structuredClone(updated));
      return structuredClone(updated);
    }

    return structuredClone(existing);
  }

  /**
   * Retrieve an account by user ID.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   The Account if found, or null.
   */
  async getAccount(userId: string): Promise<Account | null> {
    const account = this.accounts.get(userId);
    return account ? structuredClone(account) : null;
  }

  /**
   * Set or clear subscription for an existing account.
   *
   * Args:
   *   userId: Target user identifier.
   *   subscription: Subscription record or null.
   */
  async setSubscription(userId: string, subscription: Subscription | null): Promise<void> {
    const existing = this.accounts.get(userId);
    if (!existing) return;
    existing.subscription = subscription ? structuredClone(subscription) : null;
  }

  /**
   * Delete an account record.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   True if deleted, false if not found.
   */
  async deleteAccount(userId: string): Promise<boolean> {
    return this.accounts.delete(userId);
  }
}
