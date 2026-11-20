/** Tests for app navigation tab stack generation, destination mapping, and BackStack routing. */
import { describe, expect, it } from 'vitest';
import {
  buildInitialNavigationStack,
  destinationIdToTab
} from '../src/product/hooks/useAppNavigation';
import { BackStack } from '../src/platform/navigation/backStack';

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
