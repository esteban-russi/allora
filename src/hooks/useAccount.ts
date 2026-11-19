/** React hook managing current authenticated learner account state. */
import { useCallback, useEffect, useState } from 'react';
import { fetchMe, type Me } from '../utils/me';
import { postJson } from '../utils/apiClient';
import type { Tier } from '../server/accountStore';

export interface UseAccountResult {
  me: Me | null;
  refresh: () => Promise<Me | null>;
  setUsage: (counter: 'chatMessages' | 'voiceSeconds' | 'helperRequests', used: number) => void;
}

/**
 * Hook providing the current learner's account details and refresh trigger.
 *
 * Fetches once on mount. If a subscription is within 1 hour of expiration (or already expired),
 * triggers a background sync to RevenueCat to repair any missed webhooks.
 *
 * Args:
 *   initialMe: Optional initial state.
 *
 * Returns:
 *   Current Me state, refresh function, and optimistic usage updater.
 */
export function useAccount(initialMe: Me | null = null): UseAccountResult {
  const [me, setMe] = useState<Me | null>(initialMe);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const fresh = await fetchMe();
    setMe(fresh);
    return fresh;
  }, []);

  const setUsage = useCallback(
    (counter: 'chatMessages' | 'voiceSeconds' | 'helperRequests', used: number) => {
      setMe((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          usage: {
            ...prev.usage,
            [counter]: used
          }
        };
      });
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    (async () => {
      const fresh = await refresh();
      if (!mounted || !fresh) return;

      if (
        fresh.subscription &&
        Date.parse(fresh.subscription.expiresAt) < Date.now() + 3600_000
      ) {
        try {
          const res = await postJson('/api/billing/sync', {});
          if (res.ok && mounted) {
            const data = (await res.json()) as { tier?: Tier; subscription?: Me['subscription'] };
            setMe((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                tier: data.tier ?? prev.tier,
                subscription: data.subscription !== undefined ? data.subscription : prev.subscription
              };
            });
          }
        } catch (err) {
          console.warn('[Billing] Failed to sync expiring subscription on start:', err);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [refresh]);

  return { me, refresh, setUsage };
}
