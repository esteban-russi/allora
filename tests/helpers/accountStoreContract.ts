/** Behaviour every AccountStore must have, run against each implementation. */
import { describe, expect, it } from 'vitest';
import type { AccountStore, Consent, Subscription } from '../../src/server/accountStore';

export type AccountStoreFactory = (options: { now: () => number }) => AccountStore;

/**
 * Register the shared AccountStore behaviour contract tests.
 *
 * Args:
 *   name: Implementation name shown in test output.
 *   makeStore: Factory for a fresh, empty store.
 */
export function runAccountStoreContract(name: string, makeStore: AccountStoreFactory): void {
  describe(`${name} (AccountStore contract)`, () => {
    let clock = Date.parse('2026-11-18T10:00:00.000Z');
    const setup = () => {
      clock = Date.parse('2026-11-18T10:00:00.000Z');
      return makeStore({ now: () => clock });
    };

    const sampleSub: Subscription = {
      status: 'active',
      productId: 'allora_pro_annual',
      store: 'web',
      periodType: 'normal',
      expiresAt: '2026-12-01T00:00:00.000Z',
      willRenew: true,
      updatedAt: '2026-11-18T10:00:00.000Z'
    };

    const sampleConsent: Consent = {
      termsVersion: '2026-11',
      acceptedAt: '2026-11-18T10:05:00.000Z'
    };

    it('creates an account on first upsert', async () => {
      const store = setup();
      const account = await store.upsertFromAuth({
        userId: 'u1',
        email: 'user1@example.com',
        isAnonymous: false
      });

      expect(account.userId).toBe('u1');
      expect(account.email).toBe('user1@example.com');
      expect(account.isAnonymous).toBe(false);
      expect(account.subscription).toBeNull();
      expect(account.consent).toBeNull();
      expect(account.createdAt).toBe('2026-11-18T10:00:00.000Z');
      expect(account.lastSeenAt).toBe('2026-11-18T10:00:00.000Z');

      const fetched = await store.getAccount('u1');
      expect(fetched).toEqual(account);
    });

    it('does not change createdAt or lastSeenAt on second upsert with same data within 24h', async () => {
      const store = setup();
      const first = await store.upsertFromAuth({
        userId: 'u2',
        email: 'user2@example.com',
        isAnonymous: true
      });

      clock += 60 * 60 * 1000; // 1 hour later
      const second = await store.upsertFromAuth({
        userId: 'u2',
        email: 'user2@example.com',
        isAnonymous: true
      });

      expect(second.createdAt).toBe(first.createdAt);
      expect(second.lastSeenAt).toBe(first.lastSeenAt);
    });

    it('updates lastSeenAt when older than 24h even if other data did not change', async () => {
      const store = setup();
      const first = await store.upsertFromAuth({
        userId: 'u2b',
        email: 'user2b@example.com',
        isAnonymous: false
      });

      clock += 25 * 60 * 60 * 1000; // 25 hours later
      const second = await store.upsertFromAuth({
        userId: 'u2b',
        email: 'user2b@example.com',
        isAnonymous: false
      });

      expect(second.createdAt).toBe(first.createdAt);
      expect(second.lastSeenAt).toBe(new Date(clock).toISOString());
    });

    it('updates the record and keeps subscription and consent when isAnonymous changes from true to false', async () => {
      const store = setup();
      await store.upsertFromAuth({ userId: 'u3', isAnonymous: true });
      await store.setSubscription('u3', sampleSub);
      await store.setConsent('u3', sampleConsent);

      clock += 1000;
      const updated = await store.upsertFromAuth({
        userId: 'u3',
        email: 'u3@example.com',
        isAnonymous: false
      });

      expect(updated.isAnonymous).toBe(false);
      expect(updated.email).toBe('u3@example.com');
      expect(updated.subscription).toEqual(sampleSub);
      expect(updated.consent).toEqual(sampleConsent);

      const fetched = await store.getAccount('u3');
      expect(fetched?.isAnonymous).toBe(false);
      expect(fetched?.subscription).toEqual(sampleSub);
      expect(fetched?.consent).toEqual(sampleConsent);
    });

    it('returns subscription after setSubscription', async () => {
      const store = setup();
      await store.upsertFromAuth({ userId: 'u4', isAnonymous: false });
      await store.setSubscription('u4', sampleSub);

      const fetched = await store.getAccount('u4');
      expect(fetched?.subscription).toEqual(sampleSub);

      await store.setSubscription('u4', null);
      const cleared = await store.getAccount('u4');
      expect(cleared?.subscription).toBeNull();
    });

    it('creates nothing and does not throw when setSubscription targets an unknown user', async () => {
      const store = setup();
      await expect(store.setSubscription('missing-user', sampleSub)).resolves.toBeUndefined();
      expect(await store.getAccount('missing-user')).toBeNull();
    });

    it('stores and updates consent after setConsent', async () => {
      const store = setup();
      await store.upsertFromAuth({ userId: 'u4c', isAnonymous: false });
      await store.setConsent('u4c', sampleConsent);

      const fetched = await store.getAccount('u4c');
      expect(fetched?.consent).toEqual(sampleConsent);

      const newer: Consent = { termsVersion: '2027-01', acceptedAt: '2027-01-02T00:00:00.000Z' };
      await store.setConsent('u4c', newer);
      expect((await store.getAccount('u4c'))?.consent).toEqual(newer);
    });

    it('creates nothing and does not throw when setConsent targets an unknown user', async () => {
      const store = setup();
      await expect(store.setConsent('missing-user', sampleConsent)).resolves.toBeUndefined();
      expect(await store.getAccount('missing-user')).toBeNull();
    });

    it('returns true then false on deleteAccount', async () => {
      const store = setup();
      await store.upsertFromAuth({ userId: 'u5', isAnonymous: true });

      expect(await store.deleteAccount('u5')).toBe(true);
      expect(await store.getAccount('u5')).toBeNull();
      expect(await store.deleteAccount('u5')).toBe(false);
    });
  });
}
