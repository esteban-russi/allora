/** Tests for document lang="en" and lang="it" attributes on Italian UI text. */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatInterface } from '../src/product/components/ChatInterface';
import { UtilityPanel } from '../src/product/components/UtilityPanel';
import { OnboardingPage } from '../src/product/components/OnboardingPage';
import { SignInScreen } from '../src/platform/components/SignInScreen';
import { PersonaProfileModal } from '../src/product/components/PersonaProfileModal';
import { EMMANUELE, INITIAL_MESSAGES } from '../src/product/data/personas';
import type { DevSettings } from '../src/product/types';

const rootDir = path.resolve(__dirname, '..');

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

describe('language attributes', () => {
  it('declares lang="en" on the root html element', () => {
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('<html lang="it">');
  });

  it('marks tutor messages and quick replies as lang="it" in ChatInterface', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: INITIAL_MESSAGES,
        devSettings: baseSettings,
        savedPhraseIds: [],
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn(),
      })
    );

    expect(html).toContain(`<p lang="it" class="font-serif text-[17px] sm:text-[19px] leading-snug">${INITIAL_MESSAGES[0].text}</p>`);
    expect(html).toContain(`lang="it" class="shrink-0 px-5 py-2`);
  });

  it('marks saved phrases Italian line and grammar highlight phrase as lang="it" in UtilityPanel', () => {
    const html = renderToStaticMarkup(
      React.createElement(UtilityPanel, {
        persona: EMMANUELE,
        grammarHighlight: {
          wordOrPhrase: 'che lavoro fai?',
          explanation: 'Everyday way to ask someone’s job.',
          category: 'verb',
        },
        savedPhrases: [{ id: 'p-1', it: 'A presto!', en: 'See you soon!' }],
        talkingShare: 40,
        onSwitchToVoice: vi.fn(),
        onOpenProfile: vi.fn(),
        onRemovePhrase: vi.fn(),
      })
    );

    expect(html).toContain('<p lang="it" class="font-serif text-lg leading-snug text-ink">che lavoro fai?</p>');
    expect(html).toContain('<p lang="it" class="font-serif text-[15px] font-semibold text-ink">A presto!</p>');
    expect(html).toContain('<p class="text-xs text-ink-muted mt-0.5">See you soon!</p>');
  });

  it('marks Italian headings and phrases as lang="it" on OnboardingPage, SignInScreen, and PersonaProfileModal', () => {
    const onboardingHtml = renderToStaticMarkup(
      React.createElement(OnboardingPage, { onComplete: vi.fn() })
    );
    expect(onboardingHtml).toContain('<p lang="it" class="inline-flex');
    expect(onboardingHtml).toContain('Benvenuto');
    expect(onboardingHtml).toContain('<span lang="it">Come ti chiami?</span>');
    expect(onboardingHtml).toContain('<span lang="it">Inizia a parlare</span>');

    const loginHtml = renderToStaticMarkup(
      React.createElement(SignInScreen, { mode: 'login', onSignedIn: vi.fn(), onSkip: vi.fn() })
    );
    expect(loginHtml).toContain('<p lang="it" class="inline-flex');
    expect(loginHtml).toContain('Accedi');

    const afterOnboardingHtml = renderToStaticMarkup(
      React.createElement(SignInScreen, { mode: 'after-onboarding', onSignedIn: vi.fn(), onSkip: vi.fn() })
    );
    expect(afterOnboardingHtml).not.toContain('lang="it"');

    const profileHtml = renderToStaticMarkup(
      React.createElement(PersonaProfileModal, {
        persona: EMMANUELE,
        isOpen: true,
        onClose: vi.fn(),
        onStartVideoCall: vi.fn(),
      })
    );
    expect(profileHtml).toContain('<p lang="it" class="font-serif text-lg italic text-ink">');
  });
});
