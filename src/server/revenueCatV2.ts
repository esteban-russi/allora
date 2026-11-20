/** RevenueCat REST API v2 client for authenticated Web Billing management links.
 * Looks up a learner's active Web Billing subscription and fetches a single-use portal URL.
 */

export interface RevenueCatV2Client {
  /** Single-use authenticated Web Billing management URL, or null when no active web subscription exists. */
  getManagementUrl(userId: string): Promise<string | null>;
}

export interface RevenueCatV2Deps {
  fetch?: typeof fetch;
}

interface V2Subscription {
  id?: unknown;
  store?: unknown;
  status?: unknown;
  gives_access?: unknown;
}

const REVENUECAT_V2_API_BASE = 'https://api.revenuecat.com/v2';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Creates a RevenueCat REST API v2 client.
 *
 * Args:
 *   apiKey: RevenueCat REST API v2 secret key.
 *   projectId: RevenueCat project identifier.
 *   deps: Optional dependencies for test injection (custom fetch).
 *
 * Returns:
 *   Configured RevenueCatV2Client whose `getManagementUrl` throws an Error with the
 *   HTTP status on unexpected non-2xx upstream responses.
 */
export function createRevenueCatV2Client(
  apiKey: string,
  projectId: string,
  deps?: RevenueCatV2Deps
): RevenueCatV2Client {
  const fetchImpl = deps?.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json'
  };
  const encodedProjectId = encodeURIComponent(projectId);

  return {
    async getManagementUrl(userId: string): Promise<string | null> {
      const subsUrl =
        `${REVENUECAT_V2_API_BASE}/projects/${encodedProjectId}` +
        `/customers/${encodeURIComponent(userId)}/subscriptions`;
      const subsRes = await fetchImpl(subsUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (subsRes.status === 404) {
        return null;
      }

      if (!subsRes.ok) {
        throw new Error(`RevenueCat v2 subscriptions request failed with status ${subsRes.status}`);
      }

      const subsBody = (await subsRes.json()) as { items?: unknown };
      const items = Array.isArray(subsBody?.items) ? (subsBody.items as V2Subscription[]) : [];
      const activeWebSub = items.find(
        (item): item is V2Subscription & { id: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          item.store === 'rc_billing' &&
          item.gives_access === true &&
          typeof item.id === 'string' &&
          item.id.length > 0
      );

      if (!activeWebSub) {
        return null;
      }

      const manageUrlEndpoint =
        `${REVENUECAT_V2_API_BASE}/projects/${encodedProjectId}` +
        `/subscriptions/${encodeURIComponent(activeWebSub.id)}/authenticated_management_url`;
      const manageRes = await fetchImpl(manageUrlEndpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!manageRes.ok) {
        throw new Error(`RevenueCat v2 management URL request failed with status ${manageRes.status}`);
      }

      const manageBody = (await manageRes.json()) as { management_url?: unknown };
      return typeof manageBody?.management_url === 'string' && manageBody.management_url.length > 0
        ? manageBody.management_url
        : null;
    }
  };
}
