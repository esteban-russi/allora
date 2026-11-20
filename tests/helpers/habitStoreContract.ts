/** Contract test suite verifying that any HabitStore implementation conforms to the expected behavior. */
import { describe, expect, it } from 'vitest';
import type { HabitStore } from '../../src/product/server/habitStore';

export function describeHabitStoreContract(
  name: string,
  createStore: (options?: { now?: () => number }) => HabitStore
): void {
  describe(`${name} contract`, () => {
    it('returns default habits for a new user', async () => {
      const store = createStore();
      const habits = await store.getHabits('u-new');
      expect(habits.userId).toBe('u-new');
      expect(habits.goal).toBe(10);
      expect(habits.timeZone).toBe('UTC');
      expect(habits.currentStreak).toBe(0);
      expect(habits.longestStreak).toBe(0);
      expect(habits.lastGoalMetDay).toBeNull();
      expect(habits.reminder.enabled).toBe(false);
      expect(habits.reminder.time).toBe('19:00');
    });

    it('updates habit settings with validation and normalization', async () => {
      const store = createStore();
      const updated = await store.updateSettings('u-settings', {
        goal: 5,
        timeZone: 'Europe/Rome',
        reminder: { enabled: true, time: '20:30' }
      });

      expect(updated.goal).toBe(5);
      expect(updated.timeZone).toBe('Europe/Rome');
      expect(updated.reminder.enabled).toBe(true);
      expect(updated.reminder.time).toBe('20:30');

      // Invalid timeZone falls back to UTC
      const fallback = await store.updateSettings('u-settings', {
        timeZone: 'Invalid/Zone'
      });
      expect(fallback.timeZone).toBe('UTC');
    });

    it('records turns, tracks streaks, and fires justMetGoal once today', async () => {
      let clock = Date.UTC(2026, 10, 20, 10, 0, 0); // 2026-11-20
      const store = createStore({ now: () => clock });

      await store.updateSettings('u-turns', { goal: 5, timeZone: 'UTC' });

      // Turns 1 to 4: not yet met
      for (let i = 1; i <= 4; i++) {
        const res = await store.recordTurn('u-turns', clock);
        expect(res.justMetGoal).toBe(false);
        expect(res.habits.perDayCounts['2026-11-20']).toBe(i);
        expect(res.summary.todayCount).toBe(i);
        expect(res.summary.goalMetToday).toBe(false);
      }

      // 5th turn: reaches goal! justMetGoal must be true!
      const turn5 = await store.recordTurn('u-turns', clock);
      expect(turn5.justMetGoal).toBe(true);
      expect(turn5.habits.perDayCounts['2026-11-20']).toBe(5);
      expect(turn5.summary.goalMetToday).toBe(true);
      expect(turn5.habits.currentStreak).toBe(1);
      expect(turn5.habits.lastGoalMetDay).toBe('2026-11-20');

      // 6th turn: already met today, justMetGoal must be false!
      const turn6 = await store.recordTurn('u-turns', clock);
      expect(turn6.justMetGoal).toBe(false);
      expect(turn6.habits.perDayCounts['2026-11-20']).toBe(6);
      expect(turn6.habits.currentStreak).toBe(1);
    });

    it('merges guest habits into target account keeping higher streak and turn counts', async () => {
      let clock = Date.UTC(2026, 10, 20, 12, 0, 0);
      const store = createStore({ now: () => clock });

      // Guest practiced yesterday and today with goal 5
      await store.updateSettings('guest-habit', { goal: 5 });
      const yesterdayTs = Date.UTC(2026, 10, 19, 12, 0, 0);
      for (let i = 0; i < 5; i++) await store.recordTurn('guest-habit', yesterdayTs);
      for (let i = 0; i < 5; i++) await store.recordTurn('guest-habit', clock);

      const guestHabits = await store.getHabits('guest-habit');
      expect(guestHabits.currentStreak).toBe(2);

      // Target user has serious goal (20) and reminder 18:00
      await store.updateSettings('target-habit', {
        goal: 20,
        reminder: { enabled: true, time: '18:00' }
      });

      const merged = await store.mergeUserHabits('guest-habit', 'target-habit', clock);

      // Target settings win
      expect(merged.userId).toBe('target-habit');
      expect(merged.goal).toBe(20);
      expect(merged.reminder.time).toBe('18:00');
      expect(merged.reminder.enabled).toBe(true);

      // Turn counts merged
      expect(merged.perDayCounts['2026-11-19']).toBe(5);
      expect(merged.perDayCounts['2026-11-20']).toBe(5);

      // Higher streak kept
      expect(merged.longestStreak).toBe(2);

      // Guest deleted
      const guestAfter = await store.getHabits('guest-habit');
      expect(guestAfter.perDayCounts).toEqual({});
    });

    it('deletes all user habits on deleteAllUserHabits', async () => {
      const store = createStore();
      await store.recordTurn('u-del');
      await store.deleteAllUserHabits('u-del');

      const after = await store.getHabits('u-del');
      expect(after.perDayCounts).toEqual({});
      expect(after.currentStreak).toBe(0);
    });
  });
}
