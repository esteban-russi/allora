/** Express middleware attaching learner accounts and plan limits to authenticated requests. */
import type { NextFunction, Request, Response } from 'express';
import { summarizeError } from '../../vertexCooldown';
import type { Account, AccountStore, Tier } from './accountStore';
import { PLAN_LIMITS, tierFor, type PlanLimits } from './plans';

export interface RequestAccount {
  account: Account;
  tier: Tier;
  limits: PlanLimits;
}

const DEFAULT_CACHE_MS = 60 * 1000;

interface CacheEntry {
  value: RequestAccount;
  expiresAt: number;
}

const accountCache = new Map<string, CacheEntry>();

/**
 * Drop any cached request account for this user.
 *
 * Args:
 *   userId: Target user identifier.
 */
export function invalidateAccountCache(userId: string): void {
  accountCache.delete(userId);
}

export interface AttachAccountOptions {
  cacheMs?: number;
  now?: () => number;
}

/**
 * Express middleware to load and attach account details to authenticated requests.
 *
 * Args:
 *   store: AccountStore implementation.
 *   options: Cache duration and clock overrides.
 *
 * Returns:
 *   Express middleware handler.
 */
export function attachAccount(store: AccountStore, options: AttachAccountOptions = {}) {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const now = options.now ?? Date.now;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      next();
      return;
    }

    const nowMs = now();
    const cached = accountCache.get(user.userId);

    if (
      cached &&
      cached.expiresAt > nowMs &&
      user.isAnonymous === cached.value.account.isAnonymous
    ) {
      req.account = cached.value;
      next();
      return;
    }

    try {
      const account = await store.upsertFromAuth({
        userId: user.userId,
        email: user.email,
        isAnonymous: user.isAnonymous
      });
      const tier = tierFor(account, nowMs);
      const limits = PLAN_LIMITS[tier];
      const requestAccount: RequestAccount = { account, tier, limits };

      accountCache.set(user.userId, {
        value: requestAccount,
        expiresAt: nowMs + cacheMs
      });

      req.account = requestAccount;
      next();
    } catch (err: unknown) {
      console.error('[Account] Error fetching or upserting account:', summarizeError(err));
      res.status(503).json({
        error: 'Account service unavailable',
        code: 'ACCOUNT_UNAVAILABLE'
      });
    }
  };
}
