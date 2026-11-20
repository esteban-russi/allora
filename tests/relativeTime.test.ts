import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../src/product/components/ConversationListScreen';

describe('formatRelativeTime', () => {
  const baseMs = Date.parse('2026-11-20T12:00:00.000Z');

  it('formats under 1 minute as Just now', () => {
    expect(formatRelativeTime('2026-11-20T11:59:45.000Z', baseMs)).toBe('Just now');
  });

  it('formats minutes', () => {
    expect(formatRelativeTime('2026-11-20T11:45:00.000Z', baseMs)).toBe('15m');
  });

  it('formats hours', () => {
    expect(formatRelativeTime('2026-11-20T09:00:00.000Z', baseMs)).toBe('3h');
  });

  it('formats 1 day ago as Yesterday', () => {
    expect(formatRelativeTime('2026-11-19T10:00:00.000Z', baseMs)).toBe('Yesterday');
  });

  it('formats 2-6 days ago with day suffix', () => {
    expect(formatRelativeTime('2026-11-16T12:00:00.000Z', baseMs)).toBe('4d');
  });

  it('returns empty string for invalid dates', () => {
    expect(formatRelativeTime('not-a-date', baseMs)).toBe('');
  });
});
