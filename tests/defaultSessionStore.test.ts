/** Tests for choosing the session store from the environment. */
import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../src/product/server/defaultSessionStore';
import { FirestoreSessionStore } from '../src/product/server/firestoreSessionStore';
import { InMemorySessionStore } from '../src/product/server/sessionStore';

describe('createSessionStore', () => {
  it.each([{}, { SESSION_STORE: '' }, { SESSION_STORE: 'memory' }])('uses memory for %j', (env) => {
    expect(createSessionStore(env)).toBeInstanceOf(InMemorySessionStore);
  });

  it('uses Firestore when asked', () => {
    expect(createSessionStore({ SESSION_STORE: 'firestore', GCP_PROJECT: 'demo' })).toBeInstanceOf(FirestoreSessionStore);
  });

  it('rejects an unknown store name', () => {
    expect(() => createSessionStore({ SESSION_STORE: 'redis' })).toThrow('SESSION_STORE must be');
  });
});
