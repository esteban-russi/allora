/** React hook that installs RevenueCat web billing once the client config is loaded. */
import { useEffect, useRef } from 'react';
import { setBilling } from '../client/billing';
import { createWebBilling } from '../client/billingWeb';
import { loadClientConfig } from '../client/clientConfig';

/**
 * Install web billing on mount when the server provides a RevenueCat web key.
 *
 * Without a key the default (unavailable) billing stays in place.
 *
 * Args:
 *   email: The signed-in user's email, read at purchase time so it is always current.
 */
export function useWebBilling(email: string | null): void {
  const emailRef = useRef<string | null>(email);
  emailRef.current = email;

  useEffect(() => {
    (async () => {
      const { revenueCatWebKey } = await loadClientConfig();
      if (revenueCatWebKey) {
        setBilling(createWebBilling(revenueCatWebKey, { email: () => emailRef.current }));
      }
    })();
  }, []);
}
