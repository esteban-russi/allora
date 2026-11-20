/** Chooses this server's ReportStore from the SESSION_STORE environment variable. */
import { Firestore } from '@google-cloud/firestore';
import { FirestoreReportStore, InMemoryReportStore, type ReportStore } from './reportStore';

/**
 * Create the report store named by SESSION_STORE.
 *
 * Args:
 *   env: Environment with SESSION_STORE ("memory", the default, or "firestore") and,
 *     for Firestore, GCP_PROJECT (auto-detected when empty). Credentials come from
 *     Application Default Credentials.
 *
 * Returns:
 *   The configured ReportStore.
 *
 * Raises:
 *   Error: If SESSION_STORE has any other value.
 */
export function createReportStore(env: NodeJS.ProcessEnv = process.env): ReportStore {
  const kind = env.SESSION_STORE?.trim() || 'memory';
  if (kind === 'memory') return new InMemoryReportStore();
  if (kind === 'firestore') {
    return new FirestoreReportStore(
      new Firestore({ projectId: env.GCP_PROJECT || undefined, ignoreUndefinedProperties: true })
    );
  }
  throw new Error(`SESSION_STORE must be "memory" or "firestore", got "${kind}"`);
}

/** The store shared by HTTP routes; created when the server loads. */
export const defaultReportStore = createReportStore();
