/** Chooses this server's HabitStore from the HABIT_STORE environment variable. */
import { Firestore } from '@google-cloud/firestore';
import { FirestoreHabitStore } from './firestoreHabitStore';
import { InMemoryHabitStore, type HabitStore } from './habitStore';

/**
 * Create the habit store named by HABIT_STORE.
 *
 * Args:
 *   env: Environment with HABIT_STORE ("memory", the default, or "firestore") and,
 *     for Firestore, GCP_PROJECT (auto-detected when empty). Credentials come from
 *     Application Default Credentials.
 *
 * Returns:
 *   The configured HabitStore.
 *
 * Raises:
 *   Error: If HABIT_STORE has any other value.
 */
export function createHabitStore(env: NodeJS.ProcessEnv = process.env): HabitStore {
  const kind = env.HABIT_STORE?.trim() || 'memory';
  if (kind === 'memory') return new InMemoryHabitStore();
  if (kind === 'firestore') {
    return new FirestoreHabitStore(
      new Firestore({ projectId: env.GCP_PROJECT || undefined, ignoreUndefinedProperties: true })
    );
  }
  throw new Error(`HABIT_STORE must be "memory" or "firestore", got "${kind}"`);
}

/** The habit store shared across the HTTP routes and Live bridge; created when the server loads. */
export const defaultHabitStore = createHabitStore();
