/** React hook routing between onboarding, sign-in, plans and the app. */
import { useState } from 'react';

export type Screen = 'onboarding' | 'signin-after-onboarding' | 'signin-login' | 'plans' | 'app';
export type SignInMode = 'login' | 'after-onboarding';

/** Where to go next, and what to do with a premium tutor picked before paying. */
export interface FlowStep {
  screen: Screen;
  /** Tutor to preselect in onboarding, or null to leave the selection alone. */
  selectTutorId: string | null;
  /** Whether the pending premium tutor has been dealt with and can be forgotten. */
  clearPendingTutor: boolean;
}

export interface SignInOutcome {
  mode: SignInMode;
  /** Whether the account already had a saved conversation. */
  hasSession: boolean;
  isPremium: boolean;
  billingAvailable: boolean;
  /** Premium tutor tapped in onboarding before signing in, if any. */
  pendingTutorId: string | null;
}

/**
 * Decide where a learner goes right after signing in.
 *
 * A pending premium tutor wins: premium accounts get it preselected, others see
 * the plans when billing works. Otherwise a restored conversation opens the app,
 * except that a guest who just finished onboarding is offered the plans first.
 *
 * Args:
 *   outcome: What the sign-in found.
 *
 * Returns:
 *   The next step, plus `startSession` when the onboarding profile still needs a session.
 */
export function stepAfterSignIn(outcome: SignInOutcome): FlowStep & { startSession: boolean } {
  const { mode, hasSession, isPremium, billingAvailable, pendingTutorId } = outcome;
  const offerPlans = billingAvailable && !isPremium;
  const keep = { selectTutorId: null, clearPendingTutor: false, startSession: false };

  if (pendingTutorId) {
    if (isPremium) return { ...keep, screen: 'onboarding', selectTutorId: pendingTutorId, clearPendingTutor: true };
    if (billingAvailable) return { ...keep, screen: 'plans' };
    return { ...keep, screen: 'onboarding', clearPendingTutor: true };
  }
  if (hasSession) {
    return { ...keep, screen: mode === 'after-onboarding' && offerPlans ? 'plans' : 'app' };
  }
  if (mode === 'login') return { ...keep, screen: 'onboarding' };
  return { ...keep, screen: offerPlans ? 'plans' : 'app', startSession: true };
}

/**
 * Decide where a learner goes when they leave the plans screen.
 *
 * Args:
 *   pendingTutorId: Premium tutor that sent them to the plans, if any.
 *   purchased: Whether they just bought Premium.
 *   isPremium: Whether the account is already Premium.
 *
 * Returns:
 *   The next step: back to onboarding for a pending tutor (preselected once paid for), else the app.
 */
export function stepAfterPlans(pendingTutorId: string | null, purchased: boolean, isPremium: boolean): FlowStep {
  if (!pendingTutorId) return { screen: 'app', selectTutorId: null, clearPendingTutor: false };
  return {
    screen: 'onboarding',
    selectTutorId: purchased || isPremium ? pendingTutorId : null,
    clearPendingTutor: true
  };
}

export interface UseScreenFlowResult {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  /** Tutor to preselect when onboarding opens, or null. */
  selectedTutorId: string | null;
  /** Route after sign-in; returns true when the caller should start a session for the onboarding profile. */
  afterSignIn: (outcome: Omit<SignInOutcome, 'pendingTutorId'>) => boolean;
  /** A locked tutor was tapped: guests sign in first, accounts go straight to the plans. */
  seePlansForTutor: (tutorId: string, isGuest: boolean) => void;
  afterPlans: (purchased: boolean, isPremium: boolean) => void;
  /** Forget any pending or preselected tutor. */
  clearTutorSelection: () => void;
  /** Sign-in was skipped from the login screen: drop the pending tutor and go back to onboarding. */
  cancelSignIn: () => void;
}

/**
 * Current screen and the premium-tutor detour through sign-in and plans.
 *
 * Returns:
 *   The screen, its setter, the preselected tutor and the routing actions.
 */
export function useScreenFlow(): UseScreenFlowResult {
  const [screen, setScreen] = useState<Screen>('onboarding');
  // Premium tutor tapped in onboarding before signing in / subscribing
  const [pendingTutorId, setPendingTutorId] = useState<string | null>(null);
  const [selectedTutorId, setSelectedTutorId] = useState<string | null>(null);

  const apply = (step: FlowStep) => {
    if (step.selectTutorId) setSelectedTutorId(step.selectTutorId);
    if (step.clearPendingTutor) setPendingTutorId(null);
    setScreen(step.screen);
  };

  const afterSignIn = (outcome: Omit<SignInOutcome, 'pendingTutorId'>) => {
    const step = stepAfterSignIn({ ...outcome, pendingTutorId });
    apply(step);
    return step.startSession;
  };

  const seePlansForTutor = (tutorId: string, isGuest: boolean) => {
    setPendingTutorId(tutorId);
    setScreen(isGuest ? 'signin-login' : 'plans');
  };

  const afterPlans = (purchased: boolean, isPremium: boolean) => {
    apply(stepAfterPlans(pendingTutorId, purchased, isPremium));
  };

  const clearTutorSelection = () => {
    setPendingTutorId(null);
    setSelectedTutorId(null);
  };

  const cancelSignIn = () => {
    setPendingTutorId(null);
    setScreen('onboarding');
  };

  return { screen, setScreen, selectedTutorId, afterSignIn, seePlansForTutor, afterPlans, clearTutorSelection, cancelSignIn };
}
