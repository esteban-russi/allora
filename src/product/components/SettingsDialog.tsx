/** Learner-facing settings dialog and developer lab visibility gate. */
import React, { useRef } from 'react';
import { X } from 'lucide-react';
import type { DevSettings } from '../types';
import { useDialog } from '../../platform/hooks/useDialog';
import { LearningSettingsControls } from './LearningSettingsControls';

export const DEV_LAB_STORAGE_KEY = 'parliamo.devlab';

/**
 * Check whether the developer lab is accessible.
 *
 * Args:
 *   isDev: Whether the app is running in development mode.
 *
 * Returns:
 *   True in development builds or when `localStorage` sets `parliamo.devlab` to `"1"`.
 */
export function isDevLabEnabled(isDev: boolean = Boolean(import.meta.env.DEV)): boolean {
  if (isDev) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEV_LAB_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: DevSettings;
  onSaveSettings: (settings: DevSettings) => void;
  onOpenDevLab?: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onOpenDevLab,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        className="w-full max-w-md bg-surface border border-line rounded-[24px] overflow-hidden shadow-2xl flex flex-col focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 id="settings-dialog-title" className="font-serif text-lg font-semibold text-ink">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-cobalt-tint text-ink-muted hover:text-ink transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          <LearningSettingsControls
            settings={settings}
            onSaveSettings={onSaveSettings}
            onOpenDevLab={onOpenDevLab}
          />
        </div>

        <div className="px-6 py-4 border-t border-line bg-canvas flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-cobalt hover:bg-cobalt-strong text-white font-semibold text-xs transition-colors shadow-xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
