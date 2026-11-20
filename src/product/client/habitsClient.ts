/** Client API and reactive event bus for learner habits and streak tracking. */
import { getWithAuth, putJson } from '../../platform/client/apiClient';
import { triggerLightHaptic } from '../../platform/client/haptics';
import { showNotice } from '../../platform/client/notice';
import type { HabitSettings, HabitSummary } from '../server/habitStore';

type HabitsListener = (habits: HabitSummary) => void;

const listeners = new Set<HabitsListener>();
let cachedHabits: HabitSummary | null = null;

/**
 * Get device IANA time zone, falling back to UTC.
 */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Fetch the learner's habit summary from GET /api/habits.
 *
 * Returns:
 *   HabitSummary if successful, null otherwise.
 */
export async function fetchHabits(): Promise<HabitSummary | null> {
  try {
    const res = await getWithAuth('/api/habits');
    if (!res.ok) return null;
    const data: HabitSummary = await res.json();
    cachedHabits = data;
    notifyHabits(data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Update the learner's habit settings via PUT /api/habits/settings.
 *
 * Args:
 *   settings: Goal, timeZone, or reminder settings.
 *
 * Returns:
 *   Updated HabitSummary if successful, null otherwise.
 */
export async function updateHabitSettings(settings: HabitSettings): Promise<HabitSummary | null> {
  try {
    const payload = {
      ...settings,
      timeZone: settings.timeZone ?? getDeviceTimeZone()
    };
    const res = await putJson('/api/habits/settings', payload);
    if (!res.ok) return null;
    const data: HabitSummary = await res.json();
    cachedHabits = data;
    notifyHabits(data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Notify all subscribers of updated habits.
 *
 * Args:
 *   habits: The latest HabitSummary.
 */
export function notifyHabits(habits: HabitSummary): void {
  cachedHabits = habits;
  for (const listener of listeners) {
    try {
      listener(habits);
    } catch (err) {
      console.warn('[Habits] Listener error:', err);
    }
  }
}

/**
 * Subscribe to habit updates across the client.
 *
 * Args:
 *   listener: Called with updated HabitSummary.
 *
 * Returns:
 *   Unsubscribe cleanup function.
 */
export function subscribeHabits(listener: HabitsListener): () => void {
  listeners.add(listener);
  if (cachedHabits) {
    listener(cachedHabits);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Trigger celebration for reaching the daily practice goal.
 *
 * Shows encouraging notice toast and fires light haptic feedback.
 *
 * Args:
 *   streak: Current streak length in days.
 */
export function celebrateGoalMet(streak: number): void {
  triggerLightHaptic();
  const streakText = streak > 1 ? `${streak}-day streak 🔥` : '1-day streak 🔥';
  showNotice(`Goal reached! ${streakText}`);
}
