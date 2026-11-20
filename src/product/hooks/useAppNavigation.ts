/** React hook managing active tabs, tab heading focus, and back navigation integration. */
import { useCallback, useRef, useState } from 'react';
import type { AppTab } from '../components/BottomTabBar';
import { BackEntry, BackStack } from '../../platform/navigation/backStack';
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

export function currentTabFromStack(stack: BackStack): AppTab {
  const entries = stack.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id.startsWith('tab:')) {
      const tab = entries[i].id.slice(4);
      if (tab === 'home' || tab === 'chat' || tab === 'notebook' || tab === 'profile') {
        return tab;
      }
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
  const [, setVersion] = useState<number>(0);
  const [isComposerFocused, setIsComposerFocused] = useState<boolean>(false);

  const homeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const notebookHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const handleTabPopRef = useRef<() => void>(() => {});
  const initialEntriesRef = useRef<BackEntry[] | null>(null);
  if (!initialEntriesRef.current) {
    const base = buildInitialNavigationStack(initialTab);
    initialEntriesRef.current = base.map((entry) => {
      if (entry.id !== 'tab:home') {
        return { ...entry, onPop: () => handleTabPopRef.current() };
      }
      return entry;
    });
  }

  const backHandler = useBackNavigation({
    initialEntries: initialEntriesRef.current,
    historySeam: options?.historySeam,
    onStackChange: () => setVersion((v) => v + 1)
  });

  const focusTabHeading = useCallback((tab: AppTab) => {
    // Schedule focus after render so new tab view is mounted
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (tab === 'home') {
          homeHeadingRef.current?.focus();
        } else if (tab === 'notebook') {
          notebookHeadingRef.current?.focus();
        } else if (tab === 'profile') {
          profileHeadingRef.current?.focus();
        }
      });
    }
  }, []);

  handleTabPopRef.current = () => {
    const restoredTab = currentTabFromStack(backHandler.getStack());
    focusTabHeading(restoredTab);
  };

  const selectTab = useCallback(
    (nextTab: AppTab) => {
      const currentTab = currentTabFromStack(backHandler.getStack());
      if (nextTab === currentTab) return;

      focusTabHeading(nextTab);

      if (nextTab === 'home') {
        // Navigating to Home resets to the root destination
        backHandler.resetToRoot({ id: 'tab:home', kind: 'destination' });
      } else {
        const onPop = () => handleTabPopRef.current();
        if (currentTab !== 'home') {
          // Top-level tabs do NOT build history among themselves.
          // Switching tabs replaces the tab entry. Any non-Home tab sits exactly one step above Home.
          backHandler.replaceDestination(`tab:${nextTab}`, onPop);
        } else {
          backHandler.pushDestination(`tab:${nextTab}`, onPop);
        }
      }
    },
    [backHandler, focusTabHeading]
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
    get activeTab() {
      return currentTabFromStack(backHandler.getStack());
    },
    setActiveTab: selectTab,
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
