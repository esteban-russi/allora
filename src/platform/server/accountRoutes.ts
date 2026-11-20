/** Account lifecycle routes: consent, account merge, and account deletion. */
import { Router, type Request, type Response } from 'express';
import type { AccountStore, Consent } from './accountStore';
import type { UsageStore } from './usageStore';
import type { ReportStore } from './reportStore';
import type { IdentityAdmin } from './identityAdmin';
import type { AuthenticatedUser } from './auth';
import { defaultAccountStore } from './defaultAccountStore';
import { defaultUsageStore } from './defaultUsageStore';
import { defaultReportStore } from './defaultReportStore';
import { defaultIdentityAdmin } from './identityAdmin';
import { verifyIdToken } from './auth';
import { usageDay } from './usageStore';
import { invalidateAccountCache } from './accountMiddleware';
import { summarizeError } from './vertexCooldown';
import { createRevenueCatClient, type RevenueCatClient } from './revenueCat';

/** The per-user app data that moves with a guest merge and goes with an account deletion. */
export interface UserDataStore {
  transferUserSessions(fromUserId: string, toUserId: string): Promise<'moved' | 'discarded' | 'none'>;
  deleteAllUserData(userId: string): Promise<number>;
}

export interface AccountRouterDeps {
  /** The app's own per-user data; required because it belongs to the app, not the platform. */
  sessions: UserDataStore;
  accounts?: AccountStore;
  usage?: UsageStore;
  reports?: ReportStore;
  identity?: IdentityAdmin;
  revenueCat?: RevenueCatClient | null;
  verifyToken?: (token: string) => Promise<AuthenticatedUser | null>;
  now?: () => number;
}

const USAGE_COUNTERS = ['chatMessages', 'voiceSeconds', 'helperRequests'] as const;
const MAX_TERMS_VERSION_LENGTH = 20;

/**
 * Create Express router for /api/account endpoints.
 *
 * Args:
 *   deps: The app's per-user data store, plus storage and identity overrides for testing.
 *
 * Returns:
 *   Configured Express Router.
 */
export function createAccountRouter(deps: AccountRouterDeps): Router {
  const router = Router();
  const { sessions } = deps;
  const accounts = deps.accounts ?? defaultAccountStore;
  const usage = deps.usage ?? defaultUsageStore;
  const reports = deps.reports ?? defaultReportStore;
  const identity = deps.identity ?? defaultIdentityAdmin;
  const verifyToken = deps.verifyToken ?? verifyIdToken;
  const now = deps.now ?? Date.now;

  router.post('/consent', async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const rawVersion = req.body && typeof req.body === 'object' ? req.body.termsVersion : undefined;
    const termsVersion = typeof rawVersion === 'string' ? rawVersion.trim() : '';
    if (!termsVersion || rawVersion.length > MAX_TERMS_VERSION_LENGTH) {
      res.status(400).json({
        error: `termsVersion must be a non-empty string of at most ${MAX_TERMS_VERSION_LENGTH} characters`
      });
      return;
    }

    const consent: Consent = {
      termsVersion,
      acceptedAt: new Date(now()).toISOString()
    };

    try {
      await accounts.setConsent(user.userId, consent);
      invalidateAccountCache(user.userId);
      res.json({ consent });
    } catch (err) {
      console.error('[Account] Error storing consent:', summarizeError(err));
      res.status(500).json({ error: 'Could not save consent' });
    }
  });

  router.post('/merge', async (req: Request, res: Response) => {
    const user = req.user;
    if (!user || user.isAnonymous) {
      res.status(403).json({ code: 'SIGN_IN_REQUIRED' });
      return;
    }

    const { guestIdToken } = req.body ?? {};
    if (!guestIdToken || typeof guestIdToken !== 'string') {
      res.status(400).json({ code: 'INVALID_GUEST_TOKEN' });
      return;
    }

    const guest = await verifyToken(guestIdToken);
    if (!guest || !guest.isAnonymous || guest.userId === user.userId) {
      res.status(400).json({ code: 'INVALID_GUEST_TOKEN' });
      return;
    }

    try {
      const outcome = await sessions.transferUserSessions(guest.userId, user.userId);

      const day = usageDay(now());
      const guestUsage = await usage.getUsage(guest.userId, day);
      for (const counter of USAGE_COUNTERS) {
        const val = guestUsage[counter];
        if (val > 0) {
          await usage.add(user.userId, day, counter, val);
        }
      }
      await usage.deleteAllUserUsage(guest.userId);
      await reports.transferUserReports(guest.userId, user.userId);

      const [targetAccount, guestAccount] = await Promise.all([
        accounts.getAccount(user.userId),
        accounts.getAccount(guest.userId)
      ]);
      if (targetAccount && !targetAccount.consent && guestAccount?.consent) {
        await accounts.setConsent(user.userId, guestAccount.consent);
        invalidateAccountCache(user.userId);
      }

      await accounts.deleteAccount(guest.userId);
      invalidateAccountCache(guest.userId);

      try {
        await identity.deleteUser(guest.userId);
      } catch (err) {
        console.error('[Account] Failed to delete guest identity:', summarizeError(err));
      }

      res.json({ sessions: outcome });
    } catch (err) {
      console.error('[Account] Error merging guest account:', summarizeError(err));
      res.status(500).json({ error: 'Could not merge account' });
    }
  });

  router.delete('/', async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const userId = user.userId;
    const hadActiveSubscription = req.account?.tier === 'premium';

    try {
      await sessions.deleteAllUserData(userId);
      await usage.deleteAllUserUsage(userId);
      await reports.deleteAllUserReports(userId);
      await accounts.deleteAccount(userId);
      invalidateAccountCache(userId);

      try {
        await identity.deleteUser(userId);
      } catch (err) {
        console.error('[Account] Failed to delete identity for user:', summarizeError(err));
        res.status(500).json({ error: 'Could not delete user identity' });
        return;
      }

      const getRevenueCat = (): RevenueCatClient | null => {
        if (deps.revenueCat !== undefined) {
          return deps.revenueCat;
        }
        const secretKey = process.env.REVENUECAT_SECRET_KEY;
        if (!secretKey) return null;
        return createRevenueCatClient(secretKey);
      };

      const rc = getRevenueCat();
      if (rc) {
        try {
          await rc.deleteSubscriber(userId);
        } catch (err) {
          console.error('[Account] Failed to delete RevenueCat subscriber:', summarizeError(err));
        }
      }

      res.json({ status: 'deleted', hadActiveSubscription });
    } catch (err) {
      console.error('[Account] Error deleting account:', summarizeError(err));
      res.status(500).json({ error: 'Could not delete account' });
    }
  });

  return router;
}
