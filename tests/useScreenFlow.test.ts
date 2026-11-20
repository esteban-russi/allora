import { describe, expect, it } from 'vitest';
import { stepAfterPlans, stepAfterSignIn, type SignInOutcome } from '../src/product/hooks/useScreenFlow';

const outcome = (overrides: Partial<SignInOutcome> = {}): SignInOutcome => ({
  mode: 'login',
  hasSession: false,
  isPremium: false,
  billingAvailable: true,
  pendingTutorId: null,
  ...overrides
});

describe('stepAfterSignIn', () => {
  it('preselects a pending tutor for a premium account', () => {
    expect(stepAfterSignIn(outcome({ pendingTutorId: 'giulia', isPremium: true }))).toEqual({
      screen: 'onboarding',
      selectTutorId: 'giulia',
      clearPendingTutor: true,
      startSession: false
    });
  });

  it('keeps a pending tutor and shows the plans for a free account', () => {
    expect(stepAfterSignIn(outcome({ pendingTutorId: 'giulia', hasSession: true }))).toMatchObject({
      screen: 'plans',
      clearPendingTutor: false
    });
  });

  it('drops a pending tutor when billing is unavailable', () => {
    expect(stepAfterSignIn(outcome({ pendingTutorId: 'giulia', billingAvailable: false }))).toMatchObject({
      screen: 'onboarding',
      selectTutorId: null,
      clearPendingTutor: true
    });
  });

  it('opens the app for a login that restored a session', () => {
    expect(stepAfterSignIn(outcome({ hasSession: true })).screen).toBe('app');
  });

  it('offers the plans after onboarding when a session was restored', () => {
    expect(stepAfterSignIn(outcome({ mode: 'after-onboarding', hasSession: true })).screen).toBe('plans');
  });

  it('opens the app after onboarding for a premium account', () => {
    expect(stepAfterSignIn(outcome({ mode: 'after-onboarding', hasSession: true, isPremium: true })).screen).toBe('app');
  });

  it('sends a login without a session to onboarding', () => {
    expect(stepAfterSignIn(outcome())).toMatchObject({ screen: 'onboarding', startSession: false });
  });

  it('starts a session for the onboarding profile when none was restored', () => {
    expect(stepAfterSignIn(outcome({ mode: 'after-onboarding' }))).toMatchObject({ screen: 'plans', startSession: true });
    expect(stepAfterSignIn(outcome({ mode: 'after-onboarding', billingAvailable: false }))).toMatchObject({
      screen: 'app',
      startSession: true
    });
  });
});

describe('stepAfterPlans', () => {
  it('opens the app when no tutor is pending', () => {
    expect(stepAfterPlans(null, true, true)).toEqual({ screen: 'app', selectTutorId: null, clearPendingTutor: false });
  });

  it('preselects the pending tutor after a purchase', () => {
    expect(stepAfterPlans('giulia', true, false)).toEqual({
      screen: 'onboarding',
      selectTutorId: 'giulia',
      clearPendingTutor: true
    });
  });

  it('returns to onboarding without the tutor when nothing was bought', () => {
    expect(stepAfterPlans('giulia', false, false)).toEqual({
      screen: 'onboarding',
      selectTutorId: null,
      clearPendingTutor: true
    });
  });
});
