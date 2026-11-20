/**
 * Light haptic feedback platform seam.
 *
 * Triggers subtle vibration for celebratory events (e.g. reaching daily goal).
 * On web, guards `navigator.vibrate`. On native shells, plugs into native haptics.
 */

export interface HapticsPlatform {
  /**
   * Trigger a light celebratory haptic tap.
   */
  triggerLight(): void;
}

export const webHaptics: HapticsPlatform = {
  triggerLight(): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(15);
      } catch {
        // Ignore environments where vibrate throws or is disallowed
      }
    }
  }
};

let currentHaptics: HapticsPlatform = webHaptics;

export function getHaptics(): HapticsPlatform {
  return currentHaptics;
}

export function setHaptics(platform: HapticsPlatform): void {
  currentHaptics = platform;
}

export function triggerLightHaptic(): void {
  currentHaptics.triggerLight();
}
