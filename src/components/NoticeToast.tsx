import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { subscribeToNotices } from '../utils/notice';

const AUTO_DISMISS_MS = 10_000;

/** Fixed banner at the top of the screen showing the latest notice until dismissed. */
export const NoticeToast: React.FC = () => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribeToNotices(setMessage), []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className="fixed top-3 inset-x-3 z-[60] flex justify-center pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto max-w-md w-full flex items-start gap-3 p-4 rounded-2xl bg-ink text-canvas text-sm shadow-soft"
      >
        <p className="flex-1">{message}</p>
        <button
          type="button"
          onClick={() => setMessage(null)}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 hover:bg-canvas/15"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
