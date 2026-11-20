/** Tests for choosing the account store from the environment. */
import { describe, expect, it } from 'vitest';
import { InMemoryAccountStore } from '../src/platform/server/accountStore';
import { createAccountStore } from '../src/platform/server/defaultAccountStore';
import { FirestoreAccountStore } from '../src/platform/server/firestoreAccountStore';

describe('createAccountStore', () => {
  it.each([{}, { SESSION_STORE: '' }, { SESSION_STORE: 'memory' }])('uses memory for %j', (env) => {
    expect(createAccountStore(env)).toBeInstanceOf(InMemoryAccountStore);
  });

  it('uses Firestore when asked', () => {
    expect(createAccountStore({ SESSION_STORE: 'firestore', GCP_PROJECT: 'demo' })).toBeInstanceOf(
      FirestoreAccountStore
    );
  });

  it('rejects an unknown store name', () => {
    expect(() => createAccountStore({ SESSION_STORE: 'redis' })).toThrow('SESSION_STORE must be');
  });
});
