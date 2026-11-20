/** Tests for loadClientConfig utility. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadClientConfig, resetClientConfigCache } from '../src/platform/client/clientConfig';

describe('loadClientConfig', () => {
  beforeEach(() => {
    resetClientConfigCache();
  });

  it('fetches and parses complete config', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        firebase: {
          apiKey: 'fb-key',
          authDomain: 'test.firebaseapp.com',
          projectId: 'proj-123',
          appId: '1:123:web:456',
          appCheckSiteKey: '  6Le-site  '
        },
        billing: {
          revenueCatWebKey: '  rcb_sb_key123  '
        }
      })
    });

    const config = await loadClientConfig(fakeFetch as any);

    expect(config.firebase).toEqual({
      apiKey: 'fb-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'proj-123',
      appId: '1:123:web:456',
      appCheckSiteKey: '6Le-site'
    });
    expect(config.revenueCatWebKey).toBe('rcb_sb_key123');
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    // Second call should return cached result without fetching again
    const secondCall = await loadClientConfig(fakeFetch as any);
    expect(secondCall).toBe(config);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns nulls when response is not ok', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    const config = await loadClientConfig(fakeFetch as any);
    expect(config).toEqual({ firebase: null, revenueCatWebKey: null });
  });

  it('returns nulls when fetch rejects', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const config = await loadClientConfig(fakeFetch as any);
    expect(config).toEqual({ firebase: null, revenueCatWebKey: null });
  });

  it('drops invalid firebase config and handles missing billing key', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        firebase: {
          apiKey: '', // empty
          authDomain: 'test.firebaseapp.com'
        },
        billing: {
          revenueCatWebKey: ''
        }
      })
    });

    const config = await loadClientConfig(fakeFetch as any);
    expect(config.firebase).toBeNull();
    expect(config.revenueCatWebKey).toBeNull();
  });
});
