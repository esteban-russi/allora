/** Tests for the Firestore SessionStore; the contract suite needs FIRESTORE_TEST=1 and a database. */
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

// Runs against the emulator (FIRESTORE_EMULATOR_HOST) or a real database, in throwaway collections
const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreSessionStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.GCP_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const collections: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(collections.map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate();
  });

  describeSessionStoreContract('FirestoreSessionStore', ({ retentionMs, now }) => {
    const collectionName = `test_learnerSessions_${randomUUID()}`;
    collections.push(collectionName);
    return new FirestoreSessionStore(db!, { collectionName, retentionMs, now });
  });
});
