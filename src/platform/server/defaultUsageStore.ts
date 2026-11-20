/** Chooses this server's UsageStore from the SESSION_STORE environment variable. */
import { Firestore } from '@google-cloud/firestore';
import { FirestoreUsageStore } from './firestoreUsageStore';
import { InMemoryUsageStore, type UsageStore } from './usageStore';

/**
 * Create the usage store named by SESSION_STORE.
 *
 * Args:
 *   env: Environment with SESSION_STORE ("memory", the default, or "firestore") and,
 *     for Firestore, GCP_PROJECT (auto-detected when empty). Credentials come from
 *     Application Default Credentials.
 *
 * Returns:
 *   The configured UsageStore.
 *
 * Raises:
 *   Error: If SESSION_STORE has any other value.
 */
export function createUsageStore(env: NodeJS.ProcessEnv = process.env): UsageStore {
  const kind = env.SESSION_STORE?.trim() || 'memory';
  if (kind === 'memory') return new InMemoryUsageStore();
  if (kind === 'firestore') {
    return new FirestoreUsageStore(
      new Firestore({ projectId: env.GCP_PROJECT || undefined, ignoreUndefinedProperties: true })
    );
  }
  throw new Error(`SESSION_STORE must be "memory" or "firestore", got "${kind}"`);
}

/** The store shared by HTTP routes and the Live bridge; created when the server loads. */
export const defaultUsageStore = createUsageStore();
