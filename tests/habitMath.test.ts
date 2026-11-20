/** Tests for pure habit math: streak computation, time zones, DST transitions, and goal changes. */
import { describe, expect, it } from 'vitest';
import {
  computeStreaks,
  formatDayForTimeZone,
  generateLast7Days,
  generateWeekMonToSun,
  isValidTimeZone,
  normalizeTimeZone,
  shiftDay,
  trimCountsOlderThan
} from '../src/product/server/habitMath';

describe('time zone validation and normalization', () => {
  it('validates standard IANA time zones', () => {
    expect(isValidTimeZone('Europe/Rome')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects invalid or malformed time zones', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(123)).toBe(false);
  });

  it('normalizes invalid zones to UTC', () => {
    expect(normalizeTimeZone('Europe/Rome')).toBe('Europe/Rome');
    expect(normalizeTimeZone('invalid-zone')).toBe('UTC');
    expect(normalizeTimeZone('')).toBe('UTC');
  });
});

describe('formatDayForTimeZone across time zones and DST days', () => {
  it('formats dates according to the target time zone', () => {
    // 2026-11-20 23:30:00 UTC
    const ts = Date.UTC(2026, 10, 20, 23, 30, 0);

    // In UTC, still Nov 20
    expect(formatDayForTimeZone(ts, 'UTC')).toBe('2026-11-20');
    // In Rome (UTC+1 in winter), it is Nov 21 00:30
    expect(formatDayForTimeZone(ts, 'Europe/Rome')).toBe('2026-11-21');
    // In New York (UTC-5 in winter), it is Nov 20 18:30
    expect(formatDayForTimeZone(ts, 'America/New_York')).toBe('2026-11-20');
    // In Tokyo (UTC+9), it is Nov 21 08:30
    expect(formatDayForTimeZone(ts, 'Asia/Tokyo')).toBe('2026-11-21');
  });

  it('handles European DST spring forward day correctly', () => {
    // European DST in 2026: Sunday March 29 clocks forward 02:00 -> 03:00 (23-hour day)
    const morningTs = Date.UTC(2026, 2, 29, 6, 0, 0);
    const eveningTs = Date.UTC(2026, 2, 29, 21, 0, 0);
    expect(formatDayForTimeZone(morningTs, 'Europe/Rome')).toBe('2026-03-29');
    expect(formatDayForTimeZone(eveningTs, 'Europe/Rome')).toBe('2026-03-29');

    // Shift day handles the calendar transitions smoothly
    expect(shiftDay('2026-03-28', 1)).toBe('2026-03-29');
    expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('handles European DST fall back day correctly', () => {
    // European DST fall back in 2026: Sunday October 25 clocks back 03:00 -> 02:00 (25-hour day)
    const morningTs = Date.UTC(2026, 9, 25, 4, 0, 0);
    const eveningTs = Date.UTC(2026, 9, 25, 22, 0, 0);
    expect(formatDayForTimeZone(morningTs, 'Europe/Rome')).toBe('2026-10-25');
    expect(formatDayForTimeZone(eveningTs, 'Europe/Rome')).toBe('2026-10-25');

    expect(shiftDay('2026-10-24', 1)).toBe('2026-10-25');
    expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26');
  });
});

describe('computeStreaks', () => {
  const goal = 10;

  it('computes 0 streak when learner has never practiced', () => {
    const res = computeStreaks({
      perDayCounts: {},
      goal,
      todayStr: '2026-11-20'
    });
    expect(res.currentStreak).toBe(0);
    expect(res.longestStreak).toBe(0);
    expect(res.lastGoalMetDay).toBeNull();
  });

  it('preserves yesterday streak when today is not yet done', () => {
    const perDayCounts = {
      '2026-11-18': 12,
      '2026-11-19': 10,
      '2026-11-20': 3 // not reached yet today
    };
    const res = computeStreaks({
      perDayCounts,
      goal,
      todayStr: '2026-11-20'
    });

    expect(res.currentStreak).toBe(2);
    expect(res.longestStreak).toBe(2);
    expect(res.lastGoalMetDay).toBe('2026-11-19');
  });

  it('increments streak when today is completed', () => {
    const perDayCounts = {
      '2026-11-18': 10,
      '2026-11-19': 15,
      '2026-11-20': 10 // reached today!
    };
    const res = computeStreaks({
      perDayCounts,
      goal,
      todayStr: '2026-11-20'
    });

    expect(res.currentStreak).toBe(3);
    expect(res.longestStreak).toBe(3);
    expect(res.lastGoalMetDay).toBe('2026-11-20');
  });

  it('resets streak to 0 when yesterday was missed and today is not yet done', () => {
    const perDayCounts = {
      '2026-11-17': 15,
      '2026-11-18': 12,
      '2026-11-19': 0, // missed yesterday
      '2026-11-20': 4  // not yet done today
    };
    const res = computeStreaks({
      perDayCounts,
      goal,
      todayStr: '2026-11-20'
    });

    expect(res.currentStreak).toBe(0);
    expect(res.longestStreak).toBe(2);
    expect(res.lastGoalMetDay).toBe('2026-11-18');
  });

  it('starts a new streak of 1 when yesterday was missed but today is done', () => {
    const perDayCounts = {
      '2026-11-17': 15,
      '2026-11-18': 12,
      '2026-11-19': 2,  // missed
      '2026-11-20': 10  // completed today!
    };
    const res = computeStreaks({
      perDayCounts,
      goal,
      todayStr: '2026-11-20'
    });

    expect(res.currentStreak).toBe(1);
    expect(res.longestStreak).toBe(2);
    expect(res.lastGoalMetDay).toBe('2026-11-20');
  });

  it('re-evaluates streak when goal changes mid-day', () => {
    // Learner did 6 turns today. Yesterday was 10 turns.
    const perDayCounts = {
      '2026-11-19': 10,
      '2026-11-20': 6
    };

    // Under regular goal (10): today is not met, streak is 1 (yesterday)
    const resBefore = computeStreaks({
      perDayCounts,
      goal: 10,
      todayStr: '2026-11-20'
    });
    expect(resBefore.currentStreak).toBe(1);
    expect(resBefore.lastGoalMetDay).toBe('2026-11-19');

    // Learner switches to relaxed goal (5): today (6 turns) is now met! Streak becomes 2.
    const resAfterLower = computeStreaks({
      perDayCounts,
      goal: 5,
      todayStr: '2026-11-20'
    });
    expect(resAfterLower.currentStreak).toBe(2);
    expect(resAfterLower.lastGoalMetDay).toBe('2026-11-20');

    // Learner switches to serious goal (20): neither today (6) nor yesterday (10) met 20!
    const resAfterHigher = computeStreaks({
      perDayCounts,
      goal: 20,
      todayStr: '2026-11-20'
    });
    expect(resAfterHigher.currentStreak).toBe(0);
  });

  it('retains previousLongestStreak if current data is lower', () => {
    const res = computeStreaks({
      perDayCounts: { '2026-11-20': 10 },
      goal: 10,
      todayStr: '2026-11-20',
      previousLongestStreak: 14
    });
    expect(res.currentStreak).toBe(1);
    expect(res.longestStreak).toBe(14);
  });
});

describe('generateLast7Days and generateWeekMonToSun', () => {
  it('generates 7 days ending today with correct met flags', () => {
    const perDayCounts = {
      '2026-11-18': 10,
      '2026-11-19': 4,
      '2026-11-20': 12
    };
    const days = generateLast7Days(perDayCounts, 10, '2026-11-20');
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe('2026-11-20');
    expect(days[6].isToday).toBe(true);
    expect(days[6].met).toBe(true);
    expect(days[5].date).toBe('2026-11-19');
    expect(days[5].met).toBe(false);
    expect(days[4].date).toBe('2026-11-18');
    expect(days[4].met).toBe(true);
  });

  it('generates the Monday to Sunday week for dots display', () => {
    // 2026-11-20 is a Friday
    const week = generateWeekMonToSun({ '2026-11-20': 10 }, 10, '2026-11-20');
    expect(week).toHaveLength(7);
    expect(week[0].dayOfWeek).toBe('Mon');
    expect(week[0].date).toBe('2026-11-16');
    expect(week[4].dayOfWeek).toBe('Fri');
    expect(week[4].date).toBe('2026-11-20');
    expect(week[4].isToday).toBe(true);
    expect(week[4].met).toBe(true);
    expect(week[5].dayOfWeek).toBe('Sat');
    expect(week[5].isFuture).toBe(true);
    expect(week[6].dayOfWeek).toBe('Sun');
    expect(week[6].isFuture).toBe(true);
  });
});

describe('trimCountsOlderThan', () => {
  it('drops dates older than cutoff', () => {
    const counts = {
      '2026-09-01': 10,
      '2026-10-15': 8,
      '2026-11-20': 15
    };
    const trimmed = trimCountsOlderThan(counts, '2026-10-01');
    expect(trimmed).toEqual({
      '2026-10-15': 8,
      '2026-11-20': 15
    });
  });
});
