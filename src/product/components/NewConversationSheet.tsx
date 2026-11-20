/** Bottom sheet modal for starting a new conversation with a tutor and topic. */
import React, { useState } from 'react';
import { X, Lock, ArrowRight } from 'lucide-react';
import { TUTORS } from '../data/personas';
import { CONVERSATION_TOPICS } from '../data/topics';
import type { Persona } from '../types';
import type { Tier } from '../../platform/server/accountStore';

export interface NewConversationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tier: Tier;
  canUpgrade: boolean;
  onSeePlansForTutor: (tutorId: string) => void;
  onStartConversation: (personaId: string, topicId: string) => void;
}

export const NewConversationSheet: React.FC<NewConversationSheetProps> = ({
  isOpen,
  onClose,
  tier,
  canUpgrade,
  onSeePlansForTutor,
  onStartConversation
}) => {
  const [selectedTutorId, setSelectedTutorId] = useState<string>(TUTORS[0].id);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('free_chat');

  if (!isOpen) return null;

  const handleTutorClick = (tutor: Persona) => {
    if (tutor.isPremium && tier !== 'premium') {
      if (canUpgrade) {
        onSeePlansForTutor(tutor.id);
      }
      return;
    }
    setSelectedTutorId(tutor.id);
  };

  const handleStart = () => {
    onStartConversation(selectedTutorId, selectedTopicId);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conv-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-surface border border-line rounded-t-[28px] sm:rounded-[28px] shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 pb-3 sm:pb-4 border-b border-line shrink-0">
          <div className="space-y-0.5">
            <h2 id="new-conv-title" className="font-serif text-xl sm:text-2xl font-semibold text-ink">
              New conversation
            </h2>
            <p className="text-xs text-ink-muted">
              Choose a tutor and what you want to talk about
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full hover:bg-canvas text-ink-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-cobalt/40"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Tutor Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Choose your tutor
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {TUTORS.map((t) => {
                const isLocked = t.isPremium && tier !== 'premium';
                const isSelected = selectedTutorId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTutorClick(t)}
                    aria-pressed={isSelected}
                    className={`min-h-[48px] p-2.5 rounded-2xl border text-left flex items-center gap-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-cobalt/40 ${
                      isSelected
                        ? 'bg-cobalt-tint border-cobalt ring-1 ring-cobalt'
                        : 'bg-canvas border-line hover:border-cobalt/30'
                    }`}
                  >
                    <img
                      src={t.avatar.idle}
                      alt=""
                      className="w-10 h-10 rounded-xl object-cover object-top border border-line shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-xs text-ink truncate">{t.name}</span>
                        {isLocked && (
                          <Lock className="w-3 h-3 text-amber-600 shrink-0" aria-label="Premium tutor" />
                        )}
                      </div>
                      <p className="text-[10px] text-ink-muted line-clamp-2 leading-tight mt-0.5">{t.role}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topic Chips */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Choose a topic
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CONVERSATION_TOPICS.map((topic) => {
                const isSelected = selectedTopicId === topic.id;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => setSelectedTopicId(topic.id)}
                    aria-pressed={isSelected}
                    className={`min-h-[48px] p-3 rounded-2xl border text-left transition-all flex flex-col justify-center focus:outline-none focus:ring-2 focus:ring-cobalt/40 ${
                      isSelected
                        ? 'bg-cobalt-tint border-cobalt shadow-xs'
                        : 'bg-canvas border-line hover:border-cobalt/30'
                    }`}
                  >
                    <span className="font-semibold text-xs text-ink">{topic.label}</span>
                    <p className="text-[11px] text-ink-muted mt-0.5 line-clamp-1">
                      {topic.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sticky Footer CTA (Safe-area aware) */}
        <div className="shrink-0 p-4 sm:p-6 pt-3 bg-surface border-t border-line pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={handleStart}
            className="w-full min-h-[48px] py-3 px-5 rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas font-semibold text-sm flex items-center justify-center gap-2 shadow-soft transition-all focus:outline-none focus:ring-2 focus:ring-cobalt/50 active:scale-[0.99]"
          >
            <span>Start conversation</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
