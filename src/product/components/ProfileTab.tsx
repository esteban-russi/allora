/** Profile tab displaying learner identity, learning settings, subscription, and account actions. */
import React, { useState } from 'react';
import {
  Edit3,
  ExternalLink,
  LogIn,
  LogOut,
  Mail,
  ShieldAlert,
  Sparkles,
  Trash2,
  User
} from 'lucide-react';
import type { DevSettings, LearnerProfile } from '../types';
import type { Me } from '../../platform/client/me';
import { BRAND } from '../../config/brand';
import { LegalLinks } from '../../platform/components/LegalLinks';
import { signOutToGuest } from '../../platform/client/firebaseAuth';
import { deleteWithAuth } from '../../platform/client/apiClient';
import { getBilling } from '../../platform/client/billing';
import { openManageSubscriptionTab } from '../../platform/components/AccountMenu';
import { LearningSettingsControls } from './LearningSettingsControls';
import { UsageMeter } from '../../platform/components/UsageMeter';
import type { HabitGoal, HabitReminder, HabitSummary } from '../server/habitStore';

export interface ProfileTabProps {
  learnerProfile: LearnerProfile;
  devSettings: DevSettings;
  onSaveSettings: (settings: DevSettings) => void;
  habits?: HabitSummary | null;
  onSaveHabitGoal?: (goal: HabitGoal) => void;
  onSaveReminder?: (reminder: HabitReminder) => void;
  onOpenDevLab?: () => void;
  me: Me | null;
  onEditProfile: () => void;
  onSignIn: () => void;
  onUpgrade?: () => void;
  onSignedOut: () => void;
  onAccountDeleted: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  learnerProfile,
  devSettings,
  onSaveSettings,
  habits,
  onSaveHabitGoal,
  onSaveReminder,
  onOpenDevLab,
  me,
  onEditProfile,
  onSignIn,
  onUpgrade,
  onSignedOut,
  onAccountDeleted,
  headingRef
}) => {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [subWarning, setSubWarning] = useState<string | null>(null);

  const isBillingAvailable = getBilling().isAvailable();
  const isGuest = !me || me.isAnonymous;
  const userLabel = isGuest ? 'Guest' : (me.email || 'Signed in');
  const planName = me?.tier
    ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1)
    : 'Guest';

  const handleManageSubscription = async () => {
    if (!me) return;
    setManageError(null);
    const opened = await openManageSubscriptionTab(me.userId);
    if (!opened) {
      setManageError('Could not open subscription management. Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutToGuest();
      onSignedOut();
    } catch (err: unknown) {
      console.warn('[Profile] Sign out failed:', err);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteWithAuth('/api/account');
      if (!res.ok) {
        throw new Error('Could not delete account');
      }
      const data = await res.json();
      if (data?.hadActiveSubscription) {
        setSubWarning(
          'Your subscription is not cancelled automatically. Cancel it in Google Play or from the link in your receipt email.'
        );
        await signOutToGuest();
      } else {
        await signOutToGuest();
        onAccountDeleted();
      }
    } catch (err: unknown) {
      setDeleteError((err as Error)?.message || 'Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 max-w-2xl mx-auto space-y-6">
      {/* Visually-hidden heading for accessibility and focus target */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="sr-only focus:outline-none"
      >
        Profile
      </h1>

      {/* Identity Card */}
      <section
        aria-labelledby="identity-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <h2 id="identity-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
          Identity
        </h2>
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-full bg-cobalt-tint text-cobalt flex items-center justify-center shrink-0">
            <User className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-lg font-semibold text-ink leading-tight">
                {learnerProfile.name}
              </h3>
              <span
                title={`Level ${learnerProfile.level}`}
                className="px-2.5 py-0.5 rounded-full bg-cobalt-tint text-cobalt text-xs font-semibold font-mono-data"
              >
                {learnerProfile.level}
              </span>
            </div>
            <p className="text-xs text-ink-muted truncate mt-0.5">{userLabel}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-line flex-wrap">
          <button
            type="button"
            onClick={onEditProfile}
            className="h-10 px-4 rounded-xl border border-line hover:bg-surface-tint text-xs font-semibold text-ink flex items-center gap-2 transition-colors"
          >
            <Edit3 className="w-4 h-4 text-ink-muted" aria-hidden="true" />
            <span>Edit profile</span>
          </button>
          {isGuest && (
            <button
              type="button"
              onClick={onSignIn}
              className="h-10 px-4 rounded-xl bg-cobalt text-canvas hover:bg-cobalt-strong text-xs font-semibold flex items-center gap-2 transition-colors shadow-xs"
            >
              <LogIn className="w-4 h-4" aria-hidden="true" />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </section>

      {/* Learning Settings */}
      <section
        aria-labelledby="learning-settings-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <h2 id="learning-settings-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
          Learning settings
        </h2>
        <LearningSettingsControls
          settings={devSettings}
          onSaveSettings={onSaveSettings}
          habitGoal={habits?.goal}
          onSaveHabitGoal={onSaveHabitGoal}
          reminder={habits?.reminder}
          onSaveReminder={onSaveReminder}
          onOpenDevLab={onOpenDevLab}
        />
      </section>

      {/* Subscription */}
      <section
        aria-labelledby="subscription-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <h2 id="subscription-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
          Subscription
        </h2>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Current plan</div>
            <div className="text-xs text-ink-muted mt-0.5">
              Tier: <span className="font-semibold text-ink font-mono-data">{planName}</span>
            </div>
          </div>
          {me?.tier === 'free' && isBillingAvailable && onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="h-10 px-4 rounded-xl bg-cobalt text-canvas hover:bg-cobalt-strong text-xs font-semibold flex items-center gap-2 transition-colors shadow-xs"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>Upgrade to Premium</span>
            </button>
          )}
          {me?.tier === 'premium' && isBillingAvailable && (
            <button
              type="button"
              onClick={handleManageSubscription}
              className="h-10 px-4 rounded-xl border border-line hover:bg-surface-tint text-xs font-semibold text-ink flex items-center gap-2 transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-ink-muted" aria-hidden="true" />
              <span>Manage subscription</span>
            </button>
          )}
          {isGuest && (
            <button
              type="button"
              onClick={onSignIn}
              className="h-10 px-4 rounded-xl bg-cobalt-tint text-cobalt hover:bg-cobalt/15 text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <span>Sign in to subscribe</span>
            </button>
          )}
        </div>

        {/* Daily usage allowance meters */}
        <UsageMeter me={me} />

        {manageError && (
          <p role="alert" className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200">
            {manageError}
          </p>
        )}
      </section>

      {/* Help & Feedback */}
      <section
        aria-labelledby="help-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-3"
      >
        <h2 id="help-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
          Help & Feedback
        </h2>
        <p className="text-xs text-ink-muted leading-relaxed">
          Questions or feedback? We’d love to hear from you.
        </p>
        <a
          href={`mailto:${BRAND.supportEmail}?subject=Allora%20Feedback`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-cobalt hover:underline"
        >
          <Mail className="w-4 h-4" aria-hidden="true" />
          <span>{BRAND.supportEmail}</span>
        </a>
      </section>

      {/* Account Actions and Legal */}
      <section
        aria-labelledby="account-actions-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <h2 id="account-actions-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
          Account & Legal
        </h2>

        {subWarning ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">{subWarning}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubWarning(null);
                onAccountDeleted();
              }}
              className="w-full h-11 flex items-center justify-center px-4 rounded-2xl bg-cobalt text-canvas font-semibold text-sm hover:bg-cobalt/90 transition-colors"
            >
              Understood
            </button>
          </div>
        ) : isConfirmingDelete ? (
          <div className="space-y-4 p-4 rounded-2xl bg-red-50/50 border border-red-200">
            <div className="space-y-1">
              <h3 className="font-serif text-base font-semibold text-red-700">
                Delete account
              </h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                This permanently deletes your conversations, notebook and account. This cannot be undone.
              </p>
            </div>

            {deleteError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200">
                {deleteError}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 h-10 flex items-center justify-center px-4 rounded-xl border border-line text-xs font-semibold text-ink bg-surface hover:bg-surface-tint transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 h-10 flex items-center justify-center px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {!isGuest && (
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full h-10 flex items-center gap-2.5 px-3 rounded-xl hover:bg-surface-tint text-xs font-semibold text-ink transition-colors text-left"
              >
                <LogOut className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className="w-full h-10 flex items-center gap-2.5 px-3 rounded-xl hover:bg-red-50 text-xs font-semibold text-red-600 transition-colors text-left"
            >
              <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" />
              <span>Delete account</span>
            </button>
          </div>
        )}

        <div className="pt-3 border-t border-line">
          <LegalLinks />
        </div>
      </section>
    </div>
  );
};
