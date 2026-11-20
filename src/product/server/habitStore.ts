/** Persistent habit tracking: daily turn goals, streaks, time zones, and reminders. */
import {
  computeStreaks,
  formatDayForTimeZone,
  generateLast7Days,
  generateWeekMonToSun,
  normalizeTimeZone,
  shiftDay,
  trimCountsOlderThan,
  type DayHabitSummary
} from './habitMath';

export type HabitGoal = 5 | 10 | 20;

export const DEFAULT_HABIT_GOAL: HabitGoal = 10;
export const VALID_HABIT_GOALS: readonly HabitGoal[] = [5, 10, 20];

export interface HabitReminder {
  enabled: boolean;
  time: string; // 24h format "HH:mm", e.g. "19:00"
}

export interface LearnerHabits {
  userId: string;
  goal: HabitGoal;
  timeZone: string;
  perDayCounts: Record<string, number>;
  currentStreak: number;
  longestStreak: number;
  lastGoalMetDay: string | null;
  reminder: HabitReminder;
  updatedAt: string;
}

export interface HabitSummary {
  todayCount: number;
  goal: HabitGoal;
  currentStreak: number;
  longestStreak: number;
  lastGoalMetDay: string | null;
  last7Days: DayHabitSummary[];
  weekDays: DayHabitSummary[];
  reminder: HabitReminder;
  timeZone: string;
  goalMetToday: boolean;
  justMetGoal?: boolean;
}

export interface HabitSettings {
  goal?: HabitGoal;
  timeZone?: string;
  reminder?: {
    enabled?: boolean;
    time?: string;
  };
}

export interface RecordTurnResult {
  habits: LearnerHabits;
  summary: HabitSummary;
  justMetGoal: boolean;
}

export interface HabitStore {
  getHabits(userId: string): Promise<LearnerHabits>;
  getSummary(userId: string, nowMs?: number): Promise<HabitSummary>;
  recordTurn(userId: string, timestampMs?: number): Promise<RecordTurnResult>;
  updateSettings(userId: string, settings: HabitSettings, nowMs?: number): Promise<LearnerHabits>;
  mergeUserHabits(fromUserId: string, toUserId: string, nowMs?: number): Promise<LearnerHabits>;
  deleteAllUserHabits(userId: string): Promise<void>;
}

export function defaultHabitsForUser(userId: string, nowMs: number = Date.now()): LearnerHabits {
  return {
    userId,
    goal: DEFAULT_HABIT_GOAL,
    timeZone: 'UTC',
    perDayCounts: {},
    currentStreak: 0,
    longestStreak: 0,
    lastGoalMetDay: null,
    reminder: {
      enabled: false,
      time: '19:00'
    },
    updatedAt: new Date(nowMs).toISOString()
  };
}

export function buildHabitSummary(
  habits: LearnerHabits,
  nowMs: number = Date.now(),
  justMetGoal?: boolean
): HabitSummary {
  const todayStr = formatDayForTimeZone(nowMs, habits.timeZone);
  const todayCount = habits.perDayCounts[todayStr] ?? 0;
  const streaks = computeStreaks({
    perDayCounts: habits.perDayCounts,
    goal: habits.goal,
    todayStr,
    previousLongestStreak: habits.longestStreak
  });

  return {
    todayCount,
    goal: habits.goal,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    lastGoalMetDay: streaks.lastGoalMetDay,
    last7Days: generateLast7Days(habits.perDayCounts, habits.goal, todayStr),
    weekDays: generateWeekMonToSun(habits.perDayCounts, habits.goal, todayStr),
    reminder: { ...habits.reminder },
    timeZone: habits.timeZone,
    goalMetToday: todayCount >= habits.goal,
    ...(justMetGoal !== undefined && { justMetGoal })
  };
}

/**
 * In-memory implementation of HabitStore for testing and local development.
 */
export class InMemoryHabitStore implements HabitStore {
  private records = new Map<string, LearnerHabits>();

  constructor(private now: () => number = Date.now) {}

  async getHabits(userId: string): Promise<LearnerHabits> {
    const existing = this.records.get(userId);
    if (existing) {
      return structuredClone(existing);
    }
    const created = defaultHabitsForUser(userId, this.now());
    this.records.set(userId, structuredClone(created));
    return structuredClone(created);
  }

