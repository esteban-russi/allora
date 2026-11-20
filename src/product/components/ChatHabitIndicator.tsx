/** Unobtrusive habit practice goal indicator for the Chat header. */
import React, { useEffect, useState } from 'react';
import { subscribeHabits } from '../client/habitsClient';
import type { HabitSummary } from '../server/habitStore';

export interface ChatHabitIndicatorProps {
  initialHabits?: HabitSummary | null;
  className?: string;
}

export const ChatHabitIndicator: React.FC<ChatHabitIndicatorProps> = ({
  initialHabits = null,
  className = ''
}) => {
  const [habits, setHabits] = useState<HabitSummary | null>(initialHabits);

  useEffect(() => {
    return subscribeHabits((latest) => {
      setHabits(latest);
    });
  }, []);

  const todayCount = habits?.todayCount ?? 0;
  const goal = habits?.goal ?? 10;
  const isGoalMet = todayCount >= goal;

  return (
    <div
      role="status"
      aria-label={`${todayCount} of ${goal} practice turns completed today${isGoalMet ? ' (goal reached)' : ''}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-mono-data border transition-colors ${
        isGoalMet
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-surface text-ink-muted border-line'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full ${isGoalMet ? 'bg-emerald-500' : 'bg-cobalt'}`}
      />
      <span>
        {todayCount}/{goal}
      </span>
    </div>
  );
};
