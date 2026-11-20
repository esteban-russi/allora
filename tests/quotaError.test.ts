import { describe, it, expect } from 'vitest';
import { readQuotaError, formatResetTime } from '../src/platform/client/quotaError';

describe('readQuotaError', () => {
  it('returns null for non-429 responses and preserves original body', async () => {
    const res = new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
    const quota = await readQuotaError(res);
    expect(quota).toBeNull();

    // Original response body should still be unconsumed
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns null for 429 responses that are not QUOTA_EXCEEDED (e.g. rate limit)', async () => {
    const res = new Response(
      JSON.stringify({ error: 'Too many requests', retryAfter: 60 }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    const quota = await readQuotaError(res);
    expect(quota).toBeNull();
  });

  it('returns null for malformed or non-JSON 429 responses', async () => {
    const res = new Response('Too Many Requests', {
      status: 429,
      headers: { 'Content-Type': 'text/plain' }
    });
    const quota = await readQuotaError(res);
    expect(quota).toBeNull();
  });

  it('parses valid 429 QUOTA_EXCEEDED response', async () => {
    const payload = {
      error: 'Daily limit reached',
      code: 'QUOTA_EXCEEDED',
      counter: 'chatMessages',
      limit: 15,
      tier: 'free',
      resetsAt: '2026-11-20T00:00:00.000Z'
    };
    const res = new Response(JSON.stringify(payload), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
    const quota = await readQuotaError(res);
    expect(quota).toEqual({
      counter: 'chatMessages',
      limit: 15,
      tier: 'free',
      resetsAt: '2026-11-20T00:00:00.000Z'
    });
  });

  it('parses valid 429 response for voiceSeconds and helperRequests', async () => {
    const resVoice = new Response(
      JSON.stringify({
        code: 'QUOTA_EXCEEDED',
        counter: 'voiceSeconds',
        limit: 300,
        tier: 'guest',
        resetsAt: '2026-11-20T00:00:00.000Z'
      }),
      { status: 429 }
    );
    expect(await readQuotaError(resVoice)).toEqual({
      counter: 'voiceSeconds',
      limit: 300,
      tier: 'guest',
      resetsAt: '2026-11-20T00:00:00.000Z'
    });

    const resHelper = new Response(
      JSON.stringify({
        code: 'QUOTA_EXCEEDED',
        counter: 'helperRequests',
        limit: 100,
        tier: 'premium',
        resetsAt: '2026-11-20T00:00:00.000Z'
      }),
      { status: 429 }
    );
    expect(await readQuotaError(resHelper)).toEqual({
      counter: 'helperRequests',
      limit: 100,
      tier: 'premium',
      resetsAt: '2026-11-20T00:00:00.000Z'
    });
  });
});

describe('formatResetTime', () => {
  it('formats ISO time to HH:MM format', () => {
    const iso = '2026-11-20T14:05:00.000Z';
    const formatted = formatResetTime(iso, 'en-GB');
    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns empty string for invalid date', () => {
    expect(formatResetTime('not-a-date')).toBe('');
  });
});
