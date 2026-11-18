/** Chooses this server's SessionStore from the SESSION_STORE environment variable. */
import { Firestore } from '@google-cloud/firestore';
import { FirestoreSessionStore } from './firestoreSessionStore';
import { InMemorySessionStore, type SessionStore } from './sessionStore';

/**
 * Create the session store named by SESSION_STORE.
 *
 * Args:
 *   env: Environment with SESSION_STORE ("memory", the default, or "firestore") and,
 *     for Firestore, GCP_PROJECT. Credentials come from Application Default Credentials.
 *
 * Returns:
 *   The configured SessionStore.
 *
 * Raises:
 *   Error: If SESSION_STORE has any other value.
 */
export function createSessionStore(env: NodeJS.ProcessEnv = process.env): SessionStore {
  const kind = env.SESSION_STORE?.trim() || 'memory';
  if (kind === 'memory') return new InMemorySessionStore();
  if (kind === 'firestore') {
    return new FirestoreSessionStore(new Firestore({ projectId: env.GCP_PROJECT, ignoreUndefinedProperties: true }));
  }
  throw new Error(`SESSION_STORE must be "memory" or "firestore", got "${kind}"`);
}

/** The store shared by the HTTP routes and the Live bridge; created when the server loads. */
export const defaultSessionStore = createSessionStore();
