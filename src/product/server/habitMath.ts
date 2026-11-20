/** Pure functions for calendar day formatting, time zone validation, and streak computation. */

const EN_CA = 'en-CA';
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Validate an IANA time zone identifier.
 *
 * Args:
 *   timeZone: Untrusted string.
 *
 * Returns:
 *   True if supported by Intl.DateTimeFormat.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fall back to UTC if the requested time zone is invalid or empty.
 *
 * Args:
 *   timeZone: Optional or untrusted time zone string.
 *
 * Returns:
 *   A valid IANA time zone identifier.
 */
export function normalizeTimeZone(timeZone: unknown): string {
  return isValidTimeZone(timeZone) ? timeZone.trim() : 'UTC';
}

/**
 * Format a timestamp into YYYY-MM-DD in the given time zone.
 *
 * Args:
 *   timestampMs: Epoch milliseconds.
 *   timeZone: Valid IANA time zone identifier or fallback.
 *
 * Returns:
 *   Date string in YYYY-MM-DD format.
 */
export function formatDayForTimeZone(timestampMs: number, timeZone: string): string {
  const validTz = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat(EN_CA, {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date(timestampMs));
}

/**
 * Add or subtract calendar days to a YYYY-MM-DD date.
 *
 * Args:
 *   dayStr: Date string in YYYY-MM-DD.
 *   deltaDays: Number of days to add (or negative to subtract).
 *
 * Returns:
 *   New date string in YYYY-MM-DD.
 */
export function shiftDay(dayStr: string, deltaDays: number): string {
  const [y, m, d] = dayStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

/**
 * Short weekday name (e.g. 'Mon', 'Tue') for a YYYY-MM-DD date.
 */
export function getDayOfWeek(dayStr: string): string {
  const [y, m, d] = dayStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return WEEKDAY_NAMES[date.getUTCDay()];
}

export interface StreakParams {
  perDayCounts: Record<string, number>;
  goal: number;
  todayStr: string;
  previousLongestStreak?: number;
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  lastGoalMetDay: string | null;
}

/**
 * Compute the learner's current and longest streak from daily turn counts.
 *
 * Streak rules:
 * - A day is met when its turn count >= goal.
 * - Current streak is the number of consecutive met days ending today or yesterday.
 * - Today not being met yet does NOT break an existing streak ending yesterday.
 * - If neither today nor yesterday is met, current streak is 0.
 *
 * Args:
 *   params: Turn counts, goal threshold, today's date string, and prior longest streak.
 *
 * Returns:
 *   Current streak, longest streak, and the most recent day the goal was met.
 */
export function computeStreaks(params: StreakParams): StreakResult {
  const { perDayCounts, goal, todayStr, previousLongestStreak = 0 } = params;
  const todayCount = perDayCounts[todayStr] ?? 0;
  const isTodayMet = todayCount >= goal;

  const yesterdayStr = shiftDay(todayStr, -1);
  const isYesterdayMet = (perDayCounts[yesterdayStr] ?? 0) >= goal;

  let currentStreak = 0;
  let lastGoalMetDay: string | null = null;

  if (isTodayMet) {
    lastGoalMetDay = todayStr;
    currentStreak = 1;
    let cursor = shiftDay(todayStr, -1);
    while ((perDayCounts[cursor] ?? 0) >= goal) {
      currentStreak++;
      cursor = shiftDay(cursor, -1);
    }
  } else if (isYesterdayMet) {
    lastGoalMetDay = yesterdayStr;
    currentStreak = 1;
    let cursor = shiftDay(yesterdayStr, -1);
    while ((perDayCounts[cursor] ?? 0) >= goal) {
      currentStreak++;
      cursor = shiftDay(cursor, -1);
    }
  } else {
    currentStreak = 0;
    // Find last goal-met day if any by scanning back up to 60 days
    let cursor = shiftDay(todayStr, -1);
    for (let i = 0; i < 60; i++) {
      if ((perDayCounts[cursor] ?? 0) >= goal) {
        lastGoalMetDay = cursor;
        break;
      }
      cursor = shiftDay(cursor, -1);
    }
  }

  // Compute longest streak across all recorded days in perDayCounts
  let historicalMax = 0;
  const sortedDays = Object.keys(perDayCounts).sort();
  let run = 0;
  let prevDay: string | null = null;

  for (const day of sortedDays) {
    if (day > todayStr) continue;
    const count = perDayCounts[day] ?? 0;
    if (count >= goal) {
      if (prevDay && shiftDay(prevDay, 1) === day) {
        run++;
      } else {
        run = 1;
      }
      prevDay = day;
      if (run > historicalMax) historicalMax = run;
    } else {
      run = 0;
      prevDay = null;
    }
  }

  const longestStreak = Math.max(previousLongestStreak, historicalMax, currentStreak);

  return {
    currentStreak,
    longestStreak,
    lastGoalMetDay
  };
}

export interface DayHabitSummary {
  date: string;
  dayOfWeek: string;
  turns: number;
  met: boolean;
  isToday: boolean;
  isFuture?: boolean;
}

/**
 * Generate 7 days ending today (or calendar week) with met/not-met status.
 *
 * Args:
 *   perDayCounts: Record of day string to turn count.
 *   goal: Turn threshold for goal.
 *   todayStr: Today's date string.
 *
 * Returns:
 *   List of 7 DayHabitSummary objects ending today.
 */
export function generateLast7Days(
  perDayCounts: Record<string, number>,
  goal: number,
  todayStr: string
): DayHabitSummary[] {
  const days: DayHabitSummary[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDay(todayStr, -i);
    const turns = perDayCounts[date] ?? 0;
    days.push({
      date,
      dayOfWeek: getDayOfWeek(date),
      turns,
      met: turns >= goal,
      isToday: date === todayStr
    });
  }
  return days;
}

/**
 * Generate the current Monday-to-Sunday calendar week for the 7-day row of dots.
 *
 * Args:
 *   perDayCounts: Turn counts.
 *   goal: Turn threshold.
 *   todayStr: Today's date string.
 *
 * Returns:
 *   7 days from Monday to Sunday of the current week.
 */
export function generateWeekMonToSun(
  perDayCounts: Record<string, number>,
  goal: number,
  todayStr: string
): DayHabitSummary[] {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayStr = shiftDay(todayStr, mondayOffset);

  const week: DayHabitSummary[] = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftDay(mondayStr, i);
    const turns = perDayCounts[date] ?? 0;
    const isFuture = date > todayStr;
    week.push({
      date,
      dayOfWeek: getDayOfWeek(date),
      turns,
      met: turns >= goal,
      isToday: date === todayStr,
      isFuture
    });
  }
  return week;
}

/**
 * Trim counts older than cutoff date (e.g. 60 days).
 *
 * Args:
 *   perDayCounts: Map of day strings to counts.
 *   cutoffDayStr: Oldest day to keep.
 *
 * Returns:
 *   Cleaned copy without older days.
 */
export function trimCountsOlderThan(
  perDayCounts: Record<string, number>,
  cutoffDayStr: string
): Record<string, number> {
  const trimmed: Record<string, number> = {};
  for (const [day, count] of Object.entries(perDayCounts)) {
    if (day >= cutoffDayStr) {
      trimmed[day] = count;
    }
  }
  return trimmed;
}
