/** Tests for the client's authenticated API helper. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, getWithAuth, postJson, setAuthTokenProvider } from '../src/utils/apiClient';

afterEach(() => {
  setAuthTokenProvider(async () => null);
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
