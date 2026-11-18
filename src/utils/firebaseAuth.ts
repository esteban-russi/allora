/** Anonymous Firebase sign-in for the browser client, so API and Live calls carry a verified ID token. */
import { setAuthTokenProvider } from './apiClient';

/** Public Firebase web config, served by `GET /api/auth-config`. */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** Returns a fresh (or cached, still valid) ID token, or null when signed out. */
type TokenGetter = () => Promise<string | null>;

/**
 * Check that a value from the server is a usable Firebase config.
 *
 * Args:
 *   value: Parsed `firebase` field of the `/api/auth-config` response.
 *
 * Returns:
 *   The config, or null when it is missing or any field is not a non-empty string.
 */
export function parseFirebaseClientConfig(value: unknown): FirebaseClientConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Record<string, unknown>;
  const fields = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
  if (!fields.every((field) => typeof config[field] === 'string' && config[field] !== '')) return null;
  return {
    apiKey: config.apiKey as string,
    authDomain: config.authDomain as string,
    projectId: config.projectId as string,
    appId: config.appId as string
  };
}

async function fetchFirebaseConfig(): Promise<FirebaseClientConfig | null> {
  const res = await fetch('/api/auth-config');
  if (!res.ok) return null;
  const body = await res.json();
  return parseFirebaseClientConfig(body?.firebase);
}

/** Loaded lazily so local development without Firebase never downloads the SDK. */
async function signInWithFirebase(config: FirebaseClientConfig): Promise<TokenGetter> {
  const [{ initializeApp }, { getAuth, signInAnonymously }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth')
  ]);
  const auth = getAuth(initializeApp(config));
  // Reuse the anonymous account persisted on this device, so the learner keeps their sessions
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return async () => (auth.currentUser ? auth.currentUser.getIdToken() : null);
}

/**
 * Sign the learner in anonymously and make every API request carry their ID token.
 *
 * The token provider is registered immediately and waits for sign-in, so requests made
 * while it is in progress still get a token. When the server serves no Firebase config
 * (local development), requests go out without one, as before.
 *
 * Args:
 *   loadConfig: Fetches the Firebase config; injectable for tests.
 *   signIn: Signs in and returns a token getter; injectable for tests.
 *
 * Returns:
 *   True once signed in, false if Firebase is not configured or sign-in failed.
 */
export function startAnonymousAuth(
  loadConfig: () => Promise<FirebaseClientConfig | null> = fetchFirebaseConfig,
  signIn: (config: FirebaseClientConfig) => Promise<TokenGetter> = signInWithFirebase
): Promise<boolean> {
  const ready = loadConfig()
    .then((config) => (config ? signIn(config) : null))
    .catch((err) => {
      console.warn('[Auth] Anonymous sign-in failed:', err);
      return null;
    });

  setAuthTokenProvider(async () => {
    const getToken = await ready;
    return getToken ? getToken() : null;
  });
  return ready.then(Boolean);
}
