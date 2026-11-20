/** Shared Firebase Admin SDK app initialization for server modules. */
import { type App, getApps, initializeApp } from 'firebase-admin/app';

/**
 * Return the default Firebase Admin app, initializing it on first use.
 *
 * Args:
 *   env: Process environment overrides used for `GCP_PROJECT`. Defaults to `process.env`.
 *
 * Returns:
 *   The default Firebase Admin App instance.
 */
export function getAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }
  const projectId = env.GCP_PROJECT?.trim();
  return initializeApp(projectId ? { projectId } : undefined);
}
