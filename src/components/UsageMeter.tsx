import React from 'react';
import type { Me } from '../utils/me';

export interface UsageMeterProps {
  me: Me | null;
}

/** Component showing daily usage allowance meters in the utility panel. */
export const UsageMeter: React.FC<UsageMeterProps> = ({ me }) => {
  if (!me) return null;

  const isPremium = me.tier === 'premium';
  const chatUsed = me.usage.chatMessages;
  const chatLimit = me.limits.chatMessages;
  const chatPercent = Math.min(100, Math.round((chatUsed / chatLimit) * 100));

  const callMinsUsed = Math.floor(me.usage.voiceSeconds / 60);
  const callMinsLimit = Math.round(me.limits.voiceSeconds / 60);
  const voicePercent = Math.min(
    100,
    Math.round((me.usage.voiceSeconds / Math.max(1, me.limits.voiceSeconds)) * 100)
  );

  return (
    <div
      aria-label="Daily usage"
      className="mt-3 pt-3 border-t border-line/70 space-y-2.5 text-xs text-ink"
    >
      {/* Messages */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-ink-muted">
          <span>{isPremium ? 'Messages' : 'Messages today'}</span>
          <span className="font-mono-data font-medium text-ink">
            {isPremium ? 'Unlimited' : `${chatUsed} / ${chatLimit}`}
          </span>
        </div>
        {!isPremium && (
          <div
            role="progressbar"
            aria-valuenow={chatUsed}
            aria-valuemin={0}
            aria-valuemax={chatLimit}
            aria-label="Daily messages"
            className="h-1.5 rounded-full bg-line overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                chatPercent >= 100 ? 'bg-amber-500' : 'bg-cobalt'
              }`}
              style={{ width: `${chatPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Call minutes */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-ink-muted">
          <span>Call minutes today</span>
          <span className="font-mono-data font-medium text-ink">
            {callMinsUsed} / {callMinsLimit}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={callMinsUsed}
          aria-valuemin={0}
          aria-valuemax={callMinsLimit}
          aria-label="Daily call minutes"
          className="h-1.5 rounded-full bg-line overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              voicePercent >= 100 ? 'bg-amber-500' : 'bg-cobalt'
            }`}
            style={{ width: `${voicePercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};
