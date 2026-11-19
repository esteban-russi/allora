/** Billing routes for synchronizing subscription state with RevenueCat. */
import { Router, type Request, type Response } from 'express';
import type { AccountStore } from './accountStore';
import { defaultAccountStore } from './defaultAccountStore';
import { tierFor } from './plans';
import { createRevenueCatClient, type RevenueCatClient } from './revenueCat';
import { syncSubscription } from './billingSync';

export interface BillingRouterDeps {
  revenueCat?: RevenueCatClient | null;
  accounts?: AccountStore;
  now?: () => number;
}

/**
 * Creates Express router for /api/billing endpoints.
 *
 * Args:
 *   deps: Injectable dependencies for testing.
 *
 * Returns:
 *   Express Router configured for billing operations.
 */
export function createBillingRouter(deps: BillingRouterDeps = {}): Router {
  const router = Router();
  const accounts = deps.accounts ?? defaultAccountStore;
  const now = deps.now ?? Date.now;

  const getClient = (): RevenueCatClient | null => {
    if (deps.revenueCat !== undefined) {
      return deps.revenueCat;
    }
    const secretKey = process.env.REVENUECAT_SECRET_KEY;
    if (!secretKey) return null;
    return createRevenueCatClient(secretKey);
  };

  router.post('/sync', async (req: Request, res: Response) => {
    const revenueCat = getClient();
    if (!revenueCat) {
      res.status(503).json({ code: 'BILLING_UNAVAILABLE' });
      return;
    }

    const user = req.user;
    if (!user || user.isAnonymous) {
      res.status(403).json({ code: 'SIGN_IN_REQUIRED' });
      return;
    }

    try {
      const nowMs = now();
      const sub = await syncSubscription(user.userId, {
        revenueCat,
        accounts,
        now
      });

      const updatedAccount = await accounts.getAccount(user.userId);
      const tier = updatedAccount ? tierFor(updatedAccount, nowMs) : 'free';

      res.json({ tier, subscription: sub });
    } catch (_err) {
      res.status(502).json({ code: 'BILLING_UPSTREAM_ERROR' });
    }
  });

  return router;
}
