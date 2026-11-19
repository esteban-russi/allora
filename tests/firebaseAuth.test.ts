/** Tests for anonymous and federated Firebase sign-in on the client. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, setAuthTokenProvider } from '../src/utils/apiClient';
import {
  completeMagicLink,
  EMAIL_FOR_SIGN_IN_KEY,
  isMagicLink,
  parseFirebaseClientConfig,
  sendMagicLink,
  setAuthInstanceForTesting,
  signInAndMerge,
  signInWithGoogle,
  signOutToGuest,
  startAnonymousAuth,
  type FirebaseClientConfig
} from '../src/utils/firebaseAuth';
import { getLearnerSessionId, rememberLearnerSessionId } from '../src/utils/learnerSession';

const CONFIG: FirebaseClientConfig = {
  apiKey: 'api-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo',
  appId: '1:123:web:abc'
};

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear()
  });
});

afterEach(() => {
  setAuthTokenProvider(async () => null);
  setAuthInstanceForTesting(null);
  rememberLearnerSessionId(null);
  vi.restoreAllMocks();
});

describe('parseFirebaseClientConfig', () => {
  it('accepts a complete config', () => {
    expect(parseFirebaseClientConfig({ ...CONFIG, extra: 'dropped' })).toEqual(CONFIG);
  });

  it.each([null, undefined, 'config', { ...CONFIG, apiKey: '' }, { ...CONFIG, appId: 42 }])(
    'returns null for %j',
    (value) => {
      expect(parseFirebaseClientConfig(value)).toBeNull();
    }
  );
});

describe('startAnonymousAuth', () => {
  it('attaches the signed-in user token to requests', async () => {
    const signIn = vi.fn(async () => async () => 'anon-token');

    expect(await startAnonymousAuth(async () => CONFIG, signIn)).toBe(true);

    expect(signIn).toHaveBeenCalledWith(CONFIG);
    expect(await getAuthToken()).toBe('anon-token');
  });

  it('makes requests sent during sign-in wait for the token', async () => {
    let finishSignIn: (getter: () => Promise<string | null>) => void = () => undefined;
    const signIn = () => new Promise<() => Promise<string | null>>((resolve) => (finishSignIn = resolve));

    startAnonymousAuth(async () => CONFIG, signIn);
    const pending = getAuthToken();
    await Promise.resolve();
    finishSignIn(async () => 'late-token');

    expect(await pending).toBe('late-token');
  });

  it('skips sign-in when the server has no Firebase config', async () => {
    const signIn = vi.fn();

    expect(await startAnonymousAuth(async () => null, signIn)).toBe(false);

    expect(signIn).not.toHaveBeenCalled();
    expect(await getAuthToken()).toBeNull();
  });

  it('sends requests without a token when sign-in fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const signIn = async () => {
      throw new Error('auth/operation-not-allowed');
    };

    expect(await startAnonymousAuth(async () => CONFIG, signIn)).toBe(false);
    expect(await getAuthToken()).toBeNull();
  });
});

describe('signInAndMerge', () => {
  it('calls merge when guest user was anonymous', async () => {
    const postMerge = vi.fn().mockResolvedValue({ ok: true });
    const fakeAuth = {
      currentUser: {
        isAnonymous: true,
        getIdToken: vi.fn().mockResolvedValue('guest-token-123')
      }
    };

    const doSignIn = vi.fn().mockResolvedValue(undefined);
    const result = await signInAndMerge(doSignIn, {
      getAuth: async () => fakeAuth,
      postMerge
    });

    expect(result).toEqual({ ok: true });
    expect(doSignIn).toHaveBeenCalled();
    expect(postMerge).toHaveBeenCalledWith('guest-token-123');
  });

  it('does not call merge when current user was not anonymous', async () => {
    const postMerge = vi.fn();
    const fakeAuth = {
      currentUser: {
        isAnonymous: false,
        getIdToken: vi.fn().mockResolvedValue('user-token-123')
      }
    };

    const result = await signInAndMerge(async () => undefined, {
      getAuth: async () => fakeAuth,
      postMerge
    });

    expect(result).toEqual({ ok: true });
    expect(postMerge).not.toHaveBeenCalled();
  });

  it('does not call merge when there was no guest', async () => {
    const postMerge = vi.fn();
    const fakeAuth = { currentUser: null };

    const result = await signInAndMerge(async () => undefined, {
      getAuth: async () => fakeAuth,
      postMerge
    });

    expect(result).toEqual({ ok: true });
    expect(postMerge).not.toHaveBeenCalled();
  });

  it('maps auth/popup-closed-by-user to cancelled', async () => {
    const doSignIn = async () => {
      const err = new Error('Popup closed');
      (err as any).code = 'auth/popup-closed-by-user';
      throw err;
    };

    const result = await signInAndMerge(doSignIn, {
      getAuth: async () => ({ currentUser: null })
    });

    expect(result).toEqual({
      ok: false,
      reason: 'cancelled',
      message: 'Popup closed'
    });
  });

  it('maps auth/cancelled-popup-request to cancelled', async () => {
    const doSignIn = async () => {
      const err = new Error('Cancelled');
      (err as any).code = 'auth/cancelled-popup-request';
      throw err;
    };

    const result = await signInAndMerge(doSignIn, {
      getAuth: async () => ({ currentUser: null })
    });

    expect(result).toEqual({
      ok: false,
      reason: 'cancelled',
      message: 'Cancelled'
    });
  });

  it('maps other sign-in errors to failed', async () => {
    const doSignIn = async () => {
      throw new Error('Network error');
    };

    const result = await signInAndMerge(doSignIn, {
      getAuth: async () => ({ currentUser: null })
    });

    expect(result).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Network error'
    });
  });
});

describe('signInWithGoogle', () => {
  it('calls signInWithPopup and merges guest', async () => {
    const fakeAuth = {
      currentUser: {
        isAnonymous: true,
        getIdToken: vi.fn().mockResolvedValue('anon-g-token')
      }
    };
    const signInWithPopup = vi.fn().mockResolvedValue({ user: { uid: 'google-user' } });
    const postMerge = vi.fn().mockResolvedValue({ ok: true });

    const result = await signInWithGoogle({
      getAuth: async () => fakeAuth,
      signInWithPopup,
      postMerge
    });

    expect(result).toEqual({ ok: true });
    expect(signInWithPopup).toHaveBeenCalled();
    expect(postMerge).toHaveBeenCalledWith('anon-g-token');
  });
});

describe('sendMagicLink', () => {
  it('calls sendSignInLinkToEmail and saves email in localStorage', async () => {
    const fakeAuth = {};
    const sendSignInLinkToEmail = vi.fn().mockResolvedValue(undefined);

    await sendMagicLink('test@example.com', {
      getAuth: async () => fakeAuth,
      sendSignInLinkToEmail
    });

    expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
      fakeAuth,
      'test@example.com',
      expect.objectContaining({ handleCodeInApp: true })
    );
    expect(localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY)).toBe('test@example.com');
  });
});

describe('isMagicLink and completeMagicLink', () => {
  it('checks if a link is an email sign-in link', async () => {
    const fakeAuth = {};
    const isSignInWithEmailLink = vi.fn().mockReturnValue(true);

    const isLink = await isMagicLink('https://example.com/auth/action?apiKey=123', {
      getAuth: async () => fakeAuth,
      isSignInWithEmailLink
    });

    expect(isLink).toBe(true);
    expect(isSignInWithEmailLink).toHaveBeenCalled();
  });

  it('returns null from completeMagicLink when url is not a sign-in link', async () => {
    const fakeAuth = {};
    const isSignInWithEmailLink = vi.fn().mockReturnValue(false);

    const result = await completeMagicLink('https://example.com/not-link', 'test@example.com', {
      getAuth: async () => fakeAuth,
      isSignInWithEmailLink
    });

    expect(result).toBeNull();
  });

  it('completes magic link sign-in and merges guest', async () => {
    const fakeAuth = {
      currentUser: {
        isAnonymous: true,
        getIdToken: vi.fn().mockResolvedValue('anon-magic-token')
      }
    };
    const isSignInWithEmailLink = vi.fn().mockReturnValue(true);
    const signInWithEmailLink = vi.fn().mockResolvedValue({ user: { uid: 'magic-user' } });
    const postMerge = vi.fn().mockResolvedValue({ ok: true });

    const result = await completeMagicLink('https://example.com/auth/action', 'test@example.com', {
      getAuth: async () => fakeAuth,
      isSignInWithEmailLink,
      signInWithEmailLink,
      postMerge
    });

    expect(result).toEqual({ ok: true });
    expect(signInWithEmailLink).toHaveBeenCalledWith(fakeAuth, 'test@example.com', 'https://example.com/auth/action');
    expect(postMerge).toHaveBeenCalledWith('anon-magic-token');
  });
});

describe('signOutToGuest', () => {
  it('signs out, clears stored session ID, and signs in anonymously', async () => {
    rememberLearnerSessionId('sess_123');
    expect(getLearnerSessionId()).toBe('sess_123');

    const fakeAuth = {};
    const signOut = vi.fn().mockResolvedValue(undefined);
    const signInAnonymously = vi.fn().mockResolvedValue({ user: { uid: 'new-anon' } });

    await signOutToGuest({
      getAuth: async () => fakeAuth,
      signOut,
      signInAnonymously
    });

    expect(signOut).toHaveBeenCalledWith(fakeAuth);
    expect(getLearnerSessionId()).toBeNull();
    expect(signInAnonymously).toHaveBeenCalledWith(fakeAuth);
  });
});
