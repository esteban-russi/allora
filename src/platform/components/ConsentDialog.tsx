/** Blocking dialog asking restored learners to accept the current Terms and Privacy Policy. */
import React, { useRef, useState } from 'react';
import { BRAND } from '../../config/brand';
import { TERMS_VERSION } from '../../config/legal';
import { useDialog } from '../hooks/useDialog';
import type { Consent } from '../server/accountStore';
import { submitConsent } from '../client/me';
import { ConsentCheckbox } from './ConsentCheckbox';

export interface ConsentDialogProps {
  isOpen: boolean;
  onAccepted: (consent: Consent) => void;
  submit?: (termsVersion: string) => Promise<Consent | null>;
}

/**
 * Render a blocking consent modal for restored users who have not accepted TERMS_VERSION.
 *
 * Args:
 *   isOpen: Whether the modal is visible.
 *   onAccepted: Called with the saved Consent record once the server confirms it.
 *   submit: Optional consent submission override for tests.
 */
export const ConsentDialog: React.FC<ConsentDialogProps> = ({
  isOpen,
  onAccepted,
  submit = submitConsent
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, isOpen);

  const [checked, setChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checked || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const saved = await submit(TERMS_VERSION);
    setIsSubmitting(false);
    if (!saved) {
      setError('Could not save your confirmation. Please try again.');
      return;
    }
    onAccepted(saved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-dialog-title"
        tabIndex={-1}
        className="w-full max-w-md bg-surface border border-line rounded-[24px] p-6 shadow-2xl space-y-5 focus:outline-none"
      >
        <div className="space-y-1.5">
          <h2 id="consent-dialog-title" className="font-serif text-xl font-semibold text-ink">
            Before you continue
          </h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            Please confirm your age and accept our current Terms and Privacy Policy to keep using{' '}
            {BRAND.name}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ConsentCheckbox
            id="consent-dialog-checkbox"
            checked={checked}
            disabled={isSubmitting}
            onChange={setChecked}
          />

          {error && (
            <p
              role="alert"
              className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!checked || isSubmitting}
            className="w-full h-11 flex items-center justify-center px-4 rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas font-semibold text-sm transition-colors disabled:opacity-50 disabled:hover:bg-cobalt"
          >
            {isSubmitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};
