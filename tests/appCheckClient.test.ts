/** Tests for client-side Firebase App Check token provider (web and native seam). */
import type { FirebaseApp } from 'firebase/app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppCheckToken,
  initAppCheck,
  resetAppCheckForTesting,
  setNativeAppCheckProvider
} from '../src/utils/appCheck';

const mockProviderInstances: Array<{ siteKey: string }> = [];
const mockInitializeAppCheck = vi.fn();
const mockGetToken = vi.fn();

class FakeReCaptchaEnterpriseProvider {
  siteKey: string;
  constructor(siteKey: string) {
    this.siteKey = siteKey;
    mockProviderInstances.push(this);
  }
}

vi.mock('firebase/app-check', () => ({
  ReCaptchaEnterpriseProvider: FakeReCaptchaEnterpriseProvider,
  initializeAppCheck: (...args: unknown[]) => mockInitializeAppCheck(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args)
}));

const FAKE_APP = { name: '[DEFAULT]' } as FirebaseApp;

describe('client appCheck', () => {
  beforeEach(() => {
    resetAppCheckForTesting();
    mockProviderInstances.length = 0;
    mockInitializeAppCheck.mockReset();
    mockGetToken.mockReset();
  });

  afterEach(() => {
    resetAppCheckForTesting();
  });

  it('returns null without throwing when not initialised', async () => {
    await expect(getAppCheckToken()).resolves.toBeNull();
  });

  describe('web provider', () => {
    it('stays uninitialised and never throws when siteKey is null or blank', async () => {
      initAppCheck(FAKE_APP, null);
      await expect(getAppCheckToken()).resolves.toBeNull();

      initAppCheck(FAKE_APP, '   ');
      await expect(getAppCheckToken()).resolves.toBeNull();

      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    });

    it('initialises reCAPTCHA Enterprise provider lazily and returns tokens', async () => {
      const fakeInstance = { app: FAKE_APP };
      mockInitializeAppCheck.mockReturnValue(fakeInstance);
      mockGetToken.mockResolvedValue({ token: 'web-ac-token' });

      initAppCheck(FAKE_APP, '  6Le-site-key  ');
      // Second call is a no-op
      initAppCheck(FAKE_APP, 'other-key');

      await expect(getAppCheckToken()).resolves.toBe('web-ac-token');
      expect(mockProviderInstances).toHaveLength(1);
      expect(mockProviderInstances[0].siteKey).toBe('6Le-site-key');
      expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
      expect(mockInitializeAppCheck).toHaveBeenCalledWith(FAKE_APP, {
        provider: mockProviderInstances[0],
        isTokenAutoRefreshEnabled: true
      });
      expect(mockGetToken).toHaveBeenCalledWith(fakeInstance, false);
    });

    it('returns null when initializeAppCheck throws', async () => {
      mockInitializeAppCheck.mockImplementation(() => {
        throw new Error('reCAPTCHA failed');
      });

      initAppCheck(FAKE_APP, '6Le-site-key');
      await expect(getAppCheckToken()).resolves.toBeNull();
    });

    it('returns null when getToken rejects', async () => {
      mockInitializeAppCheck.mockReturnValue({ app: FAKE_APP });
      mockGetToken.mockRejectedValue(new Error('network error'));

      initAppCheck(FAKE_APP, '6Le-site-key');
      await expect(getAppCheckToken()).resolves.toBeNull();
    });
  });

  describe('native provider seam', () => {
    it('delegates init and getToken to the registered native provider even without a siteKey', async () => {
      const init = vi.fn(async () => undefined);
      const getToken = vi.fn(async () => 'native-ac-token');
      setNativeAppCheckProvider({ init, getToken });

      initAppCheck(FAKE_APP, null);

      await expect(getAppCheckToken()).resolves.toBe('native-ac-token');
      expect(init).toHaveBeenCalledTimes(1);
      expect(getToken).toHaveBeenCalledTimes(1);
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    });

    it('returns null without calling getToken when native init rejects', async () => {
      const init = vi.fn(async () => {
        throw new Error('Play Integrity unavailable');
      });
      const getToken = vi.fn(async () => 'should-not-be-called');
      setNativeAppCheckProvider({ init, getToken });

      initAppCheck(FAKE_APP, null);

      await expect(getAppCheckToken()).resolves.toBeNull();
      expect(getToken).not.toHaveBeenCalled();
    });

    it('returns null when native getToken rejects', async () => {
      setNativeAppCheckProvider({
        init: vi.fn(),
        getToken: vi.fn(async () => {
          throw new Error('token fetch failed');
        })
      });

      initAppCheck(FAKE_APP, null);

      await expect(getAppCheckToken()).resolves.toBeNull();
    });
  });
});
