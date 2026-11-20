import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewConversationSheet } from '../src/product/components/NewConversationSheet';

describe('NewConversationSheet', () => {
  it('renders topic chips and tutors when isOpen is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(NewConversationSheet, {
        isOpen: true,
        onClose: vi.fn(),
        tier: 'free',
        canUpgrade: true,
        onSeePlansForTutor: vi.fn(),
        onStartConversation: vi.fn()
      })
    );

    expect(html).toContain('New conversation');
    expect(html).toContain('Ordering at a café');
    expect(html).toContain('At the market');
    expect(html).toContain('Asking for directions');
    expect(html).toContain('Start conversation');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('safe-area-inset-bottom');
  });

  it('does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(NewConversationSheet, {
        isOpen: false,
        onClose: vi.fn(),
        tier: 'free',
        canUpgrade: true,
        onSeePlansForTutor: vi.fn(),
        onStartConversation: vi.fn()
      })
    );

    expect(html).toBe('');
  });
});
