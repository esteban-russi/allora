/** Tests for the client's authenticated API helper. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteWithAuth,
  getAuthToken,
  getWithAuth,
  postJson,
  setAccountDeletedHandler,
  setAuthTokenProvider
} from '../src/utils/apiClient';

afterEach(() => {
  setAuthTokenProvider(async () => null);
  setAccountDeletedHandler(null);
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async (_path: string, _init: RequestInit) => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('postJson', () => {
  it('sends the ID token as a bearer header', async () => {
    const fetchMock = stubFetch();
    setAuthTokenProvider(async () => 'id-token-123');

    await postJson('/api/chat', { userMessage: 'Ciao' });

    expect(fetchMock).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token-123' },
      body: JSON.stringify({ userMessage: 'Ciao' })
    });
  });

  it('sends no Authorization header when signed out', async () => {
    const fetchMock = stubFetch();

    await postJson('/api/tts', { text: 'Ciao' });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('getWithAuth', () => {
  it('sends the ID token as a bearer header', async () => {
    const fetchMock = stubFetch();
    setAuthTokenProvider(async () => 'id-token-123');

    await getWithAuth('/api/session');

    expect(fetchMock).toHaveBeenCalledWith('/api/session', { headers: { Authorization: 'Bearer id-token-123' } });
  });

  it('sends no headers when signed out', async () => {
    const fetchMock = stubFetch();
    await getWithAuth('/api/session');
    expect(fetchMock).toHaveBeenCalledWith('/api/session', {});
  });
});

describe('getAuthToken', () => {
  it('returns null instead of throwing when the provider fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setAuthTokenProvider(async () => {
      throw new Error('network down');
    });
    expect(await getAuthToken()).toBeNull();
  });
});

describe('account deleted handling', () => {
  function stubFetchStatus(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('calls the handler when the server answers 401 ACCOUNT_DELETED', async () => {
    stubFetchStatus(401, { code: 'ACCOUNT_DELETED' });
    setAuthTokenProvider(async () => 'old-token');
    const handler = vi.fn();
    setAccountDeletedHandler(handler);

    const res = await getWithAuth('/api/me');

    expect(handler).toHaveBeenCalledTimes(1);
    // The caller can still read the body
    expect(await res.json()).toEqual({ code: 'ACCOUNT_DELETED' });
  });

  it('checks POST and DELETE responses too', async () => {
    stubFetchStatus(401, { code: 'ACCOUNT_DELETED' });
    setAuthTokenProvider(async () => 'old-token');
    const handler = vi.fn();
    setAccountDeletedHandler(handler);

    await postJson('/api/chat', {});
    await deleteWithAuth('/api/account');

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('ignores other 401 responses', async () => {
    stubFetchStatus(401, { code: 'AUTH_TOKEN_INVALID' });
    setAuthTokenProvider(async () => 'old-token');
    const handler = vi.fn();
    setAccountDeletedHandler(handler);

    await getWithAuth('/api/me');

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a late reply once this tab already switched to a new token', async () => {
    stubFetchStatus(401, { code: 'ACCOUNT_DELETED' });
    const tokens = ['old-token', 'new-guest-token'];
    setAuthTokenProvider(async () => tokens.shift() ?? 'new-guest-token');
    const handler = vi.fn();
    setAccountDeletedHandler(handler);

    await getWithAuth('/api/me');

    expect(handler).not.toHaveBeenCalled();
  });
});
