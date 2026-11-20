/** Notice shown when Premium has ended while using a Premium tutor. */
import React from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { EMMANUELE } from '../data/personas';
import type { Tier } from '../../platform/server/accountStore';
import type { Persona } from '../types';

/**
 * True when the active tutor requires Premium while the account is not on the premium tier.
 *
 * Args:
 *   persona: Active tutor.
 *   tier: Account tier, or null/undefined while loading.
 *
 * Returns:
 *   True when the "Premium has ended" notice should be shown.
 */
export function isTutorLockedForTier(
  persona: Pick<Persona, 'isPremium'>,
  tier: Tier | null | undefined
): boolean {
  return Boolean(persona.isPremium && tier && tier !== 'premium');
}

export interface PremiumEndedNoticeProps {
  tutorName: string;
  canUpgrade: boolean;
  onSeePlans?: () => void;
  onContinueWithEmmanuele: () => void;
}

export const PremiumEndedNotice: React.FC<PremiumEndedNoticeProps> = ({
  tutorName,
  canUpgrade,
  onSeePlans,
  onContinueWithEmmanuele
}) => {
  return (
    <div
      id="premium-ended-notice"
      role="status"
      aria-live="polite"
      className="p-5 rounded-2xl bg-surface border border-line shadow-soft space-y-3 max-w-md my-2"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-coral-tint text-coral flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-semibold text-sm text-ink">
            Your Premium has ended. {tutorName} is a Premium tutor.
          </p>
        </div>
      </div>

      <div className="pt-1 flex flex-wrap items-center gap-2">
        {canUpgrade && onSeePlans && (
          <button
            type="button"
            onClick={onSeePlans}
            className="h-9 px-4 rounded-xl bg-cobalt text-canvas text-xs font-semibold hover:bg-cobalt-strong transition-colors flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>See plans</span>
          </button>
        )}
        <button
          type="button"
          onClick={onContinueWithEmmanuele}
          className="h-9 px-4 rounded-xl bg-canvas border border-line text-ink text-xs font-semibold hover:bg-cobalt-tint transition-colors"
        >
          Continue with {EMMANUELE.name}
        </button>
      </div>
    </div>
  );
};
