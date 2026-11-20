/** Authenticated API access for the browser client: one token source for fetch and Live calls. */
import { getAppCheckToken } from './appCheck';

/** Returns the signed-in user's current ID token, or null when signed out. */
export type AuthTokenProvider = () => Promise<string | null>;

let tokenProvider: AuthTokenProvider = async () => null;

/** Error code the server sends once the account behind a still-valid token was deleted. */
export const ACCOUNT_DELETED_CODE = 'ACCOUNT_DELETED';

/** Error code the server sends when App Check verification fails or is missing. */
export const APP_CHECK_REQUIRED_CODE = 'APP_CHECK_REQUIRED';

let accountDeletedHandler: (() => void) | null = null;
let appCheckFailedHandler: (() => void) | null = null;

/**
 * Register what happens when the server reports this account as deleted.
 *
 * Args:
 *   handler: Called at most once per response; null stops listening.
 */
export function setAccountDeletedHandler(handler: (() => void) | null): void {
  accountDeletedHandler = handler;
}

/**
 * Register what happens when the server rejects a request with `APP_CHECK_REQUIRED`.
 *
 * Args:
 *   handler: Called once per rejected response; null stops listening.
 */
export function setAppCheckFailedHandler(handler: (() => void) | null): void {
  appCheckFailedHandler = handler;
}

/**
 * Inspect a 401 response for `APP_CHECK_REQUIRED` or `ACCOUNT_DELETED` and notify handlers.
 *
 * For `ACCOUNT_DELETED`, a reply for a token this tab has already replaced (for example
 * after it signed out to a guest itself) is ignored so it does not sign the new guest out.
 */
async function handleAuthError(res: Response, token: string | null): Promise<void> {
  if (res.status !== 401) return;
  if (!appCheckFailedHandler && (!token || !accountDeletedHandler)) return;
  const body = await res.clone().json().catch(() => null);
  if (body?.code === APP_CHECK_REQUIRED_CODE) {
    appCheckFailedHandler?.();
    return;
  }
  if (body?.code === ACCOUNT_DELETED_CODE && token && accountDeletedHandler) {
    if ((await getAuthToken()) !== token) return;
    accountDeletedHandler?.();
  }
}

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
 * Build auth and App Check headers for an outbound API request.
 *
 * Args:
 *   extra: Additional headers to include (e.g. `Content-Type`).
 *
 * Returns:
 *   The bearer ID token (for account-deleted checks) and headers map.
 */
async function authHeaders(
  extra: Record<string, string> = {}
): Promise<{ token: string | null; headers: Record<string, string> }> {
  const [token, appCheckToken] = await Promise.all([getAuthToken(), getAppCheckToken()]);
  const headers: Record<string, string> = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  return { token, headers };
}

/**
 * GET an API route with the user's ID token and App Check token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/session`.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok`.
 */
export async function getWithAuth(path: string): Promise<Response> {
  const { token, headers } = await authHeaders();
  const res = await fetch(path, Object.keys(headers).length > 0 ? { headers } : {});
  await handleAuthError(res, token);
  return res;
}

/**
 * POST a JSON body to an API route with the user's ID token and App Check token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/chat`.
 *   body: JSON-serialisable request body.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok` as before.
 */
export async function postJson(path: string, body: unknown): Promise<Response> {
  const { token, headers } = await authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  await handleAuthError(res, token);
  return res;
}

/**
 * DELETE an API route with the user's ID token and App Check token attached.
 *
 * Args:
 *   path: API path, e.g. `/api/account`.
 *
 * Returns:
 *   The fetch Response; callers check `res.ok`.
 */
export async function deleteWithAuth(path: string): Promise<Response> {
  const { token, headers } = await authHeaders();
  const res = await fetch(path, { method: 'DELETE', headers });
  await handleAuthError(res, token);
  return res;
}
