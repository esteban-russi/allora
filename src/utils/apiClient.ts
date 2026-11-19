/** Authenticated API access for the browser client: one token source for fetch and Live calls. */

/** Returns the signed-in user's current ID token, or null when signed out. */
export type AuthTokenProvider = () => Promise<string | null>;

let tokenProvider: AuthTokenProvider = async () => null;

/**
 * Register where ID tokens come from (e.g. Firebase `user.getIdToken()`).
 *
 * Until a provider is set, requests go out without a token, which the server only
 * accepts when auth is not enforced (local development).
 *
 * Args:
 *   provider: Called before every request, so it should return a cached or refreshed token.
 */
export function setAuthTokenProvider(provider: AuthTokenProvider): void {
  tokenProvider = provider;
}

/**
 * Get the current ID token, or null if there is none or the provider fails.
 *
 * Returns:
 *   The token string, or null.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    return await tokenProvider();
  } catch (err) {
    console.warn('[Auth] Could not get an ID token:', err);
    return null;
  }
}

/**
 * GET an API route with the user's ID token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/session`.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok`.
 */
export async function getWithAuth(path: string): Promise<Response> {
  const token = await getAuthToken();
  return fetch(path, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

/**
 * POST a JSON body to an API route with the user's ID token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/chat`.
 *   body: JSON-serialisable request body.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok` as before.
 */
export async function postJson(path: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

/**
 * DELETE an API route with the user's ID token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/account`.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok`.
 */
export async function deleteWithAuth(path: string): Promise<Response> {
  const token = await getAuthToken();
  return fetch(path, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}
