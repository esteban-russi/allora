/** Modal dialog for reporting an AI tutor reply in text chat or voice calls. */
import React, { useEffect, useRef, useState } from 'react';
import { Flag, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import type { ReportReason, ReportSource } from '../server/reportStore';
import { postJson } from '../utils/apiClient';
import { getLearnerSessionId } from '../utils/learnerSession';

const MAX_REPORT_TEXT_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 500;

export const REPORT_REASON_OPTIONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'harmful', label: 'Offensive or harmful' },
  { value: 'inaccurate', label: 'Wrong or misleading' },
  { value: 'other', label: 'Something else' }
];

export interface ReportPayload {
  text: string;
  reason: ReportReason;
  comment?: string;
  source: ReportSource;
  sessionId?: string | null;
}

export interface ReportDialogProps {
  isOpen: boolean;
  reportedText: string;
  source: ReportSource;
  sessionId?: string | null;
  onClose: () => void;
  submit?: (payload: ReportPayload) => Promise<boolean>;
}

/**
 * Send a content report to POST /api/report.
 *
 * Args:
 *   payload: Reported tutor text, reason, optional comment, source, and session ID.
 *
 * Returns:
 *   True if the server accepted the report, false otherwise.
 */
export async function submitReport(payload: ReportPayload): Promise<boolean> {
  try {
    const res = await postJson('/api/report', {
      text: payload.text.trim().slice(0, MAX_REPORT_TEXT_LENGTH),
      reason: payload.reason,
      comment: payload.comment?.trim() ?? '',
      source: payload.source,
      sessionId: payload.sessionId ?? getLearnerSessionId() ?? undefined
    });
    return res.ok;
  } catch (err) {
    console.warn('[Report] Failed to submit content report:', err);
    return false;
  }
}

/**
 * Render the report-a-reply modal dialog.
 *
 * Args:
 *   isOpen: Whether the dialog is visible.
 *   reportedText: Tutor text being reported.
 *   source: Origin of the reply ('chat' or 'call').
 *   sessionId: Optional explicit session ID override.
 *   onClose: Called when the dialog is dismissed.
 *   submit: Optional submission override for tests.
 */
export const ReportDialog: React.FC<ReportDialogProps> = ({
  isOpen,
  reportedText,
  source,
  sessionId,
  onClose,
  submit = submitReport
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useDialog(dialogRef, isOpen, isSubmitting ? undefined : onClose);

  useEffect(() => {
    if (isOpen) {
      setReason(null);
      setComment('');
      setIsSubmitting(false);
      setIsSubmitted(false);
      setError(null);
    }
  }, [isOpen, reportedText]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const ok = await submit({
      text: reportedText,
      reason,
      comment,
      source,
      sessionId
    });
    setIsSubmitting(false);
    if (!ok) {
      setError('Could not send your report. Please try again.');
      return;
    }
    setIsSubmitted(true);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        tabIndex={-1}
        className="w-full max-w-md bg-surface border border-line rounded-[24px] overflow-hidden shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-coral-strong" aria-hidden="true" />
            <h2 id="report-dialog-title" className="font-serif text-lg font-semibold text-ink">
              Report reply
            </h2>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close report dialog"
            className="p-1.5 rounded-full hover:bg-cobalt-tint text-ink-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          {isSubmitted ? (
            <div className="space-y-4">
              <p role="status" className="text-sm text-ink leading-relaxed">
                Thanks. We&apos;ll review it.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full h-11 flex items-center justify-center px-4 rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas font-semibold text-sm transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-ink mb-2">
                  What&apos;s the issue?
                </legend>
                {REPORT_REASON_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border cursor-pointer transition-colors ${
                      reason === opt.value
                        ? 'bg-cobalt-tint border-cobalt text-ink'
                        : 'bg-canvas border-line text-ink-soft hover:border-cobalt/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={opt.value}
                      checked={reason === opt.value}
                      disabled={isSubmitting}
                      onChange={() => setReason(opt.value)}
                      className="accent-cobalt"
                    />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                ))}
              </fieldset>

              <div>
                <label htmlFor="report-comment" className="block text-xs font-semibold text-ink-muted mb-1.5">
                  Additional details (optional)
                </label>
                <textarea
                  id="report-comment"
                  maxLength={MAX_COMMENT_LENGTH}
                  rows={3}
                  value={comment}
                  disabled={isSubmitting}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tell us what went wrong…"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-canvas border border-line text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:border-cobalt resize-none disabled:opacity-50"
                />
              </div>

              <p className="text-xs text-ink-muted">
                The reported message is sent to us for review.
              </p>

              {error && (
                <p
                  role="alert"
                  className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200"
                >
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="flex-1 h-11 flex items-center justify-center px-4 rounded-2xl border border-line text-sm font-semibold text-ink hover:bg-canvas transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reason || isSubmitting}
                  className="flex-1 h-11 flex items-center justify-center px-4 rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas text-sm font-semibold transition-colors disabled:opacity-50 disabled:hover:bg-cobalt"
                >
                  {isSubmitting ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
