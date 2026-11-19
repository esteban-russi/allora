/** Quota error parsing and formatting utilities for HTTP responses.
 * Detects 429 QUOTA_EXCEEDED payloads and formats quota reset timestamps.
 */

export interface QuotaError {
  counter: 'chatMessages' | 'voiceSeconds' | 'helperRequests';
  limit: number;
  tier: string;
  resetsAt: string;
}

/**
 * Parse a 429 QUOTA_EXCEEDED response; returns null for any other response status or structure.
 * Clones the response before reading so that non-matching responses retain their unread body.
 *
 * Args:
 *   res: Fetch Response object to check.
 *
 * Returns:
 *   Parsed QuotaError object or null if not a quota exceeded error.
 */
export async function readQuotaError(res: Response): Promise<QuotaError | null> {
  if (res.status !== 429) {
    return null;
  }

  try {
    const clone = res.clone();
    const data = await clone.json();
    if (
      data &&
      typeof data === 'object' &&
      data.code === 'QUOTA_EXCEEDED' &&
      (data.counter === 'chatMessages' ||
        data.counter === 'voiceSeconds' ||
        data.counter === 'helperRequests') &&
      typeof data.limit === 'number' &&
      typeof data.tier === 'string' &&
      typeof data.resetsAt === 'string'
    ) {
      return {
        counter: data.counter,
        limit: data.limit,
        tier: data.tier,
        resetsAt: data.resetsAt
      };
    }
  } catch {
    // Non-JSON or malformed body
    return null;
  }

  return null;
}

/**
 * Format an ISO reset timestamp into a localized local time string ("HH:MM").
 *
 * Args:
 *   resetsAt: ISO 8601 date string.
 *   locale: Optional locale tag (defaults to system default).
 *
 * Returns:
 *   Formatted time string like "01:00".
 */
export function formatResetTime(resetsAt: string, locale?: string): string {
  const date = new Date(resetsAt);
  if (isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
