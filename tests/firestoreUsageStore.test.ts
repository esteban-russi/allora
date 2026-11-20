/** Tests for FirestoreUsageStore; contract suite runs when FIRESTORE_TEST=1. */
import { randomUUID } from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FirestoreUsageStore,
  USAGE_COLLECTION
} from '../src/platform/server/firestoreUsageStore';
import { runUsageStoreContract } from './helpers/usageStoreContract';

describe('USAGE_COLLECTION', () => {
  it('defaults to usage', () => {
    expect(USAGE_COLLECTION).toBe('usage');
  });
});

const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreUsageStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.FIRESTORE_TEST_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const runs: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(runs.map((id) => db.recursiveDelete(db.doc(`testRuns/${id}`))));
    await db.terminate();
  });

  runUsageStoreContract('FirestoreUsageStore', () => {
    const runId = randomUUID();
    runs.push(runId);
    const collectionName = `testRuns/${runId}/usage`;
    return new FirestoreUsageStore(db!, { collectionName });
  });
});
