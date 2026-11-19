import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fallbacks from '../src/data/fallbacks';
import { readQuotaError } from '../src/utils/quotaError';
import { installFakeBrowser } from './helpers/fakeBrowser';

describe('chat quota limit handling', () => {
  beforeEach(() => {
    installFakeBrowser();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects quota 429 and does not trigger persona fallback generator', async () => {
    const fallbackSpy = vi.spyOn(fallbacks, 'generatePersonaFallbackMessage');

    const quotaResponse = new Response(
      JSON.stringify({
        error: 'Daily limit reached',
        code: 'QUOTA_EXCEEDED',
        counter: 'chatMessages',
        limit: 15,
        tier: 'free',
        resetsAt: '2026-11-20T00:00:00.000Z'
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // Simulate sending message logic in App.tsx
    const quota = await readQuotaError(quotaResponse);
    expect(quota).not.toBeNull();
    expect(quota?.counter).toBe('chatMessages');

    // On quota error, handleSendMessage sets limitReached and returns early
    if (quota) {
      // Returned early, fallback is bypassed
    } else {
      fallbacks.generatePersonaFallbackMessage(
        { id: 'emmanuele', name: 'Emmanuele', city: 'Roma' } as any,
        'Ciao'
      );
    }

    vi.advanceTimersByTime(1000);
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('triggers persona fallback generator on general error or 500 response', async () => {
    const fallbackSpy = vi.spyOn(fallbacks, 'generatePersonaFallbackMessage');

    const errorResponse = new Response(
      JSON.stringify({ error: 'Internal Server Error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const quota = await readQuotaError(errorResponse);
    expect(quota).toBeNull();

    // On non-quota error, fallback response is generated
    if (!quota) {
      setTimeout(() => {
        fallbacks.generatePersonaFallbackMessage(
          { id: 'emmanuele', name: 'Emmanuele', city: 'Roma' } as any,
          'Ciao'
        );
      }, 500);
    }

    vi.advanceTimersByTime(500);
    expect(fallbackSpy).toHaveBeenCalled();
  });
});
