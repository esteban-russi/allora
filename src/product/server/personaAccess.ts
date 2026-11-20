/** Server-side access control for premium tutors. */
import type { NextFunction, Request, Response } from 'express';
import { isPremiumPersona, PERSONA_PROMPTS, PREMIUM_PERSONA_IDS } from '../data/personaPrompts';
import type { Tier } from '../../platform/server/accountStore';

export const PREMIUM_REQUIRED_BODY = {
  error: 'This tutor needs Premium',
  code: 'PREMIUM_REQUIRED'
} as const;

/**
 * True when this tier may talk to this tutor.
 *
 * Args:
 *   tier: Account tier ('guest' | 'free' | 'premium').
 *   personaId: Tutor identifier.
 *   premiumIds: Override list of premium persona IDs (defaults to PREMIUM_PERSONA_IDS).
 *
 * Returns:
 *   True when the tutor is free or the tier is 'premium'.
 */
export function canUsePersona(
  tier: Tier,
  personaId: string,
  premiumIds: readonly string[] = PREMIUM_PERSONA_IDS
): boolean {
  if (!isPremiumPersona(personaId, premiumIds)) return true;
  return tier === 'premium';
}

/**
 * Express middleware blocking non-premium accounts from premium tutors.
 *
 * Placed ahead of `requireQuota` on `/api/chat` so a denied request never
 * consumes a daily message. Unknown persona IDs pass through so the route's
 * own validation answers with 400.
 *
 * Args:
 *   premiumIds: Optional override list of premium persona IDs (for tests).
 *
 * Returns:
 *   Express middleware handler.
 */
export function requirePersonaAccess(premiumIds?: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const personaId = req.body?.personaId;
    if (typeof personaId !== 'string' || !Object.hasOwn(PERSONA_PROMPTS, personaId)) {
      next();
      return;
    }
    const tier = req.account?.tier;
    if (!tier) {
      next();
      return;
    }
    if (!canUsePersona(tier, personaId, premiumIds)) {
      res.status(403).json(PREMIUM_REQUIRED_BODY);
      return;
    }
    next();
  };
}
