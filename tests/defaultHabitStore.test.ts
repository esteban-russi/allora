/** Tests for choosing the habit store from environment variables. */
import { describe, expect, it } from 'vitest';
import { createHabitStore } from '../src/product/server/defaultHabitStore';
import { FirestoreHabitStore } from '../src/product/server/firestoreHabitStore';
import { InMemoryHabitStore } from '../src/product/server/habitStore';

describe('createHabitStore', () => {
  it.each([{}, { HABIT_STORE: '' }, { HABIT_STORE: 'memory' }])('uses memory for %j', (env) => {
    expect(createHabitStore(env)).toBeInstanceOf(InMemoryHabitStore);
  });

  it('uses Firestore when asked', () => {
    expect(createHabitStore({ HABIT_STORE: 'firestore', GCP_PROJECT: 'demo' })).toBeInstanceOf(
      FirestoreHabitStore
    );
  });

  it('rejects an unknown store name', () => {
    expect(() => createHabitStore({ HABIT_STORE: 'redis' })).toThrow('HABIT_STORE must be');
  });
});
