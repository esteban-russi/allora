/** Tests for scheduled retention and limiter cleanup. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleMaintenance } from '../src/platform/server/maintenance';
import { InMemorySessionStore, initializeLearnerSession } from '../src/product/server/sessionStore';
import { UserRateLimiter } from '../src/platform/server/rateLimiter';

afterEach(() => vi.useRealTimers());

describe('scheduleMaintenance', () => {
  it('purges sessions that expire later, without anyone reading them', async () => {
    vi.useFakeTimers();
    let nowMs = Date.now();
    const store = new InMemorySessionStore(1000, () => nowMs);
    const session = await store.createOrUpdateSession(initializeLearnerSession({ userId: 'idle-user' }));

    const stop = scheduleMaintenance(store, new UserRateLimiter(), 5000);
    nowMs += 2000;
    await vi.advanceTimersByTimeAsync(5000);

    nowMs = 0; // rewind so getSession's own expiry check cannot be what removes it
    expect(await store.getSession(session.sessionId, 'idle-user')).toBeNull();
    stop();
  });

  it('keeps running after a purge fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new InMemorySessionStore();
    const purge = vi.spyOn(store, 'purgeExpiredSessions').mockRejectedValueOnce(new Error('db down'));

    const stop = scheduleMaintenance(store, new UserRateLimiter(), 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(purge).toHaveBeenCalledTimes(2);
    stop();
  });
});
