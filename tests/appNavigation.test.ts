/** Tests for app navigation tab stack generation, destination mapping, and BackStack routing. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildInitialNavigationStack,
  destinationIdToTab,
  useAppNavigation,
  type UseAppNavigationOptions,
  type UseAppNavigationResult
} from '../src/product/hooks/useAppNavigation';
import { BackStack } from '../src/platform/navigation/backStack';
import type { HistorySeam } from '../src/platform/hooks/useBackNavigation';

export function createFakeHistorySeam(initialLength = 1) {
  const historyStack: Array<{ data: unknown; title: string }> = [];
  for (let i = 0; i < initialLength; i++) {
    historyStack.push({ data: null, title: '' });
  }
  let pointer = initialLength - 1;
  const popstateListeners: Array<(e: PopStateEvent) => void> = [];

  const seam: HistorySeam = {
    pushState(data, title) {
      historyStack.splice(pointer + 1);
      historyStack.push({ data, title });
      pointer = historyStack.length - 1;
    },
    replaceState(data, title) {
      if (pointer >= 0 && pointer < historyStack.length) {
        historyStack[pointer] = { data, title };
      } else {
        historyStack.push({ data, title });
        pointer = historyStack.length - 1;
      }
    },
    back() {
      if (pointer > 0) {
        pointer -= 1;
        seamHandler.triggerPopState();
      }
    },
    go(delta: number) {
      const nextPointer = pointer + delta;
      if (nextPointer >= 0 && nextPointer < historyStack.length && nextPointer !== pointer) {
        pointer = nextPointer;
        seamHandler.triggerPopState();
      }
    },
    addEventListener(event, handler) {
      if (event === 'popstate') popstateListeners.push(handler);
    },
    removeEventListener(event, handler) {
      if (event === 'popstate') {
        const idx = popstateListeners.indexOf(handler);
        if (idx !== -1) popstateListeners.splice(idx, 1);
      }
    }
  };

  const seamHandler = {
    seam,
    get depth() {
      return pointer + 1;
    },
    get historyStack() {
      return historyStack.slice(0, pointer + 1);
    },
    triggerPopState() {
      for (const listener of [...popstateListeners]) {
        listener({} as PopStateEvent);
      }
    }
  };

  return seamHandler;
}

function NavigationHarness({
  options,
  onReady
}: {
  options: UseAppNavigationOptions;
  onReady: (nav: UseAppNavigationResult) => void;
}) {
  const nav = useAppNavigation(options);
  onReady(nav);
  return null;
}

function mountNavigation(options: UseAppNavigationOptions = {}): {
  nav: UseAppNavigationResult;
  fakeSeam: ReturnType<typeof createFakeHistorySeam>;
} {
  const fakeSeam = createFakeHistorySeam();
  let navResult: UseAppNavigationResult | null = null;
  renderToStaticMarkup(
    React.createElement(NavigationHarness, {
      options: { ...options, historySeam: fakeSeam.seam },
      onReady: (res) => {
        navResult = res;
      }
    })
  );
  return { nav: navResult!, fakeSeam };
}

describe('buildInitialNavigationStack', () => {
  it('seeds Home at root and Chat on top when landing on Chat', () => {
    const stack = buildInitialNavigationStack('chat');
    expect(stack).toEqual([
      { id: 'tab:home', kind: 'destination' },
      { id: 'tab:chat', kind: 'destination' }
    ]);
  });

  it('seeds a single root entry when landing on Home directly', () => {
    const stack = buildInitialNavigationStack('home');
    expect(stack).toEqual([{ id: 'tab:home', kind: 'destination' }]);
  });

  it('seeds custom initial tab directly', () => {
    const notebookStack = buildInitialNavigationStack('notebook');
    expect(notebookStack).toEqual([{ id: 'tab:notebook', kind: 'destination' }]);
  });
});

describe('destinationIdToTab', () => {
  it('parses valid tab destination ids', () => {
    expect(destinationIdToTab('tab:home')).toBe('home');
    expect(destinationIdToTab('tab:chat')).toBe('chat');
    expect(destinationIdToTab('tab:notebook')).toBe('notebook');
    expect(destinationIdToTab('tab:profile')).toBe('profile');
  });

  it('defaults unknown or non-tab ids to home', () => {
    expect(destinationIdToTab('screen:plans')).toBe('home');
    expect(destinationIdToTab('tab:unknown')).toBe('home');
    expect(destinationIdToTab('')).toBe('home');
  });
});

describe('Browser history synchronization and Android bottom-navigation conventions', () => {
  it('syncs browser history depth at launch on Chat and unwinds to Home on Back', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'chat' });

    // Initial state: on Chat, browser history has Home below Chat
    expect(fakeSeam.depth).toBe(2);
    expect(fakeSeam.historyStack.map((e) => (e.data as any)?.id)).toEqual(['tab:home', 'tab:chat']);
    expect(nav.canGoBack()).toBe(true);
    expect(nav.activeTab).toBe('chat');

    // Back from Chat pops to Home
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
    expect(nav.canGoBack()).toBe(false);

    // Back on Home does not pop (exits the app, handled by browser/OS)
    const handled = nav.goBack();
    expect(handled).toBe(false);
    expect(fakeSeam.depth).toBe(1);
  });

  it('keeps depth at 2 during tab hopping and returns to Home on first Back', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'home' });

    // Start on Home
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
    expect(nav.canGoBack()).toBe(false);

    // Switch to Chat -> pushes tab:chat (depth 2)
    nav.selectTab('chat');
    expect(nav.activeTab).toBe('chat');
    expect(fakeSeam.depth).toBe(2);

    // Switch Chat -> Notebook -> replaces tab entry (depth remains 2, does NOT build history)
    nav.selectTab('notebook');
    expect(nav.activeTab).toBe('notebook');
    expect(fakeSeam.depth).toBe(2);

    // Switch Notebook -> Profile -> replaces tab entry (depth remains 2)
    nav.selectTab('profile');
    expect(nav.activeTab).toBe('profile');
    expect(fakeSeam.depth).toBe(2);

    // Back from Profile pops directly to Home
    fakeSeam.seam.back();
    expect(nav.activeTab).toBe('home');
    expect(fakeSeam.depth).toBe(1);
    expect(nav.canGoBack()).toBe(false);

    // Back on Home exits (no handled pop)
    expect(nav.goBack()).toBe(false);
    expect(fakeSeam.depth).toBe(1);
  });

  it('syncs browser depth on open overlay and close via X before Back', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'chat' });
    expect(fakeSeam.depth).toBe(2);

    const onPop = vi.fn();
    nav.pushOverlay('settings', onPop);
    expect(fakeSeam.depth).toBe(3);

    // Close via X button (programmatic closeWithoutBack)
    nav.closeOverlay('settings');
    expect(fakeSeam.depth).toBe(2);
    expect(onPop).not.toHaveBeenCalled();

    // Subsequent Back pops Chat to Home
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
  });

  it('syncs browser depth on open screen and close via its button before Back', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'chat' });
    expect(fakeSeam.depth).toBe(2);

    const onPop = vi.fn();
    nav.pushScreen('plans', onPop);
    expect(fakeSeam.depth).toBe(3);

    // Close screen via its own button (closeScreen removes screen:plans)
    nav.closeScreen('plans');
    expect(fakeSeam.depth).toBe(2);
    expect(onPop).not.toHaveBeenCalled();

    // Subsequent Back pops Chat to Home without ghost entries
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
  });

  it('ensures Home + Back exits with no handled pop', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'home' });
    expect(fakeSeam.depth).toBe(1);
    expect(nav.canGoBack()).toBe(false);

    // goBack returns false when on Home at root
    expect(nav.goBack()).toBe(false);
    expect(fakeSeam.depth).toBe(1);
  });

  it('unwinds browser history when selecting Home from deep stack via resetToRoot', () => {
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'chat' });
    expect(fakeSeam.depth).toBe(2);

    nav.pushScreen('plans', vi.fn());
    expect(fakeSeam.depth).toBe(3);

    // User taps Home tab directly
    nav.selectTab('home');
    expect(nav.activeTab).toBe('home');
    expect(fakeSeam.depth).toBe(1);
    expect(nav.canGoBack()).toBe(false);
  });

  it('handles sequence: Back -> list -> Back -> Home -> Back -> exit when opened from list', () => {
    // Sequence 1: Chat opened from list pushes on top:
    // User is on Chats list: stack is [tab:home, screen:conversations]
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'chat' });
    // Switch to conversations list
    nav.replaceDestination('screen:conversations');
    expect(fakeSeam.depth).toBe(2);
    expect(fakeSeam.historyStack.map((e) => (e.data as any)?.id)).toEqual([
      'tab:home',
      'screen:conversations'
    ]);
    expect(nav.activeTab).toBe('chat');
    expect(nav.currentDestinationId).toBe('screen:conversations');

    // Opening a conversation FROM the list pushes it on top of the list
    nav.pushScreen('conversation', vi.fn());
    expect(fakeSeam.depth).toBe(3);
    expect(nav.currentDestinationId).toBe('screen:conversation');

    // Invariant: browser depth == stack depth
    expect(fakeSeam.depth).toBe(nav.getStack().size);

    // 1. Back from conversation -> goes to list
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(2);
    expect(nav.currentDestinationId).toBe('screen:conversations');
    expect(fakeSeam.depth).toBe(nav.getStack().size);

    // 2. Back from list -> goes to Home
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
    expect(nav.currentDestinationId).toBe('tab:home');
    expect(fakeSeam.depth).toBe(nav.getStack().size);

    // 3. Back from Home -> exits (not handled)
    expect(nav.goBack()).toBe(false);
    expect(fakeSeam.depth).toBe(1);
  });

  it('keeps Back -> Home when Chat is opened from the tab bar or Home', () => {
    // Sequence 2: Opening Chat from tab bar or Home shows conversation with Back -> Home
    const { nav, fakeSeam } = mountNavigation({ initialTab: 'home' });
    expect(fakeSeam.depth).toBe(1);

    // Tap Chat tab from Home
    nav.selectTab('chat');
    expect(fakeSeam.depth).toBe(2);
    expect(fakeSeam.historyStack.map((e) => (e.data as any)?.id)).toEqual(['tab:home', 'tab:chat']);
    expect(nav.activeTab).toBe('chat');

    // Back from Chat directly pops to Home
    fakeSeam.seam.back();
    expect(fakeSeam.depth).toBe(1);
    expect(nav.activeTab).toBe('home');
    expect(nav.canGoBack()).toBe(false);
  });
});

describe('Tab back stack flow', () => {
  it('supports back from Chat to Home and leaves app on Home', () => {
    const initial = buildInitialNavigationStack('chat');
    const stack = new BackStack(initial);

    // Initial state: on Chat, can pop to Home
    expect(stack.peek()?.id).toBe('tab:chat');
    expect(stack.canPop()).toBe(true);

    // User presses Back: pops Chat to reveal Home
    const popped = stack.pop();
    expect(popped?.id).toBe('tab:chat');
    expect(stack.peek()?.id).toBe('tab:home');

    // On Home at root: cannot pop further (browser default leaves the app)
    expect(stack.canPop()).toBe(false);
  });

  it('navigates from Chat to Notebook to Profile and unwinds back to Home', () => {
    const stack = new BackStack(buildInitialNavigationStack('chat'));

    // Learner taps Notebook tab
    stack.push({ id: 'tab:notebook', kind: 'destination' });
    expect(stack.peek()?.id).toBe('tab:notebook');

    // Learner taps Profile tab
    stack.push({ id: 'tab:profile', kind: 'destination' });
    expect(stack.peek()?.id).toBe('tab:profile');

    // Back from Profile -> Notebook
    expect(stack.pop()?.id).toBe('tab:profile');
    expect(stack.peek()?.id).toBe('tab:notebook');

    // Back from Notebook -> Chat
    expect(stack.pop()?.id).toBe('tab:notebook');
    expect(stack.peek()?.id).toBe('tab:chat');

    // Back from Chat -> Home
    expect(stack.pop()?.id).toBe('tab:chat');
    expect(stack.peek()?.id).toBe('tab:home');

    // Back on Home leaves app
    expect(stack.canPop()).toBe(false);
  });

  it('handles overlay opened on top of Notebook without changing active destination', () => {
    const stack = new BackStack(buildInitialNavigationStack('chat'));
    stack.push({ id: 'tab:notebook', kind: 'destination' });

    // Open settings overlay
    stack.push({ id: 'overlay:settings', kind: 'overlay' });
    expect(stack.peek()?.id).toBe('overlay:settings');
    expect(stack.currentDestination()?.id).toBe('tab:notebook');

    // Pressing Back closes settings and keeps Notebook active
    const popped = stack.pop();
    expect(popped?.id).toBe('overlay:settings');
    expect(stack.peek()?.id).toBe('tab:notebook');
    expect(stack.currentDestination()?.id).toBe('tab:notebook');
  });

  it('handles screens like plans on top of app tabs', () => {
    const stack = new BackStack(buildInitialNavigationStack('chat'));

    // Learner visits plans screen
    stack.push({ id: 'screen:plans', kind: 'destination' });
    expect(stack.peek()?.id).toBe('screen:plans');

    // Pressing Back returns to Chat
    const popped = stack.pop();
    expect(popped?.id).toBe('screen:plans');
    expect(stack.peek()?.id).toBe('tab:chat');
  });
});
