/** Anonymous and federated Firebase sign-in for the browser client. */
import { postJson, setAuthTokenProvider } from './apiClient';
import { rememberLearnerSessionId } from './learnerSession';
import {
  loadClientConfig,
  parseFirebaseClientConfig,
  type FirebaseClientConfig
} from './clientConfig';

export { parseFirebaseClientConfig, type FirebaseClientConfig };

export const EMAIL_FOR_SIGN_IN_KEY = 'parliamo.emailForSignIn';

/** Result of a sign-in operation. */
export type SignInResult =
  /** `mergeFailed` is set when sign-in worked but the guest's data could not be carried over. */
  | { ok: true; mergeFailed?: true }
  | { ok: false; reason: 'cancelled' | 'failed'; message: string };

/** Returns a fresh (or cached, still valid) ID token, or null when signed out. */
type TokenGetter = () => Promise<string | null>;

let authInstance: any = null;
let authReady: Promise<any> | null = null;

/**
 * Set or clear the auth instance for testing purposes.
 *
 * Args:
 *   auth: The mock or fake auth instance.
 */
export function setAuthInstanceForTesting(auth: any | null): void {
  authInstance = auth;
  authReady = auth ? Promise.resolve(auth) : null;
}

async function fetchFirebaseConfig(): Promise<FirebaseClientConfig | null> {
  const { firebase } = await loadClientConfig();
  return firebase;
}

/** Loaded lazily so local development without Firebase never downloads the SDK. */
async function signInWithFirebase(config: FirebaseClientConfig): Promise<TokenGetter> {
  const [{ initializeApp }, { getAuth, signInAnonymously }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth')
  ]);
  const auth = getAuth(initializeApp(config));
  authInstance = auth;
  authReady = Promise.resolve(auth);
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

async function ensureAuth(): Promise<any> {
  if (authInstance) return authInstance;
  if (!authReady) {
    authReady = (async () => {
      const config = await fetchFirebaseConfig();
      if (!config) return null;
      const [{ initializeApp }, { getAuth }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth')
      ]);
      const auth = getAuth(initializeApp(config));
      authInstance = auth;
      await auth.authStateReady();
      return auth;
    })();
  }
  return authReady;
}

/**
 * Ask the server to move the guest's data to the signed-in account, trying twice.
 *
 * `postJson` resolves for any HTTP status, so a non-2xx response is treated as a failure
 * here rather than passing silently.
 *
 * Args:
 *   mergeFn: Sends the merge request for a guest ID token.
 *   guestIdToken: ID token of the guest being merged.
 *
 * Returns:
 *   True once the server accepted the merge, false if both attempts failed.
 */
async function mergeGuest(
  mergeFn: (guestIdToken: string) => Promise<unknown>,
  guestIdToken: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = (await mergeFn(guestIdToken)) as { ok?: boolean; status?: number } | null | undefined;
      if (res?.ok !== false) return true;
      console.warn(`[Auth] Guest merge failed with status ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[Auth] Guest merge failed after sign-in (attempt ${attempt}):`, err);
    }
  }
  return false;
}

/**
 * Helper executing a sign-in operation and merging guest state if an anonymous user was active.
 *
 * Args:
 *   doSignIn: Async sign-in executor.
 *   deps: Injectable dependencies for testing.
 *
 * Returns:
 *   SignInResult indicating success or failure.
 */
export async function signInAndMerge(
  doSignIn: () => Promise<void>,
  deps: {
    getAuth?: () => Promise<any>;
    postMerge?: (guestIdToken: string) => Promise<unknown>;
  } = {}
): Promise<SignInResult> {
  const auth = deps.getAuth ? await deps.getAuth() : await ensureAuth();
  const guest = auth?.currentUser?.isAnonymous ? auth.currentUser : null;
  const guestIdToken = guest ? await guest.getIdToken() : null;

  try {
    await doSignIn();
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const message = (err as Error)?.message || 'Sign-in failed';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { ok: false, reason: 'cancelled', message };
    }
    return { ok: false, reason: 'failed', message };
  }

  if (guestIdToken) {
    const mergeFn = deps.postMerge ?? ((token: string) => postJson('/api/account/merge', { guestIdToken: token }));
    if (!(await mergeGuest(mergeFn, guestIdToken))) {
      return { ok: true, mergeFailed: true };
    }
  }

  return { ok: true };
}

/**
 * Sign in using Google popup provider and merge guest account.
 *
 * Args:
 *   deps: Optional injectable dependencies for tests.
 *
 * Returns:
 *   SignInResult.
 */
export async function signInWithGoogle(
  deps?: {
    getAuth?: () => Promise<any>;
    signInWithPopup?: (auth: any, provider: any) => Promise<any>;
    postMerge?: (guestIdToken: string) => Promise<unknown>;
  }
): Promise<SignInResult> {
  const auth = deps?.getAuth ? await deps.getAuth() : await ensureAuth();
  if (!auth) {
    return { ok: false, reason: 'failed', message: 'Firebase Auth is not initialized' };
  }

  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const popupFn = deps?.signInWithPopup ?? signInWithPopup;

  return signInAndMerge(
    async () => {
      await popupFn(auth, new GoogleAuthProvider());
    },
    { getAuth: async () => auth, postMerge: deps?.postMerge }
  );
}

