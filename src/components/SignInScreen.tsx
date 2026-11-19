import React, { useState } from 'react';
import { Sparkles, Mail, ArrowLeft } from 'lucide-react';
import { sendMagicLink, signInWithGoogle } from '../utils/firebaseAuth';
import { MERGE_FAILED_NOTICE, showNotice } from '../utils/notice';

export interface SignInScreenProps {
  mode: 'after-onboarding' | 'login';
  onSignedIn: () => void;
  onSkip: () => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  mode,
  onSignedIn,
  onSkip
}) => {
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = mode === 'after-onboarding' ? 'Save your progress' : 'Welcome back';
  const subheading =
    mode === 'after-onboarding'
      ? 'Sign in to sync your conversation across devices and access free daily limits.'
      : 'Sign in to access your saved conversations, vocabulary and Italian practice.';

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await signInWithGoogle();
      if (res.ok) {
        if (res.mergeFailed) showNotice(MERGE_FAILED_NOTICE);
        onSignedIn();
      } else if (res.reason !== 'cancelled') {
        setError(res.message);
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Google sign-in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);
    try {
      await sendMagicLink(trimmed);
      setEmailSent(true);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to send sign-in link');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-canvas text-ink flex flex-col">
      {/* Top branding bar */}
      <header className="h-16 shrink-0 flex items-center justify-between px-5 sm:px-8 border-b border-line bg-canvas">
        <span className="font-serif text-[26px] leading-none font-semibold tracking-tight text-cobalt">
          Parliamo
        </span>
        <span className="text-xs font-medium tracking-[0.08em] uppercase text-ink-muted">
          Conversational Italian
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 sm:py-12 flex items-center justify-center">
        <div className="w-full max-w-md p-6 sm:p-8 rounded-[24px] bg-surface border border-line shadow-soft space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <p className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cobalt-tint text-cobalt text-xs font-semibold tracking-[0.06em] uppercase">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              {mode === 'after-onboarding' ? 'Account' : 'Accedi'}
            </p>
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
              {heading}
            </h1>
            <p className="text-sm text-ink-muted">
              {subheading}
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="text-sm text-red-700 bg-red-50 p-3 rounded-xl border border-red-200"
            >
              {error}
            </p>
          )}

          {/* Continue with Google */}
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGoogleSignIn}
            className="w-full h-12 flex items-center justify-center gap-3 px-4 rounded-2xl bg-canvas border border-line hover:border-cobalt hover:bg-surface-tint text-sm font-semibold text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-line w-full" />
            <span className="bg-surface px-3 text-xs uppercase tracking-wider text-ink-muted">
              oppure
            </span>
          </div>

          {/* Email magic link */}
          {emailSent ? (
            <div className="p-4 rounded-2xl bg-canvas border border-line space-y-3">
              <p className="text-sm text-ink leading-relaxed">
                Check your inbox. Open the link on this device to finish signing in.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEmailSent(false);
                  setError(null);
                }}
                className="text-xs font-semibold text-cobalt hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div>
                <label htmlFor="signin-email-input" className="sr-only">
                  Email address
                </label>
                <input
                  id="signin-email-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email…"
                  disabled={isLoading}
                  className="w-full px-4 py-3 rounded-2xl bg-canvas border-[1.5px] border-line text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:border-cobalt transition-colors disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !email.trim()}
                className="w-full h-11 flex items-center justify-center gap-2 px-4 rounded-2xl bg-surface border border-line hover:border-cobalt hover:bg-surface-tint text-sm font-semibold text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mail className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                <span>Email me a sign-in link</span>
              </button>
            </form>
          )}

          {/* Secondary button */}
          <div className="pt-2 border-t border-line flex justify-center">
            <button
              type="button"
              disabled={isLoading}
              onClick={onSkip}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink py-2 px-4 rounded-xl transition-colors disabled:opacity-50"
            >
              {mode === 'login' && <ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              <span>{mode === 'after-onboarding' ? 'Not now' : 'Back'}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
