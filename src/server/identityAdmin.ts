/** Firebase Auth identity administration, handling server-side user deletion. */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface IdentityAdmin {
  /**
   * Delete a user from Firebase Authentication.
   *
   * Args:
   *   userId: Firebase user UID to delete.
   *
   * Returns:
   *   A promise that resolves when deleted or when user is not found.
   */
  deleteUser(userId: string): Promise<void>;
}

/**
 * Create an IdentityAdmin instance.
 *
 * When `env.GCP_PROJECT` is set, calls Firebase Admin SDK with Application Default Credentials.
 * When unset (e.g. in local development or unit tests), returns a no-op stub.
 *
 * Args:
 *   env: Process environment overrides. Defaults to `process.env`.
 *
 * Returns:
 *   An IdentityAdmin instance.
 */
export function createIdentityAdmin(env: NodeJS.ProcessEnv = process.env): IdentityAdmin {
  const projectId = env.GCP_PROJECT;
  if (!projectId) {
    return {
      async deleteUser(): Promise<void> {
        // No-op outside cloud environments
      }
    };
  }

  let initialized = false;
  const ensureApp = () => {
    if (!initialized) {
      if (getApps().length === 0) {
        initializeApp({ projectId });
      }
      initialized = true;
    }
  };

  return {
    async deleteUser(userId: string): Promise<void> {
      ensureApp();
      try {
        await getAuth().deleteUser(userId);
      } catch (err) {
        if ((err as { code?: string })?.code === 'auth/user-not-found') {
          return;
        }
        throw err;
      }
    }
  };
}

export const defaultIdentityAdmin: IdentityAdmin = createIdentityAdmin();