/**
 * Send an email magic link for passwordless sign-in.
 *
 * Args:
 *   email: Learner's email address.
 *   deps: Optional injectable dependencies for tests.
 */
export async function sendMagicLink(
  email: string,
  deps?: {
    getAuth?: () => Promise<any>;
    sendSignInLinkToEmail?: (auth: any, email: string, settings: any) => Promise<void>;
  }
): Promise<void> {
  const auth = deps?.getAuth ? await deps.getAuth() : await ensureAuth();
  if (!auth) throw new Error('Firebase Auth is not initialized');

  const { sendSignInLinkToEmail } = await import('firebase/auth');
  const sendFn = deps?.sendSignInLinkToEmail ?? sendSignInLinkToEmail;

  const url = typeof window !== 'undefined' ? `${window.location.origin}/auth/action` : '/auth/action';
  await sendFn(auth, email, {
    url,
    handleCodeInApp: true
  });

  try {
    localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
  } catch {
    // Local storage unavailable
  }
}

/**
 * Check whether a URL is an email sign-in link.
 *
 * Args:
 *   url: The target link URL.
 *   deps: Optional injectable dependencies for tests.
 *
 * Returns:
 *   True if URL is an email sign-in link.
 */
export async function isMagicLink(
  url: string,
  deps?: {
    getAuth?: () => Promise<any>;
    isSignInWithEmailLink?: (auth: any, url: string) => boolean;
  }
): Promise<boolean> {
  const auth = deps?.getAuth ? await deps.getAuth() : await ensureAuth();
  if (!auth) return false;

  const { isSignInWithEmailLink } = await import('firebase/auth');
  const checkFn = deps?.isSignInWithEmailLink ?? isSignInWithEmailLink;
  return checkFn(auth, url);
}

/**
 * Complete magic link sign-in and merge guest account.
 *
 * Args:
 *   url: Sign-in link URL.
 *   email: Learner's email address.
 *   deps: Optional injectable dependencies for tests.
 *
 * Returns:
 *   SignInResult if it was a magic link, or null if url was not a magic link.
 */
export async function completeMagicLink(
  url: string,
  email: string,
  deps?: {
    getAuth?: () => Promise<any>;
    isSignInWithEmailLink?: (auth: any, url: string) => boolean;
    signInWithEmailLink?: (auth: any, email: string, url: string) => Promise<any>;
    postMerge?: (guestIdToken: string) => Promise<unknown>;
  }
): Promise<SignInResult | null> {
  const auth = deps?.getAuth ? await deps.getAuth() : await ensureAuth();
  if (!auth) return { ok: false, reason: 'failed', message: 'Firebase Auth is not initialized' };

  const { isSignInWithEmailLink, signInWithEmailLink } = await import('firebase/auth');
  const checkFn = deps?.isSignInWithEmailLink ?? isSignInWithEmailLink;
  const signInFn = deps?.signInWithEmailLink ?? signInWithEmailLink;

  if (!checkFn(auth, url)) {
    return null;
  }

  return signInAndMerge(
    async () => {
      await signInFn(auth, email, url);
    },
    { getAuth: async () => auth, postMerge: deps?.postMerge }
  );
}

let signOutInFlight: Promise<void> | null = null;

/**
 * Sign out of the registered account and transition back to a fresh guest identity.
 *
 * Calls made while a sign-out is already running share it, so two triggers (for
 * example the delete button and a late ACCOUNT_DELETED reply) create one guest, not two.
 *
 * Args:
 *   deps: Optional injectable dependencies for tests.
 */
export function signOutToGuest(
  deps?: {
    getAuth?: () => Promise<any>;
    signOut?: (auth: any) => Promise<void>;
    signInAnonymously?: (auth: any) => Promise<any>;
  }
): Promise<void> {
  if (!signOutInFlight) {
    signOutInFlight = runSignOutToGuest(deps).finally(() => {
      signOutInFlight = null;
    });
  }
  return signOutInFlight;
}

async function runSignOutToGuest(
  deps?: {
    getAuth?: () => Promise<any>;
    signOut?: (auth: any) => Promise<void>;
    signInAnonymously?: (auth: any) => Promise<any>;
  }
): Promise<void> {
  const auth = deps?.getAuth ? await deps.getAuth() : await ensureAuth();
  if (!auth) return;

  const { signOut, signInAnonymously } = await import('firebase/auth');
  const signOutFn = deps?.signOut ?? signOut;
  const anonFn = deps?.signInAnonymously ?? signInAnonymously;

  await signOutFn(auth);
  rememberLearnerSessionId(null);
  await anonFn(auth);
}
