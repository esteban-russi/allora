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

  const size = 26;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = Math.min(todayCount / goal, 1);
  const strokeDashoffset = circumference - progressRatio * circumference;

  return (
    <div
      role="status"
      aria-label={`${todayCount}/${goal} practice turns completed today${isGoalMet ? ' (goal reached)' : ''}`}
      className={`shrink-0 flex items-center ${className}`}
    >
      {/* Mobile compact ring (< sm) */}
      <div
        className="sm:hidden relative w-[26px] h-[26px] flex items-center justify-center shrink-0"
        title={`${todayCount}/${goal} turns`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="rotate-[-90deg]"
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-line"
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={isGoalMet ? 'text-emerald-500' : 'text-cobalt'}
            fill="none"
          />
        </svg>
        <span className="sr-only">{todayCount}/{goal}</span>
        <span className="absolute text-[9px] font-bold font-mono-data text-ink leading-none">
          {todayCount}
        </span>
      </div>

      {/* Pill from sm up */}
      <div
        className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-mono-data border transition-colors ${
          isGoalMet
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-surface text-ink-muted border-line'
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-2 h-2 rounded-full ${isGoalMet ? 'bg-emerald-500' : 'bg-cobalt'}`}
        />
        <span>
          {todayCount}/{goal}
        </span>
      </div>
    </div>
  );
};
