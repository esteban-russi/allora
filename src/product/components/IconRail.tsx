/** 72px navigation rail on the left edge (md and up) with Home, Chat, Notebook, and Profile destinations. */
import React from 'react';
import { Home, MessageSquare, NotebookText, Settings, User } from 'lucide-react';
import { UserBadge } from './UserBadge';
import type { AppTab } from './BottomTabBar';

interface IconRailProps {
  activeTab?: AppTab;
  onSelectTab?: (tab: AppTab) => void;
  learnerInitial?: string;
  onOpenNotebook?: () => void;
  onOpenSettings?: () => void;
  onOpenAccount?: () => void;
}

const inactiveRailButton =
  'w-12 h-12 rounded-2xl flex items-center justify-center transition-colors text-ink-faint hover:text-ink hover:bg-cobalt-tint';

const activeRailButton =
  'w-12 h-12 rounded-2xl flex items-center justify-center bg-cobalt text-canvas shadow-soft';

export const IconRail: React.FC<IconRailProps> = ({
  activeTab = 'chat',
  onSelectTab,
  learnerInitial,
  onOpenNotebook,
  onOpenSettings,
  onOpenAccount
}) => {
  const handleSelect = (tab: AppTab) => {
    onSelectTab?.(tab);
    if (tab === 'notebook') {
      onOpenNotebook?.();
    }
  };

  return (
    <nav
      aria-label="Main"
      className="hidden md:flex w-[72px] shrink-0 flex-col items-center gap-3 py-5 bg-surface border-r border-line"
    >
      <button
        type="button"
        onClick={() => handleSelect('home')}
        aria-label="Home"
        title="Home"
        aria-current={activeTab === 'home' ? 'page' : undefined}
        className={activeTab === 'home' ? activeRailButton : inactiveRailButton}
      >
        <Home className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => handleSelect('chat')}
        aria-label="Chat"
        title="Chat"
        aria-current={activeTab === 'chat' ? 'page' : undefined}
        className={activeTab === 'chat' ? activeRailButton : inactiveRailButton}
      >
        <MessageSquare className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => handleSelect('notebook')}
        aria-label="Notebook"
        title="Notebook"
        aria-current={activeTab === 'notebook' ? 'page' : undefined}
        className={activeTab === 'notebook' ? activeRailButton : inactiveRailButton}
      >
        <NotebookText className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => handleSelect('profile')}
        aria-label="Profile"
        title="Profile"
        aria-current={activeTab === 'profile' ? 'page' : undefined}
        className={activeTab === 'profile' ? activeRailButton : inactiveRailButton}
      >
        <User className="w-5 h-5" />
      </button>

      <div className="mt-auto flex flex-col items-center gap-3">
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className={inactiveRailButton}
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}

        {learnerInitial && onOpenAccount && (
          <UserBadge
            initial={learnerInitial}
            onClick={onOpenAccount}
            title="Account menu"
          />
        )}
      </div>
    </nav>
  );
};
