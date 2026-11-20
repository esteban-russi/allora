/** React hook managing active tabs, tab heading focus, and back navigation integration. */
import { useCallback, useRef, useState } from 'react';
import type { AppTab } from '../components/BottomTabBar';
import { BackEntry } from '../../platform/navigation/backStack';
import { useBackNavigation, type HistorySeam } from '../../platform/hooks/useBackNavigation';

export function buildInitialNavigationStack(initialTab: AppTab = 'chat'): BackEntry[] {
  if (initialTab === 'chat') {
    return [
      { id: 'tab:home', kind: 'destination' },
      { id: 'tab:chat', kind: 'destination' }
    ];
  }
  return [{ id: `tab:${initialTab}`, kind: 'destination' }];
}

export function destinationIdToTab(id: string): AppTab {
  if (id.startsWith('tab:')) {
    const raw = id.slice(4);
    if (raw === 'home' || raw === 'chat' || raw === 'notebook' || raw === 'profile') {
      return raw;
    }
  }
  return 'home';
}

export interface UseAppNavigationOptions {
  initialTab?: AppTab;
  historySeam?: HistorySeam;
}

export interface UseAppNavigationResult {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  selectTab: (tab: AppTab) => void;
  isComposerFocused: boolean;
  setIsComposerFocused: (focused: boolean) => void;
  homeHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  notebookHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  profileHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  pushOverlay: (id: string, onPop: () => void) => void;
  closeOverlay: (id: string) => void;
  pushScreen: (id: string, onPop: () => void) => void;
  closeScreen: (id: string) => void;
  canGoBack: () => boolean;
  goBack: () => boolean;
}

/**
 * Coordinate tab switching, accessibility focus on tab changes, and native back navigation.
 *
 * Args:
 *   options: Optional initial tab and history seam override for tests.
 *
 * Returns:
 *   Tab state, focus refs, overlay and screen push/close helpers, and back navigation operations.
 */
export function useAppNavigation(options?: UseAppNavigationOptions): UseAppNavigationResult {
  const initialTab = options?.initialTab ?? 'chat';
  const [activeTab, setActiveTabState] = useState<AppTab>(initialTab);
  const [isComposerFocused, setIsComposerFocused] = useState<boolean>(false);

  const homeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const notebookHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const initialEntries = buildInitialNavigationStack(initialTab);

  const backHandler = useBackNavigation({
    initialEntries,
    historySeam: options?.historySeam
  });

  const focusTabHeading = useCallback((tab: AppTab) => {
    // Schedule focus after render so new tab view is mounted
    requestAnimationFrame(() => {
      if (tab === 'home') {
        homeHeadingRef.current?.focus();
      } else if (tab === 'notebook') {
        notebookHeadingRef.current?.focus();
      } else if (tab === 'profile') {
        profileHeadingRef.current?.focus();
      }
    });
  }, []);

  const selectTab = useCallback(
    (nextTab: AppTab) => {
      if (nextTab === activeTab) return;

      setActiveTabState(nextTab);
      focusTabHeading(nextTab);

      if (nextTab === 'home') {
        // Navigating to Home resets to the root destination
        backHandler.resetToRoot({ id: 'tab:home', kind: 'destination' });
      } else {
        backHandler.pushDestination(`tab:${nextTab}`, () => {
          // When popped by Back, restore the preceding destination
          const currentDest = backHandler.getStack().currentDestination();
          const restoredTab = currentDest?.id.startsWith('tab:')
            ? (currentDest.id.replace('tab:', '') as AppTab)
            : 'home';
          setActiveTabState(restoredTab);
          focusTabHeading(restoredTab);
        });
      }
    },
    [activeTab, backHandler, focusTabHeading]
  );

  const setActiveTab = useCallback(
    (tab: AppTab) => {
      setActiveTabState(tab);
      focusTabHeading(tab);
    },
    [focusTabHeading]
  );

  const pushOverlay = useCallback(
    (id: string, onPop: () => void) => {
      backHandler.pushOverlay(`overlay:${id}`, onPop);
    },
    [backHandler]
  );

  const closeOverlay = useCallback(
    (id: string) => {
      backHandler.closeOverlay(`overlay:${id}`);
    },
    [backHandler]
  );

  const pushScreen = useCallback(
    (id: string, onPop: () => void) => {
      backHandler.pushDestination(`screen:${id}`, onPop);
    },
    [backHandler]
  );

  const closeScreen = useCallback(
    (id: string) => {
      backHandler.closeOverlay(`screen:${id}`);
    },
    [backHandler]
  );

  return {
    activeTab,
    setActiveTab,
    selectTab,
    isComposerFocused,
    setIsComposerFocused,
    homeHeadingRef,
    notebookHeadingRef,
    profileHeadingRef,
    pushOverlay,
    closeOverlay,
    pushScreen,
    closeScreen,
    canGoBack: backHandler.canGoBack,
    goBack: backHandler.goBack
  };
}
