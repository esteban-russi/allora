/** Tests for SettingsDialog, developer lab gating, and IconRail settings button. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEV_LAB_STORAGE_KEY,
  SettingsDialog,
  isDevLabEnabled,
} from '../src/product/components/SettingsDialog';
import { IconRail } from '../src/product/components/IconRail';
import type { DevSettings } from '../src/product/types';

const baseSettings: DevSettings = {
  voiceProvider: 'gemini_live',
  voiceId: 'Charon',
  sttProvider: 'production_cloud',
  voiceCallEngine: 'realtime_live',
  temperature: 0.7,
  speechRate: 0.95,
  audioSamplingRate: '24kHz',
  grammarStrictness: 'tutor',
  subtitlesEnabled: true,
  autoPlayAudio: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsDialog, {
        isOpen: false,
        onClose: vi.fn(),
        settings: baseSettings,
        onSaveSettings: vi.fn(),
      })
    );
    expect(html).toBe('');
  });

  it('renders learner-facing options only and omits developer controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsDialog, {
        isOpen: true,
        onClose: vi.fn(),
        settings: baseSettings,
        onSaveSettings: vi.fn(),
      })
    );

    expect(html).toContain('Settings');
    expect(html).toContain('Correction style');
    expect(html).toContain('Casual');
    expect(html).toContain('Friendly Tutor');
    expect(html).toContain('Strict Professor');
    expect(html).toContain('Subtitles');
    expect(html).toContain('Play replies aloud automatically');
    expect(html).toContain('Speaking speed');
    expect(html).toContain('0.95x');

    expect(html).not.toContain('Developer options');
    expect(html).not.toContain('Voice Model Provider');
    expect(html).not.toContain('Voice Call Engine');
    expect(html).not.toContain('LLM Temperature');
    expect(html).not.toContain('24kHz');
  });

  it('renders the Developer options button only when onOpenDevLab is provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(SettingsDialog, {
        isOpen: true,
        onClose: vi.fn(),
        settings: baseSettings,
        onSaveSettings: vi.fn(),
        onOpenDevLab: vi.fn(),
      })
    );

    expect(html).toContain('Developer options');
  });
});

describe('isDevLabEnabled', () => {
  it('returns true in dev mode even without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(isDevLabEnabled(true)).toBe(true);
  });

  it('returns false in non-dev mode unless parliamo.devlab is "1"', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
    });

    expect(isDevLabEnabled(false)).toBe(false);

    store.set(DEV_LAB_STORAGE_KEY, '0');
    expect(isDevLabEnabled(false)).toBe(false);

    store.set(DEV_LAB_STORAGE_KEY, '1');
    expect(isDevLabEnabled(false)).toBe(true);
  });

  it('returns false when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(isDevLabEnabled(false)).toBe(false);
  });
});

describe('IconRail', () => {
  it('labels the settings button "Settings"', () => {
    const html = renderToStaticMarkup(
      React.createElement(IconRail, {
        learnerInitial: 'E',
        onOpenNotebook: vi.fn(),
        onOpenSettings: vi.fn(),
      })
    );

    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('title="Settings"');
    expect(html).not.toContain('Voice Lab');
  });
});
