/** Tests for useAccount hook. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as meModule from '../src/platform/client/me';
import * as apiModule from '../src/platform/client/apiClient';
import { useAccount } from '../src/platform/hooks/useAccount';
import type { Me } from '../src/platform/client/me';

// Simple harness component to test useAccount hook output
function AccountHarness({ onRender }: { onRender: (result: ReturnType<typeof useAccount>) => void }) {
  const result = useAccount();
  onRender(result);
  return React.createElement('div', null, result.me?.tier ?? 'none');
}

describe('useAccount', () => {
  const nowMs = Date.parse('2026-11-19T12:00:00.000Z');

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with initial fetch state', async () => {
    const fakeMe: Me = {
      userId: 'u1',
      email: 'u1@example.com',
      isAnonymous: false,
      tier: 'free',
      limits: { chatMessages: 15, voiceSeconds: 300, helperRequests: 100 },
      usage: { chatMessages: 2, voiceSeconds: 30, helperRequests: 5 },
      resetsAt: '2026-11-20T00:00:00.000Z',
      consent: null,
      subscription: null
    };

    vi.spyOn(meModule, 'fetchMe').mockResolvedValue(fakeMe);
    const postJsonSpy = vi.spyOn(apiModule, 'postJson').mockResolvedValue({
      ok: true,
      json: async () => ({})
    } as any);

    let latestResult: any = null;
    renderToStaticMarkup(React.createElement(AccountHarness, {
      onRender: (res) => { latestResult = res; }
    }));

    expect(latestResult).not.toBeNull();
    // In SSR / static markup useEffect does not run, so we can test refresh() directly:
    const refreshed = await latestResult.refresh();
    expect(refreshed).toEqual(fakeMe);
    expect(postJsonSpy).not.toHaveBeenCalled();
  });
});
