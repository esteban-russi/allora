/** Tests for choosing the report store from the environment. */
import { describe, expect, it } from 'vitest';
import { createReportStore } from '../src/server/defaultReportStore';
import { FirestoreReportStore, InMemoryReportStore } from '../src/server/reportStore';

describe('createReportStore', () => {
  it.each([{}, { SESSION_STORE: '' }, { SESSION_STORE: 'memory' }])('uses memory for %j', (env) => {
    expect(createReportStore(env)).toBeInstanceOf(InMemoryReportStore);
  });

  it('uses Firestore when asked', () => {
    expect(createReportStore({ SESSION_STORE: 'firestore', GCP_PROJECT: 'demo' })).toBeInstanceOf(
      FirestoreReportStore
    );
  });

  it('rejects an unknown store name', () => {
    expect(() => createReportStore({ SESSION_STORE: 'redis' })).toThrow('SESSION_STORE must be');
  });
});
