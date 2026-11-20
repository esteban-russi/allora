/** Unit tests for BottomTabBar navigation destinations and TopHeader titles. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BottomTabBar, APP_TABS } from '../src/product/components/BottomTabBar';
import { TopHeader } from '../src/product/components/TopHeader';
import { EMMANUELE } from '../src/product/data/personas';

describe('BottomTabBar', () => {
  it('renders four tabs in order: Home, Chat, Notebook, Profile', () => {
    expect(APP_TABS.map((t) => t.label)).toEqual(['Home', 'Chat', 'Notebook', 'Profile']);

    const onSelectTab = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(BottomTabBar, {
        activeTab: 'chat',
        onSelectTab
      })
    );

    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('aria-label="Chat"');
    expect(html).toContain('aria-label="Notebook"');
    expect(html).toContain('aria-label="Profile"');
    expect(html).toContain('aria-current="page"');
  });

  it('renders nothing when isHidden is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(BottomTabBar, {
        activeTab: 'chat',
        onSelectTab: vi.fn(),
        isHidden: true
      })
    );

    expect(html).toBe('');
  });
});

describe('TopHeader with tabs', () => {
  it('shows tutor name on Chat tab, tab name on non-Chat tabs, and logo only on Home', () => {
    const chatHtml = renderToStaticMarkup(
      React.createElement(TopHeader, {
        activeTab: 'chat',
        persona: EMMANUELE,
        learnerInitial: 'E',
        mode: 'text',
        onSelectVoice: vi.fn()
      })
    );
    expect(chatHtml).toContain(EMMANUELE.name);
    expect(chatHtml).toContain('Conversation mode');

    const homeHtml = renderToStaticMarkup(
      React.createElement(TopHeader, {
        activeTab: 'home',
        persona: EMMANUELE,
        learnerInitial: 'E',
        mode: 'text',
        onSelectVoice: vi.fn()
      })
    );
    // Home shows the brand logo only; greeting is the in-page heading, no "Home" title in top bar
    expect(homeHtml).toContain('Allora');
    expect(homeHtml).not.toContain('>Home<');

    const notebookHtml = renderToStaticMarkup(
      React.createElement(TopHeader, {
        activeTab: 'notebook',
        persona: EMMANUELE,
        learnerInitial: 'E',
        mode: 'text',
        onSelectVoice: vi.fn()
      })
    );
    expect(notebookHtml).toContain('Notebook');

    const profileHtml = renderToStaticMarkup(
      React.createElement(TopHeader, {
        activeTab: 'profile',
        persona: EMMANUELE,
        learnerInitial: 'E',
        mode: 'text',
        onSelectVoice: vi.fn()
      })
    );
    expect(profileHtml).toContain('Profile');
  });
});
