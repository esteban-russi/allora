import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getHaptics,
  setHaptics,
  triggerLightHaptic,
  webHaptics,
  type HapticsPlatform
} from '../src/platform/client/haptics';

describe('haptics platform seam', () => {
  beforeEach(() => {
    setHaptics(webHaptics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls navigator.vibrate(15) when supported on web', () => {
    const vibrateSpy = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });

    triggerLightHaptic();
    expect(vibrateSpy).toHaveBeenCalledWith(15);

    vi.unstubAllGlobals();
  });

  it('safely handles missing navigator or missing vibrate without throwing', () => {
    vi.stubGlobal('navigator', {});
    expect(() => triggerLightHaptic()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('safely catches when navigator.vibrate throws', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('NotAllowedError');
      }
    });
    expect(() => triggerLightHaptic()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('supports injecting custom haptics platform', () => {
    const customHaptics: HapticsPlatform = {
      triggerLight: vi.fn()
    };

    setHaptics(customHaptics);
    expect(getHaptics()).toBe(customHaptics);

    triggerLightHaptic();
    expect(customHaptics.triggerLight).toHaveBeenCalled();
  });
});
