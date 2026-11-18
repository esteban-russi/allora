/** Periodic cleanup of expired learner sessions and stale rate-limit windows. */
import type { SessionStore } from './sessionStore';
import type { UserRateLimiter } from './rateLimiter';

export const DEFAULT_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Run cleanup now and then on an interval, so retention is enforced even for
 * sessions nobody reads again and limiter windows don't grow without bound.
 *
 * Args:
 *   sessionStore: Store whose expired sessions are purged.
 *   userLimiter: Limiter whose expired windows are dropped.
 *   intervalMs: Time between runs; defaults to one hour.
 *
 * Returns:
 *   A function that stops the schedule.
 */
export function scheduleMaintenance(
  sessionStore: SessionStore,
  userLimiter: UserRateLimiter,
  intervalMs: number = DEFAULT_MAINTENANCE_INTERVAL_MS
): () => void {
  const run = async (): Promise<void> => {
    userLimiter.cleanup();
    try {
      const purged = await sessionStore.purgeExpiredSessions();
      if (purged > 0) console.log(`[Retention] Purged ${purged} expired learner session(s)`);
    } catch (err) {
      console.error('[Retention] Could not purge expired sessions:', err);
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
