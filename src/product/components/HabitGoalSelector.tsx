/** Daily habit practice goal selector (Relaxed 5 / Regular 10 / Serious 20 turns). */
import React from 'react';
import type { HabitGoal } from '../server/habitStore';

export interface GoalOption {
  value: HabitGoal;
  label: string;
  turns: string;
  desc: string;
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
  { value: 5, label: 'Relaxed', turns: '5 turns', desc: '5 min/day · light & steady' },
  { value: 10, label: 'Regular', turns: '10 turns', desc: '10 min/day · recommended' },
  { value: 20, label: 'Serious', turns: '20 turns', desc: '20 min/day · fast progress' }
];

export interface HabitGoalSelectorProps {
  value: HabitGoal;
  onChange: (goal: HabitGoal) => void;
  className?: string;
  labelId?: string;
}

export const HabitGoalSelector: React.FC<HabitGoalSelectorProps> = ({
  value,
  onChange,
  className = '',
  labelId = 'habit-goal-label'
}) => {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 ${className}`}
    >
      {GOAL_OPTIONS.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={`min-h-[48px] py-3 px-3.5 rounded-2xl border text-left transition-all flex flex-col justify-center focus:outline-none focus:ring-2 focus:ring-cobalt/40 ${
              isSelected
                ? 'bg-cobalt-tint border-cobalt text-ink shadow-xs'
                : 'bg-surface border-line text-ink hover:border-cobalt/40'
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-sm text-ink">{opt.label}</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isSelected ? 'bg-cobalt text-canvas' : 'bg-canvas text-ink-muted'
                }`}
              >
                {opt.turns}
              </span>
            </div>
            <p className="text-[11px] text-ink-muted mt-0.5">{opt.desc}</p>
          </button>
        );
      })}
    </div>
  );
};
