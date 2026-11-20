/** HTTP routes for habit tracking and reminder preferences. */
import { Router } from 'express';
import { defaultHabitStore } from './defaultHabitStore';
import { normalizeTimeZone } from './habitMath';
import { VALID_HABIT_GOALS, type HabitGoal, type HabitStore } from './habitStore';
import { summarizeError } from '../../platform/server/vertexCooldown';

const TIME_FORMAT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface HabitRouterDeps {
  habits?: HabitStore;
}

/**
 * Create the Express router mounted at /api/habits.
 *
 * Routes:
 * - GET /: Returns habit summary (today turn count, goal, streaks, last 7 days).
 * - PUT /settings: Updates habit goal, time zone, and reminder preferences.
 *
 * Args:
 *   deps: Injectable HabitStore dependency for testing.
 *
 * Returns:
 *   Configured Express Router.
 */
export function createHabitRouter(deps: HabitRouterDeps = {}): Router {
  const router = Router();
  const habits = deps.habits ?? defaultHabitStore;

  router.get('/', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const summary = await habits.getSummary(userId, Date.now());
      res.json(summary);
    } catch (err) {
      console.error('[Habits] Error fetching habit summary:', summarizeError(err));
      res.status(500).json({ error: 'Error fetching habits' });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { goal, timeZone, reminder } = req.body ?? {};

      if (goal !== undefined && (!Number.isInteger(goal) || !VALID_HABIT_GOALS.includes(goal as HabitGoal))) {
        return res.status(400).json({
          error: `goal must be one of ${VALID_HABIT_GOALS.join(', ')}`
        });
      }

      if (reminder !== undefined) {
        if (!reminder || typeof reminder !== 'object') {
          return res.status(400).json({ error: 'reminder must be an object' });
        }
        if (reminder.enabled !== undefined && typeof reminder.enabled !== 'boolean') {
          return res.status(400).json({ error: 'reminder.enabled must be a boolean' });
        }
        if (
          reminder.time !== undefined &&
          (typeof reminder.time !== 'string' || !TIME_FORMAT_PATTERN.test(reminder.time))
        ) {
          return res.status(400).json({ error: 'reminder.time must be in 24h format HH:mm (e.g. "19:00")' });
        }
      }

      const normalizedTz = timeZone !== undefined ? normalizeTimeZone(timeZone) : undefined;

      await habits.updateSettings(
        userId,
        {
          ...(goal !== undefined && { goal: goal as HabitGoal }),
          ...(normalizedTz !== undefined && { timeZone: normalizedTz }),
          ...(reminder !== undefined && { reminder })
        },
        Date.now()
      );

      const updatedSummary = await habits.getSummary(userId, Date.now());
      res.json(updatedSummary);
    } catch (err) {
      console.error('[Habits] Error updating habit settings:', summarizeError(err));
      res.status(500).json({ error: 'Error updating habit settings' });
    }
  });

  return router;
}
