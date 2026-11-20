/** Unit tests for the pure back-stack navigation logic and history seam. */
import { describe, expect, it, vi } from 'vitest';
import { BackStack } from '../src/platform/navigation/backStack';
import type { HistorySeam } from '../src/platform/hooks/useBackNavigation';

describe('BackStack', () => {
  it('initializes with empty or given entries', () => {
    const emptyStack = new BackStack();
    expect(emptyStack.size).toBe(0);
    expect(emptyStack.peek()).toBeUndefined();
    expect(emptyStack.canPop()).toBe(false);

    const seededStack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' }
    ]);
    expect(seededStack.size).toBe(2);
    expect(seededStack.peek()?.id).toBe('chat');
    expect(seededStack.canPop()).toBe(true);
  });

  it('pushes destinations and prevents consecutive duplicate destinations', () => {
    const stack = new BackStack([{ id: 'home', kind: 'destination' }]);
    stack.push({ id: 'chat', kind: 'destination' });
    expect(stack.size).toBe(2);
    expect(stack.peek()?.id).toBe('chat');

    // Duplicate consecutive push of 'chat' should be ignored
    stack.push({ id: 'chat', kind: 'destination' });
    expect(stack.size).toBe(2);

    // Pushing a different destination succeeds
    stack.push({ id: 'notebook', kind: 'destination' });
    expect(stack.size).toBe(3);
  });

  it('pushes overlays and allows same id if pushed on top of another entry', () => {
    const stack = new BackStack([{ id: 'chat', kind: 'destination' }]);
    stack.push({ id: 'settings', kind: 'overlay' });
    expect(stack.size).toBe(2);
    expect(stack.hasOverlay('settings')).toBe(true);
    expect(stack.openOverlays().map((o) => o.id)).toEqual(['settings']);
  });

  it('correctly tracks currentDestination beneath overlays', () => {
    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' }
    ]);
    expect(stack.currentDestination()?.id).toBe('chat');

    stack.push({ id: 'settings', kind: 'overlay' });
    stack.push({ id: 'report', kind: 'overlay' });

    // Current destination remains 'chat' even though overlays sit on top
    expect(stack.currentDestination()?.id).toBe('chat');
    expect(stack.peek()?.id).toBe('report');
  });

  it('canPop returns false only at root destination with no overlays', () => {
    const stack = new BackStack([{ id: 'home', kind: 'destination' }]);
    expect(stack.canPop()).toBe(false);

    stack.push({ id: 'settings', kind: 'overlay' });
    // An overlay makes the stack poppable even if only 1 destination exists
    expect(stack.canPop()).toBe(true);

    stack.pop();
    expect(stack.canPop()).toBe(false);

    stack.push({ id: 'chat', kind: 'destination' });
    expect(stack.canPop()).toBe(true);
  });

  it('pop executes onPop callback and returns popped entry', () => {
    const onPop = vi.fn();
    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination', onPop }
    ]);

    const popped = stack.pop();
    expect(popped?.id).toBe('chat');
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(stack.size).toBe(1);
    expect(stack.peek()?.id).toBe('home');
  });

  it('pop returns undefined and does not throw when cannot pop', () => {
    const stack = new BackStack([{ id: 'home', kind: 'destination' }]);
    const popped = stack.pop();
    expect(popped).toBeUndefined();
    expect(stack.size).toBe(1);
  });

  it('closes topmost overlay first when multiple overlays are stacked', () => {
    const onPopSettings = vi.fn();
    const onPopReport = vi.fn();

    const stack = new BackStack([
      { id: 'chat', kind: 'destination' },
      { id: 'settings', kind: 'overlay', onPop: onPopSettings },
      { id: 'report', kind: 'overlay', onPop: onPopReport }
    ]);

    // First back pops the topmost overlay (report)
    const poppedReport = stack.pop();
    expect(poppedReport?.id).toBe('report');
    expect(onPopReport).toHaveBeenCalledTimes(1);
    expect(onPopSettings).not.toHaveBeenCalled();
    expect(stack.peek()?.id).toBe('settings');

    // Second back pops settings
    const poppedSettings = stack.pop();
    expect(poppedSettings?.id).toBe('settings');
    expect(onPopSettings).toHaveBeenCalledTimes(1);
    expect(stack.peek()?.id).toBe('chat');
  });

  it('closeWithoutBack removes overlay without calling onPop and leaves no stale entry', () => {
    const onPopVoice = vi.fn();
    const onPopSettings = vi.fn();

    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' },
      { id: 'voice-call', kind: 'overlay', onPop: onPopVoice },
      { id: 'settings', kind: 'overlay', onPop: onPopSettings }
    ]);

    // User closes settings via its own X/Escape
    const closed = stack.closeWithoutBack('settings');
    expect(closed?.id).toBe('settings');
    expect(onPopSettings).not.toHaveBeenCalled();

    // Stack top is now voice-call
    expect(stack.peek()?.id).toBe('voice-call');
    expect(stack.hasOverlay('settings')).toBe(false);

    // Pressing back afterwards pops voice-call, NOT settings
    const popped = stack.pop();
    expect(popped?.id).toBe('voice-call');
    expect(onPopVoice).toHaveBeenCalledTimes(1);
    expect(onPopSettings).not.toHaveBeenCalled();
  });

  it('resetToRoot resets all entries to the provided root destination', () => {
    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' },
      { id: 'settings', kind: 'overlay' }
    ]);

    stack.resetToRoot({ id: 'home', kind: 'destination' });
    expect(stack.size).toBe(1);
    expect(stack.peek()?.id).toBe('home');
    expect(stack.canPop()).toBe(false);
  });

  it('invokes onChange listener whenever the stack entries change', () => {
    const onChange = vi.fn();
    const stack = new BackStack([{ id: 'home', kind: 'destination' }], { onChange });

    stack.push({ id: 'chat', kind: 'destination' });
    expect(onChange).toHaveBeenCalledTimes(1);

    stack.push({ id: 'settings', kind: 'overlay' });
    expect(onChange).toHaveBeenCalledTimes(2);

    stack.closeWithoutBack('settings');
    expect(onChange).toHaveBeenCalledTimes(3);

    stack.pop();
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});

