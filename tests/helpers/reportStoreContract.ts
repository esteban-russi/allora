/** Behaviour every ReportStore must have, run against each implementation. */
import { describe, expect, it } from 'vitest';
import type { Report, ReportStore } from '../../src/server/reportStore';

export interface ReportStoreFixture {
  store: ReportStore;
  listByUser: (userId: string) => Promise<Report[]>;
}

export type ReportStoreFactory = () => ReportStoreFixture;

/**
 * Register the shared ReportStore behaviour contract tests.
 *
 * Args:
 *   name: Implementation name shown in test output.
 *   makeFixture: Factory for a fresh, empty store plus read helper.
 */
export function runReportStoreContract(name: string, makeFixture: ReportStoreFactory): void {
  describe(`${name} (ReportStore contract)`, () => {
    const sampleReport = (overrides: Partial<Report> = {}): Report => ({
      id: 'rep_1',
      userId: 'u1',
      sessionId: 'sess_1',
      source: 'chat',
      text: 'Ciao, risposta sbagliata.',
      reason: 'inaccurate',
      comment: 'Grammar note was wrong',
      createdAt: '2026-11-19T10:00:00.000Z',
      ...overrides
    });

    it('stores a report with all fields intact', async () => {
      const { store, listByUser } = makeFixture();
      const report = sampleReport({ sessionId: null, comment: '' });

      await store.addReport(report);

      const stored = await listByUser('u1');
      expect(stored).toEqual([report]);
    });

    it('deleteAllUserReports removes only that user’s reports and returns the deleted count', async () => {
      const { store, listByUser } = makeFixture();
      const r1 = sampleReport({ id: 'rep_1', userId: 'u1' });
      const r2 = sampleReport({ id: 'rep_2', userId: 'u1', source: 'call', reason: 'harmful' });
      const r3 = sampleReport({ id: 'rep_3', userId: 'u2', reason: 'other' });

      await store.addReport(r1);
      await store.addReport(r2);
      await store.addReport(r3);

      expect(await store.deleteAllUserReports('u1')).toBe(2);
      expect(await listByUser('u1')).toEqual([]);
      expect(await listByUser('u2')).toEqual([r3]);
      expect(await store.deleteAllUserReports('u1')).toBe(0);
    });

    it('transferUserReports moves all reports to the destination user without touching others', async () => {
      const { store, listByUser } = makeFixture();
      const guestReport = sampleReport({ id: 'rep_g1', userId: 'anon-1', reason: 'harmful' });
      const targetReport = sampleReport({ id: 'rep_u1', userId: 'u1', reason: 'inaccurate' });
      const otherReport = sampleReport({ id: 'rep_u2', userId: 'u2', reason: 'other' });

      await store.addReport(guestReport);
      await store.addReport(targetReport);
      await store.addReport(otherReport);

      expect(await store.transferUserReports('anon-1', 'u1')).toBe(1);
      expect(await store.transferUserReports('anon-1', 'u1')).toBe(0);

      expect(await listByUser('anon-1')).toEqual([]);
      const targetReports = await listByUser('u1');
      expect(targetReports).toHaveLength(2);
      expect(targetReports).toEqual(
        expect.arrayContaining([targetReport, { ...guestReport, userId: 'u1' }])
      );
      expect(await listByUser('u2')).toEqual([otherReport]);
    });
  });
}
