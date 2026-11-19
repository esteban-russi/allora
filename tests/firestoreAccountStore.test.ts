/** Tests for FirestoreAccountStore; contract suite runs when FIRESTORE_TEST=1. */
import { randomUUID } from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FirestoreAccountStore,
  fromAccountDocument
} from '../src/server/firestoreAccountStore';
import { runAccountStoreContract } from './helpers/accountStoreContract';

describe('fromAccountDocument', () => {
  it('parses account document correctly', () => {
    const raw = {
      userId: 'u1',
      email: 'user1@example.com',
      isAnonymous: false,
      subscription: null,
      createdAt: '2026-11-18T10:00:00.000Z',
      lastSeenAt: '2026-11-18T10:00:00.000Z',
      expiresAtTs: { toDate: () => new Date() }
    };
    const parsed = fromAccountDocument(raw);
    expect(parsed.userId).toBe('u1');
    expect(parsed.email).toBe('user1@example.com');
    expect(parsed.isAnonymous).toBe(false);
    expect(parsed.subscription).toBeNull();
    expect((parsed as any).expiresAtTs).toBeUndefined();
  });
});

const runAgainstFirestore = process.env.FIRESTORE_TEST === '1';

describe.skipIf(!runAgainstFirestore)('FirestoreAccountStore against Firestore', () => {
  const db = runAgainstFirestore
    ? new Firestore({ projectId: process.env.FIRESTORE_TEST_PROJECT, ignoreUndefinedProperties: true })
    : null;
  const runs: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await Promise.all(runs.map((id) => db.recursiveDelete(db.doc(`testRuns/${id}`))));
    await db.terminate();
  });

  runAccountStoreContract('FirestoreAccountStore', ({ now }) => {
    const runId = randomUUID();
    runs.push(runId);
    const collectionName = `testRuns/${runId}/users`;
    return new FirestoreAccountStore(db!, { collectionName, now });
  });
});
