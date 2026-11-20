/** React hook providing platform-neutral back button and navigation history seam. */
import { useEffect, useRef, useCallback } from 'react';
import { BackEntry, BackStack } from '../navigation/backStack';

export interface HistorySeam {
  pushState(data: unknown, title: string, url?: string): void;
  replaceState(data: unknown, title: string, url?: string): void;
  back(): void;
  addEventListener(event: 'popstate', handler: (e: PopStateEvent) => void): void;
  removeEventListener(event: 'popstate', handler: (e: PopStateEvent) => void): void;
}

export interface UseBackNavigationOptions {
  initialEntries?: BackEntry[];
  historySeam?: HistorySeam;
  onStackChange?: (entries: readonly BackEntry[]) => void;
}

export interface BackNavigationHandle {
  pushOverlay: (id: string, onPop: () => void) => void;
  closeOverlay: (id: string) => void;
  pushDestination: (id: string, onPop?: () => void) => void;
  replaceDestination: (id: string, onPop?: () => void) => void;
  resetToRoot: (entry: BackEntry) => void;
  canGoBack: () => boolean;
  goBack: () => boolean;
  getStack: () => BackStack;
}

function getBrowserHistorySeam(): HistorySeam | null {
  if (typeof window === 'undefined' || !window.history) return null;
  return {
    pushState: (data, title, url) => window.history.pushState(data, title, url),
    replaceState: (data, title, url) => window.history.replaceState(data, title, url),
    back: () => window.history.back(),
    addEventListener: (event, handler) => window.addEventListener(event, handler),
    removeEventListener: (event, handler) => window.removeEventListener(event, handler)
  };
}

/**
 * Manage navigation back-stack synchronized with browser history and native back events.
 *
 * Args:
 *   options: Optional initial stack entries, seam override, and change callback.
 *
 * Returns:
 *   Operations to push/close overlays, navigate destinations, and inspect stack state.
 */
export function useBackNavigation(options?: UseBackNavigationOptions): BackNavigationHandle {
  const seam = options?.historySeam ?? getBrowserHistorySeam();
  const suppressPopRef = useRef<number>(0);
  const onStackChangeRef = useRef(options?.onStackChange);
  onStackChangeRef.current = options?.onStackChange;

  const stackRef = useRef<BackStack | null>(null);
  if (!stackRef.current) {
    stackRef.current = new BackStack(options?.initialEntries ?? [], {
      onChange: (entries) => onStackChangeRef.current?.(entries)
    });
  }
  const stack = stackRef.current;

  useEffect(() => {
    if (!seam) return;

    const handlePopState = () => {
      if (suppressPopRef.current > 0) {
        suppressPopRef.current -= 1;
        return;
      }
      stack.pop();
    };

    seam.addEventListener('popstate', handlePopState);
    return () => {
      seam.removeEventListener('popstate', handlePopState);
    };
  }, [seam, stack]);

  const pushOverlay = useCallback(
    (id: string, onPop: () => void): void => {
      stack.push({ id, kind: 'overlay', onPop });
      seam?.pushState({ kind: 'overlay', id }, '');
    },
    [seam, stack]
  );

  const closeOverlay = useCallback(
    (id: string): void => {
      const removed = stack.closeWithoutBack(id);
      if (removed && seam) {
        suppressPopRef.current += 1;
        seam.back();
      }
    },
    [seam, stack]
  );

  const pushDestination = useCallback(
    (id: string, onPop?: () => void): void => {
      stack.push({ id, kind: 'destination', onPop });
      seam?.pushState({ kind: 'destination', id }, '');
    },
    [seam, stack]
  );

  const replaceDestination = useCallback(
    (id: string, onPop?: () => void): void => {
      stack.replace({ id, kind: 'destination', onPop });
      seam?.replaceState({ kind: 'destination', id }, '');
    },
    [seam, stack]
  );

  const resetToRoot = useCallback(
    (entry: BackEntry): void => {
      stack.resetToRoot(entry);
      seam?.replaceState({ kind: entry.kind, id: entry.id }, '');
    },
    [seam, stack]
  );

  const canGoBack = useCallback((): boolean => {
    return stack.canPop();
  }, [stack]);

  const goBack = useCallback((): boolean => {
    if (!stack.canPop()) return false;
    if (seam) {
      seam.back();
    } else {
      stack.pop();
    }
    return true;
  }, [seam, stack]);

  const getStack = useCallback((): BackStack => {
    return stack;
  }, [stack]);

  return {
    pushOverlay,
    closeOverlay,
    pushDestination,
    replaceDestination,
    resetToRoot,
    canGoBack,
    goBack,
    getStack
  };
}
