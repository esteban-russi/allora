/** Tests for the Firestore HabitStore; the contract suite needs FIRESTORE_TEST=1 and FIRESTORE_TEST_PROJECT. */
import { randomUUID } from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, describe } from 'vitest';
import { FirestoreHabitStore } from '../src/product/server/firestoreHabitStore';
import { describeHabitStoreContract } from './helpers/habitStoreContract';

const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreHabitStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.FIRESTORE_TEST_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const runs: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(runs.map((id) => db.recursiveDelete(db.doc(`testRuns/${id}`))));
    await db.terminate();
  });

  describeHabitStoreContract('FirestoreHabitStore', (options) => {
    const runId = randomUUID();
    runs.push(runId);
    const collectionName = `testRuns/${runId}/learnerHabits`;
    return new FirestoreHabitStore(db!, { collectionName, now: options?.now });
  });
});
