import React, { useRef, useState } from 'react';
import { X, User, LogIn, LogOut, Trash2, Edit3, ShieldAlert, Sparkles, ExternalLink } from 'lucide-react';
import type { Me } from '../utils/me';
import { useDialog } from '../hooks/useDialog';
import { signOutToGuest } from '../utils/firebaseAuth';
import { deleteWithAuth } from '../utils/apiClient';
import { getBilling } from '../utils/billing';

export interface AccountMenuProps {
  isOpen: boolean;
  onClose: () => void;
  me: Me | null;
  onEditProfile: () => void;
  onSignIn: () => void;
  onSignedOut: () => void;
  onAccountDeleted: () => void;
  onUpgrade?: () => void;
}

export const AccountMenu: React.FC<AccountMenuProps> = ({
  isOpen,
  onClose,
  me,
  onEditProfile,
  onSignIn,
  onSignedOut,
  onAccountDeleted,
  onUpgrade
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, isOpen, onClose);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [subWarning, setSubWarning] = useState<string | null>(null);

  if (!isOpen) return null;

  const isBillingAvailable = getBilling().isAvailable();
  const isGuest = !me || me.isAnonymous;
  const userLabel = isGuest ? 'Guest' : (me.email || 'Signed in');
  const planName = me?.tier
    ? me.tier.charAt(0).toUpperCase() + me.tier.slice(1)
    : 'Guest';

  const handleSignOut = async () => {
    try {
      await signOutToGuest();
      onClose();
      onSignedOut();
    } catch (err: unknown) {
      console.warn('[Account] Sign out failed:', err);
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
        onClose();
        onAccountDeleted();
      }
    } catch (err: unknown) {
      setDeleteError((err as Error)?.message || 'Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-menu-title"
        tabIndex={-1}
        className="w-full max-w-sm bg-surface border border-line rounded-[24px] overflow-hidden shadow-2xl flex flex-col focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 id="account-menu-title" className="font-serif text-lg font-semibold text-ink">
            Account
          </h2>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-surface-tint text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
            aria-label="Close account menu"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
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
                  onClose();
                  onAccountDeleted();
                }}
                className="w-full h-11 flex items-center justify-center px-4 rounded-2xl bg-cobalt text-canvas font-semibold text-sm hover:bg-cobalt/90 transition-colors"
              >
                Understood
              </button>
            </div>
          ) : isConfirmingDelete ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-serif text-base font-semibold text-red-700">
                  Delete account
                </h3>
                <p className="text-sm text-ink-muted leading-relaxed">
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
                  className="flex-1 h-11 flex items-center justify-center px-4 rounded-2xl border border-line text-sm font-semibold text-ink hover:bg-surface-tint transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="flex-1 h-11 flex items-center justify-center px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Identity details */}
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-canvas border border-line">
                <div className="w-10 h-10 rounded-full bg-cobalt-tint text-cobalt flex items-center justify-center shrink-0">
                  <User className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate">
                    {userLabel}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Plan: <span className="font-medium text-ink font-mono-data">{planName}</span>
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditProfile();
                  }}
                  className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl hover:bg-surface-tint text-sm font-semibold text-ink transition-colors"
                >
                  <Edit3 className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                  <span>Edit profile</span>
                </button>

                {isGuest ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSignIn();
                    }}
                    className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl bg-cobalt-tint text-cobalt hover:bg-cobalt/15 text-sm font-semibold transition-colors"
                  >
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                    <span>Sign in</span>
                  </button>
                ) : (
                  <>
                    {me?.tier === 'free' && isBillingAvailable && onUpgrade && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onUpgrade();
                        }}
                        className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl bg-cobalt-tint text-cobalt hover:bg-cobalt/15 text-sm font-semibold transition-colors"
                      >
                        <Sparkles className="w-4 h-4" aria-hidden="true" />
                        <span>Upgrade</span>
                      </button>
                    )}

                    {me?.tier === 'premium' && isBillingAvailable && (
                      <button
                        type="button"
                        onClick={async () => {
                          const url = await getBilling().manageUrl(me.userId);
                          if (url) {
                            window.open(url, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl hover:bg-surface-tint text-sm font-semibold text-ink transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                        <span>Manage subscription</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl hover:bg-surface-tint text-sm font-semibold text-ink transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                      <span>Sign out</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsConfirmingDelete(true)}
                      className="w-full h-11 flex items-center gap-3 px-4 rounded-2xl hover:bg-red-50 text-sm font-semibold text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" />
                      <span>Delete account</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
