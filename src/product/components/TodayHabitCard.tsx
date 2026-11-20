/** Today's practice habit card with progress ring, streak flame, and 7-day row. */
import React from 'react';
import { Flame, Check } from 'lucide-react';
import type { HabitSummary } from '../server/habitStore';

export interface TodayHabitCardProps {
  habits: HabitSummary | null;
  className?: string;
}

export const TodayHabitCard: React.FC<TodayHabitCardProps> = ({ habits, className = '' }) => {
  const goal = habits?.goal ?? 10;
  const todayCount = habits?.todayCount ?? 0;
  const currentStreak = habits?.currentStreak ?? 0;
  const progressRatio = Math.min(todayCount / goal, 1);

  // SVG Progress Ring calculations
  const size = 54;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progressRatio * circumference;

  const weekDays = habits?.weekDays ?? [
    { date: '2026-11-16', dayOfWeek: 'Mon', turns: 0, met: false, isToday: false },
    { date: '2026-11-17', dayOfWeek: 'Tue', turns: 0, met: false, isToday: false },
    { date: '2026-11-18', dayOfWeek: 'Wed', turns: 0, met: false, isToday: false },
    { date: '2026-11-19', dayOfWeek: 'Thu', turns: 0, met: false, isToday: false },
    { date: '2026-11-20', dayOfWeek: 'Fri', turns: 0, met: false, isToday: true },
    { date: '2026-11-21', dayOfWeek: 'Sat', turns: 0, met: false, isToday: false },
    { date: '2026-11-22', dayOfWeek: 'Sun', turns: 0, met: false, isToday: false }
  ];

  const getEncouragingMessage = () => {
    if (todayCount >= goal) {
      return 'Goal reached today! Ottimo lavoro! 🎉';
    }
    if (todayCount > 0) {
      const remaining = goal - todayCount;
      return `${remaining} more turn${remaining === 1 ? '' : 's'} to hit today's goal.`;
    }
    return 'Take a few turns today to keep your Italian fresh!';
  };

  return (
    <section
      aria-label="Today's practice and streak"
      className={`p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-soft space-y-2.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-cobalt">
            Today's practice
          </span>
        </div>

        {/* Streak indicator */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            currentStreak > 0
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-canvas text-ink-muted border border-line'
          }`}
          aria-label={currentStreak > 0 ? `${currentStreak}-day streak` : 'Start a streak today'}
        >
          <Flame
            className={`w-3.5 h-3.5 ${currentStreak > 0 ? 'text-amber-500 fill-amber-500' : 'text-ink-muted'}`}
            aria-hidden="true"
          />
          <span>{currentStreak > 0 ? `${currentStreak}-day streak` : 'Start a streak today'}</span>
        </div>
      </div>

      <div className="flex items-center gap-3.5">
        {/* Progress ring */}
        <div className="relative shrink-0 flex items-center justify-center">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="rotate-[-90deg]"
            aria-hidden="true"
          >
            {/* Background track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-line"
              fill="none"
            />
            {/* Progress indicator */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={todayCount >= goal ? 'text-emerald-500' : 'text-cobalt'}
              fill="none"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          {/* Accessible text alternative for screen readers */}
          <span className="sr-only">
            {todayCount} of {goal} practice turns completed today
          </span>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-serif text-sm font-bold text-ink leading-none">
              {todayCount}
            </span>
            <span className="text-[9px] text-ink-muted font-mono-data leading-none mt-0.5">
              /{goal}
            </span>
          </div>
        </div>

        {/* Practice turns status and encouraging copy */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-serif text-base font-semibold text-ink leading-tight">
              {todayCount >= goal ? 'Goal completed' : `${todayCount} of ${goal} turns`}
            </span>
          </div>
          <p className="text-xs text-ink-muted leading-tight line-clamp-1">
            {getEncouragingMessage()}
          </p>
        </div>
      </div>

      {/* 7-day row of dots (Mon..Sun) */}
      <div className="pt-2 border-t border-line/70">
        <div className="flex items-center justify-between text-center">
          {weekDays.map((d) => {
            const isMet = d.met;
            const isToday = d.isToday;
            return (
              <div key={d.date} className="flex flex-col items-center gap-1 flex-1">
                <span
                  className={`text-[9px] font-semibold uppercase ${
                    isToday ? 'text-cobalt font-bold' : 'text-ink-muted'
                  }`}
                >
                  {d.dayOfWeek.slice(0, 1)}
                </span>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                    isMet
                      ? 'bg-emerald-500 text-white shadow-xs'
                      : isToday
                      ? 'bg-cobalt-tint border-2 border-cobalt text-cobalt'
                      : 'bg-canvas border border-line text-ink-muted'
                  }`}
                  title={`${d.dayOfWeek}: ${d.turns}/${goal} turns ${isMet ? '(Goal met)' : ''}`}
                  aria-label={`${d.dayOfWeek}: ${d.turns} of ${goal} turns ${isMet ? ', goal reached' : ''}`}
                >
                  {isMet ? (
                    <Check className="w-3 h-3 stroke-[3]" aria-hidden="true" />
                  ) : (
                    <span>{d.turns > 0 ? d.turns : ''}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
