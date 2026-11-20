/** Billing routes for synchronizing subscription state with RevenueCat. */
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { summarizeError } from './vertexCooldown';
import type { AccountStore } from './accountStore';
import { defaultAccountStore } from './defaultAccountStore';
import { tierFor } from './plans';
import { createRevenueCatClient, type RevenueCatClient } from './revenueCat';
import { createRevenueCatV2Client, type RevenueCatV2Client } from './revenueCatV2';
import { syncSubscription } from './billingSync';

export interface BillingRouterDeps {
  revenueCat?: RevenueCatClient | null;
  revenueCatV2?: RevenueCatV2Client | null;
  accounts?: AccountStore;
  now?: () => number;
}

export interface BillingWebhookDeps {
  revenueCat?: RevenueCatClient | null;
  accounts?: AccountStore;
  webhookAuth?: string;
  now?: () => number;
}

/**
 * Constant-time comparison for webhook Authorization header.
 *
 * Args:
 *   header: Authorization header from request.
 *   expectedAuth: Expected authorization token/string.
 *
 * Returns:
 *   True if authorized, false otherwise.
 */
export function verifyWebhookAuth(header: string | undefined, expectedAuth: string | undefined): boolean {
  if (!header || !expectedAuth) return false;

  const compare = (a: string, b: string): boolean => {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  };

  if (compare(header, expectedAuth)) return true;
  if (!expectedAuth.startsWith('Bearer ') && compare(header, `Bearer ${expectedAuth}`)) return true;
  if (expectedAuth.startsWith('Bearer ') && compare(`Bearer ${header}`, expectedAuth)) return true;

  return false;
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

  const getV2Client = (): RevenueCatV2Client | null => {
    if (deps.revenueCatV2 !== undefined) {
      return deps.revenueCatV2;
    }
    const apiKey = process.env.REVENUECAT_V2_SECRET_KEY?.trim();
    const projectId = process.env.REVENUECAT_PROJECT_ID?.trim();
    if (!apiKey || !projectId) return null;
    return createRevenueCatV2Client(apiKey, projectId);
  };

  router.get('/manage', async (req: Request, res: Response) => {
    const revenueCatV2 = getV2Client();
    if (!revenueCatV2) {
      res.status(503).json({ code: 'BILLING_UNAVAILABLE' });
      return;
    }

    const user = req.user;
    if (!user || user.isAnonymous) {
      res.status(403).json({ code: 'SIGN_IN_REQUIRED' });
      return;
    }

    try {
      const url = await revenueCatV2.getManagementUrl(user.userId);
      if (!url) {
        res.status(404).json({ code: 'NO_WEB_SUBSCRIPTION' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json({ url });
    } catch (err: unknown) {
      console.error('[Billing] Management URL failed:', summarizeError(err));
      res.status(502).json({ code: 'BILLING_UPSTREAM_ERROR' });
    }
  });

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
    } catch (err: unknown) {
      console.error('[Billing] Subscription sync failed:', summarizeError(err));
      res.status(502).json({ code: 'BILLING_UPSTREAM_ERROR' });
    }
  });

  return router;
}

/**
 * Creates Express router for /api/webhooks endpoints (RevenueCat webhook receiver).
 *
 * Args:
 *   deps: Injectable dependencies for testing.
 *
 * Returns:
 *   Express Router configured for RevenueCat webhooks.
 */
export function createRevenueCatWebhookRouter(deps: BillingWebhookDeps = {}): Router {
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

  const getExpectedAuth = (): string | undefined => {
    return deps.webhookAuth ?? process.env.REVENUECAT_WEBHOOK_AUTH;
  };

  router.post('/revenuecat', async (req: Request, res: Response) => {
    const revenueCat = getClient();
    const expectedAuth = getExpectedAuth();

    if (!revenueCat || !expectedAuth) {
      res.status(503).json({ error: 'Billing webhook not configured' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!verifyWebhookAuth(authHeader, expectedAuth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || !req.body.event || typeof req.body.event !== 'object') {
      res.status(400).json({ error: 'Invalid webhook payload: missing event' });
      return;
    }

    const event = req.body.event as Record<string, unknown>;
    const eventType = typeof event.type === 'string' ? event.type : 'UNKNOWN';

    if (eventType === 'TEST') {
      res.status(200).json({ ok: true });
      return;
    }

    const candidateIds: unknown[] = [
      event.app_user_id,
      event.original_app_user_id,
      ...(Array.isArray(event.aliases) ? event.aliases : [event.aliases]),
      ...(Array.isArray(event.transferred_from) ? event.transferred_from : [event.transferred_from]),
      ...(Array.isArray(event.transferred_to) ? event.transferred_to : [event.transferred_to])
    ];

    const userIds = Array.from(
      new Set(
        candidateIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    ).slice(0, 20);

    const results = await Promise.allSettled(
      userIds.map((uid) =>
        syncSubscription(uid, {
          revenueCat,
          accounts,
          now
        })
      )
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(
        `[RevenueCat] Webhook event ${eventType} failed for ${failures.length} of ${userIds.length} user(s):`,
        summarizeError(failures[0].reason)
      );
      res.status(500).json({ error: 'Webhook sync failed' });
      return;
    }

    console.log(`[RevenueCat] Processed webhook event ${eventType}, synced ${userIds.length} user(s)`);
    res.status(200).json({ ok: true });
  });

  return router;
}

