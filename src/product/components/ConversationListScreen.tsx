/** Conversation list screen showing all learner chats with preview, time, and delete confirmation. */
import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, AlertCircle, MessageSquare } from 'lucide-react';
import { TUTORS, EMMANUELE } from '../data/personas';
import { getTutorGreeting } from '../data/personaGreetings';
import type { SessionSummary } from '../server/sessionStore';

/**
 * Format relative time for conversation rows ("2h", "Yesterday", "Just now", etc.).
 */
export function formatRelativeTime(dateStr: string, nowMs: number = Date.now()): string {
  const time = Date.parse(dateStr);
  if (isNaN(time)) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  const d = new Date(time);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface ConversationListScreenProps {
  sessions: SessionSummary[];
  activeSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onOpenNewConversation: () => void;
  onBack: () => void;
  className?: string;
}

export const ConversationListScreen: React.FC<ConversationListScreenProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onOpenNewConversation,
  onBack,
  className = ''
}) => {
  const [sessionPendingDelete, setSessionPendingDelete] = useState<SessionSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!sessionPendingDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteSession(sessionPendingDelete.sessionId);
      setSessionPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`h-full w-full flex flex-col bg-canvas text-ink overflow-hidden ${className}`}>
      {/* Top Header */}
      <header className="h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 bg-canvas border-b border-line">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="min-h-[48px] min-w-[48px] flex items-center justify-center -ml-2 rounded-full hover:bg-surface text-ink-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-cobalt/40"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <h1 className="font-serif text-xl sm:text-2xl font-semibold text-ink">
            Chats
          </h1>
        </div>

        <button
          type="button"
          onClick={onOpenNewConversation}
          aria-label="New conversation"
          className="min-h-[48px] min-w-[48px] px-3.5 rounded-full bg-cobalt-tint text-cobalt hover:bg-cobalt/20 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1 focus:outline-none focus:ring-2 focus:ring-cobalt/40"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>New</span>
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 max-w-2xl mx-auto w-full space-y-3 pb-24 md:pb-8">
        {sessions.length === 0 ? (
          /* Empty state */
          <div className="py-16 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-cobalt-tint text-cobalt mx-auto flex items-center justify-center">
              <MessageSquare className="w-8 h-8" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-semibold text-ink">No conversations yet</h2>
              <p className="text-xs sm:text-sm text-ink-muted max-w-xs mx-auto">
                Start your first chat with an Italian tutor to begin practicing!
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenNewConversation}
              className="min-h-[48px] px-6 py-3 rounded-2xl bg-cobalt text-canvas font-semibold text-sm hover:bg-cobalt-strong transition-all focus:outline-none focus:ring-2 focus:ring-cobalt/50 shadow-soft"
            >
              Start a conversation
            </button>
          </div>
        ) : (
          /* List of conversation rows */
          <div role="list" className="space-y-2">
            {sessions.map((s) => {
              const tutor = TUTORS.find((t) => t.id === s.personaId) ?? EMMANUELE;
              const isActive = s.sessionId === activeSessionId;
              const relTime = formatRelativeTime(s.updatedAt);
              const preview = s.lastLinePreview || getTutorGreeting(s.personaId, '', 'A2', s.topic).text;
              const previewText = preview
                ? `${s.lastLineSender === 'user' ? 'You: ' : ''}${preview}`
                : 'No messages yet';

              return (
                <div
                  key={s.sessionId}
                  role="listitem"
                  className={`group relative flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all ${
                    isActive
                      ? 'bg-surface border-cobalt shadow-xs'
                      : 'bg-surface border-line hover:border-cobalt/40'
                  }`}
                >
                  {/* Tutor Portrait */}
                  <img
                    src={tutor.avatar.idle}
                    alt=""
                    className="w-12 h-12 rounded-xl object-cover object-top border border-line bg-[#fbf3e6] shrink-0"
                  />

                  {/* Conversation Title & Preview (Tappable to Open) */}
                  <button
                    type="button"
                    onClick={() => onSelectSession(s.sessionId)}
                    className="flex-1 min-w-0 text-left focus:outline-none"
                    aria-label={`Open conversation: ${s.title}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-semibold text-sm text-ink truncate leading-snug">
                        {s.title}
                      </h2>
                      <span className="text-[11px] text-ink-muted whitespace-nowrap shrink-0">
                        {relTime}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted truncate mt-0.5">{previewText}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-cobalt font-medium">{tutor.name}</span>
                      {s.turnCount > 0 && (
                        <span className="text-[10px] text-ink-muted">· {s.turnCount} turns</span>
                      )}
                    </div>
                  </button>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => setSessionPendingDelete(s)}
                    aria-label={`Delete conversation ${s.title}`}
                    className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full text-ink-muted hover:text-coral hover:bg-coral-tint/40 transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* In-app Confirmation Dialog (Never browser confirm()) */}
      {sessionPendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) setSessionPendingDelete(null);
          }}
        >
          <div className="w-full max-w-sm bg-surface border border-line rounded-[24px] p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-coral-tint text-coral flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 id="confirm-delete-title" className="font-serif text-lg font-semibold text-ink">
                  Delete conversation?
                </h3>
                <p className="text-xs text-ink-muted">
                  “{sessionPendingDelete.title}” will be permanently removed. Your saved notebook
                  phrases will not be lost.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setSessionPendingDelete(null)}
                className="min-h-[48px] px-4 py-2.5 rounded-xl text-sm font-semibold text-ink-muted hover:bg-canvas transition-colors focus:outline-none focus:ring-2 focus:ring-cobalt/40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                className="min-h-[48px] px-5 py-2.5 rounded-xl text-sm font-semibold bg-coral text-canvas hover:bg-coral/90 transition-colors focus:outline-none focus:ring-2 focus:ring-coral/50 shadow-xs"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
