/** Chooses this server's AccountStore from the SESSION_STORE environment variable. */
import { Firestore } from '@google-cloud/firestore';
import { InMemoryAccountStore, type AccountStore } from './accountStore';
import { FirestoreAccountStore } from './firestoreAccountStore';

/**
 * Create the account store named by SESSION_STORE.
 *
 * Args:
 *   env: Environment with SESSION_STORE ("memory", the default, or "firestore") and,
 *     for Firestore, GCP_PROJECT (auto-detected when empty). Credentials come from
 *     Application Default Credentials.
 *
 * Returns:
 *   The configured AccountStore.
 *
 * Raises:
 *   Error: If SESSION_STORE has any other value.
 */
export function createAccountStore(env: NodeJS.ProcessEnv = process.env): AccountStore {
  const kind = env.SESSION_STORE?.trim() || 'memory';
  if (kind === 'memory') return new InMemoryAccountStore();
  if (kind === 'firestore') {
    return new FirestoreAccountStore(
      new Firestore({ projectId: env.GCP_PROJECT || undefined, ignoreUndefinedProperties: true })
    );
  }
  throw new Error(`SESSION_STORE must be "memory" or "firestore", got "${kind}"`);
}

/** The store shared by the HTTP routes; created when the server loads. */
export const defaultAccountStore = createAccountStore();
