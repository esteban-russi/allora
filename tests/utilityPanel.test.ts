import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UtilityPanel } from '../src/components/UtilityPanel';
import { EMMANUELE, INITIAL_SAVED_PHRASES } from '../src/data/personas';

describe('UtilityPanel saved phrases', () => {
  it('starts new learners with an empty saved phrases list', () => {
    expect(INITIAL_SAVED_PHRASES).toEqual([]);
  });

  it('shows the empty state when no phrases are saved', () => {
    const html = renderToStaticMarkup(
      React.createElement(UtilityPanel, {
        persona: EMMANUELE,
        grammarHighlight: null,
        savedPhrases: INITIAL_SAVED_PHRASES,
        talkingShare: 0,
        onSwitchToVoice: vi.fn(),
        onOpenProfile: vi.fn(),
        onRemovePhrase: vi.fn(),
      })
    );

    expect(html).toContain('Tap Save on any reply to keep it here.');
  });

  it('lists saved phrases and hides the empty state when phrases exist', () => {
    const html = renderToStaticMarkup(
      React.createElement(UtilityPanel, {
        persona: EMMANUELE,
        grammarHighlight: null,
        savedPhrases: [{ id: 'p-1', it: 'A presto!', en: 'See you soon!' }],
        talkingShare: 50,
        onSwitchToVoice: vi.fn(),
        onOpenProfile: vi.fn(),
        onRemovePhrase: vi.fn(),
      })
    );

    expect(html).toContain('A presto!');
    expect(html).toContain('See you soon!');
    expect(html).not.toContain('Tap Save on any reply to keep it here.');
  });
});
