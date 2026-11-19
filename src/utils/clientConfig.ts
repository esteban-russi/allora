/** Public client configuration loader for Firebase Auth and RevenueCat Web Billing. */
import type { FirebaseClientConfig } from './firebaseAuth';

export interface ClientConfig {
  firebase: FirebaseClientConfig | null;
  revenueCatWebKey: string | null;
}

let cachedPromise: Promise<ClientConfig> | null = null;

/**
 * Reset client config cache (for tests).
 */
export function resetClientConfigCache(): void {
  cachedPromise = null;
}

/**
 * Load public client configuration from /api/auth-config.
 * Caches the in-flight or completed promise so multiple callers only fetch once.
 *
 * Args:
 *   fetchImpl: Optional custom fetch implementation (defaults to window.fetch).
 *
 * Returns:
 *   Parsed ClientConfig containing Firebase config and RevenueCat web key.
 */
export function loadClientConfig(fetchImpl: typeof fetch = fetch): Promise<ClientConfig> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    try {
      const res = await fetchImpl('/api/auth-config');
      if (!res.ok) {
        return { firebase: null, revenueCatWebKey: null };
      }
      const data = await res.json();
      const rawFirebase = data?.firebase;
      let firebase: FirebaseClientConfig | null = null;
      if (rawFirebase && typeof rawFirebase === 'object') {
        const fields = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
        if (fields.every((f) => typeof rawFirebase[f] === 'string' && rawFirebase[f] !== '')) {
          firebase = {
            apiKey: rawFirebase.apiKey,
            authDomain: rawFirebase.authDomain,
            projectId: rawFirebase.projectId,
            appId: rawFirebase.appId
          };
        }
      }

      const revenueCatWebKey =
        typeof data?.billing?.revenueCatWebKey === 'string' && data.billing.revenueCatWebKey.trim() !== ''
          ? data.billing.revenueCatWebKey.trim()
          : null;

      return { firebase, revenueCatWebKey };
    } catch (_err) {
      return { firebase: null, revenueCatWebKey: null };
    }
  })();

  return cachedPromise;
}
