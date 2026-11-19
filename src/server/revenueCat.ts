/** RevenueCat REST API v1 client and subscriber mapping.
 * Handles fetching, mapping, and deleting RevenueCat subscriber records.
 */
import type { Subscription } from './accountStore';

export interface RevenueCatClient {
  /** Raw `subscriber` object, or null when RevenueCat answers 404. Throws on other errors. */
  getSubscriber(userId: string): Promise<Record<string, unknown> | null>;
  /** Delete subscriber from RevenueCat. Throws on errors. */
  deleteSubscriber(userId: string): Promise<void>;
}

const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const LIFETIME_EXPIRES_AT = '9999-12-31T23:59:59.999Z';

/**
 * Maps a raw RevenueCat subscriber payload to a local Subscription object.
 *
 * Args:
 *   subscriber: RevenueCat subscriber object or response.
 *   nowMs: Current time in milliseconds.
 *
 * Returns:
 *   Mapped Subscription record, or null if premium entitlement is missing.
 */
export function toSubscription(subscriber: Record<string, unknown>, nowMs: number): Subscription | null {
  const subObj = (subscriber.subscriber && typeof subscriber.subscriber === 'object'
    ? subscriber.subscriber
    : subscriber) as Record<string, unknown>;

  const entitlements = (subObj.entitlements ?? {}) as Record<string, any>;
  const ent = entitlements.premium;
  if (!ent || typeof ent !== 'object') {
    return null;
  }

  const subscriptions = (subObj.subscriptions ?? {}) as Record<string, any>;
  const productId = (ent.product_identifier as string) || '';
  const sub = subscriptions[productId] as Record<string, any> | undefined;

  const rawExpires = ent.expires_date as string | null | undefined;
  const expires = rawExpires ?? LIFETIME_EXPIRES_AT;
  const graceUntil = (ent.grace_period_expires_date as string | null | undefined) ?? null;

  const expiresMs = Date.parse(expires);
  const graceMs = graceUntil ? Date.parse(graceUntil) : 0;

  let status: 'active' | 'grace' | 'expired';
  if (nowMs < expiresMs) {
    status = 'active';
  } else if (graceUntil && nowMs < graceMs) {
    status = 'grace';
  } else {
    status = 'expired';
  }

  const expiresAt = status === 'grace' && graceUntil ? graceUntil : expires;
  const store: 'play_store' | 'web' = sub?.store === 'play_store' ? 'play_store' : 'web';
  const periodType: 'trial' | 'normal' = sub?.period_type === 'trial' ? 'trial' : 'normal';
  const willRenew = !sub?.unsubscribe_detected_at && !sub?.billing_issues_detected_at;
  const managementUrl = typeof subObj.management_url === 'string' ? subObj.management_url : null;
  const updatedAt = new Date(nowMs).toISOString();

  return {
    status,
    productId,
    store,
    periodType,
    expiresAt,
    willRenew,
    managementUrl,
    updatedAt
  };
}

/**
 * Creates a RevenueCat REST API v1 client.
 *
 * Args:
 *   secretKey: RevenueCat v1 REST API secret key.
 *   fetchImpl: Custom fetch implementation (optional, defaults to global fetch).
 *
 * Returns:
 *   Configured RevenueCatClient.
 */
export function createRevenueCatClient(secretKey: string, fetchImpl: typeof fetch = fetch): RevenueCatClient {
  return {
    async getSubscriber(userId: string): Promise<Record<string, unknown> | null> {
      const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(userId)}`;
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        throw new Error(`RevenueCat getSubscriber failed with status ${res.status}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      return (json.subscriber as Record<string, unknown>) ?? json;
    },

    async deleteSubscriber(userId: string): Promise<void> {
      const url = `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(userId)}`;
      const res = await fetchImpl(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (res.status === 404 || res.ok) {
        return;
      }

      throw new Error(`RevenueCat deleteSubscriber failed with status ${res.status}`);
    }
  };
}
