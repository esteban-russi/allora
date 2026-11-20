/** Reusable learning settings controls: correction style, daily goal, reminder, subtitles, audio auto-play, speed. */
import React from 'react';
import { Bell, Sliders } from 'lucide-react';
import type { DevSettings } from '../types';
import { HabitGoalSelector } from './HabitGoalSelector';
import type { HabitGoal, HabitReminder } from '../server/habitStore';
import { getRemindersPlatform } from '../../platform/client/reminders';

export const CORRECTION_STYLES: ReadonlyArray<{
  id: DevSettings['grammarStrictness'];
  label: string;
}> = [
  { id: 'conversational', label: 'Casual' },
  { id: 'tutor', label: 'Friendly Tutor' },
  { id: 'strict', label: 'Strict Professor' }
];

export interface LearningSettingsControlsProps {
  settings: DevSettings;
  onSaveSettings: (settings: DevSettings) => void;
  habitGoal?: HabitGoal;
  onSaveHabitGoal?: (goal: HabitGoal) => void;
  reminder?: HabitReminder;
  onSaveReminder?: (reminder: HabitReminder) => void;
  onOpenDevLab?: () => void;
  className?: string;
}

export const LearningSettingsControls: React.FC<LearningSettingsControlsProps> = ({
  settings,
  onSaveSettings,
  habitGoal = 10,
  onSaveHabitGoal,
  reminder = { enabled: false, time: '19:00' },
  onSaveReminder,
  onOpenDevLab,
  className = ''
}) => {
  const platform = getRemindersPlatform();
  const remindersSupported = platform.isSupported();

  const handleToggleReminder = async () => {
    if (!remindersSupported) return;
    if (!reminder.enabled) {
      const granted = await platform.requestPermission();
      if (!granted) return;
      await platform.schedule(reminder.time);
      onSaveReminder?.({ ...reminder, enabled: true });
    } else {
      await platform.cancel();
      onSaveReminder?.({ ...reminder, enabled: false });
    }
  };

  const handleChangeReminderTime = async (newTime: string) => {
    if (!newTime) return;
    onSaveReminder?.({ ...reminder, time: newTime });
    if (remindersSupported && reminder.enabled) {
      await platform.schedule(newTime);
    }
  };

  const updateSetting = <K extends keyof DevSettings>(key: K, value: DevSettings[K]) => {
    onSaveSettings({ ...settings, [key]: value });
  };

  return (
    <div className={`space-y-6 text-sm text-ink ${className}`}>
      {/* Daily practice goal */}
      <div>
        <div id="settings-habit-goal" className="font-semibold text-ink mb-1">
          Daily practice goal
        </div>
        <p className="text-xs text-ink-muted mb-2.5">
          Each message or spoken turn in voice calls counts as 1 practice turn
        </p>
        <HabitGoalSelector
          labelId="settings-habit-goal"
          value={habitGoal}
          onChange={(goal) => onSaveHabitGoal?.(goal)}
        />
      </div>

      {/* Daily reminder */}
      <div className="p-4 rounded-2xl bg-canvas border border-line space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div id="settings-reminder-label" className="font-semibold text-ink flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-cobalt" aria-hidden="true" />
              <span>Daily reminder</span>
            </div>
            <p className="text-xs text-ink-muted">
              {remindersSupported
                ? 'Get a notification to practice each day'
                : 'Available in the Android app'}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            disabled={!remindersSupported}
            aria-checked={reminder.enabled}
            aria-labelledby="settings-reminder-label"
            onClick={() => void handleToggleReminder()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cobalt/40 disabled:opacity-40 disabled:cursor-not-allowed ${
              reminder.enabled ? 'bg-cobalt' : 'bg-line'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 rounded-full bg-surface shadow-xs transition-transform ${
                reminder.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Time Picker */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-line/60">
          <label htmlFor="settings-reminder-time" className="text-xs font-semibold text-ink">
            Reminder time
          </label>
          <input
            id="settings-reminder-time"
            type="time"
            disabled={!remindersSupported || !reminder.enabled}
            value={reminder.time}
            onChange={(e) => void handleChangeReminderTime(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-line bg-surface text-ink text-xs font-mono-data focus:outline-none focus:border-cobalt disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>
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
  );
};
