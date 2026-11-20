/**
 * Reminders platform seam.
 *
 * Provides notification scheduling abstraction for daily practice reminders.
 * Native shells (such as Capacitor Local Notifications on Android) can provide
 * an implementation of RemindersPlatform.
 */

export interface RemindersPlatform {
  /**
   * Check whether daily local notification reminders are supported in this runtime.
   */
  isSupported(): boolean;

  /**
   * Request notification permission from the system.
   * Only called when the user activates the reminder toggle.
   */
  requestPermission(): Promise<boolean>;

  /**
   * Schedule a daily recurring notification at the specified time ("HH:mm").
   *
   * Args:
   *   time: 24h format time string, e.g. "19:00".
   */
  schedule(time: string): Promise<void>;

  /**
   * Cancel any scheduled daily reminder notifications.
   */
  cancel(): Promise<void>;
}

/**
 * Web implementation of RemindersPlatform.
 *
 * Web browsers / PWAs do not provide reliable background daily local alarm
 * notifications when the app is closed. Reports `isSupported() === false`.
 *
 * NOTE: When the native Android shell (Capacitor) is added, plug in the
 * Capacitor Local Notifications implementation here:
 *
 * ```ts
 * import { LocalNotifications } from '@capacitor/local-notifications';
 * export const capacitorReminders: RemindersPlatform = {
 *   isSupported: () => true,
 *   requestPermission: async () => {
 *     const status = await LocalNotifications.requestPermissions();
 *     return status.display === 'granted';
 *   },
 *   schedule: async (time: string) => {
 *     const [hour, minute] = time.split(':').map(Number);
 *     await LocalNotifications.schedule({
 *       notifications: [{
 *         id: 1,
 *         title: 'Allora',
 *         body: 'Time for your daily Italian practice!',
 *         schedule: { on: { hour, minute }, allowWhileIdle: true }
 *       }]
 *     });
 *   },
 *   cancel: async () => {
 *     await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
 *   }
 * };
 * ```
 */
export const webReminders: RemindersPlatform = {
  isSupported(): boolean {
    return false;
  },
  async requestPermission(): Promise<boolean> {
    return false;
  },
  async schedule(_time: string): Promise<void> {
    // Unsupported on web
  },
  async cancel(): Promise<void> {
    // Unsupported on web
  }
};

let currentPlatform: RemindersPlatform = webReminders;

/**
 * Get the active reminders platform implementation.
 */
export function getRemindersPlatform(): RemindersPlatform {
  return currentPlatform;
}

/**
 * Set the active reminders platform implementation (e.g. for native shell injection or testing).
 */
export function setRemindersPlatform(platform: RemindersPlatform): void {
  currentPlatform = platform;
}
