/** Client-side Firebase App Check token provider (web reCAPTCHA Enterprise + native seam). */
import type { FirebaseApp } from 'firebase/app';

/**
 * Seam for a native App Check token provider (e.g. Android Play Integrity via
 * Capacitor in plan 07). When registered, `initAppCheck` and `getAppCheckToken`
 * delegate to it instead of the web reCAPTCHA Enterprise provider.
 */
export interface NativeAppCheckProvider {
  init(): Promise<void> | void;
  getToken(): Promise<string | null>;
}

type TokenGetter = () => Promise<string | null>;

let nativeProvider: NativeAppCheckProvider | null = null;
let tokenGetterPromise: Promise<TokenGetter | null> | null = null;

/**
 * Register or clear the native App Check provider seam.
 *
 * Args:
 *   provider: Native provider implementation, or null to use the web provider.
 */
export function setNativeAppCheckProvider(provider: NativeAppCheckProvider | null): void {
  nativeProvider = provider;
}

/**
 * Reset App Check client state (for unit tests).
 */
export function resetAppCheckForTesting(): void {
  nativeProvider = null;
  tokenGetterPromise = null;
}

/**
 * Initialise App Check for the active platform.
 *
 * On web, requires a non-empty reCAPTCHA Enterprise `siteKey` and loads
 * `firebase/app-check` lazily; without a site key App Check stays disabled.
 * When a `NativeAppCheckProvider` is registered, delegates initialisation to it.
 *
 * Args:
 *   firebaseApp: Initialised Firebase app instance.
 *   siteKey: reCAPTCHA Enterprise website key from `/api/auth-config`, or null.
 */
export function initAppCheck(firebaseApp: FirebaseApp, siteKey: string | null): void {
  if (tokenGetterPromise) return;

  if (nativeProvider) {
    const provider = nativeProvider;
    tokenGetterPromise = Promise.resolve()
      .then(() => provider.init())
      .then(() => () => provider.getToken())
      .catch(() => null);
    return;
  }

  const trimmedKey = siteKey?.trim();
  if (!trimmedKey) return;

  tokenGetterPromise = import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }) => {
      const instance = initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider(trimmedKey),
        isTokenAutoRefreshEnabled: true
      });
      return async () => {
        const result = await getToken(instance, false);
        return result.token || null;
      };
    })
    .catch(() => null);
}

/**
 * Fetch the current App Check token, or null when uninitialised or on error.
 *
 * Returns:
 *   A valid App Check token string, or null.
 */
export async function getAppCheckToken(): Promise<string | null> {
  if (!tokenGetterPromise) return null;
  try {
    const getToken = await tokenGetterPromise;
    if (!getToken) return null;
    const token = await getToken();
    return token || null;
  } catch {
    return null;
  }
}
