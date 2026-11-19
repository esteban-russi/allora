/** One-line notices for the learner, shown by NoticeToast from anywhere in the client. */

type NoticeListener = (message: string) => void;

const listeners = new Set<NoticeListener>();

export const MERGE_FAILED_NOTICE =
  "You're signed in, but we couldn't bring over the conversation you started as a guest.";

export const ACCOUNT_DELETED_NOTICE =
  'This account was deleted, so you have been signed out. You can start again as a guest.';

export const APP_CHECK_FAILED_NOTICE = 'Please update or reload the app.';

/**
 * Show a short notice to the learner.
 *
 * Args:
 *   message: Plain text to display; ignored when no toast is mounted.
 */
export function showNotice(message: string): void {
  for (const listener of listeners) listener(message);
}

/**
 * Listen for notices.
 *
 * Args:
 *   listener: Called with each message.
 *
 * Returns:
 *   A function that stops listening.
 */
export function subscribeToNotices(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
