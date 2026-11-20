import React from 'react';
import { Clock, LogIn, Sparkles } from 'lucide-react';
import { formatResetTime, type QuotaError } from '../client/quotaError';

export interface LimitReachedCardProps {
  quota: QuotaError;
  tier: string;
  canUpgrade: boolean;
  onSignIn?: () => void;
  onSeePlans?: () => void;
  onDismiss?: () => void;
}

/** Card displayed when a daily usage limit is reached. */
export const LimitReachedCard: React.FC<LimitReachedCardProps> = ({
  quota,
  tier,
  canUpgrade,
  onSignIn,
  onSeePlans
}) => {
  const resetTime = formatResetTime(quota.resetsAt);

  const mainText =
    quota.counter === 'chatMessages'
      ? `You've used today's ${quota.limit} messages.`
      : `You've used today's ${Math.round(quota.limit / 60)} minutes of calls.`;

  const resetText = resetTime
    ? `Your allowance resets at ${resetTime}.`
    : 'Your allowance resets tomorrow.';

  return (
    <div
      id="limit-reached-card"
      role="status"
      aria-live="polite"
      className="p-5 rounded-2xl bg-surface border border-line shadow-soft space-y-3 max-w-md my-2"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-cobalt-tint text-cobalt flex items-center justify-center shrink-0 mt-0.5">
          <Clock className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-semibold text-sm text-ink">{mainText}</p>
          <p className="text-xs text-ink-muted">{resetText}</p>
        </div>
      </div>

      <div className="pt-1 flex flex-wrap items-center gap-2">
        {tier === 'guest' && onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="h-9 px-4 rounded-xl bg-cobalt text-canvas text-xs font-semibold hover:bg-cobalt-strong transition-colors flex items-center gap-2"
          >
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign in for more</span>
          </button>
        )}

        {tier === 'free' && canUpgrade && onSeePlans && (
          <button
            type="button"
            onClick={onSeePlans}
            className="h-9 px-4 rounded-xl bg-cobalt text-canvas text-xs font-semibold hover:bg-cobalt-strong transition-colors flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>See plans</span>
          </button>
        )}
      </div>
    </div>
  );
};
