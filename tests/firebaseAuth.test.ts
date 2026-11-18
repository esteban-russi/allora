/** Tests for anonymous Firebase sign-in on the client. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, setAuthTokenProvider } from '../src/utils/apiClient';
import { parseFirebaseClientConfig, startAnonymousAuth, type FirebaseClientConfig } from '../src/utils/firebaseAuth';

const CONFIG: FirebaseClientConfig = {
  apiKey: 'api-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo',
  appId: '1:123:web:abc'
};

afterEach(() => {
  setAuthTokenProvider(async () => null);
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
