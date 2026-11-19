/** Daily usage quotas enforcement, monitoring, and HTTP middleware. */
import type { NextFunction, Request, Response } from 'express';
import { summarizeError } from '../../vertexCooldown';
import { defaultUsageStore } from './defaultUsageStore';
import { nextResetAt, usageDay, type UsageStore } from './usageStore';

export type QuotasMode = 'off' | 'monitor' | 'enforce';

/**
 * Determine the active quotas mode from environment variables.
 *
 * Args:
 *   env: Environment dictionary (defaults to process.env).
 *
 * Returns:
 *   'off', 'monitor', or 'enforce'.
 *
 * Raises:
 *   Error: If QUOTAS_MODE has an unexpected value.
 */
export function quotasMode(env: NodeJS.ProcessEnv = process.env): QuotasMode {
  const raw = env.QUOTAS_MODE?.trim() || 'off';
  if (raw === 'off' || raw === 'monitor' || raw === 'enforce') {
    return raw;
  }
  throw new Error(`QUOTAS_MODE must be "off", "monitor", or "enforce", got "${raw}"`);
}

export interface RequireQuotaDeps {
  store?: UsageStore;
  now?: () => number;
  mode?: QuotasMode;
}

/**
 * Express middleware factory to reserve one unit of daily quota for a counter.
 *
 * The unit is refunded when the handler answers with any error status, so invalid
 * requests (400) and server failures (5xx) never count against the learner.
 *
 * Args:
 *   counter: Usage counter to consume ('chatMessages' | 'helperRequests').
 *   deps: Injectable store, clock, and quotas mode overrides.
 *
 * Returns:
 *   Express middleware handler.
 */
export function requireQuota(
  counter: 'chatMessages' | 'helperRequests',
  deps: RequireQuotaDeps = {}
) {
  const store = deps.store ?? defaultUsageStore;
  const now = deps.now ?? Date.now;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const mode = deps.mode ?? quotasMode();
    if (mode === 'off') {
      next();
      return;
    }

    const userId = req.user?.userId;
    const accountInfo = req.account;
    if (!userId || !accountInfo) {
      next();
      return;
    }

    const { tier, limits } = accountInfo;
    const limit = limits[counter];
    const nowMs = now();
    const day = usageDay(nowMs);

    try {
      const result = await store.tryConsume(userId, day, counter, 1, limit);
      res.locals.quota = { counter, used: result.used, limit };

      if (!result.allowed) {
        if (mode === 'enforce') {
          res.status(429).json({
            error: 'Daily limit reached',
            code: 'QUOTA_EXCEEDED',
            counter,
            limit,
            tier,
            resetsAt: nextResetAt(nowMs)
          });
          return;
        }
        if (mode === 'monitor') {
          console.warn(`[Quota] over limit (monitor): tier=${tier} counter=${counter}`);
          next();
          return;
        }
      }

      // Unit was consumed: refund it if the request was rejected or failed (4xx/5xx)
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          store.add(userId, day, counter, -1).catch((err: unknown) => {
            console.error('[Quota] Refund failed:', summarizeError(err));
          });
        }
      });

      next();
    } catch (err: unknown) {
      console.error('[Quota] Store error, failing open:', summarizeError(err));
      next();
    }
  };
}
