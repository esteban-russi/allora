import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayHabitCard } from '../src/product/components/TodayHabitCard';
import type { HabitSummary } from '../src/product/server/habitStore';

describe('TodayHabitCard', () => {
  const dummyHabits: HabitSummary = {
    todayCount: 7,
    goal: 10,
    currentStreak: 5,
    longestStreak: 12,
    lastGoalMetDay: '2026-11-19',
    last7Days: [],
    weekDays: [
      { date: '2026-11-16', dayOfWeek: 'Mon', turns: 10, met: true, isToday: false },
      { date: '2026-11-17', dayOfWeek: 'Tue', turns: 12, met: true, isToday: false },
      { date: '2026-11-18', dayOfWeek: 'Wed', turns: 10, met: true, isToday: false },
      { date: '2026-11-19', dayOfWeek: 'Thu', turns: 10, met: true, isToday: false },
      { date: '2026-11-20', dayOfWeek: 'Fri', turns: 7, met: false, isToday: true },
      { date: '2026-11-21', dayOfWeek: 'Sat', turns: 0, met: false, isToday: false },
      { date: '2026-11-22', dayOfWeek: 'Sun', turns: 0, met: false, isToday: false }
    ],
    reminder: { enabled: false, time: '19:00' },
    timeZone: 'Europe/Rome',
    goalMetToday: false
  };

  it('renders progress ring with accessible text alternative and streak', () => {
    const html = renderToStaticMarkup(
      React.createElement(TodayHabitCard, { habits: dummyHabits })
    );

    expect(html).toContain('7 of 10 practice turns completed today');
    expect(html).toContain('5-day streak');
    expect(html).toContain('7 of 10 turns');
  });

  it('displays encouraging copy when streak is 0 without guilt tripping', () => {
    const zeroStreakHabits = { ...dummyHabits, todayCount: 0, currentStreak: 0 };
    const html = renderToStaticMarkup(
      React.createElement(TodayHabitCard, { habits: zeroStreakHabits })
    );

    expect(html).toContain('Start a streak today');
    expect(html).not.toContain('lost your streak');
  });
});
