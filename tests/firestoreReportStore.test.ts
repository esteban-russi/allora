/** Tests for FirestoreReportStore; contract suite runs when FIRESTORE_TEST=1. */
import { randomUUID } from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  FirestoreReportStore,
  REPORTS_COLLECTION,
  type Report
} from '../src/platform/server/reportStore';
import { runReportStoreContract } from './helpers/reportStoreContract';

describe('FirestoreReportStore (unit)', () => {
  it('defaults collection name to reports', () => {
    expect(REPORTS_COLLECTION).toBe('reports');
  });

  it('writes report fields without TTL, transfers reports, and deletes in batches', async () => {
    const stored = new Map<string, Report>();
    const setSpy = vi.fn(async (id: string, data: Report) => {
      stored.set(id, { ...data });
    });

    const fakeDb = {
      collection: () => ({
        doc: (id: string) => ({
          id,
          set: (data: Report) => setSpy(id, data)
        }),
        where: (_field: string, _op: string, userId: string) => ({
          limit: () => ({
            get: async () => {
              const docs = Array.from(stored.values())
                .filter((r) => r.userId === userId)
                .map((r) => ({ ref: { id: r.id } }));
              return { empty: docs.length === 0, size: docs.length, docs };
            }
          })
        })
      }),
      batch: () => {
        const ops: Array<() => void> = [];
        return {
          update: (ref: { id: string }, data: Partial<Report>) =>
            ops.push(() => {
              const cur = stored.get(ref.id);
              if (cur) stored.set(ref.id, { ...cur, ...data });
            }),
          delete: (ref: { id: string }) => ops.push(() => stored.delete(ref.id)),
          commit: async () => {
            for (const op of ops) op();
          }
        };
      }
    } as unknown as Firestore;

    const store = new FirestoreReportStore(fakeDb);
    const report: Report = {
      id: 'rep_1',
      userId: 'anon-1',
      sessionId: 'sess_1',
      source: 'chat',
      text: 'Bad reply',
      reason: 'harmful',
      comment: 'Offensive',
      createdAt: '2026-11-19T12:00:00.000Z'
    };

    await store.addReport(report);
    expect(setSpy).toHaveBeenCalledWith('rep_1', report);
    expect((stored.get('rep_1') as any).expiresAtTs).toBeUndefined();

    expect(await store.transferUserReports('anon-1', 'u1')).toBe(1);
    expect(stored.get('rep_1')?.userId).toBe('u1');

    expect(await store.deleteAllUserReports('u1')).toBe(1);
    expect(stored.size).toBe(0);
  });
});

const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreReportStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.FIRESTORE_TEST_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const runs: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(runs.map((id) => db.recursiveDelete(db.doc(`testRuns/${id}`))));
    await db.terminate();
  });

  runReportStoreContract('FirestoreReportStore', () => {
    const runId = randomUUID();
    runs.push(runId);
    const collectionName = `testRuns/${runId}/reports`;
    return {
      store: new FirestoreReportStore(db!, { collectionName }),
      listByUser: async (userId) => {
        const snap = await db!.collection(collectionName).where('userId', '==', userId).get();
        return snap.docs.map((doc) => doc.data() as Report);
      }
    };
  });
});
