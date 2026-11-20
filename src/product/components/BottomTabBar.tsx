/** Fixed bottom tab bar on phones for Home, Chat, Notebook, and Profile destinations. */
import React from 'react';
import { Home, MessageSquare, NotebookText, User } from 'lucide-react';

export type AppTab = 'home' | 'chat' | 'notebook' | 'profile';

export interface BottomTabBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  isHidden?: boolean;
}

export const APP_TABS: ReadonlyArray<{
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'notebook', label: 'Notebook', icon: NotebookText },
  { id: 'profile', label: 'Profile', icon: User }
];

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onSelectTab,
  isHidden = false
}) => {
  if (isHidden) return null;

  return (
    <nav
      aria-label="Bottom navigation"
      className="fixed bottom-0 inset-x-0 z-30 md:hidden bg-surface border-t border-line pb-[env(safe-area-inset-bottom)] shadow-soft"
    >
      <div className="grid grid-cols-4 items-center h-16 px-1">
        {APP_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectTab(tab.id)}
              className={`min-h-[48px] min-w-[48px] h-full w-full flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-cobalt font-semibold' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon
                className={`w-5 h-5 ${isActive ? 'text-cobalt' : 'text-ink-muted'}`}
                aria-hidden={true}
              />
              <span className="text-[11px] leading-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
