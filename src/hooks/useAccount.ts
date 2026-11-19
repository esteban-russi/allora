/** React hook managing current authenticated learner account state. */
import { useCallback, useEffect, useState } from 'react';
import { fetchMe, type Me } from '../utils/me';

export interface UseAccountResult {
  me: Me | null;
  refresh: () => Promise<Me | null>;
}

/**
 * Hook providing the current learner's account details and refresh trigger.
 *
 * Fetches once on mount.
 *
 * Args:
 *   initialMe: Optional initial state.
 *
 * Returns:
 *   Current Me state and refresh function.
 */
export function useAccount(initialMe: Me | null = null): UseAccountResult {
  const [me, setMe] = useState<Me | null>(initialMe);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const fresh = await fetchMe();
    setMe(fresh);
    return fresh;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { me, refresh };
}
