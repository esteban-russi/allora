/** Tests for the Firestore SessionStore; the contract suite needs FIRESTORE_TEST=1 and FIRESTORE_TEST_PROJECT. */
import { randomUUID } from 'crypto';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FirestoreSessionStore,
  fromSessionDocument,
  toSessionDocument
} from '../src/server/firestoreSessionStore';
import { initializeLearnerSession } from '../src/server/sessionStore';
import { describeSessionStoreContract } from './helpers/sessionStoreContract';

describe('session documents', () => {
  it('adds a TTL timestamp matching expiresAt and strips it again on read', () => {
    const session = initializeLearnerSession({ userId: 'u' });
    const doc = toSessionDocument(session);

    expect(doc.expiresAtTs).toBeInstanceOf(Timestamp);
    expect((doc.expiresAtTs as Timestamp).toDate().toISOString()).toBe(session.expiresAt);
    expect(fromSessionDocument(doc)).toEqual(session);
  });
});

// Runs against the emulator (FIRESTORE_EMULATOR_HOST) or a real database. vitest.config.ts blanks
// GCP_PROJECT, so the project comes from FIRESTORE_TEST_PROJECT. Each store gets its own
// testRuns/<id>/learnerSessions collection: same collection ID, so the real index and TTL apply.
const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreSessionStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.FIRESTORE_TEST_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const runs: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(runs.map((id) => db.recursiveDelete(db.doc(`testRuns/${id}`))));
    await db.terminate();
  });

  describeSessionStoreContract('FirestoreSessionStore', ({ retentionMs, now }) => {
    const runId = randomUUID();
    runs.push(runId);
    const collectionName = `testRuns/${runId}/learnerSessions`;
    return new FirestoreSessionStore(db!, { collectionName, retentionMs, now });
  });
});
