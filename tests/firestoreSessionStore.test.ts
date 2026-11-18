/** Tests for the Firestore SessionStore's document conversion. */
import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import { fromSessionDocument, toSessionDocument } from '../src/server/firestoreSessionStore';
import { initializeLearnerSession } from '../src/server/sessionStore';

describe('session documents', () => {
  it('adds a TTL timestamp matching expiresAt and strips it again on read', () => {
    const session = initializeLearnerSession({ userId: 'u' });
    const doc = toSessionDocument(session);

    expect(doc.expiresAtTs).toBeInstanceOf(Timestamp);
    expect((doc.expiresAtTs as Timestamp).toDate().toISOString()).toBe(session.expiresAt);
    expect(fromSessionDocument(doc)).toEqual(session);
  });
});
