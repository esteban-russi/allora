import React, { useState } from 'react';

interface MagicLinkEmailFormProps {
  /** Called with the email the sign-in link was sent to. */
  onSubmit: (email: string) => void;
  onCancel: () => void;
}

/** Asks for the email again when a sign-in link is opened in a browser that did not request it. */
export const MagicLinkEmailForm: React.FC<MagicLinkEmailFormProps> = ({ onSubmit, onCancel }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    onSubmit(trimmed);
  };

  return (
    <div className="min-h-dvh w-full bg-canvas text-ink flex items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md p-6 sm:p-8 rounded-[24px] bg-surface border border-line shadow-soft space-y-5"
      >
        <div className="space-y-2">
          <h1 className="font-serif text-2xl font-semibold text-ink tracking-tight">Confirm your email</h1>
          <p className="text-sm text-ink-muted">
            To finish signing in, enter the email address this link was sent to.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="magic-link-email" className="block text-sm font-medium text-ink">
            Email address
          </label>
          <input
            id="magic-link-email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full h-12 px-4 rounded-2xl bg-canvas border border-line text-sm text-ink focus:outline-none focus:border-cobalt"
          />
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="w-full h-12 rounded-full bg-cobalt hover:bg-cobalt-strong text-canvas text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in…' : 'Finish signing in'}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="w-full h-12 rounded-full text-sm font-medium text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
