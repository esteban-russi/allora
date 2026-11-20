/** Behaviour every UsageStore must have, run against each implementation. */
import { describe, expect, it } from 'vitest';
import {
  nextResetAt,
  usageDay,
  type UsageStore
} from '../../src/platform/server/usageStore';

export type UsageStoreFactory = () => UsageStore;

/**
 * Register the shared UsageStore behaviour contract tests.
 *
 * Args:
 *   name: Implementation name shown in test output.
 *   makeStore: Factory for a fresh, empty store.
 */
export function runUsageStoreContract(name: string, makeStore: UsageStoreFactory): void {
  describe(`${name} (UsageStore contract)`, () => {
    it('returns all zeros for empty usage', async () => {
      const store = makeStore();
      const usage = await store.getUsage('u1', '2026-11-18');
      expect(usage).toEqual({ chatMessages: 0, voiceSeconds: 0, helperRequests: 0 });
    });

    it('tryConsume up to the limit succeeds and the next one fails without changing used', async () => {
      const store = makeStore();
      const day = '2026-11-18';

      // Limit 3: first 3 calls should succeed
      expect(await store.tryConsume('u2', day, 'chatMessages', 1, 3)).toEqual({
        allowed: true,
        used: 1
      });
      expect(await store.tryConsume('u2', day, 'chatMessages', 1, 3)).toEqual({
        allowed: true,
        used: 2
      });
      expect(await store.tryConsume('u2', day, 'chatMessages', 1, 3)).toEqual({
        allowed: true,
        used: 3
      });

      // 4th call should be rejected and used remains 3
      expect(await store.tryConsume('u2', day, 'chatMessages', 1, 3)).toEqual({
        allowed: false,
        used: 3
      });

      const current = await store.getUsage('u2', day);
      expect(current.chatMessages).toBe(3);
    });

    it('20 parallel tryConsume calls with limit 10 allow exactly 10', async () => {
      const store = makeStore();
      const day = '2026-11-18';
      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.tryConsume('u3', day, 'helperRequests', 1, 10))
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(10);

      const usage = await store.getUsage('u3', day);
      expect(usage.helperRequests).toBe(10);
    });

    it('add with a negative amount never goes below 0', async () => {
      const store = makeStore();
      const day = '2026-11-18';

      await store.add('u4', day, 'voiceSeconds', 15);
      expect((await store.getUsage('u4', day)).voiceSeconds).toBe(15);

      await store.add('u4', day, 'voiceSeconds', -10);
      expect((await store.getUsage('u4', day)).voiceSeconds).toBe(5);

      await store.add('u4', day, 'voiceSeconds', -20);
      expect((await store.getUsage('u4', day)).voiceSeconds).toBe(0);
    });

    it('different days and users are independent', async () => {
      const store = makeStore();
      await store.tryConsume('userA', '2026-11-18', 'chatMessages', 5, 10);
      await store.tryConsume('userA', '2026-11-19', 'chatMessages', 2, 10);
      await store.tryConsume('userB', '2026-11-18', 'chatMessages', 1, 10);

      expect((await store.getUsage('userA', '2026-11-18')).chatMessages).toBe(5);
      expect((await store.getUsage('userA', '2026-11-19')).chatMessages).toBe(2);
      expect((await store.getUsage('userB', '2026-11-18')).chatMessages).toBe(1);
      expect((await store.getUsage('userB', '2026-11-19')).chatMessages).toBe(0);
    });

    it('deleteAllUserUsage removes every day for that user only', async () => {
      const store = makeStore();
      await store.add('targetUser', '2026-11-17', 'chatMessages', 1);
      await store.add('targetUser', '2026-11-18', 'chatMessages', 2);
      await store.add('otherUser', '2026-11-18', 'chatMessages', 3);

      const deletedCount = await store.deleteAllUserUsage('targetUser');
      expect(deletedCount).toBe(2);

      expect((await store.getUsage('targetUser', '2026-11-17')).chatMessages).toBe(0);
      expect((await store.getUsage('targetUser', '2026-11-18')).chatMessages).toBe(0);
      expect((await store.getUsage('otherUser', '2026-11-18')).chatMessages).toBe(3);
    });
  });
}

describe('usageDay and nextResetAt', () => {
  it('handles 23:59:59 UTC boundary', () => {
    const ts = Date.parse('2026-11-18T23:59:59.000Z');
    expect(usageDay(ts)).toBe('2026-11-18');
    expect(nextResetAt(ts)).toBe('2026-11-19T00:00:00.000Z');
  });

  it('handles 00:00:00 UTC boundary', () => {
    const ts = Date.parse('2026-11-18T00:00:00.000Z');
    expect(usageDay(ts)).toBe('2026-11-18');
    expect(nextResetAt(ts)).toBe('2026-11-19T00:00:00.000Z');
  });
});
