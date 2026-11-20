/** Cloud Firestore implementation of HabitStore. */
import { Firestore, type CollectionReference, type DocumentData } from '@google-cloud/firestore';
import {
  computeStreaks,
  formatDayForTimeZone,
  normalizeTimeZone,
  shiftDay,
  trimCountsOlderThan
} from './habitMath';
import {
  buildHabitSummary,
  defaultHabitsForUser,
  VALID_HABIT_GOALS,
  type HabitSettings,
  type HabitStore,
  type HabitSummary,
  type LearnerHabits,
  type RecordTurnResult
} from './habitStore';

export const HABITS_COLLECTION = 'learnerHabits';

export interface FirestoreHabitStoreOptions {
  collectionName?: string;
  now?: () => number;
}

export class FirestoreHabitStore implements HabitStore {
  private collection: CollectionReference;
  private now: () => number;

  constructor(
    private db: Firestore,
    options: FirestoreHabitStoreOptions = {}
  ) {
    this.collection = db.collection(options.collectionName ?? HABITS_COLLECTION);
    this.now = options.now ?? Date.now;
  }

  private docToHabits(userId: string, data: DocumentData | undefined): LearnerHabits {
    if (!data) {
      return defaultHabitsForUser(userId, this.now());
    }
    return {
      userId,
      goal: data.goal ?? 10,
      timeZone: data.timeZone ?? 'UTC',
      perDayCounts: data.perDayCounts ? { ...data.perDayCounts } : {},
      currentStreak: data.currentStreak ?? 0,
      longestStreak: data.longestStreak ?? 0,
      lastGoalMetDay: data.lastGoalMetDay ?? null,
      reminder: {
        enabled: Boolean(data.reminder?.enabled),
        time: typeof data.reminder?.time === 'string' ? data.reminder.time : '19:00'
      },
      updatedAt: data.updatedAt ?? new Date(this.now()).toISOString()
    };
  }

  async getHabits(userId: string): Promise<LearnerHabits> {
    const snap = await this.collection.doc(userId).get();
    return this.docToHabits(userId, snap.data());
  }

  async getSummary(userId: string, nowMs: number = this.now()): Promise<HabitSummary> {
    const habits = await this.getHabits(userId);
    return buildHabitSummary(habits, nowMs);
  }

  async recordTurn(userId: string, timestampMs: number = this.now()): Promise<RecordTurnResult> {
    const ref = this.collection.doc(userId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const habits = this.docToHabits(userId, snap.data());

      const todayStr = formatDayForTimeZone(timestampMs, habits.timeZone);
      const countBefore = habits.perDayCounts[todayStr] ?? 0;
      const countAfter = countBefore + 1;
      habits.perDayCounts[todayStr] = countAfter;

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

      tx.set(ref, habits);

      const justMetGoal = countBefore < habits.goal && countAfter >= habits.goal;
      const summary = buildHabitSummary(habits, timestampMs, justMetGoal);

      return {
        habits,
        summary,
        justMetGoal
      };
    });
  }

  async updateSettings(
    userId: string,
    settings: HabitSettings,
    nowMs: number = this.now()
  ): Promise<LearnerHabits> {
    const ref = this.collection.doc(userId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const habits = this.docToHabits(userId, snap.data());

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

      tx.set(ref, habits);
      return habits;
    });
  }

  async mergeUserHabits(
    fromUserId: string,
    toUserId: string,
    nowMs: number = this.now()
  ): Promise<LearnerHabits> {
    const guestRef = this.collection.doc(fromUserId);
    const targetRef = this.collection.doc(toUserId);

    return this.db.runTransaction(async (tx) => {
      const [guestSnap, targetSnap] = await Promise.all([tx.get(guestRef), tx.get(targetRef)]);
      const guest = this.docToHabits(fromUserId, guestSnap.data());
      const target = this.docToHabits(toUserId, targetSnap.data());

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

      tx.set(targetRef, merged);
      tx.delete(guestRef);
      return merged;
    });
  }

  async deleteAllUserHabits(userId: string): Promise<void> {
    await this.collection.doc(userId).delete();
  }
}
