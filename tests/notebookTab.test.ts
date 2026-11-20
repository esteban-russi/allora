/** Tests for NotebookTab component on mobile viewports. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NotebookTab } from '../src/product/components/NotebookTab';
import { EMMANUELE } from '../src/product/data/personas';

describe('NotebookTab', () => {
  it('leads with saved phrases and shows friendly empty state', () => {
    const html = renderToStaticMarkup(
      React.createElement(NotebookTab, {
        savedPhrases: [],
        grammarHighlight: null,
        persona: EMMANUELE,
        onRemovePhrase: vi.fn()
      })
    );

    // Visually hidden heading for accessibility
    expect(html).toContain('class="sr-only focus:outline-none">Notebook</h1>');
    // Section headers: Saved phrases leads, then Grammar notes
    const savedPhrasesPos = html.indexOf('Saved phrases');
    const grammarNotesPos = html.indexOf('Grammar notes');
    expect(savedPhrasesPos).toBeGreaterThan(-1);
    expect(grammarNotesPos).toBeGreaterThan(-1);
    expect(savedPhrasesPos).toBeLessThan(grammarNotesPos);

    // Friendly empty state explaining how to save from message's Save button
    expect(html).toContain('No saved phrases yet');
    expect(html).toContain('tap the Save button on any message');

    // Grammar empty state
    expect(html).toContain('Grammar tips and corrections from Emmanuele will appear here');

    // Excluded desktop panel items: no tutor profile card, no Switch to voice, no quota/talk meters
    expect(html).not.toContain('Switch to voice');
    expect(html).not.toContain('You did');
    expect(html).not.toContain('talking today');
  });

  it('renders saved phrases with Italian language attribute and allows removing them', () => {
    const onRemovePhrase = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(NotebookTab, {
        savedPhrases: [
          { id: 'phrase-1', it: 'Vorrei un caffè, per favore.', en: 'I would like a coffee, please.' }
        ],
        grammarHighlight: {
          wordOrPhrase: 'Vorrei vs Voglio',
          explanation: 'Vorrei is the polite conditional form (I would like).',
          category: 'grammar'
        },
        persona: EMMANUELE,
        onRemovePhrase
      })
    );

    // Phrase rendered with lang="it"
    expect(html).toContain('lang="it"');
    expect(html).toContain('Vorrei un caffè, per favore.');
    expect(html).toContain('I would like a coffee, please.');
    expect(html).toContain('Remove &quot;Vorrei un caffè, per favore.&quot; from saved phrases');

    // Grammar highlight rendered
    expect(html).toContain('Vorrei vs Voglio');
    expect(html).toContain('Vorrei is the polite conditional form');
    expect(html).toContain('Tip from Emmanuele');
  });
});
