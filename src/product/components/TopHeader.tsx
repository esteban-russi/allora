/** Top header bar with branding, tab or tutor title, conversation mode toggle, and desktop avatar. */
import React from 'react';
import { CefrLevel, Persona } from '../types';
import { UserBadge } from './UserBadge';
import { BRAND } from '../../config/brand';
import type { AppTab } from './BottomTabBar';

interface TopHeaderProps {
  activeTab?: AppTab;
  persona: Persona;
  learnerInitial: string;
  learnerLevel?: CefrLevel;
  mode: 'text' | 'voice';
  onSelectVoice: () => void;
  onOpenNotebook?: () => void;
  onOpenAccount?: () => void;
}

const TAB_TITLES: Record<AppTab, string> = {
  home: 'Home',
  chat: 'Chat',
  notebook: 'Notebook',
  profile: 'Profile'
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab = 'chat',
  persona,
  learnerInitial,
  learnerLevel,
  mode,
  onSelectVoice,
  onOpenAccount
}) => {
  const isChatTab = activeTab === 'chat';
  const mobileTitle = isChatTab ? persona.name : TAB_TITLES[activeTab];

  return (
    <header className="h-16 shrink-0 grid grid-cols-[auto_1fr_auto] sm:grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 px-4 md:px-6 bg-canvas border-b border-line sm:border-b-0">
      <span className="font-serif text-[24px] sm:text-[26px] leading-none font-semibold tracking-tight text-cobalt">
        {BRAND.shortName}
      </span>

      {/* Title on phones (< sm) */}
      <div className="flex sm:hidden items-center justify-center min-w-0 px-2">
        <h1 className="font-serif text-base sm:text-lg font-semibold text-ink truncate text-center">
          {mobileTitle}
        </h1>
      </div>

      {/* Title on sm and up */}
      <div className="hidden sm:flex items-center justify-center gap-2">
        {isChatTab ? (
          <>
            <h1 className="font-serif text-lg font-semibold text-ink whitespace-nowrap">
              {persona.name} <span aria-hidden="true">·</span>
              <span className="sr-only">in</span> {persona.city}
            </h1>
            {learnerLevel && (
              <span
                title={`Italian level ${learnerLevel}`}
                className="px-2.5 py-0.5 rounded-full bg-cobalt-tint text-cobalt text-xs font-semibold font-mono-data"
              >
                {learnerLevel}
              </span>
            )}
          </>
        ) : (
          <h1 className="font-serif text-lg font-semibold text-ink whitespace-nowrap">
            {TAB_TITLES[activeTab]}
          </h1>
        )}
      </div>

      <div className="col-start-3 flex items-center justify-end gap-2 sm:gap-4">
        {/* Text/Voice switch: kept in Chat header */}
        {isChatTab ? (
          <div
            role="group"
            aria-label="Conversation mode"
            className="flex items-center p-1 rounded-full bg-surface border border-line shadow-soft"
          >
            <button
              type="button"
              aria-pressed={mode === 'text'}
              className={`px-3 sm:px-5 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                mode === 'text' ? 'bg-cobalt text-canvas' : 'text-ink hover:bg-cobalt-tint'
              }`}
            >
              Text
            </button>
            <button
              type="button"
              aria-pressed={mode === 'voice'}
              onClick={onSelectVoice}
              className={`px-3 sm:px-5 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                mode === 'voice' ? 'bg-cobalt text-canvas' : 'text-ink hover:bg-cobalt-tint'
              }`}
            >
              Voice
            </button>
          </div>
        ) : (
          <div className="h-9 sm:h-11" />
        )}

        {/* Avatar: hidden on phones (< md), visible on desktop */}
        <div className="hidden md:flex">
          <UserBadge
            initial={learnerInitial}
            onClick={onOpenAccount}
            title="Account menu"
          />
        </div>
      </div>
    </header>
  );
};