describe('HistorySeam integration behavior', () => {
  function createFakeHistorySeam(): {
    seam: HistorySeam;
    historyStack: Array<{ data: unknown; title: string }>;
    popstateListeners: Array<(e: PopStateEvent) => void>;
    triggerPopState(): void;
  } {
    const historyStack: Array<{ data: unknown; title: string }> = [];
    const popstateListeners: Array<(e: PopStateEvent) => void> = [];

    const seam: HistorySeam = {
      pushState(data, title) {
        historyStack.push({ data, title });
      },
      replaceState(data, title) {
        if (historyStack.length > 0) {
          historyStack[historyStack.length - 1] = { data, title };
        } else {
          historyStack.push({ data, title });
        }
      },
      back() {
        if (historyStack.length > 1) {
          historyStack.pop();
          // Simulate browser dispatching popstate asynchronously
          seamHandler.triggerPopState();
        }
      },
      addEventListener(event, handler) {
        if (event === 'popstate') popstateListeners.push(handler);
      },
      removeEventListener(event, handler) {
        if (event === 'popstate') {
          const index = popstateListeners.indexOf(handler);
          if (index !== -1) popstateListeners.splice(index, 1);
        }
      }
    };

    const seamHandler = {
      seam,
      historyStack,
      popstateListeners,
      triggerPopState() {
        for (const listener of popstateListeners) {
          listener({} as PopStateEvent);
        }
      }
    };

    return seamHandler;
  }

  it('coordinates programmatic close without triggering duplicate onPop', () => {
    const fake = createFakeHistorySeam();
    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' }
    ]);

    let suppressPops = 0;
    const onPopSettings = vi.fn();

    // Push overlay
    stack.push({ id: 'settings', kind: 'overlay', onPop: onPopSettings });
    fake.seam.pushState({ kind: 'overlay', id: 'settings' }, '');

    // Programmatic close
    const removed = stack.closeWithoutBack('settings');
    expect(removed?.id).toBe('settings');
    expect(onPopSettings).not.toHaveBeenCalled();

    // Seam back is triggered and popstate arrives
    suppressPops += 1;
    fake.seam.back();

    // When popstate event arrived, it is suppressed
    if (suppressPops > 0) {
      suppressPops -= 1;
    } else {
      stack.pop();
    }

    expect(onPopSettings).not.toHaveBeenCalled();
    expect(stack.peek()?.id).toBe('chat');
  });

  it('ends voice call when popped by back action', () => {
    const endCallSpy = vi.fn();
    const stack = new BackStack([
      { id: 'home', kind: 'destination' },
      { id: 'chat', kind: 'destination' }
    ]);

    // User starts a voice call
    stack.push({
      id: 'voice-call',
      kind: 'overlay',
      onPop: endCallSpy
    });

    expect(stack.hasOverlay('voice-call')).toBe(true);

    // User presses back button
    stack.pop();
    expect(endCallSpy).toHaveBeenCalledTimes(1);
    expect(stack.peek()?.id).toBe('chat');
  });
});
