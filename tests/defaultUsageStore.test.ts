/** Tests for choosing the usage store from the environment. */
import { describe, expect, it } from 'vitest';
import { createUsageStore } from '../src/platform/server/defaultUsageStore';
import { FirestoreUsageStore } from '../src/platform/server/firestoreUsageStore';
import { InMemoryUsageStore } from '../src/platform/server/usageStore';

describe('createUsageStore', () => {
  it.each([{}, { SESSION_STORE: '' }, { SESSION_STORE: 'memory' }])('uses memory for %j', (env) => {
    expect(createUsageStore(env)).toBeInstanceOf(InMemoryUsageStore);
  });

  it('uses Firestore when asked', () => {
    expect(createUsageStore({ SESSION_STORE: 'firestore', GCP_PROJECT: 'demo' })).toBeInstanceOf(
      FirestoreUsageStore
    );
  });

  it('rejects an unknown store name', () => {
    expect(() => createUsageStore({ SESSION_STORE: 'redis' })).toThrow('SESSION_STORE must be');
  });
});
