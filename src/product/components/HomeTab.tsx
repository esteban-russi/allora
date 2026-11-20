/** Home tab featuring greeting, continue conversation, voice call action, stats, notebook teaser, and tutors. */
import React from 'react';
import {
  AudioLines,
  Bookmark,
  ChevronRight,
  Info,
  Lock,
  MapPin,
  MessageSquare
} from 'lucide-react';
import type { ChatMessage, LearnerProfile, Persona, SavedPhrase } from '../types';
import { TUTORS } from '../data/personas';
import { TodayHabitCard } from './TodayHabitCard';
import type { HabitSummary } from '../server/habitStore';

export function getItalianGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  return hour >= 17 || hour < 4 ? 'Buonasera' : 'Buongiorno';
}

export interface HomeTabProps {
  learnerProfile: LearnerProfile;
  persona: Persona;
  messages: ChatMessage[];
  savedPhrases: SavedPhrase[];
  talkingShare: number;
  tier: string;
  canUpgrade: boolean;
  habits?: HabitSummary | null;
  onNavigateToChat: () => void;
  onNavigateToNotebook: () => void;
  onStartVoiceCall: () => void;
  onSelectTutor: (tutor: Persona) => void;
  onSeePlansForTutor: (tutorId: string) => void;
  onOpenTutorProfile: (tutor: Persona) => void;
  onOpenNewConversation?: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  learnerProfile,
  persona,
  messages,
  savedPhrases,
  talkingShare: _talkingShare,
  tier,
  canUpgrade,
  habits,
  onNavigateToChat,
  onNavigateToNotebook,
  onStartVoiceCall,
  onSelectTutor,
  onSeePlansForTutor,
  onOpenTutorProfile,
  onOpenNewConversation,
  headingRef
}) => {
  const greeting = getItalianGreeting();
  const lastTutorMessage = [...messages].reverse().find((m) => m.sender === 'persona');
  const latestPhrase = savedPhrases.length > 0 ? savedPhrases[0] : null;

  return (
    <div className="h-full w-full overflow-y-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 max-w-2xl mx-auto space-y-6">
      {/* Greeting Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-serif text-2xl sm:text-3xl font-semibold text-ink focus:outline-none"
            >
              {greeting}, {learnerProfile.name}
            </h1>
            <span
              title={`Italian level ${learnerProfile.level}`}
              className="px-2.5 py-0.5 rounded-full bg-cobalt-tint text-cobalt text-xs font-semibold font-mono-data"
            >
              {learnerProfile.level}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted">
            Pronto a praticare il tuo italiano oggi?
          </p>
        </div>
      </header>

      {/* Today Habit Card (Above the fold) */}
      <TodayHabitCard habits={habits ?? null} />

      {/* Primary Card: Continue with Tutor */}
      <section
        aria-labelledby="continue-tutor-heading"
        className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-soft space-y-3"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onOpenTutorProfile(persona)}
            className="shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-cobalt/50"
            aria-label={`View profile of ${persona.fullName}`}
          >
            <img
              src={persona.avatar.idle}
              alt=""
              className="w-14 h-14 rounded-2xl object-cover object-top bg-[#fbf3e6] border border-line"
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-cobalt">
                Continue conversation
              </span>
              {onOpenNewConversation && (
                <button
                  type="button"
                  onClick={onOpenNewConversation}
                  className="text-xs font-semibold text-cobalt hover:underline focus:outline-none focus:ring-2 focus:ring-cobalt/40 rounded px-1"
                >
                  + New conversation
                </button>
              )}
            </div>
            <h2 id="continue-tutor-heading" className="font-serif text-base font-semibold text-ink leading-tight truncate">
              {persona.fullName}
            </h2>
            <p className="text-[11px] text-ink-muted truncate">
              {persona.role} · {persona.city}
            </p>
          </div>
        </div>

        {/* Message preview or empty state */}
        <div className="px-3 py-2 rounded-xl bg-canvas border border-line text-xs">
          {lastTutorMessage ? (
            <p className="text-ink italic truncate">
              “{lastTutorMessage.text}”
            </p>
          ) : (
            <p className="text-ink-muted truncate">
              Start your first conversation with {persona.name} and explore Roman life in Italian.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onNavigateToChat}
          className="w-full h-10 rounded-full bg-cobalt hover:bg-cobalt-strong text-canvas font-medium text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors shadow-xs"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          <span>Chat with {persona.name}</span>
        </button>
      </section>

      {/* Secondary Action: Start a Voice Call */}
      <section aria-label="Voice conversation">
        <button
          type="button"
          onClick={onStartVoiceCall}
          className="w-full p-4 rounded-2xl border border-line bg-surface hover:bg-cobalt-tint/30 flex items-center justify-between gap-3 transition-colors text-left group shadow-soft"
        >
          <div className="flex items-center gap-3.5">
            <span className="w-11 h-11 rounded-full bg-mint text-ink flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
              <AudioLines className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <div className="font-serif text-base font-semibold text-ink">
                Start a voice call
              </div>
              <div className="text-xs text-ink-muted">
                Hands-free spoken practice with {persona.name}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-ink-muted group-hover:text-ink transition-colors" aria-hidden="true" />
        </button>
      </section>

      {/* Notebook Teaser */}
      <section aria-labelledby="notebook-teaser-heading">
        <button
          type="button"
          onClick={onNavigateToNotebook}
          className="w-full p-5 rounded-[24px] bg-surface border border-line shadow-soft hover:border-cobalt/40 transition-colors text-left space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-coral-tint text-coral flex items-center justify-center">
                <Bookmark className="w-4 h-4" aria-hidden="true" />
              </span>
              <h2 id="notebook-teaser-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
                Your notebook
              </h2>
            </div>
            <span className="text-xs font-semibold text-cobalt flex items-center gap-0.5 group-hover:underline">
              <span>View all ({savedPhrases.length})</span>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-canvas border border-line">
            {latestPhrase ? (
              <div className="space-y-0.5">
                <p className="text-xs sm:text-sm font-semibold text-ink line-clamp-1">
                  {latestPhrase.it}
                </p>
                <p className="text-xs text-ink-muted line-clamp-1">
                  {latestPhrase.en}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                No saved phrases yet. Bookmark useful phrases during chat to practice anytime.
              </p>
            )}
          </div>
        </button>
      </section>

      {/* Tutors Row */}
      <section
        aria-labelledby="tutors-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="tutors-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
            Tutors
          </h2>
          <span className="text-xs text-ink-muted">
            {TUTORS.length} {TUTORS.length === 1 ? 'tutor' : 'tutors'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {TUTORS.map((tutor) => {
            const isActive = tutor.id === persona.id;
            const isLocked = tutor.isPremium && tier !== 'premium';
            const isUnavailable = isLocked && !canUpgrade;

            return (
              <div
                key={tutor.id}
                className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                  isActive
                    ? 'bg-cobalt-tint/60 border-cobalt'
                    : isUnavailable
                      ? 'bg-canvas border-line opacity-75'
                      : 'bg-canvas border-line hover:border-cobalt/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onOpenTutorProfile(tutor)}
                    className="shrink-0 focus:outline-none focus:ring-2 focus:ring-cobalt/40 rounded-xl"
                    aria-label={`View ${tutor.fullName}'s profile`}
                  >
                    <img
                      src={tutor.avatar.idle}
                      alt=""
                      className="w-12 h-14 rounded-xl object-cover object-top bg-[#fbf3e6] border border-line"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-serif text-base font-semibold text-ink truncate">
                        {tutor.fullName}
                      </span>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded-full bg-cobalt text-canvas text-[10px] font-semibold">
                          Active
                        </span>
                      )}
                      {isUnavailable ? (
                        <span className="px-2 py-0.5 rounded-full bg-surface border border-line text-ink-muted text-[10px] font-semibold">
                          Coming soon
                        </span>
                      ) : isLocked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-coral-tint border border-coral/30 text-ink text-[10px] font-semibold">
                          <Lock className="w-2.5 h-2.5 text-coral" aria-hidden="true" />
                          Premium
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-ink-muted flex items-center gap-1 mt-0.5 truncate">
                      <MapPin className="w-3 h-3 text-coral shrink-0" aria-hidden="true" />
                      <span>{tutor.role} · {tutor.city}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenTutorProfile(tutor)}
                    aria-label={`About ${tutor.name}`}
                    className="p-2 rounded-xl text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  {isLocked ? (
                    <button
                      type="button"
                      onClick={() => onSeePlansForTutor(tutor.id)}
                      disabled={isUnavailable}
                      className="px-3 py-1.5 rounded-xl bg-cobalt-tint text-cobalt hover:bg-cobalt/20 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      Unlock
                    </button>
                  ) : isActive ? (
                    <button
                      type="button"
                      onClick={onNavigateToChat}
                      className="px-3 py-1.5 rounded-xl bg-cobalt text-canvas hover:bg-cobalt-strong text-xs font-semibold transition-colors shadow-xs"
                    >
                      Chat
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectTutor(tutor)}
                      className="px-3 py-1.5 rounded-xl border border-line hover:bg-surface text-xs font-semibold text-ink transition-colors"
                    >
                      Select
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
