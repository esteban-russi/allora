import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HabitGoalSelector } from '../src/product/components/HabitGoalSelector';

describe('HabitGoalSelector', () => {
  it('renders Relaxed 5, Regular 10, and Serious 20 options with accessible radio roles', () => {
    const html = renderToStaticMarkup(
      React.createElement(HabitGoalSelector, { value: 10, onChange: vi.fn() })
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Relaxed');
    expect(html).toContain('5 turns');
    expect(html).toContain('Regular');
    expect(html).toContain('10 turns');
    expect(html).toContain('Serious');
    expect(html).toContain('20 turns');
    expect(html).toContain('aria-checked="true"');
  });
});
