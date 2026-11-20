/** Tests for DevSettingsDrawer voice provider options. */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DevSettingsDrawer } from '../src/components/DevSettingsDrawer';
import type { DevSettings } from '../src/types';

describe('DevSettingsDrawer', () => {
  const settings: DevSettings = {
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

  it('renders only real voice providers and excludes mock providers', () => {
    const html = renderToStaticMarkup(
      React.createElement(DevSettingsDrawer, {
        isOpen: true,
        onClose: vi.fn(),
        settings,
        onSaveSettings: vi.fn(),
        activePersonaName: 'Emmanuele',
      })
    );

    expect(html).toContain('Google Cloud Text-to-Speech');
    expect(html).toContain('Google Gemini Native Audio');
    expect(html).toContain('Local Web Speech API');
    expect(html).not.toContain('ElevenLabs');
    expect(html).not.toContain('OpenAI');
    expect(html).not.toContain('MOCK SPEC');
    expect(html).not.toContain('Architectural parameter mock');
  });
});
