/** Account lifecycle routes: account merge and account deletion. */
import { Router, type Request, type Response } from 'express';
import type { SessionStore } from './sessionStore';
import type { AccountStore } from './accountStore';
import type { UsageStore } from './usageStore';
import type { IdentityAdmin } from './identityAdmin';
import type { AuthenticatedUser } from './auth';
import { defaultSessionStore } from './defaultSessionStore';
import { defaultAccountStore } from './defaultAccountStore';
import { defaultUsageStore } from './defaultUsageStore';
import { defaultIdentityAdmin } from './identityAdmin';
import { verifyIdToken } from './auth';
import { usageDay } from './usageStore';
import { invalidateAccountCache } from './accountMiddleware';
import { summarizeError } from '../../vertexCooldown';

export interface AccountRouterDeps {
  sessions?: SessionStore;
  accounts?: AccountStore;
  usage?: UsageStore;
  identity?: IdentityAdmin;
  verifyToken?: (token: string) => Promise<AuthenticatedUser | null>;
  now?: () => number;
}

const USAGE_COUNTERS = ['chatMessages', 'voiceSeconds', 'helperRequests'] as const;

/**
 * Create Express router for /api/account endpoints.
 *
 * Args:
 *   deps: Storage and identity dependencies (injectable for testing).
 *
 * Returns:
 *   Configured Express Router.
 */
export function createAccountRouter(deps: AccountRouterDeps = {}): Router {
  const router = Router();
  const sessions = deps.sessions ?? defaultSessionStore;
  const accounts = deps.accounts ?? defaultAccountStore;
  const usage = deps.usage ?? defaultUsageStore;
  const identity = deps.identity ?? defaultIdentityAdmin;
  const verifyToken = deps.verifyToken ?? verifyIdToken;
  const now = deps.now ?? Date.now;

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

  return router;
}
