/** Phone notebook tab leading with saved phrases, followed by grammar notes. */
import React from 'react';
import { Bookmark, Lightbulb, Sparkles, X } from 'lucide-react';
import type { GrammarNote, Persona, SavedPhrase } from '../types';

export interface NotebookTabProps {
  savedPhrases: SavedPhrase[];
  grammarHighlight: GrammarNote | null;
  persona: Persona;
  onRemovePhrase: (id: string) => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export const NotebookTab: React.FC<NotebookTabProps> = ({
  savedPhrases,
  grammarHighlight,
  persona,
  onRemovePhrase,
  headingRef
}) => {
  return (
    <div className="h-full w-full overflow-y-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 max-w-2xl mx-auto space-y-6">
      {/* Visually-hidden heading for accessibility and focus target */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="sr-only focus:outline-none"
      >
        Notebook
      </h1>

      {/* 1. Lead with Saved phrases */}
      <section
        aria-labelledby="saved-phrases-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-coral-tint text-coral flex items-center justify-center shrink-0" aria-hidden="true">
              <Bookmark className="w-4 h-4" />
            </span>
            <h2 id="saved-phrases-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
              Saved phrases
            </h2>
          </div>
          {savedPhrases.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-coral-tint text-coral-strong text-xs font-semibold font-mono-data">
              {savedPhrases.length}
            </span>
          )}
        </div>

        {savedPhrases.length > 0 ? (
          <ul className="space-y-2.5">
            {savedPhrases.map((phrase) => (
              <li
                key={phrase.id}
                className="group relative pl-4 pr-10 py-3 rounded-[18px] bg-coral-tint border border-coral/15"
              >
                <p lang="it" className="font-serif text-[15px] font-semibold text-ink">
                  {phrase.it}
                </p>
                {phrase.en && (
                  <p className="text-xs text-ink-muted mt-0.5">{phrase.en}</p>
                )}
                <button
                  type="button"
                  onClick={() => onRemovePhrase(phrase.id)}
                  aria-label={`Remove "${phrase.it}" from saved phrases`}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-coral-strong opacity-80 hover:opacity-100 focus-visible:opacity-100 hover:bg-coral/10 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4 rounded-2xl bg-canvas border border-line space-y-1.5 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 text-ink font-medium text-sm">
              <Sparkles className="w-4 h-4 text-coral shrink-0" aria-hidden="true" />
              <span>No saved phrases yet</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              When chatting with {persona.name}, tap the Save button on any message to keep useful words and expressions here for review.
            </p>
          </div>
        )}
      </section>

      {/* 2. Grammar notes (latest tips) */}
      <section
        aria-labelledby="grammar-notes-heading"
        className="p-5 rounded-[24px] bg-surface border border-line shadow-soft space-y-4"
      >
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-mint-tint text-mint-strong flex items-center justify-center shrink-0" aria-hidden="true">
            <Lightbulb className="w-4 h-4" />
          </span>
          <h2 id="grammar-notes-heading" className="text-xs font-semibold tracking-[0.08em] uppercase text-ink-muted">
            Grammar notes
          </h2>
        </div>

        {grammarHighlight ? (
          <div className="p-4 rounded-[20px] bg-mint-tint border border-mint space-y-1.5">
            <p lang="it" className="font-serif text-lg leading-snug text-ink font-medium">
              {grammarHighlight.wordOrPhrase}
            </p>
            <p className="text-sm leading-relaxed text-ink-soft">
              {grammarHighlight.explanation}
            </p>
            <p className="text-[11px] text-mint-strong font-medium pt-1">
              Tip from {persona.name}
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-canvas border border-line space-y-1">
            <p className="text-sm text-ink-muted">
              Grammar tips and corrections from {persona.name} will appear here as you practice in Italian.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
