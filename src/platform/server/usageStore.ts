/** Daily usage tracking and store contracts for chat, voice, and helper limits. */

export type UsageCounter = 'chatMessages' | 'voiceSeconds' | 'helperRequests';
export type DailyUsage = Record<UsageCounter, number>;
export const EMPTY_USAGE: DailyUsage = { chatMessages: 0, voiceSeconds: 0, helperRequests: 0 };

/**
 * Format a UTC day key (YYYY-MM-DD) for a given millisecond timestamp.
 *
 * Args:
 *   nowMs: Current timestamp in milliseconds.
 *
 * Returns:
 *   String formatted as YYYY-MM-DD in UTC.
 */
export function usageDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Compute the ISO timestamp of the next 00:00 UTC boundary after nowMs.
 *
 * Args:
 *   nowMs: Current timestamp in milliseconds.
 *
 * Returns:
 *   ISO timestamp string of the next 00:00:00.000Z.
 */
export function nextResetAt(nowMs: number): string {
  const d = new Date(nowMs);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
  return next.toISOString();
}

export interface UsageStore {
  /** Retrieve daily usage counters for a user on a given UTC day. */
  getUsage(userId: string, day: string): Promise<DailyUsage>;

  /** Add amount only if the resulting count stays <= limit. Atomic. */
  tryConsume(
    userId: string,
    day: string,
    counter: UsageCounter,
    amount: number,
    limit: number
  ): Promise<{ allowed: boolean; used: number }>;

  /** Add amount unconditionally (may be negative for refunds, never goes below 0). */
  add(userId: string, day: string, counter: UsageCounter, amount: number): Promise<void>;

  /** Delete all usage records across all days for a specific user. */
  deleteAllUserUsage(userId: string): Promise<number>;
}

/**
 * In-memory UsageStore for local development and test execution.
 */
export class InMemoryUsageStore implements UsageStore {
  private usage = new Map<string, DailyUsage>();

  private key(userId: string, day: string): string {
    return `${userId}_${day}`;
  }

  /**
   * Retrieve daily usage for a user.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *
   * Returns:
   *   Current counters, or zeros if not recorded.
   */
  async getUsage(userId: string, day: string): Promise<DailyUsage> {
    const existing = this.usage.get(this.key(userId, day));
    return existing ? { ...existing } : { ...EMPTY_USAGE };
  }

  /**
   * Atomically try to consume a quota amount.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *   counter: Counter to increment.
   *   amount: Number of units to consume.
   *   limit: Maximum allowed units.
   *
   * Returns:
   *   Whether consumption was allowed and the resulting/current usage.
   */
  async tryConsume(
    userId: string,
    day: string,
    counter: UsageCounter,
    amount: number,
    limit: number
  ): Promise<{ allowed: boolean; used: number }> {
    const key = this.key(userId, day);
    const existing = this.usage.get(key) ?? { ...EMPTY_USAGE };
    const current = existing[counter];

    if (current + amount <= limit) {
      const nextUsed = current + amount;
      const updated: DailyUsage = { ...existing, [counter]: nextUsed };
      this.usage.set(key, updated);
      return { allowed: true, used: nextUsed };
    }

    return { allowed: false, used: current };
  }

  /**
   * Add or refund an amount to a usage counter unconditionally.
   *
   * Args:
   *   userId: Target user identifier.
   *   day: Target UTC day (YYYY-MM-DD).
   *   counter: Counter to adjust.
   *   amount: Number of units to add (negative for refunds).
   */
  async add(userId: string, day: string, counter: UsageCounter, amount: number): Promise<void> {
    const key = this.key(userId, day);
    const existing = this.usage.get(key) ?? { ...EMPTY_USAGE };
    const nextUsed = Math.max(0, existing[counter] + amount);
    this.usage.set(key, { ...existing, [counter]: nextUsed });
  }

  /**
   * Delete all usage documents for a specific user across all days.
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   Number of deleted daily records.
   */
  async deleteAllUserUsage(userId: string): Promise<number> {
    let deleted = 0;
    const prefix = `${userId}_`;
    for (const key of Array.from(this.usage.keys())) {
      if (key.startsWith(prefix)) {
        this.usage.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}
