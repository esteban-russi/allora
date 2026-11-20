/** Tests for mobile composer focus retention, pointer event handling, and delayed blur. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capturedButtons: any[] = [];
const capturedInputs: any[] = [];

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>();
  const wrap = (fn: any) => (...args: any[]) => {
    const [type, props] = args;
    if (type === 'button' && props) {
      capturedButtons.push(props);
    } else if (type === 'input' && props) {
      capturedInputs.push(props);
    }
    return fn(...args);
  };

  return {
    ...actual,
    jsxDEV: wrap(actual.jsxDEV)
  };
});

import { ChatInterface } from '../src/product/components/ChatInterface';
import { EMMANUELE } from '../src/product/data/personas';
import type { DevSettings } from '../src/product/types';

const devSettings: DevSettings = {
  voiceProvider: 'gemini_live',
  voiceId: 'Charon',
  sttProvider: 'production_cloud',
  voiceCallEngine: 'realtime_live',
  temperature: 0.7,
  speechRate: 0.95,
  audioSamplingRate: '24kHz',
  grammarStrictness: 'tutor',
  subtitlesEnabled: true,
  autoPlayAudio: false
};

describe('Composer focus retention on pointerdown', () => {
  beforeEach(() => {
    capturedButtons.length = 0;
    capturedInputs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents default on pointerdown and mousedown for Send, Mic, Help, and Quick replies', () => {
    const onSendMessage = vi.fn();
    renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [],
        devSettings,
        savedPhraseIds: [],
        draft: 'Ciao!',
        onSendMessage,
        onSavePhrase: vi.fn()
      })
    );

    const sendBtn = capturedButtons.find((b) => b['aria-label'] === 'Send');
    const micBtn = capturedButtons.find((b) => b['aria-label']?.includes('Dictate'));
    const helpBtn = capturedButtons.find((b) => b['aria-controls'] === 'help-me-say-it');
    const quickReplyBtns = capturedButtons.filter((b) => b.lang === 'it');

    expect(sendBtn).toBeDefined();
    expect(micBtn).toBeDefined();
    expect(helpBtn).toBeDefined();
    expect(quickReplyBtns.length).toBeGreaterThan(0);

    // Send button prevents focus loss on both pointerdown and mousedown
    const sendPointerEvt = { preventDefault: vi.fn() };
    sendBtn.onPointerDown(sendPointerEvt);
    expect(sendPointerEvt.preventDefault).toHaveBeenCalled();

    const sendMouseEvt = { preventDefault: vi.fn() };
    sendBtn.onMouseDown(sendMouseEvt);
    expect(sendMouseEvt.preventDefault).toHaveBeenCalled();

    // Mic button
    const micPointerEvt = { preventDefault: vi.fn() };
    micBtn.onPointerDown(micPointerEvt);
    expect(micPointerEvt.preventDefault).toHaveBeenCalled();

    // Help button
    const helpPointerEvt = { preventDefault: vi.fn() };
    helpBtn.onPointerDown(helpPointerEvt);
    expect(helpPointerEvt.preventDefault).toHaveBeenCalled();

    // Quick replies
    for (const qr of quickReplyBtns) {
      const qrPointerEvt = { preventDefault: vi.fn() };
      qr.onPointerDown(qrPointerEvt);
      expect(qrPointerEvt.preventDefault).toHaveBeenCalled();
    }
  });

  it('keeps focus in the composer when pointerdown fires on Send and calls onSendMessage on click', () => {
    // Regression test for mobile browser behavior:
    // With composer focused, tapping Send blurs the input first if pointerdown is not prevented.
    // By preventing default on pointerdown, the input remains activeElement and onClick sends the message.
    const onSendMessage = vi.fn();
    let currentFocusedElement: 'composer-input' | null = 'composer-input';

    renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [],
        devSettings,
        savedPhraseIds: [],
        draft: 'Vorrei un cornetto',
        onSendMessage,
        onSavePhrase: vi.fn()
      })
    );

    const sendBtn = capturedButtons.find((b) => b['aria-label'] === 'Send');
    expect(sendBtn).toBeDefined();

    // 1. Mobile tap sequence: pointerdown fires on Send button
    let defaultPrevented = false;
    const pointerDownEvent = {
      preventDefault: () => {
        defaultPrevented = true;
      }
    };
    sendBtn.onPointerDown(pointerDownEvent);

    // Browser focus invariant: if pointerdown is prevented, focus stays in input
    if (!defaultPrevented) {
      currentFocusedElement = null; // blur would occur
    }

    // Input remains focused
    expect(currentFocusedElement).toBe('composer-input');

    // 2. Click fires on Send button
    sendBtn.onClick();

    // Message is dispatched
    expect(onSendMessage).toHaveBeenCalledWith('Vorrei un cornetto');
  });

  it('delays onComposerBlur so the tab bar does not jump during interaction', () => {
    vi.useFakeTimers();
    const onComposerBlur = vi.fn();

    renderToStaticMarkup(
      React.createElement(ChatInterface, {
        persona: EMMANUELE,
        messages: [],
        devSettings,
        savedPhraseIds: [],
        onComposerBlur,
        onSendMessage: vi.fn(),
        onSavePhrase: vi.fn()
      })
    );

    const input = capturedInputs[0];
    expect(input).toBeDefined();

    // Trigger blur on input
    input.onBlur();

    // Immediately after blur, onComposerBlur has NOT been called (delay is active)
    expect(onComposerBlur).not.toHaveBeenCalled();

    // Advance 100ms: still not called
    vi.advanceTimersByTime(100);
    expect(onComposerBlur).not.toHaveBeenCalled();

    // Advance to 160ms: blur has fired
    vi.advanceTimersByTime(60);
    expect(onComposerBlur).toHaveBeenCalledTimes(1);
  });
});
