import React, { useRef } from 'react';
import { X, Sliders } from 'lucide-react';
import type { DevSettings } from '../types';
import { useDialog } from '../hooks/useDialog';

export const DEV_LAB_STORAGE_KEY = 'parliamo.devlab';

/** Whether the developer lab is accessible (dev builds or localStorage flag). */
export function isDevLabEnabled(isDev: boolean = Boolean(import.meta.env.DEV)): boolean {
  if (isDev) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEV_LAB_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const CORRECTION_STYLES: ReadonlyArray<{
  id: DevSettings['grammarStrictness'];
  label: string;
}> = [
  { id: 'conversational', label: 'Casual' },
  { id: 'tutor', label: 'Friendly Tutor' },
  { id: 'strict', label: 'Strict Professor' },
];

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

  const updateSetting = <K extends keyof DevSettings>(key: K, value: DevSettings[K]) => {
    onSaveSettings({ ...settings, [key]: value });
  };

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

        <div className="p-6 space-y-6 text-sm text-ink">
          {/* Correction style */}
          <div>
            <div id="settings-correction-style" className="font-semibold text-ink mb-2">
              Correction style
            </div>
            <div
              className="grid grid-cols-3 gap-2"
              role="group"
              aria-labelledby="settings-correction-style"
            >
              {CORRECTION_STYLES.map((style) => {
                const isSelected = settings.grammarStrictness === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => updateSetting('grammarStrictness', style.id)}
                    aria-pressed={isSelected}
                    className={`py-2 px-2 rounded-xl border text-center text-xs transition-colors font-semibold ${
                      isSelected
                        ? 'bg-cobalt border-cobalt text-white shadow-xs'
                        : 'bg-surface border-line text-ink hover:bg-cobalt-tint'
                    }`}
                  >
                    {style.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtitles */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div id="settings-subtitles-label" className="font-semibold text-ink">
                Subtitles
              </div>
              <p className="text-xs text-ink-muted">Show captions during voice calls</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.subtitlesEnabled}
              aria-labelledby="settings-subtitles-label"
              onClick={() => updateSetting('subtitlesEnabled', !settings.subtitlesEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.subtitlesEnabled ? 'bg-cobalt' : 'bg-line'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 rounded-full bg-surface shadow-xs transition-transform ${
                  settings.subtitlesEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Auto-play replies */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div id="settings-autoplay-label" className="font-semibold text-ink">
                Play replies aloud automatically
              </div>
              <p className="text-xs text-ink-muted">Read new tutor messages aloud in chat</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoPlayAudio}
              aria-labelledby="settings-autoplay-label"
              onClick={() => updateSetting('autoPlayAudio', !settings.autoPlayAudio)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.autoPlayAudio ? 'bg-cobalt' : 'bg-line'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 rounded-full bg-surface shadow-xs transition-transform ${
                  settings.autoPlayAudio ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Speaking speed */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="settings-speaking-speed" className="font-semibold text-ink">
                Speaking speed
              </label>
              <span className="font-mono text-xs text-cobalt font-bold">
                {settings.speechRate.toFixed(2)}x
              </span>
            </div>
            <input
              id="settings-speaking-speed"
              type="range"
              aria-valuetext={`${settings.speechRate.toFixed(2)} times speed`}
              min="0.7"
              max="1.3"
              step="0.05"
              value={settings.speechRate}
              onChange={(e) => updateSetting('speechRate', parseFloat(e.target.value))}
              className="w-full accent-cobalt cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-ink-muted mt-0.5" aria-hidden="true">
              <span>0.7x (Slower)</span>
              <span>1.0x (Normal)</span>
              <span>1.3x (Faster)</span>
            </div>
          </div>

          {onOpenDevLab && (
            <div className="pt-4 border-t border-line">
              <button
                type="button"
                onClick={onOpenDevLab}
                className="w-full py-2.5 px-4 rounded-xl border border-line bg-canvas hover:bg-cobalt-tint text-ink text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Sliders className="w-3.5 h-3.5 text-cobalt" aria-hidden="true" />
                <span>Developer options</span>
              </button>
            </div>
          )}
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
