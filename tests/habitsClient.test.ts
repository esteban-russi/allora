import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  fetchHabits,
  getDeviceTimeZone,
  subscribeHabits,
  updateHabitSettings,
  celebrateGoalMet
} from '../src/product/client/habitsClient';
import * as apiClient from '../src/platform/client/apiClient';
import * as haptics from '../src/platform/client/haptics';
import * as notice from '../src/platform/client/notice';
import type { HabitSummary } from '../src/product/server/habitStore';

describe('habitsClient', () => {
  const dummySummary: HabitSummary = {
    todayCount: 6,
    goal: 10,
    currentStreak: 4,
    longestStreak: 7,
    lastGoalMetDay: '2026-11-19',
    last7Days: [],
    weekDays: [],
    reminder: { enabled: false, time: '19:00' },
    timeZone: 'Europe/Rome',
    goalMetToday: false
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects device timeZone or falls back to UTC', () => {
    const tz = getDeviceTimeZone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('fetches habits via GET /api/habits and notifies subscribers', async () => {
    vi.spyOn(apiClient, 'getWithAuth').mockResolvedValue(
      new Response(JSON.stringify(dummySummary), { status: 200 })
    );

    const subscriber = vi.fn();
    const unsub = subscribeHabits(subscriber);

    const result = await fetchHabits();
    expect(result).toEqual(dummySummary);
    expect(subscriber).toHaveBeenCalledWith(dummySummary);

    unsub();
  });

  it('updates habit settings via PUT /api/habits/settings', async () => {
    const updated = { ...dummySummary, goal: 20 as const };
    const putSpy = vi.spyOn(apiClient, 'putJson').mockResolvedValue(
      new Response(JSON.stringify(updated), { status: 200 })
    );

    const result = await updateHabitSettings({ goal: 20 });
    expect(result?.goal).toBe(20);
    expect(putSpy).toHaveBeenCalledWith(
      '/api/habits/settings',
      expect.objectContaining({ goal: 20 })
    );
  });

  it('triggers haptic feedback and notice toast when goal is met', () => {
    const hapticSpy = vi.spyOn(haptics, 'triggerLightHaptic');
    const noticeSpy = vi.spyOn(notice, 'showNotice');

    celebrateGoalMet(5);
    expect(hapticSpy).toHaveBeenCalled();
    expect(noticeSpy).toHaveBeenCalledWith('Goal reached! 5-day streak 🔥');

    celebrateGoalMet(1);
    expect(noticeSpy).toHaveBeenCalledWith('Goal reached! 1-day streak 🔥');
  });
});
