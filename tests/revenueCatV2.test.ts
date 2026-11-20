/** Tests for RevenueCat REST API v2 authenticated management URL client. */
import { describe, expect, it, vi } from 'vitest';
import { createRevenueCatV2Client } from '../src/server/revenueCatV2';

describe('createRevenueCatV2Client', () => {
  it('picks the first active rc_billing subscription and fetches its management URL', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: 'sub_play', store: 'play_store', status: 'active', gives_access: true },
            { id: 'sub_expired', store: 'rc_billing', status: 'expired', gives_access: false },
            { id: 'sub_web_1', store: 'rc_billing', status: 'active', gives_access: true },
            { id: 'sub_web_2', store: 'rc_billing', status: 'trialing', gives_access: true }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          object: 'authenticated_management_url',
          management_url: 'https://billing.revenuecat.com/portal/single-use-token'
        })
      });

    const client = createRevenueCatV2Client('sk_v2_secret', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    const url = await client.getManagementUrl('user_abc');

    expect(url).toBe('https://billing.revenuecat.com/portal/single-use-token');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(fakeFetch.mock.calls[0][0]).toBe(
      'https://api.revenuecat.com/v2/projects/proj_123/customers/user_abc/subscriptions'
    );
    expect(fakeFetch.mock.calls[1][0]).toBe(
      'https://api.revenuecat.com/v2/projects/proj_123/subscriptions/sub_web_1/authenticated_management_url'
    );
  });

  it('sends Bearer authorization header and URL-encodes project, user, and subscription IDs', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'sub/a+b', store: 'rc_billing', status: 'active', gives_access: true }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          object: 'authenticated_management_url',
          management_url: 'https://billing.revenuecat.com/portal/tok'
        })
      });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj/1+2', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    await client.getManagementUrl('user/special+id');

    expect(fakeFetch.mock.calls[0][0]).toBe(
      'https://api.revenuecat.com/v2/projects/proj%2F1%2B2/customers/user%2Fspecial%2Bid/subscriptions'
    );
    expect(fakeFetch.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer sk_v2_key',
      Accept: 'application/json'
    });
    expect(fakeFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    expect(fakeFetch.mock.calls[1][0]).toBe(
      'https://api.revenuecat.com/v2/projects/proj%2F1%2B2/subscriptions/sub%2Fa%2Bb/authenticated_management_url'
    );
    expect(fakeFetch.mock.calls[1][1].headers).toEqual({
      Authorization: 'Bearer sk_v2_key',
      Accept: 'application/json'
    });
    expect(fakeFetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null when customer only has play_store or expired subscriptions', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 'sub_play', store: 'play_store', status: 'active', gives_access: true },
          { id: 'sub_old', store: 'rc_billing', status: 'expired', gives_access: false }
        ]
      })
    });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    const url = await client.getManagementUrl('user_play');

    expect(url).toBeNull();
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when customer is not found (404)', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404
    });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    const url = await client.getManagementUrl('missing_user');

    expect(url).toBeNull();
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when customer has no subscriptions', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] })
    });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    const url = await client.getManagementUrl('empty_user');

    expect(url).toBeNull();
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when authenticated_management_url returns null', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'sub_web_1', store: 'rc_billing', status: 'active', gives_access: true }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          object: 'authenticated_management_url',
          management_url: null
        })
      });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    const url = await client.getManagementUrl('user_null_url');

    expect(url).toBeNull();
  });

  it('throws an Error with status code and no response body on upstream 500', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'secret upstream body'
    });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    await expect(client.getManagementUrl('u1')).rejects.toThrow(
      'RevenueCat v2 subscriptions request failed with status 500'
    );
  });

  it('throws an Error with status code when authenticated_management_url returns 502', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'sub_web_1', store: 'rc_billing', status: 'active', gives_access: true }]
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'upstream html'
      });

    const client = createRevenueCatV2Client('sk_v2_key', 'proj_123', {
      fetch: fakeFetch as unknown as typeof fetch
    });
    await expect(client.getManagementUrl('u1')).rejects.toThrow(
      'RevenueCat v2 management URL request failed with status 502'
    );
  });
});
