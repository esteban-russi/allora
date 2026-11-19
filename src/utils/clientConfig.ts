/** Public client configuration loader for Firebase Auth and RevenueCat Web Billing. */

/** Public Firebase web config, served by `GET /api/auth-config`. */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  appCheckSiteKey?: string | null;
}

export interface ClientConfig {
  firebase: FirebaseClientConfig | null;
  revenueCatWebKey: string | null;
}

/**
 * Check that a value from the server is a usable Firebase config.
 *
 * Args:
 *   value: Parsed `firebase` field of the `/api/auth-config` response.
 *
 * Returns:
 *   The config, or null when it is missing or any required field is not a non-empty string.
 */
export function parseFirebaseClientConfig(value: unknown): FirebaseClientConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Record<string, unknown>;
  const fields = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
  if (!fields.every((field) => typeof config[field] === 'string' && config[field] !== '')) return null;
  const appCheckSiteKey =
    typeof config.appCheckSiteKey === 'string' && config.appCheckSiteKey.trim() !== ''
      ? config.appCheckSiteKey.trim()
      : null;
  return {
    apiKey: config.apiKey as string,
    authDomain: config.authDomain as string,
    projectId: config.projectId as string,
    appId: config.appId as string,
    appCheckSiteKey
  };
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
      const firebase = parseFirebaseClientConfig(data?.firebase);

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
