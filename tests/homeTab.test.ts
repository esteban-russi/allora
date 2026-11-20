import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeTab, getItalianGreeting } from '../src/product/components/HomeTab';
import { EMMANUELE } from '../src/product/data/personas';

describe('getItalianGreeting', () => {
  it('returns Buongiorno between 04:00 and 16:59', () => {
    const morning = new Date('2026-11-20T09:30:00');
    const noon = new Date('2026-11-20T12:00:00');
    const afternoon = new Date('2026-11-20T16:59:59');

    expect(getItalianGreeting(morning)).toBe('Buongiorno');
    expect(getItalianGreeting(noon)).toBe('Buongiorno');
    expect(getItalianGreeting(afternoon)).toBe('Buongiorno');
  });

  it('returns Buonasera starting from 17:00 through the night until 03:59', () => {
    const evening = new Date('2026-11-20T17:00:00');
    const night = new Date('2026-11-20T22:15:00');
    const earlyHours = new Date('2026-11-20T02:00:00');

    expect(getItalianGreeting(evening)).toBe('Buonasera');
    expect(getItalianGreeting(night)).toBe('Buonasera');
    expect(getItalianGreeting(earlyHours)).toBe('Buonasera');
  });
});

describe('HomeTab section order and compactness', () => {
  it('renders sections in order: greeting -> today card -> continue card -> voice call -> notebook -> tutors', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeTab, {
        learnerProfile: { name: 'Giulia', level: 'B1', personaId: 'emmanuele' },
        persona: EMMANUELE,
        messages: [{ id: 'm1', sender: 'persona', personaId: 'emmanuele', text: 'Ciao Giulia!', translation: 'Hi Giulia!', timestamp: '10:00' }],
        savedPhrases: [],
        talkingShare: 50,
        tier: 'free',
        canUpgrade: true,
        habits: {
          todayCount: 4,
          goal: 10,
          currentStreak: 3,
          longestStreak: 5,
          lastGoalMetDay: null,
          last7Days: [],
          weekDays: [],
          reminder: { enabled: false, time: '19:00' },
          timeZone: 'Europe/Rome',
          goalMetToday: false
        },
        onNavigateToChat: vi.fn(),
        onNavigateToNotebook: vi.fn(),
        onStartVoiceCall: vi.fn(),
        onSelectTutor: vi.fn(),
        onSeePlansForTutor: vi.fn(),
        onOpenTutorProfile: vi.fn(),
        onOpenNewConversation: vi.fn()
      })
    );

    const greetingIdx = html.indexOf('Giulia');
    const todayIdx = html.indexOf('practice and streak');
    const continueIdx = html.indexOf('Continue conversation');
    const voiceIdx = html.indexOf('Start a voice call');
    const notebookIdx = html.indexOf('Your notebook');
    const tutorsIdx = html.indexOf('>Tutors<');

    expect(greetingIdx).toBeGreaterThan(-1);
    expect(todayIdx).toBeGreaterThan(greetingIdx);
    expect(continueIdx).toBeGreaterThan(todayIdx);
    expect(voiceIdx).toBeGreaterThan(continueIdx);
    expect(notebookIdx).toBeGreaterThan(voiceIdx);
    expect(tutorsIdx).toBeGreaterThan(notebookIdx);

    // Continue card compactness
    expect(html).toContain('w-14 h-14'); // 56px portrait
    expect(html).toContain('+ New conversation'); // Secondary text button
  });
});
