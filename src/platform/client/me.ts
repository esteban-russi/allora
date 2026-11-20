/** Account state utilities and types for the client. */
import type { Consent, Subscription, Tier } from '../server/accountStore';
import type { PlanLimits } from '../server/plans';
import type { DailyUsage } from '../server/usageStore';
import { getWithAuth, postJson } from './apiClient';

export interface Me {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  tier: Tier;
  limits: PlanLimits;
  usage: DailyUsage;
  resetsAt: string;
  consent: Consent | null;
  subscription: Omit<Subscription, 'updatedAt'> | null;
}

/**
 * Parse and validate the response from /api/me.
 *
 * Args:
 *   data: Unknown JSON response.
 *
 * Returns:
 *   Validated Me object, or null if invalid.
 */
export function parseMeResponse(data: unknown): Me | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.userId !== 'string') return null;
  if (d.email !== null && typeof d.email !== 'string') return null;
  if (typeof d.isAnonymous !== 'boolean') return null;
  if (d.tier !== 'guest' && d.tier !== 'free' && d.tier !== 'premium') return null;
  if (!d.limits || typeof d.limits !== 'object') return null;
  if (!d.usage || typeof d.usage !== 'object') return null;
  if (typeof d.resetsAt !== 'string') return null;

  let consent: Consent | null = null;
  if (d.consent !== undefined && d.consent !== null) {
    if (typeof d.consent !== 'object') return null;
    const c = d.consent as Record<string, unknown>;
    if (typeof c.termsVersion !== 'string' || typeof c.acceptedAt !== 'string') return null;
    consent = { termsVersion: c.termsVersion, acceptedAt: c.acceptedAt };
  }

  return {
    userId: d.userId,
    email: d.email,
    isAnonymous: d.isAnonymous,
    tier: d.tier as Tier,
    limits: d.limits as PlanLimits,
    usage: d.usage as DailyUsage,
    resetsAt: d.resetsAt,
    consent,
    subscription: (d.subscription as any) ?? null
  };
}

/**
 * Record acceptance of the current Terms and Privacy Policy on the server.
 *
 * Args:
 *   termsVersion: Version string of the accepted terms.
 *
 * Returns:
 *   Stored Consent record on success, or null if the request failed.
 */
export async function submitConsent(termsVersion: string): Promise<Consent | null> {
  try {
    const res = await postJson('/api/account/consent', { termsVersion });
    if (!res.ok) return null;
    const body = (await res.json()) as { consent?: unknown };
    const raw = body?.consent as Record<string, unknown> | undefined;
    if (raw && typeof raw.termsVersion === 'string' && typeof raw.acceptedAt === 'string') {
      return { termsVersion: raw.termsVersion, acceptedAt: raw.acceptedAt };
    }
    return null;
  } catch (err) {
    console.warn('[Account] Failed to save consent:', err);
    return null;
  }
}

/**
 * Fetch current authenticated user profile, tier, limits, and usage from /api/me.
 *
 * Returns:
 *   Parsed Me object, or null on network error or invalid response.
 */
export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await getWithAuth('/api/me');
    if (!res.ok) return null;
    const body = await res.json();
    return parseMeResponse(body);
  } catch (err) {
    console.warn('[Account] Failed to fetch /api/me:', err);
    return null;
  }
}
