import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getRemindersPlatform,
  setRemindersPlatform,
  webReminders,
  type RemindersPlatform
} from '../src/platform/client/reminders';

describe('reminders platform seam', () => {
  beforeEach(() => {
    setRemindersPlatform(webReminders);
  });

  it('defaults to webReminders which reports unsupported', async () => {
    const platform = getRemindersPlatform();
    expect(platform.isSupported()).toBe(false);
    expect(await platform.requestPermission()).toBe(false);
    await expect(platform.schedule('19:00')).resolves.toBeUndefined();
    await expect(platform.cancel()).resolves.toBeUndefined();
  });

  it('allows injecting a custom native platform implementation', async () => {
    const mockPlatform: RemindersPlatform = {
      isSupported: vi.fn().mockReturnValue(true),
      requestPermission: vi.fn().mockResolvedValue(true),
      schedule: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined)
    };

    setRemindersPlatform(mockPlatform);
    const active = getRemindersPlatform();

    expect(active.isSupported()).toBe(true);
    expect(await active.requestPermission()).toBe(true);
    await active.schedule('20:00');
    expect(mockPlatform.schedule).toHaveBeenCalledWith('20:00');
    await active.cancel();
    expect(mockPlatform.cancel).toHaveBeenCalled();
  });
});
