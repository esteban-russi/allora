/** Tests for the client notice channel. */
import { describe, expect, it, vi } from 'vitest';
import { showNotice, subscribeToNotices } from '../src/utils/notice';

describe('notices', () => {
  it('delivers a notice to every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToNotices(first);
    const stopSecond = subscribeToNotices(second);

    showNotice('hello');

    expect(first).toHaveBeenCalledWith('hello');
    expect(second).toHaveBeenCalledWith('hello');
    stopFirst();
    stopSecond();
  });

  it('stops delivering after unsubscribing', () => {
    const listener = vi.fn();
    const stop = subscribeToNotices(listener);
    stop();

    showNotice('ignored');

    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing when nobody is listening', () => {
    expect(() => showNotice('nobody')).not.toThrow();
  });
});