  async getSummary(userId: string, nowMs: number = this.now()): Promise<HabitSummary> {
    const habits = await this.getHabits(userId);
    return buildHabitSummary(habits, nowMs);
  }

  async recordTurn(userId: string, timestampMs: number = this.now()): Promise<RecordTurnResult> {
    const habits = await this.getHabits(userId);
    const todayStr = formatDayForTimeZone(timestampMs, habits.timeZone);
    const countBefore = habits.perDayCounts[todayStr] ?? 0;
    const countAfter = countBefore + 1;
    habits.perDayCounts[todayStr] = countAfter;

    // Trim older than 60 days
    const cutoffDay = shiftDay(todayStr, -60);
    habits.perDayCounts = trimCountsOlderThan(habits.perDayCounts, cutoffDay);

    const streaks = computeStreaks({
      perDayCounts: habits.perDayCounts,
      goal: habits.goal,
      todayStr,
      previousLongestStreak: habits.longestStreak
    });

    habits.currentStreak = streaks.currentStreak;
    habits.longestStreak = streaks.longestStreak;
    habits.lastGoalMetDay = streaks.lastGoalMetDay;
    habits.updatedAt = new Date(timestampMs).toISOString();

    this.records.set(userId, structuredClone(habits));

    const justMetGoal = countBefore < habits.goal && countAfter >= habits.goal;
    const summary = buildHabitSummary(habits, timestampMs, justMetGoal);

    return {
      habits: structuredClone(habits),
      summary,
      justMetGoal
    };
  }

  async updateSettings(
    userId: string,
    settings: HabitSettings,
    nowMs: number = this.now()
  ): Promise<LearnerHabits> {
    const habits = await this.getHabits(userId);

    if (settings.goal && VALID_HABIT_GOALS.includes(settings.goal)) {
      habits.goal = settings.goal;
    }

    if (settings.timeZone !== undefined) {
      habits.timeZone = normalizeTimeZone(settings.timeZone);
    }

    if (settings.reminder) {
      if (typeof settings.reminder.enabled === 'boolean') {
        habits.reminder.enabled = settings.reminder.enabled;
      }
      if (typeof settings.reminder.time === 'string' && settings.reminder.time.trim()) {
        habits.reminder.time = settings.reminder.time.trim();
      }
    }

    const todayStr = formatDayForTimeZone(nowMs, habits.timeZone);
    const streaks = computeStreaks({
      perDayCounts: habits.perDayCounts,
      goal: habits.goal,
      todayStr,
      previousLongestStreak: habits.longestStreak
    });

    habits.currentStreak = streaks.currentStreak;
    habits.longestStreak = streaks.longestStreak;
    habits.lastGoalMetDay = streaks.lastGoalMetDay;
    habits.updatedAt = new Date(nowMs).toISOString();

    this.records.set(userId, structuredClone(habits));
    return structuredClone(habits);
  }

  async mergeUserHabits(
    fromUserId: string,
    toUserId: string,
    nowMs: number = this.now()
  ): Promise<LearnerHabits> {
    const guest = await this.getHabits(fromUserId);
    const target = await this.getHabits(toUserId);

    // Merge counts per day
    const mergedCounts = { ...guest.perDayCounts };
    for (const [day, count] of Object.entries(target.perDayCounts)) {
      mergedCounts[day] = Math.max(mergedCounts[day] ?? 0, count);
    }

    const todayStr = formatDayForTimeZone(nowMs, target.timeZone);
    const streaks = computeStreaks({
      perDayCounts: mergedCounts,
      goal: target.goal,
      todayStr,
      previousLongestStreak: Math.max(target.longestStreak, guest.longestStreak)
    });

    // Signed-in account's settings win; streaks and counts keep highest
    const merged: LearnerHabits = {
      userId: toUserId,
      goal: target.goal,
      timeZone: target.timeZone !== 'UTC' ? target.timeZone : guest.timeZone,
      perDayCounts: mergedCounts,
      currentStreak: Math.max(target.currentStreak, guest.currentStreak, streaks.currentStreak),
      longestStreak: Math.max(target.longestStreak, guest.longestStreak, streaks.longestStreak),
      lastGoalMetDay: streaks.lastGoalMetDay,
      reminder: { ...target.reminder },
      updatedAt: new Date(nowMs).toISOString()
    };

    this.records.set(toUserId, structuredClone(merged));
    this.records.delete(fromUserId);
    return structuredClone(merged);
  }

  async deleteAllUserHabits(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}
